/**
 * 第5表（配偶者の税額軽減額の計算書）、第13表（債務及び葬式費用の明細書）、
 * 第15表・第15表（続）（相続財産の種類別価額表）への割り当て。
 */
import { frac, mul, toString as fracText } from "@/domain/fraction";
import { floorTo } from "@/domain/rounding";
import type { PersonTax, TaxResult } from "@/domain/tax/engine";
import type { Case, Debt } from "@/domain/types";
import { yen, yenOrBlank } from "./format";
import type { PageFill } from "./render";
import { scheduleTotals } from "./schedule11";

/**
 * 第1表・第15表に記載する人（財産の取得者・債務の負担者・相続時精算課税の贈与を受けた人）。
 * 代償金を払って取得財産の価額が0円になった人も、財産を取得した人として記載する
 */
export const filingPersons = (r: TaxResult) =>
  r.persons.filter(
    (p) => p.acquired > 0 || p.taxable > 0 || p.debts > 0 || p.settlementGifts > 0 || p.settlementCredit > 0 || p.compensationOut > 0 || p.undivided > 0,
  );

// ---------------------------------------------------------------- 第15表

/** 第15表の①〜㊳を計算する（各人） */
export function rows15(perCat: Map<number, number>, t: Pick<PersonTax, "debtOnly" | "funeralOnly" | "gifts"> & Partial<Pick<PersonTax, "settlementGifts">>): number[] {
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
  r[31] = t.settlementGifts ?? 0; // 相続時精算課税適用財産の価額（第11の2表1⑧。第1表②と同じ）
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
  // 第15表は未分割の財産も法定相続分で取得したものとして各人の欄に入れる（第1表①と合う）
  for (const it of items) {
    for (const a of [...it.acquirers, ...it.undivided]) {
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

/**
 * 公租公課（税金・保険料）の名前。名前の前から順に探すので、同じ字で始まる名前（「市県民税」と「市民税」、
 * 「都道府県民税」と「都民税」など）は長いものを先に置く
 */
const PUBLIC_DUES = [
  "復興特別所得税",
  "所得税",
  "都道府県民税",
  "道府県民税",
  "特別区民税",
  "市町村民税",
  "市県民税",
  "市府民税",
  "市道民税",
  "住民税",
  "市民税",
  "区民税",
  "町民税",
  "村民税",
  "都民税",
  "道民税",
  "府民税",
  "県民税",
  "森林環境税",
  "固定資産税",
  "都市計画税",
  "不動産取得税",
  "個人事業税",
  "事業税",
  "地方消費税",
  "消費税",
  "軽自動車税",
  "自動車税",
  "国民健康保険税",
  "国民健康保険料",
  "健康保険料",
  "後期高齢者医療保険料",
  "介護保険料",
  "国民年金保険料",
  "相続税",
  "贈与税",
];
const DUES_RE = new RegExp(PUBLIC_DUES.join("|"), "g");

/**
 * 名前に税金・保険料の名前があっても、それ自体を納めるものではない債務（税込みの代金・費用・家賃、税理士への報酬、
 * 立て替えてもらった分、借入金など）
 */
const NOT_DUES = /税込|税抜|税別|含む|税理士|報酬|手数料|立替|立て替え|代|費|家賃|料金|借入|ローン/;

/** 名前にある税金・保険料の名前（出てくる順、重なりなし）。「固定資産税・都市計画税」なら両方 */
function duesIn(label: string): string {
  return [...new Set(label.replace(/[・･\s]/g, "").match(DUES_RE) ?? [])].join("・");
}

/**
 * 第13表の「種類」と「細目」。
 * 種類を選んでいればそれに従う。選んでいないときは、名前に税金・保険料の名前があるもの（「令和8年度 固定資産税 第3期」
 * 「準確定申告の所得税」「未納の住民税」など）を公租公課とする。ただし税込みの代金や税理士への報酬のように、
 * その税金・保険料そのものではないものは「その他」にする（名前に「税」の字が入っているだけでは公租公課にしない）。
 */
export function debtKind(d: Pick<Debt, "label" | "debtType">): { kind: string; detail: string } {
  const label = d.label.trim();
  const dues = duesIn(label);
  if (d.debtType === "公租公課") return { kind: "公租公課", detail: dues || label };
  if (d.debtType) return { kind: d.debtType, detail: label };
  if (dues && !NOT_DUES.test(label)) return { kind: "公租公課", detail: dues };
  return { kind: "その他", detail: label };
}

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
            ? { ...debtKind(d), creditor: d.creditor, address: d.creditorAddress, amount: yen(d.amount) }
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
        // ① 分割財産の価額（第11表2の配偶者の①。相続時精算課税の贈与財産を含む）、② 債務及び葬式費用、
        // ③ 未分割財産の価額（第11表2の配偶者の②）、④ ②−③（③が大きいときは0）、⑤ 暦年課税分の贈与財産価額
        g06: yen(s.divided),
        g07: yenOrBlank(s.debts),
        g08: yenOrBlank(s.undivided),
        g09: s.debts > 0 ? yen(s.debtsOverUndivided) : "",
        g10: yenOrBlank(s.gifts),
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
