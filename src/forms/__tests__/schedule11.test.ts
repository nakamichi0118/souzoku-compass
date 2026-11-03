import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { calculate } from "@/domain/tax/engine";
import { buildFilingPages } from "../filing";
import { layout } from "../render";
import { buildSchedule11, scheduleTotals, splitLocation } from "../schedule11";

describe("第11表と付表", () => {
  const r = calculate(demoCase);

  it("付表の取得価額の合計が各人の取得財産の価額（第1表①）と一致する", () => {
    const { byPerson } = scheduleTotals(demoCase, r);
    for (const p of r.persons) expect(byPerson.get(p.person.id) ?? 0).toBe(p.acquired);
  });

  it("マンションは敷地利用権と区分所有建物の2行に分け、合計は評価額と一致する", () => {
    const { items } = scheduleTotals(demoCase, r);
    const condo = r.assets.find((l) => l.asset.kind === "condo")!;
    const rows = items.filter((i) => i.values.note === "敷地権" || i.values.note === "区分所有");
    expect(rows).toHaveLength(2);
    expect(rows[0].value + rows[1].value).toBe(condo.valuation.value);
  });

  it("マンションを3人で分けても、土地・家屋の各行の価額は取得者ごとの金額の合計と一致する", () => {
    const c = structuredClone(demoCase);
    c.allocations = c.allocations.map((a) =>
      a.assetId === "condo"
        ? { ...a, shares: [{ personId: "hanako", numerator: 1, denominator: 7 }, { personId: "ichiro", numerator: 2, denominator: 7 }, { personId: "sakura", numerator: 4, denominator: 7 }] }
        : a,
    );
    const rc = calculate(c);
    const { items, byPerson } = scheduleTotals(c, rc);
    const rows = items.filter((i) => i.values.note === "敷地権" || i.values.note === "区分所有");
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.acquirers.reduce((s, a) => s + a.amount, 0)).toBe(row.value);
    for (const p of rc.persons) expect(byPerson.get(p.person.id) ?? 0).toBe(p.acquired);
  });

  it("小規模宅地等の特例を適用した土地は減額後の価額を記載する", () => {
    const pages = buildSchedule11(demoCase, r);
    const f1 = pages.find((p) => p.page === "t11_f1")!;
    const land = r.assets.find((l) => l.asset.id === "home-land")!;
    expect(f1.values["i0.value"]).toBe((land.valuation.value - land.reduction).toLocaleString("ja-JP"));
  });

  it("生命保険金は非課税金額を差し引いた額を付表4に記載する", () => {
    const f4 = buildSchedule11(demoCase, r).find((p) => p.page === "t11_f4")!;
    const hanako = r.persons.find((p) => p.person.id === "hanako")!;
    expect(f4.values["i0.value"]).toBe((hanako.insurance - hanako.insuranceExempt).toLocaleString("ja-JP"));
  });

  it("取得者が3人を超える財産は次の行に続けて記載する", () => {
    const c = structuredClone(demoCase);
    const ids = ["hanako", "ichiro", "sakura"];
    c.persons.push({ id: "x", name: "受遺 者", relation: "other" });
    c.allocations = c.allocations.map((a) =>
      a.assetId === "dep1" ? { ...a, shares: [...ids, "x"].map((personId) => ({ personId, numerator: 1, denominator: 4 })) } : a,
    );
    const f3 = buildSchedule11(c, calculate(c)).find((p) => p.page === "t11_f3")!;
    expect(f3.values["i0.a2.no"]).toBeDefined();
    expect(f3.values["i1.no"]).toBeUndefined();
    expect(f3.values["i1.a0.no"]).toBe(4);
    expect(f3.values["i2.no"]).toBe(2);
  });

  it("すべての欄IDが様式の座標表に存在する", () => {
    for (const p of buildFilingPages(demoCase, r)) {
      const fields = layout[p.page].fields as Record<string, unknown>;
      for (const k of Object.keys(p.values)) if (p.values[k] !== undefined && p.values[k] !== "") expect(fields[k], `${p.page}:${k}`).toBeDefined();
    }
  });

  it("所在地を都道府県・市区町村・大字・地番に分ける", () => {
    expect(splitLocation("東京都千代田区架空町一丁目2番3")).toEqual({ pref: "東京都", city: "千代田区", town: "架空町一丁目", lot: "2番3" });
    expect(splitLocation("神奈川県横浜市架空区見本町1番地")).toMatchObject({ pref: "神奈川県", city: "横浜市架空区", town: "見本町" });
    expect(splitLocation("北海道架空郡見本町字ためし10番")).toMatchObject({ pref: "北海道", city: "架空郡見本町", town: "字ためし" });
  });

  it("数字で書いた丁目は大字・丁目に残す", () => {
    expect(splitLocation("大阪府大阪市北区梅田3丁目1番")).toEqual({ pref: "大阪府", city: "大阪市北区", town: "梅田3丁目", lot: "1番" });
    expect(splitLocation("東京都港区六本木6丁目10番1")).toEqual({ pref: "東京都", city: "港区", town: "六本木6丁目", lot: "10番1" });
    expect(splitLocation("東京都港区六本木６丁目１０番１")).toMatchObject({ town: "六本木６丁目", lot: "１０番１" });
    expect(splitLocation("東京都港区六本木6丁目")).toMatchObject({ town: "六本木6丁目", lot: "" });
  });
});
