/**
 * 地理院地図の画像（土地の位置に赤い丸）と、候補の路線価図の画像を見比べて、
 * どの図に土地が載っているかと、地図と図の両方で見分けられる目印（交差点など）の位置を返す。
 * 画面ではこの目印で路線価図を地図に重ね、本人が見て確かめる。路線価の読み取りや評価額の計算はしない。
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { guardAi } from "@/server/guard";
import { z } from "zod";
import { MODEL, getClient } from "@/server/claude";

export const runtime = "nodejs";

const Point = z.object({ x: z.number(), y: z.number() });
const Result = z.object({
  sheetNo: z.string().nullable().describe("赤い丸の場所が載っている路線価図の図番号（渡した番号のどれか）。どれにも載っていなければ null"),
  confidence: z.enum(["high", "medium", "low"]).describe("判断の確かさ"),
  landOnSheet: Point.nullable().describe("選んだ路線価図の画像の上での、赤い丸の場所の推定位置（ピクセル）。分からなければ null"),
  points: z
    .array(
      z.object({
        map: Point.describe("地図の画像の上の位置（ピクセル）"),
        sheet: Point.describe("選んだ路線価図の画像の上の位置（ピクセル）"),
        what: z.string().describe("目印の説明（例：南北の広い道路と東西の道路の交差点）"),
      }),
    )
    .describe("地図と選んだ路線価図の両方ではっきり見分けられる目印。2〜4か所、できるだけ離れたもの"),
  reason: z.string().describe("その図を選んだ理由。一般の方向けのやさしい日本語で1〜2文"),
});
type Result = z.infer<typeof Result>;

const SYSTEM = `あなたは、国税庁の路線価図を地図に重ねる作業を手伝います。
画像1は国土地理院の地図で、赤い丸が評価する土地の位置です。画像2以降は候補の路線価図（図番号つき）です。
路線価図は道路と街区の形を簡単に描いた図で、地図と向き（方位記号）や縮尺が違うことがあります。
- 道路の形、川、線路、大きな建物や公園、図に印刷された町名を見比べて判断してください。
- 目印は、地図と路線価図の両方で同じ場所だとはっきり分かるもの（交差点、道路の曲がり角、橋など）だけを使ってください。確信の持てない目印は使わず、推測で位置を作らないでください。見つかった目印が2か所に満たなければ、見つかった分だけ返し、確かさを low にしてください。
- 位置は、それぞれの画像の左上を原点とし、右へ x、下へ y のピクセル数で、その画像の大きさの範囲で答えてください。
- 路線価（数字と記号）の読み取りや評価額の計算はしないでください。
- 理由は、一般の方に向けたやさしい日本語で書き、英語の項目名は使わないでください。`;

const MAX_IMAGE = 6 * 1024 * 1024;
/** 1回の問い合わせの大きさの上限（約32MB、画像は文字に直すと4/3倍）に収める */
const MAX_TOTAL = 22 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

type Size = { w: number; h: number };

