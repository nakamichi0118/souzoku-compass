/**
 * 相続税の決定論的な計算エンジン（令和8年中に開始した相続）。
 * Claude はこのエンジンの結果を説明するだけで、税額の計算には関与しない。
 *
 * 主な根拠:
 * 相続税法 11条の2（課税価格）、12条（非課税財産：生命保険金等 500万円×法定相続人の数）、
 * 13条（債務控除）、15条（基礎控除 3,000万円＋600万円×法定相続人の数）、16条（相続税の総額）、
 * 17条（各人の相続税額＝総額×按分割合）、18条（2割加算）、19条（暦年課税分の贈与税額控除）、
 * 19条の2（配偶者の税額軽減。2項 未分割の財産は含めない）、19条の3（未成年者控除）、19条の4（障害者控除）、
 * 20条（相次相続控除）、21条の15・21条の16（相続時精算課税の贈与財産の加算と贈与税額の控除）、
 * 33条の2（引ききれない精算課税の贈与税の還付）、55条（未分割の財産は法定相続分で取得したものとして計算）、
 * 相続税法施行令4条の3（扶養義務者の相続税額から引く未成年者控除・障害者控除）、
 * 国税通則法118条（課税標準の1,000円未満切捨て）、119条（確定金額の100円未満切捨て）、
 * 相続税法基本通達 1の2-1（扶養義務者）、11の2-9・11の2-10（代償分割と代償財産の価額）、13-1（相続を放棄した人の葬式費用）、
 * 13-3（負担する人が決まっていない債務）、17-1（按分割合の端数調整）、19の3-5（以前の相続で受けた未成年者控除）、
 * 19の4-4（以前の相続のときと障害者の区分が違うときの障害者控除）、
 * 租税特別措置法69条の4（小規模宅地等の特例。2項 限度面積、4項 未分割の宅地には使えない。
 * 1つの宅地を何人かで受け継いだときは、取得した人ごとに要件を見て、その人の持分に応ずる部分だけに使う。
 * 特例を使う面積は、限度面積の範囲で受け継いだ面積の一部だけにもできる（第11・11の2表の付表1の③〜⑥。国税庁 タックスアンサー No.4124）、
 * 国税庁 質疑応答事例「未分割の場合の課税価格（相続時精算課税適用財産がある場合）」（相続時精算課税の贈与を特別受益として未分割の財産を分ける）。
 */
import { Fraction, ONE, ZERO, add, div, frac, mul, mulYen, sub, sum } from "../fraction";
import { HeirResult, determineHeirs, isSurchargeTarget } from "../heirs";
import { floor100, floor1000 } from "../rounding";
import type { Asset, Case, Debt, PriorGift, Person, SmallLandKind } from "../types";
import { Valuation, smallResidentialSelection, valueAsset } from "../valuation";
import { ratio4, ratioText } from "../valuation/lease";
import { SMALL_LAND_RULE, type SmallResidentialCheck, judgeSmallResidential, shouldApply, smallLandKind } from "../valuation/smallResidential";

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
/** 相続時精算課税の基礎控除（令和6年1月1日以後の贈与。1年ごと。相続税法21条の11の2） */
export const SETTLEMENT_ANNUAL_DEDUCTION = 1_100_000;

