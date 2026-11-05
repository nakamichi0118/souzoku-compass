/**
 * 評価を下げられるのに相続コンパスでは計算しない土地（地積規模の大きな宅地・形がいびつ・セットバック）は、
 * 止めずに減額しない評価額で計算し、減額していないことを説明に書く（相談するかは本人が選ぶ）。配偶者居住権は税理士への相談を案内する。
 */
import { describe, expect, it } from "vitest";
import { largeLotThreshold, pendingReductions, prefectureOf, valueLand } from "../valuation";
import type { LandAsset } from "../types";

const land = (p: Partial<LandAsset> = {}): LandAsset => ({
  id: "l",
  kind: "land",
  label: "自宅",
  location: "千葉県船橋市本町一丁目",
  areaSqm: 300,
  landUse: "宅地",
  method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1 },
  ...p,
});

describe("都道府県と地積規模の大きな宅地の面積（財産評価基本通達20-2）", () => {
  it("所在の先頭から都道府県を読む", () => {
    expect(prefectureOf("東京都大田区田園調布三丁目")).toBe("東京都");
    expect(prefectureOf("京都府京都市")).toBe("京都府");
    expect(prefectureOf(" 北海道札幌市")).toBe("北海道");
    expect(prefectureOf("鹿児島県鹿児島市")).toBe("鹿児島県");
    expect(prefectureOf("船橋市本町")).toBeUndefined();
    expect(prefectureOf(undefined)).toBeUndefined();
  });
  it("三大都市圏を含む都府県と、分からないときは500㎡、それ以外は1,000㎡", () => {
    for (const p of ["東京都", "神奈川県", "埼玉県", "千葉県", "茨城県", "京都府", "大阪府", "兵庫県", "奈良県", "愛知県", "三重県"])
      expect(largeLotThreshold(`${p}どこか`)).toBe(500);
    expect(largeLotThreshold("x")).toBe(500);
    expect(largeLotThreshold("")).toBe(500);
    for (const p of ["北海道", "宮城県", "静岡県", "岐阜県", "滋賀県", "福岡県", "沖縄県"]) expect(largeLotThreshold(`${p}どこか`)).toBe(1000);
  });
});

/** 減額していない事情として評価の説明に書いたか */
const noted = (v: ReturnType<typeof valueLand>, word: string) => v.steps.some((s) => s.includes(word) && s.includes("していません"));

describe("地積規模の大きな宅地にあたりうる土地は止めず、減額しない評価額で計算する（相談するかは本人が選ぶ）", () => {
  it("千葉県の普通住宅地区（地区の指定なし）で500㎡以上", () => {
    const v = valueLand(land({ areaSqm: 500 }));
    expect(v.needsConsultation).toBeUndefined();
    expect(v.value).toBe(100_000_000);
    expect(noted(v, "500㎡以上の広い宅地")).toBe(true);
    expect(pendingReductions(land({ areaSqm: 500 }))).toEqual(["largeLot"]);
    expect(pendingReductions(land({ areaSqm: 499.99 }))).toEqual([]);
    expect(valueLand(land({ areaSqm: 499.99 })).value).toBe(99_998_000); // 200,000 × 499.99
  });
  it("三大都市圏以外は1,000㎡以上", () => {
    expect(pendingReductions(land({ location: "北海道札幌市", areaSqm: 999.99 }))).toEqual([]);
    expect(noted(valueLand(land({ location: "北海道札幌市", areaSqm: 1000 })), "1,000㎡以上")).toBe(true);
  });
  it("所在の都道府県が分からなければ500㎡以上", () => {
    expect(pendingReductions(land({ location: "x", areaSqm: 500 }))).toEqual(["largeLot"]);
  });
  it("普通商業・併用住宅地区、倍率方式の宅地も対象", () => {
    expect(pendingReductions(land({ areaSqm: 600, method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1, district: "普通商業・併用住宅地区" } }))).toEqual(["largeLot"]);
    const m = valueLand(land({ areaSqm: 600, method: { type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1 } }));
    expect(m.value).toBe(11_000_000);
    expect(noted(m, "地積規模の大きな宅地")).toBe(true);
  });
  it("ほかの地区・宅地でない土地・評価額を直接入力した土地は対象外", () => {
    for (const district of ["ビル街地区", "高度商業地区", "繁華街地区", "中小工場地区", "大工場地区"] as const) {
      expect(pendingReductions(land({ areaSqm: 2000, method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1, district } }))).toEqual([]);
    }
    expect(pendingReductions(land({ areaSqm: 2000, landUse: "畑", method: { type: "multiplier", fixedAssetValue: 1_000_000, multiplier: 1.1 } }))).toEqual([]);
    expect(valueLand(land({ areaSqm: 2000, method: { type: "manual", value: 50_000_000 } })).value).toBe(50_000_000);
  });
  it("人に貸している土地・借地権でも、自用地の評価が対象になるので減額していないと書く", () => {
    const v = valueLand(land({ areaSqm: 800, use: "leasehold", leaseRatio: 0.6 }));
    expect(v.needsConsultation).toBeUndefined();
    expect(v.value).toBe(96_000_000); // 200,000 × 800 × 0.6
    expect(noted(v, "地積規模の大きな宅地")).toBe(true);
  });
});

