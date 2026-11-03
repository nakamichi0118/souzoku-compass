/** 代償金を特定の財産の時価をもとに決めたとき（相基通11の2-10(2)）、申告書には課税価格に入れた額を書く */
import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { calculate } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { buildDivisionDoc } from "@/documents/division";
import { buildFilingPages } from "../filing";
import { buildSchedule11, scheduleTotals } from "../schedule11";
import { build15 } from "../schedules";

const num = (v: unknown) => {
  const s = String(v ?? "0").replace(/,/g, "");
  return s.startsWith("△") ? -Number(s.slice(1)) : Number(s || 0);
};

/** 一郎さんがマンションを受け継ぎ、マンションの時価をもとに決めた代償金をさくらさんに払う */
function basisCase(): Case {
  const c: Case = structuredClone(demoCase);
  c.compensation = [{ fromId: "ichiro", toId: "sakura", amount: 5_000_000, basis: { assetId: "condo", marketValue: 30_000_000 } }];
  return c;
}

describe("代償金の価額（時価をもとに決めたとき）", () => {
  const c = basisCase();
  const r = calculate(c);
  const condo = r.assets.find((l) => l.asset.id === "condo")!;
  const value = Math.floor((5_000_000 * condo.valuation.value) / 30_000_000);

  it("前提：エンジンは代償金×評価額÷時価を課税価格に入れる", () => {
    expect(r.blockers).toEqual([]);
    expect(r.compensation).toEqual([{ fromId: "ichiro", toId: "sakura", amount: 5_000_000, value }]);
    expect(value).toBeLessThan(5_000_000);
  });

  it("付表4の代償財産は、払う人は△、受け取る人はプラスで、課税価格に入れた額を書く", () => {
    const f4 = buildSchedule11(c, r).find((p) => p.page === "t11_f4")!;
    const j = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => f4.values[`i${k}.kind`] === "代償財産")!;
    expect(f4.values[`i${j}.value`]).toBe("0");
    expect(num(f4.values[`i${j}.a0.value`])).toBe(-value);
    expect(num(f4.values[`i${j}.a1.value`])).toBe(value);
  });

  it("付表の合計・第15表㉘・第1表①がエンジンの取得財産の価額と一致する", () => {
    const { byPerson } = scheduleTotals(c, r);
    for (const p of r.persons) expect(byPerson.get(p.person.id) ?? 0).toBe(p.acquired);
    const ichiro = r.persons.find((p) => p.person.id === "ichiro")!;
    expect(ichiro.compensationOut).toBe(value);
    const pg = build15(c, r).find((p) => p.values["a.name"] === "相続 一郎" || p.values["p.name"] === "相続 一郎")!;
    const k = pg.values["a.name"] === "相続 一郎" ? "a" : "p";
    expect(num(pg.values[`${k}.r28`])).toBe(-value);
    const pages = buildFilingPages(c, r);
    const t01c = pages.find((p) => p.page === "t01c" && (p.values["a.name"] === "相続 一郎" || p.values["b.name"] === "相続 一郎"))!;
    const pre = t01c.values["a.name"] === "相続 一郎" ? "a" : "b";
    expect(num(t01c.values[`${pre}.r01`])).toBe(ichiro.acquired);
  });

  it("遺産分割協議書には、実際に払う代償金の額（額面）を書く", () => {
    const d = buildDivisionDoc(c);
    expect(d.articles.find((a) => a.heading.includes("代償として"))!.heading).toContain("金5,000,000円を支払う");
  });

  it("時価が正しく入っていない代償金は、付表4に載せない（エンジンが止める）", () => {
    const bad = basisCase();
    bad.compensation![0].basis = { assetId: "condo", marketValue: 0 };
    const rb = calculate(bad);
    expect(rb.blockers.length).toBeGreaterThan(0);
    const f4 = buildSchedule11(bad, rb).find((p) => p.page === "t11_f4")!;
    expect(Object.values(f4.values)).not.toContain("代償財産");
    const { byPerson } = scheduleTotals(bad, rb);
    for (const p of rb.persons) expect(byPerson.get(p.person.id) ?? 0).toBe(p.acquired);
  });
});
