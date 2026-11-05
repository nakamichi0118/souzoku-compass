/**
 * レビューで見つかった評価の問題の修正（不整形地と間口狭小・奥行長大、正面路線の同額、賃貸割合の案内、
 * 修正した補正率 1、評価方法ごとの案内、配偶者居住権、貸家建付借地権、貸している部分の評価額 など）。
 * 数字はすべて手で計算したもの。
 */
import { describe, expect, it } from "vitest";
import { ADVISOR_HINT_RATE, SELF_USE_VALUE_NOTE, advisorHintValue, conditionMessage, pendingReductions, reductionAdvice, valueAsset, valueLand } from "../valuation";
import {
  RENT_RATIO_HINT,
  RENT_RATIO_MESSAGE,
  rentedHouseLandPart,
  rentedLeaseholdPart,
  rentedLeaseholdRight,
} from "../valuation/lease";
import { type RoadInput, evaluateRoads } from "../valuation/roads";
import { RENTAL_RENT_NOTE, judgeSmallResidential, smallLandKind } from "../valuation/smallResidential";
import type { CondoAsset, LandAsset, Person } from "../types";

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
const manual = (value: number, p: Partial<LandAsset> = {}) => land({ method: { type: "manual", value }, ...p });
const narrowRoad: RoadInput[] = [{ edge: 0, price: 200_000, depth: 30, frontage: 5 }];
const rosenka = (otherCorrection: number | undefined, roads: RoadInput[] = narrowRoad): LandAsset["method"] => ({
  type: "rosenka",
  routePrice: 0,
  depthCorrection: 1,
  district: "普通住宅地区",
  otherCorrection,
  roads,
});

describe("不整形地は間口狭小・奥行長大の補正をせず、税理士に確認した不整形地補正率だけを掛ける（通達20-4・付表5（注）3）", () => {
  it("200,000 × 奥行30m 0.95 = 190,000円 × 不整形地補正率 0.81 = 153,900円/㎡ × 150㎡ = 23,085,000円", () => {
    const v = valueLand(land({ condition: "irregular", method: rosenka(0.81) }));
    expect(v.needsConsultation).toBeUndefined();
    expect(v.unitPrice).toBe(153_900);
    expect(v.value).toBe(23_085_000);
    expect(v.steps.some((s) => s.includes("間口狭小補正率"))).toBe(false);
    expect(v.steps.some((s) => s.includes("不整形地") && s.includes("20-4"))).toBe(true);
  });
  it("セットバック・事情なしで補正率を入れたときは、今までどおり間口狭小 0.94 × 奥行長大 0.90 のあとに掛ける（160,740 × 0.81 = 130,199円/㎡）", () => {
    for (const condition of ["setback", undefined] as const) {
      const v = valueLand(land({ condition, method: rosenka(0.81) }));
      expect(v.unitPrice).toBe(130_199);
      expect(v.value).toBe(19_529_850);
      expect(v.steps.some((s) => s.includes("間口狭小補正率 0.94"))).toBe(true);
    }
  });
  it("広い宅地（地積規模の大きな宅地）で補正率を入れたときも、間口狭小・奥行長大はする（160,740 × 0.8 = 128,592円/㎡ × 600㎡）", () => {
    const v = valueLand(land({ location: "千葉県船橋市", areaSqm: 600, method: rosenka(0.8) }));
    expect(v.needsConsultation).toBeUndefined();
    expect(v.unitPrice).toBe(128_592);
    expect(v.value).toBe(77_155_200);
  });
  it("不整形地で「減額なし」と確認した 1 なら、間口狭小・奥行長大はふつうどおりする（160,740円/㎡。review3 valuation-1）", () => {
    const v = valueLand(land({ condition: "irregular", method: rosenka(1) }));
    expect(v.unitPrice).toBe(160_740);
    expect(v.value).toBe(24_111_000);
  });
  it("側方の道路の加算はする：300,000 + 200,000 × 0.03 = 306,000円 × 0.9 = 275,400円/㎡ × 140㎡", () => {
    const roads = [
      { edge: 0 as const, price: 300_000, depth: 20, frontage: 7 },
      { edge: 1 as const, price: 200_000, depth: 10 },
    ];
    const v = valueLand(land({ areaSqm: 140, condition: "irregular", method: rosenka(0.9, roads) }));
    expect(v.unitPrice).toBe(275_400);
    expect(v.value).toBe(38_556_000);
  });
  it("evaluateRoads の irregular を指定すると、間口があっても補正前の価額を返す", () => {
    const r = evaluateRoads("普通住宅地区", narrowRoad, { irregular: true })!;
    expect(r.perSqm).toBe(190_000);
    expect(r.basePerSqm).toBe(190_000);
    expect(r.frontageRate).toBeUndefined();
    expect(evaluateRoads("普通住宅地区", narrowRoad)!.perSqm).toBe(160_740);
  });
});

