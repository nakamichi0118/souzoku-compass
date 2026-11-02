/** 外部レビュー（2026-11-02）で指摘された、金額の脱落・過大控除を止める検査 */
import { describe, expect, it } from "vitest";
import { calculate } from "../tax/engine";
import { valueAsset } from "../valuation";
import { toAsset } from "../../lib/extract";
import type { Asset, Case, Person } from "../types";

const decedent = { name: "架空 太郎", birthDate: "1950-01-01", deathDate: "2026-03-15", address: "東京都千代田区" };
const c1: Person = { id: "c1", name: "長男", relation: "child" };
const c2: Person = { id: "c2", name: "長女", relation: "child" };
const dep = (id: string, amount: number): Asset => ({ id, kind: "deposit", label: id, amount });
const share = (assetId: string, ...s: [string, number, number][]) => ({ assetId, shares: s.map(([personId, numerator, denominator]) => ({ personId, numerator, denominator })) });
const mk = (assets: Asset[], allocations: Case["allocations"], extra: Partial<Case> = {}): Case => ({ id: "t", title: "t", decedent, persons: [c1, c2], assets, allocations, debts: [], priorGifts: [], ...extra });

describe("1. 未分割・配分不足", () => {
  it.each([
    [[] as [string, number, number][], true],
    [[["c1", 1, 4]] as [string, number, number][], true],
    [[["c1", 1, 2]] as [string, number, number][], true],
    [[["c1", 1, 2], ["c2", 1, 2]] as [string, number, number][], false],
    [[["c1", 1, 1], ["c2", 1, 2]] as [string, number, number][], true],
    [[["c1", 1, 1], ["c2", 1, 1]] as [string, number, number][], true],
  ])("割合 %j → 止める: %s", (s, blocked) => {
    const r = calculate(mk([dep("預金", 100_000_000)], s.length ? [share("預金", ...s)] : []));
    expect(r.blockers.length > 0).toBe(blocked);
  });
});

describe("2. 小規模宅地等の特例は合計330㎡まで", () => {
  it("330㎡の宅地2筆（各5,000万円）でも減額は4,000万円まで", () => {
    const lot = (id: string): Asset => ({ id, kind: "land", label: id, location: "x", areaSqm: 330, landUse: "宅地", method: { type: "manual", value: 50_000_000 }, smallResidential: { applies: true, acquirerId: "c1" } });
    const r = calculate(mk([lot("A"), lot("B")], [share("A", ["c1", 1, 1]), share("B", ["c1", 1, 1])]));
    expect(r.assets.reduce((a, l) => a + l.reduction, 0)).toBe(40_000_000);
    expect(r.totalTaxable).toBe(60_000_000);
    expect(r.warnings.some((w) => w.includes("330㎡"))).toBe(true);
  });
});

describe("3. 債務の負担額と債務額の一致", () => {
  it("負担額の合計が債務額を超えたら止める", () => {
    const r = calculate(mk([dep("預金", 100_000_000)], [share("預金", ["c1", 1, 1])], { debts: [{ id: "d", kind: "debt", label: "借入金", amount: 1_000_000, bearers: [{ personId: "c1", amount: 50_000_000 }] }] }));
    expect(r.blockers.some((b) => b.includes("借入金"))).toBe(true);
  });
  it("一致していれば止めない", () => {
    const r = calculate(mk([dep("預金", 100_000_000)], [share("預金", ["c1", 1, 1])], { debts: [{ id: "d", kind: "debt", label: "借入金", amount: 1_000_000, bearers: [{ personId: "c1", amount: 1_000_000 }] }] }));
    expect(r.blockers).toEqual([]);
  });
});

describe("4. 受取人のない保険金", () => {
  it("受取人が空欄・存在しない人なら止める", () => {
    for (const recipientId of ["", "deleted"]) {
      const r = calculate(mk([{ id: "ins", kind: "insurance", label: "保険", amount: 100_000_000, recipientId }], []));
      expect(r.blockers.some((b) => b.includes("受取人"))).toBe(true);
    }
  });
});

describe("5. 株価の未入力を0円にしない", () => {
  it("4つの価格のうち未入力があれば確定しない", () => {
    const v = valueAsset({ id: "s", kind: "listedStock", label: "株", shares: 1000, prices: { close: 3000, monthAvg: 0, prevMonthAvg: 0, prev2MonthAvg: 0 } });
    expect(v.needsConsultation).toBeTruthy();
  });
});

describe("6. 書類の読み取り結果は推定で埋めない", () => {
  const base = { label: "x", amount: null, accruedInterest: null, location: null, areaSqm: 100, fixedAssetValue: 10_000_000, date: null, evidence: "" };
  it("土地の倍率は未入力のまま、評価を確定しない", () => {
    const a = toAsset({ ...base, kind: "land" });
    expect(valueAsset(a).needsConsultation).toBeTruthy();
  });
  it("保険金の受取人を推定しない", () => {
    const a = toAsset({ ...base, kind: "insurance", amount: 1_000_000 });
    expect(a.kind === "insurance" && a.recipientId).toBe("");
  });
  it("上場株式は区分を保つ", () => {
    expect(toAsset({ ...base, kind: "listedStock" }).kind).toBe("listedStock");
  });
});
