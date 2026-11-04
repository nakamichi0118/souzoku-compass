import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { calculate } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { build06, build09, build10, buildF1 } from "../attachments";
import { buildFilingPages, formsNotGenerated } from "../filing";

const num = (v: unknown) => Number(String(v ?? "0").replace(/,/g, "") || 0);

// デモに死亡退職金・2件目の保険金・一般障害者を加えた架空の事例
const c: Case = structuredClone(demoCase);
c.persons = c.persons.map((p, i) => (i === 1 ? { ...p, disability: "general" as const } : p));
c.assets.push({ id: "ret", kind: "retirement", label: "みほん商事 死亡退職金", amount: 18_000_000, recipientId: c.persons[0].id });
c.assets.push({ id: "ins2", kind: "insurance", label: "さんぷる生命 死亡保険金", amount: 3_000_000, recipientId: c.persons[1].id });
const r = calculate(c);

describe("第9表・第10表", () => {
  it("非課税金額・課税金額がエンジンと一致し、①−②＝③", () => {
    const [p9] = build09(c, r);
    for (let j = 0; j < 2; j++) {
      const name = p9.values[`h${j}.name`];
      const t = r.persons.find((p) => p.person.name === name)!;
      expect(num(p9.values[`h${j}.received`])).toBe(t.insurance);
      expect(num(p9.values[`h${j}.exempt`])).toBe(t.insuranceExempt);
      expect(num(p9.values[`h${j}.taxable`])).toBe(t.insurance - t.insuranceExempt);
    }
    expect(num(p9.values["total.received"])).toBe(23_000_000);
    expect(p9.values.limit).toBe("15");
    expect(p9.values.count).toBe(r.legalHeirCount);
    const [p10] = build10(c, r);
    expect(num(p10.values["h0.exempt"])).toBe(15_000_000);
    expect(num(p10.values["total.taxable"])).toBe(3_000_000);
  });
  it("保険金・退職金がなければ作らない", () => {
    const plain = { ...demoCase, assets: demoCase.assets.filter((a) => a.kind !== "insurance") };
    expect(build09(plain, calculate(plain))).toEqual([]);
    expect(build10(demoCase, calculate(demoCase))).toEqual([]);
  });
});

describe("第6表", () => {
  const [p6] = build06(c, r);
  it("未成年者控除：②＝10万円×(18−年齢)、④＝エンジンの控除しきれない額", () => {
    const t = r.persons.find((p) => p.person.name === p6.values["m0.name"])!;
    const age = Number(p6.values["m0.age"]);
    expect(num(p6.values["m0.full"]) * 10_000).toBe((18 - age) * 100_000);
    expect(t.minorCredit + t.minorExcess).toBe((18 - age) * 100_000);
    expect(num(p6.values["m0.excess"])).toBe(t.minorExcess);
  });
  it("障害者控除：②−③＝④", () => {
    const t = r.persons.find((p) => p.person.name === p6.values["g0.name"])!;
    expect(num(p6.values["g0.full"]) * 10_000).toBe(t.disabilityCredit + t.disabilityExcess);
    expect(num(p6.values["g0.full"]) * 10_000 - num(p6.values["g0.tax"])).toBe(t.disabilityExcess);
  });
});

describe("付表1（小規模宅地等）", () => {
  it("⑦がエンジンの減額と一致し、⑦＝⑥×80%、⑧＝④−⑦", () => {
    const [f] = buildF1(c, r);
    const line = r.assets.find((l) => l.reduction > 0)!;
    expect(num(f.values["b0.reduction"])).toBe(line.reduction);
    expect(num(f.values["b0.reduction"])).toBe(Math.floor((num(f.values["b0.selValue"]) * 8) / 10));
    expect(num(f.values["b0.taxable"])).toBe(num(f.values["b0.value"]) - line.reduction);
    expect(f.values.agree0).toBeTruthy();
  });
});

describe("申告書一式", () => {
  it("使う表だけが様式の順に入り、作れない表の一覧から外れる", () => {
    const order = buildFilingPages(c, r).map((p) => p.page);
    for (const k of ["t06", "t09", "t10", "t11_11_2_f1"] as const) expect(order).toContain(k);
    expect(order.indexOf("t06")).toBeLessThan(order.indexOf("t09"));
    expect(order.indexOf("t10")).toBeLessThan(order.indexOf("t11"));
    expect(order.indexOf("t11_11_2_f1")).toBeLessThan(order.indexOf("t13"));
    const missing = formsNotGenerated(c, r).map((m) => m.form).join();
    expect(missing).not.toMatch(/第6表|第8の8表|第9表|第10表|付表1/);
    expect(order).toContain("t08_8");
  });
});
