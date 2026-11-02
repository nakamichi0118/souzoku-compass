import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { buildDivisionDoc } from "../division";
import { renderDivision } from "../renderDivision";

describe("遺産分割協議書", () => {
  const d = buildDivisionDoc(demoCase);
  it("相続人全員（先に亡くなった人を除く）が署名者になる", () => {
    expect(d.signers.map((s) => s.name)).toEqual(["相続 花子", "相続 一郎", "相続 さくら"]);
  });
  it("未成年の相続人には法定代理人欄と注意を付ける", () => {
    expect(d.signers.find((s) => s.name === "相続 さくら")?.minor).toBe(true);
    expect(d.warnings.some((w) => w.includes("特別代理人"))).toBe(true);
  });
  it("生命保険金は分割の対象にしない", () => {
    expect(JSON.stringify(d.articles)).not.toContain("保険");
  });
  it("共有で取得する預金は持分を記載する", () => {
    const sakura = d.articles.find((a) => a.heading.includes("相続 さくら"))!;
    expect(sakura.items[0]).toContain("2分の1");
  });
  it("相続放棄をした人は署名者にならない", () => {
    const c = structuredClone(demoCase);
    c.persons = c.persons.map((p) => (p.id === "ichiro" ? { ...p, renounced: true } : p));
    expect(buildDivisionDoc(c).signers.map((s) => s.name)).not.toContain("相続 一郎");
  });
  it("取得者が決まっていない財産は記載せず注意を出す", () => {
    const c = structuredClone(demoCase);
    c.allocations = c.allocations.filter((a) => a.assetId !== "stock");
    const doc = buildDivisionDoc(c);
    expect(JSON.stringify(doc.articles)).not.toContain("架空工業");
    expect(doc.warnings.some((w) => w.includes("架空工業"))).toBe(true);
  });
  it("PDFを作成できる", async () => {
    const pdf = await renderDivision(d);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
