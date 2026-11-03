import { describe, expect, it } from "vitest";
import { edgeDepth, edgeDirection, fitLot, lotCorners, projector, roadEdges, type LatLng } from "../geo/lot";

const O: LatLng = [33.59, 130.42];
const P = projector(O);
const line = (pts: [number, number][]) => ({ line: pts.map(([x, y]) => P.from(x, y)) });

describe("土地の枠と道路", () => {
  // 北に東西の道路（中心線 y=8m）、東に南北の道路（中心線 x=10m）
  const roads = [line([[-50, 8], [50, 8]]), line([[10, -50], [10, 50]])];

  it("いちばん近い道路に正面を向け、道路の端に枠を合わせる", () => {
    const lot = fitLot(O, roads, 100);
    expect(lot.rotation).toBeCloseTo(0, 0);
    expect(lot.width).toBe(10);
    const [x, y] = P.to(lot.center);
    expect(x).toBeCloseTo(0, 1);
    expect(y).toBeCloseTo(0, 1); // 8m − 道路の半分3m − 奥行の半分5m
    expect(edgeDirection(lot, 0)).toBe("北側");
    expect(edgeDirection(lot, 1)).toBe("東側");
  });

  it("面している辺を判定する（正面と東の側方）", () => {
    const lot = fitLot(O, roads, 100);
    const e = roadEdges(lot, roads);
    expect(e.map((x) => x.touches)).toEqual([true, true, false, false]);
    expect(edgeDepth({ ...lot, width: 12, depth: 20 }, 1)).toBe(12);
  });

  it("四隅は正面の左から時計回り", () => {
    const c = lotCorners({ center: O, width: 10, depth: 20, rotation: 90 }).map(P.to);
    // 正面は東：正面の左＝北東、正面の右＝南東
    expect(c[0][0]).toBeCloseTo(10, 1);
    expect(c[0][1]).toBeCloseTo(5, 1);
    expect(c[1][1]).toBeCloseTo(-5, 1);
    expect(c[2][0]).toBeCloseTo(-10, 1);
  });

  it("道路が遠いときはクリックした場所に置く", () => {
    const lot = fitLot(O, [line([[500, 0], [500, 10]])]);
    expect(lot.center).toEqual(O);
    expect(lot.width).toBe(15);
  });
});
