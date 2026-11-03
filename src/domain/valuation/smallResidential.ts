/**
 * 小規模宅地等の特例（特定居住用宅地等）を使えるかの判定。租税特別措置法69条の4第3項2号。
 * 相続コンパスでは、迷いの少ない次の場合だけ自動で適用する。
 *   - 亡くなった方が住んでいた自宅の敷地で、老人ホームへの入居・二世帯住宅・一部の賃貸などの事情がない
 *   - 取得するのが配偶者、または亡くなる直前まで同居していて申告期限まで住み続け・持ち続ける親族
 * それ以外（別居の親族＝いわゆる家なき子、分からない答えがある など）は、税理士への相談を案内し、
 * 税理士に確認したと本人が選んだときだけ適用する。
 */
import type { Person } from "../types";

export type Answer = "yes" | "no" | "unsure";

export interface SmallResidentialCheck {
  /** 亡くなった方が住んでいた自宅の敷地か */
  ownHome?: Answer;
  /** 老人ホームへの入居、二世帯住宅、建物の一部を貸していた などの事情があるか */
  special?: Answer;
  /** 取得する人は亡くなる直前まで同じ家に住んでいたか（配偶者は不要） */
  livedTogether?: Answer;
  /** 取得する人は申告期限（10か月）まで住み続け、持ち続けるか（配偶者は不要） */
  keep?: Answer;
  /** 税理士に確認して適用すると決めた */
  confirmedByAdvisor?: boolean;
}

export type Judgement = { result: "ok" | "no" | "consult" | "incomplete"; reason: string };

export function judgeSmallResidential(c: SmallResidentialCheck, acquirer: Person | undefined): Judgement {
  if (!acquirer) return { result: "incomplete", reason: "取得する人を選んでください。" };
  if (!c.ownHome) return { result: "incomplete", reason: "質問に答えてください。" };
  if (c.ownHome === "no") return { result: "no", reason: "亡くなった方が住んでいた自宅の敷地でないため、相続コンパスでは特例を計算しません（貸していた土地・事業用の土地は別の区分です）。" };
  if (c.ownHome === "unsure") return { result: "consult", reason: "自宅の敷地かどうかがはっきりしないため、税理士への確認をおすすめします。" };
  if (!c.special) return { result: "incomplete", reason: "質問に答えてください。" };
  if (c.special !== "no") return { result: "consult", reason: "老人ホームへの入居・二世帯住宅・一部の賃貸などがある場合は、使える範囲の判断が難しいため税理士に確認してください。" };
  if (acquirer.relation === "spouse") return { result: "ok", reason: "配偶者が取得する自宅の敷地は、ほかの条件なしで特例を使えます。" };
  if (!c.livedTogether) return { result: "incomplete", reason: "質問に答えてください。" };
  if (c.livedTogether !== "yes")
    return {
      result: "consult",
      reason: "同居していなかった親族は、持ち家がないことなど細かい条件（いわゆる「家なき子」）を満たす場合に限り使えます。判断を誤ると追徴課税につながるため、税理士に確認してください。",
    };
  if (!c.keep) return { result: "incomplete", reason: "質問に答えてください。" };
  if (c.keep === "no") return { result: "no", reason: "申告期限までに売る・引っ越す場合は、同居していた親族でも特例は使えません。" };
  if (c.keep === "unsure") return { result: "consult", reason: "申告期限まで住み続けるか決まっていない場合は、税理士に確認してください。" };
  return { result: "ok", reason: "同居していた親族が取得し、申告期限まで住み続け・持ち続けるので特例を使えます。" };
}

/** 特例を実際に適用するか：自動で使えると判定したとき、または税理士に確認して適用すると決めたとき */
export const shouldApply = (j: Judgement, c: SmallResidentialCheck) => j.result === "ok" || (j.result === "consult" && !!c.confirmedByAdvisor);
