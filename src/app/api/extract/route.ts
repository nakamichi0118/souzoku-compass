/**
 * 書類の画像・PDF（残高証明書、固定資産税の課税明細書、保険金支払通知書など）から
 * 財産の入力候補を取り出す。結果は「候補」として画面に表示し、本人が確認してから登録する。
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { guardAi } from "@/server/guard";
import { ClaudeResult, toExtracted } from "@/server/extractSchema";
import { MODEL, getClient } from "@/server/claude";

const SYSTEM = `あなたは相続手続きの書類から財産情報を読み取る担当です。書類に書かれている値だけを、書かれているとおりに取り出してください。
書かれていた項目だけを fields に入れ、書かれていない項目は入れないでください（推測で補わない）。読み取れなかった項目は notes に理由を書いてください。金額は円単位の数字だけ（カンマ・単位なし）で書いてください。
評価額の計算はしないでください。
同じ財産を、別々の候補として重ねて出さないでください（例：土地と家屋は分けるが、同じ土地を2回出さない）。
notes は書類を見ている一般の方に向けて書き、英語の項目名（amount・kind など）や「スキーマ」「null」などの言葉は使わないでください。`;

const MEDIA = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

export async function POST(req: Request) {
  const blocked = await guardAi("extract");
  if (blocked) return blocked;
  const client = getClient();
  if (!client) return NextResponse.json({ error: "この環境では Claude に接続していません。" }, { status: 503 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "ファイルがありません。" }, { status: 400 });
  if (!MEDIA.has(file.type)) return NextResponse.json({ error: "画像（PNG/JPEG）かPDFを選んでください。" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "ファイルが大きすぎます（15MBまで）。" }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const source =
    file.type === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
      : ({
          type: "image",
          source: { type: "base64", media_type: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data },
        } as const);
  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "medium", format: zodOutputFormat(ClaudeResult) },
      system: SYSTEM,
      messages: [{ role: "user", content: [source, { type: "text", text: "この書類から相続財産の情報を取り出してください。" }] }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) {
      return NextResponse.json({ error: "書類を読み取れませんでした。" }, { status: 422 });
    }
    return NextResponse.json(toExtracted(res.parsed_output));
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionError) return NextResponse.json({ error: "Claude に接続できませんでした。時間をおいてお試しください。" }, { status: 502 });
    // 原因を Cloud Run のログで追えるように残す（書類の中身は残さない）
    if (e instanceof Anthropic.APIError) console.error("extract: Claude API error", e.status, e.message);
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `Claude への問い合わせに失敗しました${e.status ? `（${e.status}）` : ""}。` }, { status: 502 });
    // 答えが途中で切れた・決まった形になっていないなど（受け取った答えを読めなかった）
    if (e instanceof Anthropic.AnthropicError) return NextResponse.json({ error: "書類を読み取れませんでした。写りのよい画像でもう一度お試しください。" }, { status: 422 });
    throw e;
  }
}
