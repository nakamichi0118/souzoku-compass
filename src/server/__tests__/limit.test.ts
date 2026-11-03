import { describe, expect, it } from "vitest";
import { MAX_KEYS, limitKeyCount, overLimit, resetLimit } from "../limit";

describe("回数の制限", () => {
  it("上限までは通し、超えたら止め、リセットで戻る", () => {
    const k = `t:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(overLimit(k, 3, 60_000)).toBe(false);
    expect(overLimit(k, 3, 60_000)).toBe(true);
    resetLimit(k);
    expect(overLimit(k, 3, 60_000)).toBe(false);
  });

  it("キーをいくら増やされても、記録は上限の数までに収まる", () => {
    for (let i = 0; i < MAX_KEYS + 2_000; i++) overLimit(`flood:${i}`, 1, 60_000);
    expect(limitKeyCount()).toBeLessThanOrEqual(MAX_KEYS);
    // 新しいキーはまだ数えている
    expect(overLimit(`flood:${MAX_KEYS + 1_999}`, 1, 60_000)).toBe(true);
  });

  it("とても長いキーは切って数える（記録を大きくしない）", () => {
    const long = `x:${"a".repeat(10_000)}`;
    expect(overLimit(long, 1, 60_000)).toBe(false);
    expect(overLimit(`${long}b`, 1, 60_000)).toBe(true);
  });
});
