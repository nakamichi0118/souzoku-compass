import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { calculate } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { buildDivisionDoc } from "@/documents/division";
import { build06, build07, buildF1 } from "../attachments";
import { buildFilingPages, formsNotGenerated } from "../filing";
import { layout, renderForms } from "../render";
import { buildSchedule11, divisionStatus, scheduleTotals } from "../schedule11";
import { build15, build5 } from "../schedules";

const num = (v: unknown) => {
  const s = String(v ?? "0").replace(/,/g, "");
  return s.startsWith("△") ? -Number(s.slice(1)) : Number(s || 0);
};

/**
 * デモに、相続時精算課税の贈与・代償金・未分割の預金・アパートの敷地（貸付事業用宅地等）・相次相続控除を加えた架空の事例
 */
function fullCase(): Case {
  const c: Case = structuredClone(demoCase);
  c.decedent.settlementGift = true;
  c.decedent.priorInheritanceTax = true;
  c.decedent.priorInheritance = { date: "2020-01-10", prevTax: 3_000_000, prevAcquired: 80_000_000 };
  c.priorGifts.push({ personId: "ichiro", date: "2024-05-01", amount: 30_000_000, giftTaxPaid: 9_000_000, settlement: true });
  c.compensation = [{ fromId: "ichiro", toId: "hanako", amount: 3_000_000 }];
  c.undivided = true;
  c.allocations = c.allocations.filter((a) => a.assetId !== "dep2");
  c.assets.push({
    id: "apt",
    kind: "land",
    label: "アパート敷地",
    location: "東京都千代田区架空町三丁目4番5",
    areaSqm: 150,
    landUse: "宅地",
    use: "rentedHouse",
    leaseRatio: 0.6,
    method: { type: "rosenka", routePrice: 300_000, depthCorrection: 1.0, district: "普通住宅地区", roads: [{ edge: 0, price: 300_000, depth: 12, notation: "300D" }] },
    smallResidential: { applies: true, acquirerId: "ichiro", check: { continues: "yes", keep: "yes", recent: "no" } },
  });
  c.allocations.push({ assetId: "apt", shares: [{ personId: "ichiro", numerator: 1, denominator: 1 }] });
  return c;
}

/**
 * 精算課税の贈与税を引ききれず還付になり、さくらさん（未成年・特別障害者）の控除を一郎さんが扶養義務者として引く事例。
 * 扶養義務者は配偶者・直系血族・兄弟姉妹なので、この事例のさくらさんは一郎さんの妹（亡くなった方の子）にする
 * （代襲相続人の孫のままだと、一郎さんはおじにあたり扶養義務者にならない）
 */
function refundCase(): Case {
  const c = fullCase();
  c.priorGifts = c.priorGifts.map((g) => (g.settlement ? { ...g, giftTaxPaid: 12_000_000 } : g));
  c.allocations = c.allocations.map((a) =>
    a.assetId === "dep1" ? { ...a, shares: [{ personId: "ichiro", numerator: 49, denominator: 50 }, { personId: "sakura", numerator: 1, denominator: 50 }] } : a,
  );
  c.undivided = false;
  c.allocations.push({ assetId: "dep2", shares: [{ personId: "hanako", numerator: 1, denominator: 1 }] });
  c.persons = c.persons.map((p) =>
    p.id === "sakura" ? { ...p, relation: "child" as const, relationLabel: "長女", substituteOf: undefined, disability: "special" as const } : p,
  );
  return c;
}

const fc = fullCase();
const fr = calculate(fc);
const rc = refundCase();
const rr = calculate(rc);
const person = (r: typeof fr, id: string) => r.persons.find((p) => p.person.id === id)!;

