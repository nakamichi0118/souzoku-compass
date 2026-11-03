/**
 * 小規模宅地等の特例：1つの宅地等を何人かで受け継いで、それぞれが特例を使うとき（共有）と、
 * 受け継いだ面積の一部だけに使うとき（付表1の⑤）の申告書の記入。
 * 付表1の③〜⑧は「取得者の持分に応ずる」分なので取得者ごとに1行、同意の欄は1人1回。どの合計もエンジンの値と同じになること。
 */
import { describe, expect, it } from "vitest";
import { calculate, type TaxResult } from "@/domain/tax/engine";
import type { Asset, Case, CondoAsset, LandAsset, Person, SmallLandAcquirer } from "@/domain/types";
import type { SmallResidentialCheck } from "@/domain/valuation/smallResidential";
import { agreeingPersonIds, buildF1, smallLines } from "../attachments";
import { buildFilingPages, formsNotGenerated } from "../filing";
import { layout } from "../render";
import { buildSchedule11, scheduleTotals } from "../schedule11";

const num = (v: unknown) => Number(String(v ?? "0").replace(/,/g, "") || 0);
const decedent = { name: "架空 太郎", birthDate: "1950-01-01", deathDate: "2026-03-15", address: "東京都千代田区" };
const mk = (persons: Person[], assets: Asset[], allocations: Case["allocations"]): Case => ({
  id: "t",
  title: "t",
  decedent,
  persons,
  assets,
  allocations,
  debts: [],
  priorGifts: [],
});
const share = (assetId: string, ...s: [string, number, number][]) => ({
  assetId,
  shares: s.map(([personId, numerator, denominator]) => ({ personId, numerator, denominator })),
});
const dep = (id: string, amount: number): Asset => ({ id, kind: "deposit", label: id, amount });
const spouse: Person = { id: "s", name: "妻", relation: "spouse" };
const c1: Person = { id: "c1", name: "長男", relation: "child" };
const c2: Person = { id: "c2", name: "長女", relation: "child" };
const c3: Person = { id: "c3", name: "二男", relation: "child" };

const HOME: SmallResidentialCheck = { ownHome: "yes", special: "no" };
const LIVING: SmallResidentialCheck = { livedTogether: "yes", keep: "yes" };
const RENT_ON: SmallResidentialCheck = { continues: "yes", keep: "yes", recent: "no" };

const land = (id: string, areaSqm: number, value: number, acquirerId: string, check: SmallResidentialCheck, others?: SmallLandAcquirer[], over: Partial<LandAsset> = {}): LandAsset => ({
  id,
  kind: "land",
  label: id,
  location: `東京都千代田区架空町${id}`,
  areaSqm,
  landUse: "宅地",
  method: { type: "manual", value },
  ...over,
  smallResidential: { applies: true, acquirerId, check, ...(others ? { others } : {}), ...over.smallResidential },
});

/** 申告書のすべての欄が様式の座標表にあること */
function fieldsExist(pages: ReturnType<typeof buildFilingPages>) {
  for (const p of pages) {
    const fields = layout[p.page].fields as Record<string, unknown>;
    for (const k of Object.keys(p.values)) if (p.values[k] !== undefined && p.values[k] !== "") expect(fields[k], `${p.page}:${k}`).toBeDefined();
  }
}

/** 第11表の付表1〜4と第11表の合計表の各人の額が、エンジンの各人の取得価額と同じ */
function totalsMatchEngine(c: Case, r: TaxResult) {
  const { byPerson } = scheduleTotals(c, r);
  for (const p of r.persons) expect(byPerson.get(p.person.id) ?? 0, p.person.name).toBe(p.acquired);
  const t11 = buildSchedule11(c, r).filter((p) => p.page === "t11");
  const names = t11.flatMap((p) => Array.from({ length: 10 }, (_, j) => [p.values[`l${j}.name`], p.values[`s${j}.total`]] as const)).filter(([n]) => n);
  for (const [n, total] of names) expect(num(total), String(n)).toBe(r.persons.find((p) => p.person.name === n)!.acquired);
}

