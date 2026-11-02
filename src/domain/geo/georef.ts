/**
 * 路線価図（画像）を地図に重ねるための座標変換。
 *
 * 画像上の点 (x, y) と地図上の同じ地点（画面上のピクセル座標）の組（基準点）から、
 * 画像 → 地図 の変換を求める。
 *   基準点2組：相似変換（拡大縮小・回転・平行移動）
 *   基準点3組以上：アフィン変換（最小二乗）
 * 返す行列は CSS の matrix(a, b, c, d, e, f) と同じ並び：
 *   X = a·x + c·y + e,  Y = b·x + d·y + f
 */
export type Pt = [number, number];
export type Affine = [number, number, number, number, number, number];
export interface ControlPair {
  src: Pt;
  dst: Pt;
}

export function apply(m: Affine, [x, y]: Pt): Pt {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error("変換を逆算できません（基準点が一直線上にあります）");
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** 2組の基準点から相似変換を求める（複素数 w = s·z + t として解く） */
export function similarity(p: ControlPair, q: ControlPair): Affine {
  const zx = q.src[0] - p.src[0];
  const zy = q.src[1] - p.src[1];
  const wx = q.dst[0] - p.dst[0];
  const wy = q.dst[1] - p.dst[1];
  const n = zx * zx + zy * zy;
  if (n === 0) throw new Error("基準点が同じ位置にあります");
  // s = w / z
  const sr = (wx * zx + wy * zy) / n;
  const si = (wy * zx - wx * zy) / n;
  // X = sr·x − si·y + tx, Y = si·x + sr·y + ty
  const tx = p.dst[0] - (sr * p.src[0] - si * p.src[1]);
  const ty = p.dst[1] - (si * p.src[0] + sr * p.src[1]);
  return [sr, si, -si, sr, tx, ty];
}

/** 3組以上の基準点からアフィン変換を最小二乗で求める */
export function affine(pairs: ControlPair[]): Affine {
  // 正規方程式 (AᵀA) u = Aᵀb を X, Y それぞれについて解く（A の行は [x, y, 1]）
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (const { src, dst } of pairs) {
    const r = [src[0], src[1], 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j];
      bx[i] += r[i] * dst[0];
      by[i] += r[i] * dst[1];
    }
  }
  const ux = solve3(M, bx);
  const uy = solve3(M, by);
  return [ux[0], uy[0], ux[1], uy[1], ux[2], uy[2]];
}

function solve3(M: number[][], b: number[]): number[] {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-9) throw new Error("基準点が一直線上にあります。離れた3点を選んでください");
  return [0, 1, 2].map((k) => det(M.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / D);
}

export function solveTransform(pairs: ControlPair[]): Affine | null {
  if (pairs.length < 2) return null;
  if (pairs.length === 2) return similarity(pairs[0], pairs[1]);
  return affine(pairs);
}

/** 変換後の各基準点のずれ（地図上のピクセル）。位置合わせの精度の目安 */
export function residuals(m: Affine, pairs: ControlPair[]): number[] {
  return pairs.map(({ src, dst }) => {
    const [x, y] = apply(m, src);
    return Math.hypot(x - dst[0], y - dst[1]);
  });
}
