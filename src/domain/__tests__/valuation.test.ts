import { describe, expect, it } from "vitest";
import { condoCorrection, smallResidentialReduction, valueAsset } from "../valuation";
import { depthCorrection } from "../valuation/depth";
import type { CondoAsset } from "../types";

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
});

describe("小規模宅地等の特例（措法69条の4）", () => {
  it("330㎡以下は80%減額", () => {
    expect(smallResidentialReduction(50_000_000, 200)).toBe(40_000_000);
  });
  it("330㎡超は330㎡分だけ80%減額", () => {
    expect(smallResidentialReduction(66_000_000, 660)).toBe(26_400_000);
  });
});
