/**
 * 地図の上で描いた土地の形（多角形）の計算。
 * 面積、道路に面している辺、間口距離と奥行距離（路線価方式で使う値）を求める。
 * lot.ts と同じく、土地の近く（数十m）だけを扱うので緯度経度を平面（m）に直して計算する。
 */
import type { Edge } from "../valuation/roads";
import { lotCorners, projector, type LatLng, type Road } from "./lot";

type XY = [number, number];
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1];
const len = (a: XY) => Math.hypot(a[0], a[1]);
const rad = (d: number) => (d * Math.PI) / 180;
const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
/** ベクトルの向き（北から時計回りの角度、0〜360） */
const bearingOf = (v: XY) => norm360((Math.atan2(v[0], v[1]) * 180) / Math.PI);
const COS35 = Math.cos(rad(35));
const COS30 = Math.cos(rad(30));

/** 頂点の平均を基準にした平面座標（東がx、北がy、単位m） */
function local(pts: LatLng[]) {
  const n = pts.length || 1;
  const P = projector([pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]);
  return { P, xy: pts.map(P.to) };
}

/** 向きのついた面積（反時計回りなら正、時計回りなら負） */
function signedArea(xy: XY[]): number {
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** 頂点が時計回りに並んでいるか */
const isClockwise = (xy: XY[]) => signedArea(xy) < 0;

/** 点から線分までの最短距離 */
function toSegment(p: XY, a: XY, b: XY): number {
  const ab = sub(b, a);
  const L = dot(ab, ab);
  const k = L === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / L));
  return len(sub(p, [a[0] + ab[0] * k, a[1] + ab[1] * k]));
}

/** 土地の面積（㎡、小数2桁）。頂点が3つ未満なら0 */
export function polygonAreaSqm(pts: LatLng[]): number {
  if (pts.length < 3) return 0;
  return round(Math.abs(signedArea(local(pts).xy)), 2);
}

/** 土地の重心（面積がほぼ0なら頂点の平均） */
export function centroid(pts: LatLng[]): LatLng {
  const { P, xy } = local(pts);
  const A = signedArea(xy);
  if (pts.length < 3 || Math.abs(A) < 1e-6) return P.from(0, 0);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % xy.length];
    const c = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * c;
    cy += (a[1] + b[1]) * c;
  }
  return P.from(cx / (6 * A), cy / (6 * A));
}

/** 形を保ったまま（m単位で）from から to へ動かす */
export function translatePolygon(pts: LatLng[], from: LatLng, to: LatLng): LatLng[] {
  const A = projector(from);
  const B = projector(to);
  return pts.map((p) => B.from(...A.to(p)));
}

/**
 * 各辺（辺 i は 頂点i → 頂点i+1）が道路に面しているか。lot.ts の roadEdges と同じ基準：
 * 辺の上の5点から、辺とほぼ平行（35°以内）な道路の中心線までの距離を測り、3点以上で測れて
 * 平均が「道路の幅の半分（分からなければ3m）＋4m」以内なら面しているとする。1m未満の辺は面していないとする。
 * roadIndex は面している道路のうち最も近いものの番号（なければ -1）。
 */
export function edgeTouches(pts: LatLng[], roads: Road[]): { touches: boolean; roadIndex: number; distance: number | null }[] {
  const { P, xy } = local(pts);
  const roadsXY = roads.map((r) => ({ xy: r.line.map(P.to), hw: r.width && r.width > 0 ? r.width / 2 : 3 }));
  return xy.map((a, i) => {
    const dir = sub(xy[(i + 1) % xy.length], a);
    const dl = len(dir);
    if (dl < 1) return { touches: false, roadIndex: -1, distance: null };
    let nearest: number | null = null;
    let best: { index: number; avg: number } | null = null;
    for (let ri = 0; ri < roadsXY.length; ri++) {
      const r = roadsXY[ri];
      const ds: number[] = [];
      for (let k = 0; k < 5; k++) {
        const t = (k + 0.5) / 5;
        const p: XY = [a[0] + dir[0] * t, a[1] + dir[1] * t];
        let m = Infinity;
        for (let j = 0; j + 1 < r.xy.length; j++) {
          const seg = sub(r.xy[j + 1], r.xy[j]);
          const sl = len(seg);
          if (sl === 0 || Math.abs(dot(seg, dir)) / (sl * dl) < COS35) continue;
          m = Math.min(m, toSegment(p, r.xy[j], r.xy[j + 1]));
        }
        if (Number.isFinite(m)) ds.push(m);
      }
      if (ds.length < 3) continue; // 辺の半分以上で道路が並んでいない
      const avg = ds.reduce((s, d) => s + d, 0) / ds.length;
      if (nearest === null || avg < nearest) nearest = avg;
      if (avg <= r.hw + 4 && (!best || avg < best.avg)) best = { index: ri, avg };
    }
    const distance = best ? best.avg : nearest;
    return { touches: !!best, roadIndex: best ? best.index : -1, distance: distance === null ? null : round(distance, 1) };
  });
}

/** 1つの道路に面している部分（連続した辺のまとまり） */
export interface Frontage {
  /** 含まれる辺の番号（辺 i は 頂点i → 頂点i+1） */
  edges: number[];
  /** 面している道路の番号（分からなければ -1） */
  roadIndex: number;
  /** 土地から道路へ向かう向き（北から時計回りの角度、0〜360） */
  bearing: number;
  /** 間口距離（m、小数1桁） */
  frontage: number;
  /** 想定整形地の奥行距離：間口の線から最も奥の頂点までの距離（m、小数1桁） */
  depthRect: number;
  /** 最も長い辺の中点から4m外側の点（道路の上。路線価図の読み取りに使う） */
  outside: LatLng;
}

