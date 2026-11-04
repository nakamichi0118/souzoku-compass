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

  it("住所から都道府県を取り出す", () => {
    expect(prefectureOf("東京都千代田区架空町")).toBe("東京都");
    expect(prefectureOf("福岡県糸島市")).toBe("福岡県");
    expect(prefectureOf("")).toBe("");
  });
});
