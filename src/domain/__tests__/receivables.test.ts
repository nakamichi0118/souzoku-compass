import { describe, expect, it } from "vitest";
import { judgeReceivable } from "../review/receivables";
import { calculate } from "../tax/engine";
import type { Asset, Case } from "../types";

const D = "2026-03-15";
const kind = (r: Parameters<typeof judgeReceivable>[0]) => judgeReceivable(r, D).kind;

describe("亡くなったあとに受け取るお金の判定", () => {
  it("介護保険料・後期高齢者医療保険料・準確定申告の還付は、亡くなった後に受け取れば相続財産（国税庁 誤りやすい事例⑦）", () => {
    expect(kind({ type: "kaigo" })).toBe("estate");
    expect(kind({ type: "kouki", receivedOn: "2026-05-01" })).toBe("estate");
    expect(kind({ type: "junkakutei", receivedOn: "2026-08-01" })).toBe("estate");
  });

  it("亡くなった日（当日を含む）までに受け取った分は、残高に入っているので入れない", () => {
    expect(kind({ type: "kaigo", receivedOn: "2026-03-15" })).toBe("inBalance");
    expect(kind({ type: "kaigo", receivedOn: "2026-03-10" })).toBe("inBalance");
    expect(kind({ type: "kaigo", receivedOn: "2026-03-16" })).toBe("estate");
    expect(judgeReceivable({ type: "kaigo", receivedOn: "2026-13-01" }, D)).toEqual({ kind: "incomplete", need: "受け取った日" });
  });

  it("高額療養費：亡くなるまでの月の分で、宛名が亡くなった方なら相続財産。後の月・ほかの人宛は入れない", () => {
    expect(judgeReceivable({ type: "kogakuRyoyo" }, D)).toEqual({ kind: "incomplete", need: "受診した月" });
    expect(judgeReceivable({ type: "kogakuRyoyo", basis: "2026-03" }, D)).toEqual({ kind: "incomplete", need: "通知書の宛名が亡くなった方" });
    expect(kind({ type: "kogakuRyoyo", basis: "2026-03", holder: "decedent" })).toBe("estate");
    expect(kind({ type: "kogakuRyoyo", basis: "2026-04", holder: "decedent" })).toBe("notEstate");
    expect(kind({ type: "kogakuRyoyo", basis: "2026-02", holder: "other" })).toBe("notEstate");
    expect(kind({ type: "kogakuKaigo", basis: "2026-01", holder: "decedent" })).toBe("estate");
  });

  it("国保料の還付は、世帯主が亡くなった方のときだけ相続財産", () => {
    expect(kind({ type: "kokuho", holder: "decedent" })).toBe("estate");
    expect(kind({ type: "kokuho", holder: "other" })).toBe("notEstate");
  });

  it("家賃は支払期日、配当は基準日が亡くなった日までなら相続財産", () => {
    expect(kind({ type: "rent", basis: "2026-03-15" })).toBe("estate");
    expect(kind({ type: "rent", basis: "2026-03-31" })).toBe("notEstate");
    expect(kind({ type: "dividend", basis: "2025-12-31" })).toBe("estate");
    expect(kind({ type: "dividend", basis: "2026-03-31" })).toBe("notEstate");
  });

  it("未支給年金・葬祭費は入れない。死亡後に決まった賞与・そのほかは相談", () => {
    expect(kind({ type: "pension" })).toBe("notEstate");
    expect(kind({ type: "funeralBenefit" })).toBe("notEstate");
    expect(kind({ type: "bonus" })).toBe("consult");
    expect(kind({ type: "other" })).toBe("consult");
  });

  it("計算：相続財産に入らない受け取りが財産の一覧にあると、確定させない", () => {
    const mk = (a: Asset): Case => ({
      id: "t",
      title: "t",
      decedent: { name: "x", birthDate: "1950-01-01", deathDate: D, address: "x" },
      persons: [{ id: "c1", name: "長男", relation: "child" }],
      assets: [a],
      allocations: [{ assetId: "r", shares: [{ personId: "c1", numerator: 1, denominator: 1 }] }],
      debts: [],
      priorGifts: [],
    });
    const base = { id: "r", kind: "other", label: "還付金", amount: 10_000 } as const;
    expect(calculate(mk({ ...base, receivable: { type: "kaigo" } })).blockers).toEqual([]);
    expect(calculate(mk({ ...base, receivable: { type: "pension" } })).blockers.join()).toContain("相続財産に入りません");
    expect(calculate(mk({ ...base, receivable: { type: "kogakuRyoyo" } })).blockers.join()).toContain("受診した月");
    expect(calculate(mk({ ...base, receivable: { type: "other" } })).blockers.join()).toContain("税理士");
  });
});
