/**
 * 相続税の決定論的な計算エンジン（令和8年中に開始した相続）。
 * Claude はこのエンジンの結果を説明するだけで、税額の計算には関与しない。
 *
 * 主な根拠:
 * 相続税法 11条の2（課税価格）、12条（非課税財産：生命保険金等 500万円×法定相続人の数）、
 * 13条（債務控除）、15条（基礎控除 3,000万円＋600万円×法定相続人の数）、16条（相続税の総額）、
 * 17条（各人の相続税額＝総額×按分割合）、18条（2割加算）、19条（暦年課税分の贈与税額控除）、
 * 19条の2（配偶者の税額軽減）、19条の3（未成年者控除）、19条の4（障害者控除）、
 * 国税通則法118条（課税標準の1,000円未満切捨て）、119条（確定金額の100円未満切捨て）、
 * 相続税法基本通達17-1（按分割合の端数調整）。
 */
import { Fraction, frac, mulYen, toNumber } from "../fraction";
import { HeirResult, civilHeirIds, determineHeirs, isSurchargeTarget } from "../heirs";
import { floor100, floor1000 } from "../rounding";
import type { Asset, Case, LandAsset, Person } from "../types";
import { Valuation, smallResidentialSelection, valueAsset } from "../valuation";

/** 速算表（相続税法16条） */
export const RATE_TABLE: readonly { upTo: number; rate: number; deduction: number }[] = [
  { upTo: 10_000_000, rate: 10, deduction: 0 },
  { upTo: 30_000_000, rate: 15, deduction: 500_000 },
  { upTo: 50_000_000, rate: 20, deduction: 2_000_000 },
  { upTo: 100_000_000, rate: 30, deduction: 7_000_000 },
  { upTo: 200_000_000, rate: 40, deduction: 17_000_000 },
  { upTo: 300_000_000, rate: 45, deduction: 27_000_000 },
  { upTo: 600_000_000, rate: 50, deduction: 42_000_000 },
  { upTo: Infinity, rate: 55, deduction: 72_000_000 },
];

export function rateFor(amount: number) {
  return RATE_TABLE.find((r) => amount <= r.upTo)!;
}

/** 法定相続分に応ずる取得金額に対する税額（1円未満切捨て） */
export function progressiveTax(amount: number): number {
  if (amount <= 0) return 0;
  const r = rateFor(amount);
  return Math.floor((amount * r.rate) / 100) - r.deduction;
}

export const BASIC_DEDUCTION_BASE = 30_000_000;
export const BASIC_DEDUCTION_PER_HEIR = 6_000_000;
export const INSURANCE_EXEMPT_PER_HEIR = 5_000_000;
export const SPOUSE_FLOOR = 160_000_000;

export interface AssetLine {
  asset: Asset;
  valuation: Valuation;
  /** 小規模宅地等の特例による減額 */
  reduction: number;
  /** 取得者ごとの取得価額（減額後） */
  byPerson: { personId: string; amount: number }[];
  /** 小規模宅地等の特例の明細（第11・11の2表の付表1） */
  small?: SmallResidentialDetail;
}

export interface SmallResidentialDetail {
  acquirerId: string;
  /** ③ 取得者の持分に応ずる宅地等の面積（㎡） */
  area: number;
  /** ④ 取得者の持分に応ずる宅地等の価額 */
  value: number;
  /** ⑤ 選択した面積（㎡） */
  selectedArea: number;
  /** ⑥ ④×⑤/③ */
  selectedValue: number;
}

