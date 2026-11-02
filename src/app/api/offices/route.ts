/**
 * 住所を管轄する窓口（市区町村役場・年金事務所・税務署・法務局・家庭裁判所・公証役場）を、
 * コンパスくん（Claude）がウェブ検索で公式サイトから調べる。
 * どの種類の窓口に行くかはアプリのルール表で決まっており、ここでは「その住所の担当はどこか」と連絡先だけを調べる。
 * 結果には出典の URL を付け、画面では「行く前に公式サイト・電話で確認を」と案内する。
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { OFFICE_LABEL, cityOf, type OfficeKind } from "@/domain/procedures/offices";
import { MODEL, getClient } from "@/server/claude";

const Body = z.object({
  kind: z.enum(Object.keys(OFFICE_LABEL) as [OfficeKind, ...OfficeKind[]]),
  address: z.string().min(4).max(120),
  dept: z.string().max(60).optional(),
});

const Office = z.object({
  found: z.boolean().describe("管轄の窓口を公式サイトで確認できたか"),
  name: z.string().describe("窓口の正式名称（例：千代田区役所 区民課、麹町税務署）"),
  dept: z.string().describe("担当の課・係（分かる場合。分からなければ空文字）"),
  address: z.string().describe("所在地（郵便番号があれば含める）"),
  phone: z.string().describe("代表または担当の電話番号"),
  hours: z.string().describe("受付時間（分かる場合）"),
  url: z.string().describe("根拠にした公式サイトのページURL"),
  note: z.string().describe("予約制・郵送可・管轄の注意など、一般の人に役立つ補足（1〜2文）"),
});

const SYSTEM = `あなたは「相続コンパス」の案内役コンパスくんです。亡くなった方の住所をもとに、手続きの提出先となる窓口を調べます。
- web_search で、自治体・国の機関の公式サイト（go.jp、lg.jp、自治体ドメイン、courts.go.jp、nta.go.jp、moj.go.jp、nenkin.go.jp、koshonin.gr.jp 等）を確認してください。
- 管轄（その住所を担当する窓口）を必ず確かめてください。税務署・法務局・年金事務所・家庭裁判所は市区町村ごとに管轄が決まっています。
- 公式サイトで確認できなかった項目は推測で埋めず、空文字にし、found を false にしてください。
- url には実際に確認したページの URL を入れてください。`;

const cache = new Map<string, { at: number; data: z.infer<typeof Office> }>();
const TTL = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力が正しくありません。" }, { status: 400 });
  const { kind, address, dept } = parsed.data;
  const { pref, city } = cityOf(address);
  if (!pref || !city) return NextResponse.json({ error: "住所から市区町村が分かりませんでした。都道府県から入力してください。" }, { status: 400 });
  const key = `${kind}|${pref}${city}|${dept ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.data);

  const client = getClient();
  if (!client) return NextResponse.json({ error: "この環境ではコンパスくんに接続していません。" }, { status: 503 });

  const label = OFFICE_LABEL[kind];
  // 市区町村役場は「市区町村」まで分かれば十分なので、番地以降は送らない
  const where = `${pref}${city}`;
  const ask =
    kind === "city"
      ? `${where}の役所（本庁舎）で、「${dept ?? "相続に関する手続き"}」を担当する窓口の名称・所在地・電話番号・受付時間を調べてください。`
      : `${where}を管轄する${label}の名称・所在地・電話番号・受付時間を調べてください。`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: ask }];
  try {
    for (let i = 0; i < 3; i++) {
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: "low", format: zodOutputFormat(Office) },
        system: SYSTEM,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4, user_location: { type: "approximate", country: "JP", timezone: "Asia/Tokyo" } }],
        messages,
      });
      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      if (res.stop_reason === "refusal" || !res.parsed_output) break;
      const data = res.parsed_output;
      if (data.url && !/^https:\/\//.test(data.url)) data.url = "";
      cache.set(key, { at: Date.now(), data });
      return NextResponse.json(data);
    }
    return NextResponse.json({ error: "窓口を調べられませんでした。" }, { status: 422 });
  } catch (e) {
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `コンパスくんへの問い合わせに失敗しました（${e.status}）。` }, { status: 502 });
    throw e;
  }
}
