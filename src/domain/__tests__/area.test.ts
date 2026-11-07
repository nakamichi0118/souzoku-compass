/**
 * 計算に使う面積の桁（0.01㎡、未満は切り捨て）。入力と計算で桁の決め方が揺れないこと（Codex 1000件検証の指摘：
 * 所有面積 172.875㎡ は四捨五入で 172.88㎡、選択面積 67.745㎡ は切り捨てで 67.74㎡ と、決め方が別だった）
 */
import { describe, expect, it } from "vitest";
import { area100, areaTrimmed, usedArea } from "../area";
import { perSqmTimesArea, smallResidentialSelection } from "../valuation";

describe("計算に使う面積", () => {
  it("0.01㎡未満は切り捨てる（掛け算の誤差で揺れない）", () => {
    expect(area100(172.875)).toBe(17287);
    expect(area100(67.745)).toBe(6774);
    expect(area100(0.29)).toBe(29);
    expect(area100(1.005)).toBe(100);
    expect(area100(330)).toBe(33000);
    expect(usedArea(172.875)).toBe(172.87);
  });

  it("0.01㎡未満の端数があるときだけ、計算に使う面積を見せる", () => {
    expect(areaTrimmed(172.875)).toBe(true);
    expect(areaTrimmed(67.745)).toBe(true);
    expect(areaTrimmed(172.87)).toBe(false);
    expect(areaTrimmed(0.29)).toBe(false);
    expect(areaTrimmed(undefined)).toBe(false);
    expect(areaTrimmed(0)).toBe(false);
  });

  it("土地の評価額と小規模宅地等の特例は、切り捨てた面積で計算する", () => {
    expect(perSqmTimesArea(100_000, 172.875)).toBe(17_287_000);
    // ⑥ = 評価額 × 330 / 400.005（→ 400.00㎡）
    expect(smallResidentialSelection(40_000_000, 400.005)).toMatchObject({ selectedArea: 330, selectedValue: 33_000_000 });
  });
});
