/**
 * 申告前の確認で、コンパスくんが「ある」と答えた論点を詳しく聞く。
 * Claude の答えは決まった形（返事・話が終わったか・結論・要約）で受け取り、結論が論点ごとに許されたものかをここで確かめる。
 * 許されていない結論は「相談」に置き換える（Claude が勝手に「該当なし」や「追加」にしない）。
 */
import { z } from "zod";
import { type TalkOutcome, type TopicId, TOPICS, topicById } from "@/domain/review/topics";

export const TalkBody = z.object({
  topic: z.enum(TOPICS.filter((t) => t.talk).map((t) => t.id) as [TopicId, ...TopicId[]]),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(1500) }))
    .min(1)
    .max(24),
});

export const TalkReply = z.object({
  reply: z.string().describe("利用者への返事。次に聞きたいことを1つだけ、やさしい言葉で。話を終えるときは、結論とその理由を短く伝える"),
  done: z.boolean().describe("結論を出せるだけ聞けたら true"),
  outcome: z.enum(["add", "gift", "none", "consult"]).nullable().describe("done のときの結論。done でなければ null"),
  summary: z.string().describe("ここまでに聞き取った事実の要約（税理士への相談メモに使う。100字程度）"),
});
export type TalkReplyT = z.infer<typeof TalkReply>;

const OUTCOME_TEXT: Record<TalkOutcome, string> = {
  add: "add：財産に追加する（金額は利用者が財産の画面で入れる）",
  gift: "gift：亡くなる前3年以内の家族への贈与として入れる",
  none: "none：申告に入れるものはない",
  consult: "consult：税理士への相談に回す",
};

export function talkSystem(topic: TopicId): string {
  const t = topicById(topic);
  const talk = t.talk!;
  return `あなたは「相続コンパス」の案内役「コンパスくん」です。相続税の申告の前に、財産の入れ漏れがないかを利用者に聞いています。
いま聞いている論点：「${t.question}」に「ある」と答えた方への聞き取りです。

聞くこと：${talk.focus}

守ること:
- 1回の返事で聞くのは1つだけ。やさしい言葉（です・ます）で、2〜3文。
- 税額や評価額を計算しない。名義預金・贈与などにあたるかを断定しない。
- 判断が分かれそうなとき、事実が足りないときは consult にする。迷ったら consult。
- 出せる結論は次のものだけ：
${talk.outcomes.map((o) => `  - ${OUTCOME_TEXT[o]}`).join("\n")}
- 3〜5回ほど聞いたら、done を true にして結論を出す。利用者が「分からない」と言い続けるときは consult で終える。
- 個人の名前・口座番号などは要約に入れない（「長男名義」「〇〇銀行」のように書く）。`;
}

/** Claude の答えを、論点ごとに許された結論に合わせる */
export function checkTalk(topic: TopicId, r: TalkReplyT): TalkReplyT {
  const allowed = topicById(topic).talk!.outcomes;
  if (!r.done) return { ...r, outcome: null };
  if (!r.outcome || !allowed.includes(r.outcome)) return { ...r, outcome: "consult" };
  return r;
}
