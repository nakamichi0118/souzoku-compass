import { describe, expect, it } from "vitest";
import { condoCorrection, perSqmTimesArea, smallResidentialReduction, valueAsset, valueLand } from "../valuation";
import { depthCorrection } from "../valuation/depth";
import { parseRouteNotation } from "../valuation/rosenka";
import type { CondoAsset, LandAsset, ListedStockAsset } from "../types";

describe("区分所有補正率（国税庁タックスアンサーNo.4667の計算例）", () => {
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
  it("A=△0.891 B=0.079 C=0.054 D=△0.419 評価乖離率2.043 補正率1.2258", () => {
    const c = condoCorrection(base);
    expect([c.A, c.B, c.C, c.D, c.ratio, c.correction]).toEqual([-891, 79, 54, -419, 2043, 12258]);
  });
  it("区分所有権4,903,200円・敷地利用権12,870,900円", () => {
    expect(valueAsset(base).value).toBe(4_903_200 + 12_870_900);
  });
  it("築年数の1年未満は1年に切上げ", () => {
    expect(condoCorrection({ ...base, builtYearsMonths: { years: 26, months: 1 } }).years).toBe(27);
  });
  it("評価水準が0.6以上1以下なら補正しない", () => {
    // 築35年・5階建て1階・敷地持分狭小度0.5 → 乖離率1.521
    const c = condoCorrection({ ...base, builtYearsMonths: { years: 35, months: 0 }, totalFloors: 5, floor: 1, landShareSqm: 30 });
    expect(c.ratio).toBe(1521);
    expect(c.ratio).toBeLessThanOrEqual(1666);
    expect(c.correction).toBe(10000);
  });
  it("所在階が総階数より上・築年数の月が12以上のときは評価しない", () => {
    expect(valueAsset({ ...base, totalFloors: 11, floor: 12 }).needsConsultation).toContain("所在階（12階）が建物の総階数（11階）より上");
    expect(valueAsset({ ...base, builtYearsMonths: { years: 26, months: 12 } }).needsConsultation).toContain("築年数の月");
  });

  it("地階を除く階数が2以下の建物は区分所有補正をしない", () => {
    const v = valueAsset({ ...base, totalFloors: 2, floor: 2 });
    expect(v.needsConsultation).toBeUndefined();
    expect(v.value).toBe(10_500_000 + 4_000_000);
    expect(v.steps[0]).toContain("地階を除く階数が2以下");
  });
  it("住まい用の部屋が3室以下で、すべて持ち主・親族の住まいなら区分所有補正をしない", () => {
    const v = valueAsset({ ...base, fewUnitsFamily: true });
    expect(v.value).toBe(10_500_000 + 4_000_000);
    expect(v.steps[0]).toContain("3室以下");
  });
  it("補正の対象外でも、敷地利用権の評価額と面積は必要", () => {
    expect(valueAsset({ ...base, totalFloors: 2, landShareSqm: 0 }).needsConsultation).toContain("敷地利用権の面積");
  });
  it("専有面積・総階数・所在階が未入力（0）なら確定しない", () => {
    for (const p of [{ exclusiveAreaSqm: 0 }, { totalFloors: 0 }, { floor: 0 }]) {
      const v = valueAsset({ ...base, ...p });
      expect(v.value).toBe(0);
      expect(v.needsConsultation).toBeTruthy();
    }
    expect(valueAsset({ ...base, floor: 0 }).needsConsultation).toContain("所在階");
  });
  it("部屋（家屋）の固定資産税評価額が0なら確定しない（敷地利用権の部分の金額は返す）", () => {
    const v = valueAsset({ ...base, buildingFixedAssetValue: 0 });
    expect(v.needsConsultation).toContain("固定資産税評価額");
    expect(v.value).toBe(12_870_900);
  });
  it("評価乖離率が0以下なら0円にせず、税理士への相談にする", () => {
    // 築60年・敷地持分狭小度3 → 乖離率がマイナス
    const v = valueAsset({ ...base, builtYearsMonths: { years: 60, months: 0 }, landShareSqm: 180 });
    expect(condoCorrection({ ...base, builtYearsMonths: { years: 60, months: 0 }, landShareSqm: 180 }).ratio).toBeLessThanOrEqual(0);
    expect(v.needsConsultation).toContain("評価乖離率");
  });
});

describe("奥行価格補正率（評価通達付表1）", () => {
  it.each([
    ["普通住宅地区", 3, 0.9],
    ["普通住宅地区", 10, 1.0],
    ["普通住宅地区", 25, 0.97],
    ["普通住宅地区", 100, 0.8],
    ["ビル街地区", 5, 0.8],
    ["繁華街地区", 30, 0.98],
    ["大工場地区", 120, 1.0],
  ] as const)("%s 奥行%dm → %f", (d, m, v) => {
    expect(depthCorrection(d, m)).toBe(v);
  });
});

