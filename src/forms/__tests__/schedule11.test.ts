import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { calculate, type TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { buildFilingPages } from "../filing";
import { layout } from "../render";
import { buildSchedule11, scheduleTotals, siteRightRatio, splitLocation } from "../schedule11";

describe("第11表と付表", () => {
  const r = calculate(demoCase);

  it("付表の取得価額の合計が各人の取得財産の価額（第1表①）と一致する", () => {
    const { byPerson } = scheduleTotals(demoCase, r);
    for (const p of r.persons) expect(byPerson.get(p.person.id) ?? 0).toBe(p.acquired);
  });

  it("マンションは敷地利用権と区分所有建物の2行に分け、合計は評価額と一致する", () => {
    const { items } = scheduleTotals(demoCase, r);
    const condo = r.assets.find((l) => l.asset.kind === "condo")!;
    const rows = items.filter((i) => i.part === "site" || i.part === "building");
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
    const rows = items.filter((i) => i.part === "site" || i.part === "building");
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

  it("小規模宅地等の特例で減額した土地は「特例」欄に特例番号1を書き、備考には書かない", () => {
    const f1 = buildSchedule11(demoCase, r).find((p) => p.page === "t11_f1")!;
    const rows = [0, 1, 2, 3, 4, 5, 6, 7].filter((j) => f1.values[`i${j}.no`] !== undefined);
    const home = rows.find((j) => f1.values[`i${j}.town`] === "架空町一丁目" && f1.values[`i${j}.kind`] === "宅地")!;
    expect(f1.values[`i${home}.special`]).toBe("1");
    expect(f1.values[`i${home}.note`] ?? "").toBe("");
    // 特例を使わない家屋・マンションには書かない
    for (const j of rows) if (j !== home) expect(f1.values[`i${j}.special`] ?? "").toBe("");
    expect(Object.values(f1.values)).not.toContain("小規模宅地等");
  });

  it("マンションの敷地利用権の行の備考には、登記簿の敷地権の割合を書く", () => {
    const f1 = buildSchedule11(demoCase, r).find((p) => p.page === "t11_f1")!;
    const notes = Object.entries(f1.values).filter(([k]) => k.endsWith(".note")).map(([, v]) => v);
    expect(notes).toContain("10000分の169");
    expect(notes).not.toContain("敷地権");
    // 特例を使うマンションは、敷地利用権の行に特例番号1を書く（家屋の行には書かない）
    const c = structuredClone(demoCase);
    c.assets = c.assets.map((a) =>
      a.id === "home-land" && a.kind === "land" ? { ...a, smallResidential: undefined } : a.kind === "condo" ? { ...a, smallResidential: { applies: true, acquirerId: "hanako", check: { ownHome: "yes" as const, special: "no" as const } } } : a,
    );
    c.allocations = c.allocations.map((a) => (a.assetId === "condo" ? { ...a, shares: [{ personId: "hanako", numerator: 1, denominator: 1 }] } : a));
    const rc = calculate(c);
    expect(rc.blockers).toEqual([]);
    const condo = rc.assets.find((l) => l.asset.kind === "condo")!;
    expect(condo.reduction).toBeGreaterThan(0);
    const items = scheduleTotals(c, rc).items;
    expect(items.find((i) => i.part === "site")!.values).toMatchObject({ special: "1", note: "10000分の169" });
    expect(items.find((i) => i.part === "building")!.values.special).toBeUndefined();
    expect(items.find((i) => i.part === "building")!.values.note).toBe("区分所有");
  });

  it("敷地権の割合は「10000分の169」の形で取り出す", () => {
    expect(siteRightRatio("所有権　10000分の169")).toBe("10000分の169");
    expect(siteRightRatio("所有権 １００００分の２１５")).toBe("１００００分の２１５");
    expect(siteRightRatio("賃借権 1,000,000分の12,345")).toBe("1000000分の12345");
    expect(siteRightRatio("169/10000")).toBe("10000分の169");
    expect(siteRightRatio("登記簿のとおり")).toBe("登記簿のとおり");
    expect(siteRightRatio(undefined)).toBe("");
    expect(siteRightRatio("  ")).toBe("");
  });

  it("登記簿の敷地権の割合がなければ、マンションの備考は空欄", () => {
    const c = structuredClone(demoCase);
    c.assets = c.assets.map((a) => (a.kind === "condo" ? { ...a, registry: { ...a.registry, siteRight: undefined } } : a));
    const site = scheduleTotals(c, calculate(c)).items.find((i) => i.part === "site")!;
    expect(site.values.note).toBe("");
  });

  it("貸家建付借地権の土地の利用区分", () => {
    const c = structuredClone(demoCase);
    c.assets.push({
      id: "lh",
      kind: "land",
      label: "借地のアパート",
      location: "東京都千代田区架空町五丁目1番",
      areaSqm: 100,
      landUse: "宅地",
      use: "rentedLeasehold",
      leaseRatio: 0.6,
      method: { type: "rosenka", routePrice: 300_000, depthCorrection: 1.0, district: "普通住宅地区", roads: [{ edge: 0, price: 300_000, depth: 10, notation: "300D" }] },
    });
    c.allocations.push({ assetId: "lh", shares: [{ personId: "ichiro", numerator: 1, denominator: 1 }] });
    const rc = calculate(c);
    expect(rc.blockers).toEqual([]);
    const lh = scheduleTotals(c, rc).items.find((i) => i.values.town === "架空町五丁目")!;
    expect(lh.values.use).toBe("貸家建付借地権");
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

describe("一部が空いている貸家建付地などに貸付事業用宅地等の特例を使ったとき（付表1の⑧・別表1の3）", () => {
  type Share = { personId: string; numerator: number; denominator: number };
  const rental = { applies: true, acquirerId: "ichiro", check: { continues: "yes" as const, keep: "yes" as const, recent: "no" as const } };
  /** 自宅の特例を外し、アパートの敷地（150㎡・賃貸割合0.8）を足した事例。一郎さんが貸付事業用宅地等の特例を使う */
  function aptCase(use: "rentedHouse" | "rentedLeasehold", shares: Share[] = [{ personId: "ichiro", numerator: 1, denominator: 1 }], rentRatio = 0.8): Case {
    const c = structuredClone(demoCase);
    c.assets = c.assets.map((a) => (a.id === "home-land" && a.kind === "land" ? { ...a, smallResidential: undefined } : a));
    c.assets.push({
      id: "apt",
      kind: "land",
      label: "アパート敷地",
      location: "東京都千代田区架空町五丁目1番",
      areaSqm: 150,
      landUse: "宅地",
      use,
      rentRatio,
      leaseRatio: 0.6,
      method: { type: "rosenka", routePrice: 300_000, depthCorrection: 1.0, district: "普通住宅地区", roads: [{ edge: 0, price: 300_000, depth: 10, notation: "300D" }] },
      smallResidential: rental,
    });
    c.allocations.push({ assetId: "apt", shares });
    return c;
  }
  const aptItems = (c: Case, r: TaxResult) => scheduleTotals(c, r).items.filter((i) => i.values.town === "架空町五丁目");
  const sumOf = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  const num = (v: unknown) => Number(String(v ?? "").replace(/,/g, ""));

  it("貸家建付地：貸している部分（特例・⑧の額）と空いている部分（自用地）の2行に分け、合計は変わらない", () => {
    const c = aptCase("rentedHouse");
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const line = r.assets.find((l) => l.asset.id === "apt")!;
    const s = line.small!;
    expect(s.kind).toBe("rental");
    expect(line.reduction).toBeGreaterThan(0);
    const items = aptItems(c, r);
    expect(items).toHaveLength(2);
    const [rented, vacant] = items;
    expect(rented.values).toMatchObject({ use: "貸家建付地", area: "120", special: "1" });
    expect(rented.value).toBe(s.value - line.reduction);
    expect(rented.acquirers).toEqual([{ personId: "ichiro", amount: s.value - line.reduction }]);
    expect(vacant.values).toMatchObject({ use: "自用地", area: "30", special: "", note: "空室部分" });
    // 空いている部分は自用地として評価した額（300,000円 × 30㎡）
    expect(vacant.value).toBe(9_000_000);
    expect(vacant.value).toBe(line.valuation.value - s.value);
    expect(vacant.acquirers).toEqual([{ personId: "ichiro", amount: vacant.value }]);
    // 行の合計は1行で書いていたときの価額（評価額 − 減額）、各人の合計は第1表①のまま
    expect(rented.value + vacant.value).toBe(line.valuation.value - line.reduction);
    expect(rented.cat).toBe(3);
    expect(vacant.cat).toBe(3);
    const { byPerson } = scheduleTotals(c, r);
    for (const p of r.persons) expect(byPerson.get(p.person.id) ?? 0).toBe(p.acquired);
    // 付表1の⑧（特例を使ったあとの価額）が、特例の行の価額と同じ
    const pages = buildFilingPages(c, r);
    const f1 = pages.find((p) => p.page === "t11_11_2_f1")!;
    expect(num(f1.values["b0.taxable"])).toBe(rented.value);
  });

  it("貸家建付借地権：空いている部分は借地権（自用）の行にする", () => {
    const c = aptCase("rentedLeasehold");
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const line = r.assets.find((l) => l.asset.id === "apt")!;
    const [rented, vacant, ...rest] = aptItems(c, r);
    expect(rest).toEqual([]);
    expect(rented.values).toMatchObject({ use: "貸家建付借地権", area: "120", special: "1" });
    expect(rented.value).toBe(line.small!.value - line.reduction);
    expect(vacant.values).toMatchObject({ use: "借地権", area: "30", special: "" });
    // 自用地 300,000円 × 30㎡ × 借地権割合 0.6
    expect(vacant.value).toBe(5_400_000);
    expect(rented.value + vacant.value).toBe(line.valuation.value - line.reduction);
  });

  it("2人で取得した土地：特例を使う人の分を2行に、ほかの人の分はもとの利用区分の行に書き、各人の金額は変わらない", () => {
    const c = aptCase("rentedHouse", [
      { personId: "ichiro", numerator: 2, denominator: 3 },
      { personId: "sakura", numerator: 1, denominator: 3 },
    ]);
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const line = r.assets.find((l) => l.asset.id === "apt")!;
    const items = aptItems(c, r);
    expect(items).toHaveLength(3);
    const [rented, vacant, other] = items;
    expect(rented.values).toMatchObject({ use: "貸家建付地", area: "80", special: "1" });
    expect(rented.acquirers).toEqual([{ personId: "ichiro", amount: line.small!.value - line.reduction }]);
    expect(vacant.values).toMatchObject({ use: "自用地", area: "20", special: "" });
    expect(vacant.acquirers.map((a) => a.personId)).toEqual(["ichiro"]);
    expect(other.values).toMatchObject({ use: "貸家建付地", area: "50", special: "" });
    expect(other.acquirers.map((a) => a.personId)).toEqual(["sakura"]);
    // 特例番号は貸している部分の行だけ
    expect(items.filter((i) => i.values.special === "1")).toEqual([rented]);
    // 行の価額＝取得者ごとの金額の合計、3行の合計＝評価額 − 減額、各人の合計は分ける前と同じ
    for (const it of items) expect(sumOf(it.acquirers) + sumOf(it.undivided)).toBe(it.value);
    expect(items.reduce((t, i) => t + i.value, 0)).toBe(line.valuation.value - line.reduction);
    for (const b of line.byPerson) expect(sumOf(items.flatMap((i) => i.acquirers.filter((a) => a.personId === b.personId)))).toBe(b.amount);
    const { byPerson } = scheduleTotals(c, r);
    for (const p of r.persons) expect(byPerson.get(p.person.id) ?? 0).toBe(p.acquired);
    // 第11表の付表1のページ：特例番号「1」は1か所だけ、欄はすべて様式にある
    const pages = buildFilingPages(c, r);
    const f1 = pages.filter((p) => p.page === "t11_f1");
    const specials = f1.flatMap((p) => Object.entries(p.values).filter(([k, v]) => k.endsWith(".special") && v === "1"));
    expect(specials).toHaveLength(1);
    for (const p of pages) {
      const fields = layout[p.page].fields as Record<string, unknown>;
      for (const k of Object.keys(p.values)) if (p.values[k] !== undefined && p.values[k] !== "") expect(fields[k], `${p.page}:${k}`).toBeDefined();
    }
  });

  it("全部貸していれば（賃貸割合1）これまでどおり1行", () => {
    const c = aptCase("rentedHouse", undefined, 1);
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const line = r.assets.find((l) => l.asset.id === "apt")!;
    expect(line.reduction).toBeGreaterThan(0);
    const items = aptItems(c, r);
    expect(items).toHaveLength(1);
    expect(items[0].values).toMatchObject({ use: "貸家建付地", area: "150", special: "1" });
    expect(items[0].value).toBe(line.valuation.value - line.reduction);
  });

  it("特例を使わなければ、空いている部屋があっても1行", () => {
    const c = aptCase("rentedHouse");
    c.assets = c.assets.map((a) => (a.id === "apt" ? { ...a, smallResidential: undefined } : a));
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const items = aptItems(c, r);
    expect(items).toHaveLength(1);
    expect(items[0].values).toMatchObject({ use: "貸家建付地", area: "150", special: "" });
  });

  it("貸している部屋が一部空いているマンション：敷地利用権の行を貸している部分（特例）と空いている部分（自用地）に分ける", () => {
    const c = structuredClone(demoCase);
    c.assets = c.assets.map((a) =>
      a.id === "home-land" && a.kind === "land" ? { ...a, smallResidential: undefined } : a.kind === "condo" ? { ...a, rented: true, rentRatio: 0.8, leaseRatio: 0.6, smallResidential: rental } : a,
    );
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const line = r.assets.find((l) => l.asset.kind === "condo")!;
    expect(line.reduction).toBeGreaterThan(0);
    const { items, byPerson } = scheduleTotals(c, r);
    const sites = items.filter((i) => i.part === "site");
    const bldg = items.filter((i) => i.part === "building");
    expect(sites).toHaveLength(2);
    expect(bldg).toHaveLength(1);
    const [rented, vacant] = sites;
    expect(rented.values).toMatchObject({ use: "貸家建付地", special: "1", note: "10000分の169", area: String(line.small!.area) });
    expect(rented.value).toBe(line.small!.value - line.reduction);
    expect(vacant.values).toMatchObject({ use: "自用地", special: "", note: "10000分の169" });
    expect(num(vacant.values.area) + line.small!.area).toBeCloseTo((line.asset as { landShareSqm: number }).landShareSqm, 2);
    expect(bldg[0].values.special).toBeUndefined();
    // 3行の合計は評価額 − 減額、家屋の行は分けない前と同じ
    expect(rented.value + vacant.value + bldg[0].value).toBe(line.valuation.value - line.reduction);
    for (const it of [...sites, ...bldg]) expect(sumOf(it.acquirers)).toBe(it.value);
    for (const p of r.persons) expect(byPerson.get(p.person.id) ?? 0).toBe(p.acquired);
    const f1 = buildFilingPages(c, r).find((p) => p.page === "t11_11_2_f1")!;
    expect(num(f1.values["b0.taxable"])).toBe(rented.value);
  });
});