/** 付表1（と付表1（続））の明細の行を、書いた順に取り出す */
function f1Rows(pages: ReturnType<typeof buildF1>) {
  return pages.flatMap((p) =>
    [0, 1, 2, 3, 4]
      .filter((j) => p.values[`b${j}.acquirer`] !== undefined)
      .map((j) => ({
        kind: p.values[`b${j}.kind`],
        acquirer: p.values[`b${j}.acquirer`],
        business: p.values[`b${j}.business`],
        location: p.values[`b${j}.location`],
        area: num(p.values[`b${j}.area`]),
        value: num(p.values[`b${j}.value`]),
        selArea: num(p.values[`b${j}.selArea`]),
        selValue: num(p.values[`b${j}.selValue`]),
        reduction: num(p.values[`b${j}.reduction`]),
        taxable: num(p.values[`b${j}.taxable`]),
      })),
  );
}
const agreeNames = (pages: ReturnType<typeof buildF1>) => pages.flatMap((p) => [0, 1, 2, 3, 4, 5].map((j) => p.values[`agree${j}`]).filter(Boolean));

describe("自宅の敷地を妻と同居の長男が1/2ずつ受け継ぎ、2人とも特例を使う", () => {
  // 300㎡ 9,000万円。妻・長男とも ③150㎡ ④4,500万円 ⑤150㎡ ⑥4,500万円 ⑦3,600万円 ⑧900万円
  const c = mk([spouse, c1, c2], [land("自宅", 300, 90_000_000, "s", HOME, [{ acquirerId: "c1", check: LIVING }]), dep("預金", 40_000_000)], [
    share("自宅", ["s", 1, 2], ["c1", 1, 2]),
    share("預金", ["c2", 1, 1]),
  ]);
  const r = calculate(c);
  const line = r.assets[0];

  it("付表1は取得した人ごとに1行（③④⑤⑥⑦⑧はその人の分）", () => {
    expect(r.blockers).toEqual([]);
    expect(line.smallExtra).toHaveLength(1);
    const pages = buildF1(c, r);
    expect(pages.map((p) => p.page)).toEqual(["t11_11_2_f1"]);
    const rows = f1Rows(pages);
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x.acquirer)).toEqual(["妻", "長男"]);
    for (const x of rows) {
      expect(x).toMatchObject({ kind: "1", location: "東京都千代田区架空町自宅", area: 150, value: 45_000_000, selArea: 150, selValue: 45_000_000, reduction: 36_000_000, taxable: 9_000_000 });
    }
    expect(pages[0].values["b0.area"]).toBe("150.00");
    // ⑦の合計は土地の減額、⑧は各人の取得価額（エンジン）
    expect(rows.reduce((t, x) => t + x.reduction, 0)).toBe(line.reduction);
    for (const x of rows) expect(x.taxable).toBe(line.byPerson.find((b) => b.personId === (x.acquirer === "妻" ? "s" : "c1"))!.amount);
  });

  it("同意の欄には2人とも1回ずつ書く（自宅を受け継いでいない長女は書かない）", () => {
    expect(agreeingPersonIds(r)).toEqual(["s", "c1"]);
    expect(agreeNames(buildF1(c, r))).toEqual(["妻", "長男"]);
  });

  it("限度面積要件の⑩⑪は2人の⑤の合計", () => {
    const [f] = buildF1(c, r);
    expect(f.values.area1).toBe("300.00");
    expect(f.values.limitA).toBe("300.00");
    expect(f.values.area4).toBeUndefined();
  });

  it("第11表の付表1は宅地1行（特例「1」、価額は特例のあと）、各人の取得財産の価額は ④−⑦", () => {
    const f1 = buildSchedule11(c, r).find((p) => p.page === "t11_f1")!;
    const items = scheduleTotals(c, r).items.filter((i) => i.values.special === "1");
    expect(items).toHaveLength(1);
    expect(items[0].value).toBe(90_000_000 - 72_000_000);
    expect(items[0].acquirers).toEqual([
      { personId: "s", amount: 9_000_000 },
      { personId: "c1", amount: 9_000_000 },
    ]);
    expect(f1.values["i0.special"]).toBe("1");
    expect(f1.values["i0.area"]).toBe("300");
    expect(num(f1.values["i0.value"])).toBe(18_000_000);
    expect(num(f1.values["i0.a0.value"])).toBe(9_000_000);
    expect(num(f1.values["i0.a1.value"])).toBe(9_000_000);
    totalsMatchEngine(c, r);
  });

  it("共有の宅地なので別表1を作れない表の一覧に出す。欄はすべて様式にある", () => {
    expect(formsNotGenerated(c, r).map((m) => m.form).join("\n")).toMatch(/別表1/);
    fieldsExist(buildFilingPages(c, r));
  });
});