/**
 * 道路に面している辺（on）を、道路ごとのまとまりにする。隣り合う辺（最後の辺と最初の辺も隣とみなす）は、
 * 同じ道路（どちらも不明でもよい）で、外向きの向きの差が30°以内なら同じまとまりにする。間口距離の長い順に返す。
 */
export function frontagesOf(pts: LatLng[], on: boolean[], roadIndexOf: number[]): Frontage[] {
  const n = pts.length;
  if (n < 3) return [];
  const { P, xy } = local(pts);
  const s = isClockwise(xy) ? -1 : 1;
  const edges = xy.map((a, i) => {
    const b = xy[(i + 1) % n];
    const d = sub(b, a);
    const l = len(d);
    // 外向きの向き：反時計回りなら進む向きの右、時計回りなら左
    const nrm: XY = l > 0 ? [(s * d[1]) / l, (-s * d[0]) / l] : [0, 0];
    return { i, a, b, l, nrm, road: roadIndexOf[i] ?? -1 };
  });
  type E = (typeof edges)[number];
  // 長さがほぼ0の辺（同じ点の重複など）は無いものとして扱う
  const valid = edges.filter((e) => e.l >= 0.01);
  const m = valid.length;
  const joins = (p: E, q: E) => !!on[p.i] && !!on[q.i] && p.road === q.road && dot(p.nrm, q.nrm) >= COS30 - 1e-9;
  // まとまりの切れ目から数え始める（すべてつながる場合は先頭から）
  const start = Math.max(0, valid.findIndex((e, k) => !joins(valid[(k - 1 + m) % m], e)));
  const groups: E[][] = [];
  let cur: E[] | null = null;
  for (let k = 0; k < m; k++) {
    const e = valid[(start + k) % m];
    if (!on[e.i]) {
      cur = null;
      continue;
    }
    if (!cur || !joins(cur[cur.length - 1], e)) {
      cur = [];
      groups.push(cur);
    }
    cur.push(e);
  }
  const total = (g: E[]) => g.reduce((t, e) => t + e.l, 0);
  return groups
    .sort((g, h) => total(h) - total(g))
    .map((g) => {
      // 辺の長さで重みをつけた外向きの向き
      const sum = g.reduce<XY>((v, e) => [v[0] + e.nrm[0] * e.l, v[1] + e.nrm[1] * e.l], [0, 0]);
      const nrm: XY = len(sum) > 1e-9 ? [sum[0] / len(sum), sum[1] / len(sum)] : g[0].nrm;
      const front = Math.max(...g.flatMap((e) => [dot(e.a, nrm), dot(e.b, nrm)]));
      const depthRect = Math.max(0, ...xy.map((p) => front - dot(p, nrm)));
      const longest = g.reduce((x, y) => (y.l > x.l ? y : x));
      const out = (k: 0 | 1) => (longest.a[k] + longest.b[k]) / 2 + longest.nrm[k] * 4;
      return {
        edges: g.map((e) => e.i),
        roadIndex: g[0].road,
        bearing: norm360(round(bearingOf(nrm), 1)),
        frontage: round(total(g), 1),
        depthRect: round(depthRect, 1),
        outside: P.from(out(0), out(1)),
      };
    });
}

/**
 * 奥行価格補正に使う奥行距離（m、小数2桁）。奥行が一様でない土地は、国税庁の取扱いにより
 * 「地積 ÷ 間口距離」（平均的な奥行）と「想定整形地の奥行距離」のいずれか短い方を使う。
 */
export function depthFor(f: Frontage, areaSqm: number): number {
  const avg = f.frontage > 0 && areaSqm > 0 ? areaSqm / f.frontage : 0;
  return round(f.depthRect > 0 && avg > 0 ? Math.min(f.depthRect, avg) : f.depthRect, 2);
}

/**
 * 各まとまりを evaluateRoads の辺の番号に直す。最初のまとまりを0とし、向かいを2、横を1と3にする。
 * 同じ番号になったときは間口の長い方が使い、もう一方は null（計算に入れない）。
 */
export function edgeClasses(frontages: Frontage[]): (Edge | null)[] {
  if (frontages.length === 0) return [];
  const b0 = frontages[0].bearing;
  const cls = frontages.map((f) => (Math.round(norm360(f.bearing - b0) / 90) % 4) as Edge);
  const order = frontages.map((_, i) => i).sort((i, j) => frontages[j].frontage - frontages[i].frontage);
  const out: (Edge | null)[] = frontages.map(() => null);
  const taken = new Set<Edge>();
  for (const i of order) {
    if (taken.has(cls[i])) continue;
    taken.add(cls[i]);
    out[i] = cls[i];
  }
  return out;
}

/** 向きを「北側」「南東側」のような言葉にする（lot.ts の edgeDirection と同じ呼び方） */
export function directionLabel(bearing: number): string {
  const names = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  return `${names[Math.round(norm360(bearing) / 45) % 8]}側`;
}

/** 長方形の四隅（正面の左、正面の右、奥の右、奥の左）。rotation は中心から正面の道路へ向かう向き */
export function rectangle(center: LatLng, width: number, depth: number, rotation: number): LatLng[] {
  return lotCorners({ center, width, depth, rotation });
}