describe("正面路線：奥行価格補正後の価額が同じなら間口の長い方（質疑応答「正面路線の判定(1)」）", () => {
  // 15m × 30m の角地。A：30mの辺、奥行15m（1.00）→ 190,000円。B：15mの辺、奥行30m（0.95）→ 190,000円
  const A = { edge: 0 as const, price: 190_000, depth: 15, frontage: 30, notation: "190C" };
  const B = { edge: 1 as const, price: 200_000, depth: 30, frontage: 15, notation: "200D" };
  it("路線価の高い B ではなく、間口の長い A が正面（入力の順番によらない）", () => {
    for (const order of [
      [A, B],
      [B, A],
    ]) {
      const r = evaluateRoads("普通住宅地区", order)!;
      expect(r.front.edge).toBe(0);
      expect(r.front.notation).toBe("190C");
      // 190,000 + 190,000 × 0.03 = 195,700円。A は間口30m・奥行15mで間口狭小・奥行長大とも1.00
      expect(r.perSqm).toBe(195_700);
    }
  });
  it("路線価も同じなら間口の長い方（入力の順番によらない）", () => {
    const C = { edge: 0 as const, price: 200_000, depth: 10, frontage: 22 };
    const D = { edge: 1 as const, price: 200_000, depth: 22, frontage: 10 };
    for (const order of [
      [C, D],
      [D, C],
    ]) {
      const r = evaluateRoads("普通住宅地区", order)!;
      expect(r.front.edge).toBe(0);
      expect(r.perSqm).toBe(206_000);
    }
  });
  it("間口が分からなければ路線価の高い方、それも同じなら先に入力した方", () => {
    const E = { edge: 0 as const, price: 190_000, depth: 15 };
    const F = { edge: 1 as const, price: 200_000, depth: 30 };
    for (const order of [
      [E, F],
      [F, E],
    ]) expect(evaluateRoads("普通住宅地区", order)!.front.edge).toBe(1);
    // 片方だけ間口が分かるときも路線価で決める
    expect(evaluateRoads("普通住宅地区", [{ ...E, frontage: 30 }, F])!.front.edge).toBe(1);
    const G = { edge: 0 as const, price: 200_000, depth: 15 };
    const H = { edge: 1 as const, price: 200_000, depth: 15 };
    expect(evaluateRoads("普通住宅地区", [G, H])!.front.edge).toBe(0);
    expect(evaluateRoads("普通住宅地区", [H, G])!.front.edge).toBe(1);
  });
  it("価額が違えば今までどおり高い方（間口の長さは見ない）", () => {
    const r = evaluateRoads("普通住宅地区", [
      { edge: 0, price: 300_000, depth: 20, frontage: 5 },
      { edge: 1, price: 200_000, depth: 10, frontage: 30 },
    ])!;
    expect(r.front.edge).toBe(0);
  });
});