describe("評価に影響する土地の事情", () => {
  it("配偶者居住権 → 確定せず税理士へ", () => {
    const v = valueLand(land({ condition: "spouseResidence" }));
    expect(v.value).toBe(0);
    expect(v.needsConsultation).toContain("配偶者居住権");
    expect(v.needsConsultation).toContain("税理士");
  });
  it.each([
    ["irregular", "不整形地の補正"],
    ["setback", "セットバックの減額"],
  ] as const)("%s は止めず、減額しない評価額で計算して説明に書く（減額しかないので、相談するかは本人が選ぶ）", (condition, word) => {
    const v = valueLand(land({ condition }));
    expect(v.needsConsultation).toBeUndefined();
    expect(v.value).toBe(60_000_000);
    expect(noted(v, word)).toBe(true);
    // 補正率を入れたらその率で計算し、減額していないとは書かない
    const r = valueLand(land({ condition, method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1, otherCorrection: 0.9 } }));
    expect(r.value).toBe(54_000_000);
    expect(noted(r, word)).toBe(false);
  });
  it("事情がなければ今までどおり（200,000 × 300㎡）", () => {
    expect(valueLand(land()).value).toBe(60_000_000);
  });
});

describe("修正した補正率・評価額を入れた土地は計算する", () => {
  it("形がいびつ・セットバックでも、修正した補正率（0より大きく1以下）を入れれば、その補正率で計算する", () => {
    const m = { type: "rosenka" as const, routePrice: 200_000, depthCorrection: 1, otherCorrection: 0.9 };
    expect(pendingReductions(land({ condition: "irregular" }))).toEqual(["irregular"]);
    expect(valueLand(land({ condition: "irregular", method: m })).value).toBe(54_000_000); // 20万×0.9×300㎡
    expect(pendingReductions(land({ condition: "irregular", method: m }))).toEqual([]);
    // 税理士に「減額なし」と確認した 1 も、確認した答えとして計算する
    expect(valueLand(land({ condition: "irregular", method: { ...m, otherCorrection: 1 } })).value).toBe(60_000_000);
    expect(valueLand(land({ condition: "setback", method: { ...m, otherCorrection: 1 } })).value).toBe(60_000_000);
    // 0以下の補正率は確認した答えにならない（減額しない評価額のまま）。1を超える補正率は直すよう止める
    for (const otherCorrection of [0, -0.5, Number.NaN]) expect(pendingReductions(land({ condition: "irregular", method: { ...m, otherCorrection } }))).toEqual(["irregular"]);
    expect(valueLand(land({ condition: "irregular", method: { ...m, otherCorrection: 1.2 } })).needsConsultation).toContain("1を超えています");
  });
  it("広い土地も、修正した補正率か直接入力の評価額があれば、その額で計算する", () => {
    expect(pendingReductions(land({ areaSqm: 600 }))).toEqual(["largeLot"]);
    expect(valueLand(land({ areaSqm: 600, method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1, otherCorrection: 0.8 } })).value).toBe(96_000_000);
    expect(valueLand(land({ areaSqm: 600, method: { type: "manual", value: 90_000_000 } })).value).toBe(90_000_000);
    // 「地積規模の大きな宅地にあたらない（減額なし）」と確認したら 1 を入れて計算できる
    expect(valueLand(land({ areaSqm: 600, method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1, otherCorrection: 1 } })).value).toBe(120_000_000);
  });
  it("配偶者居住権は、補正率でも直接入力の評価額でも計算せず、いつも税理士へ（家と土地を4つに分けて評価し、小規模宅地等も変わるため）", () => {
    for (const method of [
      { type: "rosenka" as const, routePrice: 200_000, depthCorrection: 1, otherCorrection: 0.9 },
      { type: "rosenka" as const, routePrice: 200_000, depthCorrection: 1, otherCorrection: 1 },
      { type: "multiplier" as const, fixedAssetValue: 10_000_000, multiplier: 1.1 },
      { type: "manual" as const, value: 30_000_000 },
    ]) {
      const v = valueLand(land({ condition: "spouseResidence", method }));
      expect(v.value).toBe(0);
      expect(v.needsConsultation).toContain("配偶者居住権");
      expect(v.needsConsultation).toContain("4つに分けて");
      expect(v.needsConsultation).toContain("小規模宅地等");
      expect(v.needsConsultation).toContain("税理士にご相談ください");
      // 直接入力の案内はしない（入れても計算しないため）
      expect(v.needsConsultation).not.toContain("直接入力");
    }
  });
});
