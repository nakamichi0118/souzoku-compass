import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { guardAi } from "@/server/guard";
import { z } from "zod";
import { GUIDE_SYSTEM, MODEL, getClient } from "@/server/claude";

const Body = z.object({
  step: z.string().max(40),
  question: z.string().min(1).max(2000),
  context: z.string().max(6000),
});

export async function POST(req: Request) {
  const blocked = await guardAi("assist");
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力が正しくありません。" }, { status: 400 });
  const client = getClient();
  if (!client) {
    return NextResponse.json({
      answer: "（この環境では Claude に接続していません。ANTHROPIC_API_KEY を設定すると質問に回答します。）",
    });
  }
  const { step, question, context } = parsed.data;
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: GUIDE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `<case_context step="${step}">\n${context}\n</case_context>\n\n質問: ${question}`,
        },
      ],
    });
    if (res.stop_reason === "refusal") {
      return NextResponse.json({ answer: "この質問にはお答えできません。表現を変えてお試しください。" });
    }
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    return NextResponse.json({ answer: text || "回答を取得できませんでした。" });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "混み合っています。少し待ってからお試しください。" }, { status: 429 });
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude への問い合わせに失敗しました（${e.status}）。` }, { status: 502 });
    }
    throw e;
  }
}
