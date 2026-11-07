/**
 * 死亡保険金を何人かで受け取るとき（受取人が「法定相続人」となっている保険など）。
 * 非課税の枠（500万円×法定相続人の数）は、受け取った人ごとの金額で按分する（相続税法12条1項5号）。
 */
import { describe, expect, it } from "vitest";
import { calculate } from "../tax/engine";
import { receiptOver, receiptShares } from "../receipt";
import { build09 } from "@/forms/attachments";
import { removePerson } from "@/components/steps/HeirsStep";
import type { Asset, Case, DeemedAsset, Person } from "../types";

const decedent = { name: "相続 太郎", birthDate: "1950-01-01", deathDate: "2026-03-15", address: "東京都千代田区" };
const spouse: Person = { id: "s", name: "妻", relation: "spouse" };
const c1: Person = { id: "c1", name: "長男", relation: "child" };
const c2: Person = { id: "c2", name: "長女", relation: "child" };
const ins = (over: Partial<DeemedAsset> = {}): DeemedAsset => ({
  id: "ins",
  kind: "insurance",
  label: "みほん生命",
  amount: 30_000_000,
  recipientId: "s",
  ...over,
});
const mk = (assets: Asset[]): Case => ({
  id: "t",
  title: "t",
  decedent,
  persons: [spouse, c1, c2],
  assets: [{ id: "d", kind: "deposit", label: "預金", amount: 100_000_000 }, ...assets],
  allocations: [{ assetId: "d", shares: [{ personId: "s", numerator: 1, denominator: 1 }] }],
  debts: [],
  priorGifts: [],
});
const of = (r: ReturnType<typeof calculate>, id: string) => r.persons.find((p) => p.person.id === id)!;

describe("保険金の受取人を追加", () => {
  it("1人目は受取金額から2人目以降の分を引いた残り", () => {
    const a = ins({ otherRecipients: [{ personId: "c1", amount: 7_500_000 }, { personId: "c2", amount: 7_500_000 }] });
    expect(receiptShares(a)).toEqual([
      { personId: "s", amount: 15_000_000 },
      { personId: "c1", amount: 7_500_000 },
      { personId: "c2", amount: 7_500_000 },
    ]);
    expect(receiptOver(a)).toBe(0);
  });

  it("受け取った人ごとの金額で非課税の枠を分ける", () => {
    // 枠 = 500万 × 3人 = 1,500万。受取 3,000万（妻1,500万・長男750万・長女750万）→ 非課税は 750万・375万・375万
    const r = calculate(mk([ins({ otherRecipients: [{ personId: "c1", amount: 7_500_000 }, { personId: "c2", amount: 7_500_000 }] })]));
    expect(r.blockers).toEqual([]);
    expect(of(r, "s").insurance).toBe(15_000_000);
    expect(of(r, "c1").insurance).toBe(7_500_000);
    expect(of(r, "c2").insurance).toBe(7_500_000);
    expect(of(r, "s").insuranceExempt).toBe(7_500_000);
    expect(of(r, "c1").insuranceExempt).toBe(3_750_000);
    expect(of(r, "c2").insuranceExempt).toBe(3_750_000);
  });

  it("合計が受取金額を超える・人や金額が未入力なら止める", () => {
    expect(calculate(mk([ins({ otherRecipients: [{ personId: "c1", amount: 40_000_000 }] })])).blockers.join()).toMatch(/超えています/);
    expect(calculate(mk([ins({ otherRecipients: [{ personId: "", amount: 1 }] })])).blockers.join()).toMatch(/選ばれていない人/);
    expect(calculate(mk([ins({ otherRecipients: [{ personId: "c1", amount: 0 }] })])).blockers.join()).toMatch(/金額が入っていない/);
  });

  it("第9表は受取人ごとに1行", () => {
    const c = mk([ins({ otherRecipients: [{ personId: "c1", amount: 10_000_000 }] })]);
    const v = build09(c, calculate(c))[0].values;
    expect(v["r0.recipient"]).toBe("妻");
    expect(v["r1.recipient"]).toBe("長男");
    expect(v["r1.company"]).toBe("みほん生命");
  });

  it("家族を消したら、追加した受取人の行は人だけ外す", () => {
    const c = removePerson(mk([ins({ otherRecipients: [{ personId: "c1", amount: 10_000_000 }] })]), "c1");
    const a = c.assets.find((x) => x.id === "ins") as DeemedAsset;
    expect(a.otherRecipients).toEqual([{ personId: "", amount: 10_000_000 }]);
  });
});
