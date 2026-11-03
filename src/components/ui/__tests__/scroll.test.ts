import { afterEach, describe, expect, it, vi } from "vitest";
import { centerCurrent, revealBelowHeader } from "../scroll";

/** 横に送れる帯の代わり（left は画面上の位置） */
function strip({ width, content, scrollLeft = 0, cur }: { width: number; content: number; scrollLeft?: number; cur?: { at: number; width: number } }) {
  const s = {
    scrollLeft,
    scrollWidth: content,
    clientWidth: width,
    getBoundingClientRect: () => ({ left: 16 }),
    // 項目の画面上の位置は、帯の左端 + 帯の中の位置 − いま横へ送った量
    querySelector: () => (cur ? { offsetWidth: cur.width, getBoundingClientRect: () => ({ left: 16 + cur.at - s.scrollLeft }) } : null),
  };
  return s;
}

describe("横に送れる帯で、いまの項目を見せる（centerCurrent）", () => {
  it("帯に収まらないときは、いまの項目が真ん中に来るよう帯を横へ送る", () => {
    const s = strip({ width: 328, content: 700, cur: { at: 500, width: 70 } });
    centerCurrent(s);
    expect(s.scrollLeft).toBe(500 - (328 - 70) / 2);
    // 送ったあと、項目は帯の中に見えている
    const left = 500 - s.scrollLeft;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + 70).toBeLessThanOrEqual(328);
  });

  it("すでに横へ送ってあっても同じ位置にする（何度呼んでもずれない）", () => {
    const s = strip({ width: 328, content: 700, scrollLeft: 200, cur: { at: 500, width: 70 } });
    centerCurrent(s);
    const once = s.scrollLeft;
    centerCurrent(s);
    expect(s.scrollLeft).toBe(once);
    expect(once).toBe(371);
  });

  it("端の項目は、送りすぎない（0 〜 いちばん右まで）", () => {
    const first = strip({ width: 328, content: 700, scrollLeft: 300, cur: { at: 0, width: 80 } });
    centerCurrent(first);
    expect(first.scrollLeft).toBe(0);
    const last = strip({ width: 328, content: 700, cur: { at: 640, width: 60 } });
    centerCurrent(last);
    expect(last.scrollLeft).toBe(700 - 328);
  });

  it("帯に収まっているとき・いまの項目がないとき・帯がないときは何もしない", () => {
    const fits = strip({ width: 900, content: 900, scrollLeft: 0, cur: { at: 500, width: 70 } });
    centerCurrent(fits);
    expect(fits.scrollLeft).toBe(0);
    const none = strip({ width: 328, content: 700, scrollLeft: 40 });
    centerCurrent(none);
    expect(none.scrollLeft).toBe(40);
    expect(() => centerCurrent(null)).not.toThrow();
  });
});

describe("見出しに隠れた要素だけを、見出しのすぐ下に出す（revealBelowHeader）", () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = (headerBottom: number, position = "sticky") => {
    const scrollTo = vi.fn();
    vi.stubGlobal("document", { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: headerBottom }) }) });
    vi.stubGlobal("getComputedStyle", () => ({ position }));
    vi.stubGlobal("window", { scrollY: 1000, scrollTo, matchMedia: () => ({ matches: false }) });
    return scrollTo;
  };
  const el = (top: number) => ({ getBoundingClientRect: () => ({ top }) }) as unknown as HTMLElement;

  it("頭が見出しの下に隠れているときは、見出しのすぐ下まで戻す", () => {
    const scrollTo = setup(86);
    revealBelowHeader(el(-180));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 - 180 - 86 - 12, behavior: "smooth" });
  });

  it("頭が見えているときは動かさない", () => {
    const scrollTo = setup(86);
    revealBelowHeader(el(120));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("見出しを固定していない画面では、画面の上端を基準にする", () => {
    const scrollTo = setup(86, "static");
    revealBelowHeader(el(50));
    expect(scrollTo).not.toHaveBeenCalled();
    revealBelowHeader(el(-20));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 - 20 - 12, behavior: "smooth" });
  });
});
