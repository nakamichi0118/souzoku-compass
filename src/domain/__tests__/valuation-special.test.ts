/**
 * 評価を下げられるのに相続コンパスでは計算しない土地（地積規模の大きな宅地・形がいびつ・セットバック・配偶者居住権）は、
 * 確定させずに税理士への相談を案内する。
 */
import { describe, expect, it } from "vitest";
import { largeLotThreshold, prefectureOf, valueLand } from "../valuation";
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

describe("地積規模の大きな宅地にあたりうる土地は確定しない", () => {
  it("千葉県の普通住宅地区（地区の指定なし）で500㎡以上", () => {
    const v = valueLand(land({ areaSqm: 500 }));
    expect(v.value).toBe(0);
    expect(v.needsConsultation).toContain("地積規模の大きな宅地");
    expect(v.needsConsultation).toContain("500㎡以上");
    expect(valueLand(land({ areaSqm: 499.99 })).needsConsultation).toBeUndefined();
    expect(valueLand(land({ areaSqm: 499.99 })).value).toBe(99_998_000); // 200,000 × 499.99
  });
  it("三大都市圏以外は1,000㎡以上", () => {
    expect(valueLand(land({ location: "北海道札幌市", areaSqm: 999.99 })).needsConsultation).toBeUndefined();
    expect(valueLand(land({ location: "北海道札幌市", areaSqm: 1000 })).needsConsultation).toContain("1,000㎡以上");
  });
  it("所在の都道府県が分からなければ500㎡以上", () => {
    expect(valueLand(land({ location: "x", areaSqm: 500 })).needsConsultation).toContain("地積規模の大きな宅地");
  });
  it("普通商業・併用住宅地区、倍率方式の宅地も対象", () => {
    expect(
      valueLand(land({ areaSqm: 600, method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1, district: "普通商業・併用住宅地区" } })).needsConsultation,
    ).toContain("地積規模");
    expect(valueLand(land({ areaSqm: 600, method: { type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1 } })).needsConsultation).toContain("地積規模");
  });
  it("ほかの地区・宅地でない土地・評価額を直接入力した土地は対象外", () => {
    for (const district of ["ビル街地区", "高度商業地区", "繁華街地区", "中小工場地区", "大工場地区"] as const) {
      expect(valueLand(land({ areaSqm: 2000, method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1, district } })).needsConsultation).toBeUndefined();
    }
    expect(valueLand(land({ areaSqm: 2000, landUse: "畑", method: { type: "multiplier", fixedAssetValue: 1_000_000, multiplier: 1.1 } })).needsConsultation).toBeUndefined();
    expect(valueLand(land({ areaSqm: 2000, method: { type: "manual", value: 50_000_000 } })).value).toBe(50_000_000);
  });
  it("人に貸している土地・借地権でも、自用地の評価が対象になるので確定しない", () => {
    expect(valueLand(land({ areaSqm: 800, use: "leasehold", leaseRatio: 0.6 })).needsConsultation).toContain("地積規模");
  });
});

describe("評価に影響する土地の事情", () => {
  it.each([
    ["irregular", "形がいびつ"],
    ["setback", "セットバック"],
    ["spouseResidence", "配偶者居住権"],
  ] as const)("%s → 確定せず税理士へ（%s）", (condition, word) => {
    const v = valueLand(land({ condition }));
    expect(v.value).toBe(0);
    expect(v.needsConsultation).toContain(word);
    expect(v.needsConsultation).toContain("税理士");
  });
  it("事情がなければ今までどおり（200,000 × 300㎡）", () => {
    expect(valueLand(land()).value).toBe(60_000_000);
  });
});
