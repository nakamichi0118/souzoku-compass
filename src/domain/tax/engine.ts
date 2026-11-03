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
 * 相続税法基本通達13-1（相続を放棄した人の葬式費用）、17-1（按分割合の端数調整）、
 * 租税特別措置法69条の4（小規模宅地等の特例）。
 */
import { Fraction, frac, mulYen } from "../fraction";
import { HeirResult, determineHeirs, isSurchargeTarget } from "../heirs";
import { floor100, floor1000 } from "../rounding";
import type { Asset, Case, LandAsset, Person, PriorGift, SmallLandKind } from "../types";
import { Valuation, smallResidentialSelection, valueAsset } from "../valuation";
import { judgeSmallResidential, shouldApply } from "../valuation/smallResidential";

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
  /** 特例の種類（特定居住用・特定事業用・貸付事業用） */
  kind: SmallLandKind;
  /** 減額割合（%）：特定居住用・特定事業用 80、貸付事業用 50 */
  rate: number;
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
  /** 遺産分割で取得した財産（減額後）。未分割の財産（undivided）と代償金の受取り・支払いを含む */
  inherited: number;
  /** うち、未分割の財産を法定相続分で取得したものとした価額（第11表②・第5表③） */
  undivided: number;
  /** 代償金の受取額・支払額（inherited に足し引き済み） */
  compensationIn: number;
  compensationOut: number;
  /** みなし相続財産（保険金・退職金）の受取額と非課税額 */
  insurance: number;
  insuranceExempt: number;
  retirement: number;
  retirementExempt: number;
  /** ① 取得財産の価額 */
  acquired: number;
  /** ② 相続時精算課税適用財産の価額（令和6年以後の贈与は年110万円の基礎控除後） */
  settlementGifts: number;
  /** ③ 債務及び葬式費用 */
  debts: number;
  debtOnly: number;
  funeralOnly: number;
  /** ④ 純資産価額（赤字は0） */
  net: number;
  /** 相続・遺贈（保険金・退職金を含む）で何かを受け取った（贈与の加算・未成年者控除などの前提） */
  acquiresSomething: boolean;
  /** 相続開始時の年齢（生年月日がなければ undefined。亡くなった後に生まれた子は0歳） */
  age?: number;
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
  /** 第6表③：贈与税額控除・配偶者の税額軽減の後の相続税額（⑨＋⑪－⑫－⑬） */
  beforeOtherCredits: number;
  /** 未成年者控除・障害者控除（第6表） */
  minorCredit: number;
  disabilityCredit: number;
  /** 控除しきれなかった未成年者・障害者控除（扶養義務者の相続税額から控除する） */
  minorExcess: number;
  disabilityExcess: number;
  /** ほかの人の控除しきれなかった未成年者・障害者控除を、この人（扶養義務者）の相続税額から控除した額（第6表） */
  transfersIn: { fromId: string; kind: "minor" | "disability"; amount: number }[];
  /** 相次相続控除額（第7表。⑭に含む） */
  successiveCredit: number;
  /** ⑭ ⑫⑬以外の税額控除 */
  otherCredits: number;
  /** ⑮ 計 */
  totalCredits: number;
  /** ⑯ 差引税額 */
  afterCredits: number;
  /** ⑰ 相続時精算課税分の贈与税額控除額（納めた贈与税。引ききれない分は還付） */
  settlementCredit: number;
  /** ⑲ 小計（100円未満切捨て） = ㉑ 納付すべき税額 */
  payable: number;
  /** ㉒ 還付される税額（⑯ − ⑰ が赤字のとき） */
  refund: number;
}

/** 相次相続控除の計算（第7表） */
export interface SuccessiveDetail {
  /** A 前の相続で今回亡くなった方が納めた相続税額 */
  prevTax: number;
  /** B 前の相続で今回亡くなった方が取得した財産の価額 */
  prevAcquired: number;
  /** C 今回の相続で財産を取得した全員の純資産価額の合計 */
  netTotal: number;
  /** E 前の相続から今回の相続までの年数（1年未満切捨て） */
  years: number;
  /** 相次相続控除額の総額 A × C/(B−A)（上限1） × (10−E)/10 */
  total: number;
}

