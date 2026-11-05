/**
 * 申告前の確認：財産の入れ漏れ・過去のお金の動き・特例の特殊事情を、決まった質問（台本）で確かめる。
 * - 答えは「ある／ない／分からない」。「分からない」は「ない」として扱わず、未確認のまま残す。
 * - 「ある」のとき、論点ごとに決まった結論（財産に追加・該当なし・相談）だけを出す。
 * - コンパスくん（Claude）が話を聞くのは talk のある論点だけで、出せる結論も talk.outcomes に限る（サーバーでも確かめる）。
 * - 相談に回すのは、ここに書いた論点・条件に当てはまるときだけ（Claude が自分で相談を増やすことはない）。
 */

import type { Case } from "../types";
import { type Receivable, judgeReceivable, receivableType } from "./receivables";

export type TopicId =
  | "company"
  | "esop"
  | "nominee"
  | "valuables"
  | "loans"
  | "realEstateDeal"
  | "receivables"
  | "insuranceRights"
  | "online"
  | "withdrawal"
  | "unknownOutflow"
  | "homeSpecial"
  | "foreign";

export type ReviewAnswer = "yes" | "no" | "unsure";
/** コンパスくんと話したあとに出せる結論 */
export type TalkOutcome = "add" | "gift" | "none" | "consult";

/** 「ある」のときに続けて聞く選択肢。選んだものに決まった結論がつく */
export interface SubChoice {
  id: string;
  label: string;
  /** 追加：財産の一覧に確認待ちの財産を足す。相談：税理士への相談に回す */
  then: { add: AddTemplate } | { consult: string };
}

/** 財産の一覧に足す財産のひな型（金額などは確認待ちにして、財産の画面で入れてもらう） */
export interface AddTemplate {
  kind: "cash" | "other" | "listedStock" | "deposit";
  label: string;
  pending: string[];
  /** 金額が分かっているとき */
  amount?: number;
  /** 亡くなったあとに受け取るお金の種類と日付（財産の画面でも判定を続ける） */
  receivable?: Receivable;
}

/** 亡くなったあとに受け取るお金の1件（申告前の確認で入れる） */
export interface ReceivableEntry extends Receivable {
  id: string;
  amount?: number;
}

export interface Topic {
  id: TopicId;
  group: "assets" | "money" | "special";
  question: string;
  /** 質問の下のたたんだ説明（Tips） */
  tip?: string;
  /** 「ある」のとき：選択肢から選ぶ（台本） */
  sub?: { question: string; choices: SubChoice[]; multiple?: boolean };
  /** 「ある」のとき：そのまま財産に足す */
  add?: AddTemplate;
  /** 「ある」のとき：必ず相談に回す理由 */
  consult?: string;
  /** 「ある」のとき：コンパスくんが詳しく聞く。出せる結論はこの中だけ */
  talk?: { focus: string; outcomes: TalkOutcome[]; consultReason: string };
  /** 「ある」のとき：亡くなる前後の引き出しの計算 */
  withdrawal?: true;
  /** 「ある」のとき：受け取るお金を1件ずつ、種類と日付で相続財産かを決める */
  receivables?: true;
}

