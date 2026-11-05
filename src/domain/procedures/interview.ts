/**
 * 最初の聞き取り（家族構成・財産のおおよその額・暮らしの状況）と、そこから分かること。
 * - 法定相続人の数は、相続人判定（heirs.ts）にそのまま渡して求める。
 * - 相続税がかかるかどうかは、基礎控除（相続税法15条）と比べた「目安」。正確な税額は相続税申告の画面で計算する。
 */
import { toNumber } from "../fraction";
import { determineHeirs, type HeirResult } from "../heirs";
import { floor1000 } from "../rounding";
import { BASIC_DEDUCTION_BASE, BASIC_DEDUCTION_PER_HEIR, INSURANCE_EXEMPT_PER_HEIR, progressiveTax } from "../tax/engine";
import type { Person } from "../types";

export type WillKind = "none" | "notarized" | "handwritten" | "handwrittenStored" | "unknown";
export type DebtLevel = "none" | "some" | "large" | "unknown";
export type Work = "pension" | "employee" | "selfEmployed" | "none";
/** 亡くなった方が受けていた年金（survivor＝遺族年金、unknown＝分からない。分からないときは厚生年金とみなして早いほうの期限で案内する） */
export type PensionKind = "none" | "national" | "employees" | "survivor" | "unknown";
export type HealthInsurance = "kokuho" | "kouki" | "shaho" | "unknown";

export interface Interview {
  deathDate: string;
  /** いまの状況（これから葬儀／葬儀は終わった／四十九日も終わった）。済んだ手続きの初期チェックに使う */
  stage: "" | "before" | "funeralDone" | "after49";
  decedentName: string;
  /** 亡くなった方の最後の住所（提出先の案内に使う） */
  address: string;
  /** 亡くなった方の最後の住所の郵便番号（相続税申告の「亡くなった方」にも引き継ぐ） */
  zip: string;
  /** あなたから見た亡くなった方（例：父・母・夫・妻）。窓口への連絡の文例に使う */
  myRelation: string;
  // 家族
  spouse: boolean;
  /** 子がいるか（""＝まだ答えていない。人数の欄から判断する） */
  hasChildren: "" | "yes" | "no";
  /** 子の人数（養子・前の配偶者との子・認知した子を含む。亡くなった方より後に亡くなった子も数える） */
  children: number;
  /** children のうち養子の人数（相続税の基礎控除では、実子がいれば1人・いなければ2人まで数える） */
  adoptedChildren: number;
  /** 前の配偶者との子や、認知した子がいる（相続分は他の子と同じ。連絡先を調べる案内を出す） */
  exSpouseChild: boolean;
  /** 先に亡くなった子がいる場合の、その子ども（孫）の人数 */
  grandchildrenOfPredeceased: number;
  parentsAlive: number;
  /** 両親とも亡くなっている場合の、ご存命の祖父母の人数 */
  grandparentsAlive: number;
  /** 兄弟姉妹がいるか（""＝まだ答えていない。人数の欄から判断する） */
  hasSiblings: "" | "yes" | "no";
  /** 両親が同じ兄弟姉妹（亡くなった方より後に亡くなった人も数える） */
  siblings: number;
  /** 父か母の一方だけが同じ兄弟姉妹（半血。相続分は両親が同じ兄弟姉妹の半分。民法900条4号） */
  halfSiblings: number;
  /** 先に亡くなった兄弟姉妹の子（甥・姪）の人数（兄弟姉妹の代襲は1代限り。民法889条2項） */
  nephewsOfPredeceased: number;
  minorHeir: boolean;
  heirAbroad: boolean;
  // 遺言・借金
  will: WillKind;
  debts: DebtLevel;
  // 財産（おおよその額・円）
  homeValue: number;
  /** 自宅を配偶者か同居の家族が相続する（小規模宅地等の特例の可能性） */
  /** 自宅を配偶者か同居の家族が受け継ぐか（"unknown"＝まだわからない。特例は見込まない） */
  homeToFamily: boolean | "unknown";
  otherRealEstate: number;
  deposits: number;
  securities: number;
  insurance: number;
  otherAssets: number;
  debtAmount: number;
  funeralCost: number;
  // 暮らし
  work: Work;
  pension: PensionKind;
  health: HealthInsurance;
  /** 亡くなった方が毎年確定申告をしていた（事業・不動産収入など） */
  filedTaxReturn: boolean;
  householdHead: boolean;
  rentedHome: boolean;
  car: boolean;
  highMedical: boolean;
  digital: boolean;
}