export interface SpouseDetail {
  totalTaxable: number; // ① 課税価格の合計額
  legalShareAmount: number; // ② 法定相続分相当額（1円未満切捨て。1億6千万円に満たないときは1億6千万円）
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
  /** 還付される税額の合計 */
  totalRefund: number;
  /** 未分割の財産がある（法定相続分で計算した） */
  undivided: boolean;
  /** 相次相続控除の計算（使うとき） */
  successive?: SuccessiveDetail;
  insuranceExemptLimit: number;
  retirementExemptLimit: number;
  /** 自動完結できない事項（税理士相談が必要） */
  blockers: string[];
  warnings: string[];
  needsFiling: boolean;
}

/** YYYY-MM-DD の実在する日付か */
export function isValidISODate(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * 相続開始時の年齢（満年齢）。亡くなった後に生まれた子（胎児）は0歳とする（相基通19の3-3）。
 * 日付が正しくなければ undefined。
 */
export function ageAt(birth: string | undefined, at: string): number | undefined {
  if (!isValidISODate(birth) || !isValidISODate(at)) return undefined;
  const b = new Date(birth + "T00:00:00Z");
  const d = new Date(at + "T00:00:00Z");
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const md = d.getUTCMonth() - b.getUTCMonth();
  if (md < 0 || (md === 0 && d.getUTCDate() < b.getUTCDate())) age--;
  return Math.max(0, age);
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

/** 小規模宅地等の特例の宅地が何筆までなら、すべての割り当て順を試すか（5筆で120通り） */
export const SR_MAX_PERMUTE = 5;

/** 0〜n-1 の並べ方をすべて、辞書順（入力順がいちばん先）に返す */
function permutations(n: number): number[][] {
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (!rest.length) out.push(prefix);
    rest.forEach((x, i) => walk([...prefix, x], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  walk([], [...Array(n).keys()]);
  return out;
}

/** 0.01㎡単位の面積を「12.5」のように書く */
const sqmText = (area100: number) => String(area100 / 100);

export function calculate(c: Case, opts: EngineOptions = {}): TaxResult {
  // 割り当て順を変えて何度も計算するので、財産の評価は1回だけにする
  const cache = new Map<Asset, Valuation>();
  const value = (a: Asset) => {
    let v = cache.get(a);
    if (!v) cache.set(a, (v = valueAsset(a)));
    return v;
  };
  const base = compute(c, opts, value);
  // 特定居住用宅地等の限度面積330㎡をどの宅地に使うかは、宅地を取得した人全員の同意で選べる（措置法69条の4第1項。付表1の同意欄）。
  // 1㎡あたりの価額が高い宅地を選ぶと減額は最大になるが、税額が0円の配偶者の宅地を選ぶと、かえって家族全体の相続税が増えることがある。
  // そこで、選べる宅地が少なければ割り当て順をすべて試し、納める相続税の合計がいちばん少ない割り当てにする
  // （同じなら減額が大きい方、それも同じなら入力順に近い方）。多いときは1㎡あたりの価額が高い順のままにする
  const live = base.sr.flatMap((x, i) => (x.value > 0 && x.area100 > 0 ? [i] : []));
  const totalArea100 = live.reduce((a, i) => a + base.sr[i].area100, 0);
  if (live.length < 2 || live.length > SR_MAX_PERMUTE || totalArea100 <= 33000) return base.result;
  const rest = base.sr.map((_, i) => i).filter((i) => !live.includes(i));
  const seen = new Set<string>();
  let best: { result: TaxResult; reduction: number } | undefined;
  for (const perm of permutations(live.length)) {
    const order = [...perm.map((k) => live[k]), ...rest];
    // 割り当てる面積が同じになる並べ方（上限に届いたあとの順番違いなど）は、結果も同じなので計算しない
    let left100 = 33000;
    const selected = base.sr.map(() => 0);
    for (const i of order) {
      const x = base.sr[i];
      selected[i] = x.value > 0 ? Math.min(x.area100, left100) : 0;
      left100 -= selected[i];
    }
    const key = selected.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const { result } = compute(c, opts, value, order);
    const reduction = result.assets.reduce((a, l) => a + l.reduction, 0);
    if (!best || result.totalPayable < best.result.totalPayable || (result.totalPayable === best.result.totalPayable && reduction > best.reduction)) {
      best = { result, reduction };
    }
  }
  return best!.result;
}

/**
 * 相続税の計算の本体。srOrder は小規模宅地等の特例の宅地（入力順の番号）に330㎡を割り当てる順番で、
 * 渡さなければ1㎡あたりの価額が高い順にする。sr は特例の宅地ごとの取得者の持分に応ずる面積（0.01㎡単位）と価額
 */
function compute(
  c: Case,
  opts: EngineOptions,
  valueOf: (a: Asset) => Valuation,
  srOrder?: number[],
): { result: TaxResult; sr: { area100: number; value: number }[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const deathYear = Number(c.decedent.deathDate.slice(0, 4));
  if (deathYear !== 2026) {
    blockers.push("相続コンパスは令和8年（2026年）中に開始した相続を対象としています。");
  }

  const heirsTax = determineHeirs(c.persons, "tax");
  const heirsCivil = determineHeirs(c.persons, "civil");
  warnings.push(...heirsTax.notes);
  // 民法上の相続人（放棄者を除く）と、相続税法上の法定相続人（放棄がなかったものとした相続人）
  const civil = new Set(heirsCivil.slots.flatMap((s) => s.personIds));
  const legalSet = new Set(heirsTax.slots.flatMap((s) => s.personIds));
  const legalHeirCount = heirsTax.count;
  const basicDeduction = BASIC_DEDUCTION_BASE + BASIC_DEDUCTION_PER_HEIR * legalHeirCount;

  if (new Set(c.persons.map((p) => p.id)).size !== c.persons.length) {
    blockers.push("家族の一覧に同じ人が二重に登録されています。相続人の画面で確かめてください。");
  }
  if (c.decedent.priorInheritanceTax) {
    blockers.push("亡くなった方が10年以内の相続で相続税を納めているため、相次相続控除の対象になります。相続コンパスでは相次相続控除を計算できないので、税理士にご相談ください。");
  }
  if (c.decedent.settlementGift) {
    blockers.push("亡くなった方から「相続時精算課税」を選んで贈与を受けた人がいます。この贈与は相続税の計算に足す必要がありますが、相続コンパスでは計算できないので、税理士にご相談ください。");
  }
  for (const p of c.persons) {
    if (p.nonResident && !p.predeceased) {
      blockers.push(`${p.name}さんは国外に住所があります。非居住者がいる相続は税理士にご相談ください。`);
    }
    if (p.predeceased && p.deathDate && c.decedent.deathDate && p.deathDate > c.decedent.deathDate) {
      blockers.push(`${p.name || "相続人"}さんは亡くなった方より後に亡くなっています（数次相続）。自動では計算できないため、税理士にご相談ください。`);
    }
    if (!p.predeceased && p.relation === "adoptedChild" && p.grandchildAdopted && p.alsoSubstituteHeir) {
      blockers.push(`${p.name || "養子"}さんは養子であり、先に亡くなった子の代わりに相続する人（代襲相続人）でもあります（二重の資格）。相続コンパスではこの場合の計算ができないため、税理士にご相談ください。`);
    }
  }

  // 財産の評価と取得者への配分
  const allocMap = new Map(c.allocations.map((a) => [a.assetId, a]));
  // 相続を放棄した人は、遺言で受け取る場合を除き、分け方で財産を受け取らない
  const renouncedWithShare = new Set(
    c.allocations.flatMap((al) => al.shares.filter((s) => s.numerator > 0 && c.persons.some((p) => p.id === s.personId && p.renounced && !p.predeceased)).map((s) => s.personId)),
  );
  for (const id of renouncedWithShare) {
    const name = c.persons.find((p) => p.id === id)?.name || "相続を放棄した人";
    warnings.push(`${name}さんは相続を放棄していますが、分け方で財産が割り当てられています。遺言で受け取る場合を除き、分け方を見直してください。`);
  }
  const insuranceBy = new Map<string, number>();
  const retirementBy = new Map<string, number>();
  const assetLines: AssetLine[] = [];
  const living = new Set(c.persons.filter((p) => !p.predeceased).map((p) => p.id));
  // 小規模宅地等の特例を受ける宅地（限度面積は、全部の評価が終わってからまとめて割り当てる）
  const srCandidates: { line: AssetLine; part: { personId: string; amount: number }; landPart: number; area: number; acquirerId: string; order: number }[] = [];
  for (const a of c.assets) {
    if (a.foreign) blockers.push(`「${a.label}」は国外財産です。国外財産がある相続は税理士にご相談ください。`);
    const valuation = valueOf(a);
    if (valuation.needsConsultation) blockers.push(`「${a.label}」：${valuation.needsConsultation}`);
    if (a.pending?.length) {
      // 書類から読み取っただけで本人が確かめていない値で申告書を作らない
      blockers.push(`「${a.label || "名称未入力の財産"}」は、書類から読み取ったあと、まだ確かめていない項目があります（${a.pending.join("、")}）。財産の画面で確かめて「入れて確かめました」を押してください。`);
    }
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
    const line: AssetLine = { asset: a, valuation, reduction: 0, byPerson };
    assetLines.push(line);
    const sr = a.kind === "land" || a.kind === "condo" ? a.smallResidential : undefined;
    // 確認の質問に答えている場合は、保存された「適用する」ではなく今の答えと取得者で判定し直す（取得者を変えたときなど）
    const srOn = !!sr?.acquirerId && (sr.check ? shouldApply(judgeSmallResidential(sr.check, c.persons.find((p) => p.id === sr.acquirerId && !p.predeceased)), sr.check) : sr.applies);
    if (sr?.acquirerId && srOn) {
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
        if (!(area > 0)) {
          // 面積が分からないと、330㎡までの減額を計算できない
          blockers.push(`「${a.label || "名称未入力の土地"}」に小規模宅地等の特例を使うには、${a.kind === "condo" ? "敷地権の面積" : "地積"}を入れてください。`);
          continue;
        }
        srCandidates.push({ line, part, landPart, area, acquirerId: sr.acquirerId, order: srCandidates.length });
      } else {
        warnings.push(`「${a.label}」の小規模宅地等の特例の取得者が、この土地を取得していません。`);
      }
    }
  }

  // 特定居住用宅地等の限度面積330㎡は、選んだ宅地全体で使う（措置法69条の4第2項）。
  // srOrder の順に、なければ1㎡あたりの価額が高い宅地から順に（同じなら入力順）面積を割り当てる
  const unitPrice = (x: (typeof srCandidates)[number]) => (x.area > 0 ? x.landPart / x.area : 0);
  const srOrdered = srOrder ? srOrder.map((i) => srCandidates[i]) : [...srCandidates].sort((x, y) => unitPrice(y) - unitPrice(x) || x.order - y.order);
  let srLeft100 = 33000; // 残りの面積（0.01㎡単位）
  const srUsed: string[] = [];
  const srSkipped: string[] = [];
  for (const x of srOrdered) {
    const label = `「${x.line.asset.label}」`;
    const area100 = Math.round(x.area * 100);
    if (srLeft100 <= 0) {
      if (x.landPart > 0 && area100 > 0) srSkipped.push(label);
      continue;
    }
    const sel = smallResidentialSelection(x.landPart, x.area, srLeft100 / 100);
    if (sel.selectedArea > 0) srUsed.push(area100 > srLeft100 ? `${label}は残り${sqmText(srLeft100)}㎡分` : `${label}に${sqmText(area100)}㎡`);
    x.line.reduction = sel.reduction;
    x.line.small = { acquirerId: x.acquirerId, kind: "residence", rate: 80, area: x.area, value: x.landPart, selectedArea: sel.selectedArea, selectedValue: sel.selectedValue };
    srLeft100 -= Math.round(sel.selectedArea * 100);
    x.part.amount -= sel.reduction;
  }
  const srLive = srCandidates.filter((x) => x.landPart > 0 && Math.round(x.area * 100) > 0);
  if (srLive.length > 1 && srLive.reduce((a, x) => a + Math.round(x.area * 100), 0) > 33000) {
    warnings.push(
      `小規模宅地等の特例は合計330㎡までです。${srOrder ? "家族全体で納める相続税がいちばん少なくなるように" : "1㎡あたりの価額が高い土地から順に"}、${srUsed.join("、")}を割り当てています${srSkipped.length ? `（${srSkipped.join("・")}には適用していません）` : ""}。どの土地に割り当てるかは受け継ぐ人全員の合意で選べるので、別の割り当てにしたいときは税理士にご相談ください。`,
    );
  } else if (srLive.length === 1 && srLive[0].area > 330) {
    warnings.push(`小規模宅地等の特例は330㎡までのため、「${srLive[0].line.asset.label}」は330㎡分だけ適用しています。`);
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
  const inWindow = (g: PriorGift) => {
    if (!isValidISODate(g.date)) return false;
    const d = new Date(g.date + "T00:00:00Z");
    return d >= from && d <= death;
  };
  const giftsInWindow = (personId: string) => c.priorGifts.filter((g) => g.personId === personId && inWindow(g));
  // 受け取った人や日付が分からない贈与は、計算から黙って落とさずに止める
  c.priorGifts.forEach((g, i) => {
    if (!(g.amount > 0) && !(g.giftTaxPaid > 0)) return;
    const what = `亡くなる前3年以内の贈与（${i + 1}件目、${(g.amount || 0).toLocaleString()}円）`;
    const who = c.persons.find((p) => p.id === g.personId);
    if (!g.personId || !who) {
      blockers.push(`${what}を受け取った人が選ばれていません。債務・葬式費用の画面で受け取った人を選んでください。`);
    } else if (who.predeceased) {
      blockers.push(`${what}を受け取った${who.name || "人"}さんは、亡くなった方より先に亡くなっています。この贈与は相続税の計算に足さないので、債務・葬式費用の画面でこの贈与を削除してください。`);
    }
    if (!isValidISODate(g.date)) {
      blockers.push(`${what}の贈与の日が入っていないか、正しい日付ではありません。債務・葬式費用の画面で贈与の日を入れてください。`);
    } else if (c.decedent.deathDate && g.date > c.decedent.deathDate) {
      blockers.push(`${what}の贈与の日が、亡くなった日より後になっています。贈与の日を確かめてください。`);
    }
  });

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
      // 債務控除ができるのは相続人と包括受遺者だけ（相続税法13条1項）。
      // 相続を放棄した人は、実際に負担した葬式費用だけを差し引ける（相基通13-1）
      if (!civil.has(p.id) && debtOnly + funeralOnly > 0) {
        if (legalSet.has(p.id)) {
          if (debtOnly > 0) {
            warnings.push(`${p.name}さんは相続を放棄したため、債務は差し引けません（実際に負担した葬式費用は差し引けます）。`);
          }
          debtOnly = 0;
        } else {
          blockers.push(
            `${p.name || "相続人でない人"}さんは相続人ではないため、負担した債務・葬式費用は差し引けません。遺言で財産の全部または「3分の1」などの割合で受け取る人（包括受遺者）なら差し引けますが、相続コンパスでは扱えないので税理士にご相談ください。そうでなければ、債務・葬式費用の画面で${p.name || "この方"}さんの負担分を、金額と負担する人から外してください。`,
          );
          debtOnly = 0;
          funeralOnly = 0;
        }
      }
      const debts = debtOnly + funeralOnly;
      const net = Math.max(0, acquired - debts);
      const acquiresSomething = inherited > 0 || insurance > 0 || retirement > 0;
      const ownGifts = giftsInWindow(p.id);
      // 3年以内の贈与を足すのは、相続や遺贈で財産を受け取った人だけ（相続税法19条）
      const gifts = acquiresSomething ? ownGifts.reduce((a, g) => a + g.amount, 0) : 0;
      if (!acquiresSomething && ownGifts.some((g) => g.amount > 0)) {
        warnings.push(`${p.name}さんは相続や遺贈で財産を受け取っていないため、亡くなる前3年以内の贈与は相続税の計算に足していません。`);
      }
      const taxable = floor1000(net + gifts);
      return {
        person: p,
        isLegalHeir: legalSet.has(p.id),
        isCivilHeir: civil.has(p.id),
        inherited,
        undivided: 0,
        compensationIn: 0,
        compensationOut: 0,
        insurance,
        insuranceExempt,
        retirement,
        retirementExempt,
        acquired,
        settlementGifts: 0,
        debts,
        debtOnly,
        funeralOnly,
        net,
        acquiresSomething,
        age: ageAt(p.birthDate, c.decedent.deathDate),
        gifts,
        taxable,
        ratio: 0,
        ratioText: "",
        computed: 0,
        surcharge: 0,
        giftTaxCredit: 0,
        spouseCredit: 0,
        beforeOtherCredits: 0,
        minorCredit: 0,
        disabilityCredit: 0,
        minorExcess: 0,
        disabilityExcess: 0,
        transfersIn: [],
        successiveCredit: 0,
        otherCredits: 0,
        totalCredits: 0,
        afterCredits: 0,
        settlementCredit: 0,
        payable: 0,
        refund: 0,
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
    // 2割加算：代襲相続人かどうかは、実際に代襲が起きたか（民法上の相続人の判定）で決める
    p.surcharge = isSurchargeTarget(p.person, heirsCivil.substitutes) && p.computed > 0 ? Math.floor(p.computed / 5) : 0;
    const credit = p.gifts > 0 ? giftsInWindow(p.person.id).reduce((a, g) => a + g.giftTaxPaid, 0) : 0;
    p.giftTaxCredit = Math.min(credit, p.computed + p.surcharge);
  });

  // 配偶者の税額軽減（第5表）
  let spouse: SpouseDetail | undefined;
  const sp = persons.find((p) => p.person.relation === "spouse");
  if (sp && totalTaxable > 0) {
    const legalShare = heirsTax.byPerson.get(sp.person.id) ?? frac(0);
    // 課税価格の合計額×配偶者の法定相続分（相続税法19条の2第1項2号イ）。1,000円単位には切り捨てない
    const legalShareAmount = Math.max(SPOUSE_FLOOR, mulYen(totalTaxable, legalShare));
    const spouseTaxable = sp.taxable;
    const base = Math.min(legalShareAmount, spouseTaxable);
    const creditBase = Number((BigInt(totalTax) * BigInt(base)) / BigInt(totalTaxable));
    const limit = Math.max(0, sp.computed + sp.surcharge - sp.giftTaxCredit);
    const credit = Math.min(creditBase, limit);
    sp.spouseCredit = credit;
    spouse = { totalTaxable, legalShareAmount, spouseTaxable, base, creditBase, limit, credit };
  }

  // 未成年者控除・障害者控除（第6表）。相続や遺贈で財産を受け取った法定相続人だけが対象（相続税法19条の3・19条の4）
  for (const p of persons) {
    p.beforeOtherCredits = Math.max(0, p.computed + p.surcharge - p.giftTaxCredit - p.spouseCredit);
    let remaining = p.beforeOtherCredits;
    if (p.isLegalHeir && p.acquiresSomething && p.age !== undefined) {
      const age = p.age;
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
    p.otherCredits = p.minorCredit + p.disabilityCredit;
    p.totalCredits = p.giftTaxCredit + p.spouseCredit + p.otherCredits;
    p.afterCredits = Math.max(0, p.computed + p.surcharge - p.totalCredits);
    p.payable = floor100(p.afterCredits);
  }
  // 引ききれない未成年者控除・障害者控除は、扶養義務者の相続税額から差し引くことになっている（19条の3第2項・19条の4第3項）。
  // 誰が扶養義務者か・どう分けるかは自動で決められないため、差し引ける相手がいるときは止める
  for (const p of persons) {
    for (const [kind, excess] of [
      ["未成年者控除", p.minorExcess],
      ["障害者控除", p.disabilityExcess],
    ] as const) {
      if (excess <= 0) continue;
      const name = p.person.name || "この方";
      if (persons.some((q) => q !== p && q.afterCredits > 0)) {
        blockers.push(
          `${name}さんの${kind}のうち${excess.toLocaleString()}円は、${name}さんの相続税から引ききれません。引ききれない分は、同じ相続で財産を受け取った扶養義務者（${name}さんの親・祖父母・兄弟姉妹など）の相続税から差し引くことになっていますが、相続コンパスではこの計算と申告書への記入ができません。税理士にご相談ください。`,
        );
      } else {
        warnings.push(`${name}さんの${kind}のうち${excess.toLocaleString()}円は引ききれません。ほかに相続税を納める人がいないため、この分は使われません。`);
      }
    }
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

  const result: TaxResult = {
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
    totalRefund: 0,
    undivided: false,
    insuranceExemptLimit,
    retirementExemptLimit,
    blockers,
    warnings,
    needsFiling: needsFiling || needsFilingForRelief,
  };
  return { result, sr: srCandidates.map((x) => ({ area100: Math.round(x.area * 100), value: x.landPart })) };
}
