/**
 * 相続のテストケース（シナリオ）を作る。
 *
 * - 最初に手で設計した境界・特殊ケース（id は E001〜）を並べ、
 * - 残りは、実際の相続税の申告に近い分布で乱数から作る（id は R0001〜）。
 *
 * 乱数は自前の mulberry32 を使い（Math.random は使わない）、同じ seed なら必ず同じシナリオになる。
 * シナリオごとに seed とシナリオ番号から別の乱数列を作るので、件数 n を変えても先頭のシナリオは変わらない。
 *
 * 直接実行すると JSON を標準出力に書き、検査結果とタグの集計を標準エラーに書く。
 *   npx tsx scripts/cases/generate.ts > /tmp/claude-0/cases/scenarios.json
 *   npx tsx scripts/cases/generate.ts --n 200 --seed 1 --out /tmp/claude-0/cases/small.json
 *
 * 決まりごと（scenario.ts に書いていないもの）
 * - smallLand（小規模宅地等の特例）は、1人目の取得者が要件（配偶者・同居親族・家なき子・事業や貸付の継続など）を満たしている前提で付ける
 *   （src/domain/__tests__/cases.test.ts が、1人目の「適用する」を確かめる）。要件を満たさない人は others（2人目以降）にだけ書く。
 *   取得者は、その土地を（少なくとも一部）取得する人。共有で取得して取得者の持分だけ特例を使う例もある（タグ「小規模宅地（共有取得）」）。
 * - 孫養子かつ代襲相続人（二重資格）は relation "adoptedChild"・grandchildAdopted: true・substituteOf: 先に亡くなった子 で表す。
 * - 数次相続（diedAfter のある人）は、亡くなった時点では生きていた相続人なので、遺産を分ける相手になりうる（その人の相続人が協議する）。
 * - 相続人全員が放棄したときは、分ける遺産を置かず（division.shares は空）、放棄した人が受け取る保険金だけにする。
 * - 賃貸中のマンションには、scenario.ts にない leaseRatio（敷地の借地権割合）と rentRatio（賃貸割合）を付ける（型 CondoItemExt）。
 * - 3年以内贈与の贈与税額（giftTaxPaid）は、亡くなった方からの贈与だけがあったものとして計算する。
 *   亡くなった年の贈与は贈与税がかからない（相続税法21条の2④・21条の16）ので 0 円。
 * - 一部未分割（division.partlyUndivided）は、shares に無い財産と持分の合計が1に満たない財産の残りが未分割。
 *   遺言で遺贈する財産があるときは作らない（遺贈分は分割の対象にならず、穴埋め方式の合計の取り方が分かれるため）。
 * - 税理士に確かめた補正率（advisorRate）は、路線価方式の不整形地・地積規模の大きな宅地だけに付ける（配偶者居住権のある土地には付けない）。
 * - 前の相続で受けた障害者控除（priorDisabilityCredit）は、special がなければ前の相続のときも今と同じ区分。区分が変わった人は special に
 *   前の相続のときの区分を書き、前の相続の日を今回の相続と同じ月日にする（年齢の差＝相続の間の年数。相基通19の4-4・19の4-5）。
 *   控除済みの額は、そのときの区分で受けられる額以下（超えるのは入力の矛盾を確かめるエッジケースだけ）。
 * - 未分割・一部未分割の相続で、相続人が亡くなった方から受けた相続時精算課税の贈与は、生計の資本などの贈与（特別受益）とする
 *   （質疑応答事例「未分割の場合の課税価格（相続時精算課税適用財産がある場合）」）。
 * - 代償分割と一部未分割を組み合わせるときは、代償金を払う人が分割で取得する額が代償金より十分大きいものだけ作る。
 * - 乱数のケースで、あとから足した事柄（貸家建付借地権・補正率・一部未分割・代償金の時価・前の相続の控除）は別の乱数列（extra）で決める。
 *   二度目の見直しで足した事柄（障害者控除の区分の変化・代償分割＋一部未分割・未分割＋精算課税）はさらに別の乱数列（extra2）で決める。
 *   三度目の見直しで足した事柄（小規模宅地等を共有で何人も使う・面積の一部だけに使う）は別の乱数列（extra3）で決める。
 *   元からある事柄の乱数列は変わらない。
 * - smallLand.others は、同じ宅地を一緒に取得して自分の持分にも特例を使う2人目以降。人ごとの要件（同居・住み続け/続け・持ち続け）は
 *   書かなければ満たしている。livedTogether: false は同居していない親族で、家なき子の要件は扱わず使えないものとする。
 *   selectedSqm は特例を使う面積の上限（付表1の⑤。持分に応ずる面積より大きければその面積まで）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Division,
  EstateItem,
  LandUse,
  LandValuation,
  Member,
  MemberRelation,
  PriorCredit,
  Scenario,
  ScenarioCompensation,
  ScenarioDebt,
  ScenarioGift,
  ScenarioRoad,
  SmallLandKind,
  SmallLandUse,
  SmallLandUser,
} from "./scenario";
import { BANKS, COMPANIES, FEMALE_NAMES, INSURERS, KANJI_NUM, MALE_NAMES, PLACES, SURNAMES, type Place } from "./names";

// ───────────────────────── 型 ─────────────────────────

type LandItem = Extract<EstateItem, { type: "land" }>;
type BuildingItem = Extract<EstateItem, { type: "building" }>;
type CondoItem = Extract<EstateItem, { type: "condo" }>;
type ListedItem = Extract<EstateItem, { type: "listedStock" }>;
type UnlistedItem = Extract<EstateItem, { type: "unlistedStock" }>;
type MoneyItem = Extract<EstateItem, { amount: number; type: "deposit" | "cash" | "household" | "other" }>;
type DeemedItem = Extract<EstateItem, { recipient: string }>;
type Letter = ScenarioRoad["leaseLetter"];
type District = Extract<LandValuation, { kind: "rosenka" }>["district"];
type Prices = ListedItem["prices"];

/** scenario.ts にない項目（このファイルだけで追加）。賃貸中のマンションの敷地の借地権割合と賃貸割合 */
export type CondoItemExt = CondoItem & { leaseRatio?: number; rentRatio?: number };

// ───────────────────────── 乱数 ─────────────────────────

/** mulberry32：32ビットの種から 0 以上 1 未満の数を順に出す */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32ビットのかき混ぜ（MurmurHash3 の最終処理） */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** seed とシナリオ番号から、シナリオごとの種を作る（seed を先にかき混ぜるので、seed+1 が番号のずれた同じ列にならない） */
function mixSeed(seed: number, k: number): number {
  return fmix32((fmix32(seed >>> 0) + Math.imul(k + 1, 0x9e3779b9)) >>> 0);
}

export class Rng {
  private readonly f: () => number;
  constructor(seed: number) {
    this.f = mulberry32(seed);
  }
  next(): number {
    return this.f();
  }
  /** a 以上 b 以下の整数 */
  int(a: number, b: number): number {
    return a + Math.floor(this.f() * (b - a + 1));
  }
  range(a: number, b: number): number {
    return a + this.f() * (b - a);
  }
  chance(p: number): boolean {
    return this.f() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.f() * arr.length)];
  }
  weighted<T>(pairs: readonly (readonly [T, number])[]): T {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = this.f() * total;
    for (const [v, w] of pairs) {
      r -= w;
      if (r < 0) return v;
    }
    return pairs[pairs.length - 1][0];
  }
  /** 標準正規分布（ボックス＝ミュラー法） */
  normal(): number {
    const u = 1 - this.f();
    const v = this.f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** 対数正規分布（中央値 median、ばらつき sigma） */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }
  /** 対数正規分布で、lo〜hi に入るまで引き直す（端に集まらないように） */
  logNormalIn(median: number, sigma: number, lo: number, hi: number): number {
    for (let i = 0; i < 20; i++) {
      const x = this.logNormal(median, sigma);
      if (x >= lo && x <= hi) return x;
    }
    return Math.min(hi, Math.max(lo, median));
  }
}