export const TOPICS: Topic[] = [
  {
    id: "company",
    group: "assets",
    question: "会社を経営していた・役員だった・家族の会社の株がある",
    tip: "自社株のほか、会社に貸したお金（決算書の「役員借入金」）や、まだもらっていない役員報酬・退職金も財産になります。",
    talk: {
      focus:
        "会社名・業種、亡くなった方が持っていた株の割合、決算書があるか、会社に貸したお金（役員借入金）、まだもらっていない役員報酬・退職金、会社が使っている亡くなった方の土地・建物",
      outcomes: ["add", "none", "consult"],
      consultReason: "会社の株の評価や、会社が使っている土地の特例は、決算書をもとにした専門的な判断が必要",
    },
  },
  {
    id: "esop",
    group: "assets",
    question: "勤め先の持株会に入っていた",
    sub: {
      question: "その会社は上場していますか",
      choices: [
        { id: "listed", label: "上場している", then: { add: { kind: "listedStock", label: "持株会の株式", pending: ["株数（持株会の残高のお知らせ）", "株価"] } } },
        { id: "unlisted", label: "上場していない・分からない", then: { consult: "上場していない会社の持株会の持分は、株の評価が必要" } },
      ],
    },
  },
  {
    id: "nominee",
    group: "assets",
    question: "家族名義の口座にお金を入れていた・通帳や印鑑を管理していた",
    tip: "名義が家族でも、お金の出どころや管理していた人によっては、亡くなった方の財産（名義預金）になります。",
    talk: {
      focus: "誰の名義か、お金の出どころ（誰の収入か）、通帳・印鑑・カードを持っていた人、名義人が口座を知っていたか、贈与契約書や贈与税の申告があるか",
      outcomes: ["none", "consult"],
      consultReason: "家族名義の預金が亡くなった方の財産（名義預金）にあたるかは、お金の出どころや管理の状況から判断が分かれる",
    },
  },
  {
    id: "valuables",
    group: "assets",
    question: "自宅や貸金庫に、現金・金・貴金属・骨董品がある",
    sub: {
      question: "あてはまるものを選んでください",
      multiple: true,
      choices: [
        { id: "cash", label: "現金", then: { add: { kind: "cash", label: "自宅・金庫の現金", pending: ["亡くなった日の金額"] } } },
        { id: "gold", label: "金地金・貴金属", then: { add: { kind: "other", label: "金地金・貴金属", pending: ["評価額（重さ×亡くなった日の買取価格）"] } } },
        { id: "art", label: "高額な骨董品・美術品", then: { consult: "高額な骨董品・美術品は、鑑定などによる評価が必要" } },
      ],
    },
  },
  {
    id: "loans",
    group: "assets",
    question: "人や会社にお金を貸していた・立て替えていた",
    sub: {
      question: "返してもらえる見込みはありますか",
      choices: [
        { id: "yes", label: "ある", then: { add: { kind: "other", label: "貸付金", pending: ["亡くなった日の残高"] } } },
        { id: "no", label: "ない・分からない", then: { consult: "返してもらえない貸付金を減らして評価できるかは、相手の状況による判断が必要" } },
      ],
    },
  },
  {
    id: "realEstateDeal",
    group: "assets",
    question: "亡くなる前に不動産の売買契約をして、まだ引渡し前だった",
    sub: {
      question: "売る契約ですか、買う契約ですか",
      choices: [
        {
          id: "sell",
          label: "売る契約",
          then: { add: { kind: "other", label: "不動産の売買代金（まだ受け取っていない分）", pending: ["残りの代金", "財産の一覧からその土地・建物を外したか"] } },
        },
        { id: "buy", label: "買う契約", then: { consult: "買う契約の途中の不動産は、引渡しを受ける権利と残りの代金の扱いの判断が必要" } },
      ],
    },
  },
  {
    id: "receivables",
    group: "assets",
    question: "亡くなったあとに受け取るお金がある（還付金・高額療養費・家賃・給与など）",
    tip: "市区町村から届く「還付」「高額療養費」「高額介護サービス費」の通知、準確定申告の還付、家賃・配当・給与の未収分です。亡くなる前の分の権利なら、受け取ったのが亡くなった後でも相続財産です。亡くなった日までに口座に入った分は残高に入っているので別に入れません。高額療養費は、入院費などの未払い分（債務）とは相殺せず、それぞれ入れます。未支給年金と葬祭費・埋葬料は、受け取る家族のお金なので入れません。",
    receivables: true,
  },
  {
    id: "insuranceRights",
    group: "assets",
    question: "亡くなった方が保険料を払い、ほかの人にかけていた保険がある",
    tip: "その保険は解約していなくても、解約したときに戻るお金の額で財産になります（生命保険契約に関する権利）。保険会社に「解約返戻金相当額」の証明を頼めます。",
    add: { kind: "other", label: "生命保険契約に関する権利", pending: ["解約返戻金相当額（保険会社の証明書）"] },
  },
  {
    id: "online",
    group: "assets",
    question: "ネット銀行・ネット証券・暗号資産・ゴルフ会員権・車がある",
    add: { kind: "other", label: "ネット口座・暗号資産・会員権など", pending: ["種類", "亡くなった日の残高・評価額"] },
  },
  {
    id: "withdrawal",
    group: "money",
    question: "亡くなる前後に、亡くなった方の口座から引き出した",
    tip: "引き出したお金のうち、使い道が分かっている分（葬儀・入院費などの支払い）を除いた残りは、手もとの現金として財産に入れます。葬儀や入院費に使った分は「債務・葬式費用」に入れます。",
    withdrawal: true,
  },
  {
    id: "unknownOutflow",
    group: "money",
    question: "ここ数年、使い道の分からない大きな出金や家族への送金がある",
    tip: "税務調査では、過去の通帳のお金の動きがよく確かめられます。使い道が分からない出金を、手もとの現金として申告に入れておく場合もあります。",
    talk: {
      focus: "いつごろ・いくらくらい・誰の口座へ（または現金で）、使い道、贈与として渡したものか（贈与税の申告はあるか）",
      outcomes: ["gift", "none", "consult"],
      consultReason: "使い道の分からないお金の動きを申告にどう入れるかは、通帳などをもとにした個別の判断が必要",
    },
  },
  {
    id: "homeSpecial",
    group: "special",
    question: "自宅・土地に特別な事情がある（老人ホーム・二世帯住宅・貸していた など）",
    tip: "例：老人ホームに入っていた／二世帯住宅／一部を貸していた／同居していない子が受け継ぐ／家計が一緒の家族が住んでいた／舗装した駐車場として貸していた",
    consult: "小規模宅地等の特例が使えるかは、居住や貸付の状況による細かい条件の判断が必要",
  },
  {
    id: "foreign",
    group: "special",
    question: "国外に財産がある・国外に住む相続人がいる",
    consult: "国外の財産や国外に住む相続人がいる相続は、相続コンパスでは計算できないため、専門家の判断が必要",
  },
];

