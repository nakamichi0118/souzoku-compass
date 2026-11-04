import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { CONSULT_FIRM } from "@/data/consultFirm";
import { calculate } from "@/domain/tax/engine";
import { consultMailto, consultPoints } from "../consult";

describe("相談のメール", () => {
  it("申告前の確認で相談になった項目を、相談したいことに入れる", () => {
    const c = { ...structuredClone(demoCase), review: { answers: { foreign: "yes" as const, nominee: "unsure" as const } } };
    const pts = consultPoints(c, calculate(c));
    expect(pts.some((p) => p.includes("国外"))).toBe(true);
    expect(pts.some((p) => p.includes("分からない（未確認）"))).toBe(true);
  });

  it("送り先があるときだけメールのリンクを作る", () => {
    const c = structuredClone(demoCase);
    const link = consultMailto(c, calculate(c));
    if (!CONSULT_FIRM.email) expect(link).toBeNull();
    else {
      expect(link).toMatch(new RegExp(`^mailto:${CONSULT_FIRM.email}\\?subject=`));
      expect(decodeURIComponent(link!.split("body=")[1]).length).toBeLessThan(1700);
    }
  });
});
