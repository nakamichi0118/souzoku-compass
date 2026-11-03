/**
 * 地図で選んだ場所の市区町村の「評価倍率表」（国税庁、令和8年分）を開き、その町（丁目）・大字の行を読み取る。
 * 宅地の欄が「路線」なら路線価図を使う地域、数字なら固定資産税評価額にその倍率を掛ける地域。
 * 結果は候補として表示し、本人が評価倍率表と見比べて確定する。評価額の計算はしない。
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { guardAi } from "@/server/guard";
import { z } from "zod";
import { MODEL, getClient } from "@/server/claude";
import { MAX_SHEET_BYTES, checkSheetUrl } from "@/server/rosenka";
import { findRatioPdf, normalizeTown } from "@/server/rosenkaIndex";

export const runtime = "nodejs";

const Body = z.object({ lat: z.number().min(20).max(46), lng: z.number().min(122).max(154) });

const Row = z.object({
  page: z.number().describe("その行が載っている PDF のページ（1から数える）"),
  town: z.string().describe("「町（丁目）又は大字名」の欄の文字（書かれているとおり）"),
  area: z.string().describe("「適用地域名」の欄の文字（書かれているとおり。空欄なら空文字）"),
  leaseRatio: z.string().nullable().describe("「借地権割合」の欄（書かれているとおり）。空欄なら null"),
  residential: z.string().describe("「宅地」の倍率の欄（書かれているとおり。例：1.1、路線、比準）"),
  paddy: z.string().nullable().describe("「田」の欄（書かれているとおり）。空欄なら null"),
  field: z.string().nullable().describe("「畑」の欄（書かれているとおり）。空欄なら null"),
  forest: z.string().nullable().describe("「山林」の欄（書かれているとおり）。空欄なら null"),
});
const Reading = z.object({
  rows: z.array(Row).describe("「町（丁目）又は大字名」が指定の町名に当たる行（表の順に、8行まで）"),
  notes: z.array(z.string()).describe("注意点（読み取れなかった点、当たる行がなかったことなど）。一般の方向けのやさしい日本語"),
});
type Reading = z.infer<typeof Reading>;

const SYSTEM = `あなたは国税庁の「評価倍率表」（PDF）を読む補助をします。表の列は、ふつう左から「音順」「町（丁目）又は大字名」「適用地域名」「借地権割合」と続き、その右に「固定資産税評価額に乗ずる倍率等」として「宅地」「田」「畑」「山林」「原野」「牧場」「池沼」が並びます。
- 指定された町名に当たる行をすべて返してください。丁目の書き方の違い（四丁目・4丁目・４丁目）や「ヶ」「ケ」「が」の違い、「大字」の有無は同じものとみなします。
- 丁目の付かない同じ町・大字の行（例：「博多駅前四丁目」に対する「博多駅前」の行）や、「1～5丁目」のように範囲で書かれた行に含まれる場合も含めてください。
- 同じ町名に、適用地域ごとの行が複数あれば、すべて返してください。ただし8行までにしてください。
- 表に印刷されている文字だけを、書かれているとおりに写してください。推測で補ったり、計算したりしないでください。宅地の欄は「路線」「比準」「1.1」のように、書かれたとおりに写してください。
- 当たる行がないときは行を返さず、その旨を注意点に書いてください。
- 注意点は、表を見ている一般の方に向けたやさしい日本語で書き、英語の項目名や「null」などの言葉は使わないでください。`;

const cache = new Map<string, { at: number; data: Reading }>();
const TTL = 24 * 60 * 60 * 1000;
const MAX_CACHE = 500;

/** 国税庁のサイトから PDF を取得する（失敗したら画面に出す文） */
async function fetchPdf(url: string): Promise<Buffer | string> {
  const u = checkSheetUrl(url);
  if (typeof u === "string") return u;
  try {
    const res = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return `評価倍率表を取得できませんでした（${res.status}）。`;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_SHEET_BYTES) return "評価倍率表のファイルが大きすぎます。";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_SHEET_BYTES) return "評価倍率表のファイルが大きすぎます。";
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return "評価倍率表の PDF を取得できませんでした。";
    return buf;
  } catch {
    return "国税庁のサイトに接続できませんでした。時間をおいてお試しください。";
  }
}

export async function POST(req: Request) {
  const blocked = await guardAi("ratio");
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "日本国内の地点を指定してください。" }, { status: 400 });

  let found: Awaited<ReturnType<typeof findRatioPdf>>;
  try {
    found = await findRatioPdf(parsed.data.lat, parsed.data.lng);
  } catch (e) {
    return NextResponse.json({ error: `評価倍率表を探せませんでした（${e instanceof Error ? e.message : String(e)}）。` }, { status: 502 });
  }
  const { pref, city, town, pdfUrl } = found;
  const where = { pref, city, town, pdfUrl };
  if (!pdfUrl) return NextResponse.json({ ...where, rows: [], notes: [found.message ?? "この市区町村の評価倍率表が見つかりませんでした。"] });
  if (!town) {
    return NextResponse.json({ ...where, rows: [], notes: ["町名が分からないため、表から自動で探せませんでした。評価倍率表を開いて、土地のある町（大字）の行を探してください。"] });
  }

  const key = `${pdfUrl}|${normalizeTown(town)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json({ ...where, ...hit.data });

  const client = getClient();
  if (!client) return NextResponse.json({ error: "この環境では Claude に接続していません。評価倍率表を開いて確認してください。", pdfUrl }, { status: 503 });

  const pdf = await fetchPdf(pdfUrl);
  if (typeof pdf === "string") return NextResponse.json({ error: pdf, pdfUrl }, { status: 502 });
  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "medium", format: zodOutputFormat(Reading) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
            { type: "text", text: `市区町村：${city ?? "不明"}\n町（丁目）又は大字名：${town}\nこの町名に当たる行を評価倍率表から探して、書かれているとおりに読み取ってください。` },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) return NextResponse.json({ error: "評価倍率表を読み取れませんでした。", pdfUrl }, { status: 422 });
    const data: Reading = {
      rows: res.parsed_output.rows.slice(0, 8).map((r) => ({ ...r, page: Math.max(1, Math.round(r.page) || 1) })),
      notes: res.parsed_output.notes,
    };
    cache.delete(key);
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!); // いちばん古いものから捨てる
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json({ ...where, ...data });
  } catch (e) {
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `Claude への問い合わせに失敗しました（${e.status}）。` }, { status: 502 });
    throw e;
  }
}
