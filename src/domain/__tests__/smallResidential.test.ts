import { describe, expect, it } from "vitest";
import { NOT_HOME_OR_BUSINESS_REASON, SMALL_LAND_RULE, judgeSmallResidential, shouldApply, smallLandKind } from "../valuation/smallResidential";
import type { SmallResidentialCheck } from "../valuation/smallResidential";
import { calculate } from "../tax/engine";
import type { Case, LandAsset, Person } from "../types";

const spouse: Person = { id: "s", name: "花子", relation: "spouse" };
const child: Person = { id: "c", name: "一郎", relation: "child" };

describe("小規模宅地等の特例の判定", () => {
  it("配偶者は自宅の敷地なら使える", () => {
    expect(judgeSmallResidential({ ownHome: "yes", special: "no" }, spouse).result).toBe("ok");
  });
  it("同居して住み続ける子は使える", () => {
    expect(judgeSmallResidential({ ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, child).result).toBe("ok");
  });
  it("別居の子（家なき子）・分からない答え・老人ホームなどは税理士へ", () => {
    expect(judgeSmallResidential({ ownHome: "yes", special: "no", livedTogether: "no" }, child).result).toBe("consult");
    expect(judgeSmallResidential({ ownHome: "yes", special: "no", livedTogether: "yes", keep: "unsure" }, child).result).toBe("consult");
    expect(judgeSmallResidential({ ownHome: "yes", special: "yes" }, spouse).result).toBe("consult");
  });
  it("売る・引っ越す場合や自宅でない土地は使えない", () => {
    expect(judgeSmallResidential({ ownHome: "yes", special: "no", livedTogether: "yes", keep: "no" }, child).result).toBe("no");
    expect(judgeSmallResidential({ ownHome: "no" }, spouse).result).toBe("incomplete");
    expect(judgeSmallResidential({ ownHome: "no", business: "no", familyHome: "no" }, spouse).result).toBe("no");
  });
  it("相談が必要な場合は、税理士に確認したときだけ適用する", () => {
    const c = { ownHome: "yes" as const, special: "no" as const, livedTogether: "no" as const };
    const j = judgeSmallResidential(c, child);
    expect(shouldApply(j, c)).toBe(false);
    expect(shouldApply(j, { ...c, confirmedByAdvisor: true })).toBe(true);
    expect(judgeSmallResidential({}, undefined).result).toBe("incomplete");
  });
});

describe("生計を一にしていた家族が無料で住んでいた土地（措置法69条の4第3項2号・タックスアンサー No.4124）", () => {
  const other: Person = { id: "o", name: "知人", relation: "other" };
  const notHome = { ownHome: "no", business: "no" } as const;
  const family = (p: Partial<SmallResidentialCheck> = {}): SmallResidentialCheck => ({ ...notHome, familyHome: "yes", ...p });
  const judge = (c: SmallResidentialCheck, who: Person | undefined, assetKind?: "land" | "condo") => judgeSmallResidential(c, who, "residence", { assetKind });
  const applies = (c: SmallResidentialCheck, who: Person, assetKind?: "land" | "condo") => shouldApply(judge(c, who, assetKind), c);

  it("自宅でも事業用でもないときは、家族が住んでいた土地かを聞く（答えるまでは判定しない）", () => {
    expect(judge(notHome, child).result).toBe("incomplete");
    expect(judge(notHome, spouse).result).toBe("incomplete");
    expect(judge({ ...notHome, confirmedByAdvisor: true }, child).result).toBe("incomplete");
    expect(applies({ ...notHome, confirmedByAdvisor: true }, child)).toBe(false);
  });

  it("「いいえ」なら使えない。説明は短くし、家族が住んでいた土地のことは書かない（月極駐車場の案内は残す）", () => {
    const land = judge({ ...notHome, familyHome: "no" }, child);
    expect(land).toEqual({ result: "no", reason: NOT_HOME_OR_BUSINESS_REASON.land });
    expect(land.reason).toBe(
      "自宅の敷地でも、事業に使っていた土地でもないため、特例は使えません。家賃・地代をもらって人に貸している土地（人の土地を借りて建てたアパート・貸家も）は、「土地の使い方」で貸している使い方を選んでください。舗装して貸している月極駐車場は、使える場合があるので税理士にご相談ください。",
    );
    expect(land.reason).not.toContain("家族が無料で住んでいた");
    const condo = judge({ ...notHome, familyHome: "no" }, child, "condo");
    expect(condo).toEqual({ result: "no", reason: NOT_HOME_OR_BUSINESS_REASON.condo });
    expect(condo.reason).toBe("自宅でも、事業に使っていた部屋でもないため、特例は使えません。家賃をもらって人に貸している部屋は、「家賃をもらって人に貸している」にチェックを入れてください。");
    expect(condo.reason).not.toContain("家族");
    expect(condo.reason).not.toContain("月極駐車場");
    // 配偶者でも同じ。税理士に確認したと選んでも使わない
    expect(judge({ ...notHome, familyHome: "no" }, spouse).result).toBe("no");
    expect(applies({ ...notHome, familyHome: "no", confirmedByAdvisor: true }, spouse)).toBe(false);
    expect(applies({ ...notHome, familyHome: "no", keep: "yes", confirmedByAdvisor: true }, child)).toBe(false);
  });

  it("「わからない」なら税理士へ。確認したときだけ使う", () => {
    const c = family({ familyHome: "unsure" });
    expect(judge(c, child)).toEqual({ result: "consult", reason: "同じ家計の家族が無料で住んでいた土地かどうかがはっきりしないため、税理士への確認をおすすめします。" });
    expect(judge(c, spouse).result).toBe("consult");
    expect(judge(c, child, "condo").reason).toBe("同じ家計の家族が無料で住んでいた部屋かどうかがはっきりしないため、税理士への確認をおすすめします。");
    expect(applies(c, child)).toBe(false);
    expect(applies({ ...c, confirmedByAdvisor: true }, child)).toBe(true);
  });

  it("「はい」で配偶者が取得するときは、生計を一にしていたかの判断があるので税理士へ（確認したら使う）", () => {
    const j = judge(family(), spouse);
    expect(j).toEqual({
      result: "consult",
      reason: "配偶者が取得すれば使えますが、その家族が亡くなった方と生計を一にしていた（同じ家計だった）かは判断が難しいため、税理士に確認してください。",
    });
    // 配偶者には住み続けるかを聞かない
    expect(judge(family({ keep: "no" }), spouse).result).toBe("consult");
    expect(applies(family(), spouse)).toBe(false);
    expect(applies(family({ confirmedByAdvisor: true }), spouse)).toBe(true);
  });

  it("「はい」で配偶者以外が取得するときは、その家族本人で住み続け・持ち続けるかを聞く", () => {
    expect(judge(family(), child)).toEqual({ result: "incomplete", reason: "質問に答えてください。" });
    expect(applies(family({ confirmedByAdvisor: true }), child)).toBe(false);
    // いいえ：配偶者か、住んでいた家族本人が住み続け・持ち続ける場合だけ使える。確認したと選んでも使わない
    expect(judge(family({ keep: "no" }), child)).toEqual({
      result: "no",
      reason: "家族が住んでいた土地は、配偶者か、住んでいた家族本人が取得し、申告期限まで住み続け・持ち続ける場合だけ特例を使えます。",
    });
    expect(judge(family({ keep: "no" }), child, "condo").reason).toBe(
      "家族が住んでいた部屋は、配偶者か、住んでいた家族本人が取得し、申告期限まで住み続け・持ち続ける場合だけ特例を使えます。",
    );
    expect(applies(family({ keep: "no", confirmedByAdvisor: true }), child)).toBe(false);
    // わからない：税理士へ
    expect(judge(family({ keep: "unsure" }), child)).toEqual({
      result: "consult",
      reason: "取得する人がその家族本人か、申告期限まで住み続け・持ち続けるかがはっきりしない場合は、税理士に確認してください。",
    });
    expect(applies(family({ keep: "unsure", confirmedByAdvisor: true }), child)).toBe(true);
    // はい：使える見込みはあるが、生計を一にしていたかの判断は税理士へ
    expect(judge(family({ keep: "yes" }), child)).toEqual({
      result: "consult",
      reason: "住んでいた家族本人が取得し、申告期限まで住み続け・持ち続けるので、使える見込みがあります。ただ、亡くなった方と生計を一にしていた（同じ家計だった）かは判断が難しいため、税理士に確認してください。",
    });
    expect(applies(family({ keep: "yes" }), child)).toBe(false);
    expect(applies(family({ keep: "yes", confirmedByAdvisor: true }), child)).toBe(true);
  });

  it("親族でない人・取得する人を選んでいないときは、これまでどおり", () => {
    expect(judge(family({ keep: "yes", confirmedByAdvisor: true }), other).result).toBe("no");
    expect(applies(family({ keep: "yes", confirmedByAdvisor: true }), other)).toBe(false);
    expect(judge(family({ keep: "yes" }), undefined).result).toBe("incomplete");
  });

  it("特例の種類は特定居住用（330㎡まで80%）。事業用・貸付用の判定には使わない", () => {
    expect(smallLandKind({ kind: "land", use: "self", smallResidential: { check: family() } })).toBe("residence");
    expect(smallLandKind({ kind: "condo", smallResidential: { check: family() } })).toBe("residence");
    expect(SMALL_LAND_RULE.residence).toMatchObject({ rate: 80, limitSqm: 330 });
    // 自宅の敷地・事業用のときは聞かないので、答えが残っていても判定は変わらない
    expect(judgeSmallResidential({ ownHome: "yes", special: "no", familyHome: "no" }, spouse).result).toBe("ok");
    expect(judgeSmallResidential({ ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no", familyHome: "no" }, child, "business").result).toBe("ok");
    expect(judgeSmallResidential({ continues: "yes", keep: "yes", recent: "no", familyHome: "no" }, child, "rental").result).toBe("ok");
  });
});

describe("家族が無料で住んでいた土地を、計算に入れる（calculate）", () => {
  // 亡くなった日は令和8年。長男が生計を一にして無料で住んでいた土地 200㎡ 5,000万円を、長男が1人で受け継ぐ。
  // 特定居住用宅地等：200㎡ は 330㎡ 以内なので全部に使え、減額は 5,000万円 × 80% ＝ 4,000万円
  const c1: Person = { id: "c1", name: "長男", relation: "child" };
  const lot = (check: SmallResidentialCheck): LandAsset => ({
    id: "家族の家",
    kind: "land",
    label: "家族の家",
    location: "x",
    areaSqm: 200,
    landUse: "宅地",
    method: { type: "manual", value: 50_000_000 },
    smallResidential: { applies: true, acquirerId: "c1", check },
  });
  const run = (check: SmallResidentialCheck) => {
    const c: Case = {
      id: "t",
      title: "t",
      decedent: { name: "相続 太郎", birthDate: "1950-01-01", deathDate: "2026-03-15", address: "東京都千代田区" },
      persons: [c1],
      assets: [lot(check)],
      allocations: [{ assetId: "家族の家", shares: [{ personId: "c1", numerator: 1, denominator: 1 }] }],
      debts: [],
      priorGifts: [],
    };
    return calculate(c).assets[0];
  };
  const yes: SmallResidentialCheck = { ownHome: "no", business: "no", familyHome: "yes", keep: "yes" };

  it("税理士に確認したときは、330㎡までの部分を80%減らす", () => {
    expect(run({ ...yes, confirmedByAdvisor: true }).reduction).toBe(40_000_000);
  });
  it("確認していなければ使わない（保存された「適用する」は見ない）", () => {
    expect(run(yes).reduction).toBe(0);
    expect(run({ ...yes, confirmedByAdvisor: false }).reduction).toBe(0);
  });
  it("家族が住んでいた土地でないと答えたら、確認したと選んでいても使わない", () => {
    expect(run({ ownHome: "no", business: "no", familyHome: "no", keep: "yes", confirmedByAdvisor: true }).reduction).toBe(0);
    // その家族本人が住み続け・持ち続けないときも同じ
    expect(run({ ...yes, keep: "no", confirmedByAdvisor: true }).reduction).toBe(0);
  });
});