/** PNG の先頭（IHDR）から幅と高さを読む */
function pngSize(buf: Uint8Array): Size | null {
  if (buf.length < 24 || PNG_SIGNATURE.some((b, i) => buf[i] !== b)) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const w = v.getUint32(16);
  const h = v.getUint32(20);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** フォームの「W,H」を読む */
function parseSize(v: FormDataEntryValue | null | undefined): Size | null {
  const m = typeof v === "string" ? v.match(/^\s*(\d{1,5})\s*[,x×]\s*(\d{1,5})\s*$/) : null;
  return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

const sizeText = (s: Size | null) => (s ? `（幅${s.w}×高さ${s.h}ピクセル）` : "");

/** 画像の範囲内の点か（大きさが分からなければ数であることだけ確かめる） */
const inside = (p: { x: number; y: number }, s: Size | null) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && (!s || (p.x >= 0 && p.y >= 0 && p.x <= s.w && p.y <= s.h));

/** Claude が答えた図番号を、渡した番号に合わせる（「9073」と「09073」のような違いは同じとみなす） */
function matchNo(answer: string | null, nos: string[]): string | null {
  if (!answer) return null;
  const a = answer.normalize("NFKC").trim();
  return nos.find((n) => n === a || (/^\d+$/.test(a) && /^\d+$/.test(n) && Number(n) === Number(a))) ?? null;
}

export async function POST(req: Request) {
  const blocked = await guardAi("locate");
  if (blocked) return blocked;
  const client = getClient();
  if (!client) return NextResponse.json({ error: "この環境では Claude に接続していません。路線価図を地図に合わせて置いてください。" }, { status: 503 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "送られた内容を読み取れませんでした。" }, { status: 400 });

  const map = form.get("map");
  const files = form.getAll("sheet");
  const nos = form.getAll("sheetNo").map((v) => String(v).normalize("NFKC").trim());
  const sizeFields = form.getAll("sheetSize");
  if (!(map instanceof File) || map.type !== "image/png") return NextResponse.json({ error: "地図の画像がありません。" }, { status: 400 });
  const sheets = files.filter((f): f is File => f instanceof File && f.type === "image/png");
  if (!sheets.length || sheets.length !== files.length || sheets.length > 4) return NextResponse.json({ error: "路線価図の画像は1〜4枚にしてください。" }, { status: 400 });
  if (nos.length !== sheets.length || new Set(nos).size !== nos.length || !nos.every((n) => /^[0-9A-Za-z_-]{1,16}$/.test(n))) {
    return NextResponse.json({ error: "図番号が正しくありません。" }, { status: 400 });
  }
  if ([map, ...sheets].some((f) => f.size > MAX_IMAGE)) return NextResponse.json({ error: "画像が大きすぎます（1枚6MBまで）。" }, { status: 400 });
  if ([map, ...sheets].reduce((s, f) => s + f.size, 0) > MAX_TOTAL) return NextResponse.json({ error: "画像が全部で大きすぎます。枚数を減らすか、小さくしてください。" }, { status: 400 });

  const mapBuf = new Uint8Array(await map.arrayBuffer());
  const sheetBufs = await Promise.all(sheets.map(async (f) => new Uint8Array(await f.arrayBuffer())));
  if (![mapBuf, ...sheetBufs].every((b) => PNG_SIGNATURE.every((x, i) => b[i] === x))) return NextResponse.json({ error: "PNG 画像を送ってください。" }, { status: 400 });
  // 大きさは画像そのものから読む（読めなければフォームの値を使う）
  const mapSize = pngSize(mapBuf) ?? parseSize(form.get("mapSize"));
  const sheetSizes = sheetBufs.map((b, i) => pngSize(b) ?? parseSize(sizeFields[i]));
  const town = String(form.get("town") ?? "")
    .normalize("NFKC")
    .replace(/[\s<>]+/g, " ")
    .trim()
    .slice(0, 40);

  const image = (b: Uint8Array) =>
    ({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(b).toString("base64") } }) as const;
  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: `画像1：地図${sizeText(mapSize)}。赤い丸が土地の位置です。` },
    image(mapBuf),
    ...sheetBufs.flatMap((b, i): Anthropic.ContentBlockParam[] => [
      { type: "text", text: `画像${i + 2}：路線価図 図番号 ${nos[i]}${sizeText(sheetSizes[i])}` },
      image(b),
    ]),
    {
      type: "text",
      text: [
        `候補の路線価図：${nos.join("、")}`,
        town ? `土地のある町名：${town}` : "",
        "1. 赤い丸の場所が載っている路線価図を1枚選んでください。どれにも載っていなければ図番号は null にしてください。",
        "2. 選んだ路線価図と地図の両方ではっきり見分けられる目印（土地の近くの交差点や道路の角など）を2〜4か所選び、それぞれの画像の上の位置をピクセルで答えてください。目印どうしはできるだけ離してください。",
        "3. 選んだ路線価図の上で、赤い丸の場所がどこに当たるかをピクセルで答えてください。",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "high", format: zodOutputFormat(Result) },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) return NextResponse.json({ error: "地図と路線価図を見比べられませんでした。" }, { status: 422 });
    const out = res.parsed_output;
    const sheetNo = matchNo(out.sheetNo, nos);
    const sheetSize = sheetNo ? sheetSizes[nos.indexOf(sheetNo)] : null;
    const result: Result = {
      sheetNo,
      confidence: out.confidence,
      landOnSheet: sheetNo && out.landOnSheet && inside(out.landOnSheet, sheetSize) ? out.landOnSheet : null,
      points: sheetNo ? out.points.filter((p) => inside(p.map, mapSize) && inside(p.sheet, sheetSize)).slice(0, 4) : [],
      reason: out.reason,
    };
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `Claude への問い合わせに失敗しました（${e.status}）。` }, { status: 502 });
    throw e;
  }
}