export interface AssetLine {
  asset: Asset;
  valuation: Valuation;
  /** 小規模宅地等の特例による減額 */
  reduction: number;
  /** 取得者ごとの取得価額（減額後）。未分割の部分（undivided）を含む */
  byPerson: { personId: string; amount: number }[];
  /** byPerson のうち、分け方が決まっていないため法定相続分で取得したものとした部分（第11表の「未分割」）。なければ undefined */
  undivided?: { personId: string; amount: number }[];
  /** 小規模宅地等の特例の明細（第11・11の2表の付表1）。最初の取得者（SmallLandRelief.acquirerId）の分 */
  small?: SmallResidentialDetail;
  /** 同じ土地を一緒に受け継いだ2人目以降の取得者の明細（SmallLandRelief.others の順。特例を使わなかった人は入れない）。reduction はすべての合計 */
  smallExtra?: SmallResidentialDetail[];
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
  /** うち、未分割の財産を法定相続分で取得したものとした価額（第11表②・第5表⑤） */
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
  /** debtOnly・funeralOnly のうち、負担する人が決まっていないため法定相続分で負担したものとした額（第13表の②⑤「確定していない」） */
  debtsUnsettled: number;
  funeralUnsettled: number;
  /** ④ 純資産価額（赤字は0） */
  net: number;
  /** 相続・遺贈（保険金・退職金・代償金・相続時精算課税の贈与を含む）で何かを受け取った（贈与の加算・未成年者控除などの前提） */
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
  /** 未成年者控除・障害者控除（第6表）。本人の相続税額から引いた額 */
  minorCredit: number;
  disabilityCredit: number;
  /** 本人の相続税額から引ききれなかった未成年者・障害者控除（扶養義務者の相続税額から引く。transfersIn を見る） */
  minorExcess: number;
  disabilityExcess: number;
  /** ほかの人の控除しきれなかった未成年者・障害者控除を、この人（扶養義務者）の相続税額から控除した額（第6表） */
  transfersIn: { fromId: string; kind: "minor" | "disability"; amount: number }[];
  /** 相次相続控除額（第7表。⑭に含む） */
  successiveCredit: number;
  /** ⑭ ⑫⑬以外の税額控除（未成年者控除・障害者控除・扶養義務者として引いた額・相次相続控除） */
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

/** 配偶者の税額軽減（第5表）。番号は第5表の「1 一般の場合」の欄 */
export interface SpouseDetail {
  totalTaxable: number; // ① 課税価格の合計額
  legalShareAmount: number; // ② 法定相続分相当額（1円未満切捨て。1億6千万円に満たないときは1億6千万円）
  /** ③ 分割財産の価額（保険金等の課税分・代償金・相続時精算課税の贈与財産を含み、小規模宅地等の減額後） */
  divided: number;
  /** ④ 債務及び葬式費用の金額（第1表③） */
  debts: number;
  /** ⑤ 未分割財産の価額 */
  undivided: number;
  /** ⑥ ④−⑤（⑤が④より大きいときは0） */
  debtsOverUndivided: number;
  /** ⑦ 純資産価額に加算される暦年課税分の贈与財産価額（第1表⑤） */
  gifts: number;
  spouseTaxable: number; // ⑧ ③−⑥＋⑦（⑦より小さいときは⑦。1,000円未満切捨て）。未分割の財産がなければ配偶者の課税価格
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
  /** 代償金ごとの、課税価格に入れた額（value。時価をもとに決めたときは 代償金×評価額÷時価、それ以外は amount と同じ） */
  compensation: { fromId: string; toId: string; amount: number; value: number }[];
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

/** 財産を分ける1人分の割合。undivided は分け方が決まっていない部分（法定相続分で分けたもの） */
interface SharePart {
  personId: string;
  f: Fraction;
  undivided: boolean;
}

/**
 * 金額を割合で分ける（各人1円未満切捨て）。割合の合計が1のときだけ端数を寄せて合計を一致させる。
 * rest = "first" は先頭の人に（分け方どおりの財産。これまでと同じ）、
 * "largest" は割合がいちばん大きい人に（同じなら先の人。未分割の部分を含む財産）寄せる
 */
function splitParts(amount: number, parts: SharePart[], rest: "first" | "largest" | "none"): number[] {
  const out = parts.map((p) => mulYen(amount, p.f));
  if (rest === "none" || parts.length === 0) return out;
  const diff = amount - out.reduce((a, b) => a + b, 0);
  if (diff === 0) return out;
  let k = 0;
  if (rest === "largest") {
    for (let i = 1; i < parts.length; i++) if (parts[i].f.n * parts[k].f.d > parts[k].f.n * parts[i].f.d) k = i;
  }
  out[k] += diff;
  return out;
}

/** 亡くなった方の子（養子を含む）か、先に亡くなった子・孫の代わりに相続する孫・ひ孫（代襲相続人） */
function isDescendant(p: Person): boolean {
  return p.relation === "child" || p.relation === "adoptedChild" || ((p.relation === "grandchild" || p.relation === "greatGrandchild") && !!p.substituteOf);
}

/** b が a の配偶者・直系血族・兄弟姉妹であると、亡くなった方との続柄から確かに言えるか（片方向） */
function kinOneWay(a: Person, b: Person): boolean {
  const ascendant = b.relation === "parent" || b.relation === "grandparent";
  switch (a.relation) {
    case "child":
    case "adoptedChild":
      // 亡くなった方の子どうしは兄弟姉妹（養子も養親の子と兄弟姉妹になる。民法727条）。父母・祖父母は直系尊属
      return b.relation === "spouse" || b.relation === "child" || b.relation === "adoptedChild" || ascendant;
    case "grandchild":
    case "greatGrandchild":
      if (!a.substituteOf) return false;
      // 同じ人の代わりに相続する人どうしは兄弟姉妹。ほかの子は、おじ・おばなので入れない
      return b.relation === "spouse" || ((b.relation === "grandchild" || b.relation === "greatGrandchild") && b.substituteOf === a.substituteOf) || ascendant;
    case "spouse":
      return isDescendant(b);
    case "parent":
      // 父母どうしは夫婦として数える。父母の両方を同じくする兄弟姉妹は父母の子
      return b.relation === "parent" || (b.relation === "sibling" && !b.halfBlood);
    case "sibling":
      return (b.relation === "sibling" && (!a.halfBlood || !b.halfBlood)) || (b.relation === "parent" && !a.halfBlood);
    case "nephewNiece":
      return b.relation === "nephewNiece" && !!a.substituteOf && b.substituteOf === a.substituteOf;
    default:
      return false;
  }
}

/**
 * 未成年者控除・障害者控除の引ききれない分を引ける扶養義務者か（相続税法19条の3第2項・19条の4第3項、相基通1の2-1）。
 * 扶養義務者は配偶者・直系血族・兄弟姉妹と、生計を一にする3親等内の親族など。相続コンパスは続柄から確かに言える
 * 配偶者・直系血族・兄弟姉妹だけを数え、おじ・おば・いとこ・配偶者の親族・相続人でない受遺者は入れない（生計を一にしていたかは聞いていない）。
 * 亡くなった方の配偶者は、亡くなった方の子全員の親（代襲相続人の祖父母）とする。直系血族は向きを問わないので両方向で調べる
 */
export function isSupporter(a: Person, b: Person): boolean {
  if (a.id === b.id || a.relation === "other" || b.relation === "other") return false;
  return kinOneWay(a, b) || kinOneWay(b, a);
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

/**
 * 小規模宅地等の特例の候補（土地と取得する人の組）がいくつまでなら、すべての割り当て順を試すか（7つで5,040通り。
 * 割り当てる面積が同じになる並べ方は1回だけ計算するので、実際に計算するのはずっと少ない）
 */
export const SR_MAX_PERMUTE = 7;

/** 0〜n-1 の並べ方をすべて、辞書順（並べた順がいちばん先）に返す */
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

/**
 * 小規模宅地等の特例の候補（限度面積の割り当てに使う形。土地と取得する人の組ごとに1つ）。
 * area100 は取得者の持分に応ずる面積（付表1の③。0.01㎡単位）、value はその価額（④）、
 * cap100 はその人が特例を使える面積の上限（③か、その人が選んだ面積の少ない方）
 */
interface SrSlot {
  kind: SmallLandKind;
  area100: number;
  cap100: number;
  value: number;
  /** 取得する人が配偶者か（配偶者の税額軽減で税額が0円になりやすいので、同じ条件なら後に回す） */
  spouse?: boolean;
}

/**
 * 1つの宅地を一緒に受け継いだ2人目以降の人の答え。土地についての答え（自宅の敷地か・事情があるか・事業に使っていたか・
 * 3年以内に始めたか）は1人目の答えを、人ごとの答え（同居・住み続け・続ける・税理士に確認した）はその人の答えを使う
 */
export function mergeAcquirerCheck(lot: SmallResidentialCheck | undefined, own: SmallResidentialCheck | undefined): SmallResidentialCheck {
  return {
    ownHome: lot?.ownHome,
    special: lot?.special,
    business: lot?.business,
    recent: lot?.recent,
    livedTogether: own?.livedTogether,
    keep: own?.keep,
    continues: own?.continues,
    confirmedByAdvisor: own?.confirmedByAdvisor,
  };
}

/**
 * 限度面積（措置法69条の4第2項）。貸付事業用宅地等を選ぶときは
 * 特定居住用 × 200/330 ＋ 特定事業用 × 200/400 ＋ 貸付事業用 ≦ 200㎡。
 * 両辺に 66 を掛けて整数にすると 40×特定居住用 ＋ 33×特定事業用 ＋ 66×貸付事業用 ≦ 13,200（0.01㎡単位で 1,320,000）
 */
const SR_WEIGHT: Record<SmallLandKind, number> = { residence: 40, business: 33, rental: 66 };
const SR_ROOM100 = 1_320_000;

/**
 * 並べた順に、限度面積の残りで使えるだけの面積（0.01㎡未満切捨て）を割り当てる。返り値は候補ごとの選択面積（0.01㎡単位）。
 * 貸付事業用を選ばないあいだは、特定居住用330㎡・特定事業用400㎡をそれぞれ別に使える（合計730㎡）
 */
function fillSmallLand(slots: SrSlot[], order: number[]): number[] {
  const sel = slots.map(() => 0);
  const used: Record<SmallLandKind, number> = { residence: 0, business: 0, rental: 0 };
  for (const i of order) {
    const x = slots[i];
    if (!(x.value > 0) || !(x.cap100 > 0)) continue;
    const room = SR_ROOM100 - SR_WEIGHT.residence * used.residence - SR_WEIGHT.business * used.business - SR_WEIGHT.rental * used.rental;
    let max = x.kind === "rental" ? Math.floor(room / SR_WEIGHT.rental) : SMALL_LAND_RULE[x.kind].limitSqm * 100 - used[x.kind];
    if (x.kind !== "rental" && used.rental > 0) max = Math.min(max, Math.floor(room / SR_WEIGHT[x.kind]));
    sel[i] = Math.max(0, Math.min(x.cap100, max));
    used[x.kind] += sel[i];
  }
  return sel;
}

/** 全部の候補をそのまま選ぶと限度面積を超えるか（超えなければ、どの順でも全部選べる） */
function srBinds(slots: SrSlot[]): boolean {
  const t: Record<SmallLandKind, number> = { residence: 0, business: 0, rental: 0 };
  for (const x of slots) if (x.value > 0 && x.cap100 > 0) t[x.kind] += x.cap100;
  if (t.rental > 0) return SR_WEIGHT.residence * t.residence + SR_WEIGHT.business * t.business + SR_WEIGHT.rental * t.rental > SR_ROOM100;
  return t.residence > SMALL_LAND_RULE.residence.limitSqm * 100 || t.business > SMALL_LAND_RULE.business.limitSqm * 100;
}

/**
 * 既定の割り当て順：限度面積1㎡あたり（貸付事業用に換算）の減額が大きい順。同じなら配偶者でない人の分を先に
 * （1つの土地を一緒に受け継いだ人どうしは必ず同じになる。配偶者の税額軽減で税額が0円の配偶者に先に割り当てると、
 * 入力した順だけで家族全体の税額が変わってしまうため）、それも同じなら入力順。
 * 特定居住用だけなら「1㎡あたりの価額が高い順」と同じ。比べるのは 価額×減額割合×限度面積÷面積 で、整数のまま掛けて比べる
 */
function defaultSrOrder(slots: SrSlot[]): number[] {
  const eff = (x: SrSlot) => ({
    n: BigInt(Math.max(0, x.value)) * BigInt(SMALL_LAND_RULE[x.kind].rate * SMALL_LAND_RULE[x.kind].limitSqm),
    d: BigInt(Math.max(1, x.area100)),
  });
  return slots
    .map((_, i) => i)
    .sort((i, j) => {
      const a = eff(slots[i]);
      const b = eff(slots[j]);
      const l = a.n * b.d;
      const r = b.n * a.d;
      if (l !== r) return l > r ? -1 : 1;
      if (!!slots[i].spouse !== !!slots[j].spouse) return slots[i].spouse ? 1 : -1;
      return i - j;
    });
}

export function calculate(c: Case, opts: EngineOptions = {}): TaxResult {
  // 割り当て順を変えて何度も計算するので、財産の評価は1回だけにする
  const cache = new Map<Asset, Valuation>();
  const value = (a: Asset) => {
    let v = cache.get(a);
    if (!v) cache.set(a, (v = valueAsset(a)));
    return v;
  };
  const base = compute(c, opts, value);
  // 限度面積をどの宅地に使うかは、宅地を取得した人全員の同意で選べる（措置法69条の4第1項。付表1の同意欄）。
  // 減額がいちばん大きい宅地を選んでも、税額が0円の配偶者の宅地を選ぶと、かえって家族全体の相続税が増えることがある。
  // そこで、選べる宅地が少なければ割り当て順をすべて試し、納める相続税の合計（還付される額を引いたもの）がいちばん少ない割り当てにする
  // （同じなら減額が大きい方、それも同じなら既定の順に近い方）。多いときは既定の順（限度面積1㎡あたりの減額が大きい順）のままにする
  const slots = base.sr;
  const live = slots.flatMap((x, i) => (x.value > 0 && x.cap100 > 0 ? [i] : []));
  if (live.length < 2 || live.length > SR_MAX_PERMUTE || !srBinds(slots)) return base.result;
  const def = defaultSrOrder(slots);
  const liveDef = def.filter((i) => live.includes(i));
  const rest = def.filter((i) => !live.includes(i));
  const seen = new Set<string>();
  let best: { result: TaxResult; score: number; reduction: number } | undefined;
  for (const perm of permutations(liveDef.length)) {
    const order = [...perm.map((k) => liveDef[k]), ...rest];
    // 割り当てる面積が同じになる並べ方（上限に届いたあとの順番違いなど）は、結果も同じなので計算しない
    const key = fillSmallLand(slots, order).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const { result } = compute(c, opts, value, order);
    const score = result.totalPayable - result.totalRefund;
    const reduction = result.assets.reduce((a, l) => a + l.reduction, 0);
    if (!best || score < best.score || (score === best.score && reduction > best.reduction)) best = { result, score, reduction };
  }
  return best!.result;
}

/** 「12,345円」 */
const yenText = (n: number) => `${n.toLocaleString()}円`;
/** 「長男さん」。名前がなければ「名前が入っていない人」 */
const personText = (p: Person | undefined) => (p?.name ? `${p.name}さん` : "名前が入っていない人");

/**
 * 相続税の計算の本体。srOrder は小規模宅地等の特例の候補（見つけた順の番号）に限度面積を割り当てる順番で、
 * 渡さなければ既定の順（defaultSrOrder）にする。sr は候補ごとの種類・取得者の持分に応ずる面積（0.01㎡単位）と価額
 */
function compute(
  c: Case,
  opts: EngineOptions,
  valueOf: (a: Asset) => Valuation,
  srOrder?: number[],
): { result: TaxResult; sr: SrSlot[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const deathDate = c.decedent.deathDate;
  const deathYear = Number(deathDate.slice(0, 4));
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
  const living = new Set(c.persons.filter((p) => !p.predeceased).map((p) => p.id));
  const nameOf = (id: string, fallback = "この方") => c.persons.find((p) => p.id === id)?.name || fallback;

  if (new Set(c.persons.map((p) => p.id)).size !== c.persons.length) {
    blockers.push("家族の一覧に同じ人が二重に登録されています。相続人の画面で確かめてください。");
  }
  if (c.persons.length === 0) {
    blockers.push("相続人がまだ入っていません。相続人の画面で、亡くなった方の家族を入れてください。");
  } else if (civil.size === 0) {
    // 相続人がいない（全員が放棄した・相続人になる家族がいない）ときは、相続財産清算人や特別縁故者への分与の手続きになる
    blockers.push(
      "民法上の相続人がいません（全員が相続を放棄した、または相続人になる家族がいない）。この場合は、家庭裁判所で「相続財産清算人」を選ぶ手続きや、内縁の配偶者など特に縁の深かった人（特別縁故者）への財産の分与などが必要になるため、相続コンパスでは計算できません。税理士にご相談ください。",
    );
  }

  // 相次相続控除（相続税法20条）に使う前の相続の内容
  let prior: { date: string; prevTax: number; prevAcquired: number } | undefined;
  if (c.decedent.priorInheritanceTax) {
    const pi = c.decedent.priorInheritance ?? {};
    const missing = [
      !isValidISODate(pi.date) && "前の相続の日（前に亡くなった方が亡くなった日）",
      !(Number(pi.prevTax) > 0) && "亡くなった方が前の相続で納めた相続税額",
      !(Number(pi.prevAcquired) > 0) && "亡くなった方が前の相続で取得した財産の価額",
    ].filter((x): x is string => !!x);
    if (missing.length) {
      blockers.push(
        `亡くなった方が10年以内の相続で相続税を納めているため、その一部を今回の相続税から差し引けます（相次相続控除）。計算には${missing.join("・")}が必要です。前の相続の申告書の控えを見て、亡くなった方の画面で入れてください。`,
      );
    } else if (!(pi.date! < deathDate)) {
      blockers.push("相次相続控除の「前の相続の日」が、今回亡くなった日より前になっていません。亡くなった方の画面で日付を確かめてください。");
    } else {
      prior = { date: pi.date!, prevTax: Math.floor(Number(pi.prevTax)), prevAcquired: Math.floor(Number(pi.prevAcquired)) };
    }
  }
  if (c.decedent.settlementGift && !c.priorGifts.some((g) => g.settlement)) {
    blockers.push(
      "「相続時精算課税」を選んだ贈与があると選ばれていますが、その贈与がまだ入っていません。債務・葬式費用の画面の贈与の一覧にその贈与を加え、「相続時精算課税」にチェックを入れてください。",
    );
  }
  const laterDeaths: string[] = [];
  for (const p of c.persons) {
    if (p.nonResident && !p.predeceased) {
      blockers.push(`${p.name}さんは国外に住所があります。非居住者がいる相続は税理士にご相談ください。`);
    }
    if (p.predeceased && p.deathDate && deathDate && p.deathDate > deathDate) {
      laterDeaths.push(`${p.name || "相続人"}さんは亡くなった方より後に亡くなっています（数次相続）。自動では計算できないため、税理士にご相談ください。`);
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
    warnings.push(`${nameOf(id, "相続を放棄した人")}さんは相続を放棄していますが、分け方で財産が割り当てられています。遺言で受け取る場合を除き、分け方を見直してください。`);
  }
  // 民法上の相続人と法定相続分（家族の一覧の順）。分け方が決まっていない財産・負担する人が決まっていない債務を分けるのに使う
  const legalParts: SharePart[] = [];
  for (const p of c.persons) {
    const f = heirsCivil.byPerson.get(p.id);
    if (f && f.n > 0n && living.has(p.id) && !legalParts.some((x) => x.personId === p.id)) legalParts.push({ personId: p.id, f, undivided: true });
  }
  const insuranceBy = new Map<string, number>();
  const retirementBy = new Map<string, number>();
  const assetLines: AssetLine[] = [];
  /** 分け方で取得した財産の評価額（小規模宅地等の減額・代償金の前。未分割の部分を除く） */
  const dividedGross = new Map<string, number>();
  /** 未分割の財産を法定相続分で取得したものとした価額 */
  const undividedBy = new Map<string, number>();
  const addTo = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v);
  const undividedLabels: string[] = [];
  // 小規模宅地等の特例を受ける宅地と取得する人の組（限度面積は、全部の評価が終わってからまとめて割り当てる）。
  // 1つの宅地を何人かで受け継いだときは、特例を使う人ごとに1つずつ（付表1の1行ずつ）。見つけた順は、土地ごとに1人目、2人目以降（others の順）
  const srCandidates: {
    line: AssetLine;
    part: { personId: string; amount: number };
    landPart: number;
    area: number;
    area100: number;
    /** 特例を使える面積の上限（0.01㎡単位）。③か、その人が選んだ面積の少ない方 */
    cap100: number;
    acquirerId: string;
    kind: SmallLandKind;
    /** SmallLandRelief.acquirerId の人（付表1の line.small）か、others の人（line.smallExtra）か */
    first: boolean;
    /** 案内に使う土地の名前。1つの土地で2人以上が特例を使うときは「「自宅」（長男さんの分）」のように人の名前を添える */
    label: string;
  }[] = [];
  const allocateHint = "申告期限までに分け方が決まらないときは、遺産の分け方の画面で「分け方がまだ決まっていない」にチェックを入れてください（法定相続分で受け継いだものとして計算します）。";
  // 1回目：財産ごとに評価し、分け方で決まった割合（decided）と決まっていない割合（undecided）を調べる
  type Plan =
    | { a: Asset; valuation: Valuation; receipt: true }
    | {
        a: Asset;
        valuation: Valuation;
        receipt: false;
        label: string;
        valid: { personId: string; numerator: number; denominator: number }[];
        decided: SharePart[];
        undecided: Fraction;
        rest: "first" | "largest" | "none";
      };
  const plans: Plan[] = [];
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
      plans.push({ a, valuation, receipt: true });
      continue;
    }
    const label = `「${a.label || "名称未入力の財産"}」`;
    const shares = allocMap.get(a.id)?.shares ?? [];
    const valid = shares.filter((s) => Number.isInteger(s.numerator) && Number.isInteger(s.denominator) && s.numerator > 0 && s.denominator > 0 && living.has(s.personId));
    const total = sum(valid.map((s) => frac(s.numerator, s.denominator)));
    const over = sub(total, ONE).n;
    const decided: SharePart[] = valid.map((s) => ({ personId: s.personId, f: frac(s.numerator, s.denominator), undivided: false }));
    let undecided = ZERO;
    let rest: "first" | "largest" | "none" = "none";
    if (shares.length === 0) {
      if (c.undivided) {
        // 未分割：法定相続分で取得したものとして計算する（相続税法55条）
        undecided = ONE;
        rest = "largest";
      } else {
        blockers.push(`${label}を受け継ぐ人が決まっていません。遺産の分け方で取得者を決めてください。${allocateHint}`);
      }
    } else if (shares.some((s) => s.numerator > 0 && !living.has(s.personId))) {
      // 割合は1でも、取得者に先に亡くなった人や一覧にいない人が入っている
      blockers.push(`${label}を受け継ぐ人に、亡くなった方より先に亡くなった人か、家族の一覧にいない人が選ばれています。遺産の分け方で受け継ぐ人を選び直してください。`);
    } else if (valid.length !== shares.length || over > 0n) {
      const shareSum = shares.reduce((acc, s) => acc + s.numerator / Math.max(1, s.denominator), 0);
      blockers.push(`${label}の取得割合の合計が1になっていません（いま ${Math.round(shareSum * 10000) / 100}%）。遺産の分け方を確認してください。`);
    } else if (over < 0n) {
      if (c.undivided) {
        // 一部だけ決まっている：残りの割合を、決まっていない部分として法定相続分で分ける
        undecided = sub(ONE, total);
        rest = "largest";
      } else {
        const pct = Math.round((Number(total.n) / Number(total.d)) * 10000) / 100;
        blockers.push(`${label}は、受け継ぐ人が決まっていない部分があります（いま ${pct}%）。遺産の分け方で、取得者と割合の合計が100%になるように決めてください。${allocateHint}`);
      }
    } else {
      rest = "first";
    }
    plans.push({ a, valuation, receipt: false, label, valid, decided, undecided, rest });
  }

  // 代償金（相基通11の2-9）：払う人の取得財産の価額から引き、受け取る人の取得財産の価額に足す（未分割の部分の分け方より先に計算する）。
  // 代償金の額を特定の財産の時価をもとに決めたときは、代償金 × その財産の相続税評価額 ÷ 時価（1円未満切捨て）を足し引きする（相基通11の2-10(2)）
  const compIn = new Map<string, number>();
  const compOut = new Map<string, number>();
  const compensation: TaxResult["compensation"] = [];
  /** 計算に入れる代償金（課税価格に入れる額）。未分割の部分の分け方にも使う */
  const compRows: { fromId: string; toId: string; value: number }[] = [];
  (c.compensation ?? []).forEach((x, i) => {
    const what = `代償金（${i + 1}件目）`;
    const amountOk = Number.isSafeInteger(x.amount) && x.amount > 0;
    let value = amountOk ? x.amount : 0;
    let basisOk = true;
    if (x.basis) {
      const base = c.assets.find((a) => a.id === x.basis!.assetId && a.kind !== "insurance" && a.kind !== "retirement");
      const market = x.basis.marketValue;
      if (!base) {
        basisOk = false;
        blockers.push(`${what}の額を決めるもとにした財産が、財産の一覧に見つかりません。遺産の分け方の画面で、もとにした財産を選び直してください。`);
      } else if (!Number.isSafeInteger(market) || !(market > 0)) {
        basisOk = false;
        blockers.push(`${what}の額を決めるもとにした「${base.label || "財産"}」の時価を、1円以上の整数で入れてください。`);
      } else if (amountOk) {
        value = Number((BigInt(x.amount) * BigInt(Math.max(0, valueOf(base).value))) / BigInt(market));
      }
    }
    compensation.push({ fromId: x.fromId, toId: x.toId, amount: x.amount, value: basisOk ? value : 0 });
    if (!amountOk) {
      blockers.push(`${what}の金額を、1円以上の整数で入れてください。`);
    } else if (!living.has(x.fromId) || !living.has(x.toId)) {
      blockers.push(`${what}を払う人と受け取る人を、相続人の一覧から選んでください。`);
    } else if (x.fromId === x.toId) {
      blockers.push(`${what}を払う人と受け取る人が同じ人になっています。遺産の分け方の画面で確かめてください。`);
    } else if (basisOk) {
      addTo(compOut, x.fromId, value);
      addTo(compIn, x.toId, value);
      compRows.push({ fromId: x.fromId, toId: x.toId, value });
    }
  });

  // 未分割の部分の分け方（相続税法55条・相基通55-1。穴埋め方式）：分ける対象の財産全体（評価額。小規模宅地等の前）を
  // 法定相続分で分けた額から、分け方で決まった財産の額を引き、その残り（足りない額。マイナスは0）の割合で、決まっていない部分を分ける。
  // 相続人でない人が遺言などで受け取ると決まった部分は、相続人で分ける財産に入れない。何も決まっていなければ法定相続分そのもの。
  // 分け方で決まった財産は、代償金を払う人はその分を引き、受け取る人はその分を足した額にする（相基通11の2-9）。
  // 相続人が受けた相続時精算課税の贈与（贈与の額そのもの）は、特別受益（民法903条）として、財産全体に足し、その人がすでに受け取った額にも足す
  // （国税庁 質疑応答事例「未分割の場合の課税価格（相続時精算課税適用財産がある場合）」）。暦年課税の贈与は足さない
  /** 未分割の部分を分けるときに、相続時精算課税の贈与を受け取ったものとして数えた人 */
  const settlementAsShare: string[] = [];
  const undividedSplit = (() => {
    if (!c.undivided || !plans.some((pl) => !pl.receipt && pl.undecided.n > 0n)) return () => [] as SharePart[];
    const heirIds = new Set(legalParts.map((lp) => lp.personId));
    let estate = ZERO;
    const got = new Map<string, Fraction>();
    const addGot = (id: string, v: Fraction) => {
      const g = add(got.get(id) ?? ZERO, v);
      got.set(id, g.n > 0n ? g : ZERO);
    };
    for (const pl of plans) {
      if (pl.receipt) continue;
      const V = frac(Math.max(0, pl.valuation.value));
      estate = add(estate, V);
      for (const p of pl.decided) {
        const v = mul(V, p.f);
        if (heirIds.has(p.personId)) addGot(p.personId, v);
        else estate = sub(estate, v);
      }
    }
    for (const x of compRows) {
      const v = frac(x.value);
      if (heirIds.has(x.fromId)) addGot(x.fromId, sub(ZERO, v));
      if (heirIds.has(x.toId)) addGot(x.toId, v);
    }
    for (const g of c.priorGifts) {
      if (!g.settlement || !heirIds.has(g.personId) || !isValidISODate(g.date) || g.date > deathDate) continue;
      const amount = Math.max(0, Math.floor(g.amount || 0));
      if (amount <= 0) continue;
      estate = add(estate, frac(amount));
      addGot(g.personId, frac(amount));
      if (!settlementAsShare.includes(g.personId)) settlementAsShare.push(g.personId);
    }
    const short = legalParts.map((lp) => {
      const e = sub(mul(estate, lp.f), got.get(lp.personId) ?? ZERO);
      return e.n > 0n ? e : ZERO;
    });
    const W = sum(short);
    const weights = W.n > 0n ? short.map((e) => div(e, W)) : legalParts.map((lp) => lp.f);
    return (u: Fraction) =>
      legalParts.flatMap((lp, i) => {
        const f = mul(u, weights[i]);
        return f.n > 0n ? [{ ...lp, f }] : [];
      });
  })();

  // 2回目：取得者ごとの価額と小規模宅地等の特例
  for (const pl of plans) {
    const { a, valuation } = pl;
    if (pl.receipt) {
      if (a.kind !== "insurance" && a.kind !== "retirement") continue;
      const m = a.kind === "insurance" ? insuranceBy : retirementBy;
      addTo(m, a.recipientId, valuation.value);
      assetLines.push({ asset: a, valuation, reduction: 0, byPerson: [{ personId: a.recipientId, amount: valuation.value }] });
      continue;
    }
    const { label, valid, rest } = pl;
    const parts: SharePart[] = pl.undecided.n > 0n ? [...pl.decided, ...undividedSplit(pl.undecided)] : pl.decided;
    const amounts = splitParts(valuation.value, parts, rest);
    const byPerson: { personId: string; amount: number }[] = [];
    const undivided: { personId: string; amount: number }[] = [];
    parts.forEach((p, i) => {
      const merge = (list: { personId: string; amount: number }[]) => {
        const e = list.find((b) => b.personId === p.personId);
        if (e) e.amount += amounts[i];
        else list.push({ personId: p.personId, amount: amounts[i] });
      };
      merge(byPerson);
      if (p.undivided) {
        merge(undivided);
        addTo(undividedBy, p.personId, amounts[i]);
      } else {
        addTo(dividedGross, p.personId, amounts[i]);
      }
    });
    const line: AssetLine = { asset: a, valuation, reduction: 0, byPerson, ...(undivided.length ? { undivided } : {}) };
    assetLines.push(line);
    if (undivided.length) undividedLabels.push(label);

    if (a.kind !== "land" && a.kind !== "condo") continue;
    const sr = a.smallResidential;
    if (!sr) continue;
    const kind = smallLandKind(a);
    // 特例を使う人：1人目（acquirerId）と、この土地を一緒に受け継いだ2人目以降（others）。
    // 1つの宅地を何人かで受け継いだときは、取得した人ごとに要件を見て、その人の持分に応ずる部分だけに使う（タックスアンサー No.4124）
    const users: { acquirerId: string; selectedSqm: unknown; first: boolean }[] = [];
    const named = new Set<string>();
    if (sr.acquirerId) {
      named.add(sr.acquirerId);
      const acquirer = c.persons.find((p) => p.id === sr.acquirerId && !p.predeceased);
      // 確認の質問に答えている場合は、保存された「適用する」ではなく今の答えと取得者で判定し直す（取得者を変えたときなど）
      const srOn = sr.check ? shouldApply(judgeSmallResidential(sr.check, acquirer, kind), sr.check) : sr.applies;
      if (srOn) users.push({ acquirerId: sr.acquirerId, selectedSqm: sr.selectedSqm, first: true });
    }
    for (const o of Array.isArray(sr.others) ? sr.others : []) {
      const id = o?.acquirerId;
      if (!id) continue; // まだ人を選んでいない行
      const who = c.persons.find((p) => p.id === id);
      if (!who) {
        // 相続人の画面で消した人など。その人の分は計算に入れない（止めはしない）
        warnings.push(`${label}の小規模宅地等の特例を一緒に使う人に、家族の一覧にいない人が入っているため、その人の分は計算に入れていません。土地の画面で選び直してください。`);
        continue;
      }
      if (named.has(id)) {
        warnings.push(`${label}の小規模宅地等の特例を使う人に、${personText(who)}が2回入っています。1回分だけ計算しています。`);
        continue;
      }
      named.add(id);
      // 土地についての答えは1人目の答え、人ごとの答えはその人の答えで判定する
      const merged = mergeAcquirerCheck(sr.check, o.check);
      if (shouldApply(judgeSmallResidential(merged, who.predeceased ? undefined : who, kind), merged)) users.push({ acquirerId: id, selectedSqm: o.selectedSqm, first: false });
    }
    if (!users.length) continue;
    // 1つの土地で2人以上を選んでいるときは、案内に人の名前を添える
    const several = named.size > 1;
    const whoText = (id: string) => personText(c.persons.find((p) => p.id === id));
    const undividedNames: string[] = [];
    let rentNoted = false;
    let areaMissing = false;
    for (const u of users) {
      // 特例は取得者が分け方で受け継ぐと決まった部分だけに使える（措置法69条の4第4項）
      const k = parts.findIndex((p) => p.personId === u.acquirerId && !p.undivided);
      if (k < 0) {
        if (parts.some((p) => p.personId === u.acquirerId && p.undivided)) undividedNames.push(whoText(u.acquirerId));
        else
          warnings.push(
            several ? `${label}の小規模宅地等の特例を使う${whoText(u.acquirerId)}が、この土地を取得していません。` : `${label}の小規模宅地等の特例の取得者が、この土地を取得していません。`,
          );
        continue;
      }
      const share = valid.find((s) => s.personId === u.acquirerId)!;
      const part = byPerson.find((b) => b.personId === u.acquirerId)!;
      let landPart = amounts[k];
      let fullArea: number;
      if (a.kind === "condo") {
        // マンションは敷地利用権部分だけが特例の対象
        const landOnly = valueAsset({ ...a, buildingFixedAssetValue: 0 }).value;
        landPart = Number((BigInt(landPart) * BigInt(Math.max(0, landOnly))) / BigInt(Math.max(1, valuation.value)));
        fullArea = sr.landShareSqm ?? a.landShareSqm;
      } else {
        fullArea = a.areaSqm;
      }
      // ③ 取得者の持分に応ずる宅地等の面積
      let area = (fullArea * share.numerator) / share.denominator;
      // 貸付事業用：空室（一時的なものを除く）の部分は貸付事業に使っていないので対象外（措置法通達69の4-24の2）。
      // 貸している部分の面積＝面積×賃貸割合（0.01㎡未満切捨て）。価額は、全体の評価額を面積で割るのではなく、
      // 貸している部分だけを貸家建付地（貸家建付借地権）として評価した額（valuation.rentedLandPart）×取得者の持分
      // （国税庁 情報「貸家建付地等の一部が空室の場合」の設例：空いている部分は自用地として評価し、特例の対象にしない）
      const rent4 =
        kind === "rental" && (a.kind === "condo" || a.use === "rentedHouse" || a.use === "rentedLeasehold") ? ratio4(a.rentRatio ?? 1) : 10000;
      if (rent4 > 0 && rent4 < 10000 && area > 0) {
        const area100 = Math.round(area * 100);
        const rented100 = Number((BigInt(area100) * BigInt(rent4)) / 10000n);
        const rentedLand = valuation.rentedLandPart;
        landPart =
          rentedLand !== undefined && Number.isSafeInteger(rentedLand)
            ? Number((BigInt(Math.max(0, rentedLand)) * BigInt(share.numerator)) / BigInt(share.denominator))
            : // 貸している部分の評価額が分からないとき（ふつうは起きない）は、これまでどおり面積の割合で分ける
              Number((BigInt(Math.max(0, landPart)) * BigInt(rented100)) / BigInt(area100));
        area = rented100 / 100;
        if (!rentNoted) {
          warnings.push(
            `${label}は空き部屋があるため、小規模宅地等の特例（貸付事業用）は貸している部分（面積の${ratioText(rent4)}）だけに使っています（空いている部分は、貸していない土地として評価します）。`,
          );
        }
        rentNoted = true;
      }
      if (!(area > 0)) {
        // 面積が分からないと、限度面積までの減額を計算できない
        if (!areaMissing) blockers.push(`「${a.label || "名称未入力の土地"}」に小規模宅地等の特例を使うには、${a.kind === "condo" ? "敷地権の面積" : "地積"}を入れてください。`);
        areaMissing = true;
        continue;
      }
      const area100 = Math.round(area * 100);
      // ⑤ 特例を使う面積の上限（その人が選んだ面積）。受け継いだ面積（③）より大きければ③まで使う
      let cap100 = area100;
      if (u.selectedSqm !== undefined && u.selectedSqm !== null) {
        const v = u.selectedSqm;
        const v100 = typeof v === "number" && Number.isFinite(v) ? Math.floor(v * 100 + 1e-6) : NaN;
        if (!(v100 > 0)) {
          blockers.push(
            `${label}で${whoText(u.acquirerId)}が小規模宅地等の特例を使う面積が正しくありません。0より大きい面積（㎡）を入れるか、空けてください（空けると、使えるだけ使います）。`,
          );
          continue;
        }
        cap100 = Math.min(area100, v100);
      }
      srCandidates.push({
        line,
        part,
        landPart,
        area,
        area100,
        cap100,
        acquirerId: u.acquirerId,
        kind,
        first: u.first,
        label: several ? `${label}（${whoText(u.acquirerId)}の分）` : label,
      });
    }
    if (undividedNames.length) {
      warnings.push(
        `${several ? `${label}（${undividedNames.join("・")}の分）` : label}は分け方が決まっていないため、小規模宅地等の特例を使わずに計算しています（特例は、受け継ぐ人が決まった宅地だけに使えます）。申告書と一緒に「申告期限後3年以内の分割見込書」を出しておけば、分け方が決まった日の翌日から4か月以内に「更正の請求」をして、特例を使えます。`,
      );
    }
  }

  // 限度面積（措置法69条の4第2項）を、srOrder の順に、なければ既定の順に割り当てる。土地と取得する人の組ごとに、その人の上限（cap100）まで
  const srSlots: SrSlot[] = srCandidates.map((x) => ({
    kind: x.kind,
    area100: x.area100,
    cap100: x.cap100,
    value: x.landPart,
    spouse: c.persons.find((p) => p.id === x.acquirerId)?.relation === "spouse",
  }));
  const srOrdered = srOrder ?? defaultSrOrder(srSlots);
  const selected = fillSmallLand(srSlots, srOrdered);
  // 付表1の明細と減額（⑥ ＝ ④ × ⑤ ／ ③）。1人目は line.small、2人目以降は line.smallExtra（others の順）に入れ、
  // 土地の減額（reduction）はその合計。各人の取得価額からは、その人の減額だけを引く
  srCandidates.forEach((x, i) => {
    if (!(x.landPart > 0) || !(x.cap100 > 0) || selected[i] <= 0) return;
    const rule = SMALL_LAND_RULE[x.kind];
    const sel = smallResidentialSelection(x.landPart, x.area, selected[i] / 100, rule.rate);
    const detail: SmallResidentialDetail = {
      acquirerId: x.acquirerId,
      kind: x.kind,
      rate: rule.rate,
      area: x.area,
      value: x.landPart,
      selectedArea: sel.selectedArea,
      selectedValue: sel.selectedValue,
    };
    x.line.reduction += sel.reduction;
    if (x.first) x.line.small = detail;
    else (x.line.smallExtra ??= []).push(detail);
    x.part.amount -= sel.reduction;
  });
  const srUsed: string[] = [];
  const srSkipped: string[] = [];
  for (const i of srOrdered) {
    const x = srCandidates[i];
    if (!(x.landPart > 0) || !(x.cap100 > 0)) continue;
    if (selected[i] <= 0) srSkipped.push(x.label);
    else srUsed.push(selected[i] < x.cap100 ? `${x.label}は残り${sqmText(selected[i])}㎡分` : `${x.label}に${sqmText(selected[i])}㎡`);
  }
  const srLive = srCandidates.filter((x) => x.landPart > 0 && x.cap100 > 0);
  if (srLive.length > 1 && srBinds(srSlots)) {
    // 1つの土地を2人以上で使うときは、どの人の分に割り当てるかも選べる
    const sharedLot = new Set(srLive.map((x) => x.line)).size < srLive.length;
    warnings.push(
      `${smallLandLimitText(new Set(srLive.map((x) => x.kind)))}${srOrder ? "家族全体で納める相続税がいちばん少なくなるように" : srLive.every((x) => x.kind === "residence") ? "1㎡あたりの価額が高い土地から順に" : "減額できる額が大きい土地から順に"}、${srUsed.join("、")}を割り当てています${srSkipped.length ? `（${srSkipped.join("・")}には適用していません）` : ""}。どの土地${sharedLot ? "（どの人の分）" : ""}に割り当てるかは受け継ぐ人全員の合意で選べるので、別の割り当てにしたいときは税理士にご相談ください。`,
    );
  } else if (srLive.length === 1 && srLive[0].cap100 > SMALL_LAND_RULE[srLive[0].kind].limitSqm * 100) {
    const x = srLive[0];
    const limit = SMALL_LAND_RULE[x.kind].limitSqm;
    warnings.push(
      x.kind === "residence"
        ? `小規模宅地等の特例は330㎡までのため、${x.label}は330㎡分だけ適用しています。`
        : `小規模宅地等の特例は、${SMALL_LAND_KIND_TEXT[x.kind]}では${limit}㎡までのため、${x.label}は${limit}㎡分だけ適用しています。`,
    );
  }

  // 債務・葬式費用は、負担する人ごとの金額の合計が債務の額と一致するまで確定しない。
  // 分け方が決まっていない（未分割）ときに負担する人を入れていない債務は、法定相続分で負担したものとする（相基通13-3）
  const bearersOf = new Map<Debt, { personId: string; amount: number }[]>();
  /** 法定相続分で負担したものとした債務（第13表の②⑤「負担することが確定していない」） */
  const unsettledDebts = new Set<Debt>();
  const debtsByLegal: string[] = [];
  /** 未分割なのに、負担する人を全額入れてある債務（債務の画面で先に入れると、はじめの人が全額を負担する形で入る） */
  const debtsByInput: string[] = [];
  for (const d of c.debts) {
    const borne = d.bearers.reduce((acc, b) => acc + b.amount, 0);
    if (c.undivided && borne === 0 && d.amount > 0 && legalParts.length > 0) {
      const amounts = splitParts(d.amount, legalParts, "largest");
      bearersOf.set(d, legalParts.map((p, i) => ({ personId: p.personId, amount: amounts[i] })));
      unsettledDebts.add(d);
      debtsByLegal.push(`「${d.label || (d.kind === "debt" ? "債務" : "葬式費用")}」`);
      continue;
    }
    if (c.undivided && d.kind === "debt" && d.amount > 0 && borne === d.amount) debtsByInput.push(`「${d.label || "債務"}」`);
    bearersOf.set(d, d.bearers);
    if (borne !== d.amount) {
      blockers.push(`「${d.label || (d.kind === "debt" ? "債務" : "葬式費用")}」の負担する人ごとの金額の合計（${borne.toLocaleString()}円）が、金額（${d.amount.toLocaleString()}円）と一致していません。`);
    }
    if (d.bearers.some((b) => b.amount > 0 && !living.has(b.personId))) {
      blockers.push(`「${d.label || "債務"}」を負担する人が、相続人の一覧にいません。`);
    }
  }
  if (debtsByLegal.length) {
    warnings.push(`${debtsByLegal.join("・")}は負担する人が決まっていないため、法定相続分で負担したものとして計算しています。`);
  }
  if (debtsByInput.length) {
    warnings.push(
      `「分け方がまだ決まっていない」にチェックがありますが、${debtsByInput.join("・")}は入力した人が負担するものとして計算しています。負担する人がまだ決まっていなければ、債務・葬式費用の画面で負担する人を×で外してください（法定相続分で計算します）。`,
    );
  }

  const insuranceExemptLimit = INSURANCE_EXEMPT_PER_HEIR * legalHeirCount;
  const retirementExemptLimit = INSURANCE_EXEMPT_PER_HEIR * legalHeirCount;
  const insEx = allocateExempt(insuranceExemptLimit, insuranceBy, civil);
  const retEx = allocateExempt(retirementExemptLimit, retirementBy, civil);

  for (const [id, out] of compOut) {
    const name = nameOf(id);
    const divided = dividedGross.get(id) ?? 0;
    if (divided <= 0) {
      // 代償分割は、遺産を受け継ぐ人が、その代わりにほかの相続人にお金などを払う分け方。遺産を受け継がない人が払うお金は代償金にならない
      blockers.push(
        `${name}さんは遺産の分け方で財産を受け継いでいないため、代償金を払う人にはなれません（遺産を受け継がない人が払うお金は、贈与として扱われることがあります）。払う人と遺産の分け方を確かめ、分からないときは税理士にご相談ください。`,
      );
      continue;
    }
    // 払う人が相続・遺贈で受け取る財産（分け方で受け継ぐ財産と、保険金・退職金の非課税の分を除いた額）より多い代償金は、自分の財産から払うことになる
    const receipts = (insuranceBy.get(id) ?? 0) - (insEx.get(id) ?? 0) + (retirementBy.get(id) ?? 0) - (retEx.get(id) ?? 0);
    const own = divided + Math.max(0, receipts);
    if (own < out) {
      blockers.push(
        `${name}さんが払う代償金の合計（${yenText(out)}）が、${name}さんが受け継ぐ財産の評価額（${yenText(own)}${receipts > 0 ? "。保険金・退職金は非課税の分を除いた額" : ""}）より多くなっています。代償金の額と遺産の分け方を確かめてください。代償金を土地などの時価をもとに決めたときは、遺産の分け方の画面で、もとにした財産とその時価を入れてください（評価額に直して計算します）。`,
      );
    }
  }

  // 生前贈与。暦年課税は相続開始前3年以内のもの（令和8年中の相続開始は加算期間3年）、
  // 相続時精算課税は期間に関係なくすべて（相続税法21条の15）
  const death = new Date(deathDate + "T00:00:00Z");
  const from = new Date(Date.UTC(death.getUTCFullYear() - 3, death.getUTCMonth(), death.getUTCDate()));
  const inWindow = (g: PriorGift) => {
    if (g.settlement || !isValidISODate(g.date)) return false;
    const d = new Date(g.date + "T00:00:00Z");
    return d >= from && d <= death;
  };
  const giftsInWindow = (personId: string) => c.priorGifts.filter((g) => g.personId === personId && inWindow(g));
  // 受け取った人や日付が分からない贈与は、計算から黙って落とさずに止める
  c.priorGifts.forEach((g, i) => {
    if (!(g.amount > 0) && !(g.giftTaxPaid > 0)) return;
    const what = `${g.settlement ? "相続時精算課税の贈与" : "亡くなる前3年以内の贈与"}（${i + 1}件目、${(g.amount || 0).toLocaleString()}円）`;
    const who = c.persons.find((p) => p.id === g.personId);
    if (!g.personId || !who) {
      blockers.push(`${what}を受け取った人が選ばれていません。債務・葬式費用の画面で受け取った人を選んでください。`);
    } else if (who.predeceased) {
      blockers.push(`${what}を受け取った${who.name || "人"}さんは、亡くなった方より先に亡くなっています。この贈与は相続税の計算に足さないので、債務・葬式費用の画面でこの贈与を削除してください。`);
    }
    if (!isValidISODate(g.date)) {
      blockers.push(`${what}の贈与の日が入っていないか、正しい日付ではありません。債務・葬式費用の画面で贈与の日を入れてください。`);
    } else if (deathDate && g.date > deathDate) {
      blockers.push(`${what}の贈与の日が、亡くなった日より後になっています。贈与の日を確かめてください。`);
    } else if (g.settlement && g.date < "2003-01-01") {
      blockers.push(`${what}の贈与の日が平成15年（2003年）より前になっています。相続時精算課税は平成15年1月1日以後の贈与から選べる制度なので、贈与の日と「相続時精算課税」のチェックを確かめてください。`);
    }
  });
  // 相続時精算課税の贈与を、受け取った人ごと・年ごとに集める。令和6年以後の贈与は年110万円の基礎控除を引く
  const settleByYear = new Map<string, Map<number, number>>();
  const settleTax = new Map<string, number>();
  const settlementRecipients = new Set<string>();
  let settlementDeducted = false;
  for (const g of c.priorGifts) {
    if (!g.settlement || !living.has(g.personId) || !isValidISODate(g.date) || g.date > deathDate) continue;
    const amount = Math.max(0, Math.floor(g.amount || 0));
    const year = Number(g.date.slice(0, 4));
    if (amount > 0) {
      const m = settleByYear.get(g.personId) ?? new Map<number, number>();
      m.set(year, (m.get(year) ?? 0) + amount);
      settleByYear.set(g.personId, m);
      settlementRecipients.add(g.personId);
      if (year >= 2024) settlementDeducted = true;
    }
    addTo(settleTax, g.personId, Math.max(0, Math.floor(g.giftTaxPaid || 0)));
  }
  const oddGiftTax = c.priorGifts.flatMap((g, i) => (g.settlement && g.giftTaxPaid > 0 && g.giftTaxPaid % 100 !== 0 ? [i + 1] : []));
  if (oddGiftTax.length) {
    warnings.push(
      `相続時精算課税の贈与（${oddGiftTax.map((n) => `${n}件目`).join("・")}）の納めた贈与税が100円単位になっていません。贈与税は100円未満を切り捨てた額なので、贈与税の申告書の控えで確かめてください（100円未満を切り捨てて計算しています）。`,
    );
  }
  const settlementOf = (id: string) => {
    let total = 0;
    for (const [year, amount] of settleByYear.get(id) ?? []) total += year >= 2024 ? Math.max(0, amount - SETTLEMENT_ANNUAL_DEDUCTION) : amount;
    return total;
  };
  if (settlementDeducted) {
    warnings.push(
      "相続時精算課税の令和6年以後の贈与は、毎年110万円（基礎控除）を引いて相続税の計算に足しています。亡くなった方のほかにも相続時精算課税で贈与を受けた人（たとえば、もう1人の親）がいる年は、110万円をそれぞれからの贈与の額で分けるため金額が変わります。その場合は税理士にご相談ください。",
    );
  }

  const persons: PersonTax[] = c.persons
    .filter((p) => !p.predeceased)
    .map((p) => {
      const fromAssets = assetLines
        .filter((l) => l.asset.kind !== "insurance" && l.asset.kind !== "retirement")
        .reduce((acc, l) => acc + (l.byPerson.find((b) => b.personId === p.id)?.amount ?? 0), 0);
      const compensationIn = compIn.get(p.id) ?? 0;
      const compensationOut = compOut.get(p.id) ?? 0;
      const inherited = fromAssets + compensationIn - compensationOut;
      const undivided = undividedBy.get(p.id) ?? 0;
      const insurance = insuranceBy.get(p.id) ?? 0;
      const retirement = retirementBy.get(p.id) ?? 0;
      const insuranceExempt = insEx.get(p.id) ?? 0;
      const retirementExempt = retEx.get(p.id) ?? 0;
      const acquired = inherited + insurance - insuranceExempt + retirement - retirementExempt;
      const settlementGifts = settlementOf(p.id);
      let debtOnly = 0;
      let funeralOnly = 0;
      let debtsUnsettled = 0;
      let funeralUnsettled = 0;
      for (const d of c.debts) {
        const unsettled = unsettledDebts.has(d);
        for (const b of bearersOf.get(d) ?? []) {
          if (b.personId !== p.id) continue;
          if (d.kind === "debt") {
            debtOnly += b.amount;
            if (unsettled) debtsUnsettled += b.amount;
          } else {
            funeralOnly += b.amount;
            if (unsettled) funeralUnsettled += b.amount;
          }
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
          debtsUnsettled = 0;
        } else {
          blockers.push(
            `${p.name || "相続人でない人"}さんは相続人ではないため、負担した債務・葬式費用は差し引けません。遺言で財産の全部または「3分の1」などの割合で受け取る人（包括受遺者）なら差し引けますが、相続コンパスでは扱えないので税理士にご相談ください。そうでなければ、債務・葬式費用の画面で${p.name || "この方"}さんの負担分を、金額と負担する人から外してください。`,
          );
          debtOnly = 0;
          funeralOnly = 0;
          debtsUnsettled = 0;
          funeralUnsettled = 0;
        }
      }
      const debts = debtOnly + funeralOnly;
      const net = Math.max(0, acquired + settlementGifts - debts);
      // 相続時精算課税の贈与を受けた人は、相続や遺贈で何も受け取らなくても財産を取得したものとみなす（相続税法21条の16）
      const acquiresSomething =
        (dividedGross.get(p.id) ?? 0) > 0 || undivided > 0 || insurance > 0 || retirement > 0 || compensationIn > 0 || settlementRecipients.has(p.id);
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
        undivided,
        compensationIn,
        compensationOut,
        insurance,
        insuranceExempt,
        retirement,
        retirementExempt,
        acquired,
        settlementGifts,
        debts,
        debtOnly,
        funeralOnly,
        debtsUnsettled,
        funeralUnsettled,
        net,
        acquiresSomething,
        age: ageAt(p.birthDate, deathDate),
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
        // ⑰は100円未満を切り捨てた額（国税通則法119条。申告書の欄も下2桁が00で印刷されている）。⑲・㉑・㉒もこの額から計算する
        settlementCredit: floor100(settleTax.get(p.id) ?? 0),
        payable: 0,
        refund: 0,
      } satisfies PersonTax;
    })
    .filter(
      (pt) =>
        pt.acquired !== 0 || pt.settlementGifts > 0 || pt.taxable > 0 || pt.debts > 0 || pt.isLegalHeir || pt.acquiresSomething || pt.settlementCredit > 0 || pt.compensationOut > 0,
    );

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
    const fracPart = (scaled % unit).toString().padStart(digits, "0");
    p.ratioText = trimRatio(`${intPart}.${fracPart}`);
    // 算出税額＝相続税の総額×按分割合（1円未満切捨て）。浮動小数点を使わず整数で計算
    p.computed = Number((BigInt(totalTax) * scaled) / unit);
    // 2割加算：代襲相続人かどうかは、実際に代襲が起きたか（民法上の相続人の判定）で決める
    p.surcharge = isSurchargeTarget(p.person, heirsCivil.substitutes) && p.computed > 0 ? Math.floor(p.computed / 5) : 0;
    // 暦年課税分の贈与税額控除（相続時精算課税の贈与税は⑰で引く）
    const credit = p.gifts > 0 ? giftsInWindow(p.person.id).reduce((a, g) => a + g.giftTaxPaid, 0) : 0;
    p.giftTaxCredit = Math.min(credit, p.computed + p.surcharge);
  });

  // 配偶者の税額軽減（第5表）。未分割の財産は配偶者の課税価格に含めない（相続税法19条の2第2項）
  let spouse: SpouseDetail | undefined;
  const sp = persons.find((p) => p.person.relation === "spouse");
  if (sp && totalTaxable > 0) {
    const legalShare = heirsTax.byPerson.get(sp.person.id) ?? frac(0);
    // 課税価格の合計額×配偶者の法定相続分（相続税法19条の2第1項2号イ）。1,000円単位には切り捨てない
    const legalShareAmount = Math.max(SPOUSE_FLOOR, mulYen(totalTaxable, legalShare));
    const divided = sp.acquired - sp.undivided + sp.settlementGifts;
    const debtsOverUndivided = Math.max(0, sp.debts - sp.undivided);
    // 未分割の財産がなければ、配偶者の課税価格と同じになる
    const spouseTaxable = Math.max(floor1000(divided - debtsOverUndivided + sp.gifts), floor1000(sp.gifts));
    const base = Math.min(legalShareAmount, spouseTaxable);
    const creditBase = Number((BigInt(totalTax) * BigInt(base)) / BigInt(totalTaxable));
    const limit = Math.max(0, sp.computed + sp.surcharge - sp.giftTaxCredit);
    const credit = Math.min(creditBase, limit);
    sp.spouseCredit = credit;
    spouse = {
      totalTaxable,
      legalShareAmount,
      divided,
      debts: sp.debts,
      undivided: sp.undivided,
      debtsOverUndivided,
      gifts: sp.gifts,
      spouseTaxable,
      base,
      creditBase,
      limit,
      credit,
    };
  }

  // ⑫⑬のあとに残る相続税額。未成年者控除・障害者控除・扶養義務者からの控除・相次相続控除の上限
  const rem = new Map<PersonTax, number>();
  for (const p of persons) {
    p.beforeOtherCredits = Math.max(0, p.computed + p.surcharge - p.giftTaxCredit - p.spouseCredit);
    rem.set(p, p.beforeOtherCredits);
  }
  // 未成年者控除・障害者控除（第6表）。相続や遺贈で財産を受け取った法定相続人だけが対象（相続税法19条の3・19条の4）
  const eligible = (p: PersonTax) => p.isLegalHeir && p.acquiresSomething && p.age !== undefined;
  const ownCredit = (p: PersonTax, full: number) => {
    const use = Math.min(full, rem.get(p)!);
    rem.set(p, rem.get(p)! - use);
    return use;
  };
  // 本人から引ききれない分は、同じ相続で財産を受け取った扶養義務者の相続税額から引く（19条の3第2項・19条の4第3項）。
  // 扶養義務者は続柄から確かに言える人だけにする（isSupporter）。
  // 扶養義務者が2人以上なら、話し合いがなければ相続税額の割合で分ける（施行令4条の3）。端数はまず切り捨て、残りの1円ずつを家族の一覧の順に配る
  const transferred: {
    from: PersonTax;
    kind: "minor" | "disability";
    excess: number;
    used: number;
    to: PersonTax[];
    othersLeft: boolean;
    /** othersLeft のうち、続柄を「その他」で入れた人（もう1人の親など、扶養義務者かもしれない） */
    otherRelation: PersonTax[];
  }[] = [];
  const transfer = (from: PersonTax, kind: "minor" | "disability", excess: number) => {
    const pool = persons.filter((q) => q !== from && isSupporter(from.person, q.person) && rem.get(q)! > 0);
    const total = pool.reduce((a, q) => a + rem.get(q)!, 0);
    const give = pool.map((q) => (total <= excess ? rem.get(q)! : Number((BigInt(excess) * BigInt(rem.get(q)!)) / BigInt(total))));
    if (total > excess) {
      let left = excess - give.reduce((a, b) => a + b, 0);
      while (left > 0) {
        let moved = false;
        pool.forEach((q, i) => {
          if (left > 0 && rem.get(q)! - give[i] > 0) {
            give[i]++;
            left--;
            moved = true;
          }
        });
        if (!moved) break;
      }
    }
    const to: PersonTax[] = [];
    pool.forEach((q, i) => {
      if (give[i] <= 0) return;
      q.transfersIn.push({ fromId: from.person.id, kind, amount: give[i] });
      rem.set(q, rem.get(q)! - give[i]);
      to.push(q);
    });
    // 扶養義務者と確かめられない人（おじ・おば、「その他」で入れた人など）で、まだ相続税が残っている人がいるか
    const left = persons.filter((q) => q !== from && !pool.includes(q) && rem.get(q)! > 0);
    transferred.push({
      from,
      kind,
      excess,
      used: give.reduce((a, b) => a + b, 0),
      to,
      othersLeft: left.length > 0,
      otherRelation: left.filter((q) => q.person.relation === "other"),
    });
  };
  // 以前の相続でも同じ控除を受けた人は、限度額（ふつうは最初の相続のときに受けられた額）から、これまでに受けた額（扶養義務者が引いた分を含む）を引いた残りが限度
  // （相続税法19条の3第3項・19条の4第3項、相基通19の3-5・19の4-4）
  const priorLimit = (p: PersonTax, kind: "minor" | "disability", normal: number): number => {
    const pc = kind === "minor" ? p.person.priorMinorCredit : p.person.priorDisabilityCredit;
    if (!pc) return normal;
    const name = p.person.name || "この方";
    const what = kind === "minor" ? "未成年者控除" : "障害者控除";
    const amountOk = typeof pc.amount === "number" && Number.isFinite(pc.amount) && pc.amount >= 0;
    if (!isValidISODate(pc.date) || !amountOk) {
      blockers.push(
        `${name}さんは以前の相続でも${what}を受けているため、今回の${what}が少なくなることがあります。計算には、最初に${what}を受けた相続が始まった日（前に亡くなった方が亡くなった日）と、これまでに受けた${what}の合計額（扶養義務者の相続税から引いた分を含む）が必要です。前の相続の申告書の控えを見て、相続人の画面で入れてください。`,
      );
      return normal;
    }
    if (!(pc.date! < deathDate)) {
      blockers.push(`${name}さんが最初に${what}を受けた相続の日が、今回亡くなった日より前になっていません。相続人の画面で日付を確かめてください。`);
      return normal;
    }
    const X = ageAt(p.person.birthDate, pc.date!) ?? 0;
    const A = Math.floor(pc.amount!);
    let limit: number;
    let how: string;
    if (kind === "minor") {
      // 今回の相続が令和4年4月1日以後なら、最初の相続のときから18歳になるまでの年数（それより前の相続なら20歳）で数える（相基通19の3-5（注））
      const adult = deathDate < "2022-04-01" ? 20 : 18;
      limit = Math.max(0, adult - X) * 100_000;
      how = `最初の相続のときの年齢から${adult}歳までの年数×10万円`;
    } else {
      // 区分（一般・特別）は最初の相続のときのもの（pc.special。入っていなければ今と同じとする）
      const nowSpecial = p.person.disability === "special";
      const thenSpecial = pc.special ?? nowSpecial;
      const Y = p.age ?? X;
      if (!thenSpecial && nowSpecial) {
        // 前は一般障害者、今は特別障害者：{20万円×(85−Y)＋10万円×(Y−X)}（相基通19の4-4）
        limit = Math.max(0, 85 - Y) * 200_000 + Math.max(0, Math.min(Y, 85) - X) * 100_000;
        how = "最初の相続のときは一般障害者だったため、今の年齢から85歳までの年数×20万円と、最初の相続から今回までの年数×10万円の合計";
      } else {
        // 区分が同じとき、前は特別障害者で今は一般障害者のときは、最初の相続のときに受けられた額（相続税法19条の4第3項で準用する19条の3第3項）
        limit = Math.max(0, 85 - X) * (thenSpecial ? 200_000 : 100_000);
        how = `${thenSpecial !== nowSpecial ? "最初の相続のときは特別障害者だったため、" : ""}最初の相続のときの年齢から85歳までの年数×${thenSpecial ? 20 : 10}万円${pc.special === undefined ? "。最初の相続のときも今と同じ区分だったものとしています" : ""}`;
      }
      if (A > limit) {
        // 障害者控除は、最初の相続のときの区分で受けられた額より多くは受けられない。日付・金額・区分のどれかが違う
        blockers.push(
          `${name}さんがこれまでに受けた障害者控除の合計（${yenText(A)}）が、限度額の${yenText(limit)}（${how}）より多くなっています。相続人の画面で、最初に障害者控除を受けた相続の日、そのときの区分（一般・特別）、これまでに受けた額を確かめてください。`,
        );
        return 0;
      }
    }
    const left = Math.max(0, limit - A);
    if (left < normal) {
      warnings.push(
        A > limit
          ? `${name}さんは以前の相続でも${what}を受けていて、これまでに受けた${yenText(A)}が限度額の${yenText(limit)}（${how}）より多いため、今回の${what}は0円にしています。`
          : `${name}さんは以前の相続でも${what}を受けているため、今回の${what}は、限度額の${yenText(limit)}（${how}）から、これまでに受けた${yenText(A)}を引いた${yenText(left)}までにしています。`,
      );
    }
    return Math.min(normal, left);
  };
  for (const p of persons) {
    if (eligible(p) && p.age! < 18) {
      const full = priorLimit(p, "minor", (18 - p.age!) * 100_000);
      p.minorCredit = ownCredit(p, full);
      p.minorExcess = full - p.minorCredit;
    }
  }
  for (const p of persons) if (p.minorExcess > 0) transfer(p, "minor", p.minorExcess);
  for (const p of persons) {
    if (eligible(p) && p.person.disability && p.person.disability !== "none" && p.age! < 85) {
      const full = priorLimit(p, "disability", (85 - p.age!) * (p.person.disability === "special" ? 200_000 : 100_000));
      p.disabilityCredit = ownCredit(p, full);
      p.disabilityExcess = full - p.disabilityCredit;
    }
  }
  for (const p of persons) if (p.disabilityExcess > 0) transfer(p, "disability", p.disabilityExcess);
  for (const t of transferred) {
    const name = t.from.person.name || "この方";
    const what = t.kind === "minor" ? "未成年者控除" : "障害者控除";
    if (t.used > 0) {
      // 配偶者と子・代襲相続人のあいだで移すときは、配偶者がその子の親（代襲相続人の祖父母）だとしている
      const spouseAssumed = [t.from, ...t.to].some((q) => q.person.relation === "spouse") && [t.from, ...t.to].some((q) => isDescendant(q.person));
      // 亡くなった方の父母どうしで移すときは、2人が夫婦だとしている
      const parentsAssumed = t.from.person.relation === "parent" && t.to.some((q) => q.person.relation === "parent");
      warnings.push(
        `${name}さんの${what}のうち、${name}さんの相続税から引ききれない${yenText(t.used)}を、扶養義務者（配偶者・親子・祖父母と孫・兄弟姉妹で、同じ相続で財産を受け取った人）の${t.to.map((q) => `${q.person.name || "家族"}さん`).join("・")}の相続税から引いています。2人以上から引くときは相続税額の割合で分けていますが、扶養義務者どうしで話し合って別の分け方にすることもできます。${spouseAssumed ? "配偶者は、亡くなった方の子の親（代襲相続人の祖父母）として数えています。違うときは税理士にご相談ください。" : ""}${parentsAssumed ? "父母の2人は夫婦として数えています。離婚しているときなど、違うときは税理士にご相談ください。" : ""}`,
      );
    }
    if (t.excess > t.used) {
      const others = t.otherRelation.map((q) => `${q.person.name || "家族"}さん`).join("・");
      warnings.push(
        t.othersLeft
          ? `${name}さんの${what}のうち${yenText(t.excess - t.used)}は、続柄から扶養義務者と分かる家族の相続税からは引ききれません。${others ? `${others}が${name}さんの父母・祖父母・兄弟姉妹・配偶者なら（たとえば「その他」で入れたもう1人の親）、扶養義務者なので、その人の相続税からも引けます。` : ""}${name}さんと生計を一にしていた3親等内の親族（おじ・おば、配偶者の兄弟姉妹など）が財産を受け取っていれば、その人の相続税からも引ける場合があります。相続コンパスでは計算していないので、税理士にご相談ください。`
          : `${name}さんの${what}のうち${yenText(t.excess - t.used)}は引ききれません。ほかに相続税を納める家族がいないため、この分は使われません。`,
      );
    }
  }

  // 相次相続控除（相続税法20条・第7表）：A × C/(B−A)（1が上限） × (10−E)/10 を、相続人の純資産価額の割合で分ける
  let successive: SuccessiveDetail | undefined;
  if (prior) {
    const years = ageAt(prior.date, deathDate) ?? 0;
    if (years >= 10) {
      warnings.push("前の相続から10年以上たっているため、相次相続控除は使えません。亡くなった方の画面で「10年以内の相続で相続税を納めていた」を確かめてください。");
    } else {
      const C = persons.reduce((a, p) => a + p.net, 0);
      const A = BigInt(prior.prevTax);
      const BA = BigInt(prior.prevAcquired - prior.prevTax);
      const CC = BigInt(C);
      const left = BigInt(10 - years);
      const total = Number(BA <= 0n || CC >= BA ? (A * left) / 10n : (A * CC * left) / (BA * 10n));
      successive = { prevTax: prior.prevTax, prevAcquired: prior.prevAcquired, netTotal: C, years, total };
      if (C > 0) {
        for (const p of persons) {
          if (!civil.has(p.person.id) || p.net <= 0) continue;
          const share = Number((BigInt(total) * BigInt(p.net)) / CC);
          p.successiveCredit = ownCredit(p, share);
        }
      }
    }
  }

  // ⑭〜⑯、⑰ 相続時精算課税分の贈与税額控除（引ききれない分は還付：相続税法33条の2）
  for (const p of persons) {
    const transfersIn = p.transfersIn.reduce((a, t) => a + t.amount, 0);
    p.otherCredits = p.minorCredit + p.disabilityCredit + transfersIn + p.successiveCredit;
    p.totalCredits = p.giftTaxCredit + p.spouseCredit + p.otherCredits;
    p.afterCredits = Math.max(0, p.computed + p.surcharge - p.totalCredits);
    const diff = p.afterCredits - p.settlementCredit;
    p.payable = diff >= 0 ? floor100(diff) : 0;
    p.refund = diff >= 0 ? 0 : -diff;
  }
  // 課税価格が同じでも、納める税額が端数だけで少し違うことがある：按分割合は合計がちょうど1になるよう端数を誰かに寄せ（相基通17-1）、
  // 各人の税額は100円未満を切り捨てる（国税通則法119条）。切り捨てる前の差が100円未満なのに納める額が違うときだけ、理由を知らせる
  const sameTaxable = new Map<number, PersonTax[]>();
  for (const p of persons) {
    if (p.taxable <= 0 || p.afterCredits < p.settlementCredit) continue;
    sameTaxable.set(p.taxable, [...(sameTaxable.get(p.taxable) ?? []), p]);
  }
  for (const group of sameTaxable.values()) {
    if (group.length < 2) continue;
    const pays = group.map((p) => p.payable);
    const pre = group.map((p) => p.afterCredits - p.settlementCredit);
    if (Math.max(...pays) === Math.min(...pays) || Math.max(...pre) - Math.min(...pre) >= 100) continue;
    warnings.push(
      `${group.map((p) => personText(p.person)).join("・")}は課税価格が同じですが、納める相続税が${yenText(Math.max(...pays) - Math.min(...pays))}違います。各人の割合（按分割合）は、合計がちょうど1になるように小さな端数をどなたかに寄せ（相続税法基本通達17-1）、そのうえで各人の税額の100円未満を切り捨てるため、このような差が出ます。計算の誤りではありません。`,
    );
  }

  const totalPayable = persons.reduce((a, p) => a + p.payable, 0);
  const totalRefund = persons.reduce((a, p) => a + p.refund, 0);
  const totalReduction = assetLines.reduce((a, l) => a + l.reduction, 0);
  const undividedAny = undividedLabels.length > 0;
  if (undividedAny) {
    const someDecided = plans.some((pl) => !pl.receipt && pl.decided.length > 0);
    warnings.push(
      `分け方が決まっていない財産（${undividedLabels.join("・")}）は、民法の法定相続分で受け継いだものとして計算しています${someDecided ? "（すでに分け方が決まった財産も合わせて法定相続分になるように、足りない人に割り当てています）" : ""}。生前に結婚や家を建てる資金などの贈与を受けた相続人がいる場合や、遺言で相続分が決められている場合は計算が変わるため、税理士に確認してください。この部分には、配偶者の税額軽減と小規模宅地等の特例は使えません。申告書と一緒に「申告期限後3年以内の分割見込書」を出しておけば、3年以内に分け方が決まったとき、その日の翌日から4か月以内に「更正の請求」をして、これらを使い、納めすぎた相続税を返してもらえます。`,
    );
    const gifted = legalParts.filter((lp) => settlementAsShare.includes(lp.personId)).map((lp) => `${nameOf(lp.personId)}さん`);
    if (gifted.length) {
      warnings.push(
        `相続時精算課税で贈与を受けた人（${gifted.join("・")}）は、その贈与も受け取ったものとして未分割の財産を分けています（国税庁の質疑応答による）。その贈与が結婚・養子縁組・生計の資本（住宅資金など）のためでないときや、遺言で別の定めがあるときは計算が変わるため、税理士にご相談ください。`,
      );
    }
  } else if (c.undivided && plans.some((pl) => !pl.receipt)) {
    // 「分け方がまだ決まっていない」にチェックがあるのに、全部の財産に分け方が入っている（「すべて法定相続分どおりに分けると決めた」を押したなど）
    warnings.push(
      "「分け方がまだ決まっていない」にチェックがありますが、すべての財産の分け方が入っているため、分け方が決まったものとして計算しています。まだ決まっていない財産は、遺産の分け方の画面で分け方を空けておいてください。",
    );
  }
  const needsFiling = totalTaxable > basicDeduction;
  // 特例適用前の課税価格が基礎控除を超える場合は、特例を受けるために申告が必要
  const needsFilingForRelief = !needsFiling && totalTaxable + totalReduction > basicDeduction;
  if (!needsFiling) {
    warnings.push(
      totalRefund > 0
        ? "課税価格の合計額が基礎控除額以下のため、相続税はかかりません。ただし、相続時精算課税で納めた贈与税を返してもらうには、相続税の申告書を出す必要があります。"
        : "課税価格の合計額が基礎控除額以下のため、相続税の申告は原則不要です（特例の適用で申告が必要な場合を除く）。",
    );
  } else if (totalPayable === 0 && spouse && spouse.credit > 0) {
    warnings.push("配偶者の税額軽減により納付税額は0円ですが、軽減を受けるためには申告書の提出が必要です。");
  }
  if (needsFiling && totalRefund > 0) {
    warnings.push("相続時精算課税で納めた贈与税のうち、相続税から引ききれない分は、申告すると返してもらえます（還付）。");
  }
  if (needsFilingForRelief) {
    warnings.push("小規模宅地等の特例を適用して基礎控除以下になっています。特例を受けるには申告書の提出が必要です。");
  }

  // 数次相続：あとから亡くなった人を「先に亡くなった人」として扱うと、取得者・受取人・贈与などの案内が食い違うため、数次相続の案内だけを出す
  if (laterDeaths.length) blockers.splice(0, blockers.length, ...laterDeaths);

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
    totalRefund,
    undivided: undividedAny,
    successive,
    compensation,
    insuranceExemptLimit,
    retirementExemptLimit,
    blockers,
    warnings,
    // 相続時精算課税の贈与税の還付も、申告書を出さないと受けられない（相続税法33条の2）
    needsFiling: needsFiling || needsFilingForRelief || totalRefund > 0,
  };
  return { result, sr: srSlots };
}

