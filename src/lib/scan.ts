/**
 * 書類の撮影：写真の中の書類の四隅を見つけ（明るい紙を、暗めの机などから切り分ける）、
 * 斜めに写った書類を正面から見た長方形に直す。
 * ここは計算だけ（画面やカメラには触らない）なので、テストで確かめられる。
 */

export interface Pt {
  x: number;
  y: number;
}
/** 左上・右上・右下・左下の順（0〜1 の割合） */
export type Quad = [Pt, Pt, Pt, Pt];

/** RGBA の画素から明るさ（0〜255）を出す */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  return g;
}

/** 明るさの分かれ目（大津の方法） */
export function otsu(g: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of g) hist[v]++;
  const total = g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let at = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      at = t;
    }
  }
  return at;
}

const area = (q: Pt[]) => {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
};

/** 四隅が凸の四角形になっているか（ねじれていないか） */
export function isConvex(q: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (z === 0) return false;
    const s = Math.sign(z);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/**
 * 明るさの画像（小さく縮めたもの）から書類の四隅を探す。見つからなければ null。
 * いちばん大きい明るいかたまりを書類とみなし、その角（x+y・x−y が最大・最小の点）を四隅にする。
 */
export function detectQuad(g: Uint8Array, w: number, h: number): Quad | null {
  const t = otsu(g);
  // 明暗の差がほとんどない（白い机の上・真っ暗など）ときは探さない
  let lo = 0;
  let hi = 0;
  let nLo = 0;
  let nHi = 0;
  for (const v of g) {
    if (v > t) {
      hi += v;
      nHi++;
    } else {
      lo += v;
      nLo++;
    }
  }
  if (!nLo || !nHi || hi / nHi - lo / nLo < 40) return null;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let bestPix: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || g[s] <= t) continue;
    let n = 0;
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    const pix: number[] = [];
    while (top > 0) {
      const p = stack[--top];
      pix.push(p);
      n++;
      const x = p % w;
      const y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && !seen[q] && g[q] > t) {
          seen[q] = 1;
          stack[top++] = q;
        }
      }
    }
    if (n > bestPix.length) bestPix = pix;
  }
  const n = bestPix.length;
  if (n < w * h * 0.12 || n > w * h * 0.97) return null;
  let tl = bestPix[0];
  let tr = tl;
  let br = tl;
  let bl = tl;
  const xy = (p: number) => [p % w, Math.floor(p / w)] as const;
  for (const p of bestPix) {
    const [x, y] = xy(p);
    const [ax, ay] = xy(tl);
    const [bx, by] = xy(tr);
    const [cx, cy] = xy(br);
    const [dx, dy] = xy(bl);
    if (x + y < ax + ay) tl = p;
    if (x - y > bx - by) tr = p;
    if (x + y > cx + cy) br = p;
    if (x - y < dx - dy) bl = p;
  }
  const q = [tl, tr, br, bl].map((p) => {
    const [x, y] = xy(p);
    return { x: (x + 0.5) / w, y: (y + 0.5) / h };
  }) as Quad;
  if (!isConvex(q)) return null;
  // かたまりがほぼ四角形を埋めていること（紙ではない明るいもの・影の形を除く）
  const fill = n / (w * h) / area(q);
  if (fill < 0.85 || fill > 1.15) return null;
  return q;
}

/** 四隅が見つからないときの初めの枠（少し内側の長方形） */
export const DEFAULT_QUAD: Quad = [
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 },
];

/** 連立方程式を解く（ガウスの消去法）。解けなければ null */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** from の4点を to の4点へ写す射影変換（3×3 の行列を9個の数で） */
export function homography(from: Pt[], to: Pt[]): number[] | null {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(a, b);
  return h ? [...h, 1] : null;
}

export function apply(h: number[], p: Pt): Pt {
  const d = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / d, y: (h[3] * p.x + h[4] * p.y + h[5]) / d };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** 切り出したあとの大きさ（長い辺を max までにする） */
export function outputSize(q: Pt[], max = 2000): { w: number; h: number } {
  const w0 = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  const h0 = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const s = Math.min(1, max / Math.max(w0, h0, 1));
  return { w: Math.max(1, Math.round(w0 * s)), h: Math.max(1, Math.round(h0 * s)) };
}

/**
 * 斜めに写った書類を長方形に直す。q は元の画像の画素の位置。
 * 出来上がりの各画素について元の位置を逆算し、まわり4画素の色を混ぜる。
 */
export function warp(src: { data: Uint8ClampedArray; width: number; height: number }, q: Pt[], max = 2000): { data: Uint8ClampedArray; width: number; height: number } | null {
  const { w, h } = outputSize(q, max);
  const H = homography(
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    q,
  );
  if (!H) return null;
  const out = new Uint8ClampedArray(w * h * 4);
  const sw = src.width;
  const sh = src.height;
  const s = src.data;
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const d = H[6] * (u + 0.5) + H[7] * (v + 0.5) + H[8];
      const x = Math.min(sw - 1.001, Math.max(0, (H[0] * (u + 0.5) + H[1] * (v + 0.5) + H[2]) / d - 0.5));
      const y = Math.min(sh - 1.001, Math.max(0, (H[3] * (u + 0.5) + H[4] * (v + 0.5) + H[5]) / d - 0.5));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (v * w + u) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] * (1 - fx) + s[i10 + c] * fx;
        const bot = s[i01 + c] * (1 - fx) + s[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}
