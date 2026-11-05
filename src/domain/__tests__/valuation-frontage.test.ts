/**
 * 間口狭小補正・奥行長大補正（財産評価基本通達20-4、付表6・付表7）。数字は手で計算したもの。
 */
import { describe, expect, it } from "vitest";
import { valueLand } from "../valuation";
import { frontageRate, longRate } from "../valuation/frontage";
import { evaluateRoads } from "../valuation/roads";
import type { LandAsset } from "../types";

describe("付表6 間口狭小補正率", () => {
  it.each([
    ["普通住宅地区", 3, 0.9],
    ["普通住宅地区", 4, 0.94],
    ["普通住宅地区", 5.99, 0.94],
    ["普通住宅地区", 6, 0.97],
    ["普通住宅地区", 8, 1.0],
    ["普通商業・併用住宅地区", 5, 0.97],
    ["普通商業・併用住宅地区", 6, 1.0],
    ["高度商業地区", 3, 0.85],
    ["高度商業地区", 7, 0.97],
    ["繁華街地区", 3.5, 0.9],
    ["繁華街地区", 4, 1.0],
    ["中小工場地区", 9, 0.95],
    ["中小工場地区", 10, 1.0],
    ["大工場地区", 12, 0.97],
    ["大工場地区", 20, 0.98],
    ["大工場地区", 27.99, 0.99],
    ["大工場地区", 28, 1.0],
    ["ビル街地区", 8, 0.95],
    ["ビル街地区", 15, 0.97],
    ["ビル街地区", 16, 0.98],
    ["ビル街地区", 22, 0.99],
    ["ビル街地区", 30, 1.0],
  ] as const)("%s 間口%dm → %f", (d, m, v) => {
    expect(frontageRate(d, m)).toBe(v);
  });
  it("ビル街地区の間口8m未満は表に定めがない（null）", () => {
    expect(frontageRate("ビル街地区", 7.99)).toBeNull();
    expect(frontageRate("ビル街地区", 2)).toBeNull();
  });
});

describe("付表7 奥行長大補正率（奥行距離 ÷ 間口距離）", () => {
  it.each([
    ["普通住宅地区", 19.99, 10, 1.0],
    ["普通住宅地区", 20, 10, 0.98],
    ["普通住宅地区", 30, 10, 0.96],
    ["普通住宅地区", 40, 10, 0.94],
    ["普通住宅地区", 50, 10, 0.92],
    ["普通住宅地区", 60, 10, 0.9],
    ["普通住宅地区", 75, 10, 0.9],
    ["普通住宅地区", 100, 10, 0.9],
    ["普通商業・併用住宅地区", 30, 10, 0.99],
    ["高度商業地区", 45, 10, 0.98],
    ["繁華街地区", 55, 10, 0.96],
    ["普通商業・併用住宅地区", 65, 10, 0.94],
    ["普通商業・併用住宅地区", 70, 10, 0.92],
    ["普通商業・併用住宅地区", 80, 10, 0.9],
    ["中小工場地区", 25, 10, 1.0],
    ["中小工場地区", 70, 10, 0.92],
    ["中小工場地区", 90, 10, 0.9],
    ["ビル街地区", 90, 10, 1.0],
    ["大工場地区", 90, 10, 1.0],
  ] as const)("%s 奥行%dm・間口%dm → %f", (d, depth, fr, v) => {
    expect(longRate(d, depth, fr)).toBe(v);
  });
  it("ちょうど区切りの比率は、浮動小数点の誤差で下の区分にしない（6.3m ÷ 2.1m = 3 → 0.96）", () => {
    expect(longRate("普通住宅地区", 6.3, 2.1)).toBe(0.96);
  });
});

