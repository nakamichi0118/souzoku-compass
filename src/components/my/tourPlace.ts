/** 操作ガイドの札をどこに出すか（明るくした場所と、上のメニューの印にかぶらないように） */

export type Box = { top: number; left: number; width: number; height: number };

/** 明るくした枠と札のあいだ（枠の外側 6px + すき間 10px） */
const GAP = 16;
/** 画面の端からの余白 */
const EDGE = 12;

/**
 * 札の位置と、明るく残す場所を決める。
 * 下 → 上 → 右 → 左 の順に、印にかぶらない場所を探す。
 * どこにも入らない（印が画面より大きい）ときは、札を画面の下に出し、明るくする場所を札の上までに縮める
 * @param top ヘッダーの下端（札がヘッダーとメニューの印にかぶらないように）
 */
export function placeCard(
  box: Box | null,
  view: { vw: number; vh: number; top: number },
  card: { w: number; h: number },
): { left: number; top: number; hole: Box | null } {
  const { vw, vh } = view;
  const minTop = view.top + 8;
  const clampTop = (t: number) => Math.min(Math.max(minTop, t), Math.max(minTop, vh - card.h - EDGE));
  const clampLeft = (l: number) => Math.min(Math.max(EDGE, l), Math.max(EDGE, vw - card.w - EDGE));
  if (!box) return { left: clampLeft((vw - card.w) / 2), top: clampTop(vh / 2 - card.h / 2), hole: null };
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  if (bottom + GAP + card.h <= vh - EDGE) return { left: clampLeft(box.left), top: bottom + GAP, hole: box };
  if (box.top - GAP - card.h >= minTop) return { left: clampLeft(box.left), top: box.top - GAP - card.h, hole: box };
  if (vw - right - GAP >= card.w + EDGE) return { left: right + GAP, top: clampTop(box.top), hole: box };
  if (box.left - GAP - card.w >= EDGE) return { left: box.left - GAP - card.w, top: clampTop(box.top), hole: box };
  // 印が大きすぎる：札は下に置き、明るくするのは札より上に見えている部分だけ
  const cardTop = Math.max(minTop, vh - card.h - EDGE);
  const holeTop = Math.max(box.top, view.top + 6);
  const holeBottom = Math.min(bottom, cardTop - GAP);
  const hole = holeBottom - holeTop >= 24 ? { top: holeTop, left: box.left, width: box.width, height: holeBottom - holeTop } : null;
  return { left: clampLeft(box.left), top: cardTop, hole };
}

/** 角の丸い四角を、くり抜き用の線にする（SVG の path） */
export function roundRect(b: Box, r: number): string {
  const { top: y, left: x, width: w, height: h } = b;
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + k} ${y}H${x + w - k}A${k} ${k} 0 0 1 ${x + w} ${y + k}V${y + h - k}A${k} ${k} 0 0 1 ${x + w - k} ${y + h}H${x + k}A${k} ${k} 0 0 1 ${x} ${y + h - k}V${y + k}A${k} ${k} 0 0 1 ${x + k} ${y}Z`;
}