describe("賃貸割合の案内は % で書き、一時的な空室と分母の床面積を説明する", () => {
  it("% の欄に合わせて「0%より大きく100%以下」「全部貸していれば100%」", () => {
    expect(RENT_RATIO_MESSAGE).toContain("0%より大きく100%以下");
    expect(RENT_RATIO_MESSAGE).toContain("全部貸していれば100%");
    expect(RENT_RATIO_MESSAGE).not.toMatch(/1以下の数|貸していれば1）/);
    expect(RENT_RATIO_MESSAGE).toContain("貸している部屋の床面積 ÷ 貸せる部屋全部の床面積");
  });
  it("一時的に空いている部屋は貸しているものとして数え、廊下・階段などは床面積に入れない（通達26）", () => {
    for (const s of [RENT_RATIO_HINT, RENT_RATIO_MESSAGE]) {
      expect(s).toContain("一時的に空いている部屋は、貸しているものとして数えます");
      expect(s).toContain("廊下・階段");
    }
  });
  it("貸家建付地・貸家・マンションの部屋の案内で使う", () => {
    expect(valueLand(manual(10_000_000, { use: "rentedHouse", leaseRatio: 0.6, rentRatio: 0 })).needsConsultation).toContain("0%より大きく100%以下");
    expect(valueAsset({ id: "b", kind: "building", label: "b", location: "x", fixedAssetValue: 1_000_000, rented: true, rentRatio: 1.2 }).needsConsultation).toContain(
      "0%より大きく100%以下",
    );
  });
});

describe("形がいびつ・セットバックで地積規模の大きな宅地にもあたりうるときは、止めずに両方の減額をしていないと書く", () => {
  const big = (p: Partial<LandAsset>) => land({ location: "千葉県船橋市", areaSqm: 600, ...p });
  const notes = (v: ReturnType<typeof valueLand>) => v.steps.filter((x) => x.includes("していません"));
  it("路線価方式：両方の減額をしていないと書き、相談するかは本人が選ぶ（止めない）", () => {
    const a = big({ condition: "irregular", method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1 } });
    const v = valueLand(a);
    expect(v.needsConsultation).toBeUndefined();
    expect(v.value).toBe(120_000_000);
    expect(pendingReductions(a)).toEqual(["irregular", "largeLot"]);
    expect(notes(v).join()).toContain("不整形地");
    expect(notes(v).join()).toContain("地積規模の大きな宅地");
    expect(pendingReductions(big({ condition: "setback", method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1 } }))).toEqual(["setback", "largeLot"]);
    // 相談するときの案内は、両方の補正を含めた補正率を確認するよう書く
    const adv = reductionAdvice(a);
    expect(adv).toContain("規模格差補正率");
    expect(adv).toContain("補正率を修正");
  });
  it("倍率方式：セットバックと広い宅地の減額をしていないと書く（形がいびつは倍率方式の宅地では補正しない）", () => {
    expect(pendingReductions(big({ condition: "setback", method: { type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1 } }))).toEqual(["setback", "largeLot"]);
    expect(pendingReductions(big({ condition: "irregular", method: { type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1 } }))).toEqual(["largeLot"]);
  });
  it("広くなければ、地積規模の大きな宅地のことは書かない", () => {
    const v = valueLand(land({ condition: "irregular", method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1 } }));
    expect(notes(v).join()).toContain("不整形地");
    expect(notes(v).join()).not.toContain("地積規模");
  });
  it("補正率を入れたら計算し、その率に規模格差補正率も含めたものとして使うと説明する（200,000 × 0.8 × 600㎡）", () => {
    const v = valueLand(big({ condition: "irregular", method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1, otherCorrection: 0.8 } }));
    expect(v.value).toBe(96_000_000);
    expect(v.steps.some((s) => s.includes("規模格差補正率"))).toBe(true);
    // 広くない土地では書かない
    expect(valueLand(land({ condition: "irregular", method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1, otherCorrection: 0.8 } })).steps.some((s) => s.includes("規模格差"))).toBe(false);
  });
});

