/**
 * 1000件のシナリオをアプリに通し、正しい答え（oracle.ts）と比べて報告する。
 *
 *   npx tsx scripts/cases/run.ts                 税額の計算・手続きの一覧だけ（2分以内）
 *   npx tsx scripts/cases/run.ts --forms         申告書・遺産分割協議書・登記申請書のPDFも作る
 *   npx tsx scripts/cases/run.ts --limit 100     先頭の100件だけ
 *   npx tsx scripts/cases/run.ts --only R0012    1件だけ（詳しい結果・アプリへの入力・正しい答えの計算メモを標準出力へ）
 *   その他：--seed S（乱数の種）、--out DIR（出力先。既定 /tmp/claude-0/cases）、
 *           --jobs N（--forms のとき並べて動かすプロセスの数。既定は CPU の数・最大4）、
 *           --render-every K（--forms のとき、申告書のPDFを K 件に1件だけ作る。ほかの件も欄の割り当てと確かめはする）
 *
 * --forms の内容：アプリが計算を終えた（止まる事項のない）相続ごとに、/api/forms と同じ buildFilingPages → renderForms、
 *   /api/division と同じ buildDivisionDoc → renderDivision、/api/registration と同じ buildRegistrations → renderRegistration を動かし、
 *   例外・時間切れ・様式にない欄・フォントにない字・NaN の書き込み・登録免許税の不整合を docErrors に書く。
 *   申告書のPDFは様式の画像を読み込むため1件4〜6秒かかる（1000件で4プロセスなら15分ほど）。
 * いつも行う確かめ：API と同じ入力の確かめ（src/server/caseSchema.ts）と、聞き取りの答えから作る手続きの一覧
 *   （src/domain/procedures/rules.ts の buildTasks）の日付（正しい日付で2026〜2030年。請求の時効は亡くなった日から5年まで）、
 *   相続税の申告期限（翌日から10か月、休日なら次の開庁日）、相続税の申告の手続きがあるか（計算結果の申告の要否と一致するか）。
 *
 * 出力：DIR/report.json（シナリオごとの結果）、DIR/report.md（集計）。合計は標準出力にも出す。
 *
 * 分類
 *   OK                  … アプリが止まらず、各人の課税価格・納付税額、課税価格の合計・相続税の総額・法定相続人の数・
 *                         基礎控除・申告の要否が正しい答えと一致
 *   BLOCKED_OK          … アプリが「税理士に相談」で止まり、正しい答えでも自動計算の対象外（computable=false）
 *   BLOCKED_UNSUPPORTED … アプリは止まるが、正しく計算できる相続（アプリの機能が足りない）
 *   WRONG               … アプリが止まらずに違う答えを出した、または対象外の相続を黙って計算した（いちばん悪い）
 *                         wrongKind="exact" はシナリオをそのまま入力できたのに違う（計算の誤り）、
 *                         "approx" はふつうの人の入れ方（近似）で入れて違った（質問・入力欄の不足）
 *   UNREPRESENTABLE     … アプリに入力のしかたがない事柄があり、そのせいで答えが変わった（アプリは止まらなかった）
 *   CRASH               … 例外、NaN、負の税額、円未満の端数
 *   HARNESS_ERROR       … 変換（toCase）か正しい答え（oracle）の側で例外が起きた（アプリの問題ではない）
 *
 * 許容差：各人の納付税額に限り、100円までの差を「端数の差」として OK に含める。条件は、
 *   課税価格・相続税の総額がすべて一致し、その人のアプリの算出税額が「総額×課税価格÷合計」の正確な値と1円だけ違うこと。
 *   アプリは按分割合を小数10桁にそろえて（相基通17-1：端数の調整は取得者の選択）計算するため、
 *   正確な分数で計算する答えと算出税額が1円ずれ、100円未満切捨ての境目をまたぐと納付税額が100円違うことがある。
 *   どちらも法令どおりの計算なので誤りとしない（該当した件は report の tolerated に記録する）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { blankInterview, type Interview, type Verdict } from "../../src/domain/procedures/interview";
import { buildTasks } from "../../src/domain/procedures/rules";
import { calculate, type TaxResult } from "../../src/domain/tax/engine";
import type { Case } from "../../src/domain/types";
import { valueAsset } from "../../src/domain/valuation";
import { checkCase } from "../../src/server/caseSchema";
import { generateScenarios } from "./generate";
import { expected } from "./oracle";
import type { Expected, Scenario } from "./scenario";
import { toCase, type ToCaseResult } from "./toCase";

/**
 * WRONG の件数の上限（src/domain/__tests__/cases.test.ts で確かめる）。1000件・seed 既定値（20261108）での今の件数から始め、0 に近づけていく。
 * 2026-11-03 時点の143件の内訳：そのまま入力できたもの1件（E027 相続人全員の放棄を止めずに計算）、
 * 近似して入力したもの142件（貸家建付地・貸家・貸宅地・間口狭小/奥行長大・不整形地・地積規模の大きな宅地・セットバック・
 * 配偶者居住権。どれも近似を取り除くと一致する）
 */
export const WRONG_BUDGET = 143;

export type CaseClass = "OK" | "BLOCKED_OK" | "BLOCKED_UNSUPPORTED" | "WRONG" | "UNREPRESENTABLE" | "CRASH" | "HARNESS_ERROR";
export const CLASSES: CaseClass[] = ["OK", "BLOCKED_OK", "BLOCKED_UNSUPPORTED", "WRONG", "UNREPRESENTABLE", "CRASH", "HARNESS_ERROR"];

export interface Diff {
  /** 人の id（合計の欄は "*"） */
  who: string;
  name?: string;
  field: "taxablePrice" | "payable" | "totalTaxablePrice" | "totalTax" | "legalHeirCount" | "basicDeduction" | "filingRequired" | "computable";
  app: number | boolean | null;
  oracle: number | boolean | null;
  /** app − oracle（数のとき） */
  diff?: number;
}

export interface CaseReport {
  id: string;
  title: string;
  tags: string[];
  class: CaseClass;
  wrongKind?: "exact" | "approx";
  blockers: string[];
  diffs: Diff[];
  unrepresentable: string[];
  approximations: string[];
  /** アプリ・変換・正しい答えの例外や異常値 */
  errors: string[];
  /** 手続き・入力の形・書類（PDF）の問題（分類とは別に数える） */
  docErrors: string[];
  /** 端数の差として許した差 */
  tolerated: string[];
  /**
   * WRONG（近似）・UNREPRESENTABLE の件で、近似・入力できない事柄を取り除いたシナリオ（stripFeatures）の結果。
   * explained=true なら、違いは取り除いた事柄だけで説明できる
   */
  residual?: { class: CaseClass; explained: boolean; diffs: Diff[]; left: string[] };
  /** 1件の処理時間（ミリ秒）。書類のPDFは docMs に別に */
  ms: number;
  docMs?: number;
  oracle?: { computable: boolean; outOfScope?: string; totalTaxablePrice: number; totalTax: number; filingRequired: boolean; persons: Expected["persons"]; notes?: string[] };
  app?: {
    totalTaxable: number;
    totalTax: number;
    totalPayable: number;
    needsFiling: boolean;
    legalHeirCount: number;
    persons: { id: string; taxable: number; computed: number; payable: number }[];
    warnings?: string[];
  };
}

