/**
 * 小規模宅地等の特例を使えるかの判定。租税特別措置法69条の4第3項。
 * 相続コンパスでは、迷いの少ない次の場合だけ自動で適用する。
 *
 * 特定居住用宅地等（330㎡まで80%減額。3項2号）
 *   - 亡くなった方が住んでいた自宅の敷地で、老人ホームへの入居・二世帯住宅・一部の賃貸などの事情がない
 *   - 取得するのが配偶者、または亡くなる直前まで同居していて申告期限まで住み続け・持ち続ける親族
 * 特定事業用宅地等（400㎡まで80%減額。3項1号）
 *   - 亡くなった方が自分の事業（お店・工場など。人に貸す事業は除く）に使っていた土地で、
 *     取得する親族が申告期限までにその事業を引き継いで続け、土地を持ち続ける。亡くなる前3年以内に始めた事業でない
 * 貸付事業用宅地等（200㎡まで50%減額。3項4号）
 *   - 亡くなった方が家賃・地代をもらって人に貸していた土地（貸家建付地・貸宅地・貸家建付借地権・貸している部屋）で、
 *     取得する親族が申告期限まで貸し続け、土地を持ち続ける。亡くなる前3年以内に貸し始めたものでない
 *   - 貸付事業は相当の対価を得て続けて行うもの（措置法施行令40条の2第1項）。家族などに無料（固定資産税くらいの額だけ）で
 *     貸している使用貸借は貸付にあたらず、土地も自用地として評価する（使用貸借通達）。土地の使い方は「自分で使っている」
 * それ以外（別居の親族＝いわゆる家なき子、分からない答えがある など）は、税理士への相談を案内し、
 * 税理士に確認したと本人が選んだときだけ適用する。
 */
import type { LandUse, Person, SmallLandKind } from "../types";

export type Answer = "yes" | "no" | "unsure";

export interface SmallResidentialCheck {
  /** 亡くなった方が住んでいた自宅の敷地か（貸している土地では聞かない） */
  ownHome?: Answer;
  /** 老人ホームへの入居、二世帯住宅、建物の一部を貸していた などの事情があるか */
  special?: Answer;
  /** 取得する人は亡くなる直前まで同じ家に住んでいたか（配偶者は不要） */
  livedTogether?: Answer;
  /** 取得する人は申告期限（10か月）まで住み続け（事業用・貸付用は事業・貸付を続け）、持ち続けるか（居住用の配偶者は不要） */
  keep?: Answer;
  /** 自宅の敷地でないとき：亡くなった方が自分の事業（お店・工場など。人に貸す事業は除く）に使っていた土地か */
  business?: Answer;
  /** 事業用・貸付用：取得する人が申告期限までにその事業（貸付）を引き継ぎ、続けるか */
  continues?: Answer;
  /** 事業用・貸付用：亡くなる前3年以内に始めた事業（貸し始めた貸付）か */
  recent?: Answer;
  /** 税理士に確認して適用すると決めた */
  confirmedByAdvisor?: boolean;
}

export type Judgement = { result: "ok" | "no" | "consult" | "incomplete"; reason: string };

/** 減額の割合（%）と限度面積（㎡） */
export const SMALL_LAND_RULE: Record<SmallLandKind, { rate: number; limitSqm: number; name: string }> = {
  residence: { rate: 80, limitSqm: 330, name: "特定居住用宅地等" },
  business: { rate: 80, limitSqm: 400, name: "特定事業用宅地等" },
  rental: { rate: 50, limitSqm: 200, name: "貸付事業用宅地等" },
};

/**
 * 特例の種類を、土地の使い方と答えから決める。
 * 人に貸している土地・部屋は貸付事業用、自宅でなく事業に使っていた土地は特定事業用、それ以外は特定居住用
 */
export function smallLandKind(a: { kind: "land"; use?: LandUse; smallResidential?: { check?: SmallResidentialCheck } } | { kind: "condo"; rented?: boolean; smallResidential?: { check?: SmallResidentialCheck } }): SmallLandKind {
  if (a.kind === "land" ? a.use === "rentedHouse" || a.use === "leasedLand" || a.use === "rentedLeasehold" : !!a.rented) return "rental";
  const c = a.smallResidential?.check;
  if (c?.ownHome === "no" && c.business === "yes") return "business";
  return "residence";
}

const ASK: Judgement = { result: "incomplete", reason: "質問に答えてください。" };

/**
 * 貸付事業用は家賃・地代を相場どおりにもらって貸しているときだけ使えることの説明（画面の Tips などに使える）。
 * 家族に無料などで貸している（使用貸借）土地は、貸していることにならず、評価も特例も「自分で使っている」土地として扱う
 */
