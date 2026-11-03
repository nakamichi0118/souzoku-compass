import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import type { Case } from "@/domain/types";
import { CASE_LIMITS, checkCase } from "../caseSchema";

const fresh = (): Case => structuredClone(demoCase);

describe("書類を作る API に送られた相続の入力の確認", () => {
  it("画面から送られるふつうの入力は、そのまま通す（知らない項目も消さない）", () => {
    const c = { ...fresh(), extra: { future: true } };
    const r = checkCase(c);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe(c);
  });

  it("同じ id の人が二重にいる入力は断る（相続人の数え上げが際限なく増えるのを防ぐ）", () => {
    const c = fresh();
    c.persons.push({ ...c.persons[3] });
    const r = checkCase(c);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("二重") });
  });

  it("代襲相続の親が一覧にいない・自分自身・ぐるりと戻るつながりは断る", () => {
    const missing = fresh();
    missing.persons[3].substituteOf = "nobody";
    expect(checkCase(missing)).toEqual({ ok: false, error: expect.stringContaining("一覧にいません") });

    const self = fresh();
    self.persons[3].substituteOf = self.persons[3].id;
    expect(checkCase(self).ok).toBe(false);

    const loop = fresh();
    loop.persons[2].substituteOf = "sakura"; // 次郎はさくらの代わり、さくらは次郎の代わり
    expect(checkCase(loop)).toEqual({ ok: false, error: expect.stringContaining("ぐるり") });
  });

  it("件数の上限を超える入力は、どの件数が多いかを日本語で返して断る", () => {
    const c = fresh();
    c.persons = Array.from({ length: CASE_LIMITS.persons + 1 }, (_, i) => ({ id: `p${i}`, name: `人${i}`, relation: "child" as const }));
    expect(checkCase(c)).toEqual({ ok: false, error: expect.stringContaining(`${CASE_LIMITS.persons}件まで`) });

    const a = fresh();
    a.assets = Array.from({ length: CASE_LIMITS.assets + 1 }, (_, i) => ({ id: `a${i}`, kind: "cash" as const, label: "現金", amount: 1 }));
    expect(checkCase(a)).toEqual({ ok: false, error: expect.stringContaining("財産") });

    const g = fresh();
    g.priorGifts = Array.from({ length: CASE_LIMITS.priorGifts + 1 }, () => ({ personId: "sakura", date: "2025-01-01", amount: 1, giftTaxPaid: 0 }));
    expect(checkCase(g).ok).toBe(false);

    const roads = fresh();
    const land = roads.assets[0];
    if (land.kind === "land" && land.method.type === "rosenka") land.method.roads = Array.from({ length: 5 }, (_, i) => ({ edge: (i % 4) as 0 | 1 | 2 | 3, price: 1, depth: 1 }));
    expect(checkCase(roads).ok).toBe(false);
  });

  it("形が違う入力は、英語のメッセージを見せずに断る", () => {
    for (const bad of [null, "x", [], { persons: [] }, { ...fresh(), persons: "x" }, { ...fresh(), assets: [{ kind: "cash" }] }]) {
      const r = checkCase(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/[぀-ヿ一-鿿]/);
    }
  });
});
