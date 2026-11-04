/**
 * 評価倍率表のページの中で、コンパスくんが選んだ行がどこに書かれているかを探す（ページの文字の位置から求める。推測はしない）。
 * 見つけた帯は、プレビューの画像の上に枠として重ねる。
 */

/** ページの文字1つ分のかたまり。左上を原点に、ページの幅・高さに対する割合（0〜1） */
export interface TextBox {
  str: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 行の帯。ページの幅・高さに対する割合（0〜1） */
export interface RowBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 比べるときの文字のそろえ方：全角・半角の違い、空白、「ヶ」「ケ」「が」の違い、「大字」の有無をそろえる */
export const normText = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[ヶケが]/g, "ケ")
    .replace(/^大字/, "");

/** 同じ高さに並ぶ文字を1行にまとめる（上から順、行の中は左から順） */
export function toLines(items: TextBox[]): TextBox[][] {
  const xs = items.filter((x) => x.str.trim() && x.bottom > x.top).sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: TextBox[][] = [];
  for (const x of xs) {
    const mid = (x.top + x.bottom) / 2;
    // 高さの中ほどが、いまの行の上下の範囲に入っていれば同じ行
    const line = lines.find((l) => {
      const top = Math.min(...l.map((y) => y.top));
      const bottom = Math.max(...l.map((y) => y.bottom));
      return mid >= top && mid <= bottom;
    });
    if (line) line.push(x);
    else lines.push([x]);
  }
  return lines.map((l) => l.sort((a, b) => a.left - b.left));
}

/**
 * 選んだ行（町（丁目）・大字と適用地域）が書かれている帯を探す。
 * 1. 町名と適用地域の両方が書かれた行（宅地の倍率・借地権割合も合えばそちら）
 * 2. 町名の欄がまとめて1回だけ書かれた表では、町名の行より下で、いちばん近い適用地域の行
 * 3. 適用地域が見つからなければ、町名の行
 * どれもなければ null（推測で枠を出さない）
 */
export function findRowBox(items: TextBox[], row: { town: string; area: string; residential?: string | null; leaseRatio?: string | null }): RowBox | null {
  const t = normText(row.town);
  const a = normText(row.area);
  if (!t) return null;
  // 適用地域が長くて折り返されているときに備えて、頭の部分だけでも当てる
  const aKey = a.length > 8 ? a.slice(0, 8) : a;
  const extra = [row.residential, row.leaseRatio].map((x) => normText(x ?? "")).filter(Boolean);
  const lines = toLines(items).map((line) => {
    const cells = line.map((x) => normText(x.str));
    const text = cells.join("");
    return {
      line,
      // 「東」のような短い町名は、ほかの言葉の一部（「東町」「以東」）に当たりやすいので、欄の文字と同じときだけ数える
      town: cells.includes(t) ? 3 : t.length >= 3 && text.includes(t) ? 2 : 0,
      area: !a ? 0 : cells.includes(a) ? 2 : aKey.length >= 2 && text.includes(aKey) ? 1 : 0,
      extra: extra.filter((x) => cells.includes(x)).length * 0.5,
    };
  });
  const bestOf = <T extends { town: number; area: number; extra: number }>(xs: T[]) => xs.reduce<T | null>((b, x) => (!b || x.town + x.area + x.extra > b.town + b.area + b.extra ? x : b), null);
  let best = bestOf(lines.filter((x) => x.town && x.area));
  if (!best && a) {
    // 町名の行より下の、いちばん近い適用地域の行（離れすぎた行は、別の町の行とみなして選ばない）
    const below = lines.map((x, i) => ({ ...x, i, from: lines.slice(0, i + 1).findLastIndex((y) => y.town > 0) })).filter((x) => x.area && x.from >= 0 && x.i - x.from <= 6);
    best = below.sort((p, q) => p.i - p.from - (q.i - q.from) || q.extra - p.extra)[0] ?? null;
  }
  best ??= bestOf(lines.filter((x) => x.town));
  if (!best) return null;
  const l = best.line;
  const top = Math.min(...l.map((x) => x.top));
  const bottom = Math.max(...l.map((x) => x.bottom));
  // 文字の上下に少し余白をとって、表の1行ぶんに見えるようにする
  const pad = (bottom - top) * 0.45;
  return {
    left: Math.max(0, Math.min(...l.map((x) => x.left)) - 0.006),
    top: Math.max(0, top - pad),
    right: Math.min(1, Math.max(...l.map((x) => x.right)) + 0.006),
    bottom: Math.min(1, bottom + pad),
  };
}

/**
 * PDF.js が返すページの文字（PDF の座標）を、左上が原点の割合に直す。
 * transform [a, b, c, d, e, f] の (e, f) が文字の始まり（左下）、(a, b) が文字の進む向き、(c, d) が上の向き。
 * 4つの角を toView（ページの表示の座標へ直す関数。回転や原点のずれも直す）で写して、囲む箱にする
 */
export function fromPdfText(
  items: { str: string; transform: number[]; width: number; height: number }[],
  toView: (x: number, y: number) => number[],
  viewWidth: number,
  viewHeight: number,
): TextBox[] {
  return items.map((it) => {
    const [a, b, c, d, e, f] = it.transform;
    const ul = Math.hypot(a, b) || 1;
    const vl = Math.hypot(c, d) || 1;
    const h = it.height || vl;
    const [ux, uy] = [(a / ul) * it.width, (b / ul) * it.width];
    const [vx, vy] = [(c / vl) * h, (d / vl) * h];
    const pts = [toView(e, f), toView(e + ux, f + uy), toView(e + vx, f + vy), toView(e + ux + vx, f + uy + vy)];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { str: it.str, left: Math.min(...xs) / viewWidth, right: Math.max(...xs) / viewWidth, top: Math.min(...ys) / viewHeight, bottom: Math.max(...ys) / viewHeight };
  });
}