export interface PersonTax {
  person: Person;
  isLegalHeir: boolean; // 相続税法上の法定相続人（放棄者を含む）
  isCivilHeir: boolean; // 民法上の相続人（放棄者を除く）
  /** 遺産分割で取得した財産（減額後） */
  inherited: number;
  /** みなし相続財産（保険金・退職金）の受取額と非課税額 */
  insurance: number;
  insuranceExempt: number;
  retirement: number;
  retirementExempt: number;
  /** ① 取得財産の価額 */
  acquired: number;
  /** ③ 債務及び葬式費用 */
  debts: number;
  debtOnly: number;
  funeralOnly: number;
  /** ④ 純資産価額（赤字は0） */
  net: number;
  /** ⑤ 暦年課税分の贈与財産価額 */
  gifts: number;
  /** ⑥ 課税価格（1,000円未満切捨て） */
  taxable: number;
  /** ⑧ 按分割合 */
  ratio: number;
  ratioText: string;
  /** ⑨ 算出税額 */
  computed: number;
  /** ⑪ 2割加算 */
  surcharge: number;
  /** ⑫ 暦年課税分の贈与税額控除 */
  giftTaxCredit: number;
  /** ⑬ 配偶者の税額軽減 */
  spouseCredit: number;
  /** 未成年者控除・障害者控除（第6表） */
  minorCredit: number;
  disabilityCredit: number;
  /** 控除しきれなかった未成年者・障害者控除（扶養義務者から控除可能） */
  minorExcess: number;
  disabilityExcess: number;
  /** ⑭ ⑫⑬以外の税額控除 */
  otherCredits: number;
  /** ⑮ 計 */
  totalCredits: number;
  /** ⑯ 差引税額 */
  afterCredits: number;
  /** ⑲ 小計（100円未満切捨て） = ㉑ 納付すべき税額 */
  payable: number;
}

export interface SpouseDetail {
  totalTaxable: number; // ① 課税価格の合計額
  legalShareAmount: number; // ② 法定相続分相当額（1億6千万円に満たないときは1億6千万円）
  spouseTaxable: number; // ⑧ 配偶者の課税価格
  base: number; // ⑨ ②と⑧のいずれか少ない方
  creditBase: number; // ⑩ 総額×⑨/①
  limit: number; // ⑪ 限度額
  credit: number; // 配偶者の税額軽減額
}

export interface TaxResult {
  heirsTax: HeirResult;
  heirsCivil: HeirResult;
  legalHeirCount: number;
  basicDeduction: number;
  assets: AssetLine[];
  persons: PersonTax[];
  totalAcquired: number;
  totalDebts: number;
  totalTaxable: number; // Ａ 課税価格の合計額
  taxableEstate: number; // 課税遺産総額
  /** 第2表：法定相続分に応ずる取得金額と税額 */
  slots: { label: string; personIds: string[]; share: Fraction; amount: number; tax: number }[];
  totalTax: number; // 相続税の総額（100円未満切捨て）
  spouse?: SpouseDetail;
  totalPayable: number;
  insuranceExemptLimit: number;
  retirementExemptLimit: number;
  /** 自動完結できない事項（税理士相談が必要） */
  blockers: string[];
  warnings: string[];
  needsFiling: boolean;
}

function ageAt(birth: string, at: string): number {
  const b = new Date(birth + "T00:00:00Z");
  const d = new Date(at + "T00:00:00Z");
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const md = d.getUTCMonth() - b.getUTCMonth();
  if (md < 0 || (md === 0 && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** 金額を割合（分子/分母）で配分。端数は先頭の取得者に寄せて合計を一致させる */
function splitAmount(amount: number, shares: { personId: string; numerator: number; denominator: number }[]) {
  const parts = shares.map((s) => ({
    personId: s.personId,
    amount: mulYen(amount, frac(s.numerator, s.denominator)),
  }));
  const totalShare = shares.reduce((acc, s) => acc + s.numerator / s.denominator, 0);
  if (parts.length > 0 && Math.abs(totalShare - 1) < 1e-9) {
    const diff = amount - parts.reduce((a, p) => a + p.amount, 0);
    parts[0].amount += diff;
  }
  return parts;
}

/** 非課税限度額を受取額の比で各相続人に按分（相続税法12条1項5号・6号） */
function allocateExempt(limit: number, receipts: Map<string, number>, eligible: Set<string>) {
  const out = new Map<string, number>();
  let total = 0;
  for (const [id, v] of receipts) if (eligible.has(id)) total += v;
  for (const [id, v] of receipts) {
    if (!eligible.has(id) || total === 0) {
      out.set(id, 0);
      continue;
    }
    out.set(id, total <= limit ? v : Number((BigInt(limit) * BigInt(v)) / BigInt(total)));
  }
  return out;
}

/** 按分割合を小数点以下 digits 桁にそろえ、合計が1になるよう端数を調整（相基通17-1） */
export function apportionRatios(taxables: number[], digits = 2): number[] {
  return apportionScaled(taxables, digits).map((v) => v / 10 ** digits);
}

/** 按分割合を 10^digits 倍した整数で返す（最大剰余法で合計を 10^digits にそろえる） */
export function apportionScaled(taxables: number[], digits: number): number[] {
  const total = taxables.reduce((a, b) => a + BigInt(b), 0n);
  if (total === 0n) return taxables.map(() => 0);
  const scale = 10n ** BigInt(digits);
  const floored = taxables.map((t) => (BigInt(t) * scale) / total);
  const rems = taxables.map((t, i) => ({ i, rem: BigInt(t) * scale - floored[i] * total }));
  let rest = scale - floored.reduce((a, b) => a + b, 0n);
  rems
    .filter((x) => taxables[x.i] > 0)
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i))
    .forEach((o) => {
      if (rest > 0n) {
        floored[o.i] += 1n;
        rest -= 1n;
      }
    });
  return floored.map(Number);
}

const trimRatio = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, ".00") : s);

