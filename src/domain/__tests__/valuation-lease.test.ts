/**
 * 土地の使い方（貸家建付地・貸宅地・借地権）、貸家、貸しているマンションの評価（財産評価基本通達25・26・27・93）。
 * 数字はすべて手で計算したもの。
 */
import { describe, expect, it } from "vitest";
import { valueAsset, valueLand } from "../valuation";
import { LEASE_LETTERS, LEASE_RATIO_BY_LETTER, leaseLetterOf, leaseRatioOf } from "../valuation/lease";
import type { BuildingAsset, CondoAsset, LandAsset } from "../types";

const land = (p: Partial<LandAsset> = {}): LandAsset => ({
  id: "l",
  kind: "land",
  label: "アパートの土地",
  location: "東京都大田区",
  areaSqm: 165.5,
  landUse: "宅地",
  // 300,000円 × 0.97 = 291,000円/㎡ × 165.5㎡ = 48,160,500円（自用地）
  method: { type: "rosenka", routePrice: 300_000, depthCorrection: 0.97 },
  rosenkaSheet: { points: [], notation: "300D" },
  ...p,
});
const manual = (value: number, p: Partial<LandAsset> = {}) => land({ method: { type: "manual", value }, rosenkaSheet: undefined, ...p });

describe("借地権割合の記号（路線価図）", () => {
  it("A〜G は 90%〜30%", () => {
    expect(LEASE_LETTERS).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(LEASE_RATIO_BY_LETTER.A).toBe(0.9);
    expect(LEASE_RATIO_BY_LETTER.G).toBe(0.3);
  });
  it("表記の末尾の記号を読む（全角・カンマ・空白も可）", () => {
    expect(leaseLetterOf("420D")).toBe("D");
    expect(leaseRatioOf("420D")).toBe(0.6);
    expect(leaseLetterOf("１，２５０ Ｃ")).toBe("C");
    expect(leaseLetterOf("95e")).toBe("E");
    expect(leaseLetterOf("95")).toBeUndefined();
    expect(leaseLetterOf("420H")).toBeUndefined();
    expect(leaseLetterOf(undefined)).toBeUndefined();
  });
});

describe("自用地（使い方が未設定・自分で使っている）", () => {
  it("今までどおりの評価額で、利用区分は自用地", () => {
    for (const use of [undefined, "self" as const]) {
      const v = valueLand(land({ use }));
      expect(v.value).toBe(48_160_500);
      expect(v.usage).toBe("自用地");
      expect(v.selfUseValue).toBeUndefined();
      expect(v.leaseRatio).toBeUndefined();
    }
  });
});

describe("貸家建付地：自用地 ×（1 − 借地権割合 × 0.3 × 賃貸割合）", () => {
  it("路線価図の記号 D（60%）・全部貸している：48,160,500 × 0.82 = 39,491,610円", () => {
    const v = valueLand(land({ use: "rentedHouse" }));
    expect(v.needsConsultation).toBeUndefined();
    expect(v.value).toBe(39_491_610);
    expect(v.selfUseValue).toBe(48_160_500);
    expect(v.usage).toBe("貸家建付地");
    expect(v.leaseRatio).toBe(0.6);
    expect(v.unitPrice).toBe(291_000); // 単価は自用地としての1㎡当たりの価額
    expect(v.steps.at(-1)).toContain("借地権割合 0.6");
    expect(v.steps.at(-1)).toContain("賃貸割合 1");
    expect(v.steps.at(-1)).toContain("39,491,610円");
  });
  it("賃貸割合0.85：48,160,500 × 0.847 = 40,791,943.5 → 40,791,943円（最後に1円未満切捨て）", () => {
    expect(valueLand(land({ use: "rentedHouse", rentRatio: 0.85 })).value).toBe(40_791_943);
  });
  it("浮動小数点の誤差で1円少なくならない：10,000,000 ×（1 − 0.7 × 0.3 × 0.9）= 8,110,000円", () => {
    expect(valueLand(manual(10_000_000, { use: "rentedHouse", leaseRatio: 0.7, rentRatio: 0.9 })).value).toBe(8_110_000);
  });
  it("賃貸割合が0以下・1を超える・数でないときは確定しない", () => {
    for (const rentRatio of [0, -0.5, 1.01, Number.NaN]) {
      const v = valueLand(land({ use: "rentedHouse", rentRatio }));
      expect(v.value).toBe(0);
      expect(v.needsConsultation).toContain("賃貸割合");
    }
  });
  it("2つの道路に面する土地は、正面の道路の記号を使う（側方の記号は使わない）", () => {
    // 正面 300,000 + 側方 200,000 × 0.03 = 306,000円/㎡ × 200㎡ = 61,200,000円。正面は C（70%）
    const v = valueLand(
      land({
        areaSqm: 200,
        use: "rentedHouse",
        rosenkaSheet: undefined,
        method: {
          type: "rosenka",
          routePrice: 0,
          depthCorrection: 1,
          roads: [
            { edge: 0, price: 300_000, depth: 20, notation: "300C" },
            { edge: 1, price: 200_000, depth: 10, notation: "200D" },
          ],
        },
      }),
    );
    expect(v.selfUseValue).toBe(61_200_000);
    expect(v.leaseRatio).toBe(0.7);
    // 61,200,000 × (1 − 0.21) = 48,348,000
    expect(v.value).toBe(48_348_000);
  });
});

