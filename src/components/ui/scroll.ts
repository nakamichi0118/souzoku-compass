/** 画面の送り方の小さな道具（上に固定した見出しの下に出す・横に並んだ帯で、いまの項目を見せる） */

/** 上に固定した見出し（header）の下端の位置。固定していなければ 0 */
export function headerBottom(): number {
  const head = document.querySelector("header");
  if (!head || !["sticky", "fixed"].includes(getComputedStyle(head).position)) return 0;
  return Math.max(0, head.getBoundingClientRect().bottom);
}

/** 画面を y まで送る（動きを減らす設定のときは、すぐに送る） */
export function scrollToY(y: number) {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: Math.max(0, y), behavior: reduce ? "auto" : "smooth" });
}

/** 要素を、上に固定した見出しのすぐ下に出す（見出しの高さは、そのときの高さを測る） */
export function scrollBelowHeader(el: HTMLElement, gap = 12) {
  scrollToY(window.scrollY + el.getBoundingClientRect().top - headerBottom() - gap);
}

/** 要素の頭が見出しに隠れている（または画面より上にある）ときだけ、見出しのすぐ下に出す */
export function revealBelowHeader(el: HTMLElement, gap = 12) {
  if (el.getBoundingClientRect().top < headerBottom() + 4) scrollBelowHeader(el, gap);
}

interface Strip {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  getBoundingClientRect(): { left: number };
  querySelector(sel: string): { offsetWidth: number; getBoundingClientRect(): { left: number } } | null;
}

/**
 * 横に送れる帯（メニュー・ステップ）で、いまの項目（aria-current）が真ん中に来るよう帯だけを横へ送る。
 * 画面全体は動かさない。帯に収まっているときは何もしない
 */
export function centerCurrent(strip: Strip | null | undefined) {
  const cur = strip?.querySelector("[aria-current]");
  if (!strip || !cur || strip.scrollWidth <= strip.clientWidth) return;
  const offset = cur.getBoundingClientRect().left - strip.getBoundingClientRect().left;
  const left = strip.scrollLeft + offset - (strip.clientWidth - cur.offsetWidth) / 2;
  strip.scrollLeft = Math.max(0, Math.min(left, strip.scrollWidth - strip.clientWidth));
}
