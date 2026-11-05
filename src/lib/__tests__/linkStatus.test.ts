import { describe, expect, it } from "vitest";
import { blankInterview } from "@/domain/procedures/interview";
import { applyStatus } from "../linkStatus";

const iv = { ...blankInterview(), deathDate: "2026-03-15" };

describe("やることリストと資料集めの連動", () => {
  it("戸籍集めを完了にすると、戸籍の書類もそろったになる（不要にした書類はそのまま）", () => {
    expect(applyStatus([], "koseki", "done", iv).sort()).toEqual(["doc:kosekiDecedent", "doc:kosekiHeirs", "koseki"]);
    expect(applyStatus(["na:doc:kosekiHeirs"], "koseki", "done", iv)).not.toContain("doc:kosekiHeirs");
  });

  it("残高証明書は、株があるときは株の残高証明書もそろって、はじめて手続きを完了にする", () => {
    const sec = { ...iv, securities: 1 };
    expect(applyStatus([], "doc:balanceCert", "done", iv)).toContain("bank-notice");
    const half = applyStatus([], "doc:balanceCert", "done", sec);
    expect(half).not.toContain("bank-notice");
    expect(applyStatus(half, "doc:securitiesCert", "done", sec)).toContain("bank-notice");
  });

  it("戻すときは押したほうだけ。関係のない手続きは連動しない", () => {
    const all = applyStatus([], "koseki", "done", iv);
    expect(applyStatus(all, "koseki", "open", iv).sort()).toEqual(["doc:kosekiDecedent", "doc:kosekiHeirs"]);
    expect(applyStatus([], "death-report", "done", iv)).toEqual(["death-report"]);
    expect(applyStatus([], "doc:deathCert", "done", iv)).toEqual(["doc:deathCert"]);
  });
});