describe("土地の評価", () => {
  it("路線価方式：300千円×0.97×165.5㎡（1㎡当たり円未満切捨て）", () => {
    const v = valueAsset({
      id: "l",
      kind: "land",
      label: "自宅",
      location: "x",
      areaSqm: 165.5,
      landUse: "宅地",
      method: { type: "rosenka", routePrice: 300_000, depthCorrection: 0.97 },
    });
    expect(v.unitPrice).toBe(291_000);
    expect(v.value).toBe(48_160_500);
  });
  it("倍率方式：固定資産税評価額×倍率", () => {
    const v = valueAsset({
      id: "l",
      kind: "land",
      label: "畑",
      location: "x",
      areaSqm: 1000,
      landUse: "畑",
      method: { type: "multiplier", fixedAssetValue: 123_456, multiplier: 1.1 },
    });
    expect(v.value).toBe(135_801);
  });

  const land = (method: LandAsset["method"], areaSqm = 165.5): LandAsset => ({ id: "l", kind: "land", label: "自宅", location: "x", areaSqm, landUse: "宅地", method });

  it("1㎡当たりの価額×地積は浮動小数点の誤差なく計算する（291,000円×100.07㎡）", () => {
    expect(perSqmTimesArea(291_000, 100.07)).toBe(29_120_370);
    expect(valueLand(land({ type: "rosenka", routePrice: 300_000, depthCorrection: 0.97 }, 100.07)).value).toBe(29_120_370);
    expect(valueLand(land({ type: "rosenka", routePrice: 0, depthCorrection: 1, roads: [{ edge: 0, price: 291_000, depth: 15 }] }, 100.07)).value).toBe(29_120_370);
  });

  it("修正した補正率が空欄・0のときは補正なし（0円にしない）", () => {
    for (const otherCorrection of [undefined, 0, -1, Number.NaN]) {
      expect(valueLand(land({ type: "rosenka", routePrice: 300_000, depthCorrection: 0.97, otherCorrection })).value).toBe(48_160_500);
      expect(valueLand(land({ type: "rosenka", routePrice: 0, depthCorrection: 1, otherCorrection, roads: [{ edge: 0, price: 291_000, depth: 15 }] })).value).toBe(48_160_500);
    }
  });

  it("補正率は0より大きく1以下のときだけ掛け、1を超えると確定しない", () => {
    const v = valueLand(land({ type: "rosenka", routePrice: 300_000, depthCorrection: 0.97, otherCorrection: 0.9 }));
    expect(v.unitPrice).toBe(261_900);
    const r = valueLand(land({ type: "rosenka", routePrice: 0, depthCorrection: 1, otherCorrection: 0.9, roads: [{ edge: 0, price: 291_000, depth: 15 }] }));
    expect(r.unitPrice).toBe(261_900);
    const over = valueLand(land({ type: "rosenka", routePrice: 300_000, depthCorrection: 0.97, otherCorrection: 1.2 }));
    expect(over.value).toBe(0);
    expect(over.needsConsultation).toContain("1を超えて");
  });

  it("評価額を直接入力する方法で0円なら確定しない", () => {
    const v = valueLand(land({ type: "manual", value: 0 }));
    expect(v.value).toBe(0);
    expect(v.needsConsultation).toContain("評価額が未入力");
    expect(valueLand(land({ type: "manual", value: 12_345_678 })).value).toBe(12_345_678);
  });

  it("誰でも通り抜けできる私道と選んだときだけ、0円で確定する（財産評価基本通達24）", () => {
    const road = valueLand(land({ type: "manual", value: 0, publicPrivateRoad: true }));
    expect(road.value).toBe(0);
    expect(road.needsConsultation).toBeUndefined();
    expect(road.steps.join("")).toContain("評価しない");
    // 前に入れた評価額が残っていても、私道と選んでいれば評価しない
    expect(valueLand(land({ type: "manual", value: 5_000_000, publicPrivateRoad: true })).value).toBe(0);
    expect(valueLand(land({ type: "manual", value: 0, publicPrivateRoad: false })).needsConsultation).toContain("評価額が未入力");
  });
});

describe("家屋の評価", () => {
  it("固定資産税評価額が0なら確定しない", () => {
    const v = valueAsset({ id: "b", kind: "building", label: "家", location: "x", fixedAssetValue: 0 });
    expect(v.value).toBe(0);
    expect(v.needsConsultation).toContain("固定資産税評価額");
  });
});

describe("上場株式の評価", () => {
  const stock = (prices: ListedStockAsset["prices"], shares: number): ListedStockAsset => ({ id: "s", kind: "listedStock", label: "株", shares, prices });
  it("1円未満の価格も使い、4つのうち最も低い価格×株数（1円未満切捨て）", () => {
    const v = valueAsset(stock({ close: 1_600, monthAvg: 1_523.5, prevMonthAvg: 1_550.2, prev2MonthAvg: 1_580 }, 100));
    expect(v.unitPrice).toBe(1_523.5);
    expect(v.value).toBe(152_350);
  });
  it("浮動小数点の誤差で1円少なくならない（4.35円×100株＝435円）", () => {
    expect(valueAsset(stock({ close: 4.35, monthAvg: 5, prevMonthAvg: 5, prev2MonthAvg: 5 }, 100)).value).toBe(435);
  });
});

describe("小規模宅地等の特例（措法69条の4）", () => {
  it("330㎡以下は80%減額", () => {
    expect(smallResidentialReduction(50_000_000, 200)).toBe(40_000_000);
  });
  it("330㎡超は330㎡分だけ80%減額", () => {
    expect(smallResidentialReduction(66_000_000, 660)).toBe(26_400_000);
  });
});

describe("路線価図の表記", () => {
  it("420D は 1㎡当たり42万円・借地権割合60%", () => {
    expect(parseRouteNotation("420D")).toEqual({ routePrice: 420_000, letter: "D", leaseholdRatio: 0.6 });
  });
  it("全角や空白を含んでも読む", () => expect(parseRouteNotation("１，２５０ Ｃ")?.routePrice).toBe(1_250_000));
  it("記号なしも可", () => expect(parseRouteNotation("95")).toEqual({ routePrice: 95_000, letter: undefined, leaseholdRatio: undefined }));
  it("読めない表記は null", () => expect(parseRouteNotation("H12")).toBeNull());
});
