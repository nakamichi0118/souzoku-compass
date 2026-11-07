/**
 * コンパスくんへの質問（右下のチャット・税額の説明）。
 * 答えは決まった形（返事・答え終えたか）で受け取り、答え終えたときだけ画面に「解決できましたか？」を出す。
 */
import { z } from "zod";

export const AssistBody = z.object({
  step: z.string().max(40),
  question: z.string().min(1).max(2000),
  context: z.string().max(6000),
  /** ここまでのやりとり（古い順）。チャットで続けて聞くとき */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(4000) }))
    .max(12)
    .optional(),
});
export type AssistBodyT = z.infer<typeof AssistBody>;

export const AssistReply = z.object({
  answer: z.string().describe("利用者への返事（Markdown 可）"),
  resolved: z
    .boolean()
    .describe("質問にひととおり答え終えたら true。聞き返している・情報が足りず答えられない・税理士への相談をすすめるだけのときは false"),
});
export type AssistReplyT = z.infer<typeof AssistReply>;

/** Claude に送るやりとり。ケースの情報は最初の利用者の発言にだけ付ける（毎回同じ位置に置き、話の流れを崩さない） */
export function assistMessages({ step, question, context, history = [] }: AssistBodyT): { role: "user" | "assistant"; content: string }[] {
  // やりとりは利用者の発言から始まり、交互に並ぶようにする（崩れた分は捨てる）
  const turns: { role: "user" | "assistant"; text: string }[] = [];
  for (const m of history) {
    const want = turns.length % 2 === 0 ? "user" : "assistant";
    if (m.role === want) turns.push(m);
  }
  if (turns.length % 2 === 1) turns.pop();
  turns.push({ role: "user", text: question });
  return turns.map((m, i) => ({
    role: m.role,
    content: i === 0 ? `<case_context step="${step}">\n${context}\n</case_context>\n\n質問: ${m.text}` : m.text,
  }));
}
