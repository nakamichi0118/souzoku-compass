import { describe, expect, it } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ExtractedAsset } from "@/lib/extract";
import { ClaudeResult, parseNumber, toExtracted } from "../extractSchema";

/** 構造化出力の上限（型が2つ以上ある項目は16個まで、任意の項目は24個まで）に収まっているか */
function complexity(schema: unknown) {
  let unions = 0;
  let optional = 0;
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (o.anyOf || Array.isArray(o.type)) unions++;
    if (o.properties && typeof o.properties === "object") {
      const req = new Set((o.required as string[]) ?? []);
      for (const k of Object.keys(o.properties)) if (!req.has(k)) optional++;
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(schema);
  return { unions, optional };
}

describe("extract schema", () => {
  it("fits the structured-output limits (a 400 'Schema is too complex' otherwise)", () => {
    const { unions, optional } = complexity((zodOutputFormat(ClaudeResult) as unknown as { schema: unknown }).schema);
    expect(unions).toBeLessThanOrEqual(16);
    expect(optional).toBeLessThanOrEqual(24);
  });

  it("rebuilds the screen shape from name/value pairs", () => {
    const out = toExtracted({
      documentType: "残高証明書",
      assets: [
        {
          kind: "deposit",
          label: "みほん銀行 本店",
          fields: [
            { name: "institution", value: "みほん銀行" },
            { name: "accountType", value: "普通預金" },
            { name: "amount", value: "38,250,000円" },
            { name: "accruedInterest", value: "1234" },
            { name: "amount", value: "1" },
          ],
          evidence: "残高 38,250,000円",
        },
        {
          kind: "condo",
          label: "マンション",
          fields: [
            { name: "condo.floor", value: "3" },
            { name: "condo.totalFloors", value: "１１" },
          ],
          evidence: "",
        },
      ],
      notes: [],
    });
    const d: ExtractedAsset = out.assets[0];
    expect(d.amount).toBe(38_250_000);
    expect(d.accruedInterest).toBe(1234);
    expect(d.institution).toBe("みほん銀行");
    expect(d.branch).toBeNull();
    expect(d.prices).toBeNull();
    expect(d.condo).toBeNull();
    expect(out.assets[1].condo?.floor).toBe(3);
    expect(out.assets[1].condo?.totalFloors).toBe(11);
    expect(out.assets[1].condo?.builtYears).toBeNull();
  });

  it("does not guess numbers it cannot read", () => {
    expect(parseNumber("不明")).toBeNull();
    expect(parseNumber("12.5㎡")).toBe(12.5);
    expect(parseNumber("１，０００円")).toBe(1000);
  });
});
