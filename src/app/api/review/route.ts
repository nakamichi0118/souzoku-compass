import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { guardAi } from "@/server/guard";
import { MODEL, getClient } from "@/server/claude";
import { TalkBody, TalkReply, checkTalk, talkSystem } from "@/server/review/talk";

export async function POST(req: Request) {
  const blocked = await guardAi("review");
  if (blocked) return blocked;
  const parsed = TalkBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "入力が正しくありません。" }, { status: 400 });
  const client = getClient();
  if (!client) return NextResponse.json({ error: "この環境ではコンパスくんに接続していません。" }, { status: 503 });
  const { topic, messages } = parsed.data;
  // 最後は利用者の発言で終わるようにする（Claude に続きを話させない）
  if (messages[messages.length - 1].role !== "user") return NextResponse.json({ error: "入力が正しくありません。" }, { status: 400 });
  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: zodOutputFormat(TalkReply) },
      system: talkSystem(topic),
      messages: messages.map((m) => ({ role: m.role, content: m.text })),
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) return NextResponse.json({ error: "うまく聞き取れませんでした。言い方を変えてお試しください。" }, { status: 422 });
    return NextResponse.json(checkTalk(topic, res.parsed_output));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "混み合っています。少し待ってからお試しください。" }, { status: 429 });
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `コンパスくんへの問い合わせに失敗しました（${e.status}）。` }, { status: 502 });
    if (e instanceof Anthropic.AnthropicError) return NextResponse.json({ error: "うまく聞き取れませんでした。もう一度お試しください。" }, { status: 422 });
    throw e;
  }
}