export const RENTAL_RENT_NOTE =
  "貸付事業用の特例は、家賃・地代を相場どおりにもらって貸している場合だけ使えます。家族に無料（固定資産税くらいの額だけ）で貸している土地は、貸していることにならず、土地の使い方は「自分で使っている」になります。";

/** 事業用・貸付用の共通の条件（引き継いで続ける・持ち続ける・3年以内に始めたものでない） */
function judgeUse(c: SmallResidentialCheck, kind: "business" | "rental"): Judgement {
  const what = kind === "business" ? "事業" : "貸付";
  if (!c.continues) return ASK;
  if (c.continues === "no") return { result: "no", reason: `申告期限までに${what}をやめる場合は、特例は使えません。` };
  if (c.continues === "unsure") return { result: "consult", reason: `申告期限まで${what}を続けるか決まっていない場合は、税理士に確認してください。` };
  if (!c.keep) return ASK;
  if (c.keep === "no") return { result: "no", reason: "申告期限までに土地を売る場合は、特例は使えません。" };
  if (c.keep === "unsure") return { result: "consult", reason: "申告期限まで土地を持ち続けるか決まっていない場合は、税理士に確認してください。" };
  if (!c.recent) return ASK;
  if (c.recent !== "no")
    return {
      result: "consult",
      reason: `亡くなる前3年以内に始めた${what}は、規模などの条件を満たす場合に限り使えます。税理士に確認してください。`,
    };
  return {
    result: "ok",
    reason:
      kind === "business"
        ? "取得する人が事業を引き継いで続け、土地を持ち続けるので、400㎡までの部分の評価額を80%減らせます。"
        : "取得する人が貸付を続け、土地を持ち続けるので、200㎡までの部分の評価額を50%減らせます（家賃・地代を相場どおりにもらって貸している場合です）。",
  };
}

export function judgeSmallResidential(c: SmallResidentialCheck, acquirer: Person | undefined, kind: SmallLandKind = "residence"): Judgement {
  if (!acquirer) return { result: "incomplete", reason: "取得する人を選んでください。" };
  if (acquirer.relation === "other") return { result: "no", reason: "小規模宅地等の特例は、亡くなった方の親族が取得した土地だけに使えます。" };
  if (kind === "rental") return judgeUse(c, "rental");
  if (!c.ownHome) return ASK;
  if (c.ownHome === "unsure") return { result: "consult", reason: "自宅の敷地かどうかがはっきりしないため、税理士への確認をおすすめします。" };
  if (c.ownHome === "no") {
    if (!c.business) return ASK;
    if (c.business === "no")
      return {
        result: "no",
        reason:
          "自宅の敷地でも、事業に使っていた土地でもないため、特例は使えません。家賃・地代をもらって人に貸している土地は、土地の使い方で貸していることを選んでください（借りた土地に建てたアパート・貸家を貸しているときは「人の土地を借りて建てたアパート・貸家を、家賃をもらって貸している」）。家族が無料で住んでいた土地や、アスファルト舗装などをして貸している月極駐車場は、使える場合があるので税理士にご相談ください。",
      };
    if (c.business === "unsure") return { result: "consult", reason: "事業に使っていた土地かどうかがはっきりしないため、税理士への確認をおすすめします。" };
    return judgeUse(c, "business");
  }
  if (!c.special) return ASK;
  if (c.special !== "no") return { result: "consult", reason: "老人ホームへの入居・二世帯住宅・一部の賃貸などがある場合は、使える範囲の判断が難しいため税理士に確認してください。" };
  if (acquirer.relation === "spouse") return { result: "ok", reason: "配偶者が取得する自宅の敷地は、ほかの条件なしで特例を使えます。" };
  if (!c.livedTogether) return ASK;
  if (c.livedTogether !== "yes")
    return {
      result: "consult",
      reason: "同居していなかった親族は、持ち家がないことなど細かい条件（いわゆる「家なき子」）を満たす場合に限り使えます。判断を誤ると追徴課税につながるため、税理士に確認してください。",
    };
  if (!c.keep) return ASK;
  if (c.keep === "no") return { result: "no", reason: "申告期限までに売る・引っ越す場合は、同居していた親族でも特例は使えません。" };
  if (c.keep === "unsure") return { result: "consult", reason: "申告期限まで住み続けるか決まっていない場合は、税理士に確認してください。" };
  return { result: "ok", reason: "同居していた親族が取得し、申告期限まで住み続け・持ち続けるので特例を使えます。" };
}

/** 特例を実際に適用するか：自動で使えると判定したとき、または税理士に確認して適用すると決めたとき */
export const shouldApply = (j: Judgement, c: SmallResidentialCheck) => j.result === "ok" || (j.result === "consult" && !!c.confirmedByAdvisor);