describe("税理士に確認した値の入れ方は評価方法で変える", () => {
  it("路線価方式は「補正率を修正」、倍率方式・直接入力は評価額の直接入力", () => {
    for (const c of ["irregular", "setback"] as const) {
      expect(conditionMessage(c, "rosenka")).toContain(ADVISOR_HINT_RATE);
      for (const m of ["multiplier", "manual"] as const) {
        // 倍率方式の宅地で形がいびつなときは補正しないので、入れ方の案内はしない（review3 valuation-2）
        const landUse = c === "irregular" && m === "multiplier" ? ("雑種地" as const) : undefined;
        expect(conditionMessage(c, m, { landUse })).toContain("評価額を直接入力");
        expect(conditionMessage(c, m, { landUse })).not.toContain("「補正率を修正」");
      }
    }
    // 宅地以外の倍率方式で形がいびつなら、止めずに減額していないと書く（入れ方の案内は土地の画面の「相談する」で出す）
    expect(pendingReductions(land({ condition: "irregular", landUse: "雑種地", method: { type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1 } }))).toEqual(["irregular"]);
  });
  it("補正率の案内は、減額なしなら 1 を入れることも書く", () => {
    expect(ADVISOR_HINT_RATE).toContain("1 を入れて");
  });
  it("配偶者居住権は評価方法にかかわらず同じ短い案内", () => {
    expect(conditionMessage("spouseResidence", "rosenka")).toBe(conditionMessage("spouseResidence", "manual"));
    expect(conditionMessage("spouseResidence", "rosenka")).toContain("税理士にご相談ください");
  });
});

describe("人に貸している・借りている土地の直接入力は、自用地としての評価額を入れる", () => {
  it("案内に、自分で使っているとした場合の評価額を入れることを書く（自分で使っている土地では書かない）", () => {
    expect(advisorHintValue("rentedHouse")).toContain(SELF_USE_VALUE_NOTE);
    expect(advisorHintValue("leasehold")).toContain("自用地としての評価額");
    expect(advisorHintValue("self")).not.toContain("自用地");
    expect(advisorHintValue(undefined)).not.toContain("自用地");
    // 「相談する」を選んだときの案内（reductionAdvice）に書く
    expect(reductionAdvice(land({ condition: "irregular", landUse: "雑種地", use: "rentedHouse", leaseRatio: 0.6, method: { type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1 } }))).toContain(
      "自用地としての評価額",
    );
    const big = reductionAdvice(land({ location: "北海道札幌市", areaSqm: 1200, use: "rentedHouse", leaseRatio: 0.3, method: { type: "multiplier", fixedAssetValue: 30_000_000, multiplier: 1.1 } }));
    expect(big).toContain("地積規模");
    expect(big).toContain("自用地としての評価額");
  });
  it("直接入力が未入力のときの案内と、評価の説明にも書く", () => {
    expect(valueLand(manual(0, { use: "leasedLand", leaseRatio: 0.6 })).needsConsultation).toContain("自用地としての評価額");
    expect(valueLand(manual(0)).needsConsultation).not.toContain("自用地");
    const v = valueLand(manual(10_000_000, { use: "leasedLand", leaseRatio: 0.6 }));
    expect(v.steps[0]).toContain("自用地としての評価額");
    expect(v.value).toBe(4_000_000);
    expect(valueLand(manual(10_000_000)).steps[0]).toBe("評価額を直接入力");
  });
});

