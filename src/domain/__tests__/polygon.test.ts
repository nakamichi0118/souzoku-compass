import { describe, expect, it } from "vitest";
import { fitLot, projector, type LatLng, type Road } from "../geo/lot";
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
    expect(edgeClasses([base, { ...base, roadIndex: 1, bearing: 25, frontage: 10 }])).toEqual([0, null]);
    expect(edgeClasses([])).toEqual([]);
  });

  describe("1本の道路が地理院の道路の線では途中で切れている", () => {
    // 北の辺の途中（x=0）に頂点があるL字形の土地（320㎡、間口20m）
    const L = poly([[-10, 10], [0, 10], [10, 10], [10, 0], [-2, 0], [-2, -15], [-10, -15]]);
    const area = polygonAreaSqm(L);

    it.each<[string, Road[]]>([
      ["交差点で切れている", [line([[-60, 13], [0, 13]]), line([[0, 13], [60, 13]])]],
      ["線の向きが逆で、つなぎ目が少しずれている", [line([[60, 13], [0.4, 13.1]]), line([[-60, 13], [0, 13]])]],
      ["交差する道路があっても", [line([[0, 13], [0, 60]]), line([[-60, 13], [0, 13]]), line([[0, 13], [60, 13]])]],
    ])("%s：1つの間口にまとめる", (_, rs) => {
      const t = edgeTouches(L, rs);
      expect(t[0].touches && t[1].touches).toBe(true);
      expect(t[0].roadIndex).toBe(t[1].roadIndex);
      const f = frontages(L, rs);
      expect(f).toHaveLength(1);
      expect(f[0].edges.sort()).toEqual([0, 1]);
      expect(f[0].frontage).toBe(20);
      expect(f[0].depthRect).toBe(25);
      // 想定整形地の奥行 25m と 地積 ÷ 間口距離 = 16m の短い方
      expect(depthFor(f[0], area)).toBeCloseTo(16, 1);
      expect(edgeClasses(f)).toEqual([0]);
    });

    it("直角に曲がる道路は、つながっていても別の道路のまま", () => {
      const lot = rectangle(O, 20, 15, 0);
      const bent = [line([[-60, 10.5], [13, 10.5]]), line([[13, 10.5], [13, -60]])];
      expect(edgeTouches(lot, bent).map((e) => e.roadIndex)).toEqual([0, 1, -1, -1]);
      expect(edgeClasses(frontages(lot, bent))).toEqual([0, 1]);
    });

    it("道路の線が届かず、本人が「接している」に切り替えた辺も同じ間口にまとめる", () => {
      const rs = [line([[-60, 13], [-5, 13]])];
      const t = edgeTouches(L, rs);
      expect(t[0].touches).toBe(true);
      expect(t[1]).toMatchObject({ touches: false, roadIndex: -1 });
      const on = t.map((e) => e.touches);
      on[1] = true;
      const f = frontagesOf(L, on, t.map((e) => e.roadIndex));
      expect(f).toHaveLength(1);
      expect(f[0].frontage).toBe(20);
      expect(f[0].roadIndex).toBe(0);
      expect(depthFor(f[0], area)).toBeCloseTo(16, 1);
    });

    it("つながっていない別々の道路なら分けたまま", () => {
      const f = frontagesOf(L, [true, true, false, false, false, false, false], [0, 1, -1, -1, -1, -1, -1]);
      expect(f).toHaveLength(2);
    });
  });

  describe("正面と斜めに交わる道路（Y字路）", () => {
    it("向きの差が40°の道路は横の道路（1）として計算に入れる", () => {
      const base: Frontage = { edges: [0], roadIndex: 0, bearing: 0, frontage: 20, depthRect: 15, outside: O };
      const with2 = (bearing: number) => edgeClasses([base, { ...base, roadIndex: 1, bearing, frontage: 10 }]);
      expect(with2(40)).toEqual([0, 1]);
      expect(with2(320)).toEqual([0, 3]);
      // とがった角（向きの差140°）も横、向かい合う道路は2
      expect(with2(140)).toEqual([0, 1]);
      expect(with2(180)).toEqual([0, 2]);
      expect(with2(200)).toEqual([0, 2]);
      // 同じ側に向きの違う道路が2本あれば、もう一方の横の番号を使う
      expect(edgeClasses([base, { ...base, roadIndex: 1, bearing: 60, frontage: 10 }, { ...base, roadIndex: 2, bearing: 115, frontage: 8 }])).toEqual([0, 1, 3]);
    });

    it("描いた土地で：北の道路から40°ずれて分かれる道路にも面している", () => {
      const deg = (d: number) => (d * Math.PI) / 180;
      // 北の辺（外向き0°）の東の端から、外向きが40°の辺が南東へ10m続く
      const n40: [number, number] = [Math.sin(deg(40)), Math.cos(deg(40))];
      const d40: [number, number] = [n40[1], -n40[0]];
      const c: [number, number] = [4 + d40[0] * 10, 8 + d40[1] * 10];
      const lot = poly([[-10, 8], [4, 8], c, [c[0], -8], [-10, -8]]);
      // 北の道路（y=11）と、その辺から3m外側を通る斜めの道路。y=11 で分かれる
      const start: [number, number] = [4 + n40[0] * 3, 8 + n40[1] * 3];
      const k = (11 - start[1]) / d40[1];
      const fork: [number, number] = [start[0] + d40[0] * k, 11];
      const rs = [line([[-60, 11], fork]), line([fork, [60, 11]]), line([fork, [fork[0] + d40[0] * 40, 11 + d40[1] * 40]])];
      const t = edgeTouches(lot, rs);
      expect(t.map((e) => e.touches)).toEqual([true, true, false, false, false]);
      expect(t[0].roadIndex).toBe(0);
      expect(t[1].roadIndex).toBe(2);
      const f = frontages(lot, rs);
      expect(f).toHaveLength(2);
      expect(f[1].bearing).toBeCloseTo(40, 0);
      expect(edgeClasses(f)).toEqual([0, 1]);
    });
  });

  describe("奥行の浅い土地", () => {
    // 東西10m・南北3.8m。北の辺 y=1.9 が道路の端（幅が分からない道路の中心線 y=4.9）
    const lot = rectangle(O, 10, 3.8, 0);
    const front = line([[-60, 4.9], [60, 4.9]]);

    it("奥の辺は、正面の道路に面しているとしない", () => {
      expect(edgeTouches(lot, [front]).map((e) => e.touches)).toEqual([true, false, false, false]);
      expect(frontages(lot, [front])).toHaveLength(1);
    });

    it("奥の辺の外側に別の道路があれば面している（二方路線）", () => {
      const t = edgeTouches(lot, [front, line([[-60, -4.9], [60, -4.9]])]);
      expect(t.map((e) => e.touches)).toEqual([true, false, true, false]);
      expect(t.map((e) => e.roadIndex)).toEqual([0, -1, 1, -1]);
      expect(edgeClasses(frontages(lot, [front, line([[-60, -4.9], [60, -4.9]])]))).toEqual([0, 2]);
    });

    it("描いた辺が道路に少しはみ出していても面している", () => {
      expect(edgeTouches(lot, [line([[-60, 1.2], [60, 1.2]])]).map((e) => e.touches)).toEqual([true, false, false, false]);
    });

    it.each([9, 12, 16])("登記の地積 %d㎡ から置いた正方形でも、奥の辺は面していない", (sqm) => {
      const fit = fitLot(P.from(0, -2), [front], sqm);
      const sq = rectangle(fit.center, fit.width, fit.depth, fit.rotation);
      expect(edgeTouches(sq, [front]).map((e) => e.touches)).toEqual([true, false, false, false]);
    });
  });

  it("向きの呼び方", () => {
    expect(directionLabel(0)).toBe("北側");
    expect(directionLabel(135)).toBe("南東側");
    expect(directionLabel(350)).toBe("北側");
    expect(directionLabel(-90)).toBe("西側");
  });
});
