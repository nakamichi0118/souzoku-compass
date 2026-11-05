import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { NextResponse } from "next/server";
import { guardAi } from "@/server/guard";
import { AssistBody, AssistReply, assistMessages } from "@/server/assist";
import { GUIDE_SYSTEM, MODEL, getClient } from "@/server/claude";

export async function POST(req: Request) {
  const blocked = await guardAi("assist");
  if (blocked) return blocked;
  const parsed = AssistBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力が正しくありません。" }, { status: 400 });
  const client = getClient();
  if (!client) {
    return NextResponse.json({
      answer: "（この環境では Claude に接続していません。ANTHROPIC_API_KEY を設定すると質問に回答します。）",
      resolved: false,
    });
  }
  try {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(AssistReply) },
      system: [{ type: "text", text: GUIDE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: assistMessages(parsed.data),
    });
    if (res.stop_reason === "refusal") {
      return NextResponse.json({ answer: "この質問にはお答えできません。表現を変えてお試しください。", resolved: false });
    }
    const out = res.parsed_output;
    if (!out?.answer.trim()) return NextResponse.json({ answer: "回答を取得できませんでした。", resolved: false });
    return NextResponse.json({ answer: out.answer.trim(), resolved: out.resolved });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "混み合っています。少し待ってからお試しください。" }, { status: 429 });
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude への問い合わせに失敗しました（${e.status}）。` }, { status: 502 });
    }
    if (e instanceof Anthropic.AnthropicError) {
      return NextResponse.json({ error: "うまく答えられませんでした。もう一度お試しください。" }, { status: 422 });
    }
    throw e;
  }
}
