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

/** 目立たせる枠（直す場所・答えていない質問へ送ったとき） */
const FLASH = ["ring-4", "ring-amber-300", "ring-offset-2"];

/** 要素を画面の真ん中あたりへ送り、少しのあいだ枠で目立たせる */
export function flashInto(el: HTMLElement) {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  el.classList.add(...FLASH);
  window.setTimeout(() => el.classList.remove(...FLASH), 2500);
}

/**
 * 印（data-focus="id"）のついた要素へ送って目立たせる。画面を描き終わる前でも見つかるまで少し待つ（最大およそ2秒）。
 * 見つかったら true
 */
export function focusMark(id: string, tries = 20): Promise<boolean> {
  return new Promise((resolve) => {
    const tick = (n: number) => {
      const el = document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(id)}"]`);
      if (el) {
        flashInto(el);
        resolve(true);
      } else if (n <= 0) resolve(false);
      else window.setTimeout(() => tick(n - 1), 100);
    };
    tick(tries);
  });
}

/** 印（data-missing）のついた最初の要素（答えていない質問・入れていない欄）へ送る。なければ false */
export function focusFirstMissing(root: ParentNode = document): boolean {
  const el = root.querySelector<HTMLElement>("[data-missing]");
  if (!el) return false;
  flashInto(el);
  return true;
}
