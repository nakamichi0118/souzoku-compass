/** 第6表・付表1：エンジンの値をそのまま写すこと、同意欄に全員を書くこと */
import { describe, expect, it } from "vitest";
import { calculate } from "@/domain/tax/engine";
import type { Asset, Case, Person } from "@/domain/types";
import { agreeingPersonIds, build06, buildF1 } from "../attachments";

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
const home = (acquirerId: string): Asset => ({
  id: "home",
  kind: "land",
  label: "自宅敷地",
  location: "東京都千代田区架空町1番",
  areaSqm: 200,
  landUse: "宅地",
  method: { type: "manual", value: 60_000_000 },
  smallResidential: { applies: true, acquirerId },
});

describe("付表1 特例の適用にあたっての同意", () => {
  it("特例を受ける人だけでなく、自宅の敷地を一緒に取得した人も書く（申告書の人の順）", () => {
    const persons: Person[] = [
      { id: "s", name: "妻", relation: "spouse" },
      { id: "a", name: "長男", relation: "child" },
      { id: "b", name: "長女", relation: "child" },
    ];
    const c = mk(persons, [home("s"), { id: "dep", kind: "deposit", label: "預金", amount: 30_000_000 }], [share("home", ["a", 1, 2], ["s", 1, 2]), share("dep", ["b", 1, 1])]);
    const r = calculate(c);
    expect(agreeingPersonIds(r)).toEqual(["s", "a"]);
    const [f] = buildF1(c, r);
    expect(f.values.agree0).toBe("妻");
    expect(f.values.agree1).toBe("長男");
    expect(f.values.agree2).toBeUndefined();
  });

  it("7人以上なら2枚目に続けて書き、省かない", () => {
    const kids: Person[] = Array.from({ length: 7 }, (_, i) => ({ id: `k${i}`, name: `子${i + 1}`, relation: "child" as const }));
    const persons: Person[] = [{ id: "s", name: "妻", relation: "spouse" }, ...kids];
    const c = mk(persons, [home("s")], [share("home", ["s", 1, 8], ...kids.map((k): [string, number, number] => [k.id, 1, 8]))]);
    const r = calculate(c);
    const pages = buildF1(c, r);
    expect(pages).toHaveLength(2);
    const names = pages.flatMap((p) => [0, 1, 2, 3, 4, 5].map((j) => p.values[`agree${j}`]).filter(Boolean));
    expect(names).toEqual(["妻", ...kids.map((k) => k.name)]);
    // 2枚目は同意欄だけ（宅地の明細と合計は1枚目）
    expect(pages[1].values["b0.reduction"]).toBeUndefined();
    expect(pages[1].values.area1).toBeUndefined();
  });
});

describe("第6表 未成年者控除", () => {
  it("亡くなった後に生まれた子は0歳・18年分で、③はエンジンの値", () => {
    const persons: Person[] = [
      { id: "a", name: "長男", relation: "child", birthDate: "1980-01-01" },
      { id: "baby", name: "次男", relation: "child", birthDate: "2026-07-01" },
    ];
    const c = mk(persons, [{ id: "dep", kind: "deposit", label: "預金", amount: 200_000_000 }], [share("dep", ["a", 1, 2], ["baby", 1, 2])]);
    const r = calculate(c);
    const t = r.persons.find((p) => p.person.id === "baby")!;
    const [p6] = build06(c, r);
    expect(p6.values["m0.name"]).toBe("次男");
    expect(p6.values["m0.age"]).toBe(0);
    expect(num(p6.values["m0.full"]) * 10_000).toBe(1_800_000);
    expect(num(p6.values["m0.tax"])).toBe(t.beforeOtherCredits);
    expect(t.minorCredit).toBe(1_800_000);
  });
});
