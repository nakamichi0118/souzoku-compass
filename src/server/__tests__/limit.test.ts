import { describe, expect, it } from "vitest";
import { overLimit, resetLimit } from "../limit";

describe("回数の制限", () => {
  it("上限までは通し、超えたら止め、リセットで戻る", () => {
    const k = `t:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(overLimit(k, 3, 60_000)).toBe(false);
    expect(overLimit(k, 3, 60_000)).toBe(true);
    resetLimit(k);
    expect(overLimit(k, 3, 60_000)).toBe(false);
  });
});
