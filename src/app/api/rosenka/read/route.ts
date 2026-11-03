/**
 * 路線価図の一部（土地の周辺を切り出した画像）から、路線価の表記を読み取る。
 * 結果は候補として表示し、本人が路線価図と見比べて確定する。評価額の計算はしない。
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { guardAi } from "@/server/guard";
import { z } from "zod";
import { MODEL, getClient } from "@/server/claude";

const Reading = z.object({
  candidates: z
    .array(
      z.object({
        notation: z.string().describe("路線価の表記そのもの（例：420D）。数字とアルファベットのみ"),
        where: z.string().describe("画像のどの道路に付いているか（例：中央の赤い印のすぐ北側の東西の道路）"),
        distanceToMarker: z.enum(["接している", "近い", "離れている"]).describe("赤い印（土地の位置）との位置関係"),
      }),
    )
    .describe("赤い印に近い順"),
  districtSymbol: z.string().nullable().describe("路線価を囲む地区区分の記号の形（例：楕円＝普通商業・併用住宅地区、記号なし＝普通住宅地区）。分からなければ null"),
  notes: z.array(z.string()).describe("読み取れなかった点・注意点"),
});

const SYSTEM = `あなたは国税庁の路線価図を読む補助をします。画像は路線価図の一部で、赤い丸印が評価する土地のおおよその位置です。
道路に沿って書かれた「数字＋アルファベット」（例：420D）が路線価です。数字は千円単位の1㎡当たりの価額、アルファベットは借地権割合です。
画像に書かれている表記だけを読み、推測で補わないでください。にじみ等で確信が持てない文字は notes に書いてください。
どの路線価を使うか（正面路線の判定）や評価額の計算はしないでください。`;

export async function POST(req: Request) {
  const blocked = await guardAi("rosenkaRead");
  if (blocked) return blocked;
  const client = getClient();
  if (!client) return NextResponse.json({ error: "この環境では Claude に接続していません。路線価図を見て入力してください。" }, { status: 503 });
  const form = await req.formData();
  const file = form.get("image");
  if (!(file instanceof File) || file.type !== "image/png") return NextResponse.json({ error: "画像がありません。" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "画像が大きすぎます。" }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "medium", format: zodOutputFormat(Reading) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data } },
            {
              type: "text",
              text:
                form.get("target") === "road"
                  ? "赤い印は、土地に面している道路の上の点です。この道路に付いている路線価を、赤い印に近いものから読み取ってください。交差点の近くでは、赤い印の道路と同じ向きの道路に付いた表記を先にしてください。"
                  : "赤い印の土地に面している道路の路線価を読み取ってください。",
            },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) return NextResponse.json({ error: "読み取れませんでした。" }, { status: 422 });
    return NextResponse.json(res.parsed_output);
  } catch (e) {
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `Claude への問い合わせに失敗しました（${e.status}）。` }, { status: 502 });
    throw e;
  }
}
