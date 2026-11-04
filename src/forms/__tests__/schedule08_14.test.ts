import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { calculate } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { build08_8, build14 } from "../attachments";
import { buildFilingPages, formsNotGenerated } from "../filing";
import { layout } from "../render";

const clone = (): Case => structuredClone(demoCase);

describe("第8の8表", () => {
  it("未成年者控除を使う人の①⑤を書き、⑤は第1表⑭（otherCredits）と同じ", () => {
    const c = clone();
    const r = calculate(c);
    const pages = build08_8(c, r);
    expect(pages).toHaveLength(1);
    const p = r.persons.find((x) => x.otherCredits > 0)!;
    expect(pages[0].values["h0.name"]).toBe(p.person.name);
    expect(pages[0].values["h0.r1"]).toBe(p.otherCredits.toLocaleString("ja-JP"));
    expect(pages[0].values["h0.r5"]).toBe(p.otherCredits.toLocaleString("ja-JP"));
    expect(pages[0].values["h1.name"]).toBeUndefined();
  });

  it("控除を使う人がいなければ作らない", () => {
    const c = clone();
    c.persons = c.persons.map((p) => ({ ...p, birthDate: "1980-01-01" }));
    expect(build08_8(c, calculate(c))).toEqual([]);
  });
});

describe("第14表", () => {
  it("3年以内の暦年贈与を1件ずつ書き、各人の④は第1表⑤（gifts）と同じ", () => {
    const c = clone();
    c.priorGifts = [
      { personId: "sakura", date: "2024-12-20", amount: 1_100_000, giftTaxPaid: 0 },
      { personId: "sakura", date: "2025-06-01", amount: 500_000, giftTaxPaid: 0 },
      // 3年より前・精算課税は書かない
      { personId: "sakura", date: "2022-01-10", amount: 900_000, giftTaxPaid: 0 },
      { personId: "ichiro", date: "2025-02-01", amount: 2_000_000, giftTaxPaid: 90_000, settlement: true },
    ];
    const r = calculate(c);
    const pages = build14(c, r);
    expect(pages).toHaveLength(1);
    const v = pages[0].values;
    expect([v["g0.amount"], v["g1.amount"], v["g2.amount"]]).toEqual(["1,100,000", "500,000", undefined]);
    expect([v["g0.era"], v["g0.y"], v["g0.m"], v["g0.d"]]).toEqual(["5", 6, 12, 20]);
    const sakura = r.persons.find((p) => p.person.id === "sakura")!;
    expect(v["p0.total"]).toBe(sakura.gifts.toLocaleString("ja-JP"));
    expect(v["p.total"]).toBe("1,600,000");
  });

  it("デモでは第8の8表と第14表が申告書に入り、「別に用意する表」に出ない", () => {
    const c = clone();
    const r = calculate(c);
    const pages = buildFilingPages(c, r).map((p) => p.page);
    expect(pages).toEqual(expect.arrayContaining(["t08_8", "t14"]));
    expect(pages.indexOf("t08_8")).toBeLessThan(pages.indexOf("t09"));
    expect(pages.indexOf("t14")).toBe(pages.indexOf("t13") + 1);
    expect(formsNotGenerated(c, r)).toEqual([]);
  });

  it("書く欄はすべて様式の座標にある", () => {
    const c = clone();
    const r = calculate(c);
    for (const p of [...build08_8(c, r), ...build14(c, r)])
      for (const k of Object.keys(p.values)) expect(layout[p.page]?.fields[k], `${p.page} ${k}`).toBeDefined();
  });
});
