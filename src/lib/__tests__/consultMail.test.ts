import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { prefectureOf } from "@/data/consultFirm";
import { calculate } from "@/domain/tax/engine";
import { consultMemo, consultPoints } from "../consult";

describe("相談の内容", () => {
  it("申告前の確認で相談になった項目を、相談したいことに入れる", () => {
    const c = { ...structuredClone(demoCase), review: { answers: { foreign: "yes" as const, nominee: "unsure" as const } } };
    const pts = consultPoints(c, calculate(c));
    expect(pts.some((p) => p.includes("国外"))).toBe(true);
    expect(pts.some((p) => p.includes("分からない（未確認）"))).toBe(true);
    expect(consultMemo(c, calculate(c))).toContain("相談したいこと");
  });

  it("マンションの部屋で家族が住んでいたか分からないときは、「部屋」と書く", () => {
    const c = structuredClone(demoCase);
    const condo = c.assets.find((a) => a.kind === "condo");
    if (condo?.kind !== "condo") throw new Error("condo");
    const child = c.persons.find((p) => p.relation === "child")!;
    condo.smallResidential = { applies: true, acquirerId: child.id, check: { ownHome: "no", business: "no", familyHome: "unsure" } };
    const line = consultPoints(c, calculate(c)).find((p) => p.includes(condo.label));
    expect(line).toContain("同じ家計の家族が無料で住んでいた部屋かどうか");
  });

  it("住所から都道府県を取り出す", () => {
    expect(prefectureOf("東京都千代田区架空町")).toBe("東京都");
    expect(prefectureOf("福岡県糸島市")).toBe("福岡県");
    expect(prefectureOf("")).toBe("");
  });
});