describe("貸家建付借地権：自用地 × 借地権割合 ×（1 − 0.3 × 賃貸割合）（通達28）", () => {
  it("自用地 50,000,000円・借地権割合 0.6・全部貸している：50,000,000 × 0.6 × 0.7 = 21,000,000円", () => {
    const v = valueLand(manual(50_000_000, { use: "rentedLeasehold", leaseRatio: 0.6 }));
    expect(v.needsConsultation).toBeUndefined();
    expect(v.value).toBe(21_000_000);
    expect(v.usage).toBe("貸家建付借地権");
    expect(v.selfUseValue).toBe(50_000_000);
    expect(v.leaseRatio).toBe(0.6);
    expect(v.rentedLandPart).toBeUndefined();
    expect(v.steps.at(-1)).toContain("貸家建付借地権");
    expect(v.steps.at(-1)).toContain("21,000,000円");
  });
  it("賃貸割合0.9：50,000,000 × 0.6 × 0.73 = 21,900,000円", () => {
    expect(valueLand(manual(50_000_000, { use: "rentedLeasehold", leaseRatio: 0.6, rentRatio: 0.9 })).value).toBe(21_900_000);
  });
  it("借地権の価額で切り捨てず、最後に1回だけ1円未満を切り捨てる：1,000,002 × 0.7 × 0.745 = 521,501.043 → 521,501円", () => {
    // 先に借地権 700,001.4 → 700,001円 と切り捨てると 521,500円 になる
    expect(rentedLeaseholdRight(1_000_002, 7000, 8500)).toBe(521_501);
    // 路線価図の記号 D（60%）から：48,160,500 × 0.6 × 0.7 = 20,227,410円
    const v = valueLand(
      land({ areaSqm: 165.5, use: "rentedLeasehold", method: { type: "rosenka", routePrice: 300_000, depthCorrection: 0.97 }, rosenkaSheet: { points: [], notation: "300D" } }),
    );
    expect(v.leaseRatio).toBe(0.6);
    expect(v.value).toBe(20_227_410);
  });
  it("借地権割合は借地権と同じく必要（未入力・正しくない値は確定しない）", () => {
    const missing = valueLand(manual(50_000_000, { use: "rentedLeasehold" }));
    expect(missing.value).toBe(0);
    expect(missing.needsConsultation).toContain("借地権割合が分かりません");
    for (const leaseRatio of [1, 1.2, 60]) expect(valueLand(manual(50_000_000, { use: "rentedLeasehold", leaseRatio })).needsConsultation).toContain("借地権割合が正しくありません");
  });
  it("賃貸割合は貸家建付地と同じく確かめ、まったく貸していなければ借地権を選ぶよう案内する", () => {
    for (const rentRatio of [0, -0.5, 1.01, Number.NaN]) {
      const v = valueLand(manual(50_000_000, { use: "rentedLeasehold", leaseRatio: 0.6, rentRatio }));
      expect(v.value).toBe(0);
      expect(v.needsConsultation).toContain("0%より大きく100%以下");
      expect(v.needsConsultation).toContain("借地権）");
    }
  });
  it("小規模宅地等の特例は貸付事業用", () => {
    expect(smallLandKind({ kind: "land", use: "rentedLeasehold" })).toBe("rental");
    expect(smallLandKind({ kind: "land", use: "leasehold" })).toBe("residence");
  });
});

