/**
 * 2回目のレビューで見つかった評価の問題の修正。数字はすべて手で計算したもの。
 * - valuation-1：形がいびつな土地で修正した補正率が 1（減額なし）なら、間口狭小・奥行長大（通達20-4）はふつうどおりする。
 *   不整形地補正率は間口狭小補正率を超えない（付表5（注）3）ので、1 なら間口狭小補正率も1のはず
 * - valuation-2：倍率方式の宅地は 固定資産税評価額 × 倍率（通達21-2）。形は固定資産税評価額に反映されているので、形がいびつでも止めずに計算する
 * - ui-3：自宅でも事業用でもないときの説明を、土地とマンションの部屋で画面の入力に合わせる
 */
import { describe, expect, it } from "vitest";
import { MULTIPLIER_SHAPE_STEP, conditionMessage, valueLand } from "../valuation";
import { type RoadInput, evaluateRoads } from "../valuation/roads";
import { NOT_HOME_OR_BUSINESS_REASON, judgeSmallResidential } from "../valuation/smallResidential";
import type { LandAsset, Person } from "../types";

const land = (p: Partial<LandAsset> = {}): LandAsset => ({
  id: "l",
  kind: "land",
  label: "土地",
  location: "長野県長野市",
  areaSqm: 150,
  landUse: "宅地",
  method: { type: "manual", value: 1 },
  ...p,
});
const rosenka = (roads: RoadInput[], otherCorrection?: number): LandAsset["method"] => ({
  type: "rosenka",
  routePrice: 0,
  depthCorrection: 1,
  district: "普通住宅地区",
  otherCorrection,
  roads,
});
const multiplier = (fixedAssetValue = 10_000_000, m = 1.1): LandAsset["method"] => ({ type: "multiplier", fixedAssetValue, multiplier: m });

describe("valuation-1：形がいびつで補正率 1（減額なし）なら、間口狭小・奥行長大はふつうどおりする", () => {
  const narrow: RoadInput[] = [{ edge: 0, price: 200_000, depth: 30, frontage: 5 }];
  it("200,000 × 奥行30m 0.95 = 190,000円 × 間口狭小 0.94 × 奥行長大 0.90 = 160,740円/㎡ × 150㎡ = 24,111,000円", () => {
    const v = valueLand(land({ condition: "irregular", method: rosenka(narrow, 1) }));
    expect(v.needsConsultation).toBeUndefined();
    expect(v.unitPrice).toBe(160_740);
    expect(v.value).toBe(24_111_000);
    expect(v.steps.some((s) => s.includes("間口狭小補正率 0.94"))).toBe(true);
    expect(v.steps.some((s) => s.includes("減額なし") && s.includes("ふつうどおり"))).toBe(true);
    // 1未満の率を使うときの説明（間口が狭い補正はしない）は出さない
    expect(v.steps.some((s) => s.includes("補正はせず"))).toBe(false);
  });
  it("形がいびつと選んで 1 を入れても、事情なしの土地より高くならない（同じ評価額）", () => {
    const cases: [RoadInput[], number, number][] = [
      // 230,000 × 奥行22m 1.00 × 間口7m 0.97 × 奥行長大 22÷7 0.96 = 214,176円/㎡ × 154㎡
      [[{ edge: 0, price: 230_000, depth: 22, frontage: 7 }], 154, 32_983_104],
      // 旗竿地：200,000 × 奥行40m 0.91 = 182,000円 × 間口3m 0.90 × 奥行長大 40÷3 0.90 = 147,420円/㎡ × 150㎡
      [[{ edge: 0, price: 200_000, depth: 40, frontage: 3 }], 150, 22_113_000],
      [narrow, 150, 24_111_000],
    ];
    for (const [roads, areaSqm, value] of cases) {
      const irregular = valueLand(land({ areaSqm, condition: "irregular", method: rosenka(roads, 1) }));
      expect(irregular.value).toBe(value);
      expect(valueLand(land({ areaSqm, method: rosenka(roads) })).value).toBe(value);
      expect(valueLand(land({ areaSqm, method: rosenka(roads, 1) })).value).toBe(value);
    }
  });
  it("1未満の率は今までどおり、間口狭小・奥行長大をせずにその率だけを掛ける（190,000 × 0.94 = 178,600円/㎡）", () => {
    const v = valueLand(land({ condition: "irregular", method: rosenka(narrow, 0.94) }));
    expect(v.unitPrice).toBe(178_600);
    expect(v.value).toBe(26_790_000);
    expect(v.steps.some((s) => s.includes("補正はせず"))).toBe(true);
    expect(v.steps.some((s) => s.includes("間口狭小補正率 0.94（"))).toBe(false);
  });
  it("間口が入っていなければ、1 のときの説明は出さない（間口狭小・奥行長大の補正がないため。190,000円/㎡）", () => {
    const v = valueLand(land({ condition: "irregular", method: rosenka([{ edge: 0, price: 200_000, depth: 30 }], 1) }));
    expect(v.unitPrice).toBe(190_000);
    expect(v.steps.some((s) => s.includes("減額なし"))).toBe(false);
  });
  it("evaluateRoads は irregular を渡したときだけ補正しない（変わらず）", () => {
    expect(evaluateRoads("普通住宅地区", narrow, { irregular: true })!.perSqm).toBe(190_000);
    expect(evaluateRoads("普通住宅地区", narrow)!.perSqm).toBe(160_740);
  });
});

