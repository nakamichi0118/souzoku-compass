import { describe, expect, it } from "vitest";
import { projector, type LatLng, type Road } from "../geo/lot";
import {
  centroid,
  depthFor,
  directionLabel,
  edgeClasses,
  edgeTouches,
  frontagesOf,
  polygonAreaSqm,
  rectangle,
  translatePolygon,
  type Frontage,
} from "../geo/polygon";

const O: LatLng = [33.59, 130.42];
const P = projector(O);
const poly = (pts: [number, number][]) => pts.map(([x, y]) => P.from(x, y));
const line = (pts: [number, number][]): Road => ({ line: poly(pts) });

/** 道路判定からまとまりまでを通して求める */
const frontages = (pts: LatLng[], roads: Road[]) => {
  const t = edgeTouches(pts, roads);
  return frontagesOf(
    pts,
    t.map((e) => e.touches),
    t.map((e) => e.roadIndex),
  );
};

describe("描いた土地の形", () => {
  // 北に東西の道路（中心線 y=10.5m）、東に南北の道路（中心線 x=13m）
  const roads = [line([[-60, 10.5], [60, 10.5]]), line([[13, -60], [13, 60]])];

  it("10m × 20m の長方形の面積と重心", () => {
    const r = rectangle(O, 10, 20, 0);
    expect(Math.abs(polygonAreaSqm(r) - 200)).toBeLessThan(0.5);
    const [x, y] = P.to(centroid(r));
    expect(x).toBeCloseTo(0, 2);
    expect(y).toBeCloseTo(0, 2);
    expect(polygonAreaSqm(r.slice(0, 2))).toBe(0);
  });

  it("角地：北と東の道路に面し、北が正面（0）、東が側方（1）", () => {
    // 東西20m・南北15m。北の辺は y=7.5、東の辺は x=10
    const lot = rectangle(O, 20, 15, 0);
    const t = edgeTouches(lot, roads);
    expect(t.map((e) => e.touches)).toEqual([true, true, false, false]);
    expect(t.map((e) => e.roadIndex)).toEqual([0, 1, -1, -1]);
    const f = frontages(lot, roads);
    expect(f).toHaveLength(2);
    expect(f[0].bearing).toBeCloseTo(0, 0);
    expect(f[0].frontage).toBe(20);
    expect(f[0].depthRect).toBe(15);
    expect(f[1].bearing).toBeCloseTo(90, 0);
    expect(f[1].frontage).toBe(15);
    expect(f[1].depthRect).toBe(20);
    expect(edgeClasses(f)).toEqual([0, 1]);
    expect(directionLabel(f[0].bearing)).toBe("北側");
    expect(directionLabel(f[1].bearing)).toBe("東側");
    // 路線価を読む点は北の道路の上（辺から4m外側）
    const [ox, oy] = P.to(f[0].outside);
    expect(ox).toBeCloseTo(0, 1);
    expect(oy).toBeCloseTo(11.5, 1);
    expect(depthFor(f[0], polygonAreaSqm(lot))).toBeCloseTo(15, 1);
  });

  it("頂点の並びが時計回りでも反時計回りでも同じ結果", () => {
    const cw = rectangle(O, 20, 15, 0);
    const ccw = [...cw].reverse();
    const pick = (f: Frontage[]) => f.map((x) => ({ bearing: x.bearing, frontage: x.frontage, depthRect: x.depthRect, roadIndex: x.roadIndex }));
    expect(pick(frontages(ccw, roads))).toEqual(pick(frontages(cw, roads)));
    expect(polygonAreaSqm(ccw)).toBe(polygonAreaSqm(cw));
  });

  it("最後の辺と最初の辺が同じ道路に面していれば1つの間口にまとめる", () => {
    // 北の辺の途中から描き始めた五角形
    const pts = poly([[0, 7.5], [10, 7.5], [10, -7.5], [-10, -7.5], [-10, 7.5]]);
    const f = frontages(pts, [roads[0]]);
    expect(f).toHaveLength(1);
    expect(f[0].edges.sort()).toEqual([0, 4]);
    expect(f[0].frontage).toBe(20);
    expect(f[0].bearing).toBeCloseTo(0, 0);
  });

  it("L字形の土地：地積 ÷ 間口距離 の方が短ければそれを奥行にする", () => {
    // 北側は幅20m・奥行10m、西側だけさらに南へ幅8m・15m伸びる
    const L = poly([[-10, 10], [10, 10], [10, 0], [-2, 0], [-2, -15], [-10, -15]]);
    const area = polygonAreaSqm(L);
    expect(Math.abs(area - 320)).toBeLessThan(0.5);
    const f = frontages(L, [line([[-60, 13], [60, 13]])]);
    expect(f).toHaveLength(1);
    expect(f[0].frontage).toBe(20);
    expect(f[0].depthRect).toBe(25);
    expect(depthFor(f[0], area)).toBeCloseTo(16, 1);
    // 長方形なら想定整形地の奥行のまま
    expect(depthFor({ ...f[0], depthRect: 12 }, area)).toBe(12);
  });

  it("移動しても面積と形は変わらない", () => {
    const L = poly([[-10, 10], [10, 10], [10, 0], [-2, 0], [-2, -15], [-10, -15]]);
    const c = centroid(L);
    const to: LatLng = [33.6, 130.43];
    const moved = translatePolygon(L, c, to);
    expect(Math.abs(polygonAreaSqm(moved) - polygonAreaSqm(L))).toBeLessThan(0.1);
    const mc = centroid(moved);
    expect(mc[0]).toBeCloseTo(to[0], 6);
    expect(mc[1]).toBeCloseTo(to[1], 6);
  });

  it("遠い道路や1m未満の辺は面していない", () => {
    const lot = rectangle(O, 20, 15, 0);
    const t = edgeTouches(lot, [line([[-60, 60], [60, 60]])]);
    expect(t[0].touches).toBe(false);
    expect(t[0].roadIndex).toBe(-1);
    expect(t[0].distance).toBeCloseTo(52.5, 0);
    expect(t[1].distance).toBeNull(); // 平行な道路がない
    const tiny = poly([[0, 7.5], [0.5, 7.5], [0.5, -7.5], [0, -7.5]]);
    expect(edgeTouches(tiny, roads)[0]).toEqual({ touches: false, roadIndex: -1, distance: null });
  });

  it("同じ向きの間口が2つあれば長い方だけを使う", () => {
    const base: Frontage = { edges: [0], roadIndex: 0, bearing: 0, frontage: 20, depthRect: 15, outside: O };
    const f: Frontage[] = [base, { ...base, roadIndex: 1, bearing: 10, frontage: 5 }, { ...base, roadIndex: 2, bearing: 185, frontage: 8 }];
    expect(edgeClasses(f)).toEqual([0, null, 2]);
    expect(edgeClasses([])).toEqual([]);
  });

  it("向きの呼び方", () => {
    expect(directionLabel(0)).toBe("北側");
    expect(directionLabel(135)).toBe("南東側");
    expect(directionLabel(350)).toBe("北側");
    expect(directionLabel(-90)).toBe("西側");
  });
});