describe("貸付事業用の対象になる、貸している部分の評価額（rentedLandPart。賃貸割合が1未満のときだけ）", () => {
  it("国税庁の例：自用地 40,000,000円・借地権割合 0.7・賃貸割合 0.9 → 貸している部分 40,000,000 × 0.9 × (1 − 0.21) = 28,440,000円", () => {
    const v = valueLand(manual(40_000_000, { use: "rentedHouse", leaseRatio: 0.7, rentRatio: 0.9 }));
    expect(v.value).toBe(32_440_000); // 40,000,000 × (1 − 0.7 × 0.3 × 0.9)
    expect(v.rentedLandPart).toBe(28_440_000);
    expect(rentedHouseLandPart(40_000_000, 7000, 9000)).toBe(28_440_000);
  });
  it("全部貸していれば設定しない", () => {
    expect(valueLand(manual(40_000_000, { use: "rentedHouse", leaseRatio: 0.7 })).rentedLandPart).toBeUndefined();
    expect(valueLand(manual(40_000_000, { use: "rentedHouse", leaseRatio: 0.7, rentRatio: 1 })).rentedLandPart).toBeUndefined();
  });
  it("貸家建付借地権：50,000,000 × 0.6 × 0.9 × 0.7 = 18,900,000円", () => {
    expect(valueLand(manual(50_000_000, { use: "rentedLeasehold", leaseRatio: 0.6, rentRatio: 0.9 })).rentedLandPart).toBe(18_900_000);
    expect(rentedLeaseholdPart(50_000_000, 6000, 9000)).toBe(18_900_000);
  });
  it("最後に1回だけ1円未満を切り捨てる：12,345,679 × 0.85 × (1 − 0.18) = 8,604,938.263 → 8,604,938円", () => {
    expect(valueLand(manual(12_345_679, { use: "rentedHouse", leaseRatio: 0.6, rentRatio: 0.85 })).rentedLandPart).toBe(8_604_938);
  });
  it("貸宅地・借地権・自用地では設定しない（賃貸割合が入っていても）", () => {
    for (const use of ["leasedLand", "leasehold", "self"] as const) expect(valueLand(manual(40_000_000, { use, leaseRatio: 0.7, rentRatio: 0.5 })).rentedLandPart).toBeUndefined();
  });
  it("マンション：区分所有補正後の敷地利用権 12,870,900円（部屋の分は除く）× 0.9 × (1 − 0.21) = 9,151,209.9 → 9,151,209円", () => {
    const base: CondoAsset = {
      id: "m",
      kind: "condo",
      label: "マンション",
      location: "東京都",
      landValueBeforeCorrection: 10_500_000,
      buildingFixedAssetValue: 4_000_000,
      builtYearsMonths: { years: 27, months: 0 },
      totalFloors: 11,
      floor: 3,
      landShareSqm: 21,
      exclusiveAreaSqm: 60,
      rented: true,
      leaseRatio: 0.7,
    };
    expect(valueAsset({ ...base, rentRatio: 0.9 }).rentedLandPart).toBe(9_151_209);
    expect(valueAsset({ ...base, rentRatio: 0.9, buildingFixedAssetValue: 0 }).rentedLandPart).toBe(9_151_209);
    expect(valueAsset(base).rentedLandPart).toBeUndefined();
    expect(valueAsset({ ...base, rented: false, rentRatio: 0.9 }).rentedLandPart).toBeUndefined();
  });
});

describe("小規模宅地等の案内：貸付事業用は家賃・地代をもらっているときだけ、借りた土地のアパートは新しい選択肢へ", () => {
  const child: Person = { id: "c", name: "長男", relation: "child" };
  it("自宅でも事業用でもない土地の案内は、借りた土地のアパートも「土地の使い方」の貸している使い方へ案内する", () => {
    const j = judgeSmallResidential({ ownHome: "no", business: "no", familyHome: "no" }, child);
    expect(j.result).toBe("no");
    expect(j.reason).toContain("人の土地を借りて建てたアパート・貸家");
    expect(j.reason).toContain("「土地の使い方」で貸している使い方を選んで");
    expect(j.reason).not.toContain("「貸している」を選んで");
    expect(j.reason).toContain("家賃・地代をもらって");
    // 家族が無料で住んでいた土地は、先に別の質問で聞いている
    expect(j.reason).not.toContain("家族が無料で住んでいた");
  });
  it("貸付事業用が使えるときの説明に、相場どおりの家賃・地代が要ることを書く", () => {
    const j = judgeSmallResidential({ continues: "yes", keep: "yes", recent: "no" }, child, "rental");
    expect(j.result).toBe("ok");
    expect(j.reason).toContain("相場どおり");
  });
  it("無料で貸している土地は「自分で使っている」になることの説明（画面の Tips 用）", () => {
    expect(RENTAL_RENT_NOTE).toContain("家賃・地代を相場どおりにもらって");
    expect(RENTAL_RENT_NOTE).toContain("無料");
    expect(RENTAL_RENT_NOTE).toContain("「自分で使っている」");
  });
});
