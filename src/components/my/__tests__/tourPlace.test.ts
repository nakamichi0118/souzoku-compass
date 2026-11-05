import { describe, expect, it } from "vitest";
import { placeCard } from "../tourPlace";

const view = { vw: 1280, vh: 800, top: 90 };
const card = { w: 360, h: 240 };
const overlaps = (a: { top: number; left: number; width: number; height: number }, c: { top: number; left: number }) =>
  !(c.left + card.w <= a.left || a.left + a.width <= c.left || c.top + card.h <= a.top || a.top + a.height <= c.top);

describe("placeCard", () => {
  it("小さい印なら下に出す", () => {
    const box = { top: 120, left: 40, width: 600, height: 100 };
    const p = placeCard(box, view, card);
    expect(p.top).toBe(236);
    expect(overlaps(box, p)).toBe(false);
  });
  it("縦に長い左の列なら、横に出して印にかぶらない", () => {
    const box = { top: 110, left: 30, width: 380, height: 680 };
    const p = placeCard(box, view, card);
    expect(overlaps(box, p)).toBe(false);
    expect(p.top).toBeGreaterThanOrEqual(view.top);
  });
  it("スマホで画面いっぱいの印なら、札を下に置き、明るくするのは札より上だけ", () => {
    const sp = { vw: 390, vh: 780, top: 80 };
    const box = { top: 90, left: 10, width: 370, height: 1400 };
    const p = placeCard(box, sp, { w: 366, h: 240 });
    expect(p.top).toBe(780 - 240 - 12);
    expect(p.hole).not.toBeNull();
    expect(p.hole!.top + p.hole!.height).toBeLessThanOrEqual(p.top);
  });
  it("上に出すときは、ヘッダー（メニューの印）にかぶらない", () => {
    const box = { top: 560, left: 40, width: 600, height: 220 };
    const p = placeCard(box, view, card);
    expect(p.top).toBeGreaterThanOrEqual(view.top);
    expect(overlaps(box, p)).toBe(false);
  });
});
