/**
 * 路線価図の自動位置合わせ（試験的な機能）。
 *
 * 路線価図には道路の両側の線が描かれている。国土地理院の道路中心線から道路の両端の線を作り、
 * それが路線価図の線の上に最もよく重なる枠の位置・縮尺・向きを探す。
 * 重なり具合は「各点から路線価図の最も近い線までの距離（距離変換）」の平均で測り、小さいほど良い。
 * 粗い刻みで広く探してから、細かい刻みで絞り込む。
 */
import type { Frame, Paper } from "./frame";
import { type LatLng, type Road, projector } from "./lot";

/** 画像の暗い画素（線・文字）からの距離（画素）。チャンファー距離（3-4）で近似する */
export function distanceField(dark: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = dark[i] ? 0 : INF;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/** 道路中心線から、道路の両端の線の上の点（基準点からの東・北のm）を作る */
export function roadEdgePoints(roads: Road[], origin: LatLng, stepM = 3): [number, number][] {
  const P = projector(origin);
  const pts: [number, number][] = [];
  for (const r of roads) {
    const hw = r.width && r.width > 0 ? r.width / 2 : 2.5;
    const xy = r.line.map(P.to);
    for (let i = 0; i + 1 < xy.length; i++) {
      const [ax, ay] = xy[i];
      const [bx, by] = xy[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L === 0) continue;
      const nx = -(by - ay) / L;
      const ny = (bx - ax) / L;
      for (let t = 0; t < L; t += stepM) {
        const x = ax + ((bx - ax) * t) / L;
        const y = ay + ((by - ay) * t) / L;
        pts.push([x + nx * hw, y + ny * hw], [x - nx * hw, y - ny * hw]);
      }
    }
  }
  return pts;
}

interface Field {
  d: Float32Array;
  w: number;
  h: number;
}

/**
 * 枠（基準点から dx, dy m ずらした中心・縮尺・回転）で、点の重なり具合を測る。
 * 画像の外に出た点が多すぎる場合は採用しない（Infinity）。
 */
function score(f: Field, paper: Paper, pts: [number, number][], dx: number, dy: number, scale: number, rotation: number, cap: number): number {
  const ppm = f.w / ((paper.widthMm * scale) / 1000); // 1mあたりの画素
  const th = (rotation * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  let sum = 0;
  let n = 0;
  for (const [e0, n0] of pts) {
    const e = e0 - dx;
    const no = n0 - dy;
    const x = e * c - no * s;
    const y = e * s + no * c;
    const px = Math.round(f.w / 2 + x * ppm);
    const py = Math.round(f.h / 2 - y * ppm);
    if (px < 0 || py < 0 || px >= f.w || py >= f.h) continue;
    sum += Math.min(cap, f.d[py * f.w + px]);
    n++;
  }
  return n < pts.length * 0.3 || n < 30 ? Infinity : sum / n;
}

export interface AlignResult {
  frame: Frame;
  /** 重なり具合（平均の距離、画素）。小さいほど良い */
  score: number;
  /** 合わせる前の重なり具合 */
  before: number;
}

/**
 * 今の枠を出発点に、周り radius m の範囲で位置・縮尺（±10%程度）・向き（±3°程度）を探す。
 * origin は道路の点の基準（土地の位置）。
 */
export function autoAlign(f: Field, paper: Paper, roads: Road[], origin: LatLng, start: Frame, radius = 350): AlignResult | null {
  const all = roadEdgePoints(roads, origin);
  if (all.length < 30) return null;
  // 粗い探索は点を間引く
  const coarse = all.filter((_, i) => i % Math.max(1, Math.floor(all.length / 600)) === 0);
  const P = projector(origin);
  const [sx, sy] = P.to(start.center);
  const cap = 8;
  const before = score(f, paper, all, sx, sy, start.scale, start.rotation, cap);
  let best = { dx: sx, dy: sy, scale: start.scale, rot: start.rotation, v: Infinity };
  const step = 8;
  for (const k of [0.9, 0.96, 1.02, 1.08])
    for (const r of [-2, 0, 2])
      for (let dx = -radius; dx <= radius; dx += step)
        for (let dy = -radius; dy <= radius; dy += step) {
          const v = score(f, paper, coarse, sx + dx, sy + dy, start.scale * k, start.rotation + r, cap);
          if (v < best.v) best = { dx: sx + dx, dy: sy + dy, scale: start.scale * k, rot: start.rotation + r, v };
        }
  if (!Number.isFinite(best.v)) return null;
  // 細かく絞り込む
  for (const [st, ks, rs] of [
    [3, 0.03, 1],
    [1, 0.01, 0.3],
    [0.4, 0.004, 0.15],
  ] as const) {
    const base = { ...best };
    for (let a = -3; a <= 3; a++)
      for (let b = -3; b <= 3; b++)
        for (const k of [-1, 0, 1])
          for (const r of [-1, 0, 1]) {
            const cand = { dx: base.dx + a * st, dy: base.dy + b * st, scale: base.scale * (1 + k * ks), rot: base.rot + r * rs };
            const v = score(f, paper, all, cand.dx, cand.dy, cand.scale, cand.rot, cap);
            if (v < best.v) best = { ...cand, v };
          }
  }
  return {
    frame: { center: P.from(best.dx, best.dy), scale: Math.round(best.scale), rotation: Math.round(best.rot * 10) / 10 },
    score: best.v,
    before,
  };
}