export interface RunOptions {
  /** 申告書・協議書・登記申請書のPDFを作る（runScenarioAsync だけ） */
  forms?: boolean;
  /** 書類1つあたりの時間の上限（ミリ秒） */
  docTimeoutMs?: number;
  /**
   * 申告書のPDFまで作る（既定 true）。false なら欄の割り当て（buildFilingPages）と、様式の欄・ページ画像・フォントの字形の確かめだけ。
   * 申告書のPDFは様式の画像の読み込みに1件4〜6秒かかるため、--render-every で間引ける
   */
  renderForms?: boolean;
  /** WRONG の件に、正しい答えの計算メモとアプリの警告を付ける */
  details?: boolean;
  /** 近似・入力できない事柄を取り除いた確かめ（residual）をしない */
  noResidual?: boolean;
}

/* ------------------------------------------------------------------ */
/* 1件の処理                                                            */
/* ------------------------------------------------------------------ */

const isYen = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x);

/** アプリの結果に NaN・円未満・負の金額がないか */
function sanity(r: TaxResult): string[] {
  const bad: string[] = [];
  const check = (where: string, v: unknown, nonNegative = true) => {
    if (!isYen(v)) bad.push(`${where} が円の整数でない（${String(v)}）`);
    else if (nonNegative && (v as number) < 0) bad.push(`${where} が負（${String(v)}）`);
  };
  for (const k of ["legalHeirCount", "basicDeduction", "totalAcquired", "totalDebts", "totalTaxable", "taxableEstate", "totalTax", "totalPayable", "insuranceExemptLimit", "retirementExemptLimit"] as const) {
    check(k, r[k]);
  }
  r.slots.forEach((s, i) => {
    check(`slots[${i}].amount`, s.amount);
    check(`slots[${i}].tax`, s.tax);
  });
  for (const l of r.assets) {
    check(`財産 ${l.asset.id} の評価額`, l.valuation.value);
    check(`財産 ${l.asset.id} の減額`, l.reduction);
    for (const b of l.byPerson) check(`財産 ${l.asset.id} の ${b.personId} 取得分`, b.amount);
  }
  const fields = [
    "inherited", "insurance", "insuranceExempt", "retirement", "retirementExempt", "acquired", "debts", "debtOnly", "funeralOnly", "net",
    "gifts", "taxable", "computed", "surcharge", "giftTaxCredit", "spouseCredit", "beforeOtherCredits", "minorCredit", "disabilityCredit",
    "minorExcess", "disabilityExcess", "otherCredits", "totalCredits", "afterCredits", "payable",
  ] as const;
  for (const p of r.persons) {
    for (const f of fields) check(`${p.person.id}.${f}`, p[f]);
    if (!Number.isFinite(p.ratio)) bad.push(`${p.person.id}.ratio が数でない（${p.ratio}）`);
    if (p.taxable % 1000 !== 0) bad.push(`${p.person.id}.taxable が1,000円未満を切り捨てていない（${p.taxable}）`);
    if (p.payable % 100 !== 0) bad.push(`${p.person.id}.payable が100円未満を切り捨てていない（${p.payable}）`);
  }
  if (r.totalTax % 100 !== 0) bad.push(`totalTax が100円未満を切り捨てていない（${r.totalTax}）`);
  return bad;
}

/** アプリの結果と正しい答えの差。tolerated には許した差を書く */
export function compareResult(c: Case, r: TaxResult, exp: Expected, tolerated: string[] = []): Diff[] {
  const diffs: Diff[] = [];
  const name = (id: string) => c.persons.find((p) => p.id === id)?.name;
  const num = (field: Diff["field"], app: number, oracle: number, who = "*") => {
    if (app !== oracle) diffs.push({ who, name: who === "*" ? undefined : name(who), field, app, oracle, diff: app - oracle });
  };
  num("legalHeirCount", r.legalHeirCount, exp.legalHeirCount);
  num("basicDeduction", r.basicDeduction, exp.basicDeduction);
  num("totalTaxablePrice", r.totalTaxable, exp.totalTaxablePrice);
  num("totalTax", r.totalTax, exp.totalTax);
  if (r.needsFiling !== exp.filingRequired) diffs.push({ who: "*", field: "filingRequired", app: r.needsFiling, oracle: exp.filingRequired });

  const appBy = new Map(r.persons.map((p) => [p.person.id, p]));
  const expBy = new Map(exp.persons.map((p) => [p.id, p]));
  const ids = [...new Set([...expBy.keys(), ...appBy.keys()])];
  const pending: { id: string; app: number; oracle: number }[] = [];
  for (const id of ids) {
    const a = appBy.get(id);
    const e = expBy.get(id);
    num("taxablePrice", a?.taxable ?? 0, e?.taxablePrice ?? 0, id);
    const ap = a?.payable ?? 0;
    const ep = e?.payable ?? 0;
    if (ap !== ep) pending.push({ id, app: ap, oracle: ep });
  }
  // 納付税額の100円の差：課税価格と相続税の総額が一致していて、按分割合の端数（小数10桁）で算出税額が1円ずれた人だけ許す
  const baseOk = diffs.length === 0;
  for (const x of pending) {
    const a = appBy.get(x.id);
    let ok = false;
    if (baseOk && a && Math.abs(x.app - x.oracle) <= 100 && r.totalTaxable > 0) {
      const exact = Number((BigInt(r.totalTax) * BigInt(a.taxable)) / BigInt(r.totalTaxable));
      ok = a.computed !== exact && Math.abs(a.computed - exact) <= 1;
    }
    if (ok) tolerated.push(`${x.id} 納付税額 ${x.app - x.oracle}円差（按分割合の端数。算出税額がアプリ ${a!.computed}円・正確な値 ${Number((BigInt(r.totalTax) * BigInt(a!.taxable)) / BigInt(r.totalTaxable))}円、相基通17-1）`);
    else diffs.push({ who: x.id, name: name(x.id), field: "payable", app: x.app, oracle: x.oracle, diff: x.app - x.oracle });
  }
  return diffs;
}

