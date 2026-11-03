import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Progress, ProgressBar, QUICK, isSlow, progressValue, within } from "../ProgressBar";

const ask: Progress = { at: 0.25, until: 0.92, expectSec: 45 };

describe("待ち時間のバーの進み方", () => {
  it("段階の始めは at、目安の時間で段階の 3/4、その2倍で 15/16 まで進む", () => {
    expect(progressValue(ask, 0)).toBe(0.25);
    expect(progressValue(ask, 45)).toBeCloseTo(0.25 + 0.67 * 0.75, 9);
    expect(progressValue(ask, 90)).toBeCloseTo(0.25 + 0.67 * (15 / 16), 9);
  });

  it("時間とともに進み続けるが、段階が終わるまで until には届かない", () => {
    let prev = -1;
    for (const t of [0, 0.5, 1, 5, 20, 45, 60, 120, 300, 1e6, Number.MAX_VALUE]) {
      const v = progressValue(ask, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThan(ask.until);
      prev = v;
    }
    expect(progressValue(ask, 1e9)).toBeCloseTo(0.25 + 0.67 * 0.97, 9);
  });

  it("目安の秒数がない段階は進めない。おかしな値でも 0〜1 に収める", () => {
    expect(progressValue({ at: 0.4, until: 0.6 }, 100)).toBe(0.4);
    expect(progressValue({ at: 0.4, until: 0.6, expectSec: 0 }, 100)).toBe(0.4);
    expect(progressValue(ask, -5)).toBe(0.25);
    expect(progressValue(ask, Number.NaN)).toBe(0.25);
    expect(progressValue({ at: -1, until: 2, expectSec: 1 }, 1e9)).toBeCloseTo(0.97, 9);
    // until が at より前でも戻らない
    expect(progressValue({ at: 0.5, until: 0.2, expectSec: 1 }, 10)).toBe(0.5);
  });

  it("目安の時間を過ぎたら「もう少しかかっています」（短い待ちは 8 秒を過ぎてから）", () => {
    expect(isSlow(ask, 44)).toBe(false);
    expect(isSlow(ask, 46)).toBe(true);
    expect(isSlow(QUICK, 6)).toBe(false);
    expect(isSlow(QUICK, 9)).toBe(true);
    expect(isSlow({ at: 0, until: 1 }, 1000)).toBe(false);
  });

  it("一部の仕事の進み具合を、全体のバーの区間に当てはめる", () => {
    const p = within({ ...ask, since: 123 }, 0, 0.95);
    expect(p.at).toBeCloseTo(0.2375, 9);
    expect(p.until).toBeCloseTo(0.874, 9);
    expect(p.expectSec).toBe(45);
    expect(p.since).toBe(123);
    expect(within({ at: 0, until: 1 }, 0.2, 0.6)).toEqual({ at: 0.2, until: 0.6 });
  });
});

describe("バーの表示", () => {
  const NOW = new Date("2026-11-03T10:00:00+09:00").getTime();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const html = (props: Parameters<typeof ProgressBar>[0]) => renderToStaticMarkup(createElement(ProgressBar, props));

  it("進み具合を progressbar として出し、案内の文は短いまま（…は1つ）", () => {
    const h = html({ message: "コンパスくんが路線価図を読んでいます…", progress: { ...ask, since: NOW } });
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-valuemin="0"');
    expect(h).toContain('aria-valuemax="100"');
    expect(h).toContain('aria-valuenow="25"');
    expect(h).toContain('aria-label="コンパスくんが路線価図を読んでいます"');
    expect(h).toContain(">コンパスくんが路線価図を読んでいます…</p>");
    expect(h).not.toContain("……");
    expect(h).not.toContain("もう少しかかっています");
    expect(h).not.toMatch(/\d+%</); // 数字の％は出さない
  });

  it("目安の時間を過ぎていたら、進んだ位置と「もう少しかかっています」を出す", () => {
    const h = html({ message: "探しています", progress: { ...ask, since: NOW - 60_000 } });
    const now = Number(h.match(/aria-valuenow="(\d+)"/)?.[1]);
    expect(now).toBe(Math.round(progressValue(ask, 60) * 100));
    expect(now).toBeGreaterThan(25);
    expect(now).toBeLessThan(92);
    expect(h).toContain("もう少しかかっています");
  });

  it("進み具合を渡さなければ短い待ちのバー。地図の上の写し（quiet）は読み上げない", () => {
    const h = html({ message: "住所を検索しています", quiet: true });
    expect(h).toContain('aria-valuenow="0"');
    expect(h).toContain('aria-hidden="true"');
    expect(h).not.toContain("aria-live");
    expect(html({ message: "住所を検索しています" })).toContain('aria-live="polite"');
  });
});