export const topicById = (id: TopicId) => TOPICS.find((t) => t.id === id)!;

/** コンパスくんとの話の結果（サーバーで確かめたもの） */
export interface TalkResult {
  outcome: TalkOutcome;
  /** 話の要約（相談メモに使う） */
  summary: string;
  at: string;
}

export interface ReviewState {
  answers?: Partial<Record<TopicId, ReviewAnswer>>;
  /** 「ある」のあとの選択肢（複数選べる論点は複数） */
  sub?: Partial<Record<TopicId, string[]>>;
  /** コンパスくんとの話（画面に出すやりとり） */
  chat?: Partial<Record<TopicId, { role: "user" | "assistant"; text: string }[]>>;
  talk?: Partial<Record<TopicId, TalkResult>>;
  /** 亡くなったあとに受け取るお金（1件ずつ） */
  receivables?: ReceivableEntry[];
  /** 亡くなる前後の引き出し：引き出した額と、使い道が分かった額 */
  withdrawal?: { amount?: number; used?: number };
  /** 「財産に追加」を済ませた論点・選択肢（`topic` または `topic:choice`） */
  added?: string[];
  /** 相談して確かめた論点 */
  consulted?: TopicId[];
  /** 相談のメールを開いた日時 */
  consultOpenedAt?: string;
  /** 申告書をダウンロードするときの同意 */
  consent?: { terms: boolean; responsibility: boolean; at: string };
}

