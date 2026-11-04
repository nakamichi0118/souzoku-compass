/**
 * 計算結果を申告書（第1表・第2表・第5表・第6表・第7表・第9表・第10表・第11表と付表・
 * 第11・11の2表の付表1と付表1（続）・第13表・第15表）の欄へ割り当てる。
 */
import { toString as fracText } from "@/domain/fraction";
import type { PersonTax, TaxResult } from "@/domain/tax/engine";
import type { Case, Person } from "@/domain/types";
import { ageAt, wareki, yen, yenOrBlank } from "./format";
import type { PageFill } from "./render";
import { build06, build07, build09, build10, buildF1, smallLines } from "./attachments";
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

/**
 * ⑰ 相続時精算課税分の贈与税額控除額。様式に「00」が印字済み（納めた贈与税は100円未満切捨ての額のため）。
 * エンジンの値（100円未満を切り捨てたもの。⑲㉑㉒もこの額から計算している）をそのまま書く。
 * ここで別に切り捨てると⑯－⑰と⑲がずれるため、100円単位でない値は yen が止める
 */
const settlementCreditText = (n: number) => (n > 0 ? yen(n, "00") : "");

/** ⑲ 小計（⑯－⑰－⑱）。黒字は100円未満切捨て、赤字（精算課税の贈与税を引ききれない）は頭に△を付ける */
export const subtotal19 = (t: Pick<PersonTax, "payable" | "refund">) => (t.refund > 0 ? -t.refund : t.payable);

function personAmounts(prefix: string, t: PersonTax, withRatio = true) {
  return {
    [`${prefix}.r01`]: yen(t.acquired),
    [`${prefix}.r02`]: yenOrBlank(t.settlementGifts),
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
    [`${prefix}.r17`]: settlementCreditText(t.settlementCredit),
    [`${prefix}.r19`]: yen(subtotal19(t)),
    [`${prefix}.r21`]: yen(t.payable, "00"),
    // ㉒ 還付される税額：⑲が赤字のとき、その金額（△を付けずに書く）
    [`${prefix}.r22`]: yenOrBlank(t.refund),
  };
}

/**
 * 取得原因（該当する欄に「1」）。相続人は「相続」、相続人でない受遺者・放棄者は「遺贈」。
 * 相続時精算課税で贈与を受けた人は「相続時精算課税に係る贈与」にも「1」を書く
 */
function cause(prefix: string, t: PersonTax): Record<string, string> {
  const out: Record<string, string> = {};
  // 相続・遺贈で受け取ったもの（分け方で受け継ぐ財産・代償金・保険金・退職金）があるか
  const byInheritance = t.inherited + t.compensationOut > 0 || t.insurance > 0 || t.retirement > 0;
  const settlement = t.settlementGifts > 0 || t.settlementCredit > 0;
  if (byInheritance || !settlement) out[t.isCivilHeir ? `${prefix}.causeInherit` : `${prefix}.causeBequest`] = "1";
  if (settlement) out[`${prefix}.causeSettlement`] = "1";
  return out;
}

