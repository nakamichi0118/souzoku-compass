import { describe, expect, it } from "vitest";
import { evaluateRoads } from "../valuation/roads";
import { valueLand } from "../valuation";
import type { LandAsset } from "../types";

describe("2つ以上の道路に面する宅地（財産評価基本通達16〜18）", () => {
  it("角地：側方路線の価額 × 側方路線影響加算率を足す", () => {
    const r = evaluateRoads("普通住宅地区", [
      { edge: 0, price: 300_000, depth: 20 },
      { edge: 1, price: 200_000, depth: 15 },
    ])!;
    expect(r.front.edge).toBe(0);
    expect(r.lines.find((l) => l.edge === 1)?.role).toBe("side");
    expect(r.perSqm).toBe(300_000 + 6_000);
  });

  it("二方路線：向かいの辺の道路は二方路線影響加算率", () => {
    const r = evaluateRoads("普通商業・併用住宅地区", [
      { edge: 2, price: 250_000, depth: 20 },
      { edge: 0, price: 300_000, depth: 20 },
    ])!;
    expect(r.front.edge).toBe(0);
    expect(r.lines.find((l) => l.edge === 2)?.role).toBe("back");
    expect(r.perSqm).toBe(300_000 + 12_500);
  });

  it("正面路線は奥行価格補正後の価額が高い方", () => {
    // 300,000 × 0.95（奥行30m）= 285,000 ＜ 290,000 × 1.00（奥行12m）
    const r = evaluateRoads("普通住宅地区", [
      { edge: 0, price: 300_000, depth: 30 },
      { edge: 1, price: 290_000, depth: 12 },
    ])!;
    expect(r.front.edge).toBe(1);
    expect(r.perSqm).toBe(290_000 + Math.floor(285_000 * 0.03));
  });

  it("四方路線は側方2つと裏面を併用する", () => {
    const r = evaluateRoads("繁華街地区", [
      { edge: 0, price: 1_000_000, depth: 20 },
      { edge: 1, price: 800_000, depth: 20 },
      { edge: 2, price: 700_000, depth: 20 },
      { edge: 3, price: 600_000, depth: 20 },
    ])!;
    expect(r.perSqm).toBe(1_000_000 + 80_000 + 49_000 + 60_000);
  });

  it("土地の評価額に使われる", () => {
    const land: LandAsset = {
      id: "l",
      kind: "land",
      label: "自宅",
      location: "x",
      areaSqm: 200,
      landUse: "宅地",
      method: { type: "rosenka", routePrice: 300_000, depthCorrection: 1, district: "普通住宅地区", roads: [{ edge: 0, price: 300_000, depth: 20 }, { edge: 1, price: 200_000, depth: 10 }] },
    };
    const v = valueLand(land);
    expect(v.unitPrice).toBe(306_000);
    expect(v.value).toBe(306_000 * 200);
  });

  it("路線価か奥行が入っていない道路があれば、その道路を外して計算せず確定しない", () => {
    const base: LandAsset = { id: "l", kind: "land", label: "自宅", location: "x", areaSqm: 200, landUse: "宅地", method: { type: "rosenka", routePrice: 300_000, depthCorrection: 1 } };
    for (const second of [
      { edge: 1 as const, price: 200_000, depth: 0 },
      { edge: 1 as const, price: 0, depth: 10 },
      { edge: 1 as const, price: 0, depth: 0 },
    ]) {
      const v = valueLand({ ...base, method: { type: "rosenka", routePrice: 300_000, depthCorrection: 1, roads: [{ edge: 0, price: 300_000, depth: 20 }, second] } });
      expect(v.value).toBe(0);
      expect(v.needsConsultation).toContain("道路");
    }
  });

  it("同じ路線価・奥行の側方路線が2本あっても、計算過程の文は重ならない", () => {
    const r = evaluateRoads("普通住宅地区", [
      { edge: 0, price: 300_000, depth: 20 },
      { edge: 1, price: 200_000, depth: 20 },
      { edge: 3, price: 200_000, depth: 20 },
    ])!;
    expect(new Set(r.steps).size).toBe(r.steps.length);
    expect(r.steps.some((s) => s.startsWith("側方路線（1本目）"))).toBe(true);
    expect(r.steps.some((s) => s.startsWith("側方路線（2本目）"))).toBe(true);
  });
});
