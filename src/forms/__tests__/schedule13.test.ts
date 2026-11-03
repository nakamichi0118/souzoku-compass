import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { calculate } from "@/domain/tax/engine";
import { build13, debtKind } from "../schedules";

describe("第13表の債務の種類", () => {
  it("種類を選んでいなければ、税金・保険料の名前で始まるものだけを公租公課にする", () => {
    expect(debtKind({ label: "令和8年度 固定資産税（未納分）" })).toEqual({ kind: "公租公課", detail: "固定資産税" });
    expect(debtKind({ label: "住民税（令和7年度分）" })).toEqual({ kind: "公租公課", detail: "住民税" });
    expect(debtKind({ label: "令和7年分所得税" })).toEqual({ kind: "公租公課", detail: "所得税" });
    expect(debtKind({ label: "介護保険料" })).toEqual({ kind: "公租公課", detail: "介護保険料" });
  });

  it("よくある税金・保険料は、名前の途中にあっても公租公課にする", () => {
    const cases: [string, string][] = [
      ["令和8年度 固定資産税 第3期", "固定資産税"],
      ["固定資産税・都市計画税", "固定資産税・都市計画税"],
      ["未納の固定資産税", "固定資産税"],
      ["所得税（準確定申告分）", "所得税"],
      ["準確定申告の所得税", "所得税"],
      ["所得税及び復興特別所得税", "所得税・復興特別所得税"],
      ["特別区民税・都民税", "特別区民税・都民税"],
      ["令和8年度 市県民税", "市県民税"],
      ["市・県民税", "市県民税"],
      ["市町村民税", "市町村民税"],
      ["国民健康保険料", "国民健康保険料"],
      ["後期高齢者医療保険料（第2期）", "後期高齢者医療保険料"],
      ["令和8年度 介護保険料", "介護保険料"],
      ["国民年金保険料", "国民年金保険料"],
      ["自動車税（種別割）", "自動車税"],
      ["軽自動車税", "軽自動車税"],
    ];
    for (const [label, detail] of cases) expect(debtKind({ label })).toEqual({ kind: "公租公課", detail });
  });

  it("名前に「税」の字が入っているだけでは公租公課にしない", () => {
    expect(debtKind({ label: "未払医療費（税込）" })).toEqual({ kind: "その他", detail: "未払医療費（税込）" });
    expect(debtKind({ label: "税理士への報酬（未払）" })).toEqual({ kind: "その他", detail: "税理士への報酬（未払）" });
    for (const label of ["家賃（消費税込み）", "老人ホームの利用料金（消費税を含む）", "相続税の申告の費用", "固定資産税の立替分（長男が支払い）", "電気代（消費税等）", "自動車ローン残高"]) {
      expect(debtKind({ label })).toEqual({ kind: "その他", detail: label });
    }
  });

  it("種類を選んでいればそれに従う", () => {
    expect(debtKind({ label: "住宅ローン残高", debtType: "銀行借入金" })).toEqual({ kind: "銀行借入金", detail: "住宅ローン残高" });
    expect(debtKind({ label: "入院費", debtType: "未払金" })).toEqual({ kind: "未払金", detail: "入院費" });
    expect(debtKind({ label: "固定資産税の立替分", debtType: "その他" })).toEqual({ kind: "その他", detail: "固定資産税の立替分" });
    expect(debtKind({ label: "未納の住民税", debtType: "公租公課" })).toEqual({ kind: "公租公課", detail: "住民税" });
    expect(debtKind({ label: "区の手数料", debtType: "公租公課" })).toEqual({ kind: "公租公課", detail: "区の手数料" });
  });

  it("申告書の欄に種類と細目が入る", () => {
    const c = structuredClone(demoCase);
    c.debts.push({ id: "med", kind: "debt", label: "未払医療費（税込）", amount: 50_000, creditor: "架空病院", bearers: [{ personId: "hanako", amount: 50_000 }] });
    const [pg] = build13(c, calculate(c));
    expect(pg.values["d0.kind"]).toBe("公租公課");
    expect(pg.values["d0.detail"]).toBe("固定資産税");
    expect(pg.values["d1.kind"]).toBe("その他");
    expect(pg.values["d1.detail"]).toBe("未払医療費（税込）");
  });
});