export function buildFilingPages(c: Case, r: TaxResult): PageFill[] {
  const pages: PageFill[] = [];
  const death = wareki(c.decedent.deathDate)!;
  const db = wareki(c.decedent.birthDate);
  const acquirers = filingPersons(r);
  const [first, ...rest] = acquirers;

  const sumOf = (f: (p: PersonTax) => number) => r.persons.reduce((a, p) => a + f(p), 0);
  const totals = {
    r01: r.persons.reduce((a, p) => a + p.acquired, 0),
    r02: sumOf((p) => p.settlementGifts),
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
    r17: sumOf((p) => p.settlementCredit),
    // 合計欄の⑲は各人の⑲の合計（赤字の人の分は差し引く）。㉑は黒字の人の合計、㉒は赤字の人の合計
    r19: sumOf(subtotal19),
    r21: r.totalPayable,
    r22: r.totalRefund,
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
      "t.r02": yenOrBlank(totals.r02),
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
      "t.r17": totals.r17 > 0 ? yen(totals.r17, "00") : "",
      "t.r19": yen(totals.r19),
      "t.r21": yen(totals.r21, "00"),
      "t.r22": yenOrBlank(totals.r22),
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
  pages.push(...build07(c, r)); // 第7表
  pages.push(...build09(c, r)); // 第9表
  pages.push(...build10(c, r)); // 第10表
  pages.push(...buildSchedule11(c, r)); // 第11表・付表1〜4
  pages.push(...buildF1(c, r)); // 第11・11の2表の付表1・付表1（続）
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
  if (r.persons.some((p) => p.surcharge > 0))
    out.push({ form: "第4表（相続税額の加算金額の計算書）", reason: "相続税が2割増しになる人（孫・兄弟姉妹など）がいるため" });
  if (r.persons.some((p) => p.giftTaxCredit > 0)) out.push({ form: "第4表の2（暦年課税分の贈与税額控除額の計算書）", reason: "贈与税額控除を使うため" });
  if (r.persons.some((p) => p.otherCredits > 0)) {
    const used = [
      r.persons.some((p) => p.minorCredit > 0 || p.transfersIn.some((t) => t.kind === "minor")) && "未成年者控除",
      r.persons.some((p) => p.disabilityCredit > 0 || p.transfersIn.some((t) => t.kind === "disability")) && "障害者控除",
      r.persons.some((p) => p.successiveCredit > 0) && "相次相続控除",
    ].filter(Boolean);
    out.push({ form: "第8の8表（税額控除額及び納付税額の計算書）", reason: `${used.length ? used.join("・") : "未成年者控除・障害者控除"}を使うため` });
  }
  if (r.persons.some((p) => p.settlementGifts > 0 || p.settlementCredit > 0))
    out.push({
      form: "第11の2表（相続時精算課税適用財産の明細書・相続時精算課税分の贈与税額控除額の計算書）",
      reason: "相続時精算課税の贈与があるため",
    });
  // 小規模宅地等の特例を使う土地（マンションの敷地を含む）を2人以上で取得したとき、
  // または貸家建付地・貸している部屋の敷地で賃貸割合が1でないときは、付表1に別表1を添える
  const partlyRented = (l: TaxResult["assets"][number]) => {
    const a = l.asset;
    const rentedLand = a.kind === "land" && (a.use === "rentedHouse" || a.use === "rentedLeasehold");
    const ratio = rentedLand ? a.rentRatio : a.kind === "condo" && a.rented ? a.rentRatio : undefined;
    return ratio !== undefined && ratio < 1;
  };
  // 特例を使う人が1人目でも2人目以降でも同じ（smallLines は line.small と line.smallExtra の両方を見る）
  const shared = r.assets.some((l) => smallLines(l).length > 0 && l.byPerson.filter((b) => b.amount > 0).length > 1);
  if (shared || r.assets.some((l) => smallLines(l).length > 0 && partlyRented(l)))
    out.push({
      form: "第11・11の2表の付表1（別表1）（小規模宅地等についての課税価格の計算明細）",
      reason: shared ? "特例の土地を2人以上で分けたため" : "特例を使う貸している土地に空き部屋があるため",
    });
  if (r.persons.some((p) => p.gifts > 0))
    out.push({ form: "第14表（純資産価額に加算される暦年課税分の贈与財産価額などの明細書）", reason: "3年以内の贈与があるため" });
  if (r.totalRefund > 0)
    out.push({ form: "第1表の付表2（還付される税額の受取場所）", reason: "精算課税の贈与税が戻る人がいるため" });
  if (r.undivided)
    out.push({
      form: "申告期限後3年以内の分割見込書",
      reason: "分け方が決まっていない財産があるため",
    });
  return out;
}