it("事例の前提（止まる事項がなく、使う欄がそろっている）", () => {
  expect(fr.blockers).toEqual([]);
  expect(rr.blockers).toEqual([]);
  expect(fr.undivided).toBe(true);
  expect(person(fr, "ichiro").settlementGifts).toBeGreaterThan(0);
  expect(person(rr, "ichiro").refund).toBeGreaterThan(0);
  expect(person(rr, "ichiro").transfersIn.length).toBeGreaterThan(0);
  expect(fr.persons.some((p) => p.successiveCredit > 0)).toBe(true);
});

describe("第1表", () => {
  it("②精算課税の財産・⑰贈与税額控除額・⑲小計・㉑納付税額を記入する", () => {
    const [p1, p1c] = buildFilingPages(fc, fr);
    const ichiro = person(fr, "ichiro");
    // 一郎さんは第1表（続）の左の列
    expect(p1c.values["a.name"]).toBe("相続 一郎");
    expect(num(p1c.values["a.r02"])).toBe(ichiro.settlementGifts);
    expect(num(p1c.values["a.r17"]) * 100).toBe(ichiro.settlementCredit);
    expect(num(p1c.values["a.r19"])).toBe(ichiro.payable);
    expect(p1c.values["a.r22"]).toBe("");
    expect(p1c.values["a.causeInherit"]).toBe("1");
    expect(p1c.values["a.causeSettlement"]).toBe("1");
    expect(num(p1.values["t.r02"])).toBe(ichiro.settlementGifts);
    expect(num(p1.values["t.r17"]) * 100).toBe(ichiro.settlementCredit);
    expect(num(p1.values["t.r19"])).toBe(fr.totalPayable);
    expect(num(p1.values["t.r21"]) * 100).toBe(fr.totalPayable);
    // ④＝①＋②－③
    expect(num(p1c.values["a.r04"])).toBe(ichiro.acquired + ichiro.settlementGifts - ichiro.debts);
  });

  it("⑯－⑰が赤字のときは⑲に△を付け、㉒に還付される税額を書き、㉑は空欄", () => {
    const [p1, p1c] = buildFilingPages(rc, rr);
    const ichiro = person(rr, "ichiro");
    expect(p1c.values["a.r19"]).toBe(`△${ichiro.refund.toLocaleString("ja-JP")}`);
    expect(num(p1c.values["a.r22"])).toBe(ichiro.refund);
    expect(p1c.values["a.r21"]).toBe("");
    expect(num(p1.values["t.r22"])).toBe(rr.totalRefund);
    expect(num(p1.values["t.r19"])).toBe(rr.totalPayable - rr.totalRefund);
  });
});