/** 論点ごとのいまの状態 */
export type TopicStatus =
  | { kind: "unanswered" } // まだ答えていない（選択肢や話が終わっていないものも含む）
  | { kind: "clear" } // 確かめ終わった
  | { kind: "unsure" } // 「分からない」：未確認
  | { kind: "add"; items: { key: string; template: AddTemplate }[] } // 財産に足すものが残っている
  | { kind: "talk" } // コンパスくんと話す
  | { kind: "withdrawal" } // 引き出しの額を入れる
  | { kind: "gift" } // 贈与として入れる
  | { kind: "consult"; reasons: string[] }; // 相談に回す

/** 亡くなる前後の引き出しのうち、手もとの現金として入れる額（引き出した額 − 使い道が分かった額。0未満は0） */
export const cashFromWithdrawal = (w: ReviewState["withdrawal"]) => Math.max(0, Math.floor(Number(w?.amount) || 0) - Math.floor(Number(w?.used) || 0));

export const WITHDRAWAL_ADD: AddTemplate = { kind: "cash", label: "亡くなる前後に引き出した現金", pending: [] };

/** 受け取るお金1件を財産に足すときのひな型 */
export function receivableTemplate(e: ReceivableEntry): AddTemplate {
  const { type, receivedOn, basis, holder, amount } = e;
  const receivable: Receivable = { type, ...(receivedOn ? { receivedOn } : {}), ...(basis ? { basis } : {}), ...(holder ? { holder } : {}) };
  return {
    kind: "other",
    label: receivableType(e.type).assetLabel,
    pending: amount && amount > 0 ? [] : ["受け取る金額"],
    ...(amount && amount > 0 ? { amount } : {}),
    receivable,
  };
}

/**
 * 論点のいまの状態。deathDate（亡くなった日）は、受け取るお金が相続財産になるかの判定に使う（ないと判定できず「まだ」のまま）。
 */
export function topicStatus(t: Topic, s: ReviewState, deathDate?: string): TopicStatus {
  const a = s.answers?.[t.id];
  if (!a) return { kind: "unanswered" };
  if (a === "no") return { kind: "clear" };
  if (a === "unsure") return { kind: "unsure" };
  const added = new Set(s.added ?? []);
  const consulted = (s.consulted ?? []).includes(t.id);
  const consultOr = (reasons: string[], rest: TopicStatus): TopicStatus => (reasons.length && !consulted ? { kind: "consult", reasons } : rest);

  if (t.consult) return consultOr([t.consult], { kind: "clear" });
  if (t.add) return added.has(t.id) ? { kind: "clear" } : { kind: "add", items: [{ key: t.id, template: t.add }] };
  if (t.receivables) {
    const rows = s.receivables ?? [];
    // 以前の版で「未収金」をまとめて足した人は、それで済み
    if (!rows.length) return added.has(t.id) ? { kind: "clear" } : { kind: "unanswered" };
    const verdicts = rows.map((e) => ({ e, v: judgeReceivable(e, deathDate) }));
    if (verdicts.some(({ v }) => v.kind === "incomplete")) return { kind: "unanswered" };
    const reasons = [...new Set(verdicts.flatMap(({ v }) => (v.kind === "consult" ? [v.reason] : [])))];
    const items = verdicts.flatMap(({ e, v }) =>
      v.kind === "estate" && !added.has(`${t.id}:${e.id}`) ? [{ key: `${t.id}:${e.id}`, template: receivableTemplate(e) }] : [],
    );
    return consultOr(reasons, items.length ? { kind: "add", items } : { kind: "clear" });
  }
  if (t.withdrawal) {
    if (added.has(t.id)) return { kind: "clear" };
    return { kind: "withdrawal" };
  }
  if (t.sub) {
    const picked = (s.sub?.[t.id] ?? []).map((id) => t.sub!.choices.find((c) => c.id === id)).filter((c): c is SubChoice => !!c);
    if (!picked.length) return { kind: "unanswered" };
    const reasons = picked.flatMap((c) => ("consult" in c.then ? [c.then.consult] : []));
    const items = picked.flatMap((c) => ("add" in c.then && !added.has(`${t.id}:${c.id}`) ? [{ key: `${t.id}:${c.id}`, template: c.then.add }] : []));
    return consultOr(reasons, items.length ? { kind: "add", items } : { kind: "clear" });
  }
  if (t.talk) {
    const r = s.talk?.[t.id];
    if (!r) return { kind: "talk" };
    if (r.outcome === "consult") return consultOr([t.talk.consultReason], { kind: "clear" });
    if (r.outcome === "add")
      return added.has(t.id) ? { kind: "clear" } : { kind: "add", items: [{ key: t.id, template: { kind: "other", label: "会社への貸付金・未払の役員報酬など", pending: ["金額（決算書から）"] } }] };
    if (r.outcome === "gift") return added.has(t.id) ? { kind: "clear" } : { kind: "gift" };
    return { kind: "clear" };
  }
  return { kind: "clear" };
}