/** 税額の計算（toCase → calculate → 比較 → 分類）と手続きの一覧の確かめ。PDF は作らない */
export function runScenario(s: Scenario, opts: RunOptions = {}): CaseReport & { _case?: Case; _result?: TaxResult; _expected?: Expected } {
  const t0 = performance.now();
  const rep: CaseReport & { _case?: Case; _result?: TaxResult; _expected?: Expected } = {
    id: s.id,
    title: s.title,
    tags: s.tags,
    class: "OK",
    blockers: [],
    diffs: [],
    unrepresentable: [],
    approximations: [],
    errors: [],
    docErrors: [],
    tolerated: [],
    ms: 0,
  };
  const done = () => {
    rep.ms = Math.round((performance.now() - t0) * 10) / 10;
    return rep;
  };

  let conv: ToCaseResult;
  try {
    conv = toCase(s);
  } catch (e) {
    rep.class = "HARNESS_ERROR";
    rep.errors.push(`toCase: ${errText(e)}`);
    return done();
  }
  rep.unrepresentable = conv.unrepresentable;
  rep.approximations = conv.approximations;

  let exp: Expected;
  try {
    exp = expected(s);
  } catch (e) {
    rep.class = "HARNESS_ERROR";
    rep.errors.push(`oracle: ${errText(e)}`);
    return done();
  }
  rep._expected = exp;
  rep.oracle = {
    computable: exp.computable,
    outOfScope: exp.outOfScope,
    totalTaxablePrice: exp.totalTaxablePrice,
    totalTax: exp.totalTax,
    filingRequired: exp.filingRequired,
    persons: exp.persons,
  };

  const c = conv.case;
  if (!c) {
    rep.class = "UNREPRESENTABLE";
    return done();
  }
  rep._case = c;

  // 画面から送る API と同じ入力の確かめ（件数・id の重なり・代襲のつながり）
  try {
    const chk = checkCase(c);
    if (!chk.ok) rep.docErrors.push(`schema: ${chk.error}`);
  } catch (e) {
    rep.docErrors.push(`schema: 例外 ${errText(e)}`);
  }

  let r: TaxResult;
  try {
    r = calculate(c);
  } catch (e) {
    rep.class = "CRASH";
    rep.errors.push(`calculate: ${errText(e)}`);
    return done();
  }
  rep._result = r;
  rep.blockers = r.blockers;
  rep.app = {
    totalTaxable: r.totalTaxable,
    totalTax: r.totalTax,
    totalPayable: r.totalPayable,
    needsFiling: r.needsFiling,
    legalHeirCount: r.legalHeirCount,
    persons: r.persons.map((p) => ({ id: p.person.id, taxable: p.taxable, computed: p.computed, payable: p.payable })),
  };
  const bad = sanity(r);

  // 手続きの一覧（いつも作る。軽い）
  try {
    rep.docErrors.push(...checkProcedures(s, c, r));
  } catch (e) {
    rep.docErrors.push(`procedures: 例外 ${errText(e)}`);
  }

  if (bad.length) {
    rep.class = "CRASH";
    rep.errors.push(...bad);
    return done();
  }
  if (r.blockers.length > 0) {
    rep.class = exp.computable ? "BLOCKED_UNSUPPORTED" : "BLOCKED_OK";
    return done();
  }
  rep.diffs = compareResult(c, r, exp, rep.tolerated);
  const unrep = conv.unrepresentable.length > 0;
  if (!exp.computable) {
    rep.diffs.unshift({ who: "*", field: "computable", app: true, oracle: false });
    rep.class = unrep ? "UNREPRESENTABLE" : "WRONG";
  } else if (rep.diffs.length === 0) {
    rep.class = "OK";
  } else {
    rep.class = unrep ? "UNREPRESENTABLE" : "WRONG";
  }
  if (rep.class === "WRONG") {
    rep.wrongKind = conv.approximations.length ? "approx" : "exact";
    if (opts.details) {
      rep.oracle.notes = exp.notes;
      rep.app.warnings = r.warnings;
    }
  }
  if (!opts.noResidual) residualCheck(s, rep);
  return done();
}

/**
 * 近似した事柄・入力できない事柄を取り除いたシナリオ（貸家建付地→自用地、貸家→自用家屋、補正の要る土地→補正なし、
 * 間口を十分に広く、代償金なし、特定事業用・貸付事業用の特例なし、借地権→自用地 など）。
 * これで一致すれば、違いは取り除いた事柄だけで説明できる。一致しなければ、ほかにも計算の誤りが隠れている。
 */
export function stripFeatures(s: Scenario): Scenario {
  const t: Scenario = structuredClone(s);
  for (const it of t.estate) {
    if (it.type === "land") {
      if (it.use === "rentedHouse" || it.use === "leasedLand" || it.use === "leasehold") it.use = "self";
      delete it.rentRatio;
      delete it.needsReduction;
      delete it.spouseResidenceRight;
      if (it.smallLand && it.smallLand.kind !== "residence") delete it.smallLand;
      if (it.valuation.kind === "rosenka") for (const r of it.valuation.roads) r.frontage = Math.max(28, r.depth);
      it.areaSqm = Math.round(it.areaSqm * 100) / 100;
    } else if (it.type === "building") {
      delete it.rented;
      delete it.rentRatio;
    } else if (it.type === "condo") {
      delete it.rented;
      const ext = it as typeof it & { leaseRatio?: number; rentRatio?: number };
      delete ext.leaseRatio;
      delete ext.rentRatio;
      if (it.smallLand && it.smallLand.kind !== "residence") delete it.smallLand;
    } else if (it.type === "listedStock") {
      for (const k of Object.keys(it.prices) as (keyof typeof it.prices)[]) it.prices[k] = Math.round(it.prices[k] * 100) / 100;
    }
  }
  if (t.division.kind === "agreed") delete t.division.compensation;
  return t;
}

/** WRONG（近似）・UNREPRESENTABLE の件で、取り除いたシナリオでも違うかを確かめる */
function residualCheck(s: Scenario, rep: CaseReport): void {
  if (!(rep.class === "WRONG" && rep.wrongKind === "approx") && rep.class !== "UNREPRESENTABLE") return;
  const t = stripFeatures(s);
  const r2 = runScenario(t, { noResidual: true });
  rep.residual = {
    class: r2.class,
    explained: r2.class === "OK",
    diffs: r2.diffs,
    left: [...r2.unrepresentable, ...r2.approximations],
  };
}

/** 税額の計算に加えて、--forms のときは申告書・遺産分割協議書・登記申請書のPDFを作る */
export async function runScenarioAsync(s: Scenario, opts: RunOptions = {}): Promise<CaseReport> {
  const rep = runScenario(s, opts);
  const { _case: c, _result: r } = rep;
  delete rep._case;
  delete rep._result;
  delete rep._expected;
  // 申告書の API（/api/forms）は止まる事項があると作らないので、アプリが計算を終えた相続だけ作る
  if (opts.forms && c && r && r.blockers.length === 0 && rep.class !== "CRASH") {
    const t0 = performance.now();
    rep.docErrors.push(...(await buildDocuments(c, r, opts.docTimeoutMs ?? 60_000, opts.renderForms ?? true)));
    rep.docMs = Math.round(performance.now() - t0);
  }
  return rep;
}