describe("第11表と付表（未分割・代償金・利用区分）", () => {
  it("一部だけ分けたときは分割状況を2にし、未分割の分を合計表②に書く", () => {
    const [t11] = buildSchedule11(fc, fr);
    expect(t11.values.divStatus).toBe("2");
    for (let j = 0; j < 3; j++) {
      const p = fr.persons.find((x) => x.person.name === t11.values[`l${j}.name`])!;
      expect(num(t11.values[`s${j}.undivided`])).toBe(p.undivided);
      expect(num(t11.values[`s${j}.divided`]) + num(t11.values[`s${j}.undivided`])).toBe(num(t11.values[`s${j}.total`]));
      expect(num(t11.values[`s${j}.total`])).toBe(p.acquired);
    }
  });

  it("付表の「分割が確定した財産」の合計が合計表①、未分割を含めると第1表①と一致する", () => {
    const { byPerson, dividedByPerson, items } = scheduleTotals(fc, fr);
    for (const p of fr.persons) {
      expect(byPerson.get(p.person.id) ?? 0).toBe(p.acquired);
      expect(dividedByPerson.get(p.person.id) ?? 0).toBe(p.acquired - p.undivided);
    }
    // 未分割の預金は取得者を書かない
    const dep2 = items.find((i) => i.values.bank === "ためし信用金庫")!;
    expect(dep2.acquirers).toEqual([]);
    expect(dep2.undivided.reduce((a, b) => a + b.amount, 0)).toBe(dep2.value);
  });

  it("全部未分割なら3、全部分割なら1", () => {
    expect(divisionStatus(calculate(demoCase))).toBe("1");
    const c = structuredClone(demoCase);
    c.undivided = true;
    c.allocations = [];
    for (const a of c.assets) if (a.kind === "land") a.smallResidential = undefined;
    const r = calculate(c);
    expect(r.blockers).toEqual([]);
    expect(divisionStatus(r)).toBe("3");
  });

  it("代償金は付表4に細目「代償財産」・価額0で、払う人は△、受け取る人はプラスで書く", () => {
    const f4 = buildSchedule11(fc, fr).find((p) => p.page === "t11_f4")!;
    const j = [0, 1, 2, 3].find((k) => f4.values[`i${k}.kind`] === "代償財産")!;
    expect(f4.values[`i${j}.value`]).toBe("0");
    const amounts = [f4.values[`i${j}.a0.value`], f4.values[`i${j}.a1.value`]];
    expect(amounts).toEqual(["△3,000,000", "3,000,000"]);
  });

  it("利用区分：アパートの敷地は貸家建付地、貸している家屋は貸家", () => {
    const f1 = buildSchedule11(fc, fr).find((p) => p.page === "t11_f1")!;
    const uses = Object.entries(f1.values).filter(([k]) => k.endsWith(".use")).map(([, v]) => v);
    expect(uses).toContain("貸家建付地");
    expect(uses).toContain("自用地");
    const c = structuredClone(demoCase);
    c.assets = c.assets.map((a) => (a.kind === "building" ? { ...a, rented: true } : a));
    const f1b = buildSchedule11(c, calculate(c)).find((p) => p.page === "t11_f1")!;
    expect(Object.values(f1b.values)).toContain("貸家");
  });

  it("第15表：代償金は㉘その他、精算課税の財産は㉛に入り、㊳が第1表⑥と一致する", () => {
    const pages = build15(fc, fr);
    const ichiro = person(fr, "ichiro");
    const pg = pages.find((p) => p.values["a.name"] === "相続 一郎" || p.values["p.name"] === "相続 一郎")!;
    const k = pg.values["a.name"] === "相続 一郎" ? "a" : "p";
    expect(num(pg.values[`${k}.r28`])).toBe(-3_000_000);
    expect(num(pg.values[`${k}.r31`])).toBe(ichiro.settlementGifts);
    expect(num(pg.values[`${k}.r36`])).toBe(ichiro.net);
    expect(num(pg.values[`${k}.r38`]) * 1000).toBe(ichiro.taxable);
  });
});

describe("第5表（未分割の財産があるとき）", () => {
  it("①分割財産の価額・③未分割財産の価額・④（②－③）をエンジンの配偶者の税額軽減と合わせる", () => {
    const [pg] = build5(fc, fr);
    const s = fr.spouse!;
    expect(num(pg.values.g06)).toBe(s.divided);
    expect(num(pg.values.g07)).toBe(s.debts);
    expect(num(pg.values.g08)).toBe(s.undivided);
    expect(s.undivided).toBeGreaterThan(0);
    expect(pg.values.g09).toBe("0");
    expect(num(pg.values.g11) * 1000).toBe(s.spouseTaxable);
    expect(num(pg.values.g19)).toBe(person(fr, "hanako").spouseCredit);
  });
});