describe("貸宅地：自用地 ×（1 − 借地権割合）", () => {
  it("記号 D：48,160,500 × 0.4 = 19,264,200円", () => {
    const v = valueLand(land({ use: "leasedLand" }));
    expect(v.value).toBe(19_264_200);
    expect(v.usage).toBe("貸宅地");
    expect(v.selfUseValue).toBe(48_160_500);
  });
  it("12,345,679 × 0.3 = 3,703,703.7 → 3,703,703円", () => {
    expect(valueLand(manual(12_345_679, { use: "leasedLand", leaseRatio: 0.7 })).value).toBe(3_703_703);
  });
  it("浮動小数点の誤差なし：1,000,000 ×（1 − 0.9）= 100,000円", () => {
    expect(valueLand(manual(1_000_000, { use: "leasedLand", leaseRatio: 0.9 })).value).toBe(100_000);
  });
  it("賃貸割合は使わない（入っていても無視）", () => {
    expect(valueLand(land({ use: "leasedLand", rentRatio: 0 })).value).toBe(19_264_200);
  });
});

describe("借地権：自用地 × 借地権割合", () => {
  it("記号 D：48,160,500 × 0.6 = 28,896,300円", () => {
    const v = valueLand(land({ use: "leasehold" }));
    expect(v.value).toBe(28_896_300);
    expect(v.usage).toBe("借地権");
  });
  it("12,345,679 × 0.7 = 8,641,975.3 → 8,641,975円", () => {
    expect(valueLand(manual(12_345_679, { use: "leasehold", leaseRatio: 0.7 })).value).toBe(8_641_975);
  });
});

describe("借地権割合の決め方", () => {
  it("道路が1つの入力では、路線価図の表記（rosenkaSheet.notation）から", () => {
    const v = valueLand(land({ use: "leasedLand", rosenkaSheet: { points: [], notation: "300E" } }));
    expect(v.leaseRatio).toBe(0.5);
    expect(v.value).toBe(24_080_250); // 48,160,500 × 0.5
  });
  it("入力した借地権割合は記号より優先する。0 や空欄は未入力として記号を使う", () => {
    expect(valueLand(land({ use: "leasedLand", leaseRatio: 0.7 })).value).toBe(14_448_150); // × 0.3
    expect(valueLand(land({ use: "leasedLand", leaseRatio: 0 })).leaseRatio).toBe(0.6);
  });
  it("倍率方式は入力した借地権割合（評価倍率表）を使う：11,000,000 ×（1 − 0.5 × 0.3 × 0.8）= 9,680,000円", () => {
    const v = valueLand(
      land({ use: "rentedHouse", leaseRatio: 0.5, rentRatio: 0.8, rosenkaSheet: undefined, method: { type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1 } }),
    );
    expect(v.selfUseValue).toBe(11_000_000);
    expect(v.value).toBe(9_680_000);
    expect(v.multiplier).toBe(1.1);
  });
  it("借地権割合が分からなければ確定せず、土地の画面で選ぶよう案内する", () => {
    const cases = [
      land({ use: "rentedHouse", rosenkaSheet: undefined }),
      land({ use: "leasedLand", rosenkaSheet: { points: [], notation: "300" } }),
      land({ use: "leasehold", rosenkaSheet: undefined, method: { type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1 } }),
      manual(5_000_000, { use: "leasedLand" }),
    ];
    for (const a of cases) {
      const v = valueLand(a);
      expect(v.value).toBe(0);
      expect(v.needsConsultation).toContain("借地権割合");
      expect(v.needsConsultation).toContain("土地の画面");
      expect(v.needsConsultation).toContain("A");
    }
  });
  it("借地権割合が0より大きく1未満でなければ確定しない", () => {
    for (const leaseRatio of [1, 1.2, 60]) {
      const v = valueLand(land({ use: "leasehold", leaseRatio }));
      expect(v.value).toBe(0);
      expect(v.needsConsultation).toContain("借地権割合が正しくありません");
    }
  });
  it("自分で使っている土地では借地権割合がなくても評価できる", () => {
    expect(valueLand(land({ rosenkaSheet: undefined })).needsConsultation).toBeUndefined();
  });
  it("誰でも通り抜けできる私道は、使い方にかかわらず0円", () => {
    const v = valueLand(land({ use: "leasedLand", method: { type: "manual", value: 0, publicPrivateRoad: true } }));
    expect(v.value).toBe(0);
    expect(v.needsConsultation).toBeUndefined();
  });
  it("自用地の評価に必要な入力がないときは、その案内を先に出す", () => {
    const v = valueLand(land({ use: "rentedHouse", method: { type: "rosenka", routePrice: 0, depthCorrection: 0 } }));
    expect(v.needsConsultation).toContain("路線価と奥行価格補正率が未入力");
  });
});