export const blankInterview = (): Interview => ({
  deathDate: "",
  stage: "",
  decedentName: "",
  address: "",
  zip: "",
  myRelation: "",
  spouse: false,
  hasChildren: "",
  children: 0,
  adoptedChildren: 0,
  exSpouseChild: false,
  grandchildrenOfPredeceased: 0,
  parentsAlive: 0,
  grandparentsAlive: 0,
  hasSiblings: "",
  siblings: 0,
  halfSiblings: 0,
  nephewsOfPredeceased: 0,
  minorHeir: false,
  heirAbroad: false,
  will: "unknown",
  debts: "unknown",
  homeValue: 0,
  homeToFamily: false,
  otherRealEstate: 0,
  deposits: 0,
  securities: 0,
  insurance: 0,
  otherAssets: 0,
  debtAmount: 0,
  funeralCost: 0,
  work: "pension",
  pension: "none",
  health: "unknown",
  filedTaxReturn: false,
  householdHead: false,
  rentedHome: false,
  car: false,
  highMedical: false,
  digital: true,
});

/**
 * 聞き取りの答えから、相続人判定に渡す家族の一覧を作る。
 * 誰が相続人になるか（子 → 親・祖父母 → 兄弟姉妹の順）は determineHeirs が決めるので、ここでは答えた人をそのまま並べる。
 * 「いない」と答えた欄は、前に入れた人数が残っていても数えない。
 */
export function familyFromInterview(iv: Interview): Person[] {
  const ps: Person[] = [];
  if (iv.spouse) ps.push({ id: "spouse", name: "配偶者", relation: "spouse" });
  if (iv.hasChildren !== "no") {
    const adopted = Math.min(iv.adoptedChildren ?? 0, iv.children);
    for (let i = 0; i < iv.children - adopted; i++) ps.push({ id: `c${i}`, name: `子${i + 1}`, relation: "child" });
    for (let i = 0; i < adopted; i++) ps.push({ id: `a${i}`, name: `養子${i + 1}`, relation: "adoptedChild" });
    if (iv.grandchildrenOfPredeceased > 0) {
      ps.push({ id: "pc", name: "先に亡くなった子", relation: "child", predeceased: true });
      for (let i = 0; i < iv.grandchildrenOfPredeceased; i++) ps.push({ id: `g${i}`, name: `孫${i + 1}`, relation: "grandchild", substituteOf: "pc" });
    }
  }
  for (let i = 0; i < iv.parentsAlive; i++) ps.push({ id: `p${i}`, name: i === 0 ? "父" : "母", relation: "parent" });
  if (iv.parentsAlive === 0) {
    for (let i = 0; i < (iv.grandparentsAlive ?? 0); i++) ps.push({ id: `gp${i}`, name: `祖父母${i + 1}`, relation: "grandparent" });
  }
  if (iv.hasSiblings !== "no") {
    for (let i = 0; i < iv.siblings; i++) ps.push({ id: `s${i}`, name: `兄弟姉妹${i + 1}`, relation: "sibling" });
    for (let i = 0; i < (iv.halfSiblings ?? 0); i++) ps.push({ id: `h${i}`, name: `兄弟姉妹（父母の一方のみ同じ）${i + 1}`, relation: "sibling", halfBlood: true });
    if ((iv.nephewsOfPredeceased ?? 0) > 0) {
      ps.push({ id: "ps", name: "先に亡くなった兄弟姉妹", relation: "sibling", predeceased: true });
      for (let i = 0; i < iv.nephewsOfPredeceased; i++) ps.push({ id: `n${i}`, name: `甥・姪${i + 1}`, relation: "nephewNiece", substituteOf: "ps" });
    }
  }
  return ps;
}

/** 相続人の内訳（例：「配偶者、子2人」）。相続人がいなければ空文字 */
export function heirBreakdown(iv: Interview, heirs: HeirResult = determineHeirs(familyFromInterview(iv), "tax")): string {
  const ids = new Set(heirs.slots.flatMap((s) => s.personIds));
  const fam = familyFromInterview(iv).filter((p) => ids.has(p.id));
  const n = (f: (p: Person) => boolean) => fam.filter(f).length;
  const parts: string[] = [];
  if (n((p) => p.relation === "spouse")) parts.push("配偶者");
  const kids = n((p) => p.relation === "child" || p.relation === "adoptedChild");
  if (kids) parts.push(`子${kids}人`);
  const g = n((p) => p.relation === "grandchild");
  if (g) parts.push(`孫${g}人`);
  const asc = n((p) => p.relation === "parent");
  if (asc) parts.push(asc === 2 ? "両親" : "親1人");
  const gp = n((p) => p.relation === "grandparent");
  if (gp) parts.push(`祖父母${gp}人`);
  const sib = n((p) => p.relation === "sibling");
  const half = n((p) => p.relation === "sibling" && !!p.halfBlood);
  if (sib) parts.push(`兄弟姉妹${sib}人${half ? `（うち父母の一方のみ同じ${half}人）` : ""}`);
  const nep = n((p) => p.relation === "nephewNiece");
  if (nep) parts.push(`甥・姪${nep}人`);
  return parts.join("、");
}

