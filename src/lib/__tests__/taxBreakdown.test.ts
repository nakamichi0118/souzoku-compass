import { describe, expect, it } from "vitest";
import { generateScenarios } from "../../../scripts/cases/generate";
import { toCase } from "../../../scripts/cases/toCase";
import { demoCase } from "@/data/demo";
import { calculate } from "@/domain/tax/engine";
import type { Case, LandAsset } from "@/domain/types";
import { taxBreakdown } from "../taxBreakdown";
import { wholeTaker, withSmallLandAcquirers } from "../smallLand";
import { withSoleHeir } from "../progress";

const clone = () => structuredClone(demoCase);
const land = (c: Case) => c.assets.find((a) => a.id === "home-land") as LandAsset;

/** 内訳の行を足した額（一人ずつの切捨て・0円にした人の分だけ、課税価格の合計とずれる） */
const rowsTotal = (b: ReturnType<typeof taxBreakdown>) =>
  b.assets -
  b.small.reduce((s, x) => s + x.reduction, 0) +
  (b.insurance ? b.insurance.received - b.insurance.exempt : 0) +
  (b.retirement ? b.retirement.received - b.retirement.exempt : 0) -
  b.debts +
  b.gifts;

describe("税額の画面の「財産の合計の内訳」", () => {
  it("デモ：自宅敷地の小規模宅地等の特例と、死亡保険金の非課税（500万円×法定相続人の数）を出す", () => {
    const r = calculate(demoCase);
    const b = taxBreakdown(demoCase, r);
    expect(b.small).toHaveLength(1);
    expect(b.small[0]).toMatchObject({ assetId: "home-land", label: "自宅敷地", name: "特定居住用宅地等", rate: 80, area: 165.5 });
    expect(b.small[0].reduction).toBe(r.assets.find((l) => l.asset.id === "home-land")!.reduction);
    expect(b.insurance).toMatchObject({ received: 20_000_000, limit: 5_000_000 * r.legalHeirCount, exempt: Math.min(20_000_000, 5_000_000 * r.legalHeirCount) });
    expect(b.smallUnused).toEqual([]);
    expect(b.total).toBe(r.totalTaxable);
    expect(Math.abs(rowsTotal(b) - b.total)).toBeLessThan(1000 * r.persons.length);
  });

  it("1000件の試験ケースで、内訳の行の合計が課税価格の合計と合う（一人ずつの1,000円未満の切捨て・0円にした人の分を除く）", () => {
    let checked = 0;
    for (const s of generateScenarios()) {
      const { case: c } = toCase(s);
      if (!c) continue;
      let r;
      try {
        r = calculate(c);
      } catch {
        continue;
      }
      const b = taxBreakdown(c, r);
      expect(b.total).toBe(r.totalTaxable);
      if (!b.netFloored) {
        const d = rowsTotal(b) - b.total;
        expect(d, s.id).toBeGreaterThanOrEqual(0);
        expect(d, s.id).toBeLessThan(1000 * Math.max(1, r.persons.length));
      }
      // 特例を使った土地は、使っていない土地の一覧に出さない
      for (const u of b.smallUnused) expect(b.small.some((x) => x.assetId === u.assetId)).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThan(900);
  });

  it("取得する人を選んでいないと、その理由を出す", () => {
    const c = clone();
    land(c).smallResidential = { applies: false, check: { ownHome: "yes", special: "no" } };
    const b = taxBreakdown(c, calculate(c));
    expect(b.small).toEqual([]);
    expect(b.smallUnused).toEqual([{ assetId: "home-land", label: "自宅敷地", reason: "特例の欄で「この土地を取得する人」を選んでいません。" }]);
  });

  it("税理士への確認が必要な判定で、確認のチェックがないとその理由を出す", () => {
    const c = clone();
    const child = c.persons.find((p) => p.relation === "child" && !p.predeceased)!;
    land(c).smallResidential = { applies: false, acquirerId: child.id, check: { ownHome: "yes", special: "no", livedTogether: "no" } };
    c.allocations = c.allocations.map((al) => (al.assetId === "home-land" ? { ...al, shares: [{ personId: child.id, numerator: 1, denominator: 1 }] } : al));
    const b = taxBreakdown(c, calculate(c));
    expect(b.smallUnused[0].reason).toMatch(/税理士への確認が必要な判定/);
  });

  it("分け方で、特例を使う人がその土地を受け継いでいないとその理由を出す", () => {
    const c = clone();
    const child = c.persons.find((p) => p.relation === "child" && !p.predeceased)!;
    c.allocations = c.allocations.map((al) => (al.assetId === "home-land" ? { ...al, shares: [{ personId: child.id, numerator: 1, denominator: 1 }] } : al));
    const b = taxBreakdown(c, calculate(c));
    expect(b.smallUnused[0].reason).toBe("遺産の分け方で、特例を使う相続 花子さんがこの土地を受け継いでいません。");
  });

  it("使えないと判定した答えは、その判定の文を出す", () => {
    const c = clone();
    const child = c.persons.find((p) => p.relation === "child" && !p.predeceased)!;
    land(c).smallResidential = { applies: false, acquirerId: child.id, check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "no" } };
    c.allocations = c.allocations.map((al) => (al.assetId === "home-land" ? { ...al, shares: [{ personId: child.id, numerator: 1, denominator: 1 }] } : al));
    const b = taxBreakdown(c, calculate(c));
    expect(b.smallUnused[0].reason).toBe("申告期限までに売る・引っ越す場合は、同居していた親族でも特例は使えません。");
  });

  it("特例の欄に答えていない宅地は名前だけ挙げる（田・畑などは挙げない）", () => {
    const c = clone();
    delete land(c).smallResidential;
    c.assets.push({ id: "field", kind: "land", label: "架空の畑", location: "架空村1番", areaSqm: 300, landUse: "畑", method: { type: "manual", value: 1_000_000 } } as LandAsset);
    c.allocations.push({ assetId: "field", shares: [{ personId: "hanako", numerator: 1, denominator: 1 }] });
    const b = taxBreakdown(c, calculate(c));
    expect(b.smallUnanswered.map((u) => u.label)).toContain("自宅敷地");
    expect(b.smallUnanswered.map((u) => u.label)).not.toContain("架空の畑");
  });

  it("相続人でない人・放棄した人が受け取った保険金には非課税を使えないことを示す", () => {
    const c = clone();
    const ins = c.assets.find((a) => a.kind === "insurance")!;
    const heir = c.persons.find((p) => p.relation === "child" && !p.predeceased)!;
    heir.renounced = true;
    if (ins.kind === "insurance") ins.recipientId = heir.id;
    const b = taxBreakdown(c, calculate(c));
    expect(b.insurance?.notHeirs).toBe(true);
    expect(b.insurance?.exempt).toBe(0);
  });
});