/** 何件もまとめて（PDF なし）。テストから使う */
export function runAll(list: Scenario[], opts: RunOptions = {}): { reports: CaseReport[]; totals: Record<CaseClass, number> } {
  const reports = list.map((s) => {
    const rep = runScenario(s, opts);
    delete rep._case;
    delete rep._result;
    delete rep._expected;
    return rep as CaseReport;
  });
  return { reports, totals: countClasses(reports) };
}

export function countClasses(reports: CaseReport[]): Record<CaseClass, number> {
  const t = Object.fromEntries(CLASSES.map((k) => [k, 0])) as Record<CaseClass, number>;
  for (const r of reports) t[r.class]++;
  return t;
}

const errText = (e: unknown) => {
  if (e instanceof Error) {
    const at = e.stack?.split("\n").find((l) => l.includes("/src/") || l.includes("/scripts/"))?.trim();
    return `${e.message}${at ? ` (${at})` : ""}`;
  }
  return String(e);
};

/* ------------------------------------------------------------------ */
/* 手続きの一覧（src/domain/procedures）                                 */
/* ------------------------------------------------------------------ */

/** シナリオから、最初の聞き取り（家族構成・財産のおおよその額）の答えを作る */
export function interviewOf(s: Scenario, c: Case): Interview {
  const iv = blankInterview();
  const death = s.decedent.deathDate;
  const alive = s.members.filter((m) => !m.predeceased && !m.diedAfter);
  const byId = new Map(s.members.map((m) => [m.id, m]));
  const age = (b: string) => {
    const [by, bm, bd] = b.split("-").map(Number);
    const [y, m, d] = death.split("-").map(Number);
    return Math.max(0, y - by - (m < bm || (m === bm && d < bd) ? 1 : 0));
  };
  iv.deathDate = death;
  iv.stage = "after49";
  iv.decedentName = s.decedent.name;
  iv.address = s.decedent.address;
  iv.spouse = alive.some((m) => m.relation === "spouse");
  iv.children = alive.filter((m) => m.relation === "child" || m.relation === "adoptedChild").length;
  iv.grandchildrenOfPredeceased = alive.filter((m) => m.relation === "grandchild" && m.substituteOf && byId.get(m.substituteOf)?.predeceased).length;
  iv.parentsAlive = Math.min(2, alive.filter((m) => m.relation === "parent").length);
  iv.siblings = alive.filter((m) => m.relation === "sibling").length;
  iv.minorHeir = alive.some((m) => m.relation !== "other" && age(m.birthDate) < 18);
  iv.heirAbroad = alive.some((m) => m.nonResident);
  const toOthers =
    s.division.kind === "agreed" && Object.values(s.division.shares).some((sh) => sh.some((x) => byId.get(x.who)?.relation === "other"));
  iv.will = toOthers ? "notarized" : "none";
  iv.debts = s.debts.some((d) => d.kind === "debt") ? "some" : "none";
  const val = (kind: string[], f: (a: Case["assets"][number]) => boolean = () => true) =>
    c.assets.filter((a) => kind.includes(a.kind) && f(a)).reduce((x, a) => x + valueAsset(a).value, 0);
  const isHome = (a: Case["assets"][number]) => ((a.kind === "land" || a.kind === "condo") && !!a.smallResidential?.applies) || (a.kind === "building" && a.label.startsWith("自宅"));
  iv.homeValue = val(["land", "building", "condo"], isHome);
  iv.homeToFamily = c.assets.some((a) => (a.kind === "land" || a.kind === "condo") && !!a.smallResidential?.applies);
  iv.otherRealEstate = val(["land", "building", "condo"], (a) => !isHome(a));
  iv.deposits = val(["deposit", "cash"]);
  iv.securities = val(["listedStock", "unlistedStock"]);
  iv.insurance = val(["insurance", "retirement"]);
  iv.otherAssets = val(["household", "other"]);
  iv.debtAmount = s.debts.filter((d) => d.kind === "debt").reduce((x, d) => x + d.amount, 0);
  iv.funeralCost = s.debts.filter((d) => d.kind === "funeral").reduce((x, d) => x + d.amount, 0);
  iv.work = "pension";
  iv.pension = "employees";
  iv.health = age(s.decedent.birthDate) >= 75 ? "kouki" : "kokuho";
  iv.filedTaxReturn = s.estate.some((it) => (it.type === "land" && (it.use === "rentedHouse" || it.use === "leasedLand" || it.use === "parking")) || (it.type === "building" && !!it.rented));
  return iv;
}

/** 「〇か月以内」の期限（民法140条・143条）：翌日から数えて n か月目の応当日の前日。応当日がなければその月の末日 */
function monthsAfter(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d + 1));
  const sy = start.getUTCFullYear();
  const sm = start.getUTCMonth() + n;
  const sd = start.getUTCDate();
  const last = new Date(Date.UTC(sy, sm + 1, 0)).getUTCDate();
  const end = sd > last ? new Date(Date.UTC(sy, sm, last)) : new Date(Date.UTC(sy, sm, sd - 1));
  return end.toISOString().slice(0, 10);
}
const validISO = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

/** 手続きの一覧を作り、日付と相続税の申告の手続きを確かめる */
function checkProcedures(s: Scenario, c: Case, r: TaxResult): string[] {
  const out: string[] = [];
  const iv = interviewOf(s, c);
  // マイページと同じ判定（src/lib/overall.ts）：止まる事項がなければ計算結果で、あれば聞き取りの目安で決める
  const verdict: Verdict | undefined = r.blockers.length === 0 ? (!r.needsFiling ? "none" : r.totalPayable > 0 ? "likely" : "relief") : undefined;
  // 聞き取りの目安だけの一覧（相続税の計算を終える前）と、計算結果を反映した一覧の両方を確かめる
  const verdicts = verdict === undefined ? [undefined] : [undefined, verdict];
  const death = s.decedent.deathDate;
  // 請求の時効（遺族年金・未支給年金の5年など）は2030年を超えてよい。亡くなった日から5年（＋年末年始・休日のずれ）までにある
  const limitMax = addDaysISO(monthsAfter(death, 60), 14);
  for (const v of verdicts) {
    const { tasks } = buildTasks(iv, { verdict: v });
    for (const t of tasks) {
      for (const [what, d] of [["期限", t.date], ["並び順の日", t.sortDate], ["別の期限", t.limit?.date]] as const) {
        if (what === "別の期限" && d === undefined) continue;
        if (!validISO(d)) out.push(`procedures: 「${t.title}」の${what}が正しい日付でない（${d}）`);
        else if (what === "別の期限" ? d! < death || d! > limitMax : d! < "2026-01-01" || d! > "2030-12-31")
          out.push(`procedures: 「${t.title}」の${what}が${what === "別の期限" ? "亡くなった日〜5年後" : "2026〜2030年"}の外（${d}）`);
      }
    }
    const tax = tasks.find((t) => t.id === "inheritance-tax");
    if (!tax) {
      out.push("procedures: 相続税の申告の手続きがない");
      continue;
    }
    // 申告期限：亡くなった日の翌日から10か月（相続税法27条）。土日祝日・年末年始なら次の開庁日（国税通則法10条2項）
    const raw = monthsAfter(s.decedent.deathDate, 10);
    const dow = new Date(tax.date + "T00:00:00Z").getUTCDay();
    const md = tax.date.slice(5);
    const lateDays = (Date.parse(tax.date) - Date.parse(raw)) / 86_400_000;
    if (tax.date < raw || lateDays > 7 || dow === 0 || dow === 6 || md >= "12-29" || md <= "01-03") {
      out.push(`procedures: 相続税の申告期限 ${tax.date}（10か月の期限は ${raw}）`);
    }
    if (v !== undefined) {
      const present = !tax.optional;
      // 正しい申告の要否（oracle）との違いは、税額の比較（diffs の filingRequired）に出るので、ここでは計算結果との食い違いだけを見る
      if (present !== r.needsFiling) out.push(`procedures: 相続税の申告の手続き（${present ? "あり" : "なし"}）が計算結果の申告の要否（${r.needsFiling ? "要" : "不要"}）と合わない`);
    }
  }
  return [...new Set(out)];
}

