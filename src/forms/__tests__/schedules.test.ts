import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { calculate } from "@/domain/tax/engine";
import { buildFilingPages } from "../filing";
import { build13, build15, build5, filingPersons } from "../schedules";

const r = calculate(demoCase);
const num = (v: unknown) => Number(String(v ?? "0").replace(/,/g, "") || 0);

describe("第15表", () => {
  const pages = build15(demoCase, r);
  const cols = [
    { page: pages[0], k: "p" },
    ...pages.slice(1).flatMap((pg) => [
      { page: pg, k: "a" },
      { page: pg, k: "b" },
    ]),
  ].filter((c) => c.page.values[`${c.k}.name`]);

  it("各人の㊳課税価格が第1表⑥と一致する", () => {
    const persons = filingPersons(r);
    expect(cols).toHaveLength(persons.length);
    cols.forEach((c, i) => {
      expect(num(c.page.values[`${c.k}.r38`]) * 1000).toBe(persons[i].taxable);
      expect(num(c.page.values[`${c.k}.r30`])).toBe(persons[i].acquired);
    });
  });
  it("合計欄の㊳は課税価格の合計額（第1表Ａ）", () => {
    expect(num(pages[0].values["t.r38"]) * 1000).toBe(r.totalTaxable);
  });
  it("宅地・家屋・預貯金・保険金が正しい行に入る", () => {
    const v = pages[0].values;
    expect(num(v["t.r03"])).toBeGreaterThan(0);
    expect(num(v["t.r10"])).toBeGreaterThan(0);
    expect(num(v["t.r23"])).toBeGreaterThan(0);
    expect(num(v["t.r25"])).toBe(5_000_000);
    expect(num(v["t.r06"])).toBe(num(v["t.r03"]));
  });
});

describe("第13表", () => {
  const [pg] = build13(demoCase, r);
  it("債務と葬式費用を明細に記載し、各人の合計が第1表③と一致する", () => {
    expect(pg.values["d0.kind"]).toBe("公租公課");
    expect(pg.values["f0.payee"]).toBe("架空斎場");
    for (let i = 0; i < 4; i++) {
      const name = pg.values[`p${i}.name`];
      if (!name) continue;
      const p = r.persons.find((x) => x.person.name === name)!;
      expect(num(pg.values[`p${i}.r7`])).toBe(p.debts);
    }
    expect(num(pg.values["t.r7"])).toBe(r.totalDebts);
  });
});

describe("第5表", () => {
  it("配偶者の税額軽減額が第1表⑬と一致する", () => {
    const [pg] = build5(demoCase, r);
    const sp = r.persons.find((p) => p.person.relation === "spouse")!;
    expect(num(pg.values.g19)).toBe(sp.spouseCredit);
    expect(pg.values.g02).toBe("1");
    expect(pg.values.g03).toBe("2");
    expect(num(pg.values.g05)).toBe(160_000_000);
  });
  it("配偶者がいなければ作成しない", () => {
    const c = structuredClone(demoCase);
    c.persons = c.persons.filter((p) => p.relation !== "spouse");
    c.allocations = c.allocations.map((a) => ({ ...a, shares: a.shares.map((s) => (s.personId === "hanako" ? { ...s, personId: "ichiro" } : s)) }));
    c.assets = c.assets.map((a) => (a.kind === "insurance" ? { ...a, recipientId: "ichiro" } : a.kind === "land" ? { ...a, smallResidential: undefined } : a));
    c.debts = c.debts.map((d) => ({ ...d, bearers: d.bearers.map((b) => ({ ...b, personId: "ichiro" })) }));
    expect(build5(c, calculate(c))).toEqual([]);
  });
});

it("申告書一式の順序", () => {
  expect(buildFilingPages(demoCase, r).map((p) => p.page)).toEqual(["t01", "t01c", "t02", "t05", "t06", "t08_8", "t09", "t11", "t11_f1", "t11_f2", "t11_f3", "t11_f4", "t11_11_2_f1", "t13", "t14", "t15", "t15c"]);
});
