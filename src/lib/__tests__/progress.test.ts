import { describe, expect, it } from "vitest";
import type { Asset, Case } from "@/domain/types";
import { divisionReady, filingSteps, markCompleted, unallocatedAssets } from "../progress";

const dep = (id: string): Asset => ({ id, kind: "deposit", label: id, amount: 1_000_000 });
const ins: Asset = { id: "ins", kind: "insurance", label: "保険", amount: 5_000_000, recipientId: "s" };
const mk = (extra: Partial<Case> = {}): Case => ({
  id: "t",
  title: "t",
  decedent: { name: "相続 太郎", birthDate: "1950-01-01", deathDate: "2026-03-15", address: "東京都千代田区" },
  persons: [
    { id: "s", name: "妻", relation: "spouse" },
    { id: "c1", name: "長男", relation: "child" },
  ],
  assets: [dep("a1"), dep("a2"), ins],
  allocations: [],
  debts: [],
  priorGifts: [],
  progress: { completed: ["division"] },
  ...extra,
});
const one = (assetId: string, personId: string) => ({ assetId, shares: [{ personId, numerator: 1, denominator: 1 }] });
const divisionDone = (c: Case) => filingSteps(c, null).find((s) => s.slug === "division")!.done;

describe("遺産の分け方のステップの完了", () => {
  it("すべての財産（保険金を除く）に取得する人が決まっていれば完了", () => {
    const c = mk({ allocations: [one("a1", "s"), one("a2", "c1")] });
    expect(unallocatedAssets(c)).toEqual([]);
    expect(divisionReady(c)).toBe(true);
    expect(divisionDone(c)).toBe(true);
  });

  it("取得する人が決まっていない財産があれば未完了", () => {
    const c = mk({ allocations: [one("a1", "s"), { assetId: "a2", shares: [] }] });
    expect(unallocatedAssets(c).map((a) => a.id)).toEqual(["a2"]);
    expect(divisionDone(c)).toBe(false);
  });

  it("「分け方がまだ決まっていない」を選ぶと、決まっていない財産があっても完了", () => {
    expect(divisionDone(mk({ undivided: true }))).toBe(true);
    expect(divisionDone(mk({ undivided: true, allocations: [one("a1", "s")] }))).toBe(true);
  });

  it("割合が0だけの財産は、決まっていないものとして数える", () => {
    const c = mk({ allocations: [one("a1", "s"), { assetId: "a2", shares: [{ personId: "c1", numerator: 0, denominator: 1 }] }] });
    expect(divisionDone(c)).toBe(false);
    expect(divisionDone({ ...c, undivided: true })).toBe(true);
  });

  it("財産がないとき・「次へ」で終えていないときは未完了", () => {
    expect(divisionDone(mk({ assets: [], undivided: true }))).toBe(false);
    expect(divisionDone(mk({ undivided: true, progress: undefined }))).toBe(false);
    expect(divisionDone(markCompleted(mk({ undivided: true, progress: undefined }), "division"))).toBe(true);
  });
});
