/**
 * 基準点の組（路線価図の上の点 ↔ 地図の上の点）から、路線価図1枚分の枠（中心・縮尺・向き）を求める。
 * 図の上の点は用紙の上の位置（mm）に直し、地上の位置（m）との間の相似変換（拡大縮小・回転・平行移動）を
 * 最小二乗法で当てはめる。縮尺の分母 ＝ 地上の長さ(m) ÷ 用紙の長さ(m)。
 */
import type { Frame, Paper } from "./frame";
import { type LatLng, projector } from "./lot";

export interface FitPair {
  /** 図の幅・高さを1とした位置（右・下が正） */
  img: [number, number];
  latlng: LatLng;
}

export function frameFromPairs(pairs: FitPair[], paper: Paper): Frame | null {
  if (pairs.length < 2) return null;
  const P = projector(pairs[0].latlng);
  // 図の点：用紙の mm（x 右、y 上）、地上の点：m（x 東、y 北）。複素数 z, w として w = a z + b を当てはめる
  const z = pairs.map((p) => [p.img[0] * paper.widthMm, -p.img[1] * paper.heightMm] as const);
  const w = pairs.map((p) => P.to(p.latlng));
  const n = pairs.length;
  const zm = [z.reduce((s, q) => s + q[0], 0) / n, z.reduce((s, q) => s + q[1], 0) / n];
  const wm = [w.reduce((s, q) => s + q[0], 0) / n, w.reduce((s, q) => s + q[1], 0) / n];
  let re = 0;
  let im = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const zx = z[i][0] - zm[0];
    const zy = z[i][1] - zm[1];
    const wx = w[i][0] - wm[0];
    const wy = w[i][1] - wm[1];
    // (w - w̄) × conj(z - z̄)
    re += wx * zx + wy * zy;
    im += wy * zx - wx * zy;
    den += zx * zx + zy * zy;
  }
  if (den === 0) return null;
  const a = [re / den, im / den];
  const mPerMm = Math.hypot(a[0], a[1]);
  if (!(mPerMm > 0)) return null;
  const b = [wm[0] - (a[0] * zm[0] - a[1] * zm[1]), wm[1] - (a[0] * zm[1] + a[1] * zm[0])];
  // 用紙の中心
  const c = [0.5 * paper.widthMm, -0.5 * paper.heightMm];
  const cx = a[0] * c[0] - a[1] * c[1] + b[0];
  const cy = a[0] * c[1] + a[1] * c[0] + b[1];
  // 枠の回転は時計回りが正（frameCorners と同じ向き）
  const rotation = (-Math.atan2(a[1], a[0]) * 180) / Math.PI;
  return { center: P.from(cx, cy), scale: Math.round(mPerMm * 1000), rotation: Math.round(rotation * 10) / 10 };
}