describe("道路の評価に間口狭小・奥行長大の補正を掛ける", () => {
  it("道路1つ：194,000円 × 0.94（間口5m）× 0.92（25÷5＝5）= 167,771.2 → 167,771円", () => {
    // 200,000円 × 奥行価格補正率0.97（普通住宅地区・奥行25m）= 194,000円
    const r = evaluateRoads("普通住宅地区", [{ edge: 0, price: 200_000, depth: 25, frontage: 5 }])!;
    expect(r.basePerSqm).toBe(194_000);
    expect(r.frontageRate).toBe(0.94);
    expect(r.longRate).toBe(0.92);
    expect(r.perSqm).toBe(167_771);
    expect(r.steps.at(-1)).toContain("間口狭小補正率 0.94");
    expect(r.steps.at(-1)).toContain("奥行長大補正率 0.92");
    expect(r.steps.at(-1)).toContain("167,771円");
  });

  it("角地：側方路線の加算のあとの額に掛ける（306,000円 × 0.97 × 0.98 = 290,883.6 → 290,883円）", () => {
    const roads = [
      { edge: 0 as const, price: 300_000, depth: 20, frontage: 7 },
      { edge: 1 as const, price: 200_000, depth: 10 },
    ];
    const r = evaluateRoads("普通住宅地区", roads)!;
    expect(r.basePerSqm).toBe(306_000);
    expect(r.frontageRate).toBe(0.97); // 間口7m
    expect(r.longRate).toBe(0.98); // 20 ÷ 7 = 2.86
    expect(r.perSqm).toBe(290_883);
    const a: LandAsset = {
      id: "l",
      kind: "land",
      label: "自宅",
      location: "東京都",
      areaSqm: 140,
      landUse: "宅地",
      method: { type: "rosenka", routePrice: 0, depthCorrection: 1, district: "普通住宅地区", roads },
    };
    const v = valueLand(a);
    expect(v.unitPrice).toBe(290_883);
    expect(v.value).toBe(40_723_620); // 290,883 × 140
    // 修正した補正率はこのあとに掛ける：290,883 × 0.9 = 261,794.7 → 261,794円 × 140㎡
    const w = valueLand({ ...a, method: { ...a.method, otherCorrection: 0.9 } as LandAsset["method"] });
    expect(w.unitPrice).toBe(261_794);
    expect(w.value).toBe(36_651_160);
  });

  it("間口距離は正面の道路のものだけを使う（側方の道路の間口では補正しない）", () => {
    const r = evaluateRoads("普通住宅地区", [
      { edge: 0, price: 300_000, depth: 20 },
      { edge: 1, price: 200_000, depth: 10, frontage: 3 },
    ])!;
    expect(r.perSqm).toBe(306_000);
    expect(r.frontageRate).toBeUndefined();
  });

  it("間口距離がない・0なら今までどおり補正しない", () => {
    for (const frontage of [undefined, 0]) {
      const r = evaluateRoads("普通住宅地区", [{ edge: 0, price: 200_000, depth: 25, frontage }])!;
      expect(r.perSqm).toBe(194_000);
      expect(r.basePerSqm).toBe(194_000);
      expect(r.frontageRate).toBeUndefined();
      expect(r.longRate).toBeUndefined();
      expect(r.steps.some((s) => s.includes("間口"))).toBe(false);
    }
  });

  it("ビル街地区の間口8m未満は間口狭小補正率を1.00とする", () => {
    // 1,000,000円 × 0.94（ビル街地区・奥行20m）= 940,000円。20 ÷ 6 = 3.33 → ビル街地区は1.00
    const r = evaluateRoads("ビル街地区", [{ edge: 0, price: 1_000_000, depth: 20, frontage: 6 }])!;
    expect(r.perSqm).toBe(940_000);
    expect(r.frontageRate).toBe(1);
    expect(r.longRate).toBe(1);
    expect(r.steps.some((s) => s.includes("定めがない"))).toBe(true);
  });

  it("補正率が両方1.00のときは金額が変わらない", () => {
    const r = evaluateRoads("普通住宅地区", [{ edge: 0, price: 200_000, depth: 15, frontage: 10 }])!;
    expect(r.perSqm).toBe(200_000);
    expect(r.frontageRate).toBe(1);
    expect(r.longRate).toBe(1);
  });
});