describe("貸家：固定資産税評価額 ×（1 − 0.3 × 賃貸割合）", () => {
  const b = (p: Partial<BuildingAsset> = {}): BuildingAsset => ({ id: "b", kind: "building", label: "アパート", location: "x", fixedAssetValue: 10_000_000, ...p });
  it("自分で使っている家屋は固定資産税評価額のまま（自用家屋）", () => {
    const v = valueAsset(b());
    expect(v.value).toBe(10_000_000);
    expect(v.usage).toBe("自用家屋");
    expect(v.selfUseValue).toBeUndefined();
  });
  it("全部貸している：10,000,000 × 0.7 = 7,000,000円", () => {
    const v = valueAsset(b({ rented: true }));
    expect(v.value).toBe(7_000_000);
    expect(v.usage).toBe("貸家");
    expect(v.selfUseValue).toBe(10_000_000);
    expect(v.steps.at(-1)).toContain("借家権割合 0.3");
  });
  it("賃貸割合0.75：10,000,000 × 0.775 = 7,750,000円", () => {
    expect(valueAsset(b({ rented: true, rentRatio: 0.75 })).value).toBe(7_750_000);
  });
  it("1,234,567 × 0.73 = 901,233.91 → 901,233円", () => {
    expect(valueAsset(b({ rented: true, rentRatio: 0.9, fixedAssetValue: 1_234_567 })).value).toBe(901_233);
  });
  it("浮動小数点の誤差なし：10,000,000 ×（1 − 0.3 × 0.65）= 8,050,000円", () => {
    expect(valueAsset(b({ rented: true, rentRatio: 0.65 })).value).toBe(8_050_000);
  });
  it("賃貸割合が正しくなければ確定しない", () => {
    for (const rentRatio of [0, 1.5]) expect(valueAsset(b({ rented: true, rentRatio })).needsConsultation).toContain("賃貸割合");
  });
  it("貸していなければ賃貸割合は見ない", () => {
    expect(valueAsset(b({ rentRatio: 0 })).value).toBe(10_000_000);
  });
});

describe("人に貸しているマンションの部屋（区分所有補正のあと、部屋は貸家・敷地は貸家建付地）", () => {
  // 国税庁タックスアンサーNo.4667の例：区分所有補正率1.2258 → 敷地利用権12,870,900円・区分所有権4,903,200円
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
  };
  it("全部貸している・借地権割合0.6：敷地 12,870,900 × 0.82 = 10,554,138円、部屋 4,903,200 × 0.7 = 3,432,240円", () => {
    const v = valueAsset({ ...base, rented: true, leaseRatio: 0.6 });
    expect(v.needsConsultation).toBeUndefined();
    expect(v.value).toBe(10_554_138 + 3_432_240);
    expect(v.selfUseValue).toBe(12_870_900 + 4_903_200);
    expect(v.leaseRatio).toBe(0.6);
  });
  it("賃貸割合0.9・借地権割合0.7：敷地 12,870,900 × 0.811 = 10,438,299.9 → 10,438,299円、部屋 4,903,200 × 0.73 = 3,579,336円", () => {
    expect(valueAsset({ ...base, rented: true, rentRatio: 0.9, leaseRatio: 0.7 }).value).toBe(10_438_299 + 3_579_336);
  });
  it("部屋の評価額を0にして呼ぶと、敷地利用権（貸家建付地）の部分だけを返す（小規模宅地等の特例の計算用）", () => {
    const v = valueAsset({ ...base, rented: true, rentRatio: 0.9, leaseRatio: 0.7, buildingFixedAssetValue: 0 });
    expect(v.value).toBe(10_438_299);
  });
  it("貸している部屋で借地権割合がなければ確定しない", () => {
    const v = valueAsset({ ...base, rented: true });
    expect(v.value).toBe(0);
    expect(v.needsConsultation).toContain("借地権割合");
    expect(valueAsset({ ...base, rented: true, leaseRatio: 1 }).needsConsultation).toContain("借地権割合が正しくありません");
    expect(valueAsset({ ...base, rented: true, leaseRatio: 0.6, rentRatio: 0 }).needsConsultation).toContain("賃貸割合");
  });
  it("貸していない部屋は今までどおり", () => {
    expect(valueAsset({ ...base, leaseRatio: 0.6 }).value).toBe(12_870_900 + 4_903_200);
  });
});
