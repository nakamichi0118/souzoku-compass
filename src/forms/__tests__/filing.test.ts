import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { calculate } from "@/domain/tax/engine";
import { formsNotGenerated } from "../filing";

const forms = (c: typeof demoCase, r = calculate(c)) => formsNotGenerated(c, r).map((m) => m.form).join("\n");

describe("自動で作らない表の一覧", () => {
  it("3年以内の贈与を足したときは第14表を挙げる", () => {
    const r = calculate(demoCase);
    expect(r.persons.some((p) => p.gifts > 0)).toBe(true);
    expect(forms(demoCase, r)).toMatch(/第14表/);
  });

  it("贈与を足さないときは第14表を挙げない", () => {
    const c = structuredClone(demoCase);
    c.priorGifts = [];
    expect(forms(c)).not.toMatch(/第14表/);
  });

  it("2割加算がある人がいれば第4表を挙げる", () => {
    const r = calculate(demoCase);
    expect(forms(demoCase, r)).not.toMatch(/第4表（/);
    const withSurcharge = { ...r, persons: r.persons.map((p, i) => (i === 0 ? { ...p, surcharge: 100_000 } : p)) };
    expect(forms(demoCase, withSurcharge)).toMatch(/第4表（相続税額の加算金額の計算書）/);
  });

  it("小規模宅地等の特例を使う土地を2人で取得したときは付表1（別表1）を挙げる", () => {
    expect(forms(demoCase)).not.toMatch(/別表1/);
    const c = structuredClone(demoCase);
    c.allocations = c.allocations.map((a) =>
      a.assetId === "home-land"
        ? {
            ...a,
            shares: [
              { personId: "hanako", numerator: 1, denominator: 2 },
              { personId: "ichiro", numerator: 1, denominator: 2 },
            ],
          }
        : a,
    );
    const r = calculate(c);
    expect(r.assets.find((l) => l.asset.id === "home-land")?.small).toBeDefined();
    expect(forms(c, r)).toMatch(/第11・11の2表の付表1（別表1）/);
  });
});
