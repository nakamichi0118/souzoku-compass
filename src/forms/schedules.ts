/**
 * 第5表（配偶者の税額軽減額の計算書）、第13表（債務及び葬式費用の明細書）、
 * 第15表・第15表（続）（相続財産の種類別価額表）への割り当て。
 */
import { frac, mul, toString as fracText } from "@/domain/fraction";
import { floorTo } from "@/domain/rounding";
import type { PersonTax, TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { yen, yenOrBlank } from "./format";
import type { PageFill } from "./render";
import { scheduleTotals } from "./schedule11";

/** 第1表・第15表に記載する人（財産の取得者・債務の負担者） */
export const filingPersons = (r: TaxResult) => r.persons.filter((p) => p.acquired > 0 || p.taxable > 0 || p.debts > 0);

// ---------------------------------------------------------------- 第15表

/** 第15表の①〜㊳を計算する（各人） */
export function rows15(perCat: Map<number, number>, t: Pick<PersonTax, "debtOnly" | "funeralOnly" | "gifts">): number[] {
  const v = (n: number) => perCat.get(n) ?? 0;
  const r: number[] = new Array(39).fill(0);
  for (let i = 1; i <= 5; i++) r[i] = v(i);
  r[6] = r[1] + r[2] + r[3] + r[4] + r[5];
  r[10] = v(10);
  for (const i of [12, 13, 14, 15]) r[i] = v(i);
  r[16] = r[12] + r[13] + r[14] + r[15];
  for (const i of [17, 18, 19, 20, 21]) r[i] = v(i);
  r[22] = r[17] + r[18] + r[19] + r[20] + r[21];
  r[23] = v(23);
  r[24] = v(24);
  for (const i of [25, 26, 27, 28]) r[i] = v(i);
  r[29] = r[25] + r[26] + r[27] + r[28];
  r[30] = r[6] + r[10] + r[16] + r[22] + r[23] + r[24] + r[29];
  r[31] = 0; // 相続時精算課税適用財産（対象外）
  r[32] = r[6] + r[10] + r[12] + r[17] + r[18] + r[27];
  r[33] = t.debtOnly;
  r[34] = t.funeralOnly;
  r[35] = r[33] + r[34];
  r[36] = Math.max(0, r[30] + r[31] - r[35]);
  r[37] = t.gifts;
  r[38] = floorTo(r[36] + r[37], 1000);
  return r;
}

function column(prefix: string, r: number[]): PageFill["values"] {
  const out: PageFill["values"] = {};
  for (let i = 1; i <= 38; i++) {
    const key = `${prefix}.r${String(i).padStart(2, "0")}`;
    out[key] = i === 38 ? yen(r[38], "000") : yenOrBlank(r[i]);
  }
  return out;
}

export function build15(c: Case, r: TaxResult): PageFill[] {
  const { items } = scheduleTotals(c, r);
  const persons = filingPersons(r);
  const perPerson = new Map<string, Map<number, number>>();
  for (const it of items) {
    for (const a of it.acquirers) {
      const m = perPerson.get(a.personId) ?? new Map<number, number>();
      m.set(it.cat, (m.get(it.cat) ?? 0) + a.amount);
      perPerson.set(a.personId, m);
    }
  }
  const cols = persons.map((p) => ({ p, rows: rows15(perPerson.get(p.person.id) ?? new Map(), p) }));
  const total = new Array(39).fill(0).map((_, i) => cols.reduce((a, c) => a + c.rows[i], 0));
  const pages: PageFill[] = [];
  const [first, ...rest] = cols;
  pages.push({
    page: "t15",
    values: {
      "d.name": c.decedent.name,
      ...column("t", total),
      ...(first ? { "p.name": first.p.person.name, ...column("p", first.rows) } : {}),
    },
  });
  for (let i = 0; i < rest.length; i += 2) {
    const values: PageFill["values"] = { "d.name": c.decedent.name };
    rest.slice(i, i + 2).forEach((col, j) => {
      const k = j === 0 ? "a" : "b";
      values[`${k}.name`] = col.p.person.name;
      Object.assign(values, column(k, col.rows));
    });
    pages.push({ page: "t15c", values });
  }
  return pages;
}

// ---------------------------------------------------------------- 第13表

export function build13(c: Case, r: TaxResult): PageFill[] {
  const name = new Map(c.persons.map((p) => [p.id, p.name]));
  type Row = Record<string, string | number | undefined>;
  const debtRows: Row[] = [];
  const funeralRows: Row[] = [];
  for (const d of c.debts) {
    const bearers = d.bearers.length ? d.bearers : [{ personId: "", amount: 0 }];
    bearers.forEach((b, i) => {
      const head: Row =
        i > 0
          ? {}
          : d.kind === "debt"
            ? { kind: /税/.test(d.label) ? "公租公課" : "その他", detail: d.label.match(/[^\s（(]*税/)?.[0] ?? d.label, creditor: d.creditor, address: d.creditorAddress, amount: yen(d.amount) }
            : { payee: d.creditor ?? d.label, address: d.creditorAddress, amount: yen(d.amount) };
      (d.kind === "debt" ? debtRows : funeralRows).push({ ...head, bearer: name.get(b.personId), bearerAmount: b.amount ? yen(b.amount) : "" });
    });
  }
  const bearers = r.persons.filter((p) => p.debtOnly > 0 || p.funeralOnly > 0);
  const sum = (f: (p: PersonTax) => number) => r.persons.reduce((a, p) => a + f(p), 0);
  const sec3 = (k: string, debt: number, funeral: number): Row => ({
    [`${k}.r1`]: yenOrBlank(debt),
    [`${k}.r3`]: yenOrBlank(debt),
    [`${k}.r4`]: yenOrBlank(funeral),
    [`${k}.r6`]: yenOrBlank(funeral),
    [`${k}.r7`]: yenOrBlank(debt + funeral),
  });

  const pageCount = Math.max(1, Math.ceil(debtRows.length / 4), Math.ceil(funeralRows.length / 5), Math.ceil(bearers.length / 4));
  const pages: PageFill[] = [];
  for (let pg = 0; pg < pageCount; pg++) {
    const values: PageFill["values"] = { "d.name": c.decedent.name };
    debtRows.slice(pg * 4, pg * 4 + 4).forEach((row, i) => {
      for (const [k, v] of Object.entries(row)) values[`d${i}.${k}`] = v;
    });
    funeralRows.slice(pg * 5, pg * 5 + 5).forEach((row, i) => {
      for (const [k, v] of Object.entries(row)) values[`f${i}.${k}`] = v;
    });
    if (pg === 0) {
      const debtTotal = c.debts.filter((d) => d.kind === "debt").reduce((a, d) => a + d.amount, 0);
      const funeralTotal = c.debts.filter((d) => d.kind === "funeral").reduce((a, d) => a + d.amount, 0);
      values["d.total"] = yenOrBlank(debtTotal);
      values["f.total"] = yenOrBlank(funeralTotal);
      Object.assign(values, sec3("t", sum((p) => p.debtOnly), sum((p) => p.funeralOnly)));
    }
    bearers.slice(pg * 4, pg * 4 + 4).forEach((p, i) => {
      values[`p${i}.name`] = p.person.name;
      Object.assign(values, sec3(`p${i}`, p.debtOnly, p.funeralOnly));
    });
    pages.push({ page: "t13", values });
  }
  return pages;
}

// ---------------------------------------------------------------- 第5表

export function build5(c: Case, r: TaxResult): PageFill[] {
  const s = r.spouse;
  const sp = r.persons.find((p) => p.person.relation === "spouse");
  if (!s || !sp || s.credit <= 0) return [];
  const share = r.heirsTax.byPerson.get(sp.person.id);
  if (!share) return [];
  const [n, d] = fracText(share).split("/");
  const raw = mul(frac(r.totalTaxable), share);
  return [
    {
      page: "t05",
      values: {
        "d.name": c.decedent.name,
        g01: yen(r.totalTaxable, ",000"),
        g02: n,
        g03: d ?? "1",
        g04: yen(Number(raw.n / raw.d)),
        g05: yen(s.legalShareAmount),
        g06: yen(sp.acquired),
        g07: yenOrBlank(sp.debts),
        g09: yenOrBlank(sp.debts),
        g10: yenOrBlank(sp.gifts),
        g11: yen(s.spouseTaxable, ",000"),
        g12: yen(r.totalTax, "00"),
        g13: yen(s.base),
        g14: yen(r.totalTaxable, ",000"),
        g15: yen(s.creditBase),
        g16: yen(sp.computed + sp.surcharge),
        g17: yenOrBlank(sp.giftTaxCredit),
        g18: yen(s.limit),
        g19: yen(s.credit),
      },
    },
  ];
}