describe("受け継いだ面積の一部だけに使う（⑤が③より小さい）", () => {
  it("1人で300㎡のうち100㎡：③300 ⑤100 ⑥3,000万 ⑦2,400万 ⑧6,600万", () => {
    const c = mk([c1], [land("自宅", 300, 90_000_000, "c1", { ...HOME, ...LIVING }, undefined, { smallResidential: { applies: true, selectedSqm: 100 } })], [share("自宅", ["c1", 1, 1])]);
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const [f] = buildF1(c, r);
    expect(f.values["b0.area"]).toBe("300.00");
    expect(f.values["b0.selArea"]).toBe("100.00");
    expect(f1Rows([f])[0]).toMatchObject({ value: 90_000_000, selValue: 30_000_000, reduction: 24_000_000, taxable: 66_000_000 });
    expect(f.values.area1).toBe("100.00");
    expect(f.values.limitA).toBe("100.00");
    expect(num(f.values["b0.reduction"])).toBe(r.assets[0].reduction);
    totalsMatchEngine(c, r);
  });

  it("2人で受け継ぎ、妻は150㎡のうち100㎡、長男は150㎡のうち50.5㎡", () => {
    const c = mk([spouse, c1], [land("自宅", 300, 90_000_000, "s", HOME, [{ acquirerId: "c1", check: LIVING, selectedSqm: 50.5 }], { smallResidential: { applies: true, selectedSqm: 100 } })], [
      share("自宅", ["s", 1, 2], ["c1", 1, 2]),
    ]);
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const pages = buildF1(c, r);
    const rows = f1Rows(pages);
    // 妻：⑥ 4,500万 × 100/150 ＝ 3,000万 → ⑦ 2,400万。長男：⑥ 4,500万 × 50.5/150 ＝ 1,515万 → ⑦ 1,212万
    expect(rows).toEqual([
      expect.objectContaining({ acquirer: "妻", area: 150, selArea: 100, selValue: 30_000_000, reduction: 24_000_000, taxable: 21_000_000 }),
      expect.objectContaining({ acquirer: "長男", area: 150, selArea: 50.5, selValue: 15_150_000, reduction: 12_120_000, taxable: 32_880_000 }),
    ]);
    expect(pages[0].values["b1.selArea"]).toBe("50.50");
    expect(pages[0].values.area1).toBe("150.50");
    expect(rows.reduce((t, x) => t + x.reduction, 0)).toBe(r.assets[0].reduction);
    totalsMatchEngine(c, r);
  });
});

describe("1人目が使えず、2人目（配偶者）だけが使う", () => {
  // 1人目の長男は同居していない。妻の分（③150㎡）だけ
  const c = mk([spouse, c1], [land("自宅", 300, 90_000_000, "c1", { ...HOME, livedTogether: "no", keep: "yes" }, [{ acquirerId: "s" }])], [share("自宅", ["c1", 1, 2], ["s", 1, 2])]);
  const r = calculate(c);

  it("付表1は妻の1行、同意は自宅を受け継いだ2人", () => {
    expect(r.assets[0].small).toBeUndefined();
    expect(smallLines(r.assets[0]).map((x) => x.detail.acquirerId)).toEqual(["s"]);
    const pages = buildF1(c, r);
    const rows = f1Rows(pages);
    expect(rows).toEqual([expect.objectContaining({ acquirer: "妻", area: 150, selArea: 150, reduction: 36_000_000, taxable: 9_000_000 })]);
    expect(agreeNames(pages)).toEqual(["妻", "長男"]);
    expect(formsNotGenerated(c, r).map((m) => m.form).join("\n")).toMatch(/別表1/);
    totalsMatchEngine(c, r);
  });
});

