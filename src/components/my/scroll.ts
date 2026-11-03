/** マイページで、選んだ項目を画面の上（固定した見出しのすぐ下）に出すための小さな道具 */

/** 画面の上に固定した見出し（ヘッダー）の下の端。固定していなければ 0 */
export function headerBottom(): number {
  const head = document.querySelector("header");
  if (!head) return 0;
  const pos = getComputedStyle(head).position;
  return pos === "sticky" || pos === "fixed" ? Math.max(0, head.getBoundingClientRect().bottom) : 0;
}

/** 要素の上の端を、見出しの下の端から gap だけあけたところに出すときの、画面の送り先 */
export function topBelowHeader(scrollY: number, elTop: number, headBottom: number, gap = 8): number {
  return Math.max(0, Math.round(scrollY + elTop - headBottom - gap));
}

/** パソコンの幅（lg 以上）。やることリストでは一覧と詳細が横に並ぶ */
export function isWide(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 1024px)").matches;
}

/**
 * 要素の上の端が見出しのすぐ下に来るよう、画面を送る。
 * 描画が終わってから測る（要素は get で、そのときに探す）。
 * phoneOnly のときは、パソコンの幅では何もしない。smooth でも、動きを減らす設定のときはすぐに送る
 */
export function showBelowHeader(get: () => HTMLElement | null | undefined, { smooth = true, phoneOnly = false, gap = 8 } = {}) {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => {
    const el = get();
    if (!el || (phoneOnly && isWide())) return;
    const reduce = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: topBelowHeader(window.scrollY, el.getBoundingClientRect().top, headerBottom(), gap), behavior: smooth && !reduce ? "smooth" : "auto" });
  });
}