// ───────────────────────── 日付・数 ─────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");
function ymd(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m, d];
}
function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function addDays(s: string, n: number): string {
  const [y, m, d] = ymd(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function addMonths(s: string, n: number): string {
  const [y0, m, d] = ymd(s);
  const mm = m - 1 + n;
  const y = y0 + Math.floor(mm / 12);
  const m1 = (((mm % 12) + 12) % 12) + 1;
  return fmt(y, m1, Math.min(d, daysInMonth(y, m1)));
}
export function addYears(s: string, n: number): string {
  return addMonths(s, 12 * n);
}
/** date の時点の満年齢 */
export function ageAt(birth: string, date: string): number {
  const [by, bm, bd] = ymd(birth);
  const [y, m, d] = ymd(date);
  let a = y - by;
  if (m < bm || (m === bm && d < bd)) a--;
  return a;
}
function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = ymd(a);
  const [y2, m2, d2] = ymd(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = ymd(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
/** death の時点でちょうど age 歳になる生年月日（誕生日はランダム） */
function birthForAge(age: number, death: string, rng: Rng): string {
  return addDays(addYears(death, -age), -rng.int(0, 360));
}
function randomDate(rng: Rng, from: string, to: string): string {
  return addDays(from, rng.int(0, Math.max(0, daysBetween(from, to))));
}
const round2 = (x: number) => Math.round(x * 100) / 100;
const round1 = (x: number) => Math.round(x * 10) / 10;
const roundTo = (x: number, unit: number) => Math.max(unit, Math.round(x / unit) * unit);
const floorTo = (x: number, unit: number) => Math.floor(x / unit) * unit;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

// ───────────────────────── 贈与税（giftTaxPaid の計算用） ─────────────────────────

// [基礎控除後の課税価格の上限, 税率(%), 控除額]
const GIFT_GENERAL: readonly [number, number, number][] = [
  [2_000_000, 10, 0], [3_000_000, 15, 100_000], [4_000_000, 20, 250_000], [6_000_000, 30, 650_000],
  [10_000_000, 40, 1_250_000], [15_000_000, 45, 1_750_000], [30_000_000, 50, 2_500_000], [Infinity, 55, 4_000_000],
];
const GIFT_SPECIAL: readonly [number, number, number][] = [
  [2_000_000, 10, 0], [4_000_000, 15, 100_000], [6_000_000, 20, 300_000], [10_000_000, 30, 900_000],
  [15_000_000, 40, 1_900_000], [30_000_000, 45, 2_650_000], [45_000_000, 50, 4_150_000], [Infinity, 55, 6_400_000],
];

/** 暦年課税の贈与税（基礎控除110万円。special は直系尊属から18歳以上への特例税率） */
export function calendarGiftTax(total: number, special: boolean): number {
  const base = floorTo(Math.max(0, total - 1_100_000), 1000);
  for (const [limit, rate, ded] of special ? GIFT_SPECIAL : GIFT_GENERAL) {
    if (base <= limit) return floorTo(Math.max(0, Math.floor((base * rate) / 100) - ded), 100);
  }
  return 0;
}

type DraftGift = Omit<ScenarioGift, "giftTaxPaid"> & { giftTaxPaid?: number };

/** 贈与税額を、受贈者・年・課税方式ごとにまとめて計算し、贈与ごとに按分する */
function fillGiftTaxes(gifts: DraftGift[], members: Member[], deathDate: string): ScenarioGift[] {
  const deathYear = Number(deathDate.slice(0, 4));
  const out = gifts.map((g) => ({ ...g })) as (DraftGift & { giftTaxPaid?: number })[];
  const lineal: MemberRelation[] = ["child", "adoptedChild", "grandchild", "greatGrandchild"];
  const byKey = new Map<string, number[]>();
  out.forEach((g, i) => {
    const key = `${g.to}|${g.settlement ? "S" : "C"}|${g.settlement ? "" : g.date.slice(0, 4)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  });
  const allocate = (idx: number[], tax: number) => {
    const total = idx.reduce((s, i) => s + out[i].amount, 0);
    let left = tax;
    idx.forEach((i, k) => {
      const part = k === idx.length - 1 ? left : floorTo((tax * out[i].amount) / total, 100);
      left -= part;
      if (out[i].giftTaxPaid === undefined) out[i].giftTaxPaid = part;
    });
  };
  for (const [key, idx] of byKey) {
    const [to, kind] = key.split("|");
    const m = members.find((x) => x.id === to);
    if (kind === "C") {
      const year = Number(out[idx[0]].date.slice(0, 4));
      const total = idx.reduce((s, i) => s + out[i].amount, 0);
      const special = !!m && lineal.includes(m.relation) && ageAt(m.birthDate, `${year}-01-01`) >= 18;
      allocate(idx, year === deathYear ? 0 : calendarGiftTax(total, special));
    } else {
      // 相続時精算課税：特別控除2,500万円（累計）、令和6年以降は年110万円の基礎控除、税率20%
      let remaining = 25_000_000;
      const years = [...new Set(idx.map((i) => Number(out[i].date.slice(0, 4))))].sort((a, b) => a - b);
      for (const y of years) {
        const yi = idx.filter((i) => Number(out[i].date.slice(0, 4)) === y);
        const total = yi.reduce((s, i) => s + out[i].amount, 0);
        const base = Math.max(0, total - (y >= 2024 ? 1_100_000 : 0));
        const use = Math.min(remaining, base);
        remaining -= use;
        const tax = floorTo(Math.floor((floorTo(base - use, 1000) * 20) / 100), 100);
        allocate(yi, y === deathYear ? 0 : tax);
      }
    }
  }
  return out.map((g) => ({ ...g, giftTaxPaid: g.giftTaxPaid ?? 0 }));
}

// ───────────────────────── 相続人のおおまかな判定（分け方・タグを作るためだけ） ─────────────────────────

export interface HeirInfo {
  /** 民法の法定相続分（おおまか。分け方の目安とタグにだけ使う） */
  shares: Map<string, number>;
  order: "child" | "parent" | "grandparent" | "sibling" | "none";
  /** 子（または兄弟姉妹）の系統の数 */
  lines: number;
  spouse?: string;
}

/**
 * 分け方を作るための、おおまかな法定相続分。正しい答え（oracle.ts）とは別物で、ここでの誤りは
 * シナリオの「分け方の自然さ」にしか影響しない。
 */
export function heirInfo(ms: Member[]): HeirInfo {
  const subsOf = (id: string) => ms.filter((m) => m.substituteOf === id);
  const line = (root: Member, deep: boolean, level: number): [string, number][] | null => {
    if (!root.predeceased) return root.renounced ? null : [[root.id, 1]];
    if (!deep && level >= 1) return null;
    const parts = subsOf(root.id)
      .map((m) => line(m, deep, level + 1))
      .filter((x): x is [string, number][] => x !== null);
    if (!parts.length) return null;
    return parts.flatMap((p) => p.map(([id, w]) => [id, w / parts.length] as [string, number]));
  };
  const spouse = ms.find((m) => m.relation === "spouse" && !m.predeceased && !m.renounced);
  // 子の系統の起点：実子と養子（孫養子かつ代襲相続人は、養子としての系統と代襲の系統の両方に入る）
  const childRoots = ms.filter((m) => m.relation === "child" || m.relation === "adoptedChild");
  let lines: { parts: [string, number][]; w: number }[] = [];
  let order: HeirInfo["order"] = "none";
  let spouseShare = 1;
  const childLines = childRoots
    .map((r) => line(r, true, 0))
    .filter((x): x is [string, number][] => x !== null);
  if (childLines.length) {
    lines = childLines.map((parts) => ({ parts, w: 1 }));
    order = "child";
    spouseShare = 1 / 2;
  } else {
    const alive = (r: MemberRelation) => ms.filter((m) => m.relation === r && !m.predeceased && !m.renounced);
    const parents = alive("parent");
    const gps = alive("grandparent");
    if (parents.length || gps.length) {
      lines = (parents.length ? parents : gps).map((p) => ({ parts: [[p.id, 1]], w: 1 }));
      order = parents.length ? "parent" : "grandparent";
      spouseShare = 2 / 3;
    } else {
      const sl = ms
        .filter((m) => m.relation === "sibling")
        .map((r) => ({ parts: line(r, false, 0), w: r.halfBlood ? 1 : 2 }))
        .filter((x): x is { parts: [string, number][]; w: number } => x.parts !== null);
      if (sl.length) {
        lines = sl;
        order = "sibling";
        spouseShare = 3 / 4;
      }
    }
  }
  const shares = new Map<string, number>();
  const add = (id: string, v: number) => shares.set(id, (shares.get(id) ?? 0) + v);
  if (spouse) add(spouse.id, lines.length ? spouseShare : 1);
  const restTotal = spouse ? 1 - spouseShare : 1;
  const wsum = lines.reduce((s, l) => s + l.w, 0);
  for (const l of lines) for (const [id, w] of l.parts) add(id, (restTotal * l.w * w) / wsum);
  return { shares, order, lines: lines.length, spouse: spouse?.id };
}

// ───────────────────────── 財産のおおまかな評価（分け方・規模タグ用） ─────────────────────────

const LETTER_RATIO: Record<Letter, number> = { A: 0.9, B: 0.8, C: 0.7, D: 0.6, E: 0.5, F: 0.4, G: 0.3 };

export function roughValue(it: EstateItem): number {
  switch (it.type) {
    case "land": {
      let base: number;
      let lease: number;
      if (it.valuation.kind === "rosenka") {
        const f = it.valuation.roads.find((r) => r.position === "front") ?? it.valuation.roads[0];
        base = f.price * it.areaSqm * (it.valuation.roads.length > 1 ? 1.04 : 1);
        lease = LETTER_RATIO[f.leaseLetter];
      } else {
        base = it.valuation.fixedAssetValue * it.valuation.rate;
        lease = it.valuation.leaseRatio ?? 0.5;
      }
      const rr = it.rentRatio ?? 1;
      if (it.use === "rentedHouse") base *= 1 - lease * 0.3 * rr;
      else if (it.use === "leasedLand") base *= 1 - lease;
      else if (it.use === "leasehold") base *= lease;
      else if (it.use === "rentedLeasehold") base *= lease * (1 - 0.3 * rr);
      if (it.advisorRate !== undefined) base *= it.advisorRate;
      return Math.round(base);
    }
    case "building":
      return Math.round(it.fixedAssetValue * (it.rented ? 1 - 0.3 * (it.rentRatio ?? 1) : 1));
    case "condo":
      return it.landValue + it.buildingFixedAssetValue;
    case "listedStock":
      return Math.floor(it.shares * Math.min(it.prices.close, it.prices.monthAvg, it.prices.prevMonthAvg, it.prices.prev2MonthAvg));
    case "unlistedStock":
      return it.value;
    default:
      return it.amount;
  }
}

export const isDivisible = (it: EstateItem) => it.type !== "insurance" && it.type !== "retirement";

// ───────────────────────── 分割割合 ─────────────────────────

type Share = { who: string; n: number; d: number };

/**
 * 重みを分数の持分にする。重みが整数ならそのまま（約分して）使い、
 * 小数なら分母 2〜100 の中で誤差の小さい簡単な分数に丸める（合計は必ずちょうど 1）。
 */
export function toShares(weights: Record<string, number>): Share[] {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (!entries.length) throw new Error("toShares: 重みがない");
  let nums: number[];
  let d: number;
  if (entries.every(([, w]) => Number.isInteger(w)) && entries.reduce((s, [, w]) => s + w, 0) <= 1000) {
    nums = entries.map(([, w]) => w);
    d = nums.reduce((s, x) => s + x, 0);
  } else {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    const p = entries.map(([, w]) => w / total);
    let best: { d: number; nums: number[]; err: number } | null = null;
    for (const den of [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 25, 50, 100]) {
      const raw = p.map((x) => x * den);
      const fl = raw.map(Math.floor);
      let left = den - fl.reduce((s, x) => s + x, 0);
      const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
      for (const [, i] of order) {
        if (left <= 0) break;
        fl[i]++;
        left--;
      }
      const err = Math.max(...fl.map((x, i) => Math.abs(x / den - p[i])));
      if (!best || err < best.err) best = { d: den, nums: fl, err };
      if (err < 0.02) break;
    }
    nums = best!.nums;
    d = best!.d;
  }
  const out: Share[] = [];
  entries.forEach(([who], i) => {
    if (nums[i] <= 0) return;
    const g = gcd(nums[i], d);
    out.push({ who, n: nums[i] / g, d: d / g });
  });
  return out;
}

/** 金額を重みで分ける（円の整数。端数は重みの最も大きい人へ） */
function splitAmount(amount: number, weights: Record<string, number>): { who: string; amount: number }[] {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const parts = entries.map(([who, w]) => ({ who, amount: Math.floor((amount * w) / total) }));
  const left = amount - parts.reduce((s, p) => s + p.amount, 0);
  let maxI = 0;
  entries.forEach(([, w], i) => {
    if (w > entries[maxI][1]) maxI = i;
  });
  parts[maxI].amount += left;
  return parts.filter((p) => p.amount > 0);
}

// ───────────────────────── 組み立て（Builder） ─────────────────────────

interface PersonOpts {
  id?: string;
  /** 亡くなった日の時点の満年齢（先に亡くなった人は、生きていればの年齢） */
  age?: number;
  birthDate?: string;
  male?: boolean;
  surname?: string;
  /** 結婚して姓が変わった女性（省略時はランダム） */
  married?: boolean;
  /** 姓を受け継ぐ親（孫・甥姪など） */
  parentId?: string;
  predeceased?: boolean;
  renounced?: boolean;
  substituteOf?: string;
  halfBlood?: boolean;
  adoptedCountsAsBiological?: boolean;
  grandchildAdopted?: boolean;
  disability?: "general" | "special";
  nonResident?: boolean;
  diedAfter?: string;
  /** 胎児：亡くなった日の何日後に生まれたか */
  bornAfterDays?: number;
  /** 前の相続で受けた未成年者控除・障害者控除 */
  priorMinorCredit?: PriorCredit;
  priorDisabilityCredit?: PriorCredit;
}

interface RosenkaOpts {
  label?: string;
  district?: District;
  price: number;
  frontage: number;
  depth: number;
  area?: number;
  letter?: Letter;
  side?: number;
  side2?: number;
  back?: number;
  landUse?: LandItem["landUse"];
  use?: LandUse;
  rentRatio?: number;
  needsReduction?: LandItem["needsReduction"];
  /** 税理士に確かめた補正率（不整形地補正率・規模格差補正率） */
  advisorRate?: number;
  spouseResidenceRight?: boolean;
  /** 道路を直接書く（正面路線の判定の境界など。price・frontage・depth・side・back より優先） */
  roads?: ScenarioRoad[];
}

interface MultOpts {
  label?: string;
  area: number;
  fixedAssetValue: number;
  rate: number;
  leaseRatio?: number;
  landUse?: LandItem["landUse"];
  use?: LandUse;
  rentRatio?: number;
  needsReduction?: LandItem["needsReduction"];
  spouseResidenceRight?: boolean;
}

interface CondoOpts {
  label?: string;
  landValue: number;
  buildingFixedAssetValue: number;
  builtYears: number;
  builtMonths?: number;
  totalFloors: number;
  floor: number;
  landShareSqm: number;
  exclusiveAreaSqm: number;
  rented?: boolean;
  leaseRatio?: number;
  rentRatio?: number;
}

function letterFor(price: number, district: District = "普通住宅地区"): Letter {
  if (district === "ビル街地区" || district === "高度商業地区") return price > 3_000_000 ? "A" : "B";
  if (district === "繁華街地区" || district === "普通商業・併用住宅地区") return price > 600_000 ? "B" : "C";
  if (district === "中小工場地区" || district === "大工場地区") return price > 150_000 ? "D" : "E";
  if (price >= 450_000) return "C";
  if (price >= 150_000) return "D";
  if (price >= 80_000) return "E";
  return "F";
}

function givenName(rng: Rng, male: boolean, birthYear: number): string {
  const era = birthYear < 1965 ? "old" : birthYear < 1995 ? "mid" : "young";
  return rng.pick((male ? MALE_NAMES : FEMALE_NAMES)[era]);
}

const URBAN = PLACES.filter((p) => p.urban);
/** 三大都市圏（首都圏・近畿圏・中部圏の対象区域）を含む都府県。地積規模の大きな宅地の面積の下限（500㎡）の判定に使う近似 */
const METRO_PREFS = new Set(["東京都", "神奈川県", "埼玉県", "千葉県", "茨城県", "京都府", "大阪府", "兵庫県", "奈良県", "愛知県", "三重県"]);
const RURAL = PLACES.filter((p) => !p.urban);

export class Builder {
  readonly rng: Rng;
  readonly id: string;
  title = "";
  private readonly tagSet = new Set<string>();
  readonly surname: string;
  decedent!: Scenario["decedent"];
  decMale = true;
  members: Member[] = [];
  estate: EstateItem[] = [];
  debts: ScenarioDebt[] = [];
  gifts: DraftGift[] = [];
  shares: Record<string, Share[]> = {};
  compensation: ScenarioCompensation[] = [];
  isUndivided = false;
  /** 一部だけ分けた（shares に無い財産・持分の合計が1に満たない財産の残りが未分割） */
  isPartly = false;
  place: Place;
  town: string;
  chome: string;
  private readonly seq: Record<string, number> = {};
  private readonly surnameOf = new Map<string, string>();
  private readonly maleOf = new Map<string, boolean>();

  constructor(rng: Rng, id: string, rural = false) {
    this.rng = rng;
    this.id = id;
    this.surname = rng.pick(SURNAMES);
    this.place = rng.pick(rural ? RURAL : URBAN);
    this.town = rng.pick(this.place.towns);
    this.chome = rng.pick(KANJI_NUM.slice(0, 5));
  }
  /** 住まいを地方（倍率地域の多い市町村）に移す（dec より前に呼ぶ） */
  moveRural(): void {
    this.place = this.rng.pick(RURAL);
    this.town = this.rng.pick(this.place.towns);
  }

  get death(): string {
    return this.decedent.deathDate;
  }
  private nextId(prefix: string): string {
    const k = (this.seq[prefix] ?? 0) + 1;
    this.seq[prefix] = k;
    return `${prefix}${k}`;
  }
  member(id: string): Member {
    const m = this.members.find((x) => x.id === id);
    if (!m) throw new Error(`${this.id}: 人がいない ${id}`);
    return m;
  }
  otherSurname(): string {
    for (;;) {
      const s = this.rng.pick(SURNAMES);
      if (s !== this.surname) return s;
    }
  }
  /** 自宅の所在（住所と同じ町・丁目） */
  homeLocation(): string {
    return `${this.place.pref}${this.place.city}${this.town}${this.place.urban ? `${this.chome}丁目` : ""}`;
  }
  /** 住所と同じ市区町村の土地の所在 */
  location(): string {
    const town = this.rng.pick(this.place.towns);
    return `${this.place.pref}${this.place.city}${town}${this.place.urban ? `${this.rng.pick(KANJI_NUM.slice(0, 5))}丁目` : ""}`;
  }
  /** 郷里など、住所から離れた地方の土地の所在（住まいが地方ならその市町村） */
  farLocation(): string {
    if (!this.place.urban) return this.location();
    const p = this.rng.pick(RURAL);
    return `${p.pref}${p.city}${this.rng.pick(p.towns)}`;
  }

  dec(o: { age: number; deathDate?: string; male?: boolean; birthDate?: string; prior?: { yearsAgo: number; prevTax: number; prevAcquired: number } }): void {
    const deathDate = o.deathDate ?? addDays("2026-01-01", this.rng.int(0, 364));
    const birthDate = o.birthDate ?? birthForAge(o.age, deathDate, this.rng);
    this.decMale = o.male ?? this.rng.chance(0.6);
    const by = Number(birthDate.slice(0, 4));
    this.decedent = {
      name: `${this.surname} ${givenName(this.rng, this.decMale, by)}`,
      birthDate,
      deathDate,
      address: this.place.urban
        ? `${this.homeLocation()}${this.rng.int(1, 30)}番${this.rng.int(1, 20)}号`
        : `${this.homeLocation()}${this.rng.int(100, 3999)}番地${this.rng.chance(0.5) ? `の${this.rng.int(1, 9)}` : ""}`,
    };
    if (o.prior) this.decedent.priorInheritance = o.prior;
  }
  get decAge(): number {
    return ageAt(this.decedent.birthDate, this.death);
  }

  person(relation: MemberRelation, prefix: string, o: PersonOpts = {}): string {
    const id = o.id ?? this.nextId(prefix);
    if (this.members.some((m) => m.id === id)) throw new Error(`${this.id}: 人の id が重複 ${id}`);
    const male = o.male ?? this.rng.chance(0.5);
    const unborn = o.bornAfterDays !== undefined;
    const birthDate = o.birthDate ?? (unborn ? addDays(this.death, o.bornAfterDays!) : birthForAge(o.age ?? 50, this.death, this.rng));
    const age = ageAt(birthDate, this.death);
    let surname = o.surname ?? (o.parentId ? this.surnameOf.get(o.parentId) ?? this.surname : this.surname);
    if (relation === "other" && !o.surname) surname = this.otherSurname();
    const marriageable = (relation === "child" || relation === "sibling" || relation === "grandchild" || relation === "nephewNiece") && !male && age >= 26;
    if (!o.surname && marriageable && (o.married ?? this.rng.chance(0.5))) surname = this.otherSurname();
    let name = "";
    for (let i = 0; i < 30; i++) {
      name = `${surname} ${givenName(this.rng, male, Number(birthDate.slice(0, 4)))}`;
      if (name !== this.decedent.name && !this.members.some((x) => x.name === name)) break;
    }
    const m: Member = { id, name, relation, birthDate };
    if (o.predeceased) m.predeceased = true;
    if (o.substituteOf) m.substituteOf = o.substituteOf;
    if (o.renounced) m.renounced = true;
    if (o.halfBlood) m.halfBlood = true;
    if (o.adoptedCountsAsBiological) m.adoptedCountsAsBiological = true;
    if (o.grandchildAdopted) m.grandchildAdopted = true;
    if (o.disability) m.disability = o.disability;
    if (o.nonResident) m.nonResident = true;
    if (o.diedAfter) m.diedAfter = o.diedAfter;
    if (unborn) m.unborn = true;
    if (o.priorMinorCredit) m.priorMinorCredit = o.priorMinorCredit;
    if (o.priorDisabilityCredit) m.priorDisabilityCredit = o.priorDisabilityCredit;
    this.members.push(m);
    this.surnameOf.set(id, surname);
    this.maleOf.set(id, male);
    return id;
  }
  spouse(o: PersonOpts = {}): string {
    return this.person("spouse", "sp", { id: "sp", male: !this.decMale, ...o });
  }
  child(o: PersonOpts = {}): string {
    return this.person("child", "c", o);
  }
  adopted(o: PersonOpts = {}): string {
    return this.person("adoptedChild", "a", o);
  }
  grandchild(parentId: string, o: PersonOpts = {}): string {
    const sub = this.member(parentId).predeceased ? { substituteOf: parentId } : {};
    return this.person("grandchild", "g", { parentId, ...sub, ...o });
  }
  greatGrandchild(parentId: string, o: PersonOpts = {}): string {
    const sub = this.member(parentId).predeceased ? { substituteOf: parentId } : {};
    return this.person("greatGrandchild", "gg", { parentId, ...sub, ...o });
  }
  parent(male: boolean, o: PersonOpts = {}): string {
    return this.person("parent", male ? "fa" : "mo", { male, surname: this.surname, ...o });
  }
  grandparent(male: boolean, o: PersonOpts = {}): string {
    return this.person("grandparent", "gp", { male, ...o });
  }
  sibling(o: PersonOpts = {}): string {
    return this.person("sibling", "b", o);
  }
  nephew(parentId: string, o: PersonOpts = {}): string {
    const sub = this.member(parentId).predeceased ? { substituteOf: parentId } : {};
    return this.person("nephewNiece", "n", { parentId, ...sub, ...o });
  }
  other(o: PersonOpts = {}): string {
    return this.person("other", "o", o);
  }

  // ── 財産 ──
  private push<T extends EstateItem>(it: T): string {
    this.estate.push(it);
    return it.id;
  }
  money(type: MoneyItem["type"], amount: number, label: string, foreign = false): string {
    const it: MoneyItem = { id: this.nextId(type === "deposit" ? "D" : type === "cash" ? "C" : type === "household" ? "H" : "O"), type, label, amount };
    if (foreign) it.foreign = true;
    return this.push(it);
  }
  deposit(amount: number, label?: string, foreign = false): string {
    return this.money("deposit", amount, label ?? `${this.rng.pick(BANKS)} ${this.rng.pick(["普通預金", "定期預金", "普通預金", "通常貯金"])}`, foreign);
  }
  cash(amount: number): string {
    return this.money("cash", amount, "手許現金");
  }
  household(amount: number): string {
    return this.money("household", amount, "家庭用財産（家具・家電など）");
  }
  otherAsset(amount: number, label: string, foreign = false): string {
    return this.money("other", amount, label, foreign);
  }
  listed(shares: number, prices: Prices, label?: string): string {
    const it: ListedItem = { id: this.nextId("S"), type: "listedStock", label: label ?? `${this.rng.pick(COMPANIES)} 株式`, shares, prices };
    return this.push(it);
  }
  unlisted(shares: number, value: number, label?: string): string {
    const it: UnlistedItem = { id: this.nextId("U"), type: "unlistedStock", label: label ?? `株式会社${this.surname}商事 株式`, shares, value };
    return this.push(it);
  }
  insurance(amount: number, recipient: string, label?: string): string {
    const it: DeemedItem = { id: this.nextId("I"), type: "insurance", label: label ?? `${this.rng.pick(INSURERS)} 死亡保険金`, amount, recipient };
    return this.push(it);
  }
  retirement(amount: number, recipient: string, label = "勤務先からの死亡退職金"): string {
    const it: DeemedItem = { id: this.nextId("R"), type: "retirement", label, amount, recipient };
    return this.push(it);
  }
  landR(o: RosenkaOpts): string {
    const district = o.district ?? "普通住宅地区";
    const letter = o.letter ?? letterFor(o.price, district);
    const roads: ScenarioRoad[] = o.roads ? o.roads.map((r) => ({ ...r })) : [{ position: "front", price: o.price, depth: o.depth, frontage: o.frontage, leaseLetter: letter }];
    if (!o.roads && o.side) roads.push({ position: "side", price: o.side, depth: o.frontage, frontage: o.depth, leaseLetter: letter });
    if (!o.roads && o.side2) roads.push({ position: "side", price: o.side2, depth: o.frontage, frontage: o.depth, leaseLetter: letter });
    if (!o.roads && o.back) roads.push({ position: "back", price: o.back, depth: o.depth, frontage: o.frontage, leaseLetter: letter });
    const it: LandItem = {
      id: this.nextId("L"),
      type: "land",
      label: o.label ?? `土地（${this.location()}）`,
      areaSqm: o.area ?? round2(o.frontage * o.depth),
      landUse: o.landUse ?? "宅地",
      valuation: { kind: "rosenka", district, roads },
      use: o.use ?? "self",
    };
    if (o.rentRatio !== undefined) it.rentRatio = o.rentRatio;
    if (o.needsReduction) it.needsReduction = o.needsReduction;
    if (o.advisorRate !== undefined) it.advisorRate = o.advisorRate;
    if (o.spouseResidenceRight) it.spouseResidenceRight = true;
    return this.push(it);
  }
  landM(o: MultOpts): string {
    const valuation: LandValuation = { kind: "multiplier", fixedAssetValue: o.fixedAssetValue, rate: o.rate };
    if (o.leaseRatio !== undefined) valuation.leaseRatio = o.leaseRatio;
    const it: LandItem = {
      id: this.nextId("L"),
      type: "land",
      label: o.label ?? `土地（${this.location()}）`,
      areaSqm: o.area,
      landUse: o.landUse ?? "宅地",
      valuation,
      use: o.use ?? "self",
    };
    if (o.rentRatio !== undefined) it.rentRatio = o.rentRatio;
    if (o.needsReduction) it.needsReduction = o.needsReduction;
    if (o.spouseResidenceRight) it.spouseResidenceRight = true;
    return this.push(it);
  }
  building(fixedAssetValue: number, o: { label?: string; rented?: boolean; rentRatio?: number } = {}): string {
    const it: BuildingItem = { id: this.nextId("B"), type: "building", label: o.label ?? "自宅の建物", fixedAssetValue };
    if (o.rented) it.rented = true;
    if (o.rentRatio !== undefined) it.rentRatio = o.rentRatio;
    return this.push(it);
  }
  condo(o: CondoOpts): string {
    const it: CondoItemExt = {
      id: this.nextId("M"),
      type: "condo",
      label: o.label ?? `マンション（${this.homeLocation()}）`,
      landValue: o.landValue,
      buildingFixedAssetValue: o.buildingFixedAssetValue,
      builtYears: o.builtYears,
      builtMonths: o.builtMonths ?? 0,
      totalFloors: o.totalFloors,
      floor: o.floor,
      landShareSqm: o.landShareSqm,
      exclusiveAreaSqm: o.exclusiveAreaSqm,
    };
    if (o.rented) {
      it.rented = true;
      it.leaseRatio = o.leaseRatio ?? 0.6;
      it.rentRatio = o.rentRatio ?? 1;
    }
    return this.push(it);
  }
  item(id: string): EstateItem {
    const it = this.estate.find((x) => x.id === id);
    if (!it) throw new Error(`${this.id}: 財産がない ${id}`);
    return it;
  }
  /**
   * 小規模宅地等の特例を使う。o で1人目の人ごとの要件・特例を使う面積（selectedSqm）と、
   * 同じ土地を一緒に取得して自分の持分にも特例を使う2人目以降（others）を書ける
   */
  smallLand(itemId: string, kind: SmallLandKind, acquirer: string, o: Omit<SmallLandUser, "acquirer"> & { others?: SmallLandUser[] } = {}): void {
    const it = this.item(itemId);
    if (it.type !== "land" && it.type !== "condo") throw new Error(`${this.id}: 小規模宅地は土地かマンションだけ`);
    const sl: SmallLandUse = { kind, acquirer, ...o };
    if (o.others) sl.others = o.others.map((x) => ({ ...x }));
    it.smallLand = sl;
  }

  // ── 債務・葬式費用 ──
  debt(amount: number, bearer: string | Record<string, number>, label = "借入金", kind: ScenarioDebt["kind"] = "debt"): string {
    const id = this.nextId(kind === "funeral" ? "F" : "X");
    const bearers = typeof bearer === "string" ? [{ who: bearer, amount }] : splitAmount(amount, bearer);
    this.debts.push({ id, kind, label, amount, bearers });
    return id;
  }
  funeral(amount: number, bearer: string | Record<string, number>, label = "葬式費用（通夜・告別式・火葬）"): string {
    return this.debt(amount, bearer, label, "funeral");
  }

  // ── 贈与 ──
  gift(to: string, date: string, amount: number, o: { settlement?: boolean; giftTaxPaid?: number } = {}): void {
    const g: DraftGift = { to, date, amount };
    if (o.settlement) g.settlement = true;
    if (o.giftTaxPaid !== undefined) g.giftTaxPaid = o.giftTaxPaid;
    this.gifts.push(g);
  }

  // ── 分け方 ──
  give(itemId: string, w: string | Record<string, number>): void {
    this.item(itemId);
    this.shares[itemId] = toShares(typeof w === "string" ? { [w]: 1 } : w);
  }
  /** まだ分けていない財産をすべて、重みの割合で分ける */
  split(w: Record<string, number>): void {
    for (const it of this.estate) if (isDivisible(it) && !this.shares[it.id]) this.give(it.id, w);
  }
  undivided(): void {
    this.isUndivided = true;
  }
  /** 一部未分割にする（give しなかった財産と、持分の合計が1に満たない財産の残りが未分割） */
  partlyUndivided(): void {
    this.isPartly = true;
  }
  /** 財産の一部の持分だけを決める（残りは未分割。partlyUndivided と一緒に使う） */
  givePart(itemId: string, parts: Share[]): void {
    this.item(itemId);
    this.shares[itemId] = parts.map((x) => ({ ...x }));
  }
  compensate(from: string, to: string, amount: number, basis?: { item: string; marketValue: number }): void {
    this.compensation.push(basis ? { from, to, amount, basis } : { from, to, amount });
  }
  tag(...t: string[]): void {
    for (const x of t) this.tagSet.add(x);
  }

  build(): Scenario {
    const gifts = fillGiftTaxes(this.gifts, this.members, this.death).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const division: Division = this.isUndivided
      ? { kind: "undivided" }
      : {
          kind: "agreed",
          shares: this.shares,
          ...(this.compensation.length ? { compensation: this.compensation } : {}),
          ...(this.isPartly ? { partlyUndivided: true as const } : {}),
        };
    const s: Scenario = {
      id: this.id,
      title: this.title,
      tags: [],
      decedent: this.decedent,
      members: this.members,
      estate: this.estate,
      debts: this.debts,
      gifts,
      division,
    };
    s.tags = [...new Set([...this.tagSet, ...autoTags(s)])];
    if (!s.title) s.title = autoTitle(s);
    return s;
  }
}

// ───────────────────────── タグと題名 ─────────────────────────

/** タグ用：奥行価格補正率（付表1、百分率）。正面路線の判定が同じ額になるかを見るためだけ */
const DEPTH_UPPER_T = [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100];
const DEPTH_T: Partial<Record<District, number[]>> = {
  普通住宅地区: [90, 92, 95, 97, 100, 100, 100, 100, 100, 97, 95, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 83, 82, 82, 81, 81, 81, 80],
  "普通商業・併用住宅地区": [90, 92, 95, 97, 99, 100, 100, 100, 100, 100, 100, 97, 95, 93, 91, 89, 88, 87, 86, 85, 84, 83, 82, 81, 80, 80, 80, 80, 80],
};
function depthPct(district: District, depth: number): number {
  const t = DEPTH_T[district];
  if (!t) return 100 + depth; // ほかの地区はタグに使わない（同じ額とみなさない値）
  let i = DEPTH_UPPER_T.findIndex((u) => depth < u);
  if (i < 0) i = DEPTH_UPPER_T.length;
  return t[i];
}

const DIRECT_DESC: MemberRelation[] = ["child", "adoptedChild", "grandchild", "greatGrandchild"];

export function familyTag(ms: Member[]): { tag: string; group: string } {
  const h = heirInfo(ms);
  const sp = !!h.spouse;
  switch (h.order) {
    case "child":
      return { tag: sp ? `配偶者と子${h.lines}人` : `子のみ${h.lines}人`, group: sp ? "家族:配偶者と子" : "家族:子のみ" };
    case "parent":
      return { tag: sp ? "配偶者と父母" : "父母のみ", group: "家族:父母" };
    case "grandparent":
      return { tag: sp ? "配偶者と祖父母" : "祖父母のみ", group: "家族:祖父母" };
    case "sibling":
      return { tag: sp ? "配偶者と兄弟姉妹" : "兄弟姉妹のみ", group: "家族:兄弟姉妹" };
    default:
      return sp ? { tag: "配偶者のみ", group: "家族:配偶者のみ" } : { tag: "相続人なし（全員放棄）", group: "家族:相続人なし" };
  }
}

function sizeTag(total: number): string {
  if (total < 50_000_000) return "規模:5千万未満";
  if (total < 100_000_000) return "規模:5千万〜1億";
  if (total < 300_000_000) return "規模:1億〜3億";
  if (total < 1_000_000_000) return "規模:3億〜10億";
  return "規模:10億以上";
}

/** 分割で各人が取得するおおまかな額（タグ用） */
function roughAcquired(s: Scenario): Map<string, number> {
  const got = new Map<string, number>();
  const add = (id: string, v: number) => got.set(id, (got.get(id) ?? 0) + v);
  if (s.division.kind === "agreed") {
    for (const it of s.estate) {
      const sh = s.division.shares[it.id];
      if (!sh) continue;
      const v = roughValue(it);
      for (const x of sh) add(x.who, (v * x.n) / x.d);
    }
  }
  return got;
}

/** 小規模宅地等を使う人についてのタグ（共有で何人も使う・面積を選んだ・要件を満たさない人がいる） */
function smallUserTags(sl: SmallLandUse, t: Set<string>): void {
  const users = [sl, ...(sl.others ?? [])];
  if (sl.others?.length) t.add("小規模宅地（共有で何人も使う）");
  if (users.some((u) => u.selectedSqm !== undefined)) t.add("小規模宅地（使う面積を選んだ）");
  if (users.some((u) => u.livedTogether === false || u.keep === false || u.continues === false)) t.add("小規模宅地（要件を満たさない取得者）");
}

export function autoTags(s: Scenario): string[] {
  const t = new Set<string>();
  const ms = s.members;
  const byId = new Map(ms.map((m) => [m.id, m]));
  const death = s.decedent.deathDate;
  const fam = familyTag(ms);
  t.add(fam.tag);
  t.add(fam.group);
  const h = heirInfo(ms);

  for (const m of ms) {
    if (m.renounced) t.add("相続放棄");
    if (m.halfBlood) t.add("半血兄弟姉妹");
    if (m.substituteOf && m.relation === "grandchild") t.add("代襲（孫）");
    if (m.substituteOf && m.relation === "greatGrandchild") t.add("再代襲（ひ孫）");
    if (m.substituteOf && m.relation === "nephewNiece") t.add("代襲（甥姪）");
    if (m.relation === "adoptedChild") {
      if (m.adoptedCountsAsBiological) t.add("特別養子・連れ子養子");
      else if (m.grandchildAdopted) t.add(m.substituteOf ? "孫養子かつ代襲相続人" : "孫養子");
      else t.add("普通養子");
    }
    if (m.disability === "general") t.add("障害者（一般）");
    if (m.disability === "special") t.add("障害者（特別）");
    if (m.nonResident) t.add("非居住者");
    if (m.diedAfter) t.add("数次相続");
    if (m.unborn) t.add("胎児");
    if (!m.unborn && !m.predeceased && DIRECT_DESC.includes(m.relation) && ageAt(m.birthDate, death) < 18 && h.shares.has(m.id)) t.add("未成年者");
    if (m.relation === "other") t.add("受遺者（相続人以外）");
    if (m.priorMinorCredit) t.add("前の相続でも未成年者控除");
    if (m.priorDisabilityCredit) t.add("前の相続でも障害者控除");
    const pd = m.priorDisabilityCredit;
    if (pd?.special !== undefined && pd.special !== (m.disability === "special")) t.add("障害者控除の区分が変わった");
  }
  const adoptedNormal = ms.filter((m) => m.relation === "adoptedChild" && !m.adoptedCountsAsBiological && !(m.grandchildAdopted && m.substituteOf));
  const bio = ms.filter((m) => m.relation === "child" || (m.relation === "adoptedChild" && m.adoptedCountsAsBiological));
  if (adoptedNormal.length > (bio.length ? 1 : 2)) t.add("養子の数の制限");
  if (ms.some((m) => m.relation === "child" && m.renounced) && !ms.some((m) => m.relation === "child" && !m.renounced && !m.predeceased)) {
    if (ms.filter((m) => m.relation === "child").every((m) => m.renounced || (m.predeceased && !ms.some((x) => x.substituteOf === m.id)))) t.add("子全員が放棄");
  }

  // 財産
  let total = 0;
  let residenceArea = 0;
  const smallKinds = new Set<SmallLandKind>();
  for (const it of s.estate) {
    total += roughValue(it);
    if ("foreign" in it && it.foreign) t.add("国外財産");
    switch (it.type) {
      case "deposit":
        t.add("預貯金");
        break;
      case "cash":
        t.add("現金");
        break;
      case "household":
        t.add("家庭用財産");
        break;
      case "other":
        t.add("その他の財産");
        break;
      case "listedStock":
        t.add("上場株式");
        if (Object.values(it.prices).some((p) => !Number.isInteger(p))) t.add("株価に円未満");
        break;
      case "unlistedStock":
        t.add("非上場株式");
        break;
      case "insurance":
      case "retirement": {
        t.add(it.type === "insurance" ? "生命保険金" : "死亡退職金");
        const r = byId.get(it.recipient);
        if (r?.renounced) t.add("放棄した人が保険金等を受取");
        if (r && !h.shares.has(r.id) && !r.renounced) t.add("相続人以外が保険金等を受取");
        break;
      }
      case "building":
        if (it.rented) t.add("貸家");
        break;
      case "condo":
        t.add("マンション");
        if (it.totalFloors <= 2) t.add("マンション（2階建て以下）");
        if (it.rented) t.add("賃貸中のマンション");
        if (it.rented && ((it as CondoItemExt).rentRatio ?? 1) < 1) t.add("空室のある貸付");
        if (it.smallLand) smallKinds.add(it.smallLand.kind);
        if (it.smallLand?.kind === "residence") residenceArea += it.landShareSqm;
        if (it.smallLand) smallUserTags(it.smallLand, t);
        break;
      case "land": {
        const v = it.valuation;
        if (v.kind === "rosenka") {
          t.add("路線価地域");
          t.add(`地区:${v.district}`);
          const sides = v.roads.filter((r) => r.position === "side").length;
          const backs = v.roads.filter((r) => r.position === "back").length;
          if (sides) t.add("角地（側方路線）");
          if (backs) t.add("二方路線（裏面路線）");
          if (v.roads.length >= 3) t.add("三方・四方路線");
          const sc = v.roads.map((r) => r.price * depthPct(v.district, r.depth));
          if (sc.some((x, i) => sc.some((y, j) => i !== j && x === y))) t.add("正面路線の判定（同じ額）");
        } else {
          t.add("倍率地域");
        }
        if (it.landUse === "田" || it.landUse === "畑" || it.landUse === "山林") t.add("田畑山林");
        if (it.landUse === "雑種地") t.add("雑種地");
        if (it.use === "rentedHouse") t.add("貸家建付地");
        if (it.use === "leasedLand") t.add("貸宅地（底地）");
        if (it.use === "leasehold") t.add("借地権");
        if (it.use === "rentedLeasehold") t.add("貸家建付借地権");
        if (it.use === "parking") t.add("駐車場");
        if ((it.use === "rentedHouse" || it.use === "rentedLeasehold") && (it.rentRatio ?? 1) < 1) t.add("空室のある貸付");
        if (it.advisorRate !== undefined) t.add(it.advisorRate === 1 ? "税理士に確かめた補正率（1）" : "税理士に確かめた補正率");
        if (it.needsReduction === "largeLot") t.add("地積規模の大きな宅地");
        if (it.needsReduction === "irregular") t.add("不整形地");
        if (it.needsReduction === "setback") t.add("セットバック");
        if (it.spouseResidenceRight) t.add("配偶者居住権");
        if (it.smallLand) {
          smallKinds.add(it.smallLand.kind);
          if (it.smallLand.kind === "residence") residenceArea += it.areaSqm;
          if (s.division.kind === "agreed") {
            const sh = s.division.shares[it.id] ?? [];
            if (sh.length > 1) t.add("小規模宅地（共有取得）");
            if (s.division.partlyUndivided && sh.reduce((x, y) => x + y.n / y.d, 0) < 1 - 1e-9) t.add("小規模宅地（一部が未分割の宅地）");
          }
          smallUserTags(it.smallLand, t);
        }
        break;
      }
    }
  }
  if (smallKinds.has("residence")) t.add("小規模宅地（特定居住用）");
  if (smallKinds.has("business")) t.add("小規模宅地（特定事業用）");
  if (smallKinds.has("rental")) t.add("小規模宅地（貸付事業用）");
  if (smallKinds.has("rental") && smallKinds.size > 1) t.add("小規模宅地（限度面積の調整）");
  if (smallKinds.has("residence") && smallKinds.has("business")) t.add("小規模宅地（居住用と事業用の併用）");
  if (residenceArea > 330) t.add("小規模宅地（330㎡超）");
  t.add(sizeTag(total));

  // 債務
  let debtTotal = 0;
  for (const d of s.debts) {
    debtTotal += d.amount;
    t.add(d.kind === "funeral" ? "葬式費用" : "債務");
    if (d.bearers.some((b) => byId.get(b.who)?.renounced)) t.add(d.kind === "funeral" ? "放棄した人が葬式費用を負担" : "放棄した人が債務を負担");
  }
  if (debtTotal > total) t.add("債務超過");

  // 贈与
  const window = addYears(death, -3);
  for (const g of s.gifts) {
    if (g.settlement) t.add(Number(g.date.slice(0, 4)) >= 2024 ? "相続時精算課税（令和6年以降）" : "相続時精算課税（令和5年以前）");
    else t.add(g.date >= window ? "3年以内贈与" : "贈与（加算期間外）");
    if (g.giftTaxPaid > 0) t.add("贈与税額控除");
    if (g.settlement) t.add("相続時精算課税");
    const r = byId.get(g.to);
    if (r?.renounced) t.add("放棄した人への贈与");
  }

  // 分け方
  const heirGift = s.gifts.some((g) => g.settlement && h.shares.has(g.to));
  if (s.division.kind === "undivided") {
    t.add("未分割");
    if (heirGift) t.add("未分割＋精算課税（特別受益）");
  } else {
    if (s.division.partlyUndivided) t.add("一部未分割");
    if (s.division.partlyUndivided && heirGift) t.add("未分割＋精算課税（特別受益）");
    if (s.division.compensation?.length) t.add("代償分割");
    if (s.division.partlyUndivided && s.division.compensation?.length) t.add("代償分割＋一部未分割");
    if (s.division.compensation?.some((c) => c.basis)) t.add("代償金（時価をもとに決めた）");
    const got = roughAcquired(s);
    if (h.spouse) {
      const spv = got.get(h.spouse) ?? 0;
      const divTotal = s.estate.filter(isDivisible).reduce((x, it) => x + roughValue(it), 0);
      if (divTotal > 0 && spv >= divTotal - 1) t.add("配偶者がすべて取得");
      if (spv === 0 && divTotal > 0) t.add("配偶者が取得しない");
      if (spv > 160_000_000) t.add("配偶者が1億6千万円超を取得");
    }
  }
  if (s.decedent.priorInheritance) t.add("相次相続控除");
  if (ageAt(s.decedent.birthDate, death) >= 100) t.add("被相続人100歳以上");
  if (death.endsWith("-01-01")) t.add("死亡日:1月1日");
  if (death.endsWith("-12-31")) t.add("死亡日:12月31日");
  // 2割加算の対象になりうる人が何かを受け取る
  const receivers = new Set<string>();
  if (s.division.kind === "agreed") for (const sh of Object.values(s.division.shares)) for (const x of sh) receivers.add(x.who);
  if (s.division.kind === "undivided") for (const id of h.shares.keys()) receivers.add(id);
  for (const it of s.estate) if (it.type === "insurance" || it.type === "retirement") receivers.add(it.recipient);
  for (const id of receivers) {
    const m = byId.get(id);
    if (!m) continue;
    const surcharge =
      m.relation === "sibling" || m.relation === "nephewNiece" || m.relation === "grandparent" || m.relation === "other" ||
      ((m.relation === "grandchild" || m.relation === "greatGrandchild") && !m.substituteOf) ||
      (m.relation === "adoptedChild" && !!m.grandchildAdopted && !m.substituteOf);
    if (surcharge) t.add("2割加算の対象者あり");
  }
  return [...t];
}

export function autoTitle(s: Scenario): string {
  const fam = familyTag(s.members).tag;
  const parts: string[] = [];
  const has = (f: (it: EstateItem) => boolean) => s.estate.some(f);
  if (has((it) => it.type === "land" && it.smallLand?.kind === "residence")) parts.push("自宅（小規模宅地）");
  else if (has((it) => it.type === "land" && it.use === "self" && it.landUse === "宅地")) parts.push("自宅");
  if (has((it) => it.type === "land" && it.use === "leasehold")) parts.push("借地権");
  if (has((it) => it.type === "condo")) parts.push("マンション");
  if (has((it) => it.type === "land" && it.use === "rentedHouse")) parts.push("アパート");
  if (has((it) => it.type === "land" && it.use === "rentedLeasehold")) parts.push("借地のアパート");
  if (has((it) => it.type === "land" && it.use === "leasedLand")) parts.push("貸宅地");
  if (has((it) => it.type === "land" && (it.landUse === "田" || it.landUse === "畑" || it.landUse === "山林"))) parts.push("田畑・山林");
  if (has((it) => it.type === "deposit")) parts.push("預貯金");
  if (has((it) => it.type === "listedStock")) parts.push("上場株式");
  if (has((it) => it.type === "unlistedStock")) parts.push("自社株");
  if (has((it) => it.type === "insurance")) parts.push("生命保険金");
  if (has((it) => it.type === "retirement")) parts.push("死亡退職金");
  const notes: string[] = [];
  if (s.division.kind === "undivided") notes.push("未分割");
  if (s.division.kind === "agreed" && s.division.partlyUndivided) notes.push("一部未分割");
  if (s.division.kind === "agreed" && s.division.compensation?.length) notes.push("代償分割");
  if (s.gifts.some((g) => g.settlement)) notes.push("精算課税");
  else if (s.gifts.length) notes.push("生前贈与");
  if (s.decedent.priorInheritance) notes.push("相次相続");
  if (s.members.some((m) => m.diedAfter)) notes.push("数次相続");
  if (s.members.some((m) => m.nonResident)) notes.push("非居住者");
  if (s.members.some((m) => m.renounced)) notes.push("放棄あり");
  return `${fam}：${parts.join("・") || "預貯金のみ"}${notes.length ? `（${notes.join("・")}）` : ""}`;
}

// ───────────────────────── 手で設計した境界・特殊ケース ─────────────────────────

type EdgeFn = (b: Builder) => void;

/** 自宅（路線価・普通住宅地区）の土地と建物 */
function home(b: Builder, o: { price?: number; frontage?: number; depth?: number; bldg?: number; district?: District; side?: number; back?: number; use?: LandUse; needsReduction?: LandItem["needsReduction"]; advisorRate?: number; spouseResidenceRight?: boolean; area?: number } = {}): { L: string; B: string } {
  const L = b.landR({
    label: `自宅の土地（${b.homeLocation()}）`,
    price: o.price ?? 250_000,
    frontage: o.frontage ?? 11,
    depth: o.depth ?? 15,
    district: o.district,
    side: o.side,
    back: o.back,
    use: o.use,
    needsReduction: o.needsReduction,
    advisorRate: o.advisorRate,
    spouseResidenceRight: o.spouseResidenceRight,
    area: o.area,
  });
  const B = b.building(o.bldg ?? 4_200_000, { label: "自宅の建物（木造2階建）" });
  return { L, B };
}

/** 子を年齢の並びで作る */
function children(b: Builder, ages: number[], o: PersonOpts = {}): string[] {
  return ages.map((age) => b.child({ age, ...o }));
}

const EDGES: [string, string[], EdgeFn][] = [
  // ── 家族の形 ──
  ["配偶者のみが相続人（子・父母・兄弟姉妹なし）", ["家族の形"], (b) => {
    b.dec({ age: 82, male: true });
    const sp = b.spouse({ age: 79 });
    const h = home(b, { price: 210_000, frontage: 12, depth: 16, bldg: 3_200_000 });
    b.deposit(45_000_000);
    b.deposit(12_345_678);
    b.household(500_000);
    b.funeral(1_800_000, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 1 });
  }],
  ["配偶者と子1人", ["家族の形"], (b) => {
    b.dec({ age: 75, male: true });
    const sp = b.spouse({ age: 72 });
    const [c1] = children(b, [46]);
    const h = home(b, { price: 180_000, frontage: 10, depth: 15, bldg: 4_500_000 });
    b.deposit(38_000_000);
    b.insurance(10_000_000, sp);
    b.funeral(1_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["配偶者と子2人（標準的な相続）", ["家族の形"], (b) => {
    b.dec({ age: 80, male: true });
    const sp = b.spouse({ age: 77 });
    const [c1, c2] = children(b, [52, 49]);
    const h = home(b, { price: 320_000, frontage: 11, depth: 15, bldg: 5_800_000 });
    b.deposit(60_000_000);
    b.deposit(25_000_000);
    b.listed(2_000, { close: 2_450, monthAvg: 2_410, prevMonthAvg: 2_380, prev2MonthAvg: 2_500 });
    b.insurance(15_000_000, sp);
    b.funeral(2_200_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["配偶者と子3人", ["家族の形"], (b) => {
    b.dec({ age: 84, male: true });
    const sp = b.spouse({ age: 80 });
    const [c1, c2, c3] = children(b, [56, 53, 50]);
    const h = home(b, { price: 450_000, frontage: 13, depth: 18, bldg: 6_100_000 });
    b.deposit(80_000_000);
    b.deposit(15_500_000);
    b.funeral(2_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [c1]: 1, [c2]: 1, [c3]: 1 });
  }],
  ["配偶者と子4人", ["家族の形"], (b) => {
    b.dec({ age: 88, male: true });
    const sp = b.spouse({ age: 85 });
    const cs = children(b, [60, 58, 55, 52]);
    const h = home(b, { price: 150_000, frontage: 15, depth: 20, bldg: 2_800_000 });
    b.deposit(72_000_000);
    b.insurance(5_000_000, sp);
    b.funeral(1_900_000, cs[0]);
    b.give(h.L, cs[0]);
    b.give(h.B, cs[0]);
    b.smallLand(h.L, "residence", cs[0]);
    b.split({ [sp]: 4, [cs[0]]: 1, [cs[1]]: 1, [cs[2]]: 1, [cs[3]]: 1 });
  }],
  ["配偶者と子5人", ["家族の形"], (b) => {
    b.dec({ age: 91, male: true });
    const sp = b.spouse({ age: 87 });
    const cs = children(b, [64, 62, 60, 57, 54]);
    const h = home(b, { price: 120_000, frontage: 14, depth: 22, bldg: 1_500_000 });
    b.deposit(95_000_000);
    b.deposit(33_333_333);
    b.funeral(2_000_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 5, [cs[0]]: 1, [cs[1]]: 1, [cs[2]]: 1, [cs[3]]: 1, [cs[4]]: 1 });
  }],
  ["子1人だけが相続人（配偶者は先に死亡）", ["家族の形"], (b) => {
    b.dec({ age: 88, male: false });
    b.spouse({ age: 92, predeceased: true });
    const [c1] = children(b, [60]);
    const h = home(b, { price: 230_000, frontage: 10, depth: 16, bldg: 2_000_000 });
    b.deposit(42_000_000);
    b.funeral(1_600_000, c1);
    b.smallLand(h.L, "residence", c1);
    b.split({ [c1]: 1 });
  }],
  ["子3人だけが相続人", ["家族の形"], (b) => {
    b.dec({ age: 91, male: false });
    b.spouse({ age: 95, predeceased: true });
    const cs = children(b, [64, 61, 58]);
    home(b, { price: 280_000, frontage: 12, depth: 14, bldg: 1_800_000 });
    b.deposit(55_000_000);
    b.deposit(8_765_432);
    b.funeral(1_700_000, cs[0]);
    b.split({ [cs[0]]: 1, [cs[1]]: 1, [cs[2]]: 1 });
  }],
  ["父母だけが相続人（独身の子が亡くなった）", ["家族の形", "2割加算なし（父母）"], (b) => {
    b.dec({ age: 48, male: true });
    const fa = b.parent(true, { age: 76 });
    const mo = b.parent(false, { age: 74 });
    b.condo({ landValue: 14_000_000, buildingFixedAssetValue: 9_800_000, builtYears: 12, builtMonths: 5, totalFloors: 10, floor: 6, landShareSqm: 21.4, exclusiveAreaSqm: 68.2 });
    b.deposit(40_000_000);
    b.insurance(20_000_000, mo);
    b.retirement(15_000_000, mo);
    b.funeral(1_500_000, fa);
    b.split({ [fa]: 1, [mo]: 1 });
  }],
  ["配偶者と父母", ["家族の形"], (b) => {
    b.dec({ age: 55, male: true });
    const sp = b.spouse({ age: 52 });
    const fa = b.parent(true, { age: 82 });
    const mo = b.parent(false, { age: 80 });
    b.sibling({ age: 58 });
    const h = home(b, { price: 380_000, frontage: 10, depth: 16, bldg: 12_000_000 });
    b.deposit(30_000_000);
    b.insurance(30_000_000, sp);
    b.funeral(2_000_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 4, [fa]: 1, [mo]: 1 });
  }],
  ["配偶者と母（父は先に死亡）", ["家族の形"], (b) => {
    b.dec({ age: 60, male: true });
    const sp = b.spouse({ age: 58 });
    b.parent(true, { age: 89, predeceased: true });
    const mo = b.parent(false, { age: 86 });
    b.deposit(70_000_000);
    b.listed(5_000, { close: 812, monthAvg: 798, prevMonthAvg: 805, prev2MonthAvg: 820 });
    b.funeral(1_800_000, sp);
    b.split({ [sp]: 2, [mo]: 1 });
  }],
  ["祖父母だけが相続人（父母は先に死亡、2割加算）", ["家族の形"], (b) => {
    b.dec({ age: 32, male: false });
    b.parent(true, { age: 62, predeceased: true });
    b.parent(false, { age: 60, predeceased: true });
    const gm = b.grandparent(false, { age: 88 });
    const gf = b.grandparent(true, { age: 90 });
    b.deposit(38_000_000);
    b.insurance(10_000_000, gm);
    b.funeral(1_200_000, gf);
    b.split({ [gm]: 1, [gf]: 1 });
  }],
  ["父と祖母（親等の近い父だけが相続人）", ["家族の形"], (b) => {
    b.dec({ age: 40, male: true });
    const fa = b.parent(true, { age: 68 });
    b.parent(false, { age: 66, predeceased: true });
    b.grandparent(false, { age: 92 });
    b.deposit(50_000_000);
    b.funeral(1_300_000, fa);
    b.split({ [fa]: 1 });
  }],
  ["兄弟姉妹3人だけが相続人（2割加算）", ["家族の形"], (b) => {
    b.moveRural();
    b.dec({ age: 84, male: false });
    const b1 = b.sibling({ age: 86, male: true });
    const b2 = b.sibling({ age: 80 });
    const b3 = b.sibling({ age: 77 });
    b.landM({ label: `自宅の土地（${b.homeLocation()}）`, area: 280, fixedAssetValue: 5_600_000, rate: 1.1 });
    b.building(1_200_000);
    b.deposit(70_000_000);
    b.funeral(1_500_000, b1);
    b.split({ [b1]: 1, [b2]: 1, [b3]: 1 });
  }],
  ["配偶者と兄弟姉妹2人", ["家族の形"], (b) => {
    b.dec({ age: 78, male: true });
    const sp = b.spouse({ age: 74 });
    const b1 = b.sibling({ age: 80 });
    const b2 = b.sibling({ age: 72 });
    const h = home(b, { price: 260_000, frontage: 12, depth: 15, bldg: 3_000_000 });
    b.deposit(90_000_000);
    b.funeral(1_800_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 6, [b1]: 1, [b2]: 1 });
  }],
  ["半血の兄弟姉妹を含む（全血の2分の1）", ["家族の形"], (b) => {
    b.dec({ age: 70, male: true });
    const b1 = b.sibling({ age: 72 });
    const b2 = b.sibling({ age: 66 });
    const b3 = b.sibling({ age: 60, halfBlood: true });
    b.deposit(60_000_000);
    b.deposit(5_000_000);
    b.funeral(1_000_000, b1);
    b.split({ [b1]: 2, [b2]: 2, [b3]: 1 });
  }],
  ["配偶者と半血の兄弟姉妹", ["家族の形"], (b) => {
    b.dec({ age: 74, male: false });
    const sp = b.spouse({ age: 77 });
    const b1 = b.sibling({ age: 69, halfBlood: true });
    const b2 = b.sibling({ age: 71 });
    b.deposit(96_000_000);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 9, [b1]: 1, [b2]: 2 });
  }],
  ["甥姪が代襲相続（兄弟姉妹の1人が先に死亡）", ["家族の形"], (b) => {
    b.dec({ age: 86, male: true });
    const b1 = b.sibling({ age: 83 });
    const b2 = b.sibling({ age: 88, male: true, predeceased: true });
    const n1 = b.nephew(b2, { age: 58 });
    const n2 = b.nephew(b2, { age: 55 });
    b.deposit(64_000_000);
    b.listed(1_000, { close: 3_120, monthAvg: 3_080, prevMonthAvg: 3_150, prev2MonthAvg: 3_005 });
    b.funeral(1_400_000, n1);
    b.split({ [b1]: 2, [n1]: 1, [n2]: 1 });
  }],
  ["甥も先に死亡（兄弟姉妹の代襲は甥姪まで）", ["家族の形", "再代襲なし（甥姪の子）"], (b) => {
    b.dec({ age: 90, male: false });
    const b1 = b.sibling({ age: 93, male: true, predeceased: true });
    b.nephew(b1, { age: 64, male: true, predeceased: true });
    const n2 = b.nephew(b1, { age: 61 });
    const b2 = b.sibling({ age: 85 });
    b.deposit(52_000_000);
    b.funeral(1_200_000, b2);
    b.split({ [b2]: 1, [n2]: 1 });
  }],
  ["孫が代襲相続（子の1人が先に死亡）", ["家族の形"], (b) => {
    b.dec({ age: 85, male: true });
    b.spouse({ age: 84, predeceased: true });
    const c1 = b.child({ age: 58 });
    const c2 = b.child({ age: 55, male: true, predeceased: true });
    const g1 = b.grandchild(c2, { age: 30 });
    const g2 = b.grandchild(c2, { age: 27 });
    const h = home(b, { price: 300_000, frontage: 12, depth: 15, bldg: 2_500_000 });
    b.deposit(48_000_000);
    b.funeral(1_800_000, c1);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.split({ [c1]: 1, [g1]: 1, [g2]: 1 });
  }],
  ["配偶者と代襲相続人の孫", ["家族の形"], (b) => {
    b.dec({ age: 79, male: true });
    const sp = b.spouse({ age: 76 });
    const c1 = b.child({ age: 50, male: true, predeceased: true });
    const g1 = b.grandchild(c1, { age: 25 });
    const c2 = b.child({ age: 47 });
    const h = home(b, { price: 200_000, frontage: 10, depth: 18, bldg: 3_600_000 });
    b.deposit(58_000_000);
    b.funeral(1_700_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [c2]: 1, [g1]: 1 });
  }],
  ["再代襲（子と孫が先に死亡し、ひ孫が相続）", ["家族の形"], (b) => {
    b.dec({ age: 101, male: false });
    const c1 = b.child({ age: 75 });
    const c2 = b.child({ age: 73, male: true, predeceased: true });
    const g1 = b.grandchild(c2, { age: 48, male: true, predeceased: true });
    const gg1 = b.greatGrandchild(g1, { age: 22 });
    const gg2 = b.greatGrandchild(g1, { age: 19 });
    const g2 = b.grandchild(c2, { age: 45 });
    b.deposit(72_000_000);
    b.funeral(1_500_000, c1);
    b.split({ [c1]: 4, [g2]: 2, [gg1]: 1, [gg2]: 1 });
  }],
  ["子の1人が放棄（他の子がいるので順位は動かない）", ["家族の形"], (b) => {
    b.dec({ age: 62, male: true });
    const sp = b.spouse({ age: 60 });
    const c1 = b.child({ age: 34 });
    b.child({ age: 31, renounced: true });
    const c3 = b.child({ age: 28 });
    b.parent(false, { age: 86 });
    const h = home(b, { price: 340_000, frontage: 10, depth: 15, bldg: 9_000_000 });
    b.deposit(45_000_000);
    b.funeral(1_600_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 2, [c1]: 1, [c3]: 1 });
  }],
  ["子全員が放棄して父母が相続人になる（基礎控除は放棄がなかったものとして数える）", ["家族の形"], (b) => {
    b.dec({ age: 58, male: true });
    const sp = b.spouse({ age: 56 });
    const c1 = b.child({ age: 30, renounced: true });
    b.child({ age: 27, renounced: true });
    const fa = b.parent(true, { age: 84 });
    const mo = b.parent(false, { age: 82 });
    b.deposit(80_000_000);
    b.insurance(10_000_000, c1);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 4, [fa]: 1, [mo]: 1 });
  }],
  ["子全員が放棄し父母もいないので兄弟姉妹が相続人", ["家族の形"], (b) => {
    b.dec({ age: 75, male: true });
    b.spouse({ age: 74, predeceased: true });
    b.child({ age: 46, renounced: true });
    b.child({ age: 43, renounced: true });
    const b1 = b.sibling({ age: 73 });
    const b2 = b.sibling({ age: 70 });
    b.deposit(66_000_000);
    b.funeral(1_300_000, b1);
    b.split({ [b1]: 1, [b2]: 1 });
  }],
  ["子が放棄して配偶者と兄弟姉妹が相続人", ["家族の形"], (b) => {
    b.dec({ age: 72, male: true });
    const sp = b.spouse({ age: 70 });
    b.child({ age: 42, renounced: true });
    const b1 = b.sibling({ age: 74 });
    const h = home(b, { price: 190_000, frontage: 12, depth: 16, bldg: 2_300_000 });
    b.deposit(50_000_000);
    b.funeral(1_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 3, [b1]: 1 });
  }],
  ["借金が多く相続人全員が放棄。放棄した人が生命保険金だけを受け取る", ["家族の形", "全員が放棄"], (b) => {
    b.dec({ age: 68, male: true });
    const sp = b.spouse({ age: 66, renounced: true });
    const c1 = b.child({ age: 40, renounced: true });
    b.insurance(20_000_000, sp);
    b.insurance(5_000_000, c1);
    b.funeral(1_600_000, sp);
  }],
  ["普通養子：実子1人と養子2人（算入は1人まで）", ["養子"], (b) => {
    b.dec({ age: 80, male: true });
    const sp = b.spouse({ age: 77 });
    const c1 = b.child({ age: 50, male: true });
    const a1 = b.adopted({ age: 47, male: false, surname: b.surname });
    const a2 = b.adopted({ age: 35, male: false });
    const h = home(b, { price: 260_000, frontage: 12, depth: 14, bldg: 3_300_000 });
    b.deposit(75_000_000);
    b.funeral(1_800_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 3, [c1]: 1, [a1]: 1, [a2]: 1 });
  }],
  ["普通養子：実子なし・養子3人（算入は2人まで）", ["養子"], (b) => {
    b.dec({ age: 83, male: true });
    const sp = b.spouse({ age: 80 });
    const a1 = b.adopted({ age: 52 });
    const a2 = b.adopted({ age: 48 });
    const a3 = b.adopted({ age: 30 });
    b.deposit(88_000_000);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 3, [a1]: 1, [a2]: 1, [a3]: 1 });
  }],
  ["特別養子（実子とみなす）と普通養子2人", ["養子"], (b) => {
    b.dec({ age: 70, male: true });
    const sp = b.spouse({ age: 68 });
    const a1 = b.adopted({ age: 30, adoptedCountsAsBiological: true, surname: b.surname });
    const a2 = b.adopted({ age: 40 });
    const a3 = b.adopted({ age: 38 });
    b.deposit(96_000_000);
    b.funeral(1_700_000, sp);
    b.split({ [sp]: 3, [a1]: 1, [a2]: 1, [a3]: 1 });
  }],
  ["配偶者の連れ子を養子にした（実子とみなす）と実子・普通養子2人", ["養子"], (b) => {
    b.dec({ age: 72, male: true });
    const sp = b.spouse({ age: 66 });
    const c1 = b.child({ age: 40 });
    const a1 = b.adopted({ age: 44, adoptedCountsAsBiological: true });
    const a2 = b.adopted({ age: 36 });
    const a3 = b.adopted({ age: 33 });
    b.deposit(120_000_000);
    b.funeral(2_000_000, sp);
    b.split({ [sp]: 4, [c1]: 1, [a1]: 1, [a2]: 1, [a3]: 1 });
  }],
  ["養子の算入制限で基礎控除を超える（実子1人・養子2人で4,800万円）", ["養子", "基礎控除の境界"], (b) => {
    b.dec({ age: 78, male: false });
    const c1 = b.child({ age: 50 });
    const a1 = b.adopted({ age: 26, grandchildAdopted: true, parentId: c1 });
    const a2 = b.adopted({ age: 47 });
    b.deposit(48_000_000);
    b.split({ [c1]: 1, [a1]: 1, [a2]: 1 });
  }],
  ["孫養子（代襲相続人でないので2割加算）", ["養子"], (b) => {
    b.dec({ age: 85, male: true });
    const sp = b.spouse({ age: 82 });
    const c1 = b.child({ age: 55, male: true });
    const c2 = b.child({ age: 50 });
    const a1 = b.adopted({ age: 25, grandchildAdopted: true, parentId: c1 });
    const h = home(b, { price: 350_000, frontage: 12, depth: 16, bldg: 4_000_000 });
    b.deposit(110_000_000);
    b.insurance(10_000_000, a1);
    b.funeral(2_000_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [c1]: 1, [c2]: 1, [a1]: 1 });
  }],
  ["孫養子かつ代襲相続人（二重資格。相続分は2つ、人数は1人、2割加算なし）", ["養子", "二重資格"], (b) => {
    b.dec({ age: 84, male: true });
    b.spouse({ age: 83, predeceased: true });
    const c1 = b.child({ age: 55, male: true, predeceased: true });
    const a1 = b.adopted({ age: 28, male: true, grandchildAdopted: true, substituteOf: c1, parentId: c1 });
    const c2 = b.child({ age: 52 });
    b.deposit(90_000_000);
    b.funeral(1_500_000, c2);
    b.split({ [a1]: 2, [c2]: 1 });
  }],
  ["胎児（申告期限までに生まれた）", ["胎児"], (b) => {
    b.dec({ age: 34, male: true });
    const sp = b.spouse({ age: 32 });
    const c1 = b.child({ age: 3 });
    const c2 = b.child({ bornAfterDays: 95 });
    b.condo({ landValue: 9_000_000, buildingFixedAssetValue: 11_000_000, builtYears: 3, builtMonths: 2, totalFloors: 14, floor: 9, landShareSqm: 17.8, exclusiveAreaSqm: 72.5 });
    b.deposit(12_000_000);
    b.insurance(40_000_000, sp);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["胎児（申告期限の直前に生まれた）", ["胎児"], (b) => {
    b.dec({ age: 38, male: true, deathDate: "2026-03-05" });
    const sp = b.spouse({ age: 35 });
    const c1 = b.child({ bornAfterDays: daysBetween("2026-03-05", "2026-12-25") });
    b.deposit(55_000_000);
    b.insurance(30_000_000, sp);
    b.funeral(1_200_000, sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["未成年者（0歳と4歳）", ["未成年者"], (b) => {
    b.dec({ age: 36, male: true });
    const sp = b.spouse({ age: 34 });
    const c1 = b.child({ birthDate: addDays(b.death, -40) });
    const c2 = b.child({ age: 4 });
    b.condo({ landValue: 16_000_000, buildingFixedAssetValue: 12_000_000, builtYears: 5, builtMonths: 8, totalFloors: 20, floor: 12, landShareSqm: 15.2, exclusiveAreaSqm: 70.1 });
    b.deposit(26_000_000);
    b.insurance(30_000_000, sp);
    b.funeral(1_400_000, sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["未成年者（17歳：18歳の誕生日の直前、5歳）", ["未成年者"], (b) => {
    b.dec({ age: 52, male: true });
    const sp = b.spouse({ age: 47 });
    const c1 = b.child({ birthDate: addDays(addYears(b.death, -18), 2) });
    const c2 = b.child({ age: 5 });
    const h = home(b, { price: 290_000, frontage: 10, depth: 14, bldg: 14_000_000 });
    b.deposit(60_000_000);
    b.funeral(1_600_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["18歳になったばかりの子（成年なので未成年者控除なし）", ["未成年者の境界"], (b) => {
    b.dec({ age: 55, male: false });
    const sp = b.spouse({ age: 57 });
    const c1 = b.child({ birthDate: addMonths(addYears(b.death, -18), -1) });
    const c2 = b.child({ age: 20 });
    b.deposit(70_000_000);
    b.funeral(1_400_000, sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["未成年者控除が引ききれず扶養義務者（兄）から引く", ["未成年者", "控除不足額"], (b) => {
    b.dec({ age: 55, male: true });
    b.spouse({ age: 52, predeceased: true });
    const c1 = b.child({ age: 25 });
    const c2 = b.child({ age: 2 });
    b.deposit(78_000_000);
    b.deposit(2_000_000);
    b.funeral(1_200_000, c1);
    b.give("D1", c1);
    b.give("D2", c2);
  }],
  ["障害者控除（一般障害者の子）", ["障害者"], (b) => {
    b.dec({ age: 78, male: true });
    const sp = b.spouse({ age: 76 });
    const c1 = b.child({ age: 50, disability: "general" });
    const c2 = b.child({ age: 47 });
    const h = home(b, { price: 240_000, frontage: 11, depth: 15, bldg: 3_100_000 });
    b.deposit(70_000_000);
    b.funeral(1_600_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["障害者控除（特別障害者の配偶者）", ["障害者"], (b) => {
    b.dec({ age: 72, male: true });
    const sp = b.spouse({ age: 70, disability: "special" });
    const c1 = b.child({ age: 44 });
    b.deposit(110_000_000);
    b.funeral(1_500_000, c1);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["障害者控除が引ききれず扶養義務者から引く（特別障害者の子）", ["障害者", "控除不足額"], (b) => {
    b.dec({ age: 74, male: false });
    b.spouse({ age: 78, predeceased: true });
    const c1 = b.child({ age: 40, disability: "special" });
    const c2 = b.child({ age: 45 });
    b.deposit(85_000_000);
    b.deposit(3_000_000);
    b.funeral(1_500_000, c2);
    b.give("D1", c2);
    b.give("D2", c1);
  }],
  ["未成年者で特別障害者の子（両方の控除）", ["未成年者", "障害者"], (b) => {
    b.dec({ age: 45, male: true });
    const sp = b.spouse({ age: 43 });
    const c1 = b.child({ age: 10, disability: "special" });
    b.condo({ landValue: 12_000_000, buildingFixedAssetValue: 9_000_000, builtYears: 9, builtMonths: 1, totalFloors: 12, floor: 4, landShareSqm: 19.5, exclusiveAreaSqm: 75.0 });
    b.deposit(45_000_000);
    b.insurance(20_000_000, sp);
    b.funeral(1_300_000, sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["相続人の1人が海外に住んでいる（非居住者）", ["非居住者"], (b) => {
    b.dec({ age: 83, male: true });
    const sp = b.spouse({ age: 80 });
    const c1 = b.child({ age: 54 });
    const c2 = b.child({ age: 50, nonResident: true });
    const h = home(b, { price: 310_000, frontage: 12, depth: 15, bldg: 2_900_000 });
    b.deposit(80_000_000);
    b.funeral(1_800_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["海外に住む相続人と国外財産", ["非居住者", "国外財産"], (b) => {
    b.dec({ age: 77, male: true });
    const c1 = b.child({ age: 48, nonResident: true });
    const c2 = b.child({ age: 45 });
    b.deposit(40_000_000);
    b.deposit(35_250_000, "米国の銀行口座（米ドル建て、亡くなった日のTTBで円換算）", true);
    b.funeral(1_200_000, c2);
    b.give("D2", c1);
    b.give("D1", c2);
  }],
  ["数次相続（配偶者が申告前に亡くなった）", ["数次相続"], (b) => {
    b.dec({ age: 90, male: true, deathDate: "2026-04-10" });
    const sp = b.spouse({ age: 88, diedAfter: "2026-08-20" });
    const c1 = b.child({ age: 62 });
    const c2 = b.child({ age: 59 });
    const h = home(b, { price: 270_000, frontage: 12, depth: 15, bldg: 1_900_000 });
    b.deposit(76_000_000);
    b.funeral(1_700_000, c1);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.split({ [sp]: 1, [c2]: 1 });
  }],
  ["内縁の妻に遺言で遺贈（相続人でない受遺者、2割加算）", ["受遺者"], (b) => {
    b.dec({ age: 70, male: true });
    const o1 = b.other({ age: 65, male: false });
    const c1 = b.child({ age: 42 });
    const c2 = b.child({ age: 40 });
    const M = b.condo({ landValue: 18_000_000, buildingFixedAssetValue: 7_000_000, builtYears: 18, builtMonths: 3, totalFloors: 8, floor: 5, landShareSqm: 28.0, exclusiveAreaSqm: 80.5 });
    const D = b.deposit(30_000_000, "あおば銀行 定期預金（遺言で内縁の妻に遺贈）");
    b.deposit(45_000_000);
    b.insurance(5_000_000, o1);
    b.funeral(1_400_000, c1);
    b.give(M, o1);
    b.give(D, o1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["生命保険金：相続人が受け取り非課税の範囲内", ["生命保険金"], (b) => {
    b.dec({ age: 76, male: true });
    const sp = b.spouse({ age: 73 });
    const c1 = b.child({ age: 45 });
    const c2 = b.child({ age: 42 });
    b.deposit(55_000_000);
    b.insurance(12_000_000, sp);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["生命保険金：複数の受取人で非課税限度額を超える（按分）", ["生命保険金"], (b) => {
    b.dec({ age: 69, male: true });
    const sp = b.spouse({ age: 66 });
    const c1 = b.child({ age: 40 });
    const c2 = b.child({ age: 37 });
    b.deposit(40_000_000);
    b.insurance(30_000_000, sp);
    b.insurance(20_000_000, c1);
    b.insurance(10_000_000, c2);
    b.funeral(1_600_000, sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["生命保険金：放棄した子が受け取る（非課税なし）", ["生命保険金"], (b) => {
    b.dec({ age: 74, male: true });
    const sp = b.spouse({ age: 71 });
    const c1 = b.child({ age: 45 });
    const c2 = b.child({ age: 42, renounced: true });
    b.deposit(60_000_000);
    b.insurance(15_000_000, c2);
    b.insurance(5_000_000, sp);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["生命保険金：相続人でない孫が受け取る（非課税なし・2割加算）", ["生命保険金"], (b) => {
    b.dec({ age: 82, male: false });
    const c1 = b.child({ age: 55 });
    const c2 = b.child({ age: 52 });
    const g1 = b.grandchild(c1, { age: 24 });
    b.deposit(52_000_000);
    b.insurance(10_000_000, g1);
    b.funeral(1_300_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["死亡退職金を配偶者が受け取る（非課税限度額あり）", ["死亡退職金"], (b) => {
    b.dec({ age: 63, male: true });
    const sp = b.spouse({ age: 60 });
    const c1 = b.child({ age: 33 });
    const c2 = b.child({ age: 30 });
    const h = home(b, { price: 420_000, frontage: 10, depth: 16, bldg: 11_000_000 });
    b.deposit(35_000_000);
    b.retirement(50_000_000, sp, "株式会社みらい工業からの死亡退職金");
    b.insurance(20_000_000, sp);
    b.funeral(2_200_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["生命保険金と死亡退職金（受取人が別）", ["生命保険金", "死亡退職金"], (b) => {
    b.dec({ age: 66, male: false });
    const c1 = b.child({ age: 38 });
    const c2 = b.child({ age: 35 });
    b.deposit(30_000_000);
    b.retirement(12_000_000, c1);
    b.insurance(8_000_000, c2);
    b.funeral(1_200_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["債務超過（借入金が財産を上回る、放棄はしない）", ["債務"], (b) => {
    b.moveRural();
    b.dec({ age: 71, male: true });
    const c1 = b.child({ age: 44 });
    b.landM({ label: `自宅の土地（${b.homeLocation()}）`, area: 210, fixedAssetValue: 2_940_000, rate: 1.1 });
    b.building(800_000);
    b.deposit(10_000_000);
    b.debt(50_000_000, c1, "事業の借入金（つばさ銀行）");
    b.funeral(1_500_000, c1);
    b.split({ [c1]: 1 });
  }],
  ["放棄した子が債務を負担（債務控除はできない）", ["債務"], (b) => {
    b.dec({ age: 80, male: true });
    const sp = b.spouse({ age: 78 });
    const c1 = b.child({ age: 50, renounced: true });
    const c2 = b.child({ age: 47 });
    b.deposit(65_000_000);
    b.insurance(10_000_000, c1);
    b.debt(800_000, c1, "未払医療費");
    b.funeral(1_600_000, sp);
    b.split({ [sp]: 1, [c2]: 1 });
  }],
  ["放棄した子が葬式費用を負担（保険金から差し引ける）", ["葬式費用"], (b) => {
    b.dec({ age: 77, male: false });
    const c1 = b.child({ age: 50, renounced: true });
    const c2 = b.child({ age: 47 });
    b.deposit(45_000_000);
    b.insurance(20_000_000, c1);
    b.funeral(2_000_000, c1);
    b.split({ [c2]: 1 });
  }],
  ["基礎控除ちょうど（子1人・3,600万円）", ["基礎控除", "基礎控除の境界"], (b) => {
    b.dec({ age: 85 });
    const c1 = b.child({ age: 56 });
    b.deposit(36_000_000);
    b.split({ [c1]: 1 });
  }],
  ["基礎控除＋1円（子1人）", ["基礎控除", "基礎控除の境界"], (b) => {
    b.dec({ age: 85 });
    const c1 = b.child({ age: 56 });
    b.deposit(36_000_001);
    b.split({ [c1]: 1 });
  }],
  ["基礎控除－1円（子1人）", ["基礎控除", "基礎控除の境界"], (b) => {
    b.dec({ age: 85 });
    const c1 = b.child({ age: 56 });
    b.deposit(35_999_999);
    b.split({ [c1]: 1 });
  }],
  ["基礎控除＋1,000円（子1人、税額100円）", ["基礎控除", "基礎控除の境界"], (b) => {
    b.dec({ age: 85 });
    const c1 = b.child({ age: 56 });
    b.deposit(36_001_000);
    b.split({ [c1]: 1 });
  }],
  ["基礎控除ちょうど（子2人・4,200万円）", ["基礎控除", "基礎控除の境界"], (b) => {
    b.dec({ age: 83 });
    const c1 = b.child({ age: 55 });
    const c2 = b.child({ age: 52 });
    b.deposit(30_000_000);
    b.deposit(12_000_000);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["基礎控除＋1円（子2人、1,000円未満の切捨てで基礎控除と同じになる）", ["基礎控除", "基礎控除の境界"], (b) => {
    b.dec({ age: 83 });
    const c1 = b.child({ age: 55 });
    const c2 = b.child({ age: 52 });
    b.deposit(42_000_001);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["基礎控除－1円（配偶者と子3人・5,400万円）", ["基礎控除", "基礎控除の境界"], (b) => {
    b.dec({ age: 80, male: true });
    const sp = b.spouse({ age: 78 });
    const cs = children(b, [52, 50, 47]);
    b.deposit(53_999_999);
    b.split({ [sp]: 3, [cs[0]]: 1, [cs[1]]: 1, [cs[2]]: 1 });
  }],
  ["基礎控除＋100万円（子3人）", ["基礎控除", "基礎控除の境界"], (b) => {
    b.dec({ age: 87 });
    const cs = children(b, [60, 57, 55]);
    b.deposit(49_000_000);
    b.split({ [cs[0]]: 1, [cs[1]]: 1, [cs[2]]: 1 });
  }],
  ["基礎控除ちょうど（子5人・6,000万円）", ["基礎控除", "基礎控除の境界"], (b) => {
    b.dec({ age: 90 });
    const cs = children(b, [64, 62, 59, 56, 53]);
    b.deposit(60_000_000);
    b.split(Object.fromEntries(cs.map((c) => [c, 1])));
  }],
  ["葬式費用を引くと基礎控除以下になる（子2人）", ["基礎控除", "基礎控除の境界"], (b) => {
    b.dec({ age: 86 });
    const c1 = b.child({ age: 58 });
    const c2 = b.child({ age: 55 });
    b.deposit(43_000_000);
    b.funeral(1_500_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  // ── 小規模宅地等の特例 ──
  ["小規模宅地 特定居住用（330㎡以内、配偶者が取得）", ["小規模宅地"], (b) => {
    b.dec({ age: 81, male: true });
    const sp = b.spouse({ age: 78 });
    const c1 = b.child({ age: 50 });
    const h = home(b, { price: 300_000, frontage: 12, depth: 20, bldg: 4_800_000 });
    b.deposit(40_000_000);
    b.funeral(1_700_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["小規模宅地 特定居住用（330㎡を超える土地）", ["小規模宅地"], (b) => {
    b.dec({ age: 86, male: true });
    const sp = b.spouse({ age: 82 });
    const c1 = b.child({ age: 55 });
    const c2 = b.child({ age: 52 });
    const h = home(b, { price: 280_000, frontage: 16, depth: 28, bldg: 5_500_000 });
    b.deposit(60_000_000);
    b.funeral(2_000_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["小規模宅地 特定居住用：自宅の敷地が2筆（合計348㎡、330㎡まで）", ["小規模宅地"], (b) => {
    b.dec({ age: 84, male: true });
    const sp = b.spouse({ age: 80 });
    const c1 = b.child({ age: 54 });
    const L1 = b.landR({ label: `自宅の土地（母屋の敷地、${b.homeLocation()}）`, price: 350_000, frontage: 12, depth: 15 });
    const L2 = b.landR({ label: "自宅の土地（庭の部分、隣の筆）", price: 320_000, frontage: 12, depth: 14 });
    const B = b.building(6_000_000);
    b.deposit(50_000_000);
    b.funeral(1_800_000, sp);
    for (const id of [L1, L2, B]) b.give(id, sp);
    b.smallLand(L1, "residence", sp);
    b.smallLand(L2, "residence", sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["小規模宅地 同居の子が取得（特定居住用）", ["小規模宅地"], (b) => {
    b.dec({ age: 89, male: false });
    b.spouse({ age: 92, predeceased: true });
    const c1 = b.child({ age: 60, male: true });
    const c2 = b.child({ age: 57 });
    const h = home(b, { price: 360_000, frontage: 12, depth: 16, bldg: 2_400_000 });
    b.deposit(38_000_000);
    b.funeral(1_600_000, c1);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.smallLand(h.L, "residence", c1);
    b.split({ [c2]: 1 });
  }],
  ["小規模宅地：自宅を配偶者と別居の子が共有で取得（配偶者の持分だけ特例）", ["小規模宅地"], (b) => {
    b.dec({ age: 79, male: true });
    const sp = b.spouse({ age: 76 });
    const c1 = b.child({ age: 48 });
    const h = home(b, { price: 400_000, frontage: 12, depth: 18, bldg: 5_000_000 });
    b.deposit(48_000_000);
    b.funeral(1_500_000, sp);
    b.give(h.L, { [sp]: 1, [c1]: 1 });
    b.give(h.B, { [sp]: 1, [c1]: 1 });
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["小規模宅地 特定事業用（個人商店を子が継ぐ、400㎡まで）", ["小規模宅地"], (b) => {
    b.dec({ age: 72, male: true });
    const sp = b.spouse({ age: 70 });
    const c1 = b.child({ age: 44, male: true });
    const L = b.landR({ label: `店舗の土地（${b.location()}）`, district: "普通商業・併用住宅地区", price: 400_000, frontage: 14, depth: 25 });
    const B = b.building(6_000_000, { label: "店舗の建物" });
    b.deposit(30_000_000);
    b.otherAsset(3_500_000, "商品・器具備品（事業用財産）");
    b.debt(2_000_000, c1, "買掛金");
    b.funeral(1_800_000, sp);
    b.give(L, c1);
    b.give(B, c1);
    b.give("O1", c1);
    b.smallLand(L, "business", c1);
    b.split({ [sp]: 1 });
  }],
  ["小規模宅地 貸付事業用（アパートの敷地、200㎡まで）", ["小規模宅地"], (b) => {
    b.dec({ age: 80, male: true });
    const sp = b.spouse({ age: 77 });
    const c1 = b.child({ age: 50 });
    const L = b.landR({ label: `アパートの土地（${b.location()}）`, price: 250_000, frontage: 15, depth: 20, use: "rentedHouse", rentRatio: 1 });
    const B = b.building(30_000_000, { label: "アパート（木造2階建・8室）", rented: true, rentRatio: 1 });
    b.deposit(42_000_000);
    b.debt(20_000_000, c1, "アパートローン（ほくと銀行）");
    b.funeral(1_600_000, sp);
    b.give(L, c1);
    b.give(B, c1);
    b.smallLand(L, "rental", c1);
    b.split({ [sp]: 1 });
  }],
  ["特定居住用＋特定事業用（併せて730㎡まで）", ["小規模宅地"], (b) => {
    b.dec({ age: 76, male: true });
    const sp = b.spouse({ age: 73 });
    const c1 = b.child({ age: 46, male: true });
    const h = home(b, { price: 260_000, frontage: 15, depth: 20, bldg: 4_500_000 });
    const L = b.landR({ label: `工場の土地（${b.location()}）`, district: "中小工場地区", price: 160_000, frontage: 19, depth: 20 });
    const B = b.building(9_000_000, { label: "工場の建物" });
    b.deposit(55_000_000);
    b.funeral(1_900_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.give(L, c1);
    b.give(B, c1);
    b.smallLand(h.L, "residence", sp);
    b.smallLand(L, "business", c1);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["特定居住用＋貸付事業用（限度面積の調整が必要）", ["小規模宅地"], (b) => {
    b.dec({ age: 82, male: true });
    const sp = b.spouse({ age: 79 });
    const c1 = b.child({ age: 52 });
    const h = home(b, { price: 300_000, frontage: 10, depth: 20, bldg: 3_800_000 });
    const L = b.landR({ label: `アパートの土地（${b.location()}）`, price: 280_000, frontage: 12.5, depth: 20, use: "rentedHouse", rentRatio: 1 });
    const B = b.building(25_000_000, { label: "アパート（6室）", rented: true, rentRatio: 1 });
    b.deposit(45_000_000);
    b.funeral(1_700_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.give(L, c1);
    b.give(B, c1);
    b.smallLand(h.L, "residence", sp);
    b.smallLand(L, "rental", c1);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["特定居住用＋特定事業用＋貸付事業用（3種類の調整）", ["小規模宅地"], (b) => {
    b.dec({ age: 78, male: true });
    const sp = b.spouse({ age: 75 });
    const c1 = b.child({ age: 48, male: true });
    const c2 = b.child({ age: 45 });
    const h = home(b, { price: 280_000, frontage: 10, depth: 15, bldg: 4_000_000 });
    const L2 = b.landR({ label: `店舗の土地（${b.location()}）`, district: "普通商業・併用住宅地区", price: 450_000, frontage: 10, depth: 20 });
    const B2 = b.building(5_000_000, { label: "店舗の建物" });
    const L3 = b.landR({ label: `貸家の土地（${b.location()}）`, price: 260_000, frontage: 12, depth: 15, use: "rentedHouse", rentRatio: 1 });
    const B3 = b.building(8_000_000, { label: "貸家（一戸建て）", rented: true, rentRatio: 1 });
    b.deposit(60_000_000);
    b.funeral(2_000_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.give(L2, c1);
    b.give(B2, c1);
    b.give(L3, c2);
    b.give(B3, c2);
    b.smallLand(h.L, "residence", sp);
    b.smallLand(L2, "business", c1);
    b.smallLand(L3, "rental", c2);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["貸付事業用が2か所（合わせて200㎡まで）", ["小規模宅地"], (b) => {
    b.dec({ age: 85, male: false });
    const c1 = b.child({ age: 58 });
    const c2 = b.child({ age: 55 });
    const L1 = b.landR({ label: `アパートAの土地（${b.location()}）`, price: 400_000, frontage: 10, depth: 15, use: "rentedHouse", rentRatio: 1 });
    const B1 = b.building(20_000_000, { label: "アパートA", rented: true, rentRatio: 1 });
    const L2 = b.landR({ label: `アパートBの土地（${b.location()}）`, price: 300_000, frontage: 10, depth: 16, use: "rentedHouse", rentRatio: 0.75 });
    const B2 = b.building(18_000_000, { label: "アパートB（8室中6室賃貸）", rented: true, rentRatio: 0.75 });
    b.deposit(30_000_000);
    b.funeral(1_500_000, c1);
    b.give(L1, c1);
    b.give(B1, c1);
    b.give(L2, c1);
    b.give(B2, c1);
    b.smallLand(L1, "rental", c1);
    b.smallLand(L2, "rental", c1);
    b.split({ [c2]: 1 });
  }],
  ["マンションの小規模宅地（特定居住用、敷地権）", ["小規模宅地", "マンション"], (b) => {
    b.dec({ age: 75, male: true });
    const sp = b.spouse({ age: 72 });
    const c1 = b.child({ age: 45 });
    const M = b.condo({ landValue: 32_000_000, buildingFixedAssetValue: 12_500_000, builtYears: 15, builtMonths: 6, totalFloors: 25, floor: 18, landShareSqm: 22.3, exclusiveAreaSqm: 85.4 });
    b.deposit(52_000_000);
    b.funeral(1_600_000, sp);
    b.give(M, sp);
    b.smallLand(M, "residence", sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  // ── 土地の使い方 ──
  ["貸家建付地と貸家（満室）", ["土地の使い方"], (b) => {
    b.dec({ age: 83, male: true });
    const sp = b.spouse({ age: 80 });
    const c1 = b.child({ age: 54 });
    const c2 = b.child({ age: 51 });
    const L = b.landR({ label: `アパートの土地（${b.location()}）`, price: 220_000, frontage: 14, depth: 15, use: "rentedHouse", rentRatio: 1 });
    const B = b.building(22_000_000, { label: "アパート（軽量鉄骨2階建・6室）", rented: true, rentRatio: 1 });
    b.deposit(50_000_000);
    b.funeral(1_800_000, sp);
    b.give(L, c1);
    b.give(B, c1);
    b.split({ [sp]: 2, [c2]: 1 });
  }],
  ["貸家建付地と貸家（空室あり、賃貸割合0.75）", ["土地の使い方"], (b) => {
    b.dec({ age: 79, male: false });
    const c1 = b.child({ age: 52 });
    const c2 = b.child({ age: 49 });
    const L = b.landR({ label: `アパートの土地（${b.location()}）`, price: 310_000, frontage: 12, depth: 20, use: "rentedHouse", rentRatio: 0.75 });
    const B = b.building(28_000_000, { label: "アパート（8室中6室賃貸）", rented: true, rentRatio: 0.75 });
    b.deposit(35_000_000);
    b.debt(15_000_000, c1, "アパートローン");
    b.funeral(1_500_000, c1);
    b.give(L, c1);
    b.give(B, c1);
    b.split({ [c2]: 1 });
  }],
  ["貸宅地（底地）", ["土地の使い方"], (b) => {
    b.dec({ age: 88, male: true });
    const c1 = b.child({ age: 60 });
    const c2 = b.child({ age: 57 });
    const h = home(b, { price: 240_000, frontage: 12, depth: 15, bldg: 2_200_000 });
    const L = b.landR({ label: `貸している土地（${b.location()}）`, price: 300_000, frontage: 12, depth: 15, use: "leasedLand", letter: "D" });
    b.deposit(40_000_000);
    b.funeral(1_600_000, c1);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.smallLand(h.L, "residence", c1);
    b.give(L, c2);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["借地権（借りた土地に自宅、路線価C）", ["土地の使い方"], (b) => {
    b.dec({ age: 80, male: true });
    const sp = b.spouse({ age: 77 });
    const c1 = b.child({ age: 50 });
    const L = b.landR({ label: `自宅の借地権（${b.homeLocation()}）`, price: 400_000, frontage: 10, depth: 15, use: "leasehold", letter: "C" });
    const B = b.building(3_500_000);
    b.deposit(42_000_000);
    b.funeral(1_500_000, sp);
    b.give(L, sp);
    b.give(B, sp);
    b.smallLand(L, "residence", sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["倍率地域の借地権（借地権割合40%）", ["土地の使い方"], (b) => {
    b.moveRural();
    b.dec({ age: 84, male: false });
    const c1 = b.child({ age: 56 });
    const c2 = b.child({ age: 53 });
    const L = b.landM({ label: `自宅の借地権（${b.homeLocation()}）`, area: 230, fixedAssetValue: 4_500_000, rate: 1.1, leaseRatio: 0.4, use: "leasehold" });
    const B = b.building(1_800_000);
    b.deposit(44_000_000);
    b.funeral(1_300_000, c1);
    b.give(L, c1);
    b.give(B, c1);
    b.split({ [c2]: 1 });
  }],
  // ── 路線・地区区分 ──
  ["角地（側方路線影響加算）", ["路線"], (b) => {
    b.dec({ age: 77, male: true });
    const sp = b.spouse({ age: 74 });
    const c1 = b.child({ age: 47 });
    const h = home(b, { price: 300_000, side: 250_000, frontage: 12, depth: 15, bldg: 5_200_000 });
    b.deposit(40_000_000);
    b.funeral(1_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["二方路線（裏面路線影響加算）", ["路線"], (b) => {
    b.dec({ age: 81, male: false });
    const c1 = b.child({ age: 53 });
    const c2 = b.child({ age: 50 });
    const h = home(b, { price: 280_000, back: 200_000, frontage: 10, depth: 30, bldg: 2_600_000 });
    b.deposit(36_000_000);
    b.funeral(1_400_000, c1);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.split({ [c2]: 1 });
  }],
  ["四方を道路に囲まれた土地（正面・側方2・裏面）", ["路線"], (b) => {
    b.dec({ age: 74, male: true });
    const sp = b.spouse({ age: 70 });
    const c1 = b.child({ age: 45, male: true });
    const L = b.landR({ label: `店舗兼住宅の土地（${b.location()}）`, district: "普通商業・併用住宅地区", price: 500_000, side: 450_000, side2: 400_000, back: 380_000, frontage: 20, depth: 25 });
    const B = b.building(15_000_000, { label: "店舗兼住宅" });
    b.deposit(80_000_000);
    b.funeral(2_000_000, sp);
    b.give(L, c1);
    b.give(B, c1);
    b.split({ [sp]: 1 });
  }],
  ["地区区分：ビル街地区（奥行45m）", ["路線"], (b) => {
    b.dec({ age: 86, male: true });
    const c1 = b.child({ age: 58, male: true });
    const c2 = b.child({ age: 55 });
    const L = b.landR({ label: `ビルの敷地（${b.location()}）`, district: "ビル街地区", price: 2_500_000, frontage: 15, depth: 45, letter: "A" });
    b.deposit(200_000_000);
    b.funeral(3_000_000, c1);
    b.give(L, c1);
    b.split({ [c2]: 1 });
  }],
  ["地区区分：高度商業地区", ["路線"], (b) => {
    b.dec({ age: 83, male: true });
    const c1 = b.child({ age: 55 });
    const c2 = b.child({ age: 52 });
    b.landR({ label: `貸ビル予定地（青空駐車場、${b.location()}）`, district: "高度商業地区", price: 1_200_000, frontage: 12, depth: 30, letter: "B", landUse: "雑種地", use: "parking" });
    b.deposit(60_000_000);
    b.funeral(2_000_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["地区区分：繁華街地区（奥行7mの短い土地）", ["路線"], (b) => {
    b.dec({ age: 79, male: false });
    const c1 = b.child({ age: 51 });
    b.landR({ label: `店舗の土地（${b.location()}）`, district: "繁華街地区", price: 900_000, frontage: 8, depth: 7, letter: "C" });
    b.building(4_000_000, { label: "店舗" });
    b.deposit(25_000_000);
    b.funeral(1_200_000, c1);
    b.split({ [c1]: 1 });
  }],
  ["地区区分：普通商業・併用住宅地区（奥行45mの長い土地）", ["路線"], (b) => {
    b.dec({ age: 76, male: true });
    const sp = b.spouse({ age: 73 });
    const c1 = b.child({ age: 46 });
    const h = home(b, { price: 350_000, district: "普通商業・併用住宅地区", frontage: 10, depth: 45, bldg: 6_000_000 });
    b.deposit(30_000_000);
    b.funeral(1_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [c1]: 1 });
  }],
  ["地区区分：中小工場地区", ["路線"], (b) => {
    b.dec({ age: 73, male: true });
    const sp = b.spouse({ age: 70 });
    const c1 = b.child({ age: 44, male: true });
    const L = b.landR({ label: `工場の土地（${b.location()}）`, district: "中小工場地区", price: 150_000, frontage: 30, depth: 50 });
    const B = b.building(20_000_000, { label: "工場" });
    b.deposit(40_000_000);
    b.funeral(1_600_000, sp);
    b.give(L, c1);
    b.give(B, c1);
    b.split({ [sp]: 1 });
  }],
  ["地区区分：大工場地区（6,000㎡）", ["路線"], (b) => {
    b.dec({ age: 80, male: true });
    const c1 = b.child({ age: 52, male: true });
    const c2 = b.child({ age: 49 });
    b.landR({ label: `倉庫用地（${b.location()}）`, district: "大工場地区", price: 90_000, frontage: 60, depth: 100, use: "self", landUse: "雑種地" });
    b.deposit(50_000_000);
    b.funeral(1_800_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["普通住宅地区：間口狭小・奥行長大（間口4.5m・奥行26m）", ["路線"], (b) => {
    b.dec({ age: 82, male: false });
    const c1 = b.child({ age: 54 });
    const h = home(b, { price: 260_000, frontage: 4.5, depth: 26, bldg: 1_400_000 });
    b.deposit(30_000_000);
    b.funeral(1_300_000, c1);
    b.smallLand(h.L, "residence", c1);
    b.split({ [c1]: 1 });
  }],
  ["普通住宅地区：奥行6mの浅い土地", ["路線"], (b) => {
    b.dec({ age: 75, male: true });
    const c1 = b.child({ age: 45 });
    const c2 = b.child({ age: 42 });
    b.landR({ label: `貸駐車場（${b.location()}）`, price: 200_000, frontage: 15, depth: 6, landUse: "雑種地", use: "parking" });
    b.deposit(42_000_000);
    b.funeral(1_200_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["正面路線の判定（側方路線の方が奥行補正後に高い）", ["路線"], (b) => {
    b.dec({ age: 78, male: true });
    const sp = b.spouse({ age: 75 });
    const c1 = b.child({ age: 48 });
    const h = home(b, { price: 200_000, side: 210_000, frontage: 12, depth: 30, bldg: 3_000_000 });
    b.deposit(38_000_000);
    b.funeral(1_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [c1]: 1 });
  }],
  ["倍率地域の宅地（自宅）", ["倍率"], (b) => {
    b.moveRural();
    b.dec({ age: 84, male: true });
    const sp = b.spouse({ age: 81 });
    const c1 = b.child({ age: 55 });
    const L = b.landM({ label: `自宅の土地（${b.homeLocation()}）`, area: 330, fixedAssetValue: 6_800_000, rate: 1.1 });
    const B = b.building(2_100_000);
    b.deposit(45_000_000);
    b.funeral(1_500_000, sp);
    b.give(L, sp);
    b.give(B, sp);
    b.smallLand(L, "residence", sp);
    b.split({ [c1]: 1 });
  }],
  ["田（倍率方式、純農地）", ["倍率"], (b) => {
    b.moveRural();
    b.dec({ age: 87, male: true });
    const c1 = b.child({ age: 60, male: true });
    const c2 = b.child({ age: 56 });
    const L = b.landM({ label: `自宅の土地（${b.homeLocation()}）`, area: 450, fixedAssetValue: 5_400_000, rate: 1.1 });
    const B = b.building(1_600_000);
    const R = b.landM({ label: `田（${b.location()}）`, area: 2_500, fixedAssetValue: 162_500, rate: 32, landUse: "田" });
    b.deposit(30_000_000);
    b.funeral(1_500_000, c1);
    b.give(L, c1);
    b.give(B, c1);
    b.give(R, c1);
    b.smallLand(L, "residence", c1);
    b.split({ [c2]: 1 });
  }],
  ["畑と山林（倍率方式）", ["倍率"], (b) => {
    b.moveRural();
    b.dec({ age: 90, male: true });
    const c1 = b.child({ age: 62, male: true });
    const c2 = b.child({ age: 58 });
    b.landM({ label: `畑（${b.location()}）`, area: 1_200, fixedAssetValue: 96_000, rate: 20, landUse: "畑" });
    b.landM({ label: `山林（${b.location()}）`, area: 15_000, fixedAssetValue: 210_000, rate: 15, landUse: "山林" });
    b.deposit(40_000_000);
    b.funeral(1_400_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["雑種地（青空駐車場、路線価）", ["雑種地"], (b) => {
    b.dec({ age: 77, male: false });
    const c1 = b.child({ age: 50 });
    const c2 = b.child({ age: 46 });
    const L = b.landR({ label: `月極駐車場（${b.location()}）`, price: 220_000, frontage: 15, depth: 20, landUse: "雑種地", use: "parking" });
    b.deposit(32_000_000);
    b.funeral(1_300_000, c1);
    b.give(L, c2);
    b.split({ [c1]: 1 });
  }],
  // ── マンション ──
  ["マンション：築2年・42階建ての38階（区分所有補正で評価額が上がる）", ["マンション"], (b) => {
    b.dec({ age: 68, male: true });
    const sp = b.spouse({ age: 64 });
    const c1 = b.child({ age: 35 });
    const M = b.condo({ landValue: 18_000_000, buildingFixedAssetValue: 14_500_000, builtYears: 2, builtMonths: 3, totalFloors: 42, floor: 38, landShareSqm: 18.5, exclusiveAreaSqm: 75.2 });
    b.deposit(30_000_000);
    b.funeral(1_500_000, sp);
    b.give(M, sp);
    b.smallLand(M, "residence", sp);
    b.split({ [c1]: 1 });
  }],
  ["マンション：築40年・6階建ての2階（評価水準が0.6〜1の範囲）", ["マンション"], (b) => {
    b.dec({ age: 85, male: false });
    const c1 = b.child({ age: 55 });
    b.condo({ landValue: 8_000_000, buildingFixedAssetValue: 3_200_000, builtYears: 40, builtMonths: 2, totalFloors: 6, floor: 2, landShareSqm: 30, exclusiveAreaSqm: 65 });
    b.deposit(33_000_000);
    b.funeral(1_200_000, c1);
    b.split({ [c1]: 1 });
  }],
  ["マンション：築52年・4階建ての1階・敷地持分が広い（評価乖離率が1未満）", ["マンション"], (b) => {
    b.dec({ age: 92, male: false });
    const c1 = b.child({ age: 63 });
    const c2 = b.child({ age: 60 });
    b.condo({ landValue: 15_000_000, buildingFixedAssetValue: 1_800_000, builtYears: 52, builtMonths: 7, totalFloors: 4, floor: 1, landShareSqm: 60, exclusiveAreaSqm: 55 });
    b.deposit(40_000_000);
    b.funeral(1_300_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["マンション：総階数2階（区分所有補正の対象外）", ["マンション"], (b) => {
    b.dec({ age: 80, male: true });
    const sp = b.spouse({ age: 78 });
    const c1 = b.child({ age: 50 });
    const M = b.condo({ landValue: 11_000_000, buildingFixedAssetValue: 4_000_000, builtYears: 20, builtMonths: 0, totalFloors: 2, floor: 2, landShareSqm: 35, exclusiveAreaSqm: 70 });
    b.deposit(36_000_000);
    b.funeral(1_400_000, sp);
    b.give(M, sp);
    b.smallLand(M, "residence", sp);
    b.split({ [c1]: 1 });
  }],
  ["賃貸中のマンション（貸家・貸家建付地）", ["マンション"], (b) => {
    b.dec({ age: 73, male: true });
    const sp = b.spouse({ age: 70 });
    const c1 = b.child({ age: 42 });
    const h = home(b, { price: 330_000, frontage: 11, depth: 15, bldg: 5_500_000 });
    const M = b.condo({ label: `賃貸中のマンション（${b.location()}）`, landValue: 14_000_000, buildingFixedAssetValue: 8_500_000, builtYears: 10, builtMonths: 4, totalFloors: 11, floor: 7, landShareSqm: 16.2, exclusiveAreaSqm: 55.3, rented: true, leaseRatio: 0.7, rentRatio: 1 });
    b.deposit(40_000_000);
    b.funeral(1_600_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.give(M, c1);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["マンション：築0年（4か月）・15階建ての1階", ["マンション"], (b) => {
    b.dec({ age: 66, male: true });
    const sp = b.spouse({ age: 63 });
    const c1 = b.child({ age: 34 });
    const M = b.condo({ landValue: 20_000_000, buildingFixedAssetValue: 16_000_000, builtYears: 0, builtMonths: 4, totalFloors: 15, floor: 1, landShareSqm: 20.1, exclusiveAreaSqm: 80.2 });
    b.deposit(25_000_000);
    b.insurance(10_000_000, sp);
    b.funeral(1_500_000, sp);
    b.give(M, sp);
    b.smallLand(M, "residence", sp);
    b.split({ [c1]: 1 });
  }],
  // ── 株式 ──
  ["上場株式：4つの価格のうち最も低いもの（円未満の価格）", ["株式"], (b) => {
    b.dec({ age: 79, male: true });
    const sp = b.spouse({ age: 76 });
    const c1 = b.child({ age: 49 });
    b.listed(3_300, { close: 1_234.5, monthAvg: 1_228.3, prevMonthAvg: 1_240, prev2MonthAvg: 1_219.7 });
    b.deposit(45_000_000);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["上場株式：複数銘柄（銘柄ごとに最も低い価格が違う）", ["株式"], (b) => {
    b.dec({ age: 83, male: true });
    const sp = b.spouse({ age: 80 });
    const c1 = b.child({ age: 53 });
    const c2 = b.child({ age: 50 });
    b.listed(5_000, { close: 980, monthAvg: 1_010, prevMonthAvg: 1_050, prev2MonthAvg: 1_100 });
    b.listed(1_200, { close: 7_820, monthAvg: 7_650, prevMonthAvg: 7_900, prev2MonthAvg: 8_010 });
    b.listed(300, { close: 15_400, monthAvg: 15_100, prevMonthAvg: 14_850.5, prev2MonthAvg: 15_020 });
    b.listed(10_000, { close: 512, monthAvg: 519.8, prevMonthAvg: 525.1, prev2MonthAvg: 497.6 });
    b.deposit(50_000_000);
    b.funeral(1_700_000, sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["非上場株式（同族会社、評価額を入力）", ["株式"], (b) => {
    b.dec({ age: 77, male: true });
    const sp = b.spouse({ age: 74 });
    const c1 = b.child({ age: 48, male: true });
    const c2 = b.child({ age: 45 });
    const U = b.unlisted(20_000, 120_000_000);
    const h = home(b, { price: 380_000, frontage: 12, depth: 16, bldg: 7_000_000 });
    b.deposit(60_000_000);
    b.funeral(2_000_000, sp);
    b.give(U, c1);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 1, [c2]: 1 });
  }],
  // ── 生前贈与 ──
  ["3年以内贈与：期間の内側・外側・ちょうど3年前の日", ["贈与"], (b) => {
    b.dec({ age: 82, male: true });
    const sp = b.spouse({ age: 79 });
    const c1 = b.child({ age: 52 });
    const c2 = b.child({ age: 49 });
    b.deposit(70_000_000);
    b.gift(c1, addYears(b.death, -3), 2_000_000);
    b.gift(c1, addDays(addYears(b.death, -3), -1), 2_000_000);
    b.gift(c2, addYears(b.death, -1), 2_000_000);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["3年以内贈与：受贈者の孫が何も取得しない（加算しない）", ["贈与"], (b) => {
    b.dec({ age: 84, male: false, deathDate: "2026-06-18" });
    const c1 = b.child({ age: 55 });
    const c2 = b.child({ age: 52 });
    const g1 = b.grandchild(c1, { age: 24 });
    b.deposit(50_000_000);
    b.gift(g1, "2025-01-10", 3_000_000);
    b.gift(g1, "2024-02-01", 1_100_000);
    b.funeral(1_300_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["3年以内贈与：受贈者が放棄して何も取得しない（加算しない）", ["贈与"], (b) => {
    b.dec({ age: 80, male: true, deathDate: "2026-05-20" });
    const sp = b.spouse({ age: 77 });
    const c1 = b.child({ age: 50 });
    const c2 = b.child({ age: 47, renounced: true });
    b.deposit(60_000_000);
    b.gift(c2, "2025-03-15", 5_000_000);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["3年以内贈与：放棄したが生命保険金を受け取る（加算する）", ["贈与"], (b) => {
    b.dec({ age: 78, male: true, deathDate: "2026-08-08" });
    const sp = b.spouse({ age: 75 });
    const c1 = b.child({ age: 48 });
    const c2 = b.child({ age: 45, renounced: true });
    b.deposit(55_000_000);
    b.insurance(6_000_000, c2);
    b.gift(c2, "2024-04-01", 4_000_000);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["3年以内贈与：贈与税を納めている（贈与税額控除）", ["贈与"], (b) => {
    b.dec({ age: 81, male: true, deathDate: "2026-11-20" });
    const sp = b.spouse({ age: 78 });
    const c1 = b.child({ age: 51 });
    const c2 = b.child({ age: 48 });
    b.deposit(90_000_000);
    b.gift(c1, "2024-02-15", 10_000_000);
    b.gift(c2, "2025-04-01", 5_000_000);
    b.funeral(1_700_000, sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["3年以内贈与：亡くなった年の贈与（贈与税はかからない）", ["贈与"], (b) => {
    b.dec({ age: 85, male: false, deathDate: "2026-09-10" });
    const c1 = b.child({ age: 57 });
    const c2 = b.child({ age: 54 });
    b.deposit(48_000_000);
    b.gift(c1, "2026-03-01", 2_000_000);
    b.funeral(1_300_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["3年以内贈与：同じ年に2回の贈与（贈与税を按分）", ["贈与"], (b) => {
    b.dec({ age: 79, male: true, deathDate: "2026-07-07" });
    const sp = b.spouse({ age: 76 });
    const c1 = b.child({ age: 49 });
    b.deposit(65_000_000);
    b.gift(c1, "2025-02-01", 3_000_000);
    b.gift(c1, "2025-11-01", 2_000_000);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["相続時精算課税（令和6年以降の贈与、年110万円の基礎控除）", ["精算課税"], (b) => {
    b.dec({ age: 78, male: true, deathDate: "2026-07-20" });
    const sp = b.spouse({ age: 75 });
    const c1 = b.child({ age: 48 });
    const c2 = b.child({ age: 45 });
    b.deposit(60_000_000);
    b.gift(c1, "2024-05-10", 10_000_000, { settlement: true });
    b.gift(c1, "2025-05-10", 10_000_000, { settlement: true });
    b.gift(c1, "2026-02-01", 5_000_000, { settlement: true });
    b.funeral(1_600_000, sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["相続時精算課税（令和5年以前と以後、特別控除を超えて贈与税を納付）と暦年贈与", ["精算課税"], (b) => {
    b.dec({ age: 80, male: true, deathDate: "2026-10-15" });
    const sp = b.spouse({ age: 77 });
    const c1 = b.child({ age: 50 });
    const c2 = b.child({ age: 47 });
    b.deposit(80_000_000);
    b.gift(c1, "2021-06-01", 25_000_000, { settlement: true });
    b.gift(c1, "2024-06-01", 11_100_000, { settlement: true });
    b.gift(c2, "2024-03-01", 3_000_000);
    b.funeral(1_800_000, sp);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  ["相続時精算課税の受贈者が何も取得しない（それでも加算する）", ["精算課税"], (b) => {
    b.dec({ age: 76, male: false, deathDate: "2026-04-22" });
    const c1 = b.child({ age: 50 });
    const c2 = b.child({ age: 46 });
    const h = home(b, { price: 270_000, frontage: 11, depth: 15, bldg: 3_000_000 });
    b.deposit(30_000_000);
    b.gift(c2, "2023-10-01", 20_000_000, { settlement: true });
    b.funeral(1_400_000, c1);
    b.smallLand(h.L, "residence", c1);
    b.split({ [c1]: 1 });
  }],
  // ── 相次相続控除 ──
  ["相次相続控除（前の相続から1年未満）", ["相次相続"], (b) => {
    b.dec({ age: 84, male: false, prior: { yearsAgo: 0, prevTax: 8_000_000, prevAcquired: 100_000_000 } });
    const c1 = b.child({ age: 56 });
    const c2 = b.child({ age: 53 });
    const h = home(b, { price: 320_000, frontage: 12, depth: 16, bldg: 2_800_000 });
    b.deposit(95_000_000);
    b.funeral(1_600_000, c1);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["相次相続控除（4年前、前回の取得額が今回の財産より多い）", ["相次相続"], (b) => {
    b.dec({ age: 86, male: false, prior: { yearsAgo: 4, prevTax: 20_000_000, prevAcquired: 300_000_000 } });
    const c1 = b.child({ age: 58 });
    const c2 = b.child({ age: 55 });
    b.deposit(150_000_000);
    b.funeral(1_800_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["相次相続控除（9年前）", ["相次相続"], (b) => {
    b.dec({ age: 90, male: true, prior: { yearsAgo: 9, prevTax: 5_000_000, prevAcquired: 80_000_000 } });
    const c1 = b.child({ age: 61 });
    b.deposit(85_000_000);
    b.funeral(1_500_000, c1);
    b.split({ [c1]: 1 });
  }],
  // ── 分け方 ──
  ["未分割（申告期限までに分割できず法定相続分で申告）", ["分け方"], (b) => {
    b.dec({ age: 82, male: true });
    const sp = b.spouse({ age: 79 });
    const c1 = b.child({ age: 52 });
    const c2 = b.child({ age: 49 });
    home(b, { price: 300_000, frontage: 12, depth: 15, bldg: 3_500_000 });
    b.deposit(120_000_000);
    b.insurance(10_000_000, sp);
    b.funeral(1_800_000, { [sp]: 2, [c1]: 1, [c2]: 1 });
    b.undivided();
  }],
  ["代償分割（長男が全部を取得し、弟妹に代償金を払う）", ["分け方"], (b) => {
    b.dec({ age: 85, male: true });
    b.spouse({ age: 86, predeceased: true });
    const c1 = b.child({ age: 58, male: true });
    const c2 = b.child({ age: 55 });
    const c3 = b.child({ age: 52 });
    const h = home(b, { price: 350_000, frontage: 12, depth: 18, bldg: 3_000_000 });
    b.deposit(45_000_000);
    b.funeral(1_700_000, c1);
    b.smallLand(h.L, "residence", c1);
    b.split({ [c1]: 1 });
    b.compensate(c1, c2, 25_000_000);
    b.compensate(c1, c3, 25_000_000);
  }],
  ["配偶者居住権（自宅は子が取得し、配偶者が住み続ける）", ["分け方"], (b) => {
    b.dec({ age: 80, male: true });
    const sp = b.spouse({ age: 78 });
    const c1 = b.child({ age: 50 });
    const h = home(b, { price: 380_000, frontage: 12, depth: 16, bldg: 6_000_000, spouseResidenceRight: true });
    b.deposit(55_000_000);
    b.funeral(1_600_000, sp);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.split({ [sp]: 3, [c1]: 1 });
  }],
  ["国外財産（海外の預金と海外の不動産）", ["国外財産"], (b) => {
    b.dec({ age: 74, male: true });
    const sp = b.spouse({ age: 70 });
    const c1 = b.child({ age: 42 });
    b.deposit(40_000_000);
    b.deposit(30_123_456, "米国の銀行口座（米ドル建て）", true);
    b.otherAsset(52_000_000, "米国ハワイ州のコンドミニアム（現地の鑑定額を円換算）", true);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["地積規模の大きな宅地（1,050㎡）", ["補正が必要な土地"], (b) => {
    b.dec({ age: 88, male: true });
    const c1 = b.child({ age: 60 });
    const c2 = b.child({ age: 57 });
    const h = home(b, { price: 120_000, frontage: 30, depth: 35, bldg: 3_000_000, needsReduction: "largeLot" });
    b.deposit(30_000_000);
    b.funeral(1_500_000, c1);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.smallLand(h.L, "residence", c1);
    b.split({ [c2]: 1 });
  }],
  ["不整形地（旗竿地）", ["補正が必要な土地"], (b) => {
    b.dec({ age: 80, male: false });
    const c1 = b.child({ age: 52 });
    b.landR({ label: `自宅の土地（旗竿地、${b.homeLocation()}）`, price: 250_000, frontage: 8, depth: 27.5, needsReduction: "irregular" });
    b.building(2_000_000);
    b.deposit(28_000_000);
    b.funeral(1_200_000, c1);
    b.split({ [c1]: 1 });
  }],
  ["セットバックが必要な土地（前面道路の幅が4m未満）", ["補正が必要な土地"], (b) => {
    b.dec({ age: 83, male: true });
    const sp = b.spouse({ age: 80 });
    const c1 = b.child({ age: 54 });
    const L = b.landR({ label: `自宅の土地（${b.homeLocation()}）`, price: 300_000, frontage: 10, depth: 14, needsReduction: "setback" });
    const B = b.building(2_500_000);
    b.deposit(42_000_000);
    b.funeral(1_500_000, sp);
    b.give(L, sp);
    b.give(B, sp);
    b.smallLand(L, "residence", sp);
    b.split({ [c1]: 1 });
  }],
  ["配偶者がすべて取得（配偶者の税額軽減で0円）", ["分け方"], (b) => {
    b.dec({ age: 78, male: true });
    const sp = b.spouse({ age: 75 });
    b.child({ age: 48 });
    b.child({ age: 45 });
    const h = home(b, { price: 330_000, frontage: 12, depth: 16, bldg: 4_000_000 });
    b.deposit(90_000_000);
    b.listed(2_000, { close: 3_300, monthAvg: 3_250, prevMonthAvg: 3_180, prev2MonthAvg: 3_220 });
    b.funeral(1_800_000, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 1 });
  }],
  ["配偶者が1億6千万円と法定相続分の両方を超えて取得", ["分け方"], (b) => {
    b.dec({ age: 82, male: true });
    const sp = b.spouse({ age: 78 });
    const c1 = b.child({ age: 52 });
    const c2 = b.child({ age: 49 });
    const h = home(b, { price: 800_000, frontage: 15, depth: 20, bldg: 10_000_000 });
    b.deposit(250_000_000);
    b.listed(10_000, { close: 5_020, monthAvg: 4_980, prevMonthAvg: 5_100, prev2MonthAvg: 5_150 });
    b.funeral(2_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 3, [c1]: 1, [c2]: 1 });
  }],
  ["配偶者が1億6千万円を超えるが法定相続分以内（全額軽減）", ["分け方"], (b) => {
    b.dec({ age: 80, male: true });
    const sp = b.spouse({ age: 76 });
    const c1 = b.child({ age: 50 });
    const c2 = b.child({ age: 47 });
    const D1 = b.deposit(250_000_000);
    b.deposit(150_000_000);
    const h = home(b, { price: 600_000, frontage: 20, depth: 20, bldg: 9_000_000 });
    b.listed(30_000, { close: 2_010, monthAvg: 1_990, prevMonthAvg: 2_050, prev2MonthAvg: 2_100 });
    b.funeral(2_500_000, c1);
    b.give(D1, sp);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["遺産50億円（最高税率55%）", ["規模"], (b) => {
    b.dec({ age: 88, male: true });
    const sp = b.spouse({ age: 84 });
    const cs = children(b, [60, 57, 54]);
    const U = b.unlisted(200_000, 2_000_000_000, `${b.surname}ホールディングス株式会社 株式`);
    const L = b.landR({ label: `本社ビルの敷地（${b.location()}）`, district: "高度商業地区", price: 3_000_000, frontage: 20, depth: 30, letter: "A" });
    b.deposit(1_000_000_000);
    b.listed(30_000, { close: 6_000, monthAvg: 5_950, prevMonthAvg: 6_100, prev2MonthAvg: 6_200 });
    b.insurance(50_000_000, sp);
    b.funeral(5_000_000, sp);
    b.give(U, cs[0]);
    b.give(L, cs[0]);
    b.split({ [sp]: 3, [cs[1]]: 1, [cs[2]]: 1 });
  }],
  ["遺産100万円（申告は不要）", ["規模"], (b) => {
    b.dec({ age: 92, male: false });
    const c1 = b.child({ age: 64 });
    b.deposit(1_000_000);
    b.split({ [c1]: 1 });
  }],
  ["亡くなった日が2026年1月1日（3年以内贈与は2023年1月1日から）", ["日付"], (b) => {
    b.dec({ age: 83, male: true, deathDate: "2026-01-01" });
    const sp = b.spouse({ age: 80 });
    const c1 = b.child({ age: 53 });
    b.deposit(70_000_000);
    b.gift(c1, "2023-01-01", 3_000_000);
    b.gift(c1, "2022-12-31", 3_000_000);
    b.funeral(1_500_000, sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["亡くなった日が2026年2月28日（3年前の応当日の贈与）", ["日付"], (b) => {
    b.dec({ age: 79, male: false, deathDate: "2026-02-28" });
    const c1 = b.child({ age: 50 });
    const c2 = b.child({ age: 47 });
    b.deposit(60_000_000);
    b.gift(c2, "2023-02-28", 2_500_000);
    b.gift(c2, "2023-02-27", 2_500_000);
    b.funeral(1_300_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["亡くなった日が2026年12月31日", ["日付"], (b) => {
    b.dec({ age: 81, male: true, deathDate: "2026-12-31" });
    const sp = b.spouse({ age: 78 });
    const c1 = b.child({ age: 51 });
    const h = home(b, { price: 290_000, frontage: 11, depth: 15, bldg: 3_200_000 });
    b.deposit(52_000_000);
    b.gift(c1, "2023-12-31", 2_000_000);
    b.gift(c1, "2026-12-30", 1_000_000);
    b.funeral(1_600_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["被相続人が102歳", ["日付"], (b) => {
    b.dec({ age: 102, male: false });
    b.spouse({ age: 104, predeceased: true });
    const c1 = b.child({ age: 75 });
    const c2 = b.child({ age: 72 });
    b.deposit(48_000_000);
    b.funeral(1_200_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  // ── 一部未分割（穴埋め方式：未分割の部分は「法定相続分×分割対象の合計 − 分割で取得した額」の不足分の割合で） ──
  ["一部未分割：自宅は配偶者に決まり、大きな預金だけ未分割（穴埋め方式）", ["分け方", "一部未分割", "小規模宅地"], (b) => {
    b.dec({ age: 80, male: true });
    const sp = b.spouse({ age: 77 });
    b.child({ age: 50 });
    const c2 = b.child({ age: 47 });
    const h = home(b, { price: 300_000, frontage: 12, depth: 16, bldg: 3_000_000 });
    b.deposit(60_000_000);
    const D2 = b.deposit(10_000_000);
    b.funeral(1_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.give(D2, c2);
    b.partlyUndivided();
  }],
  ["一部未分割：配偶者と兄弟姉妹。法定相続分より多く取得した兄には未分割の分を割り当てない（2割加算）", ["分け方", "一部未分割"], (b) => {
    b.dec({ age: 74, male: true });
    const sp = b.spouse({ age: 71 });
    const b1 = b.sibling({ age: 72 });
    b.sibling({ age: 69 });
    const D1 = b.deposit(90_000_000);
    const L = b.landM({ label: `郷里の土地（${b.farLocation()}）`, area: 450, fixedAssetValue: 30_000_000, rate: 1.1 });
    b.listed(10_000, { close: 3_050, monthAvg: 3_000, prevMonthAvg: 2_980, prev2MonthAvg: 3_100 });
    b.funeral(1_600_000, sp);
    b.give(D1, sp);
    b.give(L, b1);
    b.partlyUndivided();
  }],
  ["一部未分割：預金の半分だけ分け方が決まった（子3人）", ["分け方", "一部未分割"], (b) => {
    b.dec({ age: 86, male: false });
    b.spouse({ age: 88, predeceased: true });
    const c1 = b.child({ age: 60 });
    const c2 = b.child({ age: 57 });
    b.child({ age: 54 });
    const D1 = b.deposit(50_000_000);
    const D2 = b.deposit(30_000_000);
    b.funeral(1_300_000, c1);
    b.givePart(D1, [{ who: c1, n: 1, d: 2 }]);
    b.give(D2, c2);
    b.partlyUndivided();
  }],
  // ── 扶養義務者（配偶者・直系血族・兄弟姉妹）への控除不足額の振替 ──
  ["障害者控除が引ききれない：特別障害者の配偶者（子なし）。亡くなった方の兄弟姉妹は扶養義務者でない", ["障害者", "控除不足額", "扶養義務者"], (b) => {
    b.dec({ age: 72, male: true });
    const sp = b.spouse({ age: 70, disability: "special" });
    const b1 = b.sibling({ age: 69 });
    const b2 = b.sibling({ age: 66 });
    const D1 = b.deposit(96_000_000);
    const D2 = b.deposit(24_000_000);
    b.funeral(1_500_000, sp);
    b.give(D1, sp);
    b.give(D2, { [b1]: 1, [b2]: 1 });
  }],
  ["未成年の代襲相続人（5歳）の控除不足：同じ親の兄から引き、おじ（亡くなった方の子）からは引かない", ["未成年者", "控除不足額", "扶養義務者"], (b) => {
    b.dec({ age: 72, male: true });
    const sp = b.spouse({ age: 69 });
    const c1 = b.child({ age: 46 });
    const c2 = b.child({ age: 43, predeceased: true });
    const g1 = b.grandchild(c2, { age: 5 });
    const g2 = b.grandchild(c2, { age: 19 });
    const D1 = b.deposit(70_000_000);
    const D2 = b.deposit(35_000_000);
    const D3 = b.deposit(1_000_000);
    const D4 = b.deposit(34_000_000);
    b.funeral(1_500_000, sp);
    b.give(D1, sp);
    b.give(D2, c1);
    b.give(D3, g1);
    b.give(D4, g2);
  }],
  ["未成年の代襲相続人の控除不足：1億6千万円を超えて取得した祖母（配偶者）から引き、おじ・いとこからは引かない", ["未成年者", "控除不足額", "扶養義務者"], (b) => {
    b.dec({ age: 79, male: true });
    const sp = b.spouse({ age: 76 });
    const c1 = b.child({ age: 52 });
    const c2 = b.child({ age: 48, predeceased: true });
    const g1 = b.grandchild(c2, { age: 6 });
    const g3 = b.grandchild(c1, { age: 22 });
    const D1 = b.deposit(300_000_000);
    const D2 = b.deposit(140_000_000);
    const D3 = b.deposit(2_000_000);
    b.insurance(6_000_000, g3, "死亡保険金（受取人は孫）");
    b.funeral(2_000_000, sp);
    b.give(D1, sp);
    b.give(D2, c1);
    b.give(D3, g1);
  }],
  ["未成年の甥の控除不足：同じ親のきょうだい（甥）から引き、おじ・いとこにあたる人からは引かない", ["未成年者", "控除不足額", "扶養義務者"], (b) => {
    b.dec({ age: 70, male: false });
    const b1 = b.sibling({ age: 68 });
    const b2 = b.sibling({ age: 64, predeceased: true });
    const n1 = b.nephew(b2, { age: 10 });
    const n2 = b.nephew(b2, { age: 26 });
    const b3 = b.sibling({ age: 66, predeceased: true });
    const n3 = b.nephew(b3, { age: 35 });
    const D1 = b.deposit(40_000_000);
    const D2 = b.deposit(1_000_000);
    const D3 = b.deposit(39_000_000);
    const D4 = b.deposit(40_000_000);
    b.funeral(1_400_000, b1);
    b.give(D1, b1);
    b.give(D2, n1);
    b.give(D3, n2);
    b.give(D4, n3);
  }],
  ["特別障害者の母の控除不足：父と全血の兄弟から引き、半血の兄・亡くなった方の配偶者からは引かない", ["障害者", "控除不足額", "扶養義務者"], (b) => {
    b.dec({ age: 50, male: true });
    const sp = b.spouse({ age: 48 });
    const fa = b.parent(true, { age: 79 });
    const mo = b.parent(false, { age: 76, disability: "special" });
    const s1 = b.sibling({ age: 47 });
    const s2 = b.sibling({ age: 55, halfBlood: true });
    const D1 = b.deposit(100_000_000);
    const D2 = b.deposit(30_000_000);
    const D3 = b.deposit(2_000_000);
    const D4 = b.deposit(10_000_000, "定期預金（遺言で弟に遺贈）");
    const D5 = b.deposit(10_000_000, "定期預金（遺言で兄に遺贈）");
    b.funeral(1_500_000, sp);
    b.give(D1, sp);
    b.give(D2, fa);
    b.give(D3, mo);
    b.give(D4, s1);
    b.give(D5, s2);
  }],
  ["半血の兄弟姉妹（障害者）の控除不足：全血の兄弟から引き、半血どうしでは引かない", ["障害者", "控除不足額", "扶養義務者", "家族の形"], (b) => {
    b.dec({ age: 80, male: true });
    const s1 = b.sibling({ age: 75, halfBlood: true, disability: "general" });
    const s2 = b.sibling({ age: 78, halfBlood: true });
    const s3 = b.sibling({ age: 82 });
    const D1 = b.deposit(3_000_000);
    const D2 = b.deposit(40_000_000);
    const D3 = b.deposit(80_000_000);
    b.funeral(1_300_000, s3);
    b.give(D1, s1);
    b.give(D2, s2);
    b.give(D3, s3);
  }],
  ["特別障害者の配偶者の控除不足：子から引き、亡くなった方の母（受遺者）・知人（受遺者）からは引かない", ["障害者", "控除不足額", "扶養義務者"], (b) => {
    b.dec({ age: 60, male: true });
    const sp = b.spouse({ age: 58, disability: "special" });
    const c1 = b.child({ age: 30 });
    const c2 = b.child({ age: 27 });
    const mo = b.parent(false, { age: 84 });
    const o1 = b.other({ age: 55 });
    const D1 = b.deposit(70_000_000);
    const D2 = b.deposit(30_000_000);
    const D3 = b.deposit(30_000_000);
    const D4 = b.deposit(10_000_000, "定期預金（遺言で母に遺贈）");
    const D5 = b.deposit(5_000_000, "定期預金（遺言で知人に遺贈）");
    b.funeral(1_500_000, sp);
    b.give(D1, sp);
    b.give(D2, c1);
    b.give(D3, c2);
    b.give(D4, mo);
    b.give(D5, o1);
  }],
  // ── 一部が空室の貸付事業用宅地等（貸している部分だけ：自用地 × 賃貸割合 × (1 − 借地権割合 × 0.3)） ──
  ["貸付事業用：一部が空室のアパート（国税庁の例：自用地4,000万円・借地権割合0.7・賃貸割合0.9）", ["小規模宅地", "空室のある貸付"], (b) => {
    b.dec({ age: 81, male: true });
    b.spouse({ age: 79, predeceased: true });
    const c1 = b.child({ age: 52 });
    const c2 = b.child({ age: 49 });
    const L = b.landR({ label: `アパートの土地（${b.location()}）`, price: 200_000, frontage: 12.5, depth: 16, letter: "C", use: "rentedHouse", rentRatio: 0.9 });
    const B = b.building(15_000_000, { label: "アパート（10室中9室賃貸）", rented: true, rentRatio: 0.9 });
    b.deposit(40_000_000);
    b.funeral(1_400_000, c1);
    b.give(L, c1);
    b.give(B, c1);
    b.smallLand(L, "rental", c1);
    b.split({ [c2]: 1 });
  }],
  ["貸付事業用：一部が空室の賃貸マンション（区分所有補正のあとの敷地のうち貸している部分だけ）", ["小規模宅地", "マンション", "空室のある貸付"], (b) => {
    b.dec({ age: 76, male: false });
    const sp = b.spouse({ age: 79 });
    const c1 = b.child({ age: 48 });
    const h = home(b, { price: 260_000, frontage: 11, depth: 15, bldg: 3_400_000 });
    const M = b.condo({ label: `賃貸中のマンション（${b.location()}）`, landValue: 18_000_000, buildingFixedAssetValue: 9_000_000, builtYears: 8, builtMonths: 3, totalFloors: 14, floor: 9, landShareSqm: 24.5, exclusiveAreaSqm: 96.4, rented: true, leaseRatio: 0.7, rentRatio: 0.5 });
    b.deposit(42_000_000);
    b.funeral(1_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.give(M, c1);
    b.smallLand(M, "rental", c1);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["貸付事業用：空室のあるアパートを兄弟で共有（持分のうち貸している部分、200㎡まで）", ["小規模宅地", "空室のある貸付", "小規模宅地（共有取得）"], (b) => {
    b.dec({ age: 84, male: true });
    b.spouse({ age: 82, predeceased: true });
    const c1 = b.child({ age: 56 });
    const c2 = b.child({ age: 53 });
    const L = b.landR({ label: `アパートの土地（${b.location()}）`, price: 260_000, frontage: 19.2, depth: 25, use: "rentedHouse", rentRatio: 0.9 });
    const B = b.building(32_000_000, { label: "アパート（20室中18室賃貸）", rented: true, rentRatio: 0.9 });
    b.deposit(30_000_000);
    b.debt(20_000_000, { [c1]: 1, [c2]: 1 }, "アパートローン");
    b.funeral(1_600_000, c1);
    b.give(L, { [c1]: 1, [c2]: 1 });
    b.give(B, { [c1]: 1, [c2]: 1 });
    b.smallLand(L, "rental", c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  // ── 貸家建付借地権（人の土地を借りてアパートを建てて貸している。評基通28） ──
  ["貸家建付借地権（借りた土地にアパート、満室、貸付事業用）", ["土地の使い方", "小規模宅地"], (b) => {
    b.dec({ age: 77, male: true });
    const sp = b.spouse({ age: 74 });
    const c1 = b.child({ age: 47 });
    const h = home(b, { price: 280_000, frontage: 11, depth: 15, bldg: 3_200_000 });
    const L = b.landR({ label: `借地に建てたアパートの借地権（${b.location()}）`, price: 320_000, frontage: 14, depth: 18, letter: "D", use: "rentedLeasehold", rentRatio: 1 });
    const B = b.building(20_000_000, { label: "アパート（借地上、6室）", rented: true, rentRatio: 1 });
    b.deposit(45_000_000);
    b.funeral(1_600_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.give(L, c1);
    b.give(B, c1);
    b.smallLand(L, "rental", c1);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["貸家建付借地権（倍率地域、空室あり賃貸割合0.8、貸付事業用は貸している部分だけ）", ["土地の使い方", "小規模宅地", "空室のある貸付"], (b) => {
    b.moveRural();
    b.dec({ age: 83, male: false });
    const c1 = b.child({ age: 57 });
    const c2 = b.child({ age: 54 });
    const L = b.landM({ label: `借地に建てたアパートの借地権（${b.location()}）`, area: 280, fixedAssetValue: 12_000_000, rate: 1.1, leaseRatio: 0.6, use: "rentedLeasehold", rentRatio: 0.8 });
    const B = b.building(16_000_000, { label: "アパート（借地上、10室中8室賃貸）", rented: true, rentRatio: 0.8 });
    b.deposit(38_000_000);
    b.funeral(1_300_000, c1);
    b.give(L, c1);
    b.give(B, c1);
    b.smallLand(L, "rental", c1);
    b.split({ [c2]: 1 });
  }],
  ["貸家建付借地権（空室あり賃貸割合0.75、特例なし）", ["土地の使い方", "空室のある貸付"], (b) => {
    b.dec({ age: 88, male: true });
    const sp = b.spouse({ age: 84 });
    const c1 = b.child({ age: 58 });
    const c2 = b.child({ age: 55 });
    const L = b.landR({ label: `借地に建てた貸家の借地権（${b.location()}）`, price: 410_000, frontage: 10, depth: 20, use: "rentedLeasehold", rentRatio: 0.75 });
    const B = b.building(9_000_000, { label: "貸家（4戸中3戸賃貸）", rented: true, rentRatio: 0.75 });
    b.deposit(60_000_000);
    b.funeral(1_700_000, sp);
    b.give(L, c2);
    b.give(B, c2);
    b.split({ [sp]: 2, [c1]: 1, [c2]: 1 });
  }],
  // ── 前の相続でも未成年者控除・障害者控除を受けた（19条の3第3項・19条の4第3項） ──
  ["前の相続でも未成年者控除を受けた（父の相続で使い切り、今回は0円）", ["未成年者", "前の相続でも未成年者控除", "相次相続"], (b) => {
    b.dec({ age: 44, male: false, deathDate: "2026-06-20", prior: { yearsAgo: 3, prevTax: 2_800_000, prevAcquired: 60_000_000 } });
    b.spouse({ age: 46, predeceased: true });
    const c1 = b.child({ age: 19 });
    const c2 = b.child({ birthDate: "2014-03-01", priorMinorCredit: { date: "2023-06-20", amount: 900_000 } });
    b.deposit(64_000_000);
    b.funeral(1_200_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["前の相続でも未成年者控除を受けた（一部だけ使った残りまで）", ["未成年者", "前の相続でも未成年者控除", "相次相続"], (b) => {
    b.dec({ age: 47, male: false, deathDate: "2026-09-05", prior: { yearsAgo: 2, prevTax: 1_500_000, prevAcquired: 45_000_000 } });
    b.spouse({ age: 49, predeceased: true });
    const c1 = b.child({ age: 22 });
    const c2 = b.child({ birthDate: "2014-05-01", priorMinorCredit: { date: "2024-09-05", amount: 300_000 } });
    b.deposit(70_000_000);
    b.funeral(1_300_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["前の相続（令和3年）でも未成年者控除を受けた（今回の相続では18歳までの年数で計算）", ["未成年者", "前の相続でも未成年者控除"], (b) => {
    b.dec({ age: 45, male: true, deathDate: "2026-06-20" });
    const sp = b.spouse({ age: 43 });
    const c1 = b.child({ birthDate: "2013-03-01", priorMinorCredit: { date: "2021-09-15", amount: 650_000 } });
    b.deposit(80_000_000);
    b.funeral(1_300_000, sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["前の相続でも障害者控除を受けた（一般障害者、残りだけ控除し、引ききれない分は兄から）", ["障害者", "前の相続でも障害者控除", "控除不足額"], (b) => {
    b.dec({ age: 79, male: false, deathDate: "2026-05-12" });
    b.spouse({ age: 82, predeceased: true });
    const c1 = b.child({ birthDate: "1975-08-01", disability: "general", priorDisabilityCredit: { date: "2020-03-01", amount: 2_000_000 } });
    const c2 = b.child({ age: 53 });
    const D1 = b.deposit(8_000_000);
    const D2 = b.deposit(62_000_000);
    b.funeral(1_400_000, c2);
    b.give(D1, c1);
    b.give(D2, c2);
  }],
  // ── 精算課税の贈与税の還付（基礎控除以下でも申告が要る） ──
  ["相続時精算課税の贈与税が戻る（遺産は基礎控除以下でも申告が要る）", ["精算課税", "基礎控除"], (b) => {
    b.dec({ age: 84, male: true });
    b.spouse({ age: 86, predeceased: true });
    const c1 = b.child({ age: 56 });
    const c2 = b.child({ age: 53 });
    b.deposit(5_000_000);
    b.funeral(1_200_000, c2);
    b.gift(c1, "2019-06-01", 28_000_000, { settlement: true });
    b.split({ [c2]: 1 });
  }],
  ["相続時精算課税の贈与税（100円未満の端数のある入力）が戻る（控除額は100円未満切捨て）", ["精算課税", "基礎控除"], (b) => {
    b.dec({ age: 79, male: false });
    const sp = b.spouse({ age: 81 });
    const c1 = b.child({ age: 51 });
    b.deposit(12_000_000);
    b.funeral(1_300_000, sp);
    b.gift(c1, "2024-07-01", 30_000_000, { settlement: true, giftTaxPaid: 780_050 });
    b.split({ [sp]: 1 });
  }],
  // ── 代償金を特定の財産の時価をもとに決めた（相基通11の2-10(2)） ──
  ["代償分割：代償金をマンションの時価をもとに決めた（評価額÷時価で調整）", ["分け方", "代償分割"], (b) => {
    b.dec({ age: 83, male: false });
    b.spouse({ age: 85, predeceased: true });
    const c1 = b.child({ age: 55 });
    const c2 = b.child({ age: 52 });
    const M = b.condo({ landValue: 22_000_000, buildingFixedAssetValue: 9_500_000, builtYears: 12, builtMonths: 2, totalFloors: 15, floor: 10, landShareSqm: 20.4, exclusiveAreaSqm: 78.2 });
    b.deposit(30_000_000);
    b.funeral(1_500_000, c1);
    b.give(M, c1);
    b.smallLand(M, "residence", c1);
    b.split({ [c1]: 1, [c2]: 1 });
    b.compensate(c1, c2, 30_000_000, { item: M, marketValue: 60_000_000 });
  }],
  ["代償分割：代償金を自宅の土地の時価をもとに決めた（小規模宅地の前の評価額で調整）", ["分け方", "代償分割", "小規模宅地"], (b) => {
    b.dec({ age: 87, male: true });
    b.spouse({ age: 84, predeceased: true });
    const c1 = b.child({ age: 59 });
    const c2 = b.child({ age: 56 });
    const c3 = b.child({ age: 52 });
    const h = home(b, { price: 380_000, frontage: 13, depth: 17, bldg: 2_600_000 });
    b.deposit(24_000_000);
    b.funeral(1_600_000, c1);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.smallLand(h.L, "residence", c1);
    b.split({ [c1]: 1, [c2]: 1, [c3]: 1 });
    b.compensate(c1, c2, 20_000_000, { item: h.L, marketValue: 105_000_000 });
    b.compensate(c1, c3, 20_000_000, { item: h.L, marketValue: 105_000_000 });
  }],
  ["代償金を払う人が遺産を取得していない（生命保険金から払う。税理士に相談）", ["分け方", "代償分割"], (b) => {
    b.dec({ age: 79, male: true });
    const sp = b.spouse({ age: 76 });
    const c1 = b.child({ age: 50 });
    const c2 = b.child({ age: 47 });
    const h = home(b, { price: 260_000, frontage: 12, depth: 15, bldg: 3_000_000 });
    b.deposit(40_000_000);
    b.insurance(30_000_000, c1);
    b.funeral(1_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 1, [c2]: 1 });
    b.compensate(c1, c2, 8_000_000);
  }],
  // ── 正面路線の判定：路線価×奥行価格補正率が同じとき ──
  ["正面路線の判定：奥行価格補正後の額が同じなら間口の長い方（側方路線を正面にして奥行長大なし）", ["路線", "正面路線の判定（同じ額）"], (b) => {
    b.dec({ age: 81, male: true });
    const sp = b.spouse({ age: 78 });
    const c1 = b.child({ age: 50 });
    const h = home(b, { price: 200_000, side: 194_000, frontage: 12, depth: 25, bldg: 3_100_000 });
    b.deposit(32_000_000);
    b.funeral(1_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.split({ [c1]: 1 });
  }],
  ["正面路線の判定：間口も同じなら路線価の高い方（借地権割合はその路線の記号）", ["路線", "正面路線の判定（同じ額）", "土地の使い方"], (b) => {
    b.dec({ age: 85, male: false });
    const c1 = b.child({ age: 58 });
    const c2 = b.child({ age: 55 });
    const L = b.landR({
      label: `貸している土地（${b.location()}）`,
      price: 194_000,
      frontage: 20,
      depth: 12,
      area: 300,
      use: "leasedLand",
      roads: [
        { position: "front", price: 194_000, depth: 12, frontage: 20, leaseLetter: "D" },
        { position: "side", price: 200_000, depth: 25, frontage: 20, leaseLetter: "C" },
      ],
    });
    b.deposit(40_000_000);
    b.funeral(1_400_000, c1);
    b.give(L, c2);
    b.split({ [c1]: 1 });
  }],
  ["正面路線の判定：二方路線で路線価・奥行・間口がすべて同じ（入力の順で正面を決める）", ["路線", "正面路線の判定（同じ額）", "土地の使い方"], (b) => {
    b.dec({ age: 78, male: true });
    const sp = b.spouse({ age: 75 });
    const c1 = b.child({ age: 49 });
    const L = b.landR({
      label: `アパートの土地（${b.location()}）`,
      price: 250_000,
      frontage: 15,
      depth: 20,
      use: "rentedHouse",
      rentRatio: 1,
      roads: [
        { position: "front", price: 250_000, depth: 20, frontage: 15, leaseLetter: "C" },
        { position: "back", price: 250_000, depth: 20, frontage: 15, leaseLetter: "D" },
      ],
    });
    const B = b.building(18_000_000, { label: "アパート（木造2階建・6室）", rented: true, rentRatio: 1 });
    b.deposit(30_000_000);
    b.funeral(1_500_000, sp);
    b.give(L, c1);
    b.give(B, c1);
    b.split({ [sp]: 1 });
  }],
  // ── 税理士に確かめた補正率（不整形地は間口狭小・奥行長大を重ねない。補正率1も確かめた答え） ──
  ["不整形地：税理士に確かめた不整形地補正率0.81（間口狭小・奥行長大の補正は重ねない）", ["補正が必要な土地", "小規模宅地"], (b) => {
    b.dec({ age: 82, male: false });
    const c1 = b.child({ age: 54 });
    const c2 = b.child({ age: 51 });
    const L = b.landR({ label: `自宅の土地（旗竿地、${b.homeLocation()}）`, price: 200_000, frontage: 5, depth: 30, needsReduction: "irregular", advisorRate: 0.81 });
    const B = b.building(2_400_000);
    b.deposit(36_000_000);
    b.funeral(1_300_000, c1);
    b.give(L, c1);
    b.give(B, c1);
    b.smallLand(L, "residence", c1);
    b.split({ [c2]: 1 });
  }],
  ["不整形地（間口の狭い角地）：税理士に確かめた不整形地補正率0.90", ["補正が必要な土地", "路線"], (b) => {
    b.dec({ age: 77, male: true });
    const sp = b.spouse({ age: 74 });
    const c1 = b.child({ age: 46 });
    const L = b.landR({ label: `空き地（三角形の土地、${b.location()}）`, price: 180_000, frontage: 6.5, depth: 28, side: 150_000, needsReduction: "irregular", advisorRate: 0.9 });
    home(b, { price: 240_000, frontage: 12, depth: 15, bldg: 3_000_000 });
    b.deposit(40_000_000);
    b.funeral(1_500_000, sp);
    b.give(L, c1);
    b.split({ [sp]: 1 });
  }],
  ["不整形地：税理士に確かめたら補正なし（補正率1。間口狭小・奥行長大はふつうに掛ける）", ["補正が必要な土地"], (b) => {
    b.dec({ age: 84, male: false });
    const c1 = b.child({ age: 57 });
    b.landR({ label: `自宅の土地（${b.homeLocation()}）`, price: 230_000, frontage: 7, depth: 22, needsReduction: "irregular", advisorRate: 1 });
    b.building(2_200_000);
    b.deposit(30_000_000);
    b.funeral(1_200_000, c1);
    b.split({ [c1]: 1 });
  }],
  ["地積規模の大きな宅地に当たらないと税理士に確かめた（補正率1）", ["補正が必要な土地"], (b) => {
    b.dec({ age: 86, male: true });
    const c1 = b.child({ age: 58 });
    const c2 = b.child({ age: 55 });
    const h = home(b, { price: 110_000, frontage: 30, depth: 35, bldg: 2_800_000, needsReduction: "largeLot", advisorRate: 1 });
    b.deposit(28_000_000);
    b.funeral(1_500_000, c1);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.split({ [c2]: 1 });
  }],
  ["地積規模の大きな宅地：税理士に確かめた規模格差補正率0.78（奥行長大の補正のあとに掛ける）", ["補正が必要な土地", "小規模宅地"], (b) => {
    b.dec({ age: 83, male: true });
    const sp = b.spouse({ age: 80 });
    const c1 = b.child({ age: 53 });
    const h = home(b, { price: 95_000, frontage: 20, depth: 52.5, bldg: 3_300_000, needsReduction: "largeLot", advisorRate: 0.78 });
    b.deposit(35_000_000);
    b.funeral(1_500_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [c1]: 1 });
  }],
  // ── 二度目の見直しで足したもの ──
  // 前の相続で受けた障害者控除：前の相続のときと区分（一般・特別）が違う（相基通19の4-4）
  ["前の相続では一般障害者、今は特別障害者（限度額 {20万×(85−Y)＋10万×(Y−X)} − 控除済み）", ["障害者", "前の相続でも障害者控除", "障害者控除の区分が変わった"], (b) => {
    b.dec({ age: 90, male: false, deathDate: "2026-06-15" });
    b.spouse({ age: 92, predeceased: true });
    const c1 = b.child({ age: 62 });
    // 前の相続（2021-06-15）で60歳・一般障害者として250万円。今回65歳・特別障害者：20万×20＋10万×5 − 250万 = 200万（今回の400万より少ない）
    const c2 = b.child({ birthDate: "1961-02-01", disability: "special", priorDisabilityCredit: { date: "2021-06-15", amount: 2_500_000, special: false } });
    b.deposit(130_000_000);
    b.funeral(1_600_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["前の相続では特別障害者、今は一般障害者（限度額は前の相続のときの 20万×(85−X)）", ["障害者", "前の相続でも障害者控除", "障害者控除の区分が変わった"], (b) => {
    b.dec({ age: 93, male: true, deathDate: "2026-09-20" });
    const sp = b.spouse({ age: 88 });
    // 前の相続（2022-09-20）で63歳・特別障害者として300万円：20万×22 − 300万 = 140万。今回67歳・一般障害者の 10万×18 = 180万より少ない
    const c1 = b.child({ birthDate: "1959-04-10", disability: "general", priorDisabilityCredit: { date: "2022-09-20", amount: 3_000_000, special: true } });
    const c2 = b.child({ age: 61 });
    const h = home(b, { price: 210_000, frontage: 12, depth: 16, bldg: 2_500_000 });
    b.deposit(95_000_000);
    b.funeral(1_800_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.split({ [sp]: 1, [c1]: 2, [c2]: 2 });
  }],
  ["前の相続で受けた障害者控除が、今と同じ区分なら受けられない額（区分の入れ忘れ）→ 税理士に相談", ["障害者", "前の相続でも障害者控除"], (b) => {
    b.dec({ age: 88, male: false, deathDate: "2026-03-05" });
    b.spouse({ age: 90, predeceased: true });
    const c1 = b.child({ age: 60 });
    // 今は一般障害者。前の相続（2021-03-05、60歳）で一般なら 10万×25 = 250万までのはずが、300万と入っている
    const c2 = b.child({ birthDate: "1960-07-01", disability: "general", priorDisabilityCredit: { date: "2021-03-05", amount: 3_000_000 } });
    b.deposit(90_000_000);
    b.funeral(1_300_000, c1);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  // 代償分割と一部未分割（代償金は分割で取得した額に含めて穴埋め：相基通11の2-9）
  ["代償分割＋一部未分割：自宅を長男が取得し二男に代償金、預金は未分割（未分割の分は半分ずつ）", ["分け方", "代償分割", "一部未分割", "代償分割＋一部未分割"], (b) => {
    b.dec({ age: 85, male: true });
    b.spouse({ age: 83, predeceased: true });
    const c1 = b.child({ age: 55 });
    const c2 = b.child({ age: 52 });
    const h = home(b, { price: 400_000, frontage: 12, depth: 16, bldg: 6_000_000 });
    const D1 = b.deposit(30_000_000);
    b.deposit(60_000_000);
    b.funeral(1_500_000, c1);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.give(D1, c1);
    b.compensate(c1, c2, 40_000_000);
    b.partlyUndivided();
  }],
  ["代償分割（時価をもとに決めた）＋一部未分割：配偶者と兄（2割加算）", ["分け方", "代償分割", "一部未分割", "代償分割＋一部未分割", "代償金（時価をもとに決めた）"], (b) => {
    b.dec({ age: 76, male: false });
    const sp = b.spouse({ age: 79 });
    const s1 = b.sibling({ age: 80, male: true });
    const L = b.landR({ label: `貸していない土地（${b.location()}）`, price: 320_000, frontage: 10, depth: 15 });
    const D1 = b.deposit(12_000_000);
    b.deposit(80_000_000);
    b.funeral(1_400_000, sp);
    b.give(L, s1);
    b.give(D1, sp);
    // 土地の時価 6,000万をもとに代償金 2,400万（評価額に直すと 2,400万 × 4,800万 ÷ 6,000万）
    b.compensate(s1, sp, 24_000_000, { item: L, marketValue: 60_000_000 });
    b.partlyUndivided();
  }],
  // 未分割の財産と相続時精算課税の贈与（特別受益として未分割の分け方に入れる：質疑応答事例）
  ["未分割：子2人が精算課税の贈与を受けていた（遺産＋贈与に法定相続分を掛け、贈与を引いて分ける）", ["分け方", "未分割", "精算課税", "未分割＋精算課税（特別受益）"], (b) => {
    b.dec({ age: 82, male: true, deathDate: "2026-08-01" });
    b.spouse({ age: 80, predeceased: true });
    const c1 = b.child({ age: 56 });
    const c2 = b.child({ age: 53 });
    b.child({ age: 50 });
    b.child({ age: 47 });
    b.deposit(160_000_000);
    b.otherAsset(40_000_000, "貸付金");
    b.funeral(1_600_000, c1);
    b.gift(c1, "2020-05-10", 20_000_000, { settlement: true });
    b.gift(c2, "2022-11-01", 20_000_000, { settlement: true });
    b.undivided();
  }],
  ["未分割：精算課税の贈与が法定相続分を超えた子には、未分割の遺産を割り当てない", ["分け方", "未分割", "精算課税", "未分割＋精算課税（特別受益）"], (b) => {
    b.dec({ age: 87, male: false });
    b.spouse({ age: 89, predeceased: true });
    const c1 = b.child({ age: 60 });
    b.child({ age: 57 });
    b.deposit(30_000_000);
    b.cash(2_000_000);
    b.funeral(1_200_000, c1);
    b.gift(c1, "2019-04-01", 50_000_000, { settlement: true });
    b.undivided();
  }],
  ["一部未分割：配偶者が自宅を取得、預金は未分割。子が令和6年以後に精算課税の贈与（贈与の額そのものを特別受益に）", ["分け方", "一部未分割", "精算課税", "未分割＋精算課税（特別受益）", "小規模宅地"], (b) => {
    b.dec({ age: 79, male: true, deathDate: "2026-10-12" });
    const sp = b.spouse({ age: 76 });
    const c1 = b.child({ age: 50 });
    b.child({ age: 47 });
    const h = home(b, { price: 280_000, frontage: 11, depth: 15, bldg: 3_500_000 });
    b.deposit(70_000_000);
    b.funeral(1_700_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp);
    b.gift(c1, "2024-07-01", 15_000_000, { settlement: true });
    b.partlyUndivided();
  }],
  // 倍率方式の宅地は形がいびつでも 固定資産税評価額×倍率（評基通21-2）
  ["倍率方式の宅地で形がいびつ（不整形地）：固定資産税評価額×倍率のまま計算できる", ["補正が必要な土地", "倍率地域"], (b) => {
    b.dec({ age: 81, male: true });
    const sp = b.spouse({ age: 78 });
    const c1 = b.child({ age: 50 });
    const L = b.landM({ label: `自宅の土地（旗竿地、${b.homeLocation()}）`, area: 280, fixedAssetValue: 9_800_000, rate: 1.1, needsReduction: "irregular" });
    const B = b.building(2_600_000, { label: "自宅の建物（木造2階建）" });
    b.deposit(52_000_000);
    b.funeral(1_500_000, sp);
    b.give(L, sp);
    b.give(B, sp);
    b.smallLand(L, "residence", sp);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["倍率方式の雑種地で形がいびつ：宅地と比べて形の補正が要るので税理士に相談", ["補正が必要な土地", "倍率地域"], (b) => {
    b.dec({ age: 84, male: false });
    const c1 = b.child({ age: 58 });
    const c2 = b.child({ age: 55 });
    const L = b.landM({ label: `資材置場（${b.location()}）`, area: 420, fixedAssetValue: 6_300_000, rate: 1.2, landUse: "雑種地", needsReduction: "irregular" });
    b.deposit(60_000_000);
    b.funeral(1_300_000, c1);
    b.give(L, c2);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  // ── 小規模宅地等：1つの宅地を何人かで取得して、それぞれの持分に特例を使う（付表1の1行ずつ）／特例を使う面積を選ぶ ──
  // 共有者ごとに要件を見て、その人の持分に応ずる部分だけに使う（措法69条の4第3項、タックスアンサー No.4124）。
  // 選んだ面積（付表1の⑤）は持分に応ずる面積（③）まで。限度面積の割り当ては、家族の税が最も少なくなるように（土地と取得者の組ごと）
  ["小規模宅地：自宅を配偶者と同居の子が半分ずつ共有し、2人とも自分の持分に特例（300㎡、限度内）", ["小規模宅地", "共有で何人も使う"], (b) => {
    b.dec({ age: 80, male: true });
    const sp = b.spouse({ age: 77 });
    const c1 = b.child({ age: 50, male: true });
    const c2 = b.child({ age: 47 });
    const h = home(b, { price: 300_000, frontage: 12, depth: 25, bldg: 4_500_000 });
    b.deposit(70_000_000);
    b.funeral(1_800_000, sp);
    b.give(h.L, { [sp]: 1, [c1]: 1 });
    b.give(h.B, { [sp]: 1, [c1]: 1 });
    b.smallLand(h.L, "residence", sp, { others: [{ acquirer: c1 }] });
    b.split({ [sp]: 1, [c1]: 1, [c2]: 2 });
  }],
  ["小規模宅地：自宅400㎡を配偶者と同居の子が半分ずつ共有（330㎡までを、子の持分から先に割り当てると家族の税が少ない）", ["小規模宅地", "共有で何人も使う"], (b) => {
    b.dec({ age: 83, male: true });
    const sp = b.spouse({ age: 80 });
    const c1 = b.child({ age: 54 });
    const h = home(b, { price: 350_000, frontage: 16, depth: 25, bldg: 5_200_000 });
    b.deposit(120_000_000);
    b.listed(3_000, { close: 3_120, monthAvg: 3_080, prevMonthAvg: 3_010, prev2MonthAvg: 2_990 });
    b.funeral(2_100_000, sp);
    b.give(h.L, { [sp]: 1, [c1]: 1 });
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp, { others: [{ acquirer: c1 }] });
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["小規模宅地：自宅を配偶者2/3・別居の子（持ち家あり）1/3で共有。子の持分には特例を使えない", ["小規模宅地", "共有で何人も使う"], (b) => {
    b.dec({ age: 78, male: false });
    const sp = b.spouse({ age: 80 });
    const c1 = b.child({ age: 49 });
    const h = home(b, { price: 380_000, frontage: 12, depth: 20, bldg: 3_900_000 });
    b.deposit(65_000_000);
    b.funeral(1_600_000, sp);
    b.give(h.L, { [sp]: 2, [c1]: 1 });
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp, { others: [{ acquirer: c1, livedTogether: false }] });
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["小規模宅地：自宅480㎡を配偶者1/2・同居の長男1/4・別居の長女1/4で共有（長女は使えない。330㎡までを長男の120㎡から）", ["小規模宅地", "共有で何人も使う"], (b) => {
    b.dec({ age: 85, male: true });
    const sp = b.spouse({ age: 82 });
    const c1 = b.child({ age: 57, male: true });
    const c2 = b.child({ age: 54, male: false });
    const h = home(b, { price: 190_000, frontage: 16, depth: 30, bldg: 2_800_000 });
    b.deposit(95_000_000);
    b.funeral(1_700_000, sp);
    b.give(h.L, { [sp]: 2, [c1]: 1, [c2]: 1 });
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp, { others: [{ acquirer: c1 }, { acquirer: c2, livedTogether: false }] });
    b.split({ [sp]: 1, [c1]: 1, [c2]: 1 });
  }],
  ["小規模宅地：同居の子2人が自宅を共有。1人は申告期限前に持分を売る（その人の持分には使えない）", ["小規模宅地", "共有で何人も使う"], (b) => {
    b.dec({ age: 90, male: false });
    b.spouse({ age: 93, predeceased: true });
    const c1 = b.child({ age: 62 });
    const c2 = b.child({ age: 59 });
    const h = home(b, { price: 420_000, frontage: 10, depth: 20, bldg: 2_200_000 });
    b.deposit(52_000_000);
    b.funeral(1_500_000, c1);
    b.give(h.L, { [c1]: 1, [c2]: 1 });
    b.give(h.B, { [c1]: 1, [c2]: 1 });
    b.smallLand(h.L, "residence", c1, { others: [{ acquirer: c2, keep: false }] });
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["小規模宅地：自宅の土地の一部の面積だけに特例を使う（300㎡のうち200㎡）", ["小規模宅地", "使う面積を選んだ"], (b) => {
    b.dec({ age: 81, male: true });
    const sp = b.spouse({ age: 78 });
    const c1 = b.child({ age: 51 });
    const h = home(b, { price: 290_000, frontage: 12, depth: 25, bldg: 4_100_000 });
    b.deposit(75_000_000);
    b.funeral(1_900_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.smallLand(h.L, "residence", sp, { selectedSqm: 200 });
    b.split({ [sp]: 1, [c1]: 2 });
  }],
  ["小規模宅地：同居の子が自宅の一部（165㎡まで）に、別の子がアパートの敷地に特例（限度面積の残り100㎡をアパートに）", ["小規模宅地", "使う面積を選んだ"], (b) => {
    b.dec({ age: 84, male: true });
    b.spouse({ age: 82, predeceased: true });
    const c1 = b.child({ age: 55, male: true });
    const c2 = b.child({ age: 52 });
    const h = home(b, { price: 240_000, frontage: 12, depth: 25, bldg: 4_000_000 });
    const L = b.landR({ label: `アパートの土地（${b.location()}）`, price: 330_000, frontage: 10, depth: 15, use: "rentedHouse", rentRatio: 1 });
    const B = b.building(22_000_000, { label: "アパート（木造2階建・6室）", rented: true, rentRatio: 1 });
    b.deposit(60_000_000);
    b.funeral(1_700_000, c1);
    b.give(h.L, c1);
    b.give(h.B, c1);
    b.give(L, c2);
    b.give(B, c2);
    b.smallLand(h.L, "residence", c1, { selectedSqm: 165 });
    b.smallLand(L, "rental", c2);
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["小規模宅地：配偶者が自宅の一部（165㎡まで）とアパートの敷地を取得（配偶者の税は0円なので、限度面積はアパートを先に）", ["小規模宅地", "使う面積を選んだ"], (b) => {
    b.dec({ age: 79, male: true });
    const sp = b.spouse({ age: 76 });
    const c1 = b.child({ age: 49, male: true });
    const h = home(b, { price: 240_000, frontage: 12, depth: 25, bldg: 4_000_000 });
    const L = b.landR({ label: `アパートの土地（${b.location()}）`, price: 330_000, frontage: 10, depth: 15, use: "rentedHouse", rentRatio: 1 });
    const B = b.building(22_000_000, { label: "アパート（木造2階建・6室）", rented: true, rentRatio: 1 });
    b.deposit(60_000_000);
    b.funeral(1_700_000, sp);
    b.give(h.L, sp);
    b.give(h.B, sp);
    b.give(L, c1);
    b.give(B, c1);
    b.smallLand(h.L, "residence", sp, { selectedSqm: 165 });
    b.smallLand(L, "rental", c1);
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["小規模宅地：アパートの敷地を配偶者と子が共有し、2人とも貸付を続ける（200㎡まで。子は持分より広い面積を入れた）", ["小規模宅地", "共有で何人も使う", "使う面積を選んだ"], (b) => {
    b.dec({ age: 82, male: true });
    const sp = b.spouse({ age: 79 });
    const c1 = b.child({ age: 53 });
    const L = b.landR({ label: `アパートの土地（${b.location()}）`, price: 280_000, frontage: 12, depth: 20, use: "rentedHouse", rentRatio: 1 });
    const B = b.building(26_000_000, { label: "アパート（鉄骨2階建・8室）", rented: true, rentRatio: 1 });
    b.deposit(80_000_000);
    b.debt(12_000_000, { [sp]: 1, [c1]: 1 }, "アパートローン（みなと銀行）");
    b.funeral(1_800_000, sp);
    b.give(L, { [sp]: 1, [c1]: 1 });
    b.give(B, { [sp]: 1, [c1]: 1 });
    b.smallLand(L, "rental", sp, { others: [{ acquirer: c1, selectedSqm: 150 }] });
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["小規模宅地：アパートの敷地を子2人が共有。1人は申告期限までに貸付をやめる（その人の持分には使えない）", ["小規模宅地", "共有で何人も使う"], (b) => {
    b.dec({ age: 86, male: false });
    const c1 = b.child({ age: 60 });
    const c2 = b.child({ age: 57 });
    const L = b.landR({ label: `貸家の土地（${b.location()}）`, price: 310_000, frontage: 10, depth: 20, use: "rentedHouse", rentRatio: 1 });
    const B = b.building(9_000_000, { label: "貸家（一戸建て2棟）", rented: true, rentRatio: 1 });
    b.deposit(45_000_000);
    b.funeral(1_400_000, c1);
    b.give(L, { [c1]: 1, [c2]: 1 });
    b.give(B, { [c1]: 1, [c2]: 1 });
    b.smallLand(L, "rental", c1, { others: [{ acquirer: c2, continues: false }] });
    b.split({ [c1]: 1, [c2]: 1 });
  }],
  ["小規模宅地：店舗の土地を子2人が共有し、2人とも事業を引き継ぐ（特定事業用、400㎡まで）", ["小規模宅地", "共有で何人も使う"], (b) => {
    b.dec({ age: 74, male: true });
    const sp = b.spouse({ age: 72 });
    const c1 = b.child({ age: 46, male: true });
    const c2 = b.child({ age: 43, male: true });
    const L = b.landR({ label: `店舗の土地（${b.location()}）`, district: "普通商業・併用住宅地区", price: 380_000, frontage: 14, depth: 25 });
    const B = b.building(7_000_000, { label: "店舗の建物" });
    b.deposit(40_000_000);
    b.otherAsset(4_000_000, "商品・器具備品（事業用財産）");
    b.funeral(1_800_000, sp);
    b.give(L, { [c1]: 1, [c2]: 1 });
    b.give(B, { [c1]: 1, [c2]: 1 });
    b.smallLand(L, "business", c1, { others: [{ acquirer: c2 }] });
    b.split({ [sp]: 1 });
  }],
  ["小規模宅地：マンションを配偶者と同居の子が共有し、2人とも敷地権の持分に特例", ["小規模宅地", "共有で何人も使う", "マンション"], (b) => {
    b.dec({ age: 77, male: true });
    const sp = b.spouse({ age: 74 });
    const c1 = b.child({ age: 46 });
    const M = b.condo({ landValue: 36_000_000, buildingFixedAssetValue: 14_000_000, builtYears: 12, builtMonths: 3, totalFloors: 20, floor: 11, landShareSqm: 28.4, exclusiveAreaSqm: 90.2 });
    b.deposit(55_000_000);
    b.funeral(1_600_000, sp);
    b.give(M, { [sp]: 1, [c1]: 1 });
    b.smallLand(M, "residence", sp, { others: [{ acquirer: c1 }] });
    b.split({ [sp]: 1, [c1]: 1 });
  }],
  ["小規模宅地：自宅の一部が未分割（配偶者1/2・同居の子1/4は分割済み、残り1/4は未分割で特例を使えない）", ["小規模宅地", "共有で何人も使う", "一部未分割"], (b) => {
    b.dec({ age: 84, male: true });
    const sp = b.spouse({ age: 81 });
    const c1 = b.child({ age: 55 });
    const c2 = b.child({ age: 52 });
    const h = home(b, { price: 320_000, frontage: 12, depth: 25, bldg: 3_600_000 });
    const D1 = b.deposit(40_000_000);
    b.deposit(36_000_000);
    b.funeral(1_800_000, sp);
    b.givePart(h.L, [{ who: sp, n: 1, d: 2 }, { who: c1, n: 1, d: 4 }]);
    b.give(h.B, sp);
    b.give(D1, { [c1]: 1, [c2]: 1 });
    b.smallLand(h.L, "residence", sp, { others: [{ acquirer: c1 }] });
    b.partlyUndivided();
  }],
  ["小規模宅地：共有の自宅で同居の子が使う面積を100㎡までと決めた（配偶者の持分と貸家の敷地にも割り当て）", ["小規模宅地", "共有で何人も使う", "使う面積を選んだ"], (b) => {
    b.dec({ age: 80, male: false });
    const sp = b.spouse({ age: 83 });
    const c1 = b.child({ age: 52 });
    const c2 = b.child({ age: 49 });
    const h = home(b, { price: 270_000, frontage: 16, depth: 25, bldg: 4_400_000 });
    const L = b.landR({ label: `貸家の土地（${b.location()}）`, price: 300_000, frontage: 10, depth: 15, use: "rentedHouse", rentRatio: 1 });
    const B = b.building(8_500_000, { label: "貸家（一戸建て）", rented: true, rentRatio: 1 });
    b.deposit(90_000_000);
    b.funeral(2_000_000, sp);
    b.give(h.L, { [sp]: 1, [c1]: 1 });
    b.give(h.B, { [sp]: 1, [c1]: 1 });
    b.give(L, c2);
    b.give(B, c2);
    b.smallLand(h.L, "residence", sp, { others: [{ acquirer: c1, selectedSqm: 100 }] });
    b.smallLand(L, "rental", c2);
    b.split({ [sp]: 1, [c1]: 1, [c2]: 1 });
  }],
];

function edgeScenarios(seed: number): Scenario[] {
  return EDGES.map(([title, tags, fn], i) => {
    const id = `E${String(i + 1).padStart(3, "0")}`;
    const b = new Builder(new Rng(mixSeed(seed, 100_000 + i)), id);
    b.title = title;
    b.tag("エッジ", `分類:${tags[0]}`, ...tags.slice(1));
    fn(b);
    return b.build();
  });
}

// ───────────────────────── 乱数で作る通常のケース ─────────────────────────

type FamType = "spouseChildren" | "childrenOnly" | "siblings" | "parents" | "grandSub" | "other";

/** 亡くなった方の年齢（相続税の申告が必要な相続に多い分布） */
function decedentAge(rng: Rng): number {
  const band = rng.weighted([
    [[45, 64], 8], [[65, 74], 17], [[75, 84], 35], [[85, 94], 32], [[95, 103], 8],
  ] as const);
  return rng.int(band[0], band[1]);
}

/** 子を何人か作る（亡くなった方が何歳のときに生まれたかから年齢を決める） */
function makeChildren(b: Builder, k: number, o: { decAge: number; opts?: PersonOpts } ): string[] {
  const ids: string[] = [];
  let r = b.rng.int(24, 34);
  for (let i = 0; i < k; i++) {
    const gap = clamp(r, 20, 45);
    const age = o.decAge - gap;
    ids.push(b.child({ age, male: b.rng.chance(0.5), ...o.opts }));
    r += b.rng.int(1, 5);
  }
  return ids;
}

interface RandCtx {
  homeLand?: string;
  homeBldg?: string;
  condo?: string;
  rentals: { L: string; B: string; loan?: number }[];
  business?: { L: string; B: string };
  extras: string[];
  unlisted: string[];
  bequest?: { who: string; item: string };
  spouseRight: boolean;
  debts: { amount: number; label: string; tie: "general" | "rental"; rental?: number }[];
  funeral?: number;
  /** 相続時精算課税の贈与を受けた人 */
  settlementTo?: Set<string>;
}

/**
 * 乱数のケースを1件作る。rng は元からある事柄、extra はあとから足した事柄（貸家建付借地権・税理士に確かめた補正率・
 * 一部未分割・代償金の時価・前の相続で受けた控除）に使う別の乱数列。extra を分けたので、足した事柄のない部分は前と同じになる
 */
function randomScenario(id: string, rng: Rng, extra: Rng, extra2: Rng, extra3: Rng): Scenario {
  const famType = rng.weighted<FamType>([
    ["spouseChildren", 55], ["childrenOnly", 30], ["siblings", 6], ["parents", 3], ["grandSub", 3], ["other", 3],
  ]);
  const rural = rng.chance(0.2);
  const b = new Builder(rng, id, rural);
  b.tag("ランダム");
  // 資産の多さ（正規分布。3%は資産家、1%弱は大資産家）
  const w = rng.normal() + (rng.chance(0.03) ? 1.5 : 0) + (rng.chance(0.008) ? 3 : 0);

  // ── 家族 ──
  let otherKind = "";
  const spouseAge = (age: number, male: boolean) => clamp(male ? age - rng.int(-2, 8) : age + rng.int(-2, 6), 22, 104);
  if (famType === "spouseChildren" || famType === "childrenOnly" || famType === "grandSub") {
    let age = decedentAge(rng);
    if (famType === "childrenOnly") age = Math.min(104, age + rng.int(0, 6));
    if (famType === "grandSub") age = Math.max(age, rng.int(70, 80)); // 孫のいる子が先に亡くなっている
    const male = famType === "childrenOnly" ? rng.chance(0.4) : rng.chance(0.65);
    b.dec({ age, male });
    if (famType === "childrenOnly") {
      if (rng.chance(0.3)) b.spouse({ age: spouseAge(age, male), predeceased: true });
    } else if (famType === "spouseChildren" || rng.chance(0.5)) b.spouse({ age: spouseAge(age, male) });
    const k = famType === "grandSub" ? rng.int(2, 4) : rng.weighted([[1, 20], [2, 45], [3, 25], [4, 8], [5, 2]] as const);
    const cs = makeChildren(b, k, { decAge: age });
    if (famType === "grandSub") {
      const dead = rng.chance(0.1) && cs.length >= 3 ? [cs[0], cs[2]] : [rng.pick(cs)];
      for (const c of dead) {
        const m = b.member(c);
        m.predeceased = true;
        const cAge = ageAt(m.birthDate, b.death);
        const n = rng.weighted([[1, 35], [2, 45], [3, 20]] as const);
        for (let i = 0; i < n; i++) b.grandchild(c, { age: Math.max(1, cAge - rng.int(24, 36) - i * rng.int(1, 4)) });
      }
    }
    // 普通養子（長男の妻・孫養子など）
    if (famType === "spouseChildren" && rng.chance(0.03)) {
      const c1 = b.member(cs[0]);
      const c1Age = ageAt(c1.birthDate, b.death);
      if (rng.chance(0.5) && c1Age >= 45) b.adopted({ age: clamp(c1Age - rng.int(22, 30), 18, 40), grandchildAdopted: true, parentId: cs[0] });
      else b.adopted({ age: clamp(c1Age + rng.int(-4, 2), 20, age - 18), male: false, surname: b.surname });
    }
    // 子の1人が放棄（他の子が多く取得するため）
    const livingKids = cs.filter((c) => !b.member(c).predeceased);
    if (livingKids.length >= 2 && rng.chance(0.015)) b.member(livingKids[livingKids.length - 1]).renounced = true;
    // 若い方には親が健在のことがある（相続人ではない）
    if (age <= 66 && rng.chance(0.35)) b.parent(false, { age: age + rng.int(22, 34) });
  } else if (famType === "parents") {
    const age = rng.int(30, 64);
    const male = rng.chance(0.6);
    b.dec({ age, male });
    if (rng.chance(0.5)) b.spouse({ age: spouseAge(age, male) });
    const moAge = age + rng.int(22, 34);
    const faAge = age + rng.int(24, 37);
    // 高齢ほど健在の割合が下がる
    const moAlive = moAge <= 103 && rng.chance(moAge <= 85 ? 0.95 : moAge <= 95 ? 0.7 : 0.35);
    const faAlive = faAge <= 103 && (!moAlive || rng.chance(faAge <= 85 ? 0.75 : faAge <= 95 ? 0.4 : 0.15));
    b.parent(true, { age: faAge, predeceased: !faAlive || undefined });
    b.parent(false, { age: moAge, predeceased: !moAlive || undefined });
    if (!moAlive && !faAlive) b.member("mo1").predeceased = undefined;
    if (rng.chance(0.4)) b.sibling({ age: age + rng.int(-6, 6) });
  } else if (famType === "siblings") {
    const age = rng.int(60, 96);
    const male = rng.chance(0.5);
    b.dec({ age, male });
    if (rng.chance(0.4)) b.spouse({ age: spouseAge(age, male) });
    const k = rng.weighted([[1, 20], [2, 30], [3, 28], [4, 15], [5, 7]] as const);
    let living = 0;
    for (let i = 0; i < k; i++) {
      const sAge = clamp(age + rng.int(-12, 12), 40, 105);
      const dead = sAge > 100 || rng.chance(sAge > 85 ? 0.5 : 0.12);
      const s = b.sibling({ age: sAge, predeceased: dead || undefined, halfBlood: rng.chance(0.06) || undefined });
      if (!dead) living++;
      else {
        const n = rng.weighted([[0, 10], [1, 30], [2, 45], [3, 15]] as const);
        for (let j = 0; j < n; j++) {
          b.nephew(s, { age: clamp(sAge - rng.int(25, 36) - j * 2, 18, 80) });
          living++;
        }
      }
    }
    if (!living) b.member("b1").predeceased = undefined;
  } else {
    otherKind = rng.weighted([["spouseOnly", 35], ["naien", 20], ["grandAdopt", 20], ["renounce", 15], ["grandparents", 4], ["adoptOnly", 6]] as const);
    if (otherKind === "grandparents") {
      const age = rng.int(25, 45);
      b.dec({ age, male: rng.chance(0.6) });
      b.parent(true, { age: age + rng.int(26, 34), predeceased: true });
      b.parent(false, { age: age + rng.int(24, 32), predeceased: true });
      b.grandparent(false, { age: clamp(age + rng.int(52, 62), 70, 103) });
      if (rng.chance(0.4)) b.grandparent(true, { age: clamp(age + rng.int(55, 64), 72, 103) });
    } else if (otherKind === "spouseOnly") {
      const age = rng.int(55, 96);
      const male = rng.chance(0.6);
      b.dec({ age, male });
      b.spouse({ age: spouseAge(age, male) });
    } else if (otherKind === "naien") {
      const age = rng.int(60, 92);
      b.dec({ age, male: true });
      makeChildren(b, rng.int(1, 3), { decAge: age });
      b.other({ age: clamp(age - rng.int(0, 12), 40, 100), male: false });
    } else if (otherKind === "grandAdopt") {
      const age = rng.int(72, 95);
      const male = rng.chance(0.6);
      b.dec({ age, male });
      if (rng.chance(0.6)) b.spouse({ age: spouseAge(age, male) });
      const cs = makeChildren(b, rng.int(1, 3), { decAge: age });
      const cAge = ageAt(b.member(cs[0]).birthDate, b.death);
      b.adopted({ age: clamp(cAge - rng.int(24, 32), 18, 45), grandchildAdopted: true, parentId: cs[0] });
    } else if (otherKind === "renounce") {
      const age = decedentAge(rng);
      const male = rng.chance(0.6);
      b.dec({ age, male });
      if (rng.chance(0.7)) b.spouse({ age: spouseAge(age, male) });
      const cs = makeChildren(b, rng.int(2, 3), { decAge: age });
      b.member(rng.pick(cs)).renounced = true;
    } else {
      const age = rng.int(65, 92);
      const male = rng.chance(0.6);
      b.dec({ age, male });
      b.spouse({ age: spouseAge(age, male) });
      const k = rng.int(1, 3);
      for (let i = 0; i < k; i++) b.adopted({ age: clamp(age - rng.int(25, 45), 20, age - 15) });
    }
  }

  const info0 = heirInfo(b.members);
  const heirIds = () => [...heirInfo(b.members).shares.keys()];
  const kids = () => b.members.filter((m) => (m.relation === "child" || m.relation === "adoptedChild") && !m.predeceased && !m.renounced).map((m) => m.id);
  const spouseId = info0.spouse;
  const decAge = b.decAge;

  // 付加的な事情
  if (rng.chance(0.02)) {
    const cs = kids().filter((id) => ageAt(b.member(id).birthDate, b.death) >= 25);
    if (cs.length) b.member(rng.pick(cs)).nonResident = true;
  }
  if (rng.chance(0.015)) {
    const cands = [...(spouseId && ageAt(b.member(spouseId).birthDate, b.death) >= 70 ? [spouseId] : []), ...heirIds().filter((id) => b.member(id).relation === "child")];
    if (cands.length) b.member(cands[0]).diedAfter = addDays(b.death, rng.int(20, 290));
  }
  if (rng.chance(0.03)) {
    const cands = heirIds();
    if (cands.length) b.member(rng.pick(cands)).disability = rng.chance(0.3) ? "special" : "general";
  }

  // ── 財産 ──
  const ctx: RandCtx = { rentals: [], extras: [], unlisted: [], spouseRight: false, debts: [] };
  const rosenkaPrice = (median: number) => roundTo(clamp(rng.logNormal(median * Math.exp(0.4 * w), 0.4), 50_000, 3_000_000), 1000);
  const lotDims = (area: number) => {
    const ratio = rng.range(0.9, 2.0);
    const frontage = round1(Math.max(4, Math.sqrt(area / ratio)));
    const depth = round1(area / frontage);
    return { frontage, depth };
  };
  const homeR = rng.next();
  const needsRed = rng.chance(0.06) ? rng.weighted([["largeLot", 35], ["irregular", 45], ["setback", 20]] as const) : undefined;
  if (homeR < 0.75) {
    const leasehold = rng.chance(0.04);
    const multiplier = rural ? rng.chance(0.8) : rng.chance(0.1);
    let area = round2(rng.logNormalIn(165, 0.35, 66, 480));
    // 地積規模の大きな宅地（評基通20-2）：三大都市圏は500㎡以上、それ以外は1,000㎡以上。三大都市圏かどうかは都府県で近似する（アプリと同じ）
    if (needsRed === "largeLot") area = round2(rng.range(multiplier || !METRO_PREFS.has(b.place.pref) ? 1_000 : 500, 1_300));
    const spouseRight = !!spouseId && rng.chance(0.03);
    ctx.spouseRight = spouseRight;
    const label = leasehold ? "自宅の借地権" : "自宅の土地";
    if (multiplier) {
      const perSqm = clamp(rng.logNormal(22_000 * Math.exp(0.25 * w), 0.35), 4_000, 120_000);
      ctx.homeLand = b.landM({
        label: `${label}（${b.homeLocation()}）`,
        area,
        fixedAssetValue: Math.round(area * perSqm),
        rate: rng.pick([1.0, 1.05, 1.1, 1.1, 1.1, 1.2]),
        leaseRatio: leasehold ? rng.pick([0.3, 0.4, 0.5]) : undefined,
        use: leasehold ? "leasehold" : "self",
        needsReduction: needsRed,
        spouseResidenceRight: spouseRight,
      });
    } else {
      const district: District = rng.chance(0.88) ? "普通住宅地区" : "普通商業・併用住宅地区";
      const price = rosenkaPrice(district === "普通住宅地区" ? 200_000 : 280_000);
      const { frontage, depth } = lotDims(area);
      const corner = rng.chance(0.15);
      const twoWay = !corner && rng.chance(0.03);
      ctx.homeLand = b.landR({
        label: `${label}（${b.homeLocation()}）`,
        district,
        price,
        frontage,
        depth,
        side: corner ? roundTo(price * rng.range(0.7, 1.0), 1000) : undefined,
        back: twoWay ? roundTo(price * rng.range(0.6, 0.95), 1000) : undefined,
        use: leasehold ? "leasehold" : "self",
        needsReduction: needsRed,
        // 配偶者居住権のある土地はいつも税理士に相談するので、補正率は付けない
        advisorRate: (needsRed === "irregular" || needsRed === "largeLot") && !spouseRight ? advisorRateOf(extra, needsRed) : undefined,
        spouseResidenceRight: spouseRight,
      });
    }
    ctx.homeBldg = b.building(roundTo(clamp(rng.logNormal(3_500_000, 0.7), 200_000, 40_000_000), 100), { label: rng.pick(["自宅の建物（木造2階建）", "自宅の建物（軽量鉄骨造）", "自宅の建物（木造平屋建）"]) });
  } else if (homeR < 0.95) {
    const totalFloors = rng.chance(0.12) ? rng.int(20, 50) : rng.weighted([[2, 3], [3, 6], [5, 15], [7, 20], [10, 25], [14, 20], [18, 11]] as const);
    ctx.condo = b.condo({
      landValue: roundTo(clamp(rng.logNormal(12_000_000 * Math.exp(0.4 * w), 0.6), 1_500_000, 200_000_000), 1),
      buildingFixedAssetValue: roundTo(clamp(rng.logNormal(7_000_000, 0.5), 800_000, 60_000_000), 100),
      builtYears: rng.int(0, 52),
      builtMonths: rng.int(0, 11),
      totalFloors,
      floor: rng.int(1, totalFloors),
      landShareSqm: round2(rng.range(8, 45)),
      exclusiveAreaSqm: round2(rng.range(42, 120)),
    });
  }
  // 賃貸アパート（資産家は複数）
  const nRentals = rng.chance(w > 0.5 ? 0.22 : 0.07) ? 1 + (w > 1.5 && rng.chance(0.4) ? 1 : 0) + (w > 2.5 && rng.chance(0.6) ? 1 : 0) : 0;
  for (let ri = 0; ri < nRentals; ri++) {
    const area = round2(rng.logNormalIn(260, 0.35, 120, 700));
    const rentRatio = rng.chance(0.6) ? 1 : rng.pick([0.5, 0.625, 0.75, 0.8, 0.875, 0.9]);
    const explicit = rentRatio !== 1 || rng.chance(0.5);
    // 人の土地を借りてアパートを建てている（貸家建付借地権）こともある
    const onLease = extra.chance(0.14);
    const use: LandUse = onLease ? "rentedLeasehold" : "rentedHouse";
    const lLabel = onLease ? "借地に建てたアパートの借地権" : "アパートの土地";
    let L: string;
    if (rng.chance(0.15) || rural) {
      L = b.landM({ label: `${lLabel}（${b.location()}）`, area, fixedAssetValue: Math.round(area * clamp(rng.logNormal(30_000, 0.3), 5_000, 150_000)), rate: rng.pick([1.0, 1.1, 1.1, 1.2]), leaseRatio: rng.pick([0.4, 0.5, 0.6]), use, rentRatio: explicit ? rentRatio : undefined });
    } else {
      const district: District = rng.chance(0.7) ? "普通住宅地区" : "普通商業・併用住宅地区";
      const { frontage, depth } = lotDims(area);
      L = b.landR({ label: `${lLabel}（${b.location()}）`, district, price: rosenkaPrice(230_000), frontage, depth, side: rng.chance(0.2) ? rosenkaPrice(180_000) : undefined, use, rentRatio: explicit ? rentRatio : undefined });
    }
    const bf = roundTo(clamp(rng.logNormal(25_000_000, 0.6), 5_000_000, 150_000_000), 100);
    const B = b.building(bf, { label: rng.pick(["アパート（木造2階建）", "アパート（軽量鉄骨2階建）", "賃貸マンション（RC造）"]), rented: true, rentRatio: explicit ? rentRatio : undefined });
    const loan = rng.chance(0.55) ? Math.round(bf * rng.range(0.3, 1.2)) : undefined;
    ctx.rentals.push({ L, B, loan });
  }
  // 貸宅地
  if (rng.chance(0.025)) {
    const area = round2(rng.range(90, 300));
    const { frontage, depth } = lotDims(area);
    ctx.extras.push(b.landR({ label: `貸している土地（${b.location()}）`, price: rosenkaPrice(200_000), frontage, depth, use: "leasedLand" }));
  }
  // 特定事業用（個人事業の店舗・工場）
  if (rng.chance(0.012)) {
    const area = round2(rng.range(100, 450));
    const { frontage, depth } = lotDims(area);
    const L = b.landR({ label: `店舗の土地（${b.location()}）`, district: "普通商業・併用住宅地区", price: rosenkaPrice(300_000), frontage, depth });
    const B = b.building(roundTo(rng.logNormal(6_000_000, 0.5), 100), { label: "店舗の建物" });
    ctx.business = { L, B };
  }
  // その他の土地・田畑
  if (rng.chance(0.1)) {
    const kind = rng.weighted([["vacant", 25], ["parking", 20], ["田", 22], ["畑", 22], ["山林", 11]] as const);
    if (kind === "vacant" || kind === "parking") {
      const area = round2(rng.logNormalIn(180, 0.4, 60, 600));
      const { frontage, depth } = lotDims(area);
      const irr = !needsRed && rng.chance(0.05);
      ctx.extras.push(b.landR({ label: kind === "vacant" ? `空き地（${b.location()}）` : `月極駐車場（${b.location()}）`, price: rosenkaPrice(170_000), frontage, depth, landUse: kind === "vacant" ? "宅地" : "雑種地", use: kind === "vacant" ? "self" : "parking", needsReduction: irr ? "irregular" : undefined, advisorRate: irr ? advisorRateOf(extra, "irregular") : undefined }));
    } else {
      const area = kind === "山林" ? roundTo(rng.range(3_000, 30_000), 1) : roundTo(rng.range(400, 4_000), 1);
      const perSqm = kind === "山林" ? rng.range(8, 40) : rng.range(40, 160);
      const rate = kind === "山林" ? rng.pick([8, 12, 15, 21, 30]) : rng.pick([10, 15, 20, 26, 32, 45, 56]);
      ctx.extras.push(b.landM({ label: `${kind}（${b.farLocation()}）`, area, fixedAssetValue: Math.round(area * perSqm), rate, landUse: kind }));
    }
  }
  // 預貯金
  if (rng.chance(0.98)) {
    const total = rng.logNormalIn(22_000_000 * Math.exp(0.55 * w), 0.75, 5_000_000, 300_000_000);
    const k = rng.weighted([[1, 25], [2, 35], [3, 25], [4, 15]] as const);
    const ws = Array.from({ length: k }, () => rng.range(0.2, 1));
    const sw = ws.reduce((s, x) => s + x, 0);
    for (const x of ws) b.deposit(Math.max(10_000, Math.round((total * x) / sw)));
  }
  if (rng.chance(0.2)) b.cash(roundTo(rng.range(100_000, 5_000_000), 1000));
  if (rng.chance(0.6)) b.household(roundTo(rng.range(100_000, 1_000_000), 10_000));
  if (rng.chance(0.12)) {
    const [label, lo, hi] = rng.pick([["自動車", 300_000, 3_000_000], ["準確定申告の還付金", 10_000, 300_000], ["ゴルフ会員権", 500_000, 3_000_000], ["貸付金（親族への貸付）", 1_000_000, 10_000_000], ["未収の家賃", 100_000, 800_000]] as const);
    b.otherAsset(Math.round(rng.range(lo, hi)), label);
  }
  // 上場株式
  if (rng.chance(clamp(0.35 + 0.12 * w, 0.1, 0.7))) {
    const k = rng.weighted([[1, 40], [2, 30], [3, 18], [4, 12]] as const);
    for (let i = 0; i < k; i++) {
      const base = clamp(rng.logNormal(2_000, 0.8), 100, 30_000);
      const frac = rng.chance(0.15);
      const p = () => {
        const x = base * (1 + 0.04 * rng.normal());
        return frac ? Math.round(x * 10) / 10 : Math.round(x);
      };
      const shares = 100 * Math.max(1, Math.round(rng.logNormal(10 * Math.exp(0.5 * w), 0.9)));
      b.listed(shares, { close: p(), monthAvg: p(), prevMonthAvg: p(), prev2MonthAvg: p() });
    }
  }
  // 非上場株式
  if (rng.chance(w > 1 ? 0.12 : 0.025)) ctx.unlisted.push(b.unlisted(rng.int(10, 500) * 100, roundTo(rng.logNormalIn(40_000_000 * Math.exp(0.5 * Math.max(0, w)), 1.0, 3_000_000, 2_000_000_000), 1)));
  // 国外財産
  if (rng.chance(0.02)) {
    if (rng.chance(0.75)) b.deposit(Math.round(rng.logNormal(10_000_000, 0.8)), "米国の銀行口座（米ドル建て）", true);
    else b.otherAsset(Math.round(rng.logNormal(40_000_000, 0.5)), "海外の不動産（現地の鑑定額を円換算）", true);
  }
  // 生命保険金・死亡退職金
  const heirsNow = heirIds();
  const recipientPool = () => {
    if (spouseId && rng.chance(0.65)) return spouseId;
    const ks = kids();
    if (ks.length) return rng.pick(ks);
    return heirsNow.length ? rng.pick(heirsNow) : undefined;
  };
  const renouncedKid = b.members.find((m) => m.renounced && !m.predeceased && (m.relation === "child" || m.relation === "adoptedChild"));
  if (renouncedKid && rng.chance(0.4)) b.insurance(roundTo(rng.logNormalIn(5_000_000, 0.6, 1_000_000, 30_000_000), 10_000), renouncedKid.id);
  if (rng.chance(0.5)) {
    const k = rng.chance(0.8) ? 1 : 2;
    for (let i = 0; i < k; i++) {
      let to = recipientPool();
      if (rng.chance(0.03)) {
        const parents = kids().filter((id) => b.member(id).relation === "child" && ageAt(b.member(id).birthDate, b.death) >= 45);
        if (parents.length) to = b.grandchild(parents[0], { age: rng.int(18, 25) });
      }
      if (!to) break;
      const amt = rng.logNormalIn(5_000_000, 0.7, 1_000_000, 60_000_000);
      b.insurance(rng.chance(0.5) ? roundTo(amt, 10_000) : Math.round(amt), to);
    }
  }
  if (rng.chance(decAge < 70 ? 0.3 : 0.065)) {
    const to = spouseId ?? kids()[0] ?? heirsNow[0];
    if (to) b.retirement(roundTo(rng.logNormalIn(10_000_000, 0.8, 1_000_000, 80_000_000), 1000), to);
  }
  // 遺贈（内縁の方）
  if (otherKind === "naien") {
    const o1 = b.members.find((m) => m.relation === "other")!.id;
    ctx.bequest = { who: o1, item: b.deposit(roundTo(rng.range(5_000_000, 30_000_000), 1000), `${rng.pick(BANKS)} 定期預金（遺言で遺贈）`) };
    if (rng.chance(0.3)) b.insurance(roundTo(rng.range(2_000_000, 10_000_000), 10_000), o1);
  }
  // 相次相続
  if (rng.chance(0.02)) {
    const prevAcquired = roundTo(rng.logNormalIn(80_000_000, 0.6, 20_000_000, 400_000_000), 1000);
    b.decedent.priorInheritance = { yearsAgo: rng.int(0, 9), prevTax: floorTo(prevAcquired * rng.range(0.03, 0.2), 100), prevAcquired };
  }
  // 前の相続（祖父母・もう一人の親など）でも未成年者控除・障害者控除を受けていた
  addPriorCredits(b, extra, heirIds(), extra2);
  // 債務
  for (const r of ctx.rentals) if (r.loan) ctx.debts.push({ amount: r.loan, label: "アパートローン", tie: "rental", rental: ctx.rentals.indexOf(r) });
  if (rng.chance(0.21)) {
    const k = rng.chance(0.75) ? 1 : 2;
    const kinds = [["未払医療費", 100_000, 1_500_000], ["固定資産税（未納分）", 50_000, 600_000], ["住民税（未納分）", 50_000, 800_000], ["準確定申告の所得税", 50_000, 2_000_000], ["クレジットカードの未払金", 10_000, 300_000], ["借入金", 1_000_000, 20_000_000]] as const;
    const first = rng.int(0, kinds.length - 1);
    for (let i = 0; i < k; i++) {
      const [label, lo, hi] = kinds[(first + i * rng.int(1, kinds.length - 1)) % kinds.length];
      if (ctx.debts.some((d) => d.label === label)) continue;
      ctx.debts.push({ amount: Math.round(rng.range(lo, hi)), label, tie: "general" });
    }
  }
  if (rng.chance(0.85)) ctx.funeral = Math.round(rng.range(1_000_000, 3_000_000));

  // ── 生前贈与 ──
  const settlementTo = new Set<string>();
  if (rng.chance(0.03)) {
    const cands = kids().filter((id) => b.member(id).relation === "child");
    if (cands.length) {
      const to = rng.pick(cands);
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        const year = rng.int(2018, Number(b.death.slice(0, 4)));
        if (`${year}-01-01` >= b.death) continue;
        const date = randomDate(rng, `${year}-01-01`, `${year}-12-31` < b.death ? `${year}-12-31` : addDays(b.death, -1));
        if (ageAt(b.decedent.birthDate, `${year}-01-01`) < 60 || ageAt(b.member(to).birthDate, `${year}-01-01`) < 18) continue;
        b.gift(to, date, roundTo(rng.range(5_000_000, 30_000_000), 100_000), { settlement: true });
        settlementTo.add(to);
      }
    }
  }
  if (rng.chance(0.18)) {
    const n = rng.weighted([[1, 50], [2, 30], [3, 20]] as const);
    for (let i = 0; i < n; i++) {
      let to: string | undefined;
      const r = rng.next();
      const ks = kids().filter((id) => !settlementTo.has(id));
      if (r < 0.7 && ks.length) to = rng.pick(ks);
      else if (r < 0.9) {
        const parentsOf = kids().filter((id) => ageAt(b.member(id).birthDate, b.death) >= 45);
        const gs = b.members.filter((m) => m.relation === "grandchild" && !m.predeceased).map((m) => m.id);
        if (gs.length && rng.chance(0.5)) to = rng.pick(gs);
        else if (parentsOf.length) to = b.grandchild(rng.pick(parentsOf), { age: rng.int(18, 28) });
      } else if (spouseId) to = spouseId;
      if (!to) to = heirIds().find((id) => !settlementTo.has(id));
      if (!to) break;
      const inside = rng.chance(0.85);
      const from = inside ? addYears(b.death, -3) : addYears(b.death, -5);
      const until = inside ? addDays(b.death, -1) : addDays(addYears(b.death, -3), -1);
      const amount = rng.weighted([[600_000, 5], [1_000_000, 8], [1_100_000, 20], [1_500_000, 10], [2_000_000, 15], [3_000_000, 15], [5_000_000, 15], [10_000_000, 8], [20_000_000, 4]] as const);
      b.gift(to, randomDate(rng, from, until), amount);
    }
  }

  // ── 分け方 ──
  ctx.settlementTo = settlementTo;
  randomDivision(b, ctx, extra, extra2);
  randomSmallLandUsers(b, extra3);
  return b.build();
}

/** 面積 × 持分 が 0.01㎡ 単位でちょうど割り切れるか（付表1の③が丸めなしで書ける持分だけを使う） */
function exactShareArea(area: number, n: number, d: number): boolean {
  return (Math.round(area * 100) * n) % d === 0;
}

/**
 * 小規模宅地等の特例を、1つの宅地を共有で取得した何人もが使う・取得した面積の一部だけに使う（三度目の見直しで足した事柄。
 * 別の乱数列 extra3 で決めるので、選ばれなかったケースは前と同じ）。実際の申告200件の見直しでは、面積の一部だけに使う人が5件（2.5%）、
 * 1つの宅地を共有して2人以上が使うものが3件（1.5%）あった。
 * - 共有：配偶者が1人で取得した自宅の敷地（特定居住用）を配偶者と子の共有にし、子も自分の持分に使う（同居して住み続ける子、
 *   別居で持ち家がある子＝使えない、申告期限までに持分を売る子＝使えない）。配偶者のいない家族では、ほかに特例を使う土地がなく
 *   330㎡以下の自宅の敷地を子2人の共有にする（限度面積に届かないので、割り当ての選び方で結果が変わらない）
 * - 一部の面積：特例を使う人のうち1人が、持分に応ずる面積の4〜9割（1㎡単位）だけを選ぶ
 * 限度面積に届くときに、同じ土地を同じ立場の人（配偶者でない人どうし）で分ける形は作らない（家族の税額が同じになり、選び方が決まらないため）
 */
function randomSmallLandUsers(b: Builder, extra3: Rng): void {
  if (b.isUndivided) return;
  const info = heirInfo(b.members);
  const sp = info.spouse;
  const kids = [...info.shares.keys()].filter((id) => {
    const m = b.member(id);
    return id !== sp && (m.relation === "child" || m.relation === "adoptedChild") && !m.renounced && !m.diedAfter && !m.nonResident;
  });
  const smallItems = b.estate.filter((it): it is LandItem | CondoItemExt => (it.type === "land" || it.type === "condo") && !!it.smallLand);
  const areaOf = (it: LandItem | CondoItemExt) => (it.type === "land" ? it.areaSqm : it.landShareSqm);
  const coOwn = extra3.chance(0.03);
  const partial = extra3.chance(0.045);
  const answer = extra3.next();
  const weightPick = extra3.next();
  const ratio = extra3.range(0.4, 0.9);
  const pickUser = extra3.next();
  if (coOwn && kids.length) {
    const homeIt = smallItems.find((it) => it.smallLand!.kind === "residence" && (b.shares[it.id] ?? []).length === 1);
    const sl = homeIt?.smallLand;
    const sh = homeIt ? b.shares[homeIt.id] : undefined;
    if (homeIt && sl && sh && sh[0].who === sl.acquirer && sh[0].n === sh[0].d) {
      const area = areaOf(homeIt);
      if (sp && sl.acquirer === sp) {
        const kid = kids[0];
        // 配偶者：子 ＝ 1:1・2:1・3:1 のうち、持分の面積が0.01㎡単位で割り切れるもの
        const ws = ([[1, 1], [2, 1], [3, 1]] as const).filter(([x, y]) => exactShareArea(area, x, x + y) && exactShareArea(area, y, x + y));
        if (ws.length) {
          const [x, y] = ws[Math.floor(weightPick * ws.length)];
          b.give(homeIt.id, { [sp]: x, [kid]: y });
          const u: SmallLandUser = answer < 0.65 ? { acquirer: kid } : answer < 0.85 ? { acquirer: kid, livedTogether: false } : { acquirer: kid, keep: false };
          sl.others = [u];
        }
      } else if (!sp && kids.includes(sl.acquirer) && smallItems.length === 1 && area <= 330 && exactShareArea(area, 1, 2)) {
        const kid = kids.find((id) => id !== sl.acquirer);
        if (kid) {
          b.give(homeIt.id, { [sl.acquirer]: 1, [kid]: 1 });
          sl.others = [answer < 0.7 ? { acquirer: kid } : answer < 0.85 ? { acquirer: kid, livedTogether: false } : { acquirer: kid, keep: false }];
        }
      }
    }
  }
  if (partial && smallItems.length) {
    // 特例を使う人（土地と人の組）から1つ選び、持分に応ずる面積の4〜9割（1㎡単位）だけに使う
    const slots: { u: SmallLandUser; area: number }[] = [];
    for (const it of smallItems) {
      const sl = it.smallLand!;
      if (it.type === "land" && it.use === "parking") continue;
      for (const u of [sl, ...(sl.others ?? [])]) {
        const x = (b.shares[it.id] ?? []).find((y) => y.who === u.acquirer);
        if (!x || !exactShareArea(areaOf(it), x.n, x.d)) continue;
        const shareArea = (Math.round(areaOf(it) * 100) * x.n) / x.d / 100;
        if (shareArea >= 10) slots.push({ u, area: shareArea });
      }
    }
    if (slots.length) {
      const t = slots[Math.floor(pickUser * slots.length)];
      t.u.selectedSqm = Math.max(1, Math.floor(t.area * ratio));
    }
  }
}

/** 税理士に確かめた補正率（不整形地補正率・規模格差補正率）。確かめていない（相談で止まる）こともある */
function advisorRateOf(extra: Rng, kind: "irregular" | "largeLot"): number | undefined {
  if (!extra.chance(0.55)) return undefined;
  if (kind === "irregular") return extra.chance(0.12) ? 1 : round2(extra.range(0.78, 0.98));
  return extra.chance(0.5) ? 1 : round2(extra.range(0.7, 0.85));
}

/**
 * 未成年者・障害者の相続人が、前の相続でも控除を受けていたことにする（受けた額は最初の控除額以下）。
 * 障害者は、前の相続のときの区分（一般・特別）が今と違うこともある（extra2 で決める）
 */
function addPriorCredits(b: Builder, extra: Rng, heirs: string[], extra2: Rng): void {
  const cands = heirs.filter((id) => {
    const m = b.member(id);
    return !m.unborn && (ageAt(m.birthDate, b.death) < 18 || !!m.disability);
  });
  if (!cands.length || !extra.chance(0.3)) return;
  const pi = b.decedent.priorInheritance;
  const date = pi && pi.yearsAgo >= 1 ? addYears(b.death, -pi.yearsAgo) : addDays(addYears(b.death, -extra.int(1, 8)), -extra.int(0, 200));
  for (const id of cands) {
    const m = b.member(id);
    if (m.birthDate >= date) continue;
    const a0 = ageAt(m.birthDate, date);
    if (ageAt(m.birthDate, b.death) < 18 && a0 < 18) {
      const first = 100_000 * (18 - a0);
      m.priorMinorCredit = { date, amount: roundTo(first * extra.range(0.2, 1.0), 10_000) };
    } else if (m.disability && a0 < 85) {
      // 区分が変わった人：前の相続の日を今回の相続と同じ月日にする（年齢の差と相続の間の年数がそろう）
      const changed = extra2.chance(0.4);
      const d0 = changed ? addYears(b.death, -(pi && pi.yearsAgo >= 1 ? pi.yearsAgo : extra2.int(1, 8))) : date;
      const x0 = ageAt(m.birthDate, d0);
      const ok = !changed || (m.birthDate < d0 && x0 < 85);
      const wasSpecial = changed && ok ? m.disability !== "special" : m.disability === "special";
      const first = (wasSpecial ? 200_000 : 100_000) * (85 - (changed && ok ? x0 : a0));
      const amount = roundTo(first * extra.range(0.1, 0.9), 10_000);
      m.priorDisabilityCredit = changed && ok ? { date: d0, amount, special: wasSpecial } : { date, amount };
    }
  }
}

function randomDivision(b: Builder, ctx: RandCtx, extra: Rng, extra2: Rng): void {
  const rng = b.rng;
  const info = heirInfo(b.members);
  const legal = info.shares;
  const heirs = [...legal.keys()];
  const sp = info.spouse;
  const mem = (id: string) => b.member(id);
  const childHeirs = heirs.filter((id) => mem(id).relation === "child" || mem(id).relation === "adoptedChild");
  const byAgeDesc = (ids: string[]) => [...ids].sort((a, c) => (mem(a).birthDate < mem(c).birthDate ? -1 : 1));
  const eldest = byAgeDesc(childHeirs.length ? childHeirs : heirs.filter((id) => id !== sp))[0] ?? sp ?? heirs[0];

  const divisible = b.estate.filter(isDivisible);
  const V = divisible.reduce((s, it) => s + roughValue(it), 0) - (ctx.bequest ? roughValue(b.item(ctx.bequest.item)) : 0);

  const addDebts = (assign: (d: RandCtx["debts"][number]) => string | Record<string, number>, funeralBearer: string | Record<string, number>) => {
    for (const d of ctx.debts) b.debt(d.amount, assign(d), d.label);
    if (ctx.funeral) b.funeral(ctx.funeral, funeralBearer);
  };
  const legalWeights = () => Object.fromEntries(heirs.map((id) => [id, legal.get(id)!]));

  // 未分割（遺言で遺贈する財産があるときは作らない：遺贈分は未分割の対象にならないため）。
  // 相続人に精算課税の贈与があるときは、未分割になることを多めにする（特別受益として未分割の分け方が変わる）
  const undivNow = rng.chance(0.06);
  const giftHeirs = heirs.filter((id) => ctx.settlementTo?.has(id));
  const undivGift = !undivNow && giftHeirs.length > 0 && heirs.length >= 2 && !ctx.bequest && extra2.chance(0.3);
  if ((undivNow || undivGift) && heirs.length >= 2 && !ctx.bequest) {
    b.undivided();
    addDebts(() => legalWeights(), sp && rng.chance(0.6) ? sp : legalWeights());
    return;
  }
  if (ctx.bequest) b.give(ctx.bequest.item, ctx.bequest.who);

  // 代償分割
  if (rng.chance(0.053) && heirs.length >= 2 && childHeirs.length >= 1 && !ctx.spouseRight) {
    const payer = eldest;
    for (const it of divisible) if (!b.shares[it.id]) b.give(it.id, payer);
    // 代償金の額を自宅（土地かマンション）の時価をもとに決めることもある（相基通11の2-10(2)）
    const basisItem = ctx.homeLand ?? ctx.condo;
    const basis = basisItem && extra.chance(0.5) ? { item: basisItem, marketValue: roundTo(roughValue(b.item(basisItem)) * extra.range(1.1, 1.7), 100_000) } : undefined;
    for (const id of heirs) {
      if (id === payer) continue;
      let amount = roundTo(V * legal.get(id)! * rng.range(0.5, 1.0), 100_000);
      if (basis) amount = roundTo(basis.marketValue * legal.get(id)! * extra.range(0.6, 1.0), 100_000);
      b.compensate(payer, id, amount, basis);
    }
    const site = ctx.homeLand ?? ctx.condo;
    if (site) {
      const it = b.item(site);
      const okUse = it.type === "condo" || (it.type === "land" && (it.use === "self" || it.use === "leasehold"));
      if (okUse && rng.chance(0.55)) b.smallLand(site, "residence", payer);
    }
    addDebts(() => payer, payer);
    // 代償分割＋一部未分割：預貯金などの一部の分け方が決まらない。代償金は分割で取得した額に含めて穴埋めする（相基通11の2-9）。
    // 払う人が分割で取得する額が代償金の1.2倍以上残るときだけ
    if (!ctx.bequest && extra2.chance(0.4)) {
      const liquid = b.estate
        .filter((it) => (it.type === "deposit" || it.type === "listedStock" || it.type === "cash" || it.type === "other") && !("foreign" in it && it.foreign) && b.shares[it.id])
        .sort((a, c) => roughValue(c) - roughValue(a));
      const target = liquid[extra2.int(0, Math.max(0, liquid.length - 1))];
      const compTotal = b.compensation.reduce((x, c) => x + c.amount, 0);
      const kept = divisible.filter((it) => it.id !== target?.id).reduce((x, it) => x + roughValue(it), 0);
      if (target && divisible.length > 1 && kept >= 1.2 * compTotal) {
        delete b.shares[target.id];
        b.partlyUndivided();
      }
    }
    return;
  }

  // 目標の取り分
  const f = new Map(legal);
  if (sp) {
    const ls = legal.get(sp)!;
    const r = rng.next();
    let fs: number;
    if (heirs.length === 1) fs = 1;
    else if (r < 0.12) fs = 0;
    else if (r < 0.19) fs = 1;
    else if (r < 0.64) fs = ls;
    else if (r < 0.74) fs = V > 320_000_000 ? Math.max(ls * 0.5, 160_000_000 / V) : ls;
    else fs = rng.range(0.25, 0.8);
    const rest = 1 - ls;
    for (const id of heirs) if (id !== sp) f.set(id, rest > 0 ? (legal.get(id)! / rest) * (1 - fs) : 0);
    f.set(sp, fs);
  }
  const others = heirs.filter((id) => id !== sp);
  if (others.length >= 2 && rng.chance(0.25)) {
    const pick = rng.chance(0.6) ? eldest : rng.pick(others);
    const tot = others.reduce((s, id) => s + f.get(id)!, 0);
    f.set(pick, f.get(pick)! * rng.range(1.5, 2.5));
    const tot2 = others.reduce((s, id) => s + f.get(id)!, 0);
    for (const id of others) f.set(id, (f.get(id)! * tot) / tot2);
  }
  const R = new Map(heirs.map((id) => [id, f.get(id)! * V]));
  const take = (itemId: string, who: string | Record<string, number>) => {
    b.give(itemId, who);
    const v = roughValue(b.item(itemId));
    if (typeof who === "string") R.set(who, (R.get(who) ?? 0) - v);
    else {
      const tw = Object.values(who).reduce((s, x) => s + x, 0);
      for (const [id, x] of Object.entries(who)) R.set(id, (R.get(id) ?? 0) - (v * x) / tw);
    }
  };
  const argmaxR = (cands = heirs) => cands.reduce((a, c) => ((R.get(c) ?? 0) > (R.get(a) ?? 0) ? c : a), cands[0]);

  // 自宅
  let homeAcq: string;
  if (ctx.spouseRight && childHeirs.length) homeAcq = eldest;
  else if (sp && f.get(sp)! > 0 && rng.chance(0.88)) homeAcq = sp;
  else if (childHeirs.length) homeAcq = rng.chance(0.7) ? eldest : rng.pick(childHeirs);
  else homeAcq = argmaxR();
  if (sp && homeAcq === sp && f.get(sp) === 0) homeAcq = eldest;
  for (const id of [ctx.homeLand, ctx.homeBldg, ctx.condo]) if (id) take(id, homeAcq);
  for (const it of b.estate) if (it.type === "household" && !b.shares[it.id]) take(it.id, homeAcq);
  // 小規模宅地（特定居住用）
  const homeSite = ctx.homeLand ?? ctx.condo;
  if (homeSite) {
    const it = b.item(homeSite);
    const okUse = it.type === "condo" || (it.type === "land" && (it.use === "self" || it.use === "leasehold"));
    // 配偶者はほぼ使える。子は同居・家なき子のときだけ使える
    const p = homeAcq === sp ? 0.9 : mem(homeAcq).relation === "child" || mem(homeAcq).relation === "adoptedChild" ? 0.6 : 0.2;
    if (okUse && !ctx.spouseRight && rng.chance(p)) b.smallLand(homeSite, "residence", homeAcq);
  }
  // 賃貸
  for (const r of ctx.rentals) {
    let who: string | Record<string, number>;
    if (sp && f.get(sp)! >= 0.5 && rng.chance(0.3)) who = sp;
    else if (childHeirs.length >= 2 && rng.chance(0.15)) who = Object.fromEntries(childHeirs.map((id) => [id, 1]));
    else who = childHeirs.length ? (rng.chance(0.6) ? eldest : rng.pick(childHeirs)) : argmaxR();
    take(r.L, who);
    take(r.B, who);
    if (typeof who === "string" && rng.chance(0.35)) b.smallLand(r.L, "rental", who);
  }
  // 事業用
  if (ctx.business) {
    const who = childHeirs.length ? eldest : argmaxR();
    take(ctx.business.L, who);
    take(ctx.business.B, who);
    if (rng.chance(0.9)) b.smallLand(ctx.business.L, "business", who);
  }
  for (const id of ctx.unlisted) take(id, childHeirs.length ? eldest : argmaxR());
  for (const id of ctx.extras) take(id, rng.chance(0.15) && heirs.length >= 2 ? Object.fromEntries(others.length ? others.map((o) => [o, 1]) : heirs.map((o) => [o, 1])) : argmaxR());

  // 金融資産：大きいものから、1人にまとめて渡せるものは渡し、残りは不足額の割合で分ける
  const liquids = b.estate.filter((it) => isDivisible(it) && !b.shares[it.id]).sort((a, c) => roughValue(c) - roughValue(a));
  liquids.forEach((it, idx) => {
    const last = idx === liquids.length - 1;
    const v = roughValue(it);
    const positive = heirs.filter((id) => (R.get(id) ?? 0) > 0 && f.get(id)! > 0);
    if (!positive.length) {
      const ws = Object.fromEntries(heirs.filter((id) => f.get(id)! > 0).map((id) => [id, f.get(id)!]));
      take(it.id, Object.keys(ws).length ? ws : legalWeights());
      return;
    }
    const top = argmaxR(positive);
    if (!last && rng.chance(0.6) && (R.get(top) ?? 0) >= 0.8 * v) take(it.id, top);
    else if (positive.length === 1) take(it.id, top);
    else take(it.id, Object.fromEntries(positive.map((id) => [id, R.get(id)!])));
  });

  // 債務・葬式費用
  const acquirers = heirs.filter((id) => Object.values(b.shares).some((sh) => sh.some((x) => x.who === id)));
  const pool = acquirers.length ? acquirers : heirs;
  const weightsOf = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, legal.get(id)!]));
  let funeralBearer: string | Record<string, number>;
  if (sp && pool.includes(sp) && rng.chance(0.8)) funeralBearer = rng.chance(0.15) && pool.includes(eldest) && eldest !== sp ? { [sp]: 1, [eldest]: 1 } : sp;
  else funeralBearer = pool.includes(eldest) ? eldest : pool[0];
  addDebts((d) => {
    if (d.tie === "rental" && d.rental !== undefined) {
      const sh = b.shares[ctx.rentals[d.rental].L];
      return Object.fromEntries(sh.map((x) => [x.who, x.n / x.d]));
    }
    return rng.chance(0.6) && pool.includes(homeAcq) ? homeAcq : weightsOf(pool);
  }, funeralBearer);

  // 一部未分割：申告期限までに、預貯金・株式などの一部の分け方が決まらない（未分割の部分は穴埋め方式で計算）
  // （遺言で遺贈する財産があるときは作らない：遺贈分は分割の対象にならず、穴埋め方式の合計の取り方が分かれるため）
  const partlyNow = heirs.length >= 2 && !ctx.bequest && extra.chance(0.06);
  const partlyGift = !partlyNow && heirs.length >= 2 && !ctx.bequest && heirs.some((id) => ctx.settlementTo?.has(id)) && extra2.chance(0.3);
  if (partlyNow || partlyGift) {
    const liquid = b.estate
      .filter((it) => (it.type === "deposit" || it.type === "listedStock" || it.type === "cash" || it.type === "other") && !("foreign" in it && it.foreign) && b.shares[it.id])
      .sort((a, c) => roughValue(c) - roughValue(a));
    const k = Math.min(liquid.length, extra.chance(0.6) ? 1 : 2);
    const keepsSome = b.estate.filter(isDivisible).length > k;
    if (k > 0 && keepsSome) {
      for (let i = 0; i < k; i++) {
        const it = liquid[i];
        const sh = b.shares[it.id];
        if (i === 0 && sh.length === 1 && extra.chance(0.35)) b.givePart(it.id, [{ who: sh[0].who, n: 1, d: 2 }]);
        else delete b.shares[it.id];
      }
      b.partlyUndivided();
    }
  }
}

// ───────────────────────── 公開 API ─────────────────────────

/** シナリオを n 件作る（先頭は手で設計したエッジケース、残りは乱数のケース） */
export function generateScenarios(n = 1000, seed = 20261108): Scenario[] {
  const edges = edgeScenarios(seed);
  if (n <= edges.length) return edges.slice(0, n);
  const out = [...edges];
  for (let i = 1; out.length < n; i++) {
    const id = `R${String(i).padStart(4, "0")}`;
    out.push(
      randomScenario(
        id,
        new Rng(mixSeed(seed, i)),
        new Rng(mixSeed(seed ^ 0x5bd1e995, i)),
        new Rng(mixSeed(seed ^ 0x27d4eb2f, i)),
        new Rng(mixSeed(seed ^ 0x165667b1, i)),
      ),
    );
  }
  return out;
}

/** エッジケースの件数 */
export const EDGE_COUNT = EDGES.length;

// ───────────────────────── 検査 ─────────────────────────

/** 分数の和がちょうど 1 か（BigInt で厳密に） */
function sumIsOne(sh: Share[]): boolean {
  let num = 0n;
  let den = 1n;
  for (const x of sh) {
    num = num * BigInt(x.d) + BigInt(x.n) * den;
    den = den * BigInt(x.d);
  }
  return num === den;
}

/** 分数の和が 1 を超えるか */
function sumOver1(sh: Share[]): boolean {
  let num = 0n;
  let den = 1n;
  for (const x of sh) {
    num = num * BigInt(x.d) + BigInt(x.n) * den;
    den = den * BigInt(x.d);
  }
  return num > den;
}

/** 1件のシナリオの整合性を確かめる（問題があれば文の配列を返す） */
export function validateScenario(s: Scenario): string[] {
  const e: string[] = [];
  const err = (msg: string) => e.push(`${s.id}: ${msg}`);
  const byId = new Map<string, Member>();
  for (const m of s.members) {
    if (byId.has(m.id)) err(`人の id が重複 ${m.id}`);
    byId.set(m.id, m);
  }
  const d = s.decedent;
  const death = d.deathDate;
  if (!isDate(death) || !death.startsWith("2026-")) err(`亡くなった日が2026年でない ${death}`);
  if (!isDate(d.birthDate) || d.birthDate >= death) err(`亡くなった方の生年月日 ${d.birthDate}`);
  if (!s.title) err("題名がない");
  if (!s.tags.length) err("タグがない");
  if (d.priorInheritance) {
    const p = d.priorInheritance;
    if (!Number.isInteger(p.yearsAgo) || p.yearsAgo < 0 || p.yearsAgo > 9) err(`相次相続の年数 ${p.yearsAgo}`);
    if (!Number.isInteger(p.prevTax) || !Number.isInteger(p.prevAcquired) || p.prevTax < 0 || p.prevTax >= p.prevAcquired) err("相次相続の金額");
  }
  const decAge = ageAt(d.birthDate, death);
  const isInt = (x: number) => Number.isInteger(x);
  const alive = (id: string) => {
    const m = byId.get(id);
    return !!m && !m.predeceased;
  };
  for (const m of s.members) {
    if (!isDate(m.birthDate)) {
      err(`${m.id} の生年月日 ${m.birthDate}`);
      continue;
    }
    if (m.unborn) {
      if (!(m.birthDate > death && m.birthDate <= addMonths(death, 10))) err(`${m.id} 胎児の出生日が10か月以内でない`);
    } else if (m.birthDate > death) err(`${m.id} が亡くなった日より後に生まれている（胎児の印がない）`);
    if (m.predeceased && (m.renounced || m.diedAfter)) err(`${m.id} 先に亡くなった人が放棄・数次相続`);
    if (m.diedAfter && !(m.diedAfter > death && m.diedAfter <= addMonths(death, 10))) err(`${m.id} 数次相続の日付`);
    const gapYears = ageAt(d.birthDate, m.birthDate); // 亡くなった方が何歳のときに生まれたか
    const age = ageAt(m.birthDate, death);
    if (m.relation === "child") {
      if (m.unborn || age < 18) {
        if (gapYears < 18) err(`${m.id} 子（未成年）の年齢差 ${gapYears}`);
      } else if (gapYears < 20 || gapYears > 45) err(`${m.id} 子の年齢差 ${gapYears}（20〜45年）`);
    }
    if (m.relation === "adoptedChild" && !(m.birthDate > d.birthDate)) err(`${m.id} 養子が年長`);
    if (m.relation === "adoptedChild" && m.grandchildAdopted && gapYears < 36) err(`${m.id} 孫養子の年齢差 ${gapYears}`);
    if (m.relation === "spouse" && age < 18) err(`${m.id} 配偶者が18歳未満`);
    for (const [k, pc] of [["未成年者控除", m.priorMinorCredit], ["障害者控除", m.priorDisabilityCredit]] as const) {
      if (!pc) continue;
      if (!isDate(pc.date) || pc.date >= death || pc.date <= m.birthDate) err(`${m.id} 前の${k}の日付 ${pc.date}`);
      if (!isInt(pc.amount) || pc.amount < 0) err(`${m.id} 前の${k}の額 ${pc.amount}`);
      if (k === "未成年者控除" && isDate(pc.date) && ageAt(m.birthDate, pc.date) >= 18) err(`${m.id} 前の相続のとき未成年でない`);
      if (k === "障害者控除" && !m.disability) err(`${m.id} 障害者でないのに前の障害者控除`);
      if (pc.special !== undefined && (k !== "障害者控除" || typeof pc.special !== "boolean")) err(`${m.id} 前の${k}の区分 ${String(pc.special)}`);
      // 区分が変わった人は、前の相続の日を今回の相続と同じ月日にする（年齢の差＝相続の間の年数）
      if (k === "障害者控除" && pc.special !== undefined && pc.special !== (m.disability === "special") && pc.date.slice(5) !== death.slice(5))
        err(`${m.id} 区分が変わった人の前の相続の日 ${pc.date} が今回と同じ月日でない`);
    }
    if (m.relation === "parent" && (ageAt(m.birthDate, d.birthDate) < 16 || ageAt(m.birthDate, d.birthDate) > 50)) err(`${m.id} 父母の年齢差`);
    if (m.relation === "grandparent" && ageAt(m.birthDate, d.birthDate) < 32) err(`${m.id} 祖父母の年齢差`);
    if (m.relation === "sibling" && Math.abs(decAge - age) > 25) err(`${m.id} 兄弟姉妹の年齢差`);
    if (m.substituteOf) {
      const p = byId.get(m.substituteOf);
      if (!p) err(`${m.id} の substituteOf ${m.substituteOf} がいない`);
      else {
        if (!p.predeceased) err(`${m.id} の親 ${p.id} が先に亡くなっていないのに代襲`);
        const ok =
          ((m.relation === "grandchild" || m.relation === "adoptedChild") && (p.relation === "child" || p.relation === "adoptedChild")) ||
          (m.relation === "greatGrandchild" && p.relation === "grandchild") ||
          (m.relation === "nephewNiece" && p.relation === "sibling");
        if (!ok) err(`${m.id}（${m.relation}）は ${p.id}（${p.relation}）の代襲相続人になれない`);
        if (ageAt(p.birthDate, m.birthDate) < 15) err(`${m.id} 親との年齢差が小さい`);
      }
    }
    if ((m.relation === "greatGrandchild" || m.relation === "nephewNiece") && !m.substituteOf) err(`${m.id} ひ孫・甥姪で代襲でない`);
  }

  const itemIds = new Set<string>();
  for (const it of s.estate) {
    if (itemIds.has(it.id)) err(`財産の id が重複 ${it.id}`);
    itemIds.add(it.id);
    switch (it.type) {
      case "deposit":
      case "cash":
      case "household":
      case "other":
        if (!isInt(it.amount) || it.amount <= 0) err(`${it.id} 金額 ${it.amount}`);
        break;
      case "insurance":
      case "retirement":
        if (!isInt(it.amount) || it.amount <= 0) err(`${it.id} 金額 ${it.amount}`);
        if (!alive(it.recipient)) err(`${it.id} 受取人 ${it.recipient} がいない・先に死亡`);
        break;
      case "listedStock":
        if (!isInt(it.shares) || it.shares <= 0) err(`${it.id} 株数`);
        for (const p of Object.values(it.prices)) if (!(p > 0) || !Number.isFinite(p)) err(`${it.id} 株価 ${p}`);
        break;
      case "unlistedStock":
        if (!isInt(it.shares) || it.shares <= 0 || !isInt(it.value) || it.value <= 0) err(`${it.id} 非上場株式`);
        break;
      case "building":
        if (!isInt(it.fixedAssetValue) || it.fixedAssetValue <= 0) err(`${it.id} 固定資産税評価額`);
        if (it.rentRatio !== undefined && !(it.rentRatio > 0 && it.rentRatio <= 1)) err(`${it.id} 賃貸割合`);
        if (it.rentRatio !== undefined && !it.rented) err(`${it.id} 貸家でないのに賃貸割合`);
        break;
      case "condo":
        if (!isInt(it.landValue) || !isInt(it.buildingFixedAssetValue) || it.landValue <= 0 || it.buildingFixedAssetValue <= 0) err(`${it.id} マンションの金額`);
        if (it.floor < 1 || it.floor > it.totalFloors || it.builtYears < 0 || it.builtMonths < 0 || it.builtMonths > 11) err(`${it.id} マンションの階・築年数`);
        if (!(it.landShareSqm > 0 && it.exclusiveAreaSqm > 0)) err(`${it.id} マンションの面積`);
        break;
      case "land": {
        if (!(it.areaSqm > 0)) err(`${it.id} 地積`);
        const v = it.valuation;
        if (v.kind === "rosenka") {
          if (v.roads.filter((r) => r.position === "front").length !== 1) err(`${it.id} 正面路線が1本でない`);
          for (const r of v.roads) if (!isInt(r.price) || r.price <= 0 || !(r.depth > 0) || !(r.frontage > 0)) err(`${it.id} 路線の値`);
        } else {
          if (!isInt(v.fixedAssetValue) || v.fixedAssetValue <= 0 || !(v.rate > 0)) err(`${it.id} 倍率の値`);
          if (v.leaseRatio !== undefined && !(v.leaseRatio > 0 && v.leaseRatio < 1)) err(`${it.id} 借地権割合`);
        }
        if (it.rentRatio !== undefined && !(it.rentRatio > 0 && it.rentRatio <= 1)) err(`${it.id} 賃貸割合`);
        if (it.rentRatio !== undefined && it.use !== "rentedHouse" && it.use !== "rentedLeasehold") err(`${it.id} 貸家建付地・貸家建付借地権でないのに賃貸割合`);
        if (it.advisorRate !== undefined) {
          if (!(it.advisorRate > 0 && it.advisorRate <= 1)) err(`${it.id} 補正率 ${it.advisorRate}`);
          if (it.spouseResidenceRight) err(`${it.id} 配偶者居住権のある土地に補正率`);
          if (it.needsReduction !== "irregular" && it.needsReduction !== "largeLot") err(`${it.id} 不整形地・地積規模の大きな宅地でないのに補正率`);
          if (v.kind !== "rosenka") err(`${it.id} 倍率方式の土地に補正率`);
        }
        if (it.needsReduction === "largeLot" && it.areaSqm < 500) err(`${it.id} 地積規模の大きな宅地なのに500㎡未満`);
        if (it.needsReduction === "largeLot" && it.areaSqm < 1000 && !METRO_PREFS.has(it.label.match(/（(?:[^（）、]*、)?(.{2,3}?[都道府県])/)?.[1] ?? ""))
          err(`${it.id} 三大都市圏の外で地積規模の大きな宅地なのに1,000㎡未満`);
        if (it.smallLand?.kind === "rental" && it.use !== "rentedHouse" && it.use !== "rentedLeasehold" && it.use !== "leasedLand" && it.use !== "parking") err(`${it.id} 貸付事業用なのに貸していない`);
        if (it.smallLand?.kind === "residence" && it.use !== "self" && it.use !== "leasehold") err(`${it.id} 特定居住用なのに自用でない`);
        break;
      }
    }
    if ((it.type === "land" || it.type === "condo") && it.smallLand) {
      const sl = it.smallLand;
      const users = [sl, ...(sl.others ?? [])];
      const seenUsers = new Set<string>();
      for (const u of users) {
        if (!alive(u.acquirer)) err(`${it.id} 小規模宅地の取得者 ${u.acquirer} がいない`);
        if (seenUsers.has(u.acquirer)) err(`${it.id} 小規模宅地の取得者 ${u.acquirer} が2回`);
        seenUsers.add(u.acquirer);
        if (s.division.kind === "agreed" && !(s.division.shares[it.id] ?? []).some((x) => x.who === u.acquirer)) err(`${it.id} 小規模宅地の取得者 ${u.acquirer} が取得していない`);
        if (u.selectedSqm !== undefined && !(u.selectedSqm > 0 && Math.abs(Math.round(u.selectedSqm * 100) - u.selectedSqm * 100) < 1e-6))
          err(`${it.id} 特例を使う面積 ${u.selectedSqm}（0より大きく0.01㎡単位）`);
        if (sl.kind === "residence" && u.continues !== undefined) err(`${it.id} 特定居住用に事業・貸付を続けるかの答え`);
        if (sl.kind !== "residence" && u.livedTogether !== undefined) err(`${it.id} 事業用・貸付用に同居の答え`);
      }
      if (sl.livedTogether === false || sl.keep === false || sl.continues === false) err(`${it.id} 小規模宅地の1人目の取得者が要件を満たさない（others に書く）`);
      if (s.division.kind === "undivided") err(`${it.id} 未分割なのに小規模宅地`);
    }
  }

  const debtIds = new Set<string>();
  for (const dbt of s.debts) {
    if (debtIds.has(dbt.id)) err(`債務の id が重複 ${dbt.id}`);
    debtIds.add(dbt.id);
    if (!isInt(dbt.amount) || dbt.amount <= 0) err(`${dbt.id} 金額`);
    const sum = dbt.bearers.reduce((x, y) => x + y.amount, 0);
    if (sum !== dbt.amount) err(`${dbt.id} 負担額の合計 ${sum} ≠ ${dbt.amount}`);
    for (const bb of dbt.bearers) {
      if (!alive(bb.who)) err(`${dbt.id} 負担者 ${bb.who} がいない・先に死亡`);
      if (!isInt(bb.amount) || bb.amount <= 0) err(`${dbt.id} 負担額 ${bb.amount}`);
    }
  }

  for (const g of s.gifts) {
    if (!alive(g.to)) err(`贈与の受贈者 ${g.to} がいない・先に死亡`);
    if (!isDate(g.date) || g.date >= death) err(`贈与日 ${g.date} が亡くなった日より前でない`);
    if (!isInt(g.amount) || g.amount <= 0 || !isInt(g.giftTaxPaid) || g.giftTaxPaid < 0 || g.giftTaxPaid >= g.amount) err(`贈与の金額 ${g.amount}/${g.giftTaxPaid}`);
  }
  // 精算課税を選んだ人には、その後に同じ方からの暦年課税の贈与はない
  for (const g of s.gifts.filter((x) => x.settlement)) {
    if (s.gifts.some((x) => !x.settlement && x.to === g.to && x.date >= g.date)) err(`${g.to} 精算課税を選んだ後に暦年贈与`);
  }

  if (s.division.kind === "agreed") {
    const div = s.division;
    for (const [id, sh] of Object.entries(div.shares)) {
      const it = s.estate.find((x) => x.id === id);
      if (!it) err(`分け方に存在しない財産 ${id}`);
      else if (!isDivisible(it)) err(`保険金・退職金 ${id} が分け方にある`);
      if (div.partlyUndivided ? sumOver1(sh) : !sumIsOne(sh)) err(`${id} の持分の合計が${div.partlyUndivided ? "1を超える" : "1でない"} ${JSON.stringify(sh)}`);
      for (const x of sh) {
        const m = byId.get(x.who);
        if (!m) err(`${id} の取得者 ${x.who} がいない`);
        else if (m.predeceased || m.renounced) err(`${id} の取得者 ${x.who} が先に死亡・放棄`);
        if (!isInt(x.n) || !isInt(x.d) || x.n <= 0 || x.d <= 0 || x.n > x.d) err(`${id} 持分 ${x.n}/${x.d}`);
      }
    }
    if (!div.partlyUndivided) for (const it of s.estate) if (isDivisible(it) && !div.shares[it.id]) err(`${it.id} の分け方がない`);
    if (div.partlyUndivided) {
      const divisible = s.estate.filter(isDivisible);
      if (!divisible.some((it) => !div.shares[it.id] || !sumIsOne(div.shares[it.id]))) err("一部未分割なのに未分割の財産がない");
      if (!divisible.some((it) => div.shares[it.id])) err("一部未分割なのに分けた財産がない");
    }
    for (const c of div.compensation ?? []) {
      for (const who of [c.from, c.to]) {
        const m = byId.get(who);
        if (!m || m.predeceased || m.renounced) err(`代償金の ${who} がいない・先に死亡・放棄`);
      }
      if (c.from === c.to || !isInt(c.amount) || c.amount <= 0) err(`代償金 ${JSON.stringify(c)}`);
      if (c.basis) {
        const it = s.estate.find((x) => x.id === c.basis!.item);
        if (!it || !isDivisible(it)) err(`代償金のもとにした財産 ${c.basis.item} がない`);
        if (!isInt(c.basis.marketValue) || c.basis.marketValue <= 0) err(`代償金のもとにした時価 ${c.basis.marketValue}`);
      }
    }
  }
  return e;
}

export function validateScenarios(list: Scenario[]): string[] {
  const e: string[] = [];
  const ids = new Set<string>();
  for (const s of list) {
    if (ids.has(s.id)) e.push(`シナリオの id が重複 ${s.id}`);
    ids.add(s.id);
    e.push(...validateScenario(s));
  }
  return e;
}

export function tagFrequency(list: Scenario[]): [string, number][] {
  const c = new Map<string, number>();
  for (const s of list) for (const t of s.tags) c.set(t, (c.get(t) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

// ───────────────────────── 直接実行したとき ─────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const n = Number(opt("--n") ?? 1000);
  const seed = Number(opt("--seed") ?? 20261108);
  const out = opt("--out");
  const list = generateScenarios(n, seed);
  const errors = validateScenarios(list);
  const again = JSON.stringify(generateScenarios(n, seed));
  const json = JSON.stringify(list, null, 2);
  const deterministic = again === JSON.stringify(list);

  const log = (s = "") => process.stderr.write(s + "\n");
  log(`シナリオ ${list.length} 件（エッジ ${list.filter((s) => s.id.startsWith("E")).length}・ランダム ${list.filter((s) => s.id.startsWith("R")).length}）seed=${seed}`);
  log(`同じ seed で同じ結果: ${deterministic ? "OK" : "NG"}`);
  log(`整合性の検査: ${errors.length ? `${errors.length} 件の問題` : "問題なし"}`);
  for (const x of errors.slice(0, 50)) log(`  ✗ ${x}`);
  const rand = list.filter((s) => s.id.startsWith("R"));
  if (rand.length) {
    const pct = (k: number) => `${((100 * k) / rand.length).toFixed(1)}%`;
    const count = (f: (s: Scenario) => boolean) => rand.filter(f).length;
    const homeCases = rand.filter((s) => s.estate.some((it) => (it.type === "land" && it.label.startsWith("自宅")) || it.type === "condo"));
    const withRes = homeCases.filter((s) => s.estate.some((it) => (it.type === "land" || it.type === "condo") && it.smallLand?.kind === "residence"));
    const totals = rand.map((s) => s.estate.reduce((x, it) => x + roughValue(it), 0)).sort((a, b) => a - b);
    const q = (p: number) => `${Math.round(totals[Math.floor(p * (totals.length - 1))] / 10_000).toLocaleString()}万円`;
    log("");
    log("ランダムのケースの分布");
    for (const g of ["家族:配偶者と子", "家族:子のみ", "家族:兄弟姉妹", "家族:父母", "家族:祖父母", "家族:配偶者のみ", "家族:相続人なし"]) log(`  ${g.padEnd(14, "　")} ${pct(count((s) => s.tags.includes(g)))}`);
    log(`  代襲（孫）     ${pct(count((s) => s.tags.includes("代襲（孫）")))}`);
    // 実際の申告200件の見直し：面積の一部だけに使う 2.5%、1つの宅地を共有して2人以上が使う 1.5%
    log(`  小規模宅地を共有で何人も使う ${pct(count((s) => s.tags.includes("小規模宅地（共有で何人も使う）")))}・使う面積を選んだ ${pct(count((s) => s.tags.includes("小規模宅地（使う面積を選んだ）")))}`);
    log(`  自宅のあるケースで特定居住用の特例 ${((100 * withRes.length) / Math.max(1, homeCases.length)).toFixed(1)}%（${withRes.length}/${homeCases.length}）`);
    log(`  遺産総額（おおまかな評価）: 10%点 ${q(0.1)}・中央値 ${q(0.5)}・90%点 ${q(0.9)}・99%点 ${q(0.99)}・最大 ${q(1)}`);
  }
  log("");
  log("タグの集計（全件）");
  for (const [t, k] of tagFrequency(list)) log(`  ${String(k).padStart(5)}  ${t}`);

  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, json + "\n");
    log(`\n${out} に書き出した`);
  } else {
    process.stdout.write(json + "\n");
  }
  if (errors.length || !deterministic) process.exitCode = 1;
}

if (process.argv[1] && /generate\.ts$/.test(process.argv[1])) main();