describe("2つの宅地をそれぞれ2人で受け継ぐと4行になり、4行目は付表1（続）", () => {
  const c = mk(
    [spouse, c1],
    [land("自宅", 200, 60_000_000, "s", HOME, [{ acquirerId: "c1", check: LIVING }]), land("別宅", 100, 20_000_000, "s", HOME, [{ acquirerId: "c1", check: LIVING }])],
    [share("自宅", ["s", 1, 2], ["c1", 1, 2]), share("別宅", ["s", 1, 2], ["c1", 1, 2])],
  );
  const r = calculate(c);

  it("同じ宅地の行は続けて書き、限度面積要件は全部の行の合計", () => {
    const lines = r.assets.flatMap(smallLines);
    expect(lines.length).toBe(4);
    const pages = buildF1(c, r);
    expect(pages.map((p) => p.page)).toEqual(["t11_11_2_f1", "t11_11_2_f1c"]);
    const rows = f1Rows(pages);
    expect(rows.map((x) => `${x.location}:${x.acquirer}`)).toEqual(lines.map((x) => `東京都千代田区架空町${x.line.asset.label}:${x.detail.acquirerId === "s" ? "妻" : "長男"}`));
    expect(pages[1].values["b0.acquirer"]).toBe(rows[3].acquirer);
    expect(pages[1].values["b1.acquirer"]).toBeUndefined();
    const sel = lines.reduce((t, x) => t + x.detail.selectedArea, 0);
    expect(num(pages[0].values.area1)).toBe(sel);
    expect(pages[1].values.area1).toBeUndefined();
    // 同意は付表1に1回ずつ
    expect(agreeNames(pages)).toEqual(["妻", "長男"]);
    expect(rows.reduce((t, x) => t + x.reduction, 0)).toBe(r.assets.reduce((t, l) => t + l.reduction, 0));
    totalsMatchEngine(c, r);
    fieldsExist(buildFilingPages(c, r));
  });
});

describe("一部が空いているアパートの敷地を2人で受け継ぎ、2人とも貸付を続ける", () => {
  // 300㎡ 路線価（manual）6,000万円の自用地、賃貸割合0.8。長男・長女 1/2 ずつ。長女は残りの面積（80㎡）だけ
  const apt = (others: SmallLandAcquirer[]) =>
    land("アパート", 300, 60_000_000, "c1", RENT_ON, others, { use: "rentedHouse", leaseRatio: 0.6, rentRatio: 0.8 });

  it("付表1は2行（貸付事業用・貸家）、第11表の付表1は貸している部分（特例）と空いている部分（自用地）の2行に2人を並べる", () => {
    const c = mk([c1, c2], [apt([{ acquirerId: "c2", check: { continues: "yes", keep: "yes" } }])], [share("アパート", ["c1", 1, 2], ["c2", 1, 2])]);
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const line = r.assets[0];
    const srs = smallLines(line);
    expect(srs).toHaveLength(2);
    const rows = f1Rows(buildF1(c, r));
    expect(rows.map((x) => [x.kind, x.acquirer, x.business, x.area])).toEqual([
      ["4", "長男", "貸家", 120],
      ["4", "長女", "貸家", 120],
    ]);
    expect(rows[1].selArea).toBe(80);
    const [f] = buildF1(c, r);
    expect(f.values.area4).toBe("200.00");
    expect(f.values.limitB4).toBe("200.00");
    const items = scheduleTotals(c, r).items.filter((i) => i.values.town !== undefined);
    expect(items).toHaveLength(2);
    const [rented, vacant] = items;
    expect(rented.values).toMatchObject({ use: "貸家建付地", area: "240", special: "1" });
    // 各人の取得財産の価額は、その人の付表1の⑧
    expect(rented.acquirers).toEqual(srs.map((x) => ({ personId: x.detail.acquirerId, amount: x.detail.value - x.reduction })));
    expect(rented.value).toBe(rows[0].taxable + rows[1].taxable);
    expect(vacant.values).toMatchObject({ use: "自用地", area: "60", special: "", note: "空室部分" });
    expect(vacant.acquirers.map((a) => a.personId)).toEqual(["c1", "c2"]);
    // 空いている部分は自用地として評価した額（6,000万円 × 60/300）
    expect(vacant.value).toBe(12_000_000);
    expect(rented.value + vacant.value).toBe(line.valuation.value - line.reduction);
    for (const b of line.byPerson) expect(items.flatMap((i) => i.acquirers).filter((a) => a.personId === b.personId).reduce((t, a) => t + a.amount, 0)).toBe(b.amount);
    totalsMatchEngine(c, r);
    fieldsExist(buildFilingPages(c, r));
  });

  it("3人目（特例を使わない）の分は、もとの利用区分の3行目", () => {
    const c = mk([c1, c2, c3], [apt([{ acquirerId: "c2", check: { continues: "yes", keep: "yes" } }])], [share("アパート", ["c1", 1, 3], ["c2", 1, 3], ["c3", 1, 3])]);
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const line = r.assets[0];
    const items = scheduleTotals(c, r).items;
    expect(items).toHaveLength(3);
    const [rented, vacant, other] = items;
    expect(rented.values).toMatchObject({ area: "160", special: "1" });
    expect(rented.acquirers.map((a) => a.personId)).toEqual(["c1", "c2"]);
    expect(vacant.values).toMatchObject({ use: "自用地", area: "40" });
    expect(other.values).toMatchObject({ use: "貸家建付地", area: "100", special: "" });
    expect(other.acquirers.map((a) => a.personId)).toEqual(["c3"]);
    expect(items.reduce((t, i) => t + i.value, 0)).toBe(line.valuation.value - line.reduction);
    totalsMatchEngine(c, r);
  });
});

