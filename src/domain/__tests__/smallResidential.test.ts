import { describe, expect, it } from "vitest";
import { judgeSmallResidential, shouldApply } from "../valuation/smallResidential";
import type { Person } from "../types";

const spouse: Person = { id: "s", name: "花子", relation: "spouse" };
const child: Person = { id: "c", name: "一郎", relation: "child" };

describe("小規模宅地等の特例の判定", () => {
  it("配偶者は自宅の敷地なら使える", () => {
    expect(judgeSmallResidential({ ownHome: "yes", special: "no" }, spouse).result).toBe("ok");
  });
  it("同居して住み続ける子は使える", () => {
    expect(judgeSmallResidential({ ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, child).result).toBe("ok");
  });
  it("別居の子（家なき子）・分からない答え・老人ホームなどは税理士へ", () => {
    expect(judgeSmallResidential({ ownHome: "yes", special: "no", livedTogether: "no" }, child).result).toBe("consult");
    expect(judgeSmallResidential({ ownHome: "yes", special: "no", livedTogether: "yes", keep: "unsure" }, child).result).toBe("consult");
    expect(judgeSmallResidential({ ownHome: "yes", special: "yes" }, spouse).result).toBe("consult");
  });
  it("売る・引っ越す場合や自宅でない土地は使えない", () => {
    expect(judgeSmallResidential({ ownHome: "yes", special: "no", livedTogether: "yes", keep: "no" }, child).result).toBe("no");
    expect(judgeSmallResidential({ ownHome: "no" }, spouse).result).toBe("no");
  });
  it("相談が必要な場合は、税理士に確認したときだけ適用する", () => {
    const c = { ownHome: "yes" as const, special: "no" as const, livedTogether: "no" as const };
    const j = judgeSmallResidential(c, child);
    expect(shouldApply(j, c)).toBe(false);
    expect(shouldApply(j, { ...c, confirmedByAdvisor: true })).toBe(true);
    expect(judgeSmallResidential({}, undefined).result).toBe("incomplete");
  });
});