export interface EngineOptions {
  /**
   * 按分割合の小数点以下の桁数（既定10桁）。相基通17-1により端数調整は取得者の選択。
   * 2桁にすると配偶者の算出税額と税額軽減額が一致せず少額の納税が生じることがあるため、既定は10桁とする。
   */
  ratioDigits?: number;
}

export function calculate(c: Case, opts: EngineOptions = {}): TaxResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const deathYear = Number(c.decedent.deathDate.slice(0, 4));
  if (deathYear !== 2026) {
    blockers.push("相続コンパスは令和8年（2026年）中に開始した相続を対象としています。");
  }

  const heirsTax = determineHeirs(c.persons, "tax");
  const heirsCivil = determineHeirs(c.persons, "civil");
  warnings.push(...heirsTax.notes);
  const civil = civilHeirIds(c.persons);
  const legalSet = new Set(heirsTax.slots.flatMap((s) => s.personIds));
  const legalHeirCount = heirsTax.count;
  const basicDeduction = BASIC_DEDUCTION_BASE + BASIC_DEDUCTION_PER_HEIR * legalHeirCount;

  for (const p of c.persons) {
    if (p.nonResident && !p.predeceased) {
      blockers.push(`${p.name}さんは国外に住所があります。非居住者がいる相続は税理士にご相談ください。`);
    }
    if (p.predeceased && p.deathDate && c.decedent.deathDate && p.deathDate > c.decedent.deathDate) {
      blockers.push(`${p.name || "相続人"}さんは亡くなった方より後に亡くなっています（数次相続）。自動では計算できないため、税理士にご相談ください。`);
    }
  }

  // 財産の評価と取得者への配分
  const allocMap = new Map(c.allocations.map((a) => [a.assetId, a]));
  const insuranceBy = new Map<string, number>();
  const retirementBy = new Map<string, number>();
  const assetLines: AssetLine[] = [];
  const living = new Set(c.persons.filter((p) => !p.predeceased).map((p) => p.id));
  // 特定居住用宅地等の限度面積330㎡は、選んだ宅地全体で使う（措置法69条の4第2項）
  let srLeftSqm = 330;
  for (const a of c.assets) {
    if (a.foreign) blockers.push(`「${a.label}」は国外財産です。国外財産がある相続は税理士にご相談ください。`);
    const valuation = valueAsset(a);
    if (valuation.needsConsultation) blockers.push(`「${a.label}」：${valuation.needsConsultation}`);
    if (a.kind === "insurance" || a.kind === "retirement") {
      if (!living.has(a.recipientId)) {
        // 受取人がいないと金額がどこにも集計されず課税価格から消えるため、確定させない
        blockers.push(`「${a.label || (a.kind === "insurance" ? "死亡保険金" : "死亡退職金")}」の受取人が選ばれていません。財産の画面で受取人を選んでください。`);
      }
      const m = a.kind === "insurance" ? insuranceBy : retirementBy;
      m.set(a.recipientId, (m.get(a.recipientId) ?? 0) + valuation.value);
      assetLines.push({ asset: a, valuation, reduction: 0, byPerson: [{ personId: a.recipientId, amount: valuation.value }] });
      continue;
    }
    const alloc = allocMap.get(a.id);
    if (!alloc || alloc.shares.length === 0) {
      // 未分割の財産を0円として計算すると課税価格が過少になる。未分割申告（法定相続分で取得したものとして計算）は対象外のため止める
      blockers.push(`「${a.label}」を受け継ぐ人が決まっていません（未分割）。遺産の分け方で取得者を決めてください。未分割のまま申告する場合は税理士にご相談ください。`);
      assetLines.push({ asset: a, valuation, reduction: 0, byPerson: [] });
      continue;
    }
    const shareSum = alloc.shares.reduce((acc, s) => acc + s.numerator / Math.max(1, s.denominator), 0);
    if (Math.abs(shareSum - 1) > 1e-9 || alloc.shares.some((s) => s.numerator <= 0 || s.denominator <= 0 || !living.has(s.personId))) {
      blockers.push(`「${a.label}」の取得割合の合計が1になっていません（いま ${Math.round(shareSum * 10000) / 100}%）。遺産の分け方を確認してください。`);
    }
    const byPerson = splitAmount(valuation.value, alloc.shares);
    let reduction = 0;
    let small: SmallResidentialDetail | undefined;
    const sr = (a.kind === "land" || a.kind === "condo") ? a.smallResidential : undefined;
    if (sr?.applies && sr.acquirerId) {
      const part = byPerson.find((b) => b.personId === sr.acquirerId);
      const share = alloc.shares.find((s) => s.personId === sr.acquirerId);
      if (part && share) {
        let landPart = part.amount;
        let fullArea: number;
        if (a.kind === "condo") {
          // マンションは敷地利用権部分だけが特例の対象
          const landOnly = valueAsset({ ...a, buildingFixedAssetValue: 0 }).value;
          landPart = Math.floor((part.amount * landOnly) / Math.max(1, valuation.value));
          fullArea = a.smallResidential?.landShareSqm ?? a.landShareSqm;
        } else {
          fullArea = (a as LandAsset).areaSqm;
        }
        const area = (fullArea * share.numerator) / share.denominator;
        if (srLeftSqm <= 0) {
          warnings.push(`小規模宅地等の特例は合計330㎡までです。上限に達したため「${a.label}」には適用していません。`);
        } else {
          if (area > srLeftSqm) warnings.push(`小規模宅地等の特例は合計330㎡までのため、「${a.label}」は残り${Math.round(srLeftSqm * 100) / 100}㎡分だけ適用しています。`);
          const sel = smallResidentialSelection(landPart, area, srLeftSqm);
          reduction = sel.reduction;
          small = { acquirerId: sr.acquirerId, area, value: landPart, selectedArea: sel.selectedArea, selectedValue: sel.selectedValue };
          srLeftSqm -= Math.min(area, srLeftSqm);
        }
        part.amount -= reduction;
      } else {
        warnings.push(`「${a.label}」の小規模宅地等の特例の取得者が、この土地を取得していません。`);
      }
    }
    assetLines.push({ asset: a, valuation, reduction, byPerson, small });
  }

  // 債務・葬式費用は、負担する人ごとの金額の合計が債務の額と一致するまで確定しない
  for (const d of c.debts) {
    const borne = d.bearers.reduce((acc, b) => acc + b.amount, 0);
    if (borne !== d.amount) {
      blockers.push(`「${d.label || (d.kind === "debt" ? "債務" : "葬式費用")}」の負担する人ごとの金額の合計（${borne.toLocaleString()}円）が、金額（${d.amount.toLocaleString()}円）と一致していません。`);
    }
    if (d.bearers.some((b) => b.amount > 0 && !living.has(b.personId))) {
      blockers.push(`「${d.label || "債務"}」を負担する人が、相続人の一覧にいません。`);
    }
  }

  const insuranceExemptLimit = INSURANCE_EXEMPT_PER_HEIR * legalHeirCount;
  const retirementExemptLimit = INSURANCE_EXEMPT_PER_HEIR * legalHeirCount;
  const insEx = allocateExempt(insuranceExemptLimit, insuranceBy, civil);
  const retEx = allocateExempt(retirementExemptLimit, retirementBy, civil);

  // 相続開始前3年以内の贈与（令和8年中の相続開始は加算期間3年）
  const death = new Date(c.decedent.deathDate + "T00:00:00Z");
  const from = new Date(Date.UTC(death.getUTCFullYear() - 3, death.getUTCMonth(), death.getUTCDate()));

  const persons: PersonTax[] = c.persons
    .filter((p) => !p.predeceased)
    .map((p) => {
      const inherited = assetLines
        .filter((l) => l.asset.kind !== "insurance" && l.asset.kind !== "retirement")
        .reduce((acc, l) => acc + (l.byPerson.find((b) => b.personId === p.id)?.amount ?? 0), 0);
      const insurance = insuranceBy.get(p.id) ?? 0;
      const retirement = retirementBy.get(p.id) ?? 0;
      const insuranceExempt = insEx.get(p.id) ?? 0;
      const retirementExempt = retEx.get(p.id) ?? 0;
      const acquired = inherited + insurance - insuranceExempt + retirement - retirementExempt;
      let debtOnly = 0;
      let funeralOnly = 0;
      for (const d of c.debts) {
        for (const b of d.bearers) {
          if (b.personId !== p.id) continue;
          if (d.kind === "debt") debtOnly += b.amount;
          else funeralOnly += b.amount;
        }
      }
      if (!civil.has(p.id) && debtOnly > 0) {
        warnings.push(`${p.name}さんは相続人ではないため、債務は控除できません（葬式費用は実際に負担した分を控除できます）。`);
        debtOnly = 0;
      }
      const debts = debtOnly + funeralOnly;
      const net = Math.max(0, acquired - debts);
      const acquiresSomething = acquired > 0 || inherited > 0 || insurance > 0 || retirement > 0;
      const gifts = acquiresSomething
        ? c.priorGifts
            .filter((g) => g.personId === p.id)
            .filter((g) => {
              const d = new Date(g.date + "T00:00:00Z");
              return d >= from && d <= death;
            })
            .reduce((a, g) => a + g.amount, 0)
        : 0;
      const taxable = floor1000(net + gifts);
      return {
        person: p,
        isLegalHeir: legalSet.has(p.id),
        isCivilHeir: civil.has(p.id),
        inherited,
        insurance,
        insuranceExempt,
        retirement,
        retirementExempt,
        acquired,
        debts,
        debtOnly,
        funeralOnly,
        net,
        gifts,
        taxable,
        ratio: 0,
        ratioText: "",
        computed: 0,
        surcharge: 0,
        giftTaxCredit: 0,
        spouseCredit: 0,
        minorCredit: 0,
        disabilityCredit: 0,
        minorExcess: 0,
        disabilityExcess: 0,
        otherCredits: 0,
        totalCredits: 0,
        afterCredits: 0,
        payable: 0,
      } satisfies PersonTax;
    })
    .filter((pt) => pt.acquired > 0 || pt.taxable > 0 || pt.debts > 0 || pt.isLegalHeir);

  const totalAcquired = persons.reduce((a, p) => a + p.acquired, 0);
  const totalDebts = persons.reduce((a, p) => a + p.debts, 0);
  const totalTaxable = persons.reduce((a, p) => a + p.taxable, 0);
  const taxableEstate = Math.max(0, floor1000(totalTaxable - basicDeduction));

  // 第2表：法定相続分に応ずる取得金額（1,000円未満切捨て）と税額
  const slots = heirsTax.slots.map((s) => {
    const amount = taxableEstate > 0 ? mulYen(taxableEstate, s.share, 1000) : 0;
    return { label: s.label, personIds: s.personIds, share: s.share, amount, tax: progressiveTax(amount) };
  });
  const totalTax = floor100(slots.reduce((a, s) => a + s.tax, 0));

  // 各人の算出税額
  const digits = opts.ratioDigits ?? 10;
  const scaledRatios = apportionScaled(persons.map((p) => p.taxable), digits);
  persons.forEach((p, i) => {
    const scaled = BigInt(scaledRatios[i]);
    const unit = 10n ** BigInt(digits);
    p.ratio = scaledRatios[i] / 10 ** digits;
    const intPart = scaled / unit;
    const frac = (scaled % unit).toString().padStart(digits, "0");
    p.ratioText = trimRatio(`${intPart}.${frac}`);
    // 算出税額＝相続税の総額×按分割合（1円未満切捨て）。浮動小数点を使わず整数で計算
    p.computed = Number((BigInt(totalTax) * scaled) / unit);
    p.surcharge = isSurchargeTarget(p.person) && p.computed > 0 ? Math.floor(p.computed / 5) : 0;
    p.giftTaxCredit = c.priorGifts
      .filter((g) => g.personId === p.person.id && p.gifts > 0)
      .filter((g) => {
        const d = new Date(g.date + "T00:00:00Z");
        return d >= from && d <= death;
      })
      .reduce((a, g) => a + g.giftTaxPaid, 0);
    p.giftTaxCredit = Math.min(p.giftTaxCredit, p.computed + p.surcharge);
  });

  // 配偶者の税額軽減（第5表）
  let spouse: SpouseDetail | undefined;
  const sp = persons.find((p) => p.person.relation === "spouse");
  if (sp && totalTaxable > 0) {
    const legalShare = heirsTax.byPerson.get(sp.person.id) ?? frac(0);
    const legalShareAmount = Math.max(SPOUSE_FLOOR, mulYen(totalTaxable, legalShare, 1000));
    const spouseTaxable = sp.taxable;
    const base = Math.min(legalShareAmount, spouseTaxable);
    const creditBase = Number((BigInt(totalTax) * BigInt(base)) / BigInt(totalTaxable));
    const limit = Math.max(0, sp.computed + sp.surcharge - sp.giftTaxCredit);
    const credit = Math.min(creditBase, limit);
    sp.spouseCredit = credit;
    spouse = { totalTaxable, legalShareAmount, spouseTaxable, base, creditBase, limit, credit };
  }

  // 未成年者控除・障害者控除（第6表）
  for (const p of persons) {
    const before = Math.max(0, p.computed + p.surcharge - p.giftTaxCredit - p.spouseCredit);
    let remaining = before;
    if (p.isLegalHeir && p.person.birthDate) {
      const age = ageAt(p.person.birthDate, c.decedent.deathDate);
      if (age < 18) {
        const full = (18 - age) * 100_000;
        p.minorCredit = Math.min(full, remaining);
        p.minorExcess = full - p.minorCredit;
        remaining -= p.minorCredit;
      }
      if (p.person.disability && p.person.disability !== "none" && age < 85) {
        const full = (85 - age) * (p.person.disability === "special" ? 200_000 : 100_000);
        p.disabilityCredit = Math.min(full, remaining);
        p.disabilityExcess = full - p.disabilityCredit;
        remaining -= p.disabilityCredit;
      }
    }
    if (p.minorExcess > 0) {
      warnings.push(
        `${p.person.name}さんの未成年者控除のうち${p.minorExcess.toLocaleString()}円は控除しきれません。扶養義務者の相続税額から控除できます。`,
      );
    }
    if (p.disabilityExcess > 0) {
      warnings.push(
        `${p.person.name}さんの障害者控除のうち${p.disabilityExcess.toLocaleString()}円は控除しきれません。扶養義務者の相続税額から控除できます。`,
      );
    }
    p.otherCredits = p.minorCredit + p.disabilityCredit;
    p.totalCredits = p.giftTaxCredit + p.spouseCredit + p.otherCredits;
    p.afterCredits = Math.max(0, p.computed + p.surcharge - p.totalCredits);
    p.payable = floor100(p.afterCredits);
  }

  const totalPayable = persons.reduce((a, p) => a + p.payable, 0);
  const totalReduction = assetLines.reduce((a, l) => a + l.reduction, 0);
  const needsFiling = totalTaxable > basicDeduction;
  // 特例適用前の課税価格が基礎控除を超える場合は、特例を受けるために申告が必要
  const needsFilingForRelief = !needsFiling && totalTaxable + totalReduction > basicDeduction;
  if (!needsFiling) {
    warnings.push("課税価格の合計額が基礎控除額以下のため、相続税の申告は原則不要です（特例の適用で申告が必要な場合を除く）。");
  } else if (totalPayable === 0 && spouse && spouse.credit > 0) {
    warnings.push("配偶者の税額軽減により納付税額は0円ですが、軽減を受けるためには申告書の提出が必要です。");
  }
  if (needsFilingForRelief) {
    warnings.push("小規模宅地等の特例を適用して基礎控除以下になっています。特例を受けるには申告書の提出が必要です。");
  }

  return {
    heirsTax,
    heirsCivil,
    legalHeirCount,
    basicDeduction,
    assets: assetLines,
    persons,
    totalAcquired,
    totalDebts,
    totalTaxable,
    taxableEstate,
    slots,
    totalTax,
    spouse,
    totalPayable,
    insuranceExemptLimit,
    retirementExemptLimit,
    blockers,
    warnings,
    needsFiling: needsFiling || needsFilingForRelief,
  };
}

export const shareText = (f: Fraction) => (f.d === 1n ? `${f.n}` : `${f.n}/${f.d}`);
export { toNumber };