describe("特例の取得する人が決まっていれば入れる", () => {
  it("分け方でその土地を1人が受け継ぐと決めたら、空の取得する人に入れる（選んである人は変えない）", () => {
    const c = clone();
    land(c).smallResidential = { applies: false, check: { ownHome: "yes", special: "no" } };
    expect(wholeTaker(c, "home-land")).toBe(c.allocations.find((a) => a.assetId === "home-land")!.shares[0].personId);
    const n = withSmallLandAcquirers(c);
    expect(land(n).smallResidential?.acquirerId).toBe(wholeTaker(c, "home-land"));
    expect(calculate(n).assets.find((l) => l.asset.id === "home-land")!.reduction).toBeGreaterThan(0);

    const other = clone();
    const child = other.persons.find((p) => p.relation === "child" && !p.predeceased)!;
    land(other).smallResidential = { applies: false, acquirerId: child.id, check: { ownHome: "yes", special: "no" } };
    expect(withSmallLandAcquirers(other)).toBe(other);
  });

  it("何人かで分けるとき・分け方がまだのとき・特例の欄に触っていないときは入れない", () => {
    const c = clone();
    land(c).smallResidential = { applies: false, check: { ownHome: "yes", special: "no" } };
    const child = c.persons.find((p) => p.relation === "child" && !p.predeceased)!;
    c.allocations = c.allocations.map((al) =>
      al.assetId === "home-land" ? { ...al, shares: [{ personId: "hanako", numerator: 1, denominator: 2 }, { personId: child.id, numerator: 1, denominator: 2 }] } : al,
    );
    expect(withSmallLandAcquirers(c)).toBe(c);
    c.allocations = c.allocations.filter((al) => al.assetId !== "home-land");
    expect(withSmallLandAcquirers(c)).toBe(c);
    const untouched = clone();
    delete land(untouched).smallResidential;
    expect(withSmallLandAcquirers(untouched)).toBe(untouched);
  });

  it("相続人が1人なら、分け方を省いたうえで、その人を特例の取得する人に入れる", () => {
    const c = clone();
    const spouse = c.persons.find((p) => p.id === "hanako")!;
    c.persons = [spouse];
    c.allocations = [];
    c.debts = c.debts.map((d) => ({ ...d, bearers: [] }));
    for (const a of c.assets) if (a.kind === "insurance" || a.kind === "retirement") a.recipientId = "hanako";
    land(c).smallResidential = { applies: false, check: { ownHome: "yes", special: "no" } };
    const n = withSmallLandAcquirers(withSoleHeir(c));
    expect(land(n).smallResidential?.acquirerId).toBe("hanako");
    const r = calculate(n);
    expect(r.assets.find((l) => l.asset.id === "home-land")!.reduction).toBeGreaterThan(0);
    expect(taxBreakdown(n, r).smallUnused).toEqual([]);
  });
});