describe("valuation-2：倍率方式の宅地は、形がいびつでも 固定資産税評価額 × 倍率 で計算する（通達21-2）", () => {
  it("10,000,000 × 1.1 = 11,000,000円。説明に形の補正をしないことを書く", () => {
    const v = valueLand(land({ condition: "irregular", method: multiplier() }));
    expect(v.needsConsultation).toBeUndefined();
    expect(v.value).toBe(11_000_000);
    expect(v.value).toBe(valueLand(land({ method: multiplier() })).value);
    expect(v.steps.some((s) => s.startsWith(MULTIPLIER_SHAPE_STEP))).toBe(true);
    expect(MULTIPLIER_SHAPE_STEP).toBe("倍率方式では、土地の形は固定資産税評価額に反映されているため、形による補正はしません");
    // 事情なしのときは書かない
    expect(valueLand(land({ method: multiplier() })).steps.some((s) => s.includes("形による補正"))).toBe(false);
  });
  it("貸家建付地も計算する：11,000,000 ×（1 − 0.6 × 0.3 × 1）= 9,020,000円", () => {
    const v = valueLand(land({ condition: "irregular", use: "rentedHouse", leaseRatio: 0.6, method: multiplier() }));
    expect(v.needsConsultation).toBeUndefined();
    expect(v.value).toBe(9_020_000);
    expect(v.usage).toBe("貸家建付地");
  });
  it("広い宅地（地積規模の大きな宅地。21-2 ただし書）は相談のまま。形を下げられるとは書かない", () => {
    const v = valueLand(land({ location: "千葉県船橋市", areaSqm: 600, condition: "irregular", method: multiplier() }));
    expect(v.value).toBe(0);
    expect(v.needsConsultation).toContain("地積規模の大きな宅地");
    expect(v.needsConsultation).toContain("評価額を直接入力");
    expect(v.needsConsultation).not.toContain("形に合わせて評価を下げられます");
  });
  it("セットバック・配偶者居住権は倍率方式でも相談のまま", () => {
    expect(valueLand(land({ condition: "setback", method: multiplier() })).needsConsultation).toContain("セットバック");
    expect(valueLand(land({ condition: "spouseResidence", method: multiplier() })).needsConsultation).toContain("配偶者居住権");
  });
  it("宅地以外（雑種地・田など）は、近くの宅地と比べて評価するときに形の補正をすることがあるので相談のまま", () => {
    for (const landUse of ["雑種地", "田", "畑", "山林", "その他"] as const) {
      const v = valueLand(land({ landUse, condition: "irregular", method: multiplier() }));
      expect(v.value).toBe(0);
      expect(v.needsConsultation).toContain("宅地以外の土地");
      expect(v.needsConsultation).toContain("ことがあります");
      expect(v.needsConsultation).toContain("評価額を直接入力");
    }
  });
  it("倍率方式の案内は、宅地なら形を下げられるとは書かない（路線価方式は今までどおり）", () => {
    const m = conditionMessage("irregular", "multiplier");
    expect(m).toContain(MULTIPLIER_SHAPE_STEP);
    expect(m).toContain("「特になし」と同じ評価額");
    expect(m).not.toContain("下げられ");
    expect(m).not.toContain("税理士");
    expect(conditionMessage("irregular", "multiplier", { landUse: "宅地" })).toBe(m);
    const big = conditionMessage("irregular", "multiplier", { largeLotArea: 500 });
    expect(big).toContain(MULTIPLIER_SHAPE_STEP);
    expect(big).toContain("地積規模の大きな宅地");
    expect(conditionMessage("irregular", "multiplier", { landUse: "雑種地" })).toContain("宅地以外の土地");
    expect(conditionMessage("irregular", "rosenka")).toContain("形に合わせて評価を下げられます");
  });
  it("路線価方式の形がいびつな宅地は今までどおり相談（補正率を入れれば計算）", () => {
    expect(valueLand(land({ condition: "irregular", method: rosenka([{ edge: 0, price: 200_000, depth: 30 }]) })).needsConsultation).toContain("形がいびつ");
  });
});