function addDaysISO(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* 書類（PDF）                                                          */
/* ------------------------------------------------------------------ */

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${what}：${ms}ミリ秒で終わらなかった`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/** フォントの字形があるかを確かめる道具（申告書・協議書と同じ IPA ゴシック） */
let glyphCheck: ((cp: number) => boolean) | undefined;
async function hasGlyph(): Promise<(cp: number) => boolean> {
  if (!glyphCheck) {
    const [{ default: fontkit }, { loadFont }] = await Promise.all([import("@pdf-lib/fontkit"), import("../../src/forms/render")]);
    const font = fontkit.create(await loadFont());
    glyphCheck = (cp) => font.hasGlyphForCodePoint(cp);
  }
  return glyphCheck;
}

/** /api/forms・/api/division・/api/registration と同じ部品で PDF を作る */
async function buildDocuments(c: Case, r: TaxResult, timeoutMs: number, render: boolean): Promise<string[]> {
  const out: string[] = [];
  const [{ buildFilingPages, formsNotGenerated }, { renderForms, layout }, { buildDivisionDoc }, { renderDivision }, { buildRegistrations, registrationTax }, { renderRegistration }] =
    await Promise.all([
      import("../../src/forms/filing"),
      import("../../src/forms/render"),
      import("../../src/documents/division"),
      import("../../src/documents/renderDivision"),
      import("../../src/domain/registration"),
      import("../../src/documents/renderRegistration"),
    ]);
  const glyph = await hasGlyph();
  const step = async (what: string, f: () => Promise<Uint8Array | null>) => {
    try {
      const bytes = await withTimeout(f(), timeoutMs, what);
      if (bytes && bytes.length < 500) out.push(`${what}: PDF が小さすぎる（${bytes.length}バイト）`);
    } catch (e) {
      out.push(`${what}: ${errText(e)}`);
    }
  };
  /** 書く文字に、フォントにない字がないか（あると PDF では空白や豆腐になる） */
  const missingGlyphs = (what: string, texts: string[]) => {
    const miss = new Set<string>();
    for (const t of texts) for (const ch of t) if (ch.trim() && !glyph(ch.codePointAt(0)!)) miss.add(ch);
    if (miss.size) out.push(`${what}: フォントにない字 ${[...miss].join("")}`);
  };
  await step("forms", async () => {
    formsNotGenerated(c, r);
    const pages = buildFilingPages(c, r);
    // renderForms と同じ確かめ（様式の欄があるか・ページ画像があるか）を、PDF を作らなくても行う
    const { existsSync } = await import("node:fs");
    const texts: string[] = [];
    for (const p of pages) {
      const def = layout[p.page];
      if (!def) out.push(`forms: 様式 ${p.page} がない`);
      else if (!existsSync(path.join(process.cwd(), `public/forms/r08/${p.page}.png`))) out.push(`forms: 様式 ${p.page} の画像がない`);
      for (const [id, v] of Object.entries(p.values)) {
        if (v === undefined || v === null || v === "") continue;
        if (def && !def.fields[id]) out.push(`forms: 様式 ${p.page} に欄 ${id} がない`);
        if (typeof v === "number" && !Number.isFinite(v)) out.push(`forms: ${p.page}.${id} が数でない（${v}）`);
        if (/NaN|undefined|Infinity/.test(String(v))) out.push(`forms: ${p.page}.${id} に「${String(v)}」と書かれる`);
        texts.push(String(v));
      }
    }
    missingGlyphs("forms", texts);
    return render ? renderForms(pages) : null;
  });
  await step("division", async () => {
    const doc = buildDivisionDoc(c);
    missingGlyphs("division", [...doc.decedent, doc.preamble, doc.closing, ...doc.articles.flatMap((a) => [a.heading, ...a.items]), ...doc.signers.map((x) => x.name)]);
    if (/NaN|undefined/.test(JSON.stringify(doc))) out.push("division: 文面に NaN か undefined がある");
    return renderDivision(doc);
  });
  await step("registration", async () => {
    const apps = buildRegistrations(c);
    for (const a of apps) {
      if (!isYen(a.taxBase) || !isYen(a.tax) || a.tax < 0) out.push(`registration: 登録免許税が円の整数でない（${a.taxBase}→${a.tax}）`);
      else if (a.tax !== registrationTax(a.taxBase)) out.push(`registration: 登録免許税の計算が合わない`);
    }
    return apps.length ? renderRegistration(apps) : null;
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* 報告                                                                 */
/* ------------------------------------------------------------------ */

/** 止まった理由の文から、人の名前・財産の名前・数を取り除いて、同じ種類の文をまとめる */
export function normalizeMessage(msg: string, names: string[]): string {
  let m = msg;
  for (const n of [...names].filter(Boolean).sort((a, b) => b.length - a.length)) m = m.split(n).join("◯◯");
  return m
    .replace(/「[^」]*」/g, "「…」")
    .replace(/[0-9０-９][0-9０-９,，.]*/g, "N")
    .replace(/（N件目、N円）/g, "（N件目）");
}

interface Meta {
  seed: number;
  n: number;
  forms: boolean;
  totalMs: number;
  generatedAt: string;
}

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "-");
const yenText = (x: number | boolean | null | undefined) => (typeof x === "number" ? x.toLocaleString("ja-JP") : String(x));
const mdCell = (s: string) => s.replace(/\|/g, "／").replace(/\n/g, " ");

export function renderMarkdown(reports: CaseReport[], meta: Meta, namesOf: Map<string, string[]>): string {
  const L: string[] = [];
  const totals = countClasses(reports);
  const n = reports.length;
  const wrong = reports.filter((r) => r.class === "WRONG");
  const wrongExact = wrong.filter((r) => r.wrongKind === "exact").length;
  const tol = reports.filter((r) => r.tolerated.length > 0).length;
  const docBad = reports.filter((r) => r.docErrors.length > 0);

  L.push("# 相続コンパス シナリオ検査の結果", "");
  L.push(`- 実行日時：${meta.generatedAt}`);
  L.push(`- シナリオ：${n}件（seed ${meta.seed}）／ 書類のPDF：${meta.forms ? "作成した" : "作成していない（--forms で作成）"}`);
  L.push(`- かかった時間：${(meta.totalMs / 1000).toFixed(1)}秒（1件あたり平均 ${(reports.reduce((a, r) => a + r.ms, 0) / Math.max(1, n)).toFixed(2)}ミリ秒、PDF を除く）`);
  L.push(`- WRONG の上限（WRONG_BUDGET）：${WRONG_BUDGET}`, "");

  L.push("## 分類ごとの件数", "");
  L.push("| 分類 | 件数 | 割合 | 意味 |", "|---|---:|---:|---|");
  const meaning: Record<CaseClass, string> = {
    OK: "正しい答えと一致",
    BLOCKED_OK: "アプリが止まり、正しくも対象外の相続",
    BLOCKED_UNSUPPORTED: "アプリが止まるが、正しく計算できる相続（機能不足）",
    WRONG: "アプリが止まらずに違う答え（いちばん悪い）",
    UNREPRESENTABLE: "アプリに入力のしかたがない事柄で答えが変わった",
    CRASH: "例外・NaN・負の税額・円未満の端数",
    HARNESS_ERROR: "変換か正しい答えの側の例外（アプリの問題ではない）",
  };
  for (const k of CLASSES) L.push(`| ${k} | ${totals[k]} | ${pct(totals[k], n)} | ${meaning[k]} |`);
  L.push("");
  L.push(`- WRONG のうち、シナリオをそのまま入力できたもの（計算の誤り）：${wrongExact}件、近似して入力したもの（質問・入力欄の不足）：${wrong.length - wrongExact}件`);
  const resid = (k: CaseReport[]) => `近似・入力できない事柄を取り除くと一致 ${k.filter((r) => r.residual?.explained).length}件／取り除いても違う ${k.filter((r) => r.residual && !r.residual.explained).length}件`;
  L.push(`- WRONG（近似）の確かめ：${resid(wrong.filter((r) => r.wrongKind === "approx"))}`);
  L.push(`- UNREPRESENTABLE の確かめ：${resid(reports.filter((r) => r.class === "UNREPRESENTABLE"))}`);
  L.push(`- 端数の差（按分割合の小数10桁、100円以内）を許した件：${tol}件`);
  L.push(`- 手続き・入力の形・書類の問題があった件：${docBad.length}件`, "");

  // タグごと
  L.push("## タグごとの件数", "");
  L.push(`| タグ | 件数 | ${CLASSES.join(" | ")} |`, `|---|---:|${CLASSES.map(() => "---:").join("|")}|`);
  const tagMap = new Map<string, Record<CaseClass, number>>();
  for (const r of reports) {
    for (const t of r.tags) {
      const row = tagMap.get(t) ?? (Object.fromEntries(CLASSES.map((k) => [k, 0])) as Record<CaseClass, number>);
      row[r.class]++;
      tagMap.set(t, row);
    }
  }
  const tagRows = [...tagMap.entries()].map(([t, row]) => ({ t, row, total: CLASSES.reduce((a, k) => a + row[k], 0) })).sort((a, b) => b.total - a.total || a.t.localeCompare(b.t));
  for (const { t, row, total } of tagRows) L.push(`| ${mdCell(t)} | ${total} | ${CLASSES.map((k) => (row[k] ? String(row[k]) : "")).join(" | ")} |`);
  L.push("");

  // 止まった理由
  L.push("## アプリが止まった理由（多い順）", "");
  const blk = new Map<string, { ok: number; unsupported: number; example: string }>();
  for (const r of reports) {
    if (r.class !== "BLOCKED_OK" && r.class !== "BLOCKED_UNSUPPORTED") continue;
    for (const m of new Set(r.blockers.map((b) => normalizeMessage(b, namesOf.get(r.id) ?? [])))) {
      const e = blk.get(m) ?? { ok: 0, unsupported: 0, example: r.id };
      if (r.class === "BLOCKED_OK") e.ok++;
      else e.unsupported++;
      blk.set(m, e);
    }
  }
  L.push("| 件数 | 対象外で正しく止まった | 計算できるのに止まった | 理由 | 例 |", "|---:|---:|---:|---|---|");
  for (const [m, e] of [...blk.entries()].sort((a, b) => b[1].ok + b[1].unsupported - (a[1].ok + a[1].unsupported)).slice(0, 40)) {
    L.push(`| ${e.ok + e.unsupported} | ${e.ok} | ${e.unsupported} | ${mdCell(m.length > 160 ? m.slice(0, 160) + "…" : m)} | ${e.example} |`);
  }
  L.push("");

  // 正しい答えで対象外とされた理由
  L.push("## 正しい答えで「自動計算の対象外」とした理由と、アプリの分類", "");
  const oos = new Map<string, Record<CaseClass, number>>();
  for (const r of reports) {
    if (!r.oracle || r.oracle.computable) continue;
    for (const why of (r.oracle.outOfScope ?? "（理由なし）").split(" / ")) {
      const row = oos.get(why) ?? (Object.fromEntries(CLASSES.map((k) => [k, 0])) as Record<CaseClass, number>);
      row[r.class]++;
      oos.set(why, row);
    }
  }
  L.push(`| 理由 | ${CLASSES.join(" | ")} |`, `|---|${CLASSES.map(() => "---:").join("|")}|`);
  for (const [why, row] of [...oos.entries()].sort((a, b) => CLASSES.reduce((x, k) => x + b[1][k], 0) - CLASSES.reduce((x, k) => x + a[1][k], 0))) {
    L.push(`| ${mdCell(why)} | ${CLASSES.map((k) => (row[k] ? String(row[k]) : "")).join(" | ")} |`);
  }
  L.push("");

  // 入力できない事柄・近似
  const featureTable = (title: string, pick: (r: CaseReport) => string[]) => {
    L.push(`## ${title}`, "");
    const m = new Map<string, Record<CaseClass, number>>();
    for (const r of reports) {
      for (const f of pick(r)) {
        const row = m.get(f) ?? (Object.fromEntries(CLASSES.map((k) => [k, 0])) as Record<CaseClass, number>);
        row[r.class]++;
        m.set(f, row);
      }
    }
    if (m.size === 0) {
      L.push("（なし）", "");
      return;
    }
    L.push(`| 事柄 | 件数 | ${CLASSES.join(" | ")} |`, `|---|---:|${CLASSES.map(() => "---:").join("|")}|`);
    for (const [f, row] of [...m.entries()].sort((a, b) => CLASSES.reduce((x, k) => x + b[1][k], 0) - CLASSES.reduce((x, k) => x + a[1][k], 0))) {
      L.push(`| ${mdCell(f)} | ${CLASSES.reduce((x, k) => x + row[k], 0)} | ${CLASSES.map((k) => (row[k] ? String(row[k]) : "")).join(" | ")} |`);
    }
    L.push("");
  };
  featureTable("アプリに入力のしかたがない事柄（unrepresentable）", (r) => r.unrepresentable);
  featureTable("近似して入力した事柄（approximations）", (r) => r.approximations);

  // WRONG の例
  L.push("## WRONG の例（計算の誤りを先に、最大20件）", "");
  const sev = (r: CaseReport) => Math.max(0, ...r.diffs.map((d) => Math.abs(d.diff ?? 0)));
  // 並べ方：そのまま入力 → 近似を取り除いても違うもの → 近似で説明できるもの。同じなら差の大きい順
  const rank = (r: CaseReport) => (r.wrongKind === "exact" ? 0 : r.residual && !r.residual.explained ? 1 : 2);
  const examples = [...wrong].sort((a, b) => rank(a) - rank(b) || sev(b) - sev(a)).slice(0, 20);
  if (examples.length === 0) L.push("（なし）", "");
  const field: Record<Diff["field"], string> = {
    taxablePrice: "課税価格",
    payable: "納付税額",
    totalTaxablePrice: "課税価格の合計",
    totalTax: "相続税の総額",
    legalHeirCount: "法定相続人の数",
    basicDeduction: "基礎控除",
    filingRequired: "申告の要否",
    computable: "自動計算の対象",
  };
  for (const r of examples) {
    L.push(`### ${r.id}（${r.wrongKind === "exact" ? "そのまま入力" : "近似して入力"}）${mdCell(r.title)}`, "");
    L.push(`- タグ：${r.tags.join("、")}`);
    if (r.approximations.length) L.push(`- 近似：${r.approximations.join("、")}`);
    if (r.oracle && !r.oracle.computable) L.push(`- 正しい答えでは対象外：${r.oracle.outOfScope}`);
    L.push("", "| 人 | 項目 | アプリ | 正しい答え | 差 |", "|---|---|---:|---:|---:|");
    for (const d of r.diffs) L.push(`| ${d.who === "*" ? "（合計）" : `${d.name ?? ""}（${d.who}）`} | ${field[d.field]} | ${yenText(d.app)} | ${yenText(d.oracle)} | ${d.diff !== undefined ? yenText(d.diff) : ""} |`);
    L.push("");
    if (r.residual) {
      L.push(
        r.residual.explained
          ? "- 近似を取り除いたシナリオでは一致（違いは近似した事柄で説明できる）"
          : `- 近似を取り除いても ${r.residual.class}：${r.residual.diffs.map((d) => `${d.who === "*" ? "" : d.who + " "}${field[d.field]} ${d.diff !== undefined ? yenText(d.diff) : `${d.app}/${d.oracle}`}`).join("、") || "（差なし）"}${r.residual.left.length ? `（残った事柄：${r.residual.left.join("、")}）` : ""}`,
        "",
      );
    }
  }

  // 取り除いても違う件（ほかの誤りが隠れている）
  const hidden = reports.filter((r) => r.residual && !r.residual.explained);
  L.push("## 近似・入力できない事柄を取り除いても答えが違う件", "");
  if (hidden.length === 0) L.push("（なし）", "");
  else {
    L.push("| シナリオ | 分類 | 取り除いた後 | 差 | 残った事柄 |", "|---|---|---|---|---|");
    for (const r of hidden.slice(0, 40)) {
      const ds = r.residual!.diffs.map((d) => `${d.who === "*" ? "" : d.who + " "}${field[d.field]} ${d.diff !== undefined ? yenText(d.diff) : `${d.app}/${d.oracle}`}`).join("、");
      L.push(`| ${r.id} | ${r.class} | ${r.residual!.class} | ${mdCell(ds)} | ${mdCell(r.residual!.left.join("、"))} |`);
    }
    L.push("");
  }

  // 書類・手続き
  L.push("## 手続き・入力の形・書類の問題（多い順）", "");
  const docs = new Map<string, { k: number; example: string }>();
  for (const r of docBad) {
    for (const m of new Set(r.docErrors.map((x) => normalizeMessage(x, namesOf.get(r.id) ?? [])))) {
      const e = docs.get(m) ?? { k: 0, example: r.id };
      e.k++;
      docs.set(m, e);
    }
  }
  if (docs.size === 0) L.push("（なし）", "");
  else {
    L.push("| 件数 | 内容 | 例 |", "|---:|---|---|");
    for (const [m, e] of [...docs.entries()].sort((a, b) => b[1].k - a[1].k).slice(0, 30)) L.push(`| ${e.k} | ${mdCell(m.length > 200 ? m.slice(0, 200) + "…" : m)} | ${e.example} |`);
    L.push("");
  }

  // 例外
  const crashes = reports.filter((r) => r.class === "CRASH" || r.class === "HARNESS_ERROR");
  L.push("## CRASH・HARNESS_ERROR", "");
  if (crashes.length === 0) L.push("（なし）", "");
  for (const r of crashes.slice(0, 30)) L.push(`- ${r.id} ${r.class}：${mdCell(r.errors.join(" ／ ").slice(0, 300))}`);
  L.push("");

  // 時間
  L.push("## 時間のかかったシナリオ", "");
  for (const r of [...reports].sort((a, b) => b.ms + (b.docMs ?? 0) - (a.ms + (a.docMs ?? 0))).slice(0, 5)) {
    L.push(`- ${r.id}：${r.ms}ミリ秒${r.docMs !== undefined ? `（PDF ${r.docMs}ミリ秒）` : ""} ${mdCell(r.title)}`);
  }
  L.push("");
  return L.join("\n");
}