describe("第6表（扶養義務者から引く控除）", () => {
  it("扶養義務者の氏名・相続税額・引いた額を書く", () => {
    const [pg] = build06(rc, rr);
    const ichiro = person(rr, "ichiro");
    const minorIn = ichiro.transfersIn.filter((t) => t.kind === "minor").reduce((a, t) => a + t.amount, 0);
    const disIn = ichiro.transfersIn.filter((t) => t.kind === "disability").reduce((a, t) => a + t.amount, 0);
    expect(pg.values["s0.name"]).toBe("相続 一郎");
    expect(num(pg.values["s0.tax"])).toBe(ichiro.beforeOtherCredits);
    expect(num(pg.values["s0.credit"])).toBe(minorIn);
    expect(pg.values["t0.name"]).toBe("相続 一郎");
    expect(num(pg.values["t0.tax"])).toBe(ichiro.beforeOtherCredits - ichiro.minorCredit - minorIn);
    expect(num(pg.values["t0.credit"])).toBe(disIn);
    // 引いた額の合計は、控除しきれない金額（Ⓐ）を超えない
    expect(num(pg.values["s.credit"])).toBeLessThanOrEqual(num(pg.values["m.excess"]));
  });
});

describe("第7表（相次相続控除）", () => {
  it("総額Ⓐと各人の⑬を書き、第7表は作れない表の一覧に出さない", () => {
    const [pg] = build07(fc, fr);
    const s = fr.successive!;
    expect(num(pg.values.total)).toBe(s.total);
    expect(num(pg.values.r09)).toBe(s.total);
    expect(num(pg.values.r11)).toBe(s.netTotal);
    expect(pg.values.r03).toBe(s.years);
    expect(pg.values.r04).toBe(10 - s.years);
    for (let j = 0; j < 3; j++) {
      const p = fr.persons.find((x) => x.person.name === pg.values[`h${j}.name`])!;
      expect(num(pg.values[`h${j}.net`])).toBe(p.net);
      expect(num(pg.values[`h${j}.credit`])).toBe(Math.floor((s.total * p.net) / s.netTotal));
      expect(num(pg.values[`h${j}.credit`])).toBeGreaterThanOrEqual(p.successiveCredit);
    }
    const missing = formsNotGenerated(fc, fr).map((m) => m.form).join("\n");
    expect(missing).not.toMatch(/第7表/);
    expect(missing).not.toMatch(/第8の8表/);
    // 第8の8表の③に各人の相次相続控除額（第1表⑭へ）
    const p88 = buildFilingPages(fc, fr).filter((pg) => pg.page === "t08_8");
    for (const pg of p88)
      for (const j of [0, 1]) {
        const p = fr.persons.find((x) => x.person.name === pg.values[`h${j}.name`]);
        if (p) expect(num(pg.values[`h${j}.r3`])).toBe(p.successiveCredit);
      }
    expect(p88.length).toBeGreaterThan(0);
  });
  it("相次相続控除を使わないときは作らない", () => {
    expect(build07(demoCase, calculate(demoCase))).toEqual([]);
  });
});

describe("付表1（小規模宅地等の種類と限度面積要件）", () => {
  it("種類の番号（1 特定居住用・4 貸付事業用）と、貸付事業用があるときの限度面積（ロ）を書く", () => {
    const [f] = buildF1(fc, fr);
    expect([f.values["b0.kind"], f.values["b1.kind"]].sort()).toEqual(["1", "4"]);
    const rentalRow = f.values["b0.kind"] === "4" ? "b0" : "b1";
    expect(f.values[`${rentalRow}.business`]).toBe("貸家");
    const res = fr.assets.find((l) => l.small?.kind === "residence")!.small!;
    const rent = fr.assets.find((l) => l.small?.kind === "rental")!.small!;
    expect(num(f.values.area1)).toBe(res.selectedArea);
    expect(num(f.values.area4)).toBe(rent.selectedArea);
    expect(num(f.values.limitB1)).toBe(res.selectedArea);
    expect(num(f.values.limitB4)).toBe(rent.selectedArea);
    expect(f.values.limitA).toBeUndefined();
    // 限度面積要件：1の面積×200/330＋4の面積 ≦ 200㎡
    expect((res.selectedArea * 200) / 330 + rent.selectedArea).toBeLessThanOrEqual(200.0001);
  });
  it("特定居住用だけのときはイに書く", () => {
    const [f] = buildF1(demoCase, calculate(demoCase));
    expect(f.values["b0.kind"]).toBe("1");
    expect(f.values.limitA).toBe(f.values.area1);
    expect(f.values.limitB1).toBeUndefined();
  });
});

