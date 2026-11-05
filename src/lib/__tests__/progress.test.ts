import { describe, expect, it } from "vitest";
import type { Asset, Case } from "@/domain/types";
import { divisionReady, filingSteps, formsUpToDate, markCompleted, markFormsCreated, soleHeirId, unallocatedAssets, unsettledAssets, visibleSteps, withSoleHeir } from "../progress";

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

describe("取得する人が決まっていない財産・税額と書類のステップ", () => {
  const half = (assetId: string, personId: string) => ({ assetId, shares: [{ personId, numerator: 1, denominator: 2 }] });

  it("取得者なし・割合が100%未満の財産は、未分割にしていなければ計算に入らない財産", () => {
    const c = mk({ allocations: [one("a1", "s"), half("a2", "c1")] });
    expect(unsettledAssets(c).map((a) => a.id)).toEqual(["a2"]);
    expect(unsettledAssets(mk({ undivided: true, allocations: [half("a2", "c1")] }))).toEqual([]);
    // 100%を超える割合は、未分割にしていても計算できない
    const over = { assetId: "a1", shares: [{ personId: "s", numerator: 1, denominator: 1 }, { personId: "c1", numerator: 1, denominator: 2 }] };
    expect(unsettledAssets(mk({ undivided: true, allocations: [over] })).map((a) => a.id)).toEqual(["a1"]);
  });

  it("計算を止める事項があるうちは税額のステップを完了にしない", async () => {
    const { calculate } = await import("@/domain/tax/engine");
    const c = mk({ allocations: [one("a1", "s")], progress: { completed: ["tax"] } });
    const r = calculate(c);
    expect(r.blockers.length).toBeGreaterThan(0);
    expect(filingSteps(c, r).find((s) => s.slug === "tax")!.done).toBe(false);
    const ok = mk({ allocations: [one("a1", "s"), one("a2", "c1")], progress: { completed: ["tax"] } });
    expect(filingSteps(ok, calculate(ok)).find((s) => s.slug === "tax")!.done).toBe(true);
  });

  it("書類のステップは申告書PDFを作ったときだけ完了し、そのあと入力を変えると未完了に戻る", async () => {
    const { calculate } = await import("@/domain/tax/engine");
    const base = mk({ allocations: [one("a1", "s"), one("a2", "c1")] });
    const docsDone = (c: Case) => filingSteps(c, calculate(c)).find((s) => s.slug === "documents")!.done;
    // 協議書だけ作った（「書類」を完了にしただけ）
    expect(docsDone(markCompleted(base, "documents"))).toBe(false);
    const made = markFormsCreated(base);
    expect(formsUpToDate(made)).toBe(true);
    expect(docsDone(made)).toBe(true);
    const changed = { ...made, assets: [dep("a1"), { ...dep("a2"), amount: 2_000_000 }, ins] };
    expect(formsUpToDate(changed)).toBe(false);
    expect(docsDone(changed)).toBe(false);
    // 同意のチェックや進み具合を変えただけなら作り直し不要
    expect(formsUpToDate(markCompleted({ ...made, review: { consent: { terms: true, responsibility: true, at: "x" } } } as Case, "tax"))).toBe(true);
  });
});

describe("相続人が1人のとき（分け方を省く）", () => {
  const sole = (extra: Partial<Case> = {}) =>
    mk({
      persons: [{ id: "c1", name: "長男", relation: "child" }],
      progress: { completed: [] },
      debts: [{ id: "d", kind: "funeral", label: "葬儀", amount: 800_000, bearers: [] }],
      ...extra,
    });

  it("財産はすべてその人が受け取り、債務・葬式費用もその人が負担する", () => {
    const c = withSoleHeir({ ...sole(), undivided: true });
    expect(soleHeirId(c)).toBe("c1");
    expect(c.undivided).toBeUndefined();
    expect(c.allocations).toEqual([
      { assetId: "a1", shares: [{ personId: "c1", numerator: 1, denominator: 1 }] },
      { assetId: "a2", shares: [{ personId: "c1", numerator: 1, denominator: 1 }] },
    ]);
    expect(c.debts[0].bearers).toEqual([{ personId: "c1", amount: 800_000 }]);
    // もう割り当て済みなら同じものを返す（保存し直さない）
    expect(withSoleHeir(c)).toBe(c);
  });

  it("分け方のステップを帯から外し、済みにする", () => {
    const c = withSoleHeir(sole());
    expect(visibleSteps(c).map((s) => s.slug)).not.toContain("division");
    expect(filingSteps(c, null).find((s) => s.slug === "division")?.done).toBe(true);
  });

  it("相続を放棄した人が払った葬式費用はその人の負担のまま残し、分け方のステップも残す。代償金は消す", () => {
    const persons: Case["persons"] = [
      { id: "c1", name: "長男", relation: "child" },
      { id: "c2", name: "二男", relation: "child", renounced: true },
    ];
    const c = withSoleHeir(
      sole({
        persons,
        debts: [
          { id: "f", kind: "funeral", label: "葬儀", amount: 800_000, bearers: [{ personId: "c2", amount: 800_000 }] },
          { id: "d", kind: "debt", label: "借入", amount: 100_000, bearers: [{ personId: "c2", amount: 100_000 }] },
        ],
        compensation: [{ fromId: "c1", toId: "x", amount: 1 }],
      }),
    );
    expect(c.debts[0].bearers).toEqual([{ personId: "c2", amount: 800_000 }]);
    // 債務は放棄した人は負担できないので、相続人に
    expect(c.debts[1].bearers).toEqual([{ personId: "c1", amount: 100_000 }]);
    expect(c.compensation).toBeUndefined();
    expect(visibleSteps(c).map((s) => s.slug)).toContain("division");
  });

  it("相続人が2人以上、または受遺者がいるときは何もしない", () => {
    const two = mk();
    expect(soleHeirId(two)).toBeNull();
    expect(withSoleHeir(two)).toBe(two);
    expect(visibleSteps(two).map((s) => s.slug)).toContain("division");
    const legatee = sole({ persons: [{ id: "c1", name: "長男", relation: "child" }, { id: "o", name: "知人", relation: "other" }] });
    expect(soleHeirId(legatee)).toBeNull();
    // 放棄した相続人は数えない
    const renounced = sole({ persons: [{ id: "c1", name: "長男", relation: "child" }, { id: "c2", name: "二男", relation: "child", renounced: true }] });
    expect(soleHeirId(renounced)).toBe("c1");
  });
});