describe("ui-3：自宅でも事業用でもないときの説明は、土地とマンションの部屋で変える", () => {
  const child: Person = { id: "c", name: "長男", relation: "child" };
  const no = { ownHome: "no", business: "no", familyHome: "no" } as const;
  it("マンションの部屋は「家賃をもらって人に貸している」のチェックへ案内し、土地だけの入力は書かない", () => {
    const j = judgeSmallResidential(no, child, "residence", { assetKind: "condo" });
    expect(j.result).toBe("no");
    expect(j.reason).toBe(
      "自宅でも、事業に使っていた部屋でもないため、特例は使えません。家賃をもらって人に貸している部屋は、「家賃をもらって人に貸している」にチェックを入れてください。",
    );
    expect(j.reason).not.toContain("土地の使い方");
    expect(j.reason).not.toContain("人の土地を借りて");
  });
  it("渡さないとき・土地のときは土地の説明（「土地の使い方」へ案内する短い文）", () => {
    expect(judgeSmallResidential(no, child).reason).toBe(NOT_HOME_OR_BUSINESS_REASON.land);
    expect(judgeSmallResidential(no, child, "residence", { assetKind: "land" }).reason).toBe(NOT_HOME_OR_BUSINESS_REASON.land);
    expect(NOT_HOME_OR_BUSINESS_REASON.land).toContain("「土地の使い方」");
    // 家族が無料で住んでいた土地は、先に別の質問で聞いている
    expect(NOT_HOME_OR_BUSINESS_REASON.land).not.toContain("家族が無料で住んでいた");
    expect(NOT_HOME_OR_BUSINESS_REASON.land).toContain("月極駐車場");
    // 前の文（約200字）より短くする
    expect(NOT_HOME_OR_BUSINESS_REASON.land.length).toBeLessThan(160);
  });
  it("ほかの判定は土地でも部屋でも同じ", () => {
    const spouse: Person = { id: "s", name: "妻", relation: "spouse" };
    const ok = { ownHome: "yes", special: "no" } as const;
    expect(judgeSmallResidential(ok, spouse, "residence", { assetKind: "condo" })).toEqual(judgeSmallResidential(ok, spouse));
    const rental = { continues: "yes", keep: "yes", recent: "no" } as const;
    expect(judgeSmallResidential(rental, child, "rental", { assetKind: "condo" })).toEqual(judgeSmallResidential(rental, child, "rental"));
  });
});
