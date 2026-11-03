/**
 * 計算結果を申告書（第1表・第2表・第5表・第6表・第9表・第10表・第11表と付表・
 * 第11・11の2表の付表1・第13表・第15表）の欄へ割り当てる。
 */
import { toString as fracText } from "@/domain/fraction";
import type { PersonTax, TaxResult } from "@/domain/tax/engine";
import type { Case, Person } from "@/domain/types";
import { ageAt, wareki, yen, yenOrBlank } from "./format";
import type { PageFill } from "./render";
import { build06, build09, build10, buildF1 } from "./attachments";
import { buildSchedule11 } from "./schedule11";
import { build13, build15, build5, filingPersons } from "./schedules";

const RELATION_LABEL: Record<Person["relation"], string> = {
  spouse: "配偶者",
  child: "子",
  adoptedChild: "養子",
  grandchild: "孫",
  greatGrandchild: "ひ孫",
  parent: "父母",
  grandparent: "祖父母",
  sibling: "兄弟姉妹",
  nephewNiece: "甥姪",
  other: "その他",
};
export const relationLabel = (p: Person) => p.relationLabel ?? RELATION_LABEL[p.relation];

function personHeader(prefix: string, p: Person, deathDate: string) {
  const w = wareki(p.birthDate);
  const [zip1, zip2] = (p.zip ?? "").split("-");
  const phone = (p.phone ?? "").split("-");
  return {
    [`${prefix}.kana`]: p.kana,
    [`${prefix}.name`]: p.name,
    [`${prefix}.bEra`]: w?.code,
    [`${prefix}.bY`]: w?.year,
    [`${prefix}.bM`]: w?.month,
    [`${prefix}.bD`]: w?.day,
    [`${prefix}.age`]: ageAt(p.birthDate, deathDate),
    [`${prefix}.zip.0`]: zip1,
    [`${prefix}.zip.1`]: zip2,
    [`${prefix}.address`]: p.address,
    [`${prefix}.phone.0`]: phone[0],
    [`${prefix}.phone.1`]: phone[1],
    [`${prefix}.phone.2`]: phone[2],
    [`${prefix}.relation`]: relationLabel(p),
    [`${prefix}.occupation`]: p.occupation,
    // 取得原因：相続人は「相続」、相続人でない受遺者・放棄者は「遺贈」
    [`${prefix}.causeInherit`]: undefined as string | undefined,
    [`${prefix}.causeBequest`]: undefined as string | undefined,
  };
}

function personAmounts(prefix: string, t: PersonTax, withRatio = true) {
  return {
    [`${prefix}.r01`]: yen(t.acquired),
    [`${prefix}.r03`]: yenOrBlank(t.debts),
    [`${prefix}.r04`]: yen(t.net),
    [`${prefix}.r05`]: yenOrBlank(t.gifts),
    [`${prefix}.r06`]: yen(t.taxable, "000"),
    [`${prefix}.r08`]: withRatio ? t.ratioText : undefined,
    [`${prefix}.r09`]: yen(t.computed),
    [`${prefix}.r11`]: yenOrBlank(t.surcharge),
    [`${prefix}.r12`]: yenOrBlank(t.giftTaxCredit),
    [`${prefix}.r13`]: yenOrBlank(t.spouseCredit),
    [`${prefix}.r14`]: yenOrBlank(t.otherCredits),
    [`${prefix}.r15`]: yenOrBlank(t.totalCredits),
    [`${prefix}.r16`]: yen(t.afterCredits),
    [`${prefix}.r19`]: yen(t.payable),
    [`${prefix}.r21`]: yen(t.payable, "00"),
  };
}

function cause(prefix: string, t: PersonTax): Record<string, string> {
  return t.isCivilHeir ? { [`${prefix}.causeInherit`]: "1" } : { [`${prefix}.causeBequest`]: "1" };
}