describe("作れない表の一覧", () => {
  it("精算課税の第11の2表、還付の第1表の付表2、未分割の分割見込書を挙げる", () => {
    const a = formsNotGenerated(fc, fr).map((m) => m.form).join("\n");
    expect(a).toMatch(/第11の2表/);
    expect(a).toMatch(/申告期限後3年以内の分割見込書/);
    expect(a).not.toMatch(/第1表の付表2/);
    const b = formsNotGenerated(rc, rr).map((m) => m.form).join("\n");
    expect(b).toMatch(/第1表の付表2/);
    expect(b).not.toMatch(/分割見込書/);
    expect(formsNotGenerated(demoCase, calculate(demoCase)).map((m) => m.form).join("\n")).not.toMatch(/第11の2表|付表2|分割見込書/);
  });
  it("貸している土地で空き部屋があり特例を使うときは付表1（別表1）を挙げる", () => {
    const c = fullCase();
    c.assets = c.assets.map((a) => (a.id === "apt" && a.kind === "land" ? { ...a, rentRatio: 0.8 } : a));
    expect(formsNotGenerated(c, calculate(c)).map((m) => m.form).join("\n")).toMatch(/別表1/);
  });
});

describe("申告書一式", () => {
  it("すべての欄IDが様式の座標表にあり、PDFを作れる", async () => {
    for (const [c, r] of [
      [fc, fr],
      [rc, rr],
    ] as const) {
      const pages = buildFilingPages(c, r);
      for (const p of pages) {
        const fields = layout[p.page].fields as Record<string, unknown>;
        for (const k of Object.keys(p.values)) if (p.values[k] !== undefined && p.values[k] !== "") expect(fields[k], `${p.page}:${k}`).toBeDefined();
      }
      expect(pages.map((p) => p.page)).toContain("t11_11_2_f1");
    }
    expect(buildFilingPages(fc, fr).map((p) => p.page)).toContain("t07");
    const pdf = await renderForms(buildFilingPages(fc, fr));
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  }, 30_000);
});

describe("遺産分割協議書の代償金", () => {
  it("代償金1件ごとに、払う人・受け取る人・金額の条を入れる", () => {
    const d = buildDivisionDoc(fc);
    const clause = d.articles.find((a) => a.heading.includes("代償として"))!;
    expect(clause.heading).toMatch(/相続人 相続 一郎 は、第\d+条記載の遺産を取得する代償として、相続人 相続 花子 に対し、金3,000,000円を支払う。/);
  });
  it("受け取る人が相続人でない・金額がない代償金は書かずに知らせる", () => {
    const c = fullCase();
    c.persons.push({ id: "x", name: "受遺 者", relation: "other" });
    c.compensation = [
      { fromId: "ichiro", toId: "x", amount: 1_000_000 },
      { fromId: "ichiro", toId: "sakura", amount: 0 },
    ];
    const d = buildDivisionDoc(c);
    expect(d.articles.some((a) => a.heading.includes("代償として"))).toBe(false);
    expect(d.warnings.filter((w) => w.includes("代償金"))).toHaveLength(2);
  });
  it("代償金だけを受け取る相続人には「何も取得しない」の注意を出さない", () => {
    const c = structuredClone(demoCase);
    c.allocations = c.allocations.map((a) => ({ ...a, shares: a.shares.map((s) => (s.personId === "sakura" ? { ...s, personId: "ichiro" } : s)) }));
    c.compensation = [{ fromId: "ichiro", toId: "sakura", amount: 2_000_000 }];
    const d = buildDivisionDoc(c);
    expect(d.warnings.some((w) => w.includes("相続 さくらさんは何も取得しません"))).toBe(false);
  });
});