/** 論点の「相談して確かめた」の印を外す（答え直したときは、新しい事実を確かめていないため） */
export const dropConsulted = (r: ReviewState, id: TopicId): ReviewState => ({ ...r, consulted: (r.consulted ?? []).filter((x) => x !== id) });

export interface ReviewSummary {
  /** すべての論点を確かめ終わった（未確認・相談・追加の残りがない） */
  confirmed: boolean;
  answered: number;
  total: number;
  unsure: TopicId[];
  open: TopicId[];
  consult: { id: TopicId; reasons: string[] }[];
}

export function reviewSummary(s: ReviewState | undefined, deathDate?: string): ReviewSummary {
  const st = s ?? {};
  const all = TOPICS.map((t) => ({ t, x: topicStatus(t, st, deathDate) }));
  const consult = all.flatMap(({ t, x }) => (x.kind === "consult" ? [{ id: t.id, reasons: x.reasons }] : []));
  return {
    confirmed: all.every(({ x }) => x.kind === "clear"),
    answered: all.filter(({ x }) => x.kind !== "unanswered").length,
    total: TOPICS.length,
    unsure: all.filter(({ x }) => x.kind === "unsure").map(({ t }) => t.id),
    open: all.filter(({ x }) => x.kind !== "clear").map(({ t }) => t.id),
    consult,
  };
}

/** 相談をすすめる一言（「〇〇のため、税務の判断が必要です…」） */
export const consultPrompt = (reason: string) => `${reason}です。税額が大きく変わる可能性があるため、税理士への相談をおすすめします。`;

/** 申告書に「下書き」と入れる理由（確認が終わっていれば null） */
export function draftReason(s: ReviewState | undefined, deathDate?: string): string | null {
  const r = reviewSummary(s, deathDate);
  if (r.confirmed) return null;
  return r.answered < r.total ? "申告前の確認が終わっていません" : "申告前の確認に、未確認・相談の項目が残っています";
}

/**
 * 申告書に「下書き」と入れる理由（相続全体）。申告前の確認のほか、本人には今すぐ決められない「分からない」答え
 * （相続時精算課税の贈与があるか）が残っているときも、計算は止めずに下書きにする
 */
export function caseDraftReason(c: Pick<Case, "review" | "decedent">): string | null {
  if (c.decedent.settlementGift === "unknown") return "相続時精算課税の贈与があるか確かめていません";
  return draftReason(c.review, c.decedent.deathDate);
}

/** 相談メモに入れる行（申告前の確認の分） */
export function reviewConsultLines(s: ReviewState | undefined, deathDate?: string): string[] {
  const st = s ?? {};
  const out: string[] = [];
  for (const t of TOPICS) {
    const x = topicStatus(t, st, deathDate);
    if (x.kind === "consult") {
      const talk = st.talk?.[t.id]?.summary;
      out.push(`${t.question}：${x.reasons.join("。")}。${talk ? `（聞き取り：${talk}）` : ""}`);
    } else if (x.kind === "unsure") out.push(`${t.question}：分からない（未確認）`);
  }
  return out;
}