/* ------------------------------------------------------------------ */
/* 直接実行したとき                                                      */
/* ------------------------------------------------------------------ */

/** 1件ずつ順に処理する（1件の失敗で全体を止めない） */
async function runSequential(list: Scenario[], opts: RunOptions, progress: boolean): Promise<CaseReport[]> {
  const reports: CaseReport[] = [];
  for (const [i, s] of list.entries()) {
    let rep: CaseReport;
    try {
      rep = await runScenarioAsync(s, opts);
    } catch (e) {
      // ここまで来るのは実行側の不具合
      rep = { id: s.id, title: s.title, tags: s.tags, class: "HARNESS_ERROR", blockers: [], diffs: [], unrepresentable: [], approximations: [], errors: [`run: ${errText(e)}`], docErrors: [], tolerated: [], ms: 0 };
    }
    reports.push(rep);
    if (progress && (i + 1) % 25 === 0) process.stderr.write(`  ${i + 1}/${list.length}\n`);
  }
  return reports;
}

/**
 * --forms は申告書のPDFに時間がかかるので、シナリオを jobs 個に分けて別のプロセスで並べて動かし、結果をまとめる。
 * 子のプロセスは同じスクリプトを --shard k/N で動かし、DIR/shards/k/report.json に書く。
 */
async function runSharded(args: string[], outDir: string, jobs: number, order: string[]): Promise<CaseReport[]> {
  const { spawn } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");
  const script = path.resolve(__dirname, "run.ts");
  const base = args.filter((a, i) => !["--jobs", "--out"].includes(a) && !["--jobs", "--out"].includes(args[i - 1] ?? ""));
  const runs = Array.from({ length: jobs }, (_, k) => {
    const dir = path.join(outDir, "shards", String(k));
    return new Promise<CaseReport[]>((resolve) => {
      const child = spawn(process.execPath, [...process.execArgv, script, ...base, "--shard", `${k}/${jobs}`, "--out", dir], { stdio: ["ignore", "ignore", "inherit"] });
      // 子のプロセスが止まったままにならないよう、3時間で打ち切る
      const timer = setTimeout(() => child.kill("SIGKILL"), 3 * 60 * 60_000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        try {
          resolve((JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) as { reports: CaseReport[] }).reports);
        } catch (e) {
          process.stderr.write(`  分けた実行 ${k} の結果を読めない（終了コード ${code}）：${errText(e)}\n`);
          resolve([]);
        }
      });
    });
  });
  const all = (await Promise.all(runs)).flat();
  const idx = new Map(order.map((id, i) => [id, i]));
  return all.sort((a, b) => (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const forms = args.includes("--forms");
  const limit = opt("--limit") ? Number(opt("--limit")) : undefined;
  const seed = opt("--seed") ? Number(opt("--seed")) : 20261108;
  const only = opt("--only");
  const outDir = opt("--out") ?? "/tmp/claude-0/cases";
  const shard = opt("--shard")?.split("/").map(Number);
  const jobs = Math.max(1, Number(opt("--jobs") ?? Math.min(4, (await import("node:os")).availableParallelism?.() ?? 4)));
  // 申告書のPDFは renderEvery 件に1件だけ作る（ほかの件も欄の割り当て・様式の欄・字形の確かめと協議書・登記申請書は作る）
  const renderEvery = Math.max(1, Number(opt("--render-every") ?? 1));
  // PDF の部品はフォントなどをリポジトリの直下から読むので、そこで動かす
  process.chdir(path.resolve(__dirname, "../.."));

  const t0 = performance.now();
  let list = generateScenarios(limit ?? 1000, seed);
  if (limit !== undefined) list = list.slice(0, limit);
  if (only) {
    for (const s of list.filter((x) => x.id === only)) {
      const rep = runScenario(s, { details: true });
      const exp = rep._expected;
      const c = rep._case;
      const r = rep._result;
      delete rep._case;
      delete rep._result;
      delete rep._expected;
      console.log(JSON.stringify({ report: rep, oracleNotes: exp?.notes, case: c, appWarnings: r?.warnings }, null, 2));
    }
    return;
  }
  const namesOf = new Map(list.map((s) => [s.id, [...s.members.map((m) => m.name), ...s.estate.map((it) => it.label), ...s.debts.map((d) => d.label)]]));
  const order = list.map((s) => s.id);

  let reports: CaseReport[];
  if (forms && !shard && jobs > 1 && list.length > 1) {
    process.stderr.write(`書類のPDFを ${jobs} 個のプロセスで作ります（1件あたり数秒）\n`);
    reports = await runSharded(args, outDir, jobs, order);
    // 子のプロセスが落ちて結果のない件も、数から消えないようにする
    const got = new Set(reports.map((r) => r.id));
    for (const s of list) {
      if (!got.has(s.id)) reports.push({ id: s.id, title: s.title, tags: s.tags, class: "HARNESS_ERROR", blockers: [], diffs: [], unrepresentable: [], approximations: [], errors: ["run: 分けた実行の結果がない"], docErrors: [], tolerated: [], ms: 0 });
    }
  } else {
    if (shard) list = list.filter((_, i) => i % shard[1] === shard[0]);
    const indexOf = new Map(order.map((id, i) => [id, i]));
    const opts = (s: Scenario): RunOptions => ({ forms, details: true, renderForms: (indexOf.get(s.id) ?? 0) % renderEvery === 0 });
    reports = [];
    const who = shard ? `[${shard[0] + 1}/${shard[1]}] ` : "";
    for (const s of list) {
      reports.push(...(await runSequential([s], opts(s), false)));
      if (forms && reports.length % 25 === 0) process.stderr.write(`  ${who}${reports.length}/${list.length}件\n`);
    }
  }
  const totalMs = performance.now() - t0;
  const meta: Meta = { seed, n: reports.length, forms, totalMs, generatedAt: new Date().toISOString() };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ meta, totals: countClasses(reports), reports }, null, 1) + "\n");
  if (shard) return;
  writeFileSync(path.join(outDir, "report.md"), renderMarkdown(reports, meta, namesOf) + "\n");

  const totals = countClasses(reports);
  const wrong = reports.filter((r) => r.class === "WRONG");
  const docBad = reports.filter((r) => r.docErrors.length);
  console.log(`シナリオ ${reports.length}件（seed ${seed}）${(totalMs / 1000).toFixed(1)}秒${forms ? `（書類のPDFあり${renderEvery > 1 ? `、申告書は${renderEvery}件に1件` : ""}）` : ""}`);
  for (const k of CLASSES) console.log(`  ${k.padEnd(20)} ${String(totals[k]).padStart(5)}  ${pct(totals[k], reports.length)}`);
  console.log(`  WRONG の内訳：そのまま入力 ${wrong.filter((r) => r.wrongKind === "exact").length}件・近似して入力 ${wrong.filter((r) => r.wrongKind === "approx").length}件（上限 WRONG_BUDGET=${WRONG_BUDGET}）`);
  console.log(`  端数の差を許した件 ${reports.filter((r) => r.tolerated.length).length}件・手続き/入力の形/書類の問題 ${docBad.length}件`);
  console.log(`  ${path.join(outDir, "report.md")}`);
  if (totals.CRASH || totals.HARNESS_ERROR || (limit === undefined && seed === 20261108 && totals.WRONG > WRONG_BUDGET)) process.exitCode = 1;
}

if (process.argv[1] && /run\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