export function buildFilingPages(c: Case, r: TaxResult): PageFill[] {
  const pages: PageFill[] = [];
  const death = wareki(c.decedent.deathDate)!;
  const db = wareki(c.decedent.birthDate);
  const acquirers = filingPersons(r);
  const [first, ...rest] = acquirers;

  const totals = {
    r01: r.persons.reduce((a, p) => a + p.acquired, 0),
    r03: r.totalDebts,
    r04: r.persons.reduce((a, p) => a + p.net, 0),
    r05: r.persons.reduce((a, p) => a + p.gifts, 0),
    r09: r.persons.reduce((a, p) => a + p.computed, 0),
    r11: r.persons.reduce((a, p) => a + p.surcharge, 0),
    r12: r.persons.reduce((a, p) => a + p.giftTaxCredit, 0),
    r13: r.persons.reduce((a, p) => a + p.spouseCredit, 0),
    r14: r.persons.reduce((a, p) => a + p.otherCredits, 0),
    r15: r.persons.reduce((a, p) => a + p.totalCredits, 0),
    r16: r.persons.reduce((a, p) => a + p.afterCredits, 0),
    r19: r.totalPayable,
  };

  pages.push({
    page: "t01",
    values: {
      taxOffice: c.filing?.taxOffice,
      deathEra: death.code,
      deathY: death.year,
      deathM: death.month,
      deathD: death.day,
      "d.kana": c.decedent.kana,
      "d.name": c.decedent.name,
      "d.bEra": db?.code,
      "d.bY": db?.year,
      "d.bM": db?.month,
      "d.bD": db?.day,
      "d.age": ageAt(c.decedent.birthDate, c.decedent.deathDate),
      "d.address": c.decedent.address,
      "d.occupation": c.decedent.occupation,
      "t.r01": yen(totals.r01),
      "t.r03": yenOrBlank(totals.r03),
      "t.r04": yen(totals.r04),
      "t.r05": yenOrBlank(totals.r05),
      "t.r06": yen(r.totalTaxable, "000"),
      "t.heirCount": r.legalHeirCount,
      "t.basicDeduction": yen(r.basicDeduction, "000,000"),
      "t.r07": yen(r.totalTax, "00"),
      "t.r09": yen(totals.r09),
      "t.r11": yenOrBlank(totals.r11),
      "t.r12": yenOrBlank(totals.r12),
      "t.r13": yenOrBlank(totals.r13),
      "t.r14": yenOrBlank(totals.r14),
      "t.r15": yenOrBlank(totals.r15),
      "t.r16": yen(totals.r16),
      "t.r19": yen(totals.r19),
      "t.r21": yen(totals.r19, "00"),
      ...(first
        ? {
            ...personHeader("p", first.person, c.decedent.deathDate),
            ...cause("p", first),
            ...personAmounts("p", first),
          }
        : {}),
    },
  });

  for (let i = 0; i < rest.length; i += 2) {
    const pair = rest.slice(i, i + 2);
    const values: PageFill["values"] = {};
    pair.forEach((t, j) => {
      const prefix = j === 0 ? "a" : "b";
      Object.assign(values, personHeader(prefix, t.person, c.decedent.deathDate), cause(prefix, t), personAmounts(prefix, t));
    });
    pages.push({ page: "t01c", values });
  }

  // 第2表（法定相続人6人ごとに1枚）
  const slots = r.slots;
  const personById = new Map(c.persons.map((p) => [p.id, p]));
  for (let i = 0; i < Math.max(1, slots.length); i += 6) {
    const values: PageFill["values"] = {
      "d.name": c.decedent.name,
      i: yen(r.totalTaxable, ",000"),
      ro: r.legalHeirCount,
      ha: (r.basicDeduction / 10_000).toLocaleString("ja-JP"),
      ni: r.taxableEstate > 0 ? yen(r.taxableEstate, ",000") : "",
      count: r.legalHeirCount,
      total: yen(r.totalTax, "00"),
    };
    slots.slice(i, i + 6).forEach((s, j) => {
      const p = s.personIds.length === 1 ? personById.get(s.personIds[0]) : undefined;
      const [n, d] = fracText(s.share).split("/");
      values[`h${j}.name`] = p ? p.name : s.label;
      values[`h${j}.relation`] = p ? relationLabel(p) : "養子";
      values[`h${j}.shareN`] = n;
      values[`h${j}.shareD`] = d ?? "1";
      values[`h${j}.amount`] = s.amount > 0 ? yen(s.amount, ",000") : "";
      values[`h${j}.tax`] = s.tax > 0 ? yen(s.tax) : "";
    });
    pages.push({ page: "t02", values });
  }

  pages.push(...build5(c, r)); // 第5表
  pages.push(...build06(c, r)); // 第6表
  pages.push(...build09(c, r)); // 第9表
  pages.push(...build10(c, r)); // 第10表
  pages.push(...buildSchedule11(c, r)); // 第11表・付表1〜4
  pages.push(...buildF1(c, r)); // 第11・11の2表の付表1
  pages.push(...build13(c, r)); // 第13表
  pages.push(...build15(c, r)); // 第15表・第15表（続）
  return pages;
}

/**
 * 計算で使ったのに、相続コンパスがまだ自動で作らない帳票。
 * 申告書一式が完成したと誤解されないよう、ダウンロードの前に一覧で示す。
 */
export function formsNotGenerated(c: Case, r: TaxResult): { form: string; reason: string }[] {
  const out: { form: string; reason: string }[] = [];
  if (r.persons.some((p) => p.otherCredits > 0))
    out.push({ form: "第8の8表（税額控除額及び納付税額の計算書）", reason: "未成年者控除・障害者控除を使っています" });
  if (r.persons.some((p) => p.giftTaxCredit > 0)) out.push({ form: "第4表の2（暦年課税分の贈与税額控除額の計算書）", reason: "贈与税額控除を使っています" });
  return out;
}