describe("マンションの敷地権を2人で受け継ぎ、2人とも特例を使う", () => {
  const condo: CondoAsset = {
    id: "部屋",
    kind: "condo",
    label: "部屋",
    location: "東京都千代田区架空町3丁目4番",
    landValueBeforeCorrection: 30_000_000,
    buildingFixedAssetValue: 10_000_000,
    builtYearsMonths: { years: 10, months: 0 },
    totalFloors: 10,
    floor: 3,
    landShareSqm: 40,
    exclusiveAreaSqm: 70,
    smallResidential: { applies: true, acquirerId: "s", check: HOME, others: [{ acquirerId: "c1", check: LIVING }] },
  };
  const c = mk([spouse, c1], [condo], [share("部屋", ["s", 1, 2], ["c1", 1, 2])]);
  const r = calculate(c);

  it("敷地利用権の行から、それぞれの減額を引く（各人の合計はエンジンのまま）", () => {
    expect(r.blockers).toEqual([]);
    const line = r.assets[0];
    const srs = smallLines(line);
    expect(srs).toHaveLength(2);
    const { items } = scheduleTotals(c, r);
    const site = items.find((i) => i.part === "site")!;
    const bldg = items.find((i) => i.part === "building")!;
    expect(site.values.special).toBe("1");
    expect(site.value + bldg.value).toBe(line.valuation.value - line.reduction);
    // 敷地利用権の行の各人の額 ＝ その人の ④ − ⑦（1円の付け替えがなければ）
    for (const x of srs) {
      const a = site.acquirers.find((p) => p.personId === x.detail.acquirerId)!;
      expect(Math.abs(a.amount - (x.detail.value - x.reduction))).toBeLessThanOrEqual(1);
    }
    for (const it of items) expect(it.acquirers.reduce((t, a) => t + a.amount, 0)).toBe(it.value);
    totalsMatchEngine(c, r);
    expect(f1Rows(buildF1(c, r)).map((x) => x.acquirer)).toEqual(["妻", "長男"]);
  });
});

describe("種類の違う宅地を何人かで使うとき（限度面積要件のロ）", () => {
  it("⑩は種類ごとの全員の⑤の合計、⑪ロにもその合計", () => {
    const c = mk(
      [spouse, c1, c2],
      [
        land("自宅", 165, 82_500_000, "s", HOME, [{ acquirerId: "c1", check: LIVING }], { smallResidential: { applies: true, selectedSqm: 40 } }),
        land("アパート", 200, 40_000_000, "c1", RENT_ON, [{ acquirerId: "c2", check: { continues: "yes", keep: "yes" } }], { use: "rentedHouse", leaseRatio: 0.6 }),
      ],
      [share("自宅", ["s", 1, 2], ["c1", 1, 2]), share("アパート", ["c1", 1, 2], ["c2", 1, 2])],
    );
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const lines = r.assets.flatMap(smallLines);
    const sumOf = (k: string) => lines.filter((x) => x.detail.kind === k).reduce((t, x) => t + x.detail.selectedArea, 0);
    const [f] = buildF1(c, r);
    expect(num(f.values.area1)).toBeCloseTo(sumOf("residence"), 2);
    expect(num(f.values.limitB1)).toBeCloseTo(sumOf("residence"), 2);
    // 自宅：妻 40㎡・長男 82.5㎡、アパート：長男 100㎡・長女は残り 25.75㎡（122.5 × 200/330 ＋ 125.75 ≦ 200）
    expect(sumOf("residence")).toBe(122.5);
    expect(sumOf("rental")).toBe(125.75);
    expect(f.values.area1).toBe("122.50");
    expect(f.values.area4).toBe("125.75");
    expect(f.values.limitB4).toBe("125.75");
    expect(f.values.limitA).toBeUndefined();
    // 限度面積：特定居住用 × 200/330 ＋ 貸付事業用 ≦ 200㎡
    expect((sumOf("residence") * 200) / 330 + sumOf("rental")).toBeLessThanOrEqual(200.0001);
    expect(lines.reduce((t, x) => t + x.reduction, 0)).toBe(r.assets.reduce((t, l) => t + l.reduction, 0));
    totalsMatchEngine(c, r);
  });
});