describe("第13表 3 債務及び葬式費用の合計額（確定・未確定）", () => {
  const num = (v: unknown) => Number(String(v ?? "0").replace(/,/g, "") || 0);
  /** 分け方が決まっておらず（未分割）、債務・葬式費用を負担する人も入れていない事例 */
  function undividedCase() {
    const c = structuredClone(demoCase);
    c.undivided = true;
    c.allocations = c.allocations.filter((a) => a.assetId !== "dep2");
    c.debts = c.debts.map((d) => ({ ...d, bearers: [] }));
    return c;
  }

  it("負担する人が決まっていない分は②⑤に書き、①④は空欄。③⑥⑦は合計", () => {
    const c = undividedCase();
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const [pg] = build13(c, r);
    const bearers = r.persons.filter((p) => p.debtOnly > 0 || p.funeralOnly > 0);
    expect(bearers.length).toBeGreaterThan(1);
    bearers.forEach((p, i) => {
      expect(p.debtsUnsettled).toBe(p.debtOnly);
      expect(p.funeralUnsettled).toBe(p.funeralOnly);
      expect(pg.values[`p${i}.name`]).toBe(p.person.name);
      expect(pg.values[`p${i}.r1`]).toBe("");
      expect(pg.values[`p${i}.r4`]).toBe("");
      expect(num(pg.values[`p${i}.r2`])).toBe(p.debtsUnsettled);
      expect(num(pg.values[`p${i}.r5`])).toBe(p.funeralUnsettled);
      expect(num(pg.values[`p${i}.r3`])).toBe(p.debtOnly);
      expect(num(pg.values[`p${i}.r6`])).toBe(p.funeralOnly);
      expect(num(pg.values[`p${i}.r7`])).toBe(p.debts);
    });
    expect(pg.values["t.r1"]).toBe("");
    expect(pg.values["t.r4"]).toBe("");
    expect(num(pg.values["t.r2"])).toBe(186_400);
    expect(num(pg.values["t.r5"])).toBe(1_850_000);
    expect(num(pg.values["t.r3"])).toBe(186_400);
    expect(num(pg.values["t.r6"])).toBe(1_850_000);
    expect(num(pg.values["t.r7"])).toBe(r.totalDebts);
    // 1・2の明細の「負担することが確定した」欄も空欄
    expect(pg.values["d0.bearer"]).toBeUndefined();
    expect(pg.values["d0.bearerAmount"]).toBe("");
  });

  it("負担する人を入れた分は①④、入れていない分は②⑤に分けて書く", () => {
    const c = undividedCase();
    // 葬式費用は一郎さんが負担すると決めた。固定資産税は決まっていない
    c.debts = c.debts.map((d) => (d.kind === "funeral" ? { ...d, bearers: [{ personId: "ichiro", amount: d.amount }] } : d));
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    const [pg] = build13(c, r);
    const bearers = r.persons.filter((p) => p.debtOnly > 0 || p.funeralOnly > 0);
    const i = bearers.findIndex((p) => p.person.id === "ichiro");
    const ichiro = bearers[i];
    expect(ichiro.funeralUnsettled).toBe(0);
    expect(num(pg.values[`p${i}.r4`])).toBe(1_850_000);
    expect(pg.values[`p${i}.r5`]).toBe("");
    expect(num(pg.values[`p${i}.r2`])).toBe(ichiro.debtsUnsettled);
    expect(num(pg.values[`p${i}.r1`]) + num(pg.values[`p${i}.r2`])).toBe(num(pg.values[`p${i}.r3`]));
    expect(num(pg.values[`p${i}.r3`]) + num(pg.values[`p${i}.r6`])).toBe(num(pg.values[`p${i}.r7`]));
    expect(num(pg.values["t.r4"])).toBe(1_850_000);
    expect(pg.values["t.r5"]).toBe("");
    expect(num(pg.values["t.r2"])).toBe(186_400);
    expect(num(pg.values["t.r7"])).toBe(r.totalDebts);
  });

  it("分け方が決まっていれば、これまでどおり①④に書く", () => {
    const r = calculate(demoCase);
    const [pg] = build13(demoCase, r);
    expect(num(pg.values["t.r1"])).toBe(186_400);
    expect(num(pg.values["t.r4"])).toBe(1_850_000);
    expect(pg.values["t.r2"]).toBe("");
    expect(pg.values["t.r5"]).toBe("");
  });
});
