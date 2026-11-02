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
export type PensionKind = "none" | "national" | "employees";
export type HealthInsurance = "kokuho" | "kouki" | "shaho" | "unknown";

export interface Interview {
  deathDate: string;
  decedentName: string;
  // 家族
  spouse: boolean;
  children: number;
  /** 先に亡くなった子がいる場合の、その子ども（孫）の人数 */
  grandchildrenOfPredeceased: number;
  parentsAlive: number;
  siblings: number;
  minorHeir: boolean;
  heirAbroad: boolean;
  // 遺言・借金
  will: WillKind;
  debts: DebtLevel;
  // 財産（おおよその額・円）
  homeValue: number;
  /** 自宅を配偶者か同居の家族が相続する（小規模宅地等の特例の可能性） */
  homeToFamily: boolean;
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
  decedentName: "",
  spouse: false,
  children: 0,
  grandchildrenOfPredeceased: 0,
  parentsAlive: 0,
  siblings: 0,
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

/** 聞き取りの答えから、相続人判定に渡す家族の一覧を作る */
export function familyFromInterview(iv: Interview): Person[] {
  const ps: Person[] = [];
  if (iv.spouse) ps.push({ id: "spouse", name: "配偶者", relation: "spouse" });
  for (let i = 0; i < iv.children; i++) ps.push({ id: `c${i}`, name: `子${i + 1}`, relation: "child" });
  if (iv.grandchildrenOfPredeceased > 0) {
    ps.push({ id: "pc", name: "先に亡くなった子", relation: "child", predeceased: true });
    for (let i = 0; i < iv.grandchildrenOfPredeceased; i++) ps.push({ id: `g${i}`, name: `孫${i + 1}`, relation: "grandchild", substituteOf: "pc" });
  }
  for (let i = 0; i < iv.parentsAlive; i++) ps.push({ id: `p${i}`, name: i === 0 ? "父" : "母", relation: "parent" });
  for (let i = 0; i < iv.siblings; i++) ps.push({ id: `s${i}`, name: `兄弟姉妹${i + 1}`, relation: "sibling" });
  return ps;
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
export const reliefOf = (iv: Interview) => (iv.homeToFamily ? Math.floor(iv.homeValue * 0.7 * 0.8) : 0);

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
  deathDate: "2026-10-20",
  decedentName: "相続 太郎",
  spouse: true,
  children: 2,
  will: "none",
  debts: "some",
  homeValue: 32_000_000,
  homeToFamily: true,
  deposits: 18_000_000,
  securities: 4_000_000,
  insurance: 10_000_000,
  otherAssets: 500_000,
  debtAmount: 600_000,
  funeralCost: 1_800_000,
  work: "pension",
  pension: "employees",
  health: "kouki",
  householdHead: true,
  car: true,
  highMedical: true,
});
