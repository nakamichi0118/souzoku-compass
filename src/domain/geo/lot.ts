/**
 * 地図上の土地の枠（長方形）と、枠のどの辺が道路に面しているかの判定。
 * 道路の位置は国土地理院の道路中心線（ベクトルタイル）を使う。
 * 距離は土地の近く（数十m）だけを扱うので、緯度経度を平面（m）に直して計算する。
 */
import type { Edge } from "../valuation/roads";

export type LatLng = [number, number];

export interface Lot {
  center: LatLng;
  /** 間口（正面の辺の長さ、m） */
  width: number;
  /** 奥行（m） */
  depth: number;
  /** 土地の中心から正面の道路へ向かう向き（北から時計回りの角度） */
  rotation: number;
}

export interface Road {
  line: LatLng[];
  /** 道路の幅（m、分かる場合） */
  width?: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** 緯度1度・経度1度あたりの地上の長さ（m）。GRS80（世界測地系）の楕円体での近似式 */
export function metersPerDegree(lat: number): { lat: number; lng: number } {
  const p = rad(lat);
  return {
    lat: 111_132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lng: 111_412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
  };
}

/** 基準点のまわりの平面座標（東がx、北がy、単位m） */
export function projector(origin: LatLng) {
  const k = metersPerDegree(origin[0]);
  return {
    to: (p: LatLng): [number, number] => [(p[1] - origin[1]) * k.lng, (p[0] - origin[0]) * k.lat],
    from: (x: number, y: number): LatLng => [origin[0] + y / k.lat, origin[1] + x / k.lng],
  };
}

/** 枠の四隅（0:正面の左、1:正面の右、2:奥の右、3:奥の左）。辺 i は 隅i → 隅i+1（0:正面、1:右、2:奥、3:左） */
export function lotCorners(lot: Lot): LatLng[] {
  const P = projector(lot.center);
  const t = rad(lot.rotation);
  const n = [Math.sin(t), Math.cos(t)];
  const u = [Math.cos(t), -Math.sin(t)];
  const pt = (a: number, b: number) => P.from(n[0] * a + u[0] * b, n[1] * a + u[1] * b);
  const d = lot.depth / 2;
  const w = lot.width / 2;
  return [pt(d, -w), pt(d, w), pt(-d, w), pt(-d, -w)];
}

/** 辺 i の道路から見た奥行：正面・奥の辺は奥行、左右の辺は間口 */
export const edgeDepth = (lot: Lot, edge: Edge) => (edge % 2 === 0 ? lot.depth : lot.width);

/** 辺の中点から外側へ dist m 進んだ点（道路の上の点。路線価図の読み取りに使う） */
export function edgeOutside(lot: Lot, edge: Edge, dist = 4): LatLng {
  const P = projector(lot.center);
  const t = rad(lot.rotation + edge * 90);
  const half = edge % 2 === 0 ? lot.depth / 2 : lot.width / 2;
  return P.from(Math.sin(t) * (half + dist), Math.cos(t) * (half + dist));
}

/** 辺の向き（外向き）を「北側」「南東側」のような言葉にする */
export function edgeDirection(lot: Lot, edge: Edge): string {
  const deg = (((lot.rotation + edge * 90) % 360) + 360) % 360;
  const names = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  return `${names[Math.round(deg / 45) % 8]}側`;
}

type XY = [number, number];
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1];
const len = (a: XY) => Math.hypot(a[0], a[1]);

/** 点から線分への最短距離と、線分上の最も近い点 */
function toSegment(p: XY, a: XY, b: XY): { dist: number; at: XY } {
  const ab = sub(b, a);
  const L = dot(ab, ab);
  const k = L === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / L));
  const at: XY = [a[0] + ab[0] * k, a[1] + ab[1] * k];
  return { dist: len(sub(p, at)), at };
}

/** 道路の半分の幅（分からなければ一般的な生活道路として3m） */
const halfWidth = (r: Road) => (r.width && r.width > 0 ? r.width / 2 : 3);

/**
 * クリックした地点に、いちばん近い道路に正面を向けた枠を置く。
 * 正面の辺は道路の端（中心線から道路の幅の半分）に合わせる。地積が分かれば正方形をその広さにする。
 */
export function fitLot(click: LatLng, roads: Road[], areaSqm?: number): Lot {
  const side = areaSqm && areaSqm > 0 ? Math.sqrt(areaSqm) : 15;
  const P = projector(click);
  let best: { dist: number; at: XY; road: Road } | null = null;
  for (const r of roads) {
    const xy = r.line.map(P.to);
    for (let i = 0; i + 1 < xy.length; i++) {
      const s = toSegment([0, 0], xy[i], xy[i + 1]);
      if (!best || s.dist < best.dist) best = { ...s, road: r };
    }
  }
  if (!best || best.dist > 60 || best.dist < 0.01) return { center: click, width: round1(side), depth: round1(side), rotation: 0 };
  const rotation = (((Math.atan2(best.at[0], best.at[1]) * 180) / Math.PI) % 360 + 360) % 360;
  const t = rad(rotation);
  const back = halfWidth(best.road) + side / 2; // 中心線から枠の中心まで
  const cx = best.at[0] - Math.sin(t) * back;
  const cy = best.at[1] - Math.cos(t) * back;
  return { center: P.from(cx, cy), width: round1(side), depth: round1(side), rotation: Math.round(rotation * 10) / 10 };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * 枠の各辺が道路に面しているか。辺の上の5点から、辺とほぼ平行（35°以内）な道路の中心線までの距離を測り、
 * 平均が「道路の幅の半分＋4m」以内なら面しているとする。
 */
export function roadEdges(lot: Lot, roads: Road[]): { edge: Edge; touches: boolean; distance: number | null }[] {
  const P = projector(lot.center);
  const c = lotCorners(lot).map(P.to);
  const roadsXY = roads.map((r) => ({ xy: r.line.map(P.to), hw: halfWidth(r) }));
  return ([0, 1, 2, 3] as Edge[]).map((edge) => {
    const a = c[edge];
    const b = c[(edge + 1) % 4];
    const dir = sub(b, a);
    const dl = len(dir);
    let bestAvg: number | null = null;
    let touches = false;
    for (const r of roadsXY) {
      const ds: number[] = [];
      for (let k = 0; k <= 4; k++) {
        const p: XY = [a[0] + (dir[0] * (k + 0.5)) / 5.5, a[1] + (dir[1] * (k + 0.5)) / 5.5];
        let m = Infinity;
        for (let i = 0; i + 1 < r.xy.length; i++) {
          const seg = sub(r.xy[i + 1], r.xy[i]);
          const sl = len(seg);
          if (sl === 0 || dl === 0) continue;
          const cos = Math.abs(dot(seg, dir)) / (sl * dl);
          if (cos < Math.cos(rad(35))) continue;
          m = Math.min(m, toSegment(p, r.xy[i], r.xy[i + 1]).dist);
        }
        ds.push(m);
      }
      const hits = ds.filter((d) => Number.isFinite(d));
      if (hits.length < 3) continue; // 辺の半分以上で道路が並んでいない
      const avg = hits.reduce((s, d) => s + d, 0) / hits.length;
      if (bestAvg === null || avg < bestAvg) bestAvg = avg;
      if (avg <= r.hw + 4) touches = true;
    }
    return { edge, touches, distance: bestAvg === null ? null : Math.round(bestAvg * 10) / 10 };
  });
}
