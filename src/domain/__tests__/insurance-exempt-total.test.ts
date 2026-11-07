/**
 * 死亡保険金・死亡退職金の非課税（500万円×法定相続人の数。相続税法12条1項5号・6号）。
 * 受け取った額が限度額を超えるとき、一人ずつの非課税は「限度額 × その人の受取額 / 相続人全員の受取額」。
 * 円未満の端数で合計が限度額に1円足りなくならないよう、非課税の合計はちょうど限度額にする。
 */
import { describe, expect, it } from "vitest";
import { calculate } from "../tax/engine";
import { taxBreakdown } from "@/lib/taxBreakdown";
import type { Asset, Case, Person } from "../types";

const decedent = { name: "相続 太郎", birthDate: "1950-01-01", deathDate: "2026-03-15", address: "東京都千代田区" };
const spouse: Person = { id: "s", name: "妻", relation: "spouse" };
const c1: Person = { id: "c1", name: "長男", relation: "child" };
const c2: Person = { id: "c2", name: "長女", relation: "child" };
const c3: Person = { id: "c3", name: "次男", relation: "child" };

const deemed = (kind: "insurance" | "retirement", id: string, recipientId: string, amount: number): Asset => ({ id, kind, label: id, amount, recipientId });
const mk = (persons: Person[], assets: Asset[]): Case => ({
  id: "t",
  title: "t",
  decedent,
  persons,
  assets: [{ id: "d", kind: "deposit", label: "預金", amount: 100_000_000 }, ...assets],
  allocations: [{ assetId: "d", shares: [{ personId: persons[0].id, numerator: 1, denominator: 1 }] }],
  debts: [],
  priorGifts: [],
});
const exempts = (r: ReturnType<typeof calculate>, kind: "insurance" | "retirement") =>
  Object.fromEntries(r.persons.map((p) => [p.person.id, kind === "insurance" ? p.insuranceExempt : p.retirementExempt]));
const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("保険金・退職金の非課税の合計は、限度額を超えて受け取ればちょうど限度額", () => {
  it("相続人2人・保険金36,850,700円：切り捨てだと9,999,999円になる分け方でも、非課税は10,000,000円", () => {
    // 10,000,000 × 18,425,351 / 36,850,700 ＝ 5,000,000.27…、10,000,000 × 18,425,349 / 36,850,700 ＝ 4,999,999.72…
    const c = mk([spouse, c1], [deemed("insurance", "i1", "s", 18_425_351), deemed("insurance", "i2", "c1", 18_425_349)]);
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    expect(r.insuranceExemptLimit).toBe(10_000_000);
    const ex = exempts(r, "insurance");
    expect(total(ex)).toBe(10_000_000);
    // 端数の大きい長男に1円足す（一人ずつは、切り捨てか切り上げのどちらか）
    expect(ex).toEqual({ s: 5_000_000, c1: 5_000_000 });
    const b = taxBreakdown(c, r);
    expect(b.insurance).toMatchObject({ received: 36_850_700, exempt: 10_000_000, limit: 10_000_000 });
  });

  it("退職金も同じ。3人が同じ額を受け取り端数が同じときは、IDの順に1円ずつ足す（家族の並び順によらない）", () => {
    // 限度額 500万 × 4人 = 2,000万。3人が1,000万ずつ → 一人 6,666,666.66…
    const assets = [deemed("retirement", "r1", "c1", 10_000_000), deemed("retirement", "r2", "c2", 10_000_000), deemed("retirement", "r3", "c3", 10_000_000)];
    const a = exempts(calculate(mk([spouse, c1, c2, c3], assets)), "retirement");
    const b = exempts(calculate(mk([spouse, c3, c2, c1], assets)), "retirement");
    expect(total(a)).toBe(20_000_000);
    expect(a).toEqual({ s: 0, c1: 6_666_667, c2: 6_666_667, c3: 6_666_666 });
    expect(b).toEqual(a);
  });

  it("限度額以下なら、受け取った額がそのまま非課税", () => {
    const ex = exempts(calculate(mk([spouse, c1], [deemed("insurance", "i1", "s", 3_000_001), deemed("insurance", "i2", "c1", 2_999_999)])), "insurance");
    expect(ex).toEqual({ s: 3_000_001, c1: 2_999_999 });
  });
});
