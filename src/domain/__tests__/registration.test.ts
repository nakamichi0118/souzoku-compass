import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { buildRegistrations, registrationTax } from "../registration";
import { renderRegistration } from "@/documents/renderRegistration";

describe("相続登記", () => {
  it("登録免許税は課税価格の1000分の4、100円未満切捨て、最低1,000円", () => {
    expect(registrationTax(55_450_000)).toBe(221_800);
    expect(registrationTax(123_456_000)).toBe(493_800);
    expect(registrationTax(100_000)).toBe(1_000);
    expect(registrationTax(0)).toBe(0);
  });
  it("取得者ごとに申請をまとめ、課税価格は1,000円未満切捨て", () => {
    const apps = buildRegistrations(demoCase);
    expect(apps).toHaveLength(2);
    const hanako = apps.find((a) => a.applicants[0].personId === "hanako")!;
    expect(hanako.properties.map((p) => p.kind)).toEqual(["land", "building"]);
    expect(hanako.taxBase).toBe(55_450_000);
    expect(hanako.tax).toBe(221_800);
    expect(hanako.cause).toBe("令和8年3月15日相続");
    expect(hanako.missing).toEqual([]);
    const ichiro = apps.find((a) => a.applicants[0].personId === "ichiro")!;
    expect(ichiro.taxBase).toBe(10_120_000);
    expect(ichiro.tax).toBe(40_400);
  });
  it("100万円以下の土地は免税、持分は「2分の1」と書く", () => {
    const c = structuredClone(demoCase);
    const land = c.assets.find((a) => a.id === "home-land")!;
    if (land.kind === "land") land.registry = { assessedValue: 800_000 };
    c.allocations = c.allocations.map((a) => (a.assetId === "home-land" ? { ...a, shares: [{ personId: "hanako", numerator: 1, denominator: 2 }, { personId: "ichiro", numerator: 1, denominator: 2 }] } : a));
    const app = buildRegistrations(c).find((a) => a.properties.some((p) => p.assetId === "home-land"))!;
    expect(app.applicants.map((a) => a.share)).toEqual(["2分の1", "2分の1"]);
    expect(app.taxBase).toBe(0);
    expect(app.tax).toBe(0);
    expect(app.exemptLots).toHaveLength(1);
  });
  it("数字で書いた丁目も所在に残す", () => {
    const c = structuredClone(demoCase);
    const land = c.assets.find((a) => a.id === "home-land")!;
    if (land.kind === "land") {
      land.location = "東京都港区六本木6丁目10番1";
      land.registry = { assessedValue: 48_650_000 };
    }
    const p = buildRegistrations(c).flatMap((a) => a.properties).find((x) => x.assetId === "home-land")!;
    expect(p.kind === "land" && [p.location, p.lot]).toEqual(["東京都港区六本木6丁目", "10番1"]);
  });
  it("不動産のある市区町村が違えば、同じ人が取得しても申請書を分ける", () => {
    const c = structuredClone(demoCase);
    const bldg = c.assets.find((a) => a.id === "home-bldg")!;
    if (bldg.kind === "building") bldg.location = "大阪府大阪市北区梅田3丁目1番地 家屋番号1番";
    const apps = buildRegistrations(c).filter((a) => a.applicants.length === 1 && a.applicants[0].personId === "hanako");
    expect(apps).toHaveLength(2);
    expect(apps.map((a) => a.area).sort()).toEqual(["大阪府大阪市北区", "東京都千代田区"]);
    const tokyo = apps.find((a) => a.area === "東京都千代田区")!;
    expect(tokyo.properties.map((p) => p.kind)).toEqual(["land"]);
    expect(tokyo.taxBase).toBe(48_650_000);
    expect(tokyo.tax).toBe(194_600);
    const osaka = apps.find((a) => a.area === "大阪府大阪市北区")!;
    expect(osaka.taxBase).toBe(6_800_000);
    expect(osaka.tax).toBe(27_200);
  });
  it("地番が分からない土地は、足りない項目に挙げる", () => {
    const c = structuredClone(demoCase);
    const land = c.assets.find((a) => a.id === "home-land")!;
    if (land.kind === "land") {
      land.location = "東京都千代田区架空町";
      land.registry = { assessedValue: 48_650_000 };
    }
    const app = buildRegistrations(c).find((a) => a.properties.some((p) => p.assetId === "home-land"))!;
    expect(app.missing).toContain("「自宅敷地」の地番");
  });
  it("PDFを作れる", async () => {
    const pdf = await renderRegistration(buildRegistrations(demoCase), { office: "東京" });
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