export type Verdict = "none" | "borderline" | "relief" | "likely";

export interface Estimate {
  heirs: HeirResult;
  heirCount: number;
  basicDeduction: number;
  insuranceExempt: number;
  /** 課税価格の合計の目安（保険金の非課税分・借金・葬式費用を差し引いた後） */
  taxableTotal: number;
  /** 小規模宅地等の特例を使った場合の目安（自宅の評価額を最大80%減） */
  taxableWithRelief: number;
  verdict: Verdict;
  /** 法定相続分どおりに分けた場合の相続税の総額の目安（配偶者の税額軽減前） */
  roughTotalTax: number;
  /** 配偶者が法定相続分を相続した場合の、配偶者の税額軽減後の目安 */
  roughTaxAfterSpouse: number;
}

/** 自宅の評価額のうち、小規模宅地等の特例で減る額の目安（土地分を自宅の7割と仮定し、その80%） */
export const reliefOf = (iv: Interview) => (iv.homeToFamily === true ? Math.floor(iv.homeValue * 0.7 * 0.8) : 0);

function totalTaxOn(taxableEstate: number, heirs: HeirResult): number {
  let t = 0;
  for (const share of heirs.byPerson.values()) t += progressiveTax(floor1000(Math.floor(taxableEstate * toNumber(share))));
  return t;
}

export function estimate(iv: Interview): Estimate {
  const heirs = determineHeirs(familyFromInterview(iv), "tax");
  const heirCount = heirs.count;
  const basicDeduction = BASIC_DEDUCTION_BASE + BASIC_DEDUCTION_PER_HEIR * heirCount;
  const insuranceExempt = Math.min(iv.insurance, INSURANCE_EXEMPT_PER_HEIR * heirCount);
  const gross = iv.homeValue + iv.otherRealEstate + iv.deposits + iv.securities + iv.otherAssets + iv.insurance - insuranceExempt;
  const taxableTotal = Math.max(0, gross - iv.debtAmount - iv.funeralCost);
  const taxableWithRelief = Math.max(0, taxableTotal - reliefOf(iv));

  let verdict: Verdict;
  if (taxableWithRelief > basicDeduction) verdict = "likely";
  else if (taxableTotal > basicDeduction) verdict = "relief";
  else if (taxableTotal > basicDeduction * 0.8) verdict = "borderline";
  else verdict = "none";

  const taxableEstate = Math.max(0, floor1000(taxableWithRelief - basicDeduction));
  const roughTotalTax = taxableEstate > 0 ? totalTaxOn(taxableEstate, heirs) : 0;
  const spouseShare = heirs.spouseId ? toNumber(heirs.byPerson.get(heirs.spouseId) ?? { n: 0n, d: 1n }) : 0;
  const roughTaxAfterSpouse = Math.floor(roughTotalTax * (1 - spouseShare));
  return { heirs, heirCount, basicDeduction, insuranceExempt, taxableTotal, taxableWithRelief, verdict, roughTotalTax, roughTaxAfterSpouse };
}

/** 準確定申告が必要か（所得税法125条。年金400万円以下・他の所得20万円以下は確定申告不要制度） */
export function needsFinalReturn(iv: Interview): "required" | "maybeRefund" | "notNeeded" {
  if (iv.work === "selfEmployed" || iv.filedTaxReturn) return "required";
  if (iv.work === "employee" || iv.highMedical) return "maybeRefund";
  return "notNeeded";
}

/** デモ用の聞き取り結果（架空） */
export const demoInterview = (): Interview => ({
  ...blankInterview(),
  // デモの相続税申告（src/data/demo.ts）と同じ架空の家族
  deathDate: "2026-03-15",
  stage: "after49",
  decedentName: "相続 太郎",
  address: "東京都千代田区架空町一丁目2番3号",
  myRelation: "父",
  spouse: true,
  hasChildren: "yes",
  children: 1,
  grandchildrenOfPredeceased: 1,
  minorHeir: true,
  will: "none",
  debts: "some",
  homeValue: 76_000_000,
  homeToFamily: true,
  otherRealEstate: 18_000_000,
  deposits: 58_000_000,
  securities: 6_000_000,
  insurance: 20_000_000,
  otherAssets: 500_000,
  debtAmount: 200_000,
  funeralCost: 1_850_000,
  work: "pension",
  pension: "employees",
  health: "kouki",
  householdHead: false,
  car: false,
  highMedical: true,
});
