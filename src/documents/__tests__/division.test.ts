import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { buildRegistrations } from "@/domain/registration";
import { calculate } from "@/domain/tax/engine";
import { NO_HEIRS_MESSAGE, NO_PERSONS_MESSAGE, buildDivisionDoc } from "../division";
import { propertyLines } from "../propertyLines";
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
  it("不動産の表示は登記簿の地番・家屋番号を使い、登記申請書と同じ記載になる", () => {
    const c = structuredClone(demoCase);
    const land = c.assets.find((a) => a.id === "home-land")!;
    if (land.kind === "land") {
      land.location = "大阪府大阪市北区梅田3丁目1番";
      land.registry = { ...land.registry, lotNumber: "1番10" };
    }
    const hanako = buildDivisionDoc(c).articles.find((a) => a.heading.includes("相続 花子"))!.items.join("\n");
    expect(hanako).toContain("所　　在　大阪府大阪市北区梅田3丁目");
    expect(hanako).toContain("地　　番　1番10");
    expect(hanako).toContain("家屋番号　2番3");
    expect(hanako).toContain("構　　造　木造スレートぶき2階建");
    const regs = buildRegistrations(c).filter((a) => a.applicants[0].personId === "hanako");
    expect(regs.flatMap((a) => a.properties)).toHaveLength(2);
    for (const p of regs.flatMap((a) => a.properties)) for (const line of propertyLines(p)) expect(hanako).toContain(line);
    const ichiro = buildDivisionDoc(c).articles.find((a) => a.heading.includes("相続 一郎"))!.items.join("\n");
    expect(ichiro).toContain("所有権　10000分の169");
  });
  it("登記簿の項目が足りないときは「登記事項証明書のとおり」と書く", () => {
    const c = structuredClone(demoCase);
    const bldg = c.assets.find((a) => a.id === "home-bldg")!;
    if (bldg.kind === "building") bldg.registry = undefined;
    const hanako = buildDivisionDoc(c).articles.find((a) => a.heading.includes("相続 花子"))!.items.join("\n");
    expect(hanako).toContain("家屋番号　（登記事項証明書のとおり）");
    // 種類も推測で「居宅」と書かない
    expect(hanako).toContain("種　　類　（登記事項証明書のとおり）");
    expect(hanako).not.toContain("居宅");
  });
  it("相続人でない人に複数の財産を割り当てても、注意は1回だけ出す", () => {
    const c = structuredClone(demoCase);
    c.persons.push({ id: "x", name: "受遺 者", relation: "other" });
    c.allocations = c.allocations.map((a) => (a.assetId === "dep2" || a.assetId === "cash" ? { ...a, shares: [{ personId: "x", numerator: 1, denominator: 1 }] } : a));
    const doc = buildDivisionDoc(c);
    expect(doc.warnings.filter((w) => w.includes("受遺 者"))).toHaveLength(1);
    expect(new Set(doc.warnings).size).toBe(doc.warnings.length);
  });
  it("民法上の相続人がいない（全員が放棄した）ときは協議書を作らず、計算と同じ説明で止める", () => {
    const c = structuredClone(demoCase);
    c.persons = c.persons.map((p) => ({ ...p, renounced: true }));
    expect(() => buildDivisionDoc(c)).toThrow(NO_HEIRS_MESSAGE);
    // 最初の文は計算エンジンの止める事項（相続人不存在）と同じ
    const first = NO_HEIRS_MESSAGE.split("。")[0];
    expect(calculate(c).blockers.some((b) => b.startsWith(first))).toBe(true);
  });
  it("家族が入っていないときも協議書を作らない", () => {
    const c = structuredClone(demoCase);
    c.persons = [];
    expect(() => buildDivisionDoc(c)).toThrow(NO_PERSONS_MESSAGE);
    expect(calculate(c).blockers).toContain(NO_PERSONS_MESSAGE);
  });
  it("遺産を受け継がない人が払う代償金は「遺産を取得する代償として」と書かず、知らせる", () => {
    const c = structuredClone(demoCase);
    // 一郎さんは遺産を受け継がない（保険金だけ受け取る）のに、さくらさんに代償金を払う
    // 一郎さん・さくらさんの分はすべて花子さんが受け継ぐ（同じ財産の持分は1つにまとめる）
    c.allocations = c.allocations.map((a) => ({ ...a, shares: [{ personId: "hanako", numerator: 1, denominator: 1 }] }));
    c.assets = c.assets.map((a) => (a.kind === "insurance" ? { ...a, recipientId: "ichiro" } : a));
    c.compensation = [{ fromId: "ichiro", toId: "sakura", amount: 1_000_000 }];
    const doc = buildDivisionDoc(c);
    expect(JSON.stringify(doc.articles)).not.toContain("代償として");
    expect(JSON.stringify(doc.articles)).not.toContain("本協議により遺産");
    expect(doc.warnings.some((w) => w.includes("代償金（1件目）") && w.includes("相続 一郎さん"))).toBe(true);
    // 協議書に載らない代償金を受け取る人にも、「何も取得しない」の注意を出す
    expect(doc.warnings.some((w) => w.includes("相続 さくらさんは何も取得しません"))).toBe(true);
  });
  it("PDFを作成できる", async () => {
    const pdf = await renderDivision(d);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