/** 小規模宅地等の特例の種類の、ふだんのことばでの言い方 */
const SMALL_LAND_KIND_TEXT: Record<SmallLandKind, string> = {
  residence: "自宅の敷地（特定居住用宅地等）",
  business: "亡くなった方が事業に使っていた土地（特定事業用宅地等）",
  rental: "人に貸していた土地（貸付事業用宅地等）",
};

/** 限度面積の説明（措置法69条の4第2項）。選んだ種類によって変わる */
function smallLandLimitText(kinds: Set<SmallLandKind>): string {
  if (kinds.size === 1 && kinds.has("residence")) return "小規模宅地等の特例は合計330㎡までです。";
  if (kinds.size === 1) {
    const k = [...kinds][0];
    return `小規模宅地等の特例は、${SMALL_LAND_KIND_TEXT[k]}では合計${SMALL_LAND_RULE[k].limitSqm}㎡までです。`;
  }
  if (!kinds.has("rental")) return "小規模宅地等の特例は、自宅の敷地は合計330㎡まで、亡くなった方が事業に使っていた土地は合計400㎡までです。";
  return "小規模宅地等の特例は、人に貸していた土地も選ぶときは、自宅の敷地は330㎡を200㎡、事業に使っていた土地は400㎡を200㎡として数え、人に貸していた土地と合わせて200㎡までです。";
}
