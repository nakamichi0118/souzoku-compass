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

describe("付表1（別表1）（貸家建付借地権）", () => {
  it("借地に建てたアパートで空き部屋があり、特例を使うときも付表1（別表1）を挙げる", () => {
    const c = structuredClone(demoCase);
    c.assets.push({
      id: "lh",
      kind: "land",
      label: "借地のアパート",
      location: "東京都千代田区架空町五丁目1番",
      areaSqm: 100,
      landUse: "宅地",
      use: "rentedLeasehold",
      leaseRatio: 0.6,
      rentRatio: 0.8,
      method: { type: "rosenka", routePrice: 300_000, depthCorrection: 1.0, district: "普通住宅地区", roads: [{ edge: 0, price: 300_000, depth: 10, notation: "300D" }] },
      smallResidential: { applies: true, acquirerId: "ichiro", check: { continues: "yes", keep: "yes", recent: "no" } },
    });
    c.allocations.push({ assetId: "lh", shares: [{ personId: "ichiro", numerator: 1, denominator: 1 }] });
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    expect(r.assets.find((l) => l.asset.id === "lh")!.reduction).toBeGreaterThan(0);
    expect(forms(c, r)).toMatch(/別表1/);
    const full = structuredClone(c);
    full.assets = full.assets.map((a) => (a.id === "lh" && a.kind === "land" ? { ...a, rentRatio: 1 } : a));
    expect(forms(full)).not.toMatch(/別表1/);
  });
});

describe("第1表⑰（相続時精算課税分の贈与税額控除額）", () => {
  const num = (v: unknown) => {
    const s = String(v ?? "0").replace(/,/g, "");
    return s.startsWith("△") ? -Number(s.slice(1)) : Number(s || 0);
  };
  it("エンジンの額（100円未満切捨て）をそのまま書き、⑯－⑰が⑲と一致する", async () => {
    const { buildFilingPages } = await import("../filing");
    const c = structuredClone(demoCase);
    c.decedent.settlementGift = true;
    // 贈与税の申告書の控えを写し間違えた（100円未満の端数がある）入力
    c.priorGifts.push({ personId: "ichiro", date: "2024-05-01", amount: 30_000_000, giftTaxPaid: 12_345_678, settlement: true });
    const r = calculate(c);
    const ichiro = r.persons.find((p) => p.person.id === "ichiro")!;
    expect(ichiro.settlementCredit).toBe(12_345_600);
    const pages = buildFilingPages(c, r);
    const t01c = pages.find((p) => p.page === "t01c" && p.values["a.name"] === "相続 一郎")!;
    expect(num(t01c.values["a.r17"]) * 100).toBe(ichiro.settlementCredit);
    expect(num(t01c.values["a.r16"]) - num(t01c.values["a.r17"]) * 100).toBe(num(t01c.values["a.r19"]));
    const t01 = pages.find((p) => p.page === "t01")!;
    expect(num(t01.values["t.r17"]) * 100).toBe(r.persons.reduce((a, p) => a + p.settlementCredit, 0));
    // 還付になる一郎さんの⑲・㉒は⑯－⑰（還付は100円未満を切り捨てない）
    expect(ichiro.refund).toBe(ichiro.settlementCredit - ichiro.afterCredits);
    expect(num(t01c.values["a.r22"])).toBe(ichiro.refund);
  });
});
