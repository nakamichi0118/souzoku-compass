import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LandAsset } from "@/domain/types";
import { RatioPanel, ratioStep3 } from "../RatioPanel";

const land = (p: Partial<LandAsset> = {}): LandAsset => ({
  id: "L1",
  kind: "land",
  label: "",
  location: "北海道札幌市1-2",
  areaSqm: 200,
  landUse: "宅地",
  method: { type: "rosenka", routePrice: 0, depthCorrection: 1 },
  ...p,
});
const row = { city: "札幌市", town: "中央", pdfUrl: "https://www.rosenka.nta.go.jp/x.pdf", page: 3 };

describe("倍率方式「3.」の評価と反映 ui-3", () => {
  it("確かめた行の借地権割合で評価する（土地にまだ借地権割合が入っていなくても）", () => {
    const a = land({ use: "rentedHouse" });
    const r = ratioStep3(a, { fav: 10_000_000, multiplier: 1.1, area: 200, confirmed: row, confirmedLease: { ratio: 0.6 } });
    expect(r.valuation.needsConsultation).toBeUndefined();
    // 11,000,000 ×（1 − 0.6 × 0.3 × 1）
    expect(r.valuation.value).toBe(9_020_000);
    expect(r.valuation.usage).toBe("貸家建付地");
    expect(r.canApply).toBe(true);
    expect(r.method).toEqual({ type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1, source: row });
  });

  it("行の借地権割合が読めないとき・自分で倍率を入れたときは、土地の画面の借地権割合を使う", () => {
    const a = land({ use: "leasehold", leaseRatio: 0.5 });
    expect(ratioStep3(a, { fav: 10_000_000, multiplier: 1.1, area: 200, confirmed: row, confirmedLease: { ratio: undefined } }).valuation.value).toBe(5_500_000);
    expect(ratioStep3(a, { fav: 10_000_000, multiplier: 1.1, area: 200, confirmedLease: { ratio: 0.6 } }).valuation.value).toBe(5_500_000);
  });

  it("相談が必要な土地でも、倍率・地積・固定資産税評価額がそろえば反映できる（借地権割合が分からない・広い宅地・事情がある）", () => {
    const missingLease = ratioStep3(land({ use: "leasedLand" }), { fav: 10_000_000, multiplier: 1.1, area: 200 });
    expect(missingLease.valuation.needsConsultation).toContain("借地権割合");
    expect(missingLease.canApply).toBe(true);
    // 三大都市圏以外で1,000㎡以上の宅地（地積規模の大きな宅地）
    const big = ratioStep3(land(), { fav: 30_000_000, multiplier: 1.1, area: 1_200 });
    expect(big.valuation.needsConsultation).toContain("地積規模の大きな宅地");
    expect(big.canApply).toBe(true);
    // 形がいびつな雑種地は、近くの宅地と比べて形の補正をすることがあるので相談
    const irregular = ratioStep3(land({ condition: "irregular", landUse: "雑種地" }), { fav: 10_000_000, multiplier: 1.1, area: 200 });
    expect(irregular.valuation.needsConsultation).toBeTruthy();
    expect(irregular.canApply).toBe(true);
  });

  it("倍率方式の宅地は、形がいびつでも固定資産税評価額 × 倍率で評価する（形は固定資産税評価額に反映されている。通達21-2・valuation-2）", () => {
    const r = ratioStep3(land({ condition: "irregular" }), { fav: 10_000_000, multiplier: 1.1, area: 200 });
    expect(r.valuation.needsConsultation).toBeUndefined();
    expect(r.valuation.value).toBe(11_000_000);
    expect(r.canApply).toBe(true);
  });

  it("倍率・地積・固定資産税評価額のどれかがなければ反映できない", () => {
    expect(ratioStep3(land(), { fav: 0, multiplier: 1.1, area: 200 }).canApply).toBe(false);
    expect(ratioStep3(land(), { fav: 10_000_000, multiplier: 0, area: 200 }).canApply).toBe(false);
    expect(ratioStep3(land(), { fav: 10_000_000, multiplier: 1.1, area: 0 }).canApply).toBe(false);
    expect(ratioStep3(land(), { fav: 10_000_000, multiplier: 1.1, area: 200 }).canApply).toBe(true);
  });

  const panel = (a: LandAsset) =>
    renderToStaticMarkup(
      createElement(RatioPanel, { step: 3, setStep: () => {}, land: a, property: [43.06, 141.35], cache: new Map(), onApply: () => {}, onUseRosenka: () => {} }),
    );
  const button = (h: string) => h.match(/<button[^>]*>この評価を反映して財産の入力へ戻る<\/button>/)?.[0] ?? "";

  it("相談の理由そのものを画面に出し、反映のボタンは押せる", () => {
    const h = panel(land({ use: "leasedLand", method: { type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1, source: row } }));
    expect(h).toContain("借地権割合が分かりません");
    expect(h).not.toContain("固定資産税評価額を入れると評価額を計算します。");
    expect(button(h)).not.toBe("");
    expect(button(h)).not.toContain('disabled=""');
  });

  it("固定資産税評価額がまだなら、入れるよう案内してボタンは押せない", () => {
    const h = panel(land({ method: { type: "multiplier", fixedAssetValue: 0, multiplier: 1.1, source: row } }));
    expect(h).toContain("固定資産税評価額を入れると評価額を計算します。");
    expect(button(h)).toContain('disabled=""');
  });
});
