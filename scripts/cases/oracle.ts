/**
 * 相続税の「正しい答え」（オラクル）。
 *
 * アプリ（src/ 以下）のコードは一切見ずに、法令と通達だけから書いた独立の計算。
 * 拠り所：
 *   民法 886・887・889・890・900・901・939 条
 *   相続税法 3・12・13・15〜21 条、21 条の 15・16、55 条
 *   租税特別措置法 69 条の 4（小規模宅地等。1つの宅地を何人かで取得したときは取得者ごとの要件と持分：国税庁タックスアンサー No.4124、
 *   申告書第11・11の2表の付表1 の ③取得者の持分に応ずる面積・⑤選択特例対象宅地等の面積（③以下）・⑥④×⑤/③）
 *   財産評価基本通達（以下「評基通」）15〜18・20-4・21-2・25・26・27・89・93・169、付表1〜3・6・7
 *   「居住用の区分所有財産の評価について」（令和5年9月28日 法令解釈通達）
 *   相続税法基本通達（以下「相基通」）1の2-1・11の2-9・11の2-10・13-1・13-3・15-3・15-4・17-1・19-3・19の2-3・19の3-1〜5・19の4-4 など
 *   国税庁「相続税の申告のしかた（令和7年分以降用）」と申告書第1表〜第15表の記載方法
 *   国税庁 質疑応答事例「正面路線の判定(1)」、情報「小規模宅地等の特例（貸付事業用宅地等）…一部が空室の場合」（平成22年7月13日 情報 06）
 *
 * 使い方：expected(scenario) → Expected
 * 端数の扱いは、申告書の各欄の書き方に合わせている（どこで切り捨てるかはコメントに書いた）。
 */
import type { Scenario, Member, EstateItem, Expected, ScenarioRoad, LandValuation, SmallLandKind } from "./scenario";

/* ------------------------------------------------------------------ */
/* シナリオの形にない項目（このファイルの中だけで使う追加の任意項目）     */
/* ------------------------------------------------------------------ */

/**
 * マンション（区分所有）を貸しているときに必要な項目。scenario.ts の condo には無いので、
 * ここでだけ任意項目として読む。無ければ 賃貸割合 1、借地権割合は 0.7（C）とみなしてメモに残す。
 */
type CondoItem = Extract<EstateItem, { type: "condo" }>;
type CondoExt = CondoItem & { leaseRatio?: number; leaseLetter?: ScenarioRoad["leaseLetter"]; rentRatio?: number };
const CONDO_DEFAULT_LEASE = 0.7;

/* ------------------------------------------------------------------ */
/* 有理数（BigInt）— 割合や按分を誤差なく扱うため                        */
/* ------------------------------------------------------------------ */

export interface Q {
  n: bigint;
  d: bigint;
}
function gcdB(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}
function Qn(n: bigint | number, d: bigint | number = 1n): Q {
  let nn = typeof n === "bigint" ? n : BigInt(n);
  let dd = typeof d === "bigint" ? d : BigInt(d);
  if (dd === 0n) throw new Error("ゼロで割った");
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcdB(nn, dd) || 1n;
  return { n: nn / g, d: dd / g };
}
/** 割合の入力が百分率（30 など）で来たときは 0.3 に直す */
function ratioQ(x: number): Q {
  return x > 1 ? qdiv(decQ(x), Qn(100)) : decQ(x);
}
/** 小数（0.75 など）を正確な分数にする。文字列表現の桁をそのまま使う */
function decQ(x: number): Q {
  if (!Number.isFinite(x)) throw new Error(`数値でない: ${x}`);
  if (Number.isInteger(x)) return Qn(BigInt(x));
  const s = x.toString();
  if (/e/i.test(s)) return Qn(BigInt(Math.round(x * 1e12)), 10n ** 12n);
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  return Qn(BigInt(i + f) * (neg ? -1n : 1n), 10n ** BigInt(f.length));
}
const ZERO = Qn(0);
const ONE = Qn(1);
const qadd = (a: Q, b: Q): Q => Qn(a.n * b.d + b.n * a.d, a.d * b.d);
const qsub = (a: Q, b: Q): Q => Qn(a.n * b.d - b.n * a.d, a.d * b.d);
const qmul = (a: Q, b: Q): Q => Qn(a.n * b.n, a.d * b.d);
const qdiv = (a: Q, b: Q): Q => Qn(a.n * b.d, a.d * b.n);
const qcmp = (a: Q, b: Q): number => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};
const qmin = (a: Q, b: Q): Q => (qcmp(a, b) <= 0 ? a : b);
function qfloor(a: Q): bigint {
  const t = a.n / a.d;
  return a.n % a.d !== 0n && a.n < 0n ? t - 1n : t;
}
function qceil(a: Q): bigint {
  return -qfloor(Qn(-a.n, a.d));
}
const qnum = (a: Q): number => Number(a.n) / Number(a.d);
const qstr = (a: Q): string => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);
/** 円の整数 × 割合 … の円未満切捨て */
function yenFloor(v: number, ...fs: Q[]): number {
  let x = Qn(BigInt(Math.trunc(v)));
  for (const f of fs) x = qmul(x, f);
  return Number(qfloor(x));
}
const floor1000 = (x: number): number => (x <= 0 ? 0 : Math.floor(x / 1000) * 1000);
const floor100 = (x: number): number => (x <= 0 ? 0 : Math.floor(x / 100) * 100);
const fmt = (x: number): string => x.toLocaleString("ja-JP");

/* ------------------------------------------------------------------ */
/* 日付・年齢                                                          */
/* ------------------------------------------------------------------ */

function ymd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map((t) => Number(t));
  return { y, m, d };
}
/** 満年齢（年齢計算ニ関スル法律。誕生日の当日に1歳増えるものとして数える） */
export function ageAt(birth: string, on: string): number {
  const b = ymd(birth);
  const o = ymd(on);
  let a = o.y - b.y;
  if (o.m < b.m || (o.m === b.m && o.d < b.d)) a--;
  return Math.max(0, a);
}
/** n 年前の同じ日（2月29日は2月28日に寄せる） */
function yearsBefore(s: string, n: number): string {
  const { y, m, d } = ymd(s);
  const yy = y - n;
  const leap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
  const dd = m === 2 && d === 29 && !leap ? 28 : d;
  return `${yy}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* 民法：相続人と法定相続分                                              */
/* ------------------------------------------------------------------ */

interface LineHeir {
  id: string;
  share: Q; // 系統の中での割合
}
/** 同順位の相続人の「ひとまとまり」（子1人とその代襲相続人、兄弟姉妹1人とその子 など） */
interface HeirGroup {
  unitId: string;
  /** 兄弟姉妹の全血=2・半血=1（民法900条4号ただし書）。それ以外は1 */
  weight: bigint;
  /** 相続税法15条の「養子の数の制限」の対象になる養子本人の系統 */
  plainAdopted: boolean;
  heirs: LineHeir[];
}
export interface HeirStructure {
  /** 血族相続人の順位（1 子・2 直系尊属・3 兄弟姉妹・0 なし） */
  order: 0 | 1 | 2 | 3;
  spouseId?: string;
  groups: HeirGroup[];
  /** 代襲相続人でもある孫養子（二重の資格） */
  dual: string[];
  notes: string[];
}

const isAdopted = (m: Member): boolean => m.relation === "adoptedChild" || !!m.grandchildAdopted;
/** 子の順位のひとまとまりになる人（実子・養子・孫養子） */
const isChildUnit = (m: Member): boolean =>
  m.relation === "child" ||
  m.relation === "adoptedChild" ||
  (!!m.grandchildAdopted && (m.relation === "grandchild" || m.relation === "greatGrandchild"));

/**
 * 民法の相続人を決める。
 * ignoreRenounce=true のときは「相続の放棄がなかったものとした場合」（相続税法15条2項）。
 */
export function heirStructure(ms: Member[], ignoreRenounce: boolean): HeirStructure {
  const notes: string[] = [];
  const byId = new Map(ms.map((m) => [m.id, m]));
  const living = (m: Member): boolean => !m.predeceased;
  // 民法939条：放棄した者は初めから相続人とならなかったものとみなす（代襲の原因にもならない）
  const out = (m: Member): boolean => (ignoreRenounce ? false : !!m.renounced);

  // 民法890条：配偶者は常に相続人
  const spouses = ms.filter((m) => m.relation === "spouse" && living(m));
  if (spouses.length > 1) notes.push("生存している配偶者が2人以上いる（最初の1人だけを配偶者とした）");
  const spouse = spouses[0] && !out(spouses[0]) ? spouses[0] : undefined;

  const dual: string[] = [];

  // 民法887条：子。先に死亡した子の子が代襲（2項）、さらにその子が再代襲（3項）
  const descLine = (p: Member, depth: number): LineHeir[] => {
    if (depth > 6) return [];
    if (living(p)) return out(p) ? [] : [{ id: p.id, share: ONE }];
    const subs = ms.filter(
      (c) =>
        c.substituteOf === p.id &&
        c.id !== p.id &&
        (c.relation === "grandchild" || c.relation === "greatGrandchild" || !!c.grandchildAdopted),
    );
    const lines = subs.map((c) => descLine(c, depth + 1)).filter((l) => l.length > 0);
    if (lines.length === 0) return [];
    const k = BigInt(lines.length);
    return lines.flatMap((l) => l.map((h) => ({ id: h.id, share: qdiv(h.share, Qn(k)) })));
  };

  const childGroups: HeirGroup[] = [];
  for (const m of ms.filter(isChildUnit)) {
    const heirs = descLine(m, 0);
    if (heirs.length === 0) continue;
    // 代襲相続人でもある孫養子は、15条3項により実子とみなされる（相基通15-4：1人として数える）
    const parent = m.substituteOf ? byId.get(m.substituteOf) : undefined;
    const isDual = !!m.grandchildAdopted && !!parent && !!parent.predeceased;
    if (isDual && !dual.includes(m.id)) dual.push(m.id);
    const plain = isAdopted(m) && !m.adoptedCountsAsBiological && !isDual && living(m);
    childGroups.push({ unitId: m.id, weight: 1n, plainAdopted: plain, heirs });
  }
  // 代襲元の子（child でない記録ミスなど）を拾えなかった代襲相続人はメモ
  for (const m of ms) {
    if (!m.substituteOf) continue;
    const p = byId.get(m.substituteOf);
    if (!p) notes.push(`${m.name}：代襲元（${m.substituteOf}）が見つからない`);
    else if (!p.predeceased && p.renounced) notes.push(`${m.name}：${p.name}の放棄は代襲原因ではない（民法887条2項・939条）`);
    else if (!p.predeceased) notes.push(`${m.name}：代襲元の${p.name}が存命なので代襲相続人ではない`);
  }
  if (childGroups.length > 0) return { order: 1, spouseId: spouse?.id, groups: childGroups, dual, notes };

  // 民法889条1項1号：直系尊属（親等の近い者が先）
  const asc = ms
    .filter((m) => (m.relation === "parent" || m.relation === "grandparent") && living(m) && !out(m))
    .map((m) => ({ m, deg: m.relation === "parent" ? 1 : 2 }));
  if (asc.length > 0) {
    const minDeg = Math.min(...asc.map((a) => a.deg));
    const groups = asc
      .filter((a) => a.deg === minDeg)
      .map((a) => ({ unitId: a.m.id, weight: 1n, plainAdopted: false, heirs: [{ id: a.m.id, share: ONE }] }));
    return { order: 2, spouseId: spouse?.id, groups, dual, notes };
  }

  // 民法889条1項2号：兄弟姉妹。代襲は甥姪まで（889条2項は887条2項のみ準用、再代襲なし）
  const sibGroups: HeirGroup[] = [];
  for (const sb of ms.filter((m) => m.relation === "sibling")) {
    let heirs: LineHeir[] = [];
    if (living(sb)) heirs = out(sb) ? [] : [{ id: sb.id, share: ONE }];
    else {
      const subs = ms.filter((c) => c.substituteOf === sb.id && c.relation === "nephewNiece" && living(c) && !out(c));
      heirs = subs.map((c) => ({ id: c.id, share: Qn(1, subs.length) }));
    }
    if (heirs.length === 0) continue;
    sibGroups.push({ unitId: sb.id, weight: sb.halfBlood ? 1n : 2n, plainAdopted: false, heirs });
  }
  if (sibGroups.length > 0) return { order: 3, spouseId: spouse?.id, groups: sibGroups, dual, notes };

  return { order: 0, spouseId: spouse?.id, groups: [], dual, notes };
}

/** 民法900条：配偶者の相続分 */
export function spouseShareOf(order: number, hasSpouse: boolean): Q {
  if (!hasSpouse) return ZERO;
  if (order === 1) return Qn(1, 2);
  if (order === 2) return Qn(2, 3);
  if (order === 3) return Qn(3, 4);
  return ONE;
}

/**
 * 各人の相続分（民法900・901条）。
 * limitAdopted=true は相続税法15条2項・16条用：養子の数を 実子あり1人・なし2人 に制限する。
 */
export function sharesOf(h: HeirStructure, limitAdopted: boolean): Map<string, Q> {
  const res = new Map<string, Q>();
  const sp = spouseShareOf(h.order, !!h.spouseId);
  if (h.spouseId) res.set(h.spouseId, sp);
  let groups = h.groups;
  if (limitAdopted && h.order === 1) {
    const hasBio = groups.some((g) => !g.plainAdopted);
    const limit = hasBio ? 1 : 2;
    let used = 0;
    groups = groups.filter((g) => {
      if (!g.plainAdopted) return true;
      used++;
      return used <= limit;
    });
  }
  if (groups.length === 0) return res;
  const blood = qsub(ONE, sp);
  const totalW = groups.reduce((a, g) => a + g.weight, 0n);
  for (const g of groups) {
    const gShare = qmul(blood, Qn(g.weight, totalW));
    for (const hh of g.heirs) {
      const v = qmul(gShare, hh.share);
      res.set(hh.id, qadd(res.get(hh.id) ?? ZERO, v));
    }
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* 評価：路線価方式（評基通15〜18・20-4、付表1〜3・6・7）                  */
/* ------------------------------------------------------------------ */

type District = Extract<LandValuation, { kind: "rosenka" }>["district"];

/** 付表1 奥行価格補正率表の区切り（m、上限・未満）。最後の欄は「100以上」 */
const DEPTH_UPPER = [
  4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100,
];
/**
 * 付表1 奥行価格補正率表（平成30年分以降用。国税庁 評基通 付表1 を書き写したもの。値は百分率）
 * 並び：4未満, 4-6, 6-8, 8-10, 10-12, 12-14, 14-16, 16-20, 20-24, 24-28, 28-32, 32-36, 36-40, 40-44,
 *       44-48, 48-52, 52-56, 56-60, 60-64, 64-68, 68-72, 72-76, 76-80, 80-84, 84-88, 88-92, 92-96, 96-100, 100以上
 */
const DEPTH_TABLE: Record<District, number[]> = {
  ビル街地区: [
    80, 80, 84, 88, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 99, 97,
    95,
  ],
  高度商業地区: [
    90, 92, 94, 96, 98, 99, 100, 100, 100, 100, 100, 100, 100, 100, 100, 99, 98, 97, 96, 95, 94, 93, 92, 90, 88, 86, 84, 82, 80,
  ],
  繁華街地区: [
    90, 92, 95, 97, 99, 100, 100, 100, 100, 100, 98, 96, 94, 92, 90, 88, 87, 86, 85, 84, 83, 82, 81, 80, 80, 80, 80, 80, 80,
  ],
  "普通商業・併用住宅地区": [
    90, 92, 95, 97, 99, 100, 100, 100, 100, 100, 100, 97, 95, 93, 91, 89, 88, 87, 86, 85, 84, 83, 82, 81, 80, 80, 80, 80, 80,
  ],
  普通住宅地区: [
    90, 92, 95, 97, 100, 100, 100, 100, 100, 97, 95, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 83, 82, 82, 81, 81, 81, 80,
  ],
  中小工場地区: [
    85, 90, 93, 95, 96, 97, 98, 99, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 99, 98, 97, 96, 96, 93, 93, 90, 90, 90, 90,
  ],
  大工場地区: [
    85, 90, 93, 95, 96, 97, 98, 99, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
    100, 100,
  ],
};
/** 付表2 側方路線影響加算率表（角地の場合）。準角地は使わない */
const SIDE_RATE: Record<District, number> = {
  ビル街地区: 7,
  高度商業地区: 10,
  繁華街地区: 10,
  "普通商業・併用住宅地区": 8,
  普通住宅地区: 3,
  中小工場地区: 3,
  大工場地区: 2,
};
/** 付表3 二方路線影響加算率表 */
const BACK_RATE: Record<District, number> = {
  ビル街地区: 3,
  高度商業地区: 7,
  繁華街地区: 7,
  "普通商業・併用住宅地区": 5,
  普通住宅地区: 2,
  中小工場地区: 2,
  大工場地区: 2,
};
/** 付表6 間口狭小補正率表。区切り：4未満, 4-6, 6-8, 8-10, 10-16, 16-22, 22-28, 28以上。0 は表に「－」（定めなし） */
const FRONTAGE_UPPER = [4, 6, 8, 10, 16, 22, 28];
const FRONTAGE_TABLE: Record<District, number[]> = {
  ビル街地区: [0, 0, 0, 95, 97, 98, 99, 100],
  高度商業地区: [85, 94, 97, 100, 100, 100, 100, 100],
  繁華街地区: [90, 100, 100, 100, 100, 100, 100, 100],
  "普通商業・併用住宅地区": [90, 97, 100, 100, 100, 100, 100, 100],
  普通住宅地区: [90, 94, 97, 100, 100, 100, 100, 100],
  中小工場地区: [80, 85, 90, 95, 100, 100, 100, 100],
  大工場地区: [80, 85, 90, 95, 97, 98, 99, 100],
};
/** 付表7 奥行長大補正率表（奥行距離÷間口距離）。区切り：2未満, 2-3, 3-4, 4-5, 5-6, 6-7, 7-8, 8以上 */
const LONG_LOWER = [2, 3, 4, 5, 6, 7, 8];
const LONG_TABLE: Record<District, number[]> = {
  ビル街地区: [100, 100, 100, 100, 100, 100, 100, 100],
  高度商業地区: [100, 100, 99, 98, 96, 94, 92, 90],
  繁華街地区: [100, 100, 99, 98, 96, 94, 92, 90],
  "普通商業・併用住宅地区": [100, 100, 99, 98, 96, 94, 92, 90],
  普通住宅地区: [100, 98, 96, 94, 92, 90, 90, 90],
  中小工場地区: [100, 100, 99, 98, 96, 94, 92, 90],
  大工場地区: [100, 100, 100, 100, 100, 100, 100, 100],
};

/** テスト用：表の形の確認 */
export const TABLES = { DEPTH_UPPER, DEPTH_TABLE, FRONTAGE_UPPER, FRONTAGE_TABLE, LONG_LOWER, LONG_TABLE };

/** 奥行価格補正率（百分率の整数） */
export function depthRate(district: District, depth: number): number {
  let i = DEPTH_UPPER.findIndex((u) => depth < u);
  if (i < 0) i = DEPTH_UPPER.length;
  return DEPTH_TABLE[district][i];
}
export function frontageRate(district: District, frontage: number): number {
  let i = FRONTAGE_UPPER.findIndex((u) => frontage < u);
  if (i < 0) i = FRONTAGE_UPPER.length;
  return FRONTAGE_TABLE[district][i];
}
export function longDepthRate(district: District, depth: number, frontage: number): number {
  if (frontage <= 0) return 100;
  let i = 0;
  for (let k = 0; k < LONG_LOWER.length; k++) if (depth >= LONG_LOWER[k] * frontage) i = k + 1;
  return LONG_TABLE[district][i];
}
const LEASE_BY_LETTER: Record<ScenarioRoad["leaseLetter"], number> = { A: 90, B: 80, C: 70, D: 60, E: 50, F: 40, G: 30 };

/**
 * 路線価方式の1㎡当たりの価額（評価明細書 第1表の A〜E 欄）。各欄で円未満切捨て。
 * 正面路線は「路線価×奥行価格補正率」の高い方（評基通16(1)の注）。同じ額なら路線に接する距離（間口）の長い方
 * （質疑応答事例「正面路線の判定(1)」）、それも同じなら路線価の高い方、さらに同じなら入力の順（正面・側方・裏面の順、同じ向きは先の方）。
 * 向き：front と back は同じ向き（向かい合う）、side はそれと直交するものとして、
 * 正面を選び直したときの側方・裏面を決める。側方は全て角地として付表2の角地の率。
 * skipFrontage=true は不整形地（評基通20-4 は「不整形地及び無道路地を除く」）：E 欄の間口狭小・奥行長大の補正をしない。
 */
export function rosenkaUnitPrice(
  district: District,
  roads: ScenarioRoad[],
  opts: { skipFrontage?: boolean } = {},
): { unit: number; front: ScenarioRoad; steps: string[] } {
  if (roads.length === 0) throw new Error("路線がない");
  const steps: string[] = [];
  const score = (r: ScenarioRoad): number => r.price * depthRate(district, r.depth);
  const rank = { front: 0, side: 1, back: 2 } as const;
  const better = (r: ScenarioRoad, cur: ScenarioRoad): boolean => {
    const a = score(r);
    const b = score(cur);
    if (a !== b) return a > b;
    if (r.frontage !== cur.frontage) return r.frontage > cur.frontage;
    if (r.price !== cur.price) return r.price > cur.price;
    return rank[r.position] < rank[cur.position];
  };
  let front = roads[0];
  for (const r of roads) if (r !== front && better(r, front)) front = r;
  if (roads.some((r) => r !== front && score(r) === score(front)))
    steps.push(`路線価×奥行価格補正率が同じ路線があるので、間口の長い方（同じなら路線価の高い方）を正面とした`);
  const axis = (r: ScenarioRoad): number => (r.position === "side" ? 1 : 0);
  const fr = depthRate(district, front.depth);
  // A 欄：正面路線価 × 奥行価格補正率
  let unit = Math.floor((front.price * fr) / 100);
  steps.push(`正面 ${fmt(front.price)}×${(fr / 100).toFixed(2)}=${fmt(unit)}`);
  for (const r of roads) {
    if (r === front) continue;
    const rr = depthRate(district, r.depth);
    const isSide = axis(r) !== axis(front);
    const add = isSide ? SIDE_RATE[district] : BACK_RATE[district];
    // B〜D 欄：側方（二方）路線価 × 奥行価格補正率 × 加算率（円未満切捨て）
    const a = Math.floor((r.price * rr * add) / 10000);
    unit += a;
    steps.push(`${isSide ? "側方" : "二方"} ${fmt(r.price)}×${(rr / 100).toFixed(2)}×${(add / 100).toFixed(2)}=${fmt(a)}`);
  }
  // E 欄：間口狭小補正率 × 奥行長大補正率（評基通20-4、付表6・7）
  if (opts.skipFrontage) {
    steps.push("不整形地なので間口狭小・奥行長大の補正はしない（不整形地補正率に含める。評基通20-4・付表5（注）3）");
    return { unit, front, steps };
  }
  let m = frontageRate(district, front.frontage);
  if (m === 0) {
    steps.push("間口狭小補正率表に定めがない（ビル街地区で間口8m未満）→ 1.00 とした");
    m = 100;
  }
  const l = longDepthRate(district, front.depth, front.frontage);
  if (m !== 100 || l !== 100) {
    const before = unit;
    unit = Math.floor((unit * m * l) / 10000);
    steps.push(`間口狭小${(m / 100).toFixed(2)}×奥行長大${(l / 100).toFixed(2)}：${fmt(before)}→${fmt(unit)}`);
  }
  return { unit, front, steps };
}

/* ------------------------------------------------------------------ */
/* 評価：居住用の区分所有財産（令和6年1月1日以後）                          */
/* ------------------------------------------------------------------ */

export interface CondoCorrection {
  /** 区分所有補正率（null は補正しない＝適用対象外または 0.6≦評価水準≦1） */
  rate: Q | null;
  /** 評価乖離率が0以下（評価しない＝0円） */
  zero: boolean;
  /** 評価乖離率（小数点以下3位の整数表現 ×1000） */
  divergenceE3: number | null;
  detail: string;
}
/**
 * 評価乖離率 = A + B + C + D + 3.220
 *  A = 築年数（1年未満の端数は1年）× △0.033
 *  B = 総階数指数（総階数÷33、小数点以下第4位切捨て、1が上限）× 0.239（小数点以下第4位切捨て）
 *  C = 所在階（地階は0）× 0.018
 *  D = 敷地持分狭小度（敷地利用権の面積÷専有面積、小数点以下第4位切上げ）× △1.195（小数点以下第4位切上げ）
 * 「小数点以下第4位を切り捨てる」＝小数点以下3桁を残す。D の切上げは絶対値で行う（国税庁の計算例：0.41825→△0.419）。
 * 評価水準 = 1÷評価乖離率。水準<0.6 → 乖離率×0.6、0.6≦水準≦1 → 補正なし、1<水準 → 乖離率。
 * 乖離率が0以下なら評価しない（0円）。地階を除く総階数2以下は対象外。区分所有補正率そのものは丸めない。
 */
export function condoCorrection(c: CondoItem): CondoCorrection {
  if (c.totalFloors <= 2) return { rate: null, zero: false, divergenceE3: null, detail: "総階数2以下のため区分所有補正の対象外" };
  const years = c.builtYears + (c.builtMonths > 0 ? 1 : 0);
  const A = -years * 33;
  const idx = Math.min(1000, Math.floor((c.totalFloors * 1000) / 33));
  const B = Math.floor((idx * 239) / 1000);
  const C = Math.max(0, Math.floor(c.floor)) * 18;
  const ratio = Number(qceil(qmul(qdiv(decQ(c.landShareSqm), decQ(c.exclusiveAreaSqm)), Qn(1000))));
  const D = -Math.ceil((ratio * 1195) / 1000);
  const r = A + B + C + D + 3220;
  const e3 = (v: number): string => (v / 1000).toFixed(3);
  const detail = `築${years}年 A=${e3(A)} 指数${e3(idx)} B=${e3(B)} C=${e3(C)} 狭小度${e3(ratio)} D=${e3(D)} 乖離率=${e3(r)}`;
  if (r <= 0) return { rate: null, zero: true, divergenceE3: r, detail: `${detail} → 評価しない（0円）` };
  if (r < 1000) return { rate: Qn(r, 1000), zero: false, divergenceE3: r, detail: `${detail} 水準>1 → 補正率${e3(r)}` };
  // 評価水準 < 0.6 ⇔ 0.6×乖離率 > 1
  if (6 * r > 10000) {
    const rate = Qn(r * 6, 10000);
    return { rate, zero: false, divergenceE3: r, detail: `${detail} 水準<0.6 → 補正率${qnum(rate).toFixed(4)}` };
  }
  return { rate: null, zero: false, divergenceE3: r, detail: `${detail} 0.6≦水準≦1 → 補正なし` };
}

/* ------------------------------------------------------------------ */
/* 相続税の速算表（相続税法16条）                                        */
/* ------------------------------------------------------------------ */

/** 法定相続分に応ずる取得金額（1,000円単位）に対する税額 */
export function sokusan(a: number): number {
  if (a <= 0) return 0;
  const t: [number, number, number][] = [
    [10_000_000, 10, 0],
    [30_000_000, 15, 500_000],
    [50_000_000, 20, 2_000_000],
    [100_000_000, 30, 7_000_000],
    [200_000_000, 40, 17_000_000],
    [300_000_000, 45, 27_000_000],
    [600_000_000, 50, 42_000_000],
    [Infinity, 55, 72_000_000],
  ];
  for (const [upto, rate, ded] of t) if (a <= upto) return Math.floor((a * rate) / 100) - ded;
  return 0;
}

/**
 * 相続税の総額（16条）。課税遺産総額を15条の相続人が法定相続分で取得したとして、
 * 各人の取得金額（1,000円未満切捨て）に速算表を当て、合計を100円未満切捨て。
 */
export function totalTaxFor(
  totalTaxable: number,
  basic: number,
  shares: Map<string, Q>,
): { base: number; total: number; parts: { id: string; amount: number; tax: number }[] } {
  const base = Math.max(0, totalTaxable - basic);
  const parts: { id: string; amount: number; tax: number }[] = [];
  let sum = 0;
  for (const [id, sh] of shares) {
    const amount = floor1000(yenFloor(base, sh));
    const tax = sokusan(amount);
    parts.push({ id, amount, tax });
    sum += tax;
  }
  return { base, total: floor100(sum), parts };
}

/* ------------------------------------------------------------------ */
/* 本体                                                                 */
/* ------------------------------------------------------------------ */

interface Acc {
  id: string;
  divided: number; // 分割で取得した財産（保険金等の課税分・代償金の受払いを含む）
  undivided: number; // 未分割財産のうち法定相続分相当
  insurance: number;
  insuranceExempt: number;
  retirement: number;
  retirementExempt: number;
  compRecv: number;
  compPaid: number;
  settlement: number; // ② 相続時精算課税適用財産（110万円控除後）
  debts: number; // ③ 債務・葬式費用（相続人）
  funeralRenounced: number; // 放棄者が負担した葬式費用（相基通13-1、遺贈財産から控除）
  gifts3y: number; // ⑤ の候補
  giftTax3y: number;
  settlementTax: number;
  acquired: boolean; // 相続・遺贈（みなしを含む）・精算課税で財産を取得した
  itemParts: string[];
}

interface SmallCand {
  itemId: string;
  label: string;
  kind: SmallLandKind;
  acquirer: string;
  shareArea: Q; // ③ 取得者の持分に応ずる面積
  shareValue: number; // ④ 取得者の持分に応ずる価額
  /** ⑤ に入れられる面積の上限 = min(③, その人が選んだ面積)。選んでいなければ ③ */
  cap: Q;
}
interface SmallSel {
  cand: SmallCand;
  area: Q;
  reduction: number;
}

const SMALL_LIMIT: Record<SmallLandKind, number> = { residence: 330, business: 400, rental: 200 };

/**
 * 小規模宅地等の特例の、取得した人ごとの要件（措法69条の4第3項）。満たさないときは理由、満たすときは null。
 *   1号 特定事業用：申告期限までに亡くなった方の事業を引き継ぎ、申告期限まで営み、宅地等を申告期限まで有している
 *   2号 特定居住用：配偶者は要件なし。同居していた親族（イ）は、申告期限まで引き続きその家屋に住み、宅地等を有している。
 *       同居していない親族（ロ：いわゆる家なき子）の要件はシナリオで扱わない（livedTogether=false は使えない親族とする）
 *   4号 貸付事業用：申告期限までに貸付事業を引き継ぎ、申告期限まで行い、宅地等を申告期限まで有している
 * 土地についての要件（自宅の敷地・事業や貸付に使っていた・3年以内に始めたものでない）は、シナリオで smallLand を付けた時点で満たしている
 */
export function smallPersonFails(
  kind: SmallLandKind,
  m: Pick<Member, "relation">,
  u: { livedTogether?: boolean; keep?: boolean; continues?: boolean },
): string | null {
  if (kind === "residence") {
    if (m.relation === "spouse") return null;
    if (u.livedTogether === false) return "亡くなる直前に同居していない（家なき子の要件は扱わない）";
    if (u.keep === false) return "申告期限まで住み続け・持ち続けない";
    return null;
  }
  const what = kind === "business" ? "事業" : "貸付事業";
  if (u.continues === false) return `申告期限まで${what}を引き継いで続けない`;
  if (u.keep === false) return "申告期限まで持ち続けない";
  return null;
}
const SMALL_RATE: Record<SmallLandKind, Q> = { residence: Qn(80, 100), business: Qn(80, 100), rental: Qn(50, 100) };

/**
 * q が ben の扶養義務者か（相続税法1条の2・相基通1の2-1：配偶者・直系血族・兄弟姉妹）。
 * シナリオに書いてある続柄だけで決められる人に限る。亡くなった方の配偶者は、亡くなった方の子全員の親（代襲相続人の祖先）とみなす。
 * 三親等内の親族で生計を一にする人（おじ・おば、甥姪、配偶者の親族など）は、シナリオに生計の事情がないので含めない。
 * 相続人でない受遺者（other）・いとこ・姻族も含めない。
 */
export function isSupporter(ben: Member, q: Member): boolean {
  if (q.id === ben.id || q.predeceased || q.relation === "other") return false;
  // 孫養子は亡くなった方の子（養子）として扱う
  const isChild = (m: Member): boolean => m.relation === "child" || m.relation === "adoptedChild" || !!m.grandchildAdopted;
  const isSubstDesc = (m: Member): boolean => (m.relation === "grandchild" || m.relation === "greatGrandchild") && !!m.substituteOf;
  const ascendant = (m: Member): boolean => m.relation === "parent" || m.relation === "grandparent";
  switch (isChild(ben) ? "child" : ben.relation) {
    case "child":
    case "adoptedChild":
      // 親（亡くなった方の配偶者）、兄弟姉妹（ほかの子・養子）、祖父母・曾祖父母（亡くなった方の父母・祖父母）
      return q.relation === "spouse" || isChild(q) || ascendant(q);
    case "grandchild":
    case "greatGrandchild":
      if (!ben.substituteOf) return false;
      // 祖父母（亡くなった方の配偶者）、兄弟姉妹（同じ親の代襲相続人）、亡くなった方の父母・祖父母
      return q.relation === "spouse" || q.substituteOf === ben.substituteOf || ascendant(q);
    case "spouse":
      // 子と、代襲相続人の孫・ひ孫
      return isChild(q) || isSubstDesc(q);
    case "parent":
      // 配偶者（ほかの父母）と、子（全血の兄弟姉妹）
      return q.relation === "parent" || (q.relation === "sibling" && !q.halfBlood);
    case "sibling":
      // 兄弟姉妹（どちらかが全血なら親を同じくする）、父母（本人が全血のとき）
      return (q.relation === "sibling" && (!ben.halfBlood || !q.halfBlood)) || (q.relation === "parent" && !ben.halfBlood);
    case "nephewNiece":
      return q.relation === "nephewNiece" && !!ben.substituteOf && q.substituteOf === ben.substituteOf;
    default:
      return false;
  }
}

/** 2割加算（相続税法18条）の対象か */
function surcharge20(m: Member, heirIds: Set<string>, h: HeirStructure): boolean {
  const isSubstituteHeir = !!m.substituteOf && heirIds.has(m.id);
  switch (m.relation) {
    case "spouse":
    case "parent":
      return false;
    case "child":
    case "adoptedChild":
    case "grandchild":
    case "greatGrandchild":
      // 18条2項：孫養子（被相続人の直系卑属で養子）は加算。ただし代襲相続人として相続人なら加算しない
      if (m.grandchildAdopted) return !(h.dual.includes(m.id) && heirIds.has(m.id));
      if (m.relation === "child" || m.relation === "adoptedChild") return false;
      // 18条1項かっこ書：代襲して相続人となった直系卑属は1親等の血族に含める（放棄すれば含まれない）
      return !isSubstituteHeir;
    default:
      // 祖父母（2親等）・兄弟姉妹・甥姪・その他
      return true;
  }
}

interface PersonResult {
  id: string;
  name: string;
  part1: number; // ① 取得財産の価額
  part2: number; // ② 精算課税
  part3: number; // ③ 債務等
  part4: number; // ④ 純資産価額
  part5: number; // ⑤ 暦年贈与加算
  taxable: number; // ⑥ 課税価格
  calc: number;
  add20: number;
  giftCredit: number;
  spouseRelief: number;
  minor: number;
  disabled: number;
  successive: number;
  settlementCredit: number;
  payable: number;
  refund: number;
}

export function expected(s: Scenario): Expected {
  const notes: string[] = [];
  const oos: string[] = [];
  const addOos = (r: string): void => {
    if (!oos.includes(r)) oos.push(r);
  };
  /** 同じメモを2回書かない（小規模宅地等の選び方を試すため、税額の計算は何度も行う） */
  const noteOnce = (n: string): void => {
    if (!notes.includes(n)) notes.push(n);
  };
  const ms = s.members;
  const byId = new Map(ms.map((m) => [m.id, m]));
  const nameOf = (id: string): string => byId.get(id)?.name ?? id;
  const death = s.decedent.deathDate;
  /** マンションの敷地利用権の価額（小規模宅地等で使う） */
  const condoLand = new Map<string, number>();

  /* ---------- 1. 相続人 ---------- */
  const civ = heirStructure(ms, false);
  const hyp = heirStructure(ms, true);
  const civilShares = sharesOf(civ, false); // 民法の法定相続分（未分割の課税価格・債務の按分）
  const heirIds = new Set([...civilShares.keys()].filter((id) => civilShares.get(id)!.n > 0n));
  const law16 = sharesOf(hyp, true); // 15条の相続人（放棄なし・養子制限）と16条の相続分
  const hypAll = sharesOf(hyp, false); // 15条2項の相続人（未成年者・障害者控除の判定）
  const N = law16.size;
  const basic = 30_000_000 + 6_000_000 * N;
  // 19条の2：配偶者の法定相続分（放棄がなかったものとした場合の民法900条の相続分。養子の数の制限はない）
  const spouseLegal19_2 = spouseShareOf(hyp.order, !!hyp.spouseId);
  for (const n of civ.notes) if (!notes.includes(n)) notes.push(n);
  notes.push(
    `相続人（民法）：${[...civilShares].map(([id, q]) => `${nameOf(id)} ${qstr(q)}`).join("、") || "なし"}（第${civ.order}順位）`,
  );
  notes.push(
    `法定相続人の数（15条）：${N}人 [${[...law16].map(([id, q]) => `${nameOf(id)} ${qstr(q)}`).join("、")}] 基礎控除 ${fmt(basic)}`,
  );
  if (heirIds.size === 0) addOos("相続人不存在（全員放棄または相続人がいない）");
  if (civ.dual.length > 0 || hyp.dual.length > 0) addOos("孫養子かつ代襲相続人（二重の資格）");
  if (ms.some((m) => m.unborn)) notes.push("胎児は生まれたものとして相続人に数える（民法886条、相基通15-3）");

  /* ---------- 3. 財産の評価 ---------- */
  interface ItemVal {
    item: EstateItem;
    value: number;
    area?: Q; // 小規模宅地等の面積の基になる地積
    smallOk: boolean;
    /** 賃貸割合 1 未満の貸家建付地・貸家建付借地権・賃貸中のマンションの敷地：貸している部分だけの価額（持分100%）と賃貸割合 */
    rented?: { value: number; ratio: Q };
  }
  const vals: ItemVal[] = [];
  for (const it of s.estate) {
    switch (it.type) {
      case "deposit":
      case "cash":
      case "household":
      case "other": {
        if (it.foreign) addOos("国外財産");
        vals.push({ item: it, value: Math.trunc(it.amount), smallOk: false });
        break;
      }
      case "listedStock": {
        // 評基通169：課税時期の終値・その月・前月・前々月の毎日の終値の月平均のうち最も低い価額
        const p = it.prices;
        const low = [p.close, p.monthAvg, p.prevMonthAvg, p.prev2MonthAvg].map(decQ).reduce((a, b) => qmin(a, b));
        const v = Number(qfloor(qmul(low, Qn(BigInt(Math.trunc(it.shares))))));
        vals.push({ item: it, value: v, smallOk: false });
        notes.push(`${it.label}：最低価額 ${qnum(low)}円 × ${fmt(it.shares)}株 = ${fmt(v)}`);
        break;
      }
      case "unlistedStock": {
        // 取引相場のない株式は与えられた評価額（総額）をそのまま使う
        vals.push({ item: it, value: Math.trunc(it.value), smallOk: false });
        break;
      }
      case "insurance":
      case "retirement":
        break; // 後で受取人ごとに
      case "building": {
        // 評基通89：固定資産税評価額×1.0。93：貸家は ×(1−借家権割合0.3×賃貸割合)
        let v = Math.trunc(it.fixedAssetValue);
        if (it.rented) {
          const R = ratioQ(it.rentRatio ?? 1);
          v = yenFloor(it.fixedAssetValue, qsub(ONE, qmul(Qn(3, 10), R)));
        }
        vals.push({ item: it, value: v, smallOk: false });
        notes.push(`${it.label}：${it.rented ? "貸家" : "自用家屋"} ${fmt(v)}`);
        break;
      }
      case "land": {
        if (it.foreign) addOos("国外財産");
        if (it.spouseResidenceRight) addOos("配偶者居住権");
        const vv = it.valuation;
        // 税理士に確かめた補正率があれば、不整形地（評基通20）・地積規模の大きな宅地（20-2）は計算できる（路線価方式だけ）
        const adv = it.advisorRate;
        const advisorOk =
          adv !== undefined && adv > 0 && adv <= 1 && vv.kind === "rosenka" && (it.needsReduction === "irregular" || it.needsReduction === "largeLot" || it.needsReduction === "setback");
        // 倍率方式の宅地は 固定資産税評価額 × 倍率（評基通21-2）。形（不整形・間口狭小など）は固定資産税評価額に入っているので、
        // 不整形地でも重ねて補正しない（ふつうに計算できる）。セットバック・地積規模の大きな宅地（21-2 ただし書）・宅地以外は従来どおり
        const shapeInFav = it.needsReduction === "irregular" && vv.kind === "multiplier" && it.landUse === "宅地";
        // 不整形地・セットバック・地積規模の大きな宅地の補正は減額しかないので、本人が相談しないと選べば
        // 減額しない（高めの）評価額で申告する（相続コンパスの方針。過少にはならない）
        const reductionAsIs = !!it.needsReduction && !advisorOk && !shapeInFav;
        if (reductionAsIs) notes.push(`${it.label}：${{ irregular: "不整形地", setback: "セットバック", largeLot: "地積規模の大きな宅地" }[it.needsReduction!]}の減額はしない（本人が相談しないと選んだ評価額。高めになる）`);
        if (shapeInFav) notes.push(`${it.label}：倍率方式の宅地なので、形がいびつでも 固定資産税評価額×倍率 のまま（評基通21-2）`);
        let selfUse = 0;
        let lease: Q | null = null;
        const area = decQ(it.areaSqm);
        if (vv.kind === "rosenka") {
          if (it.landUse === "田" || it.landUse === "畑" || it.landUse === "山林")
            addOos("市街地農地・山林等（宅地比準方式・造成費の控除が必要）");
          // 付表5（注）3：不整形地補正率（間口狭小補正率を掛けた後の率）は間口狭小×奥行長大を超えない。税理士の率が 1（減額なし）なら
          // かげ地が小さく表の率が 1.00 か不整形地に当たらないということなので、間口狭小・奥行長大（20-4）はふつうに掛ける。1 未満のときだけ 20-4 を重ねない
          const irregular = advisorOk && adv! < 1 && it.needsReduction === "irregular";
          const r = rosenkaUnitPrice(vv.district, vv.roads, { skipFrontage: irregular });
          let unit = r.unit;
          if (advisorOk) {
            // F 欄（不整形地：D 欄 × 不整形地補正率）・G 欄（地積規模：A〜F 欄 × 規模格差補正率）。円未満切捨て
            unit = yenFloor(r.unit, decQ(adv!));
            r.steps.push(`${it.needsReduction === "irregular" ? "不整形地補正率" : it.needsReduction === "setback" ? "セットバックの補正率" : "規模格差補正率"} ${adv}（税理士に確認）：${fmt(r.unit)}→${fmt(unit)}`);
          }
          selfUse = Number(qfloor(qmul(Qn(unit), area)));
          lease = Qn(LEASE_BY_LETTER[r.front.leaseLetter], 100);
          notes.push(`${it.label}：${r.steps.join("、")} → 1㎡ ${fmt(unit)} × ${it.areaSqm}㎡ = ${fmt(selfUse)}`);
        } else {
          // 評基通21-2：固定資産税評価額 × 倍率
          selfUse = yenFloor(vv.fixedAssetValue, decQ(vv.rate));
          lease = vv.leaseRatio !== undefined ? ratioQ(vv.leaseRatio) : null;
          notes.push(`${it.label}：倍率 ${fmt(vv.fixedAssetValue)}×${vv.rate} = ${fmt(selfUse)}`);
        }
        let v = selfUse;
        const needLease = it.use === "rentedHouse" || it.use === "leasedLand" || it.use === "leasehold" || it.use === "rentedLeasehold";
        if (needLease && lease === null) {
          notes.push(`${it.label}：借地権割合が分からない（0として計算）`);
          lease = ZERO;
        }
        const L = lease ?? ZERO;
        const R = ratioQ(it.rentRatio ?? 1);
        const L3 = qmul(L, Qn(3, 10)); // 借地権割合 × 借家権割合0.3
        let rented: ItemVal["rented"];
        if (it.use === "rentedHouse") {
          // 評基通26：貸家建付地 = 自用地 × (1 − 借地権割合 × 借家権割合0.3 × 賃貸割合)
          v = yenFloor(selfUse, qsub(ONE, qmul(L3, R)));
          // 空室がある（賃貸割合<1）とき、貸している部分 = 自用地 × 賃貸割合 × (1 − 借地権割合 × 0.3)。空室の部分は自用地（情報 平成22.7.13 06）
          if (qcmp(R, ONE) < 0) rented = { value: yenFloor(selfUse, R, qsub(ONE, L3)), ratio: R };
        } else if (it.use === "leasedLand") {
          // 評基通25：貸宅地 = 自用地 × (1 − 借地権割合)
          v = yenFloor(selfUse, qsub(ONE, L));
        } else if (it.use === "leasehold") {
          // 評基通27：借地権 = 自用地 × 借地権割合
          v = yenFloor(selfUse, L);
        } else if (it.use === "rentedLeasehold") {
          // 評基通28：貸家建付借地権 = 自用地 × 借地権割合 × (1 − 借家権割合0.3 × 賃貸割合)
          v = yenFloor(selfUse, L, qsub(ONE, qmul(Qn(3, 10), R)));
          // 空室があるとき、貸している部分 = 自用地 × 借地権割合 × 賃貸割合 × 0.7（空室の部分は借地権のまま）
          if (qcmp(R, ONE) < 0) rented = { value: yenFloor(selfUse, L, R, Qn(7, 10)), ratio: R };
        }
        if (v !== selfUse) notes.push(`${it.label}：${it.use} → ${fmt(v)}（借地権割合 ${qstr(L)}${qcmp(R, ONE) < 0 ? `・賃貸割合 ${qstr(R)}` : ""}）`);
        if (rented) notes.push(`${it.label}：貸している部分の価額 ${fmt(rented.value)}（空室の部分 ${fmt(v - rented.value)}）`);
        // 小規模宅地等の対象になる「宅地等」：建物・構築物の敷地。青空駐車場や田畑山林は対象外
        const smallOk =
          (it.landUse === "宅地" || it.landUse === "雑種地") && it.use !== "parking" && !it.foreign && !it.spouseResidenceRight;
        if (it.smallLand && !smallOk) notes.push(`${it.label}：小規模宅地等の対象にならない土地（青空駐車場・田畑山林等）`);
        vals.push({ item: it, value: v, area, smallOk, rented });
        break;
      }
      case "condo": {
        const c = it as CondoExt;
        const cc = condoCorrection(c);
        let bld = Math.trunc(c.buildingFixedAssetValue);
        let land = Math.trunc(c.landValue);
        if (cc.zero) {
          bld = 0;
          land = 0;
        } else if (cc.rate) {
          bld = yenFloor(bld, cc.rate);
          land = yenFloor(land, cc.rate);
        }
        let rented: ItemVal["rented"];
        if (c.rented) {
          const R = ratioQ(c.rentRatio ?? 1);
          let L: Q;
          if (c.leaseRatio !== undefined) L = ratioQ(c.leaseRatio);
          else if (c.leaseLetter) L = Qn(LEASE_BY_LETTER[c.leaseLetter], 100);
          else {
            L = decQ(CONDO_DEFAULT_LEASE);
            notes.push(`${c.label}：借地権割合の記載がないため ${CONDO_DEFAULT_LEASE} とした`);
          }
          bld = yenFloor(bld, qsub(ONE, qmul(Qn(3, 10), R)));
          const L3 = qmul(L, Qn(3, 10));
          // 空室がある（賃貸割合<1）とき、敷地のうち貸している部分 = 区分所有補正後の敷地利用権 × 賃貸割合 × (1 − 借地権割合 × 0.3)
          if (qcmp(R, ONE) < 0) rented = { value: yenFloor(land, R, qsub(ONE, L3)), ratio: R };
          land = yenFloor(land, qsub(ONE, qmul(L3, R)));
        }
        const v = bld + land;
        notes.push(`${c.label}：${cc.detail}；建物 ${fmt(bld)} 敷地 ${fmt(land)}${c.rented ? "（貸付）" : ""}`);
        if (rented) notes.push(`${c.label}：敷地のうち貸している部分の価額 ${fmt(rented.value)}`);
        // 小規模宅地等は敷地利用権の部分だけ。面積は敷地利用権の面積
        vals.push({ item: it, value: v, area: decQ(c.landShareSqm), smallOk: true, rented });
        // 敷地の価額を後で使うため、value とは別に保存
        condoLand.set(it.id, land);
        break;
      }
    }
  }

  /* ---------- 4. 分け方（分割・未分割） ---------- */
  const accs = new Map<string, Acc>();
  const acc = (id: string): Acc => {
    let a = accs.get(id);
    if (!a) {
      a = {
        id,
        divided: 0,
        undivided: 0,
        insurance: 0,
        insuranceExempt: 0,
        retirement: 0,
        retirementExempt: 0,
        compRecv: 0,
        compPaid: 0,
        settlement: 0,
        debts: 0,
        funeralRenounced: 0,
        gifts3y: 0,
        giftTax3y: 0,
        settlementTax: 0,
        acquired: false,
        itemParts: [],
      };
      accs.set(id, a);
    }
    return a;
  };
  const validPerson = (id: string): boolean => {
    const m = byId.get(id);
    return !!m && !m.predeceased;
  };
  const legalParts = (): { who: string; f: Q; undiv: boolean }[] =>
    [...civilShares].filter(([, q]) => q.n > 0n).map(([who, f]) => ({ who, f, undiv: true }));

  /** 価額を割合で分ける。各人円未満切捨て、端数は最も割合の大きい人に寄せる */
  const splitValue = (
    value: number,
    parts: { who: string; f: Q; undiv: boolean }[],
  ): { who: string; amt: number; undiv: boolean; f: Q }[] => {
    const res = parts.map((p) => ({ who: p.who, amt: yenFloor(value, p.f), undiv: p.undiv, f: p.f }));
    const rest = value - res.reduce((a, r) => a + r.amt, 0);
    if (res.length > 0 && rest !== 0) {
      let best = 0;
      for (let i = 1; i < res.length; i++) if (qcmp(res[i].f, res[best].f) > 0) best = i;
      res[best].amt += rest;
    }
    return res;
  };

  const agreed = s.division.kind === "agreed" ? s.division : null;
  /** 小規模宅地等の判定用：財産ごとの取得者の持分 */
  const itemShare = new Map<string, Map<string, Q>>();
  let anyUndivided = false;
  // 財産ごとに、分割で決まった持分（decided）と未分割の割合（rest）を決める
  const plans: { v: ItemVal; decided: { who: string; f: Q; undiv: boolean }[]; rest: Q }[] = [];
  for (const v of vals) {
    const it = v.item;
    let decided: { who: string; f: Q; undiv: boolean }[] = [];
    let rest = ONE;
    const listed = agreed?.shares[it.id] ?? [];
    if (agreed && listed.length > 0) {
      let sum = ZERO;
      for (const e of listed) {
        if (!validPerson(e.who)) {
          notes.push(`${it.label}：取得者 ${e.who} が存在しないか先に死亡している（無視）`);
          continue;
        }
        if (byId.get(e.who)?.renounced) notes.push(`${it.label}：放棄した${nameOf(e.who)}が取得（遺贈によるものとして扱う）`);
        const f = Qn(BigInt(Math.trunc(e.n)), BigInt(Math.trunc(e.d)));
        decided.push({ who: e.who, f, undiv: false });
        sum = qadd(sum, f);
      }
      if (qcmp(sum, ONE) > 0) {
        notes.push(`${it.label}：取得割合の合計が1を超える（${qstr(sum)}）ので按分し直した`);
        decided = decided.map((p) => ({ ...p, f: qdiv(p.f, sum) }));
        sum = ONE;
      }
      rest = qsub(ONE, sum);
      if (qcmp(rest, ZERO) > 0) notes.push(`${it.label}：${qstr(rest)} が未分割`);
      const m = new Map<string, Q>();
      for (const p of decided) m.set(p.who, qadd(m.get(p.who) ?? ZERO, p.f));
      itemShare.set(it.id, m);
    } else if (agreed) notes.push(`${it.label}：分け方の記載がない（未分割）`);
    plans.push({ v, decided, rest });
  }
  // 代償金（相基通11の2-9・11の2-10）。課税価格に入れる額を先に決める（穴埋め方式の「分割で取得した額」にも入れるため）
  const comps: { from: string; to: string; amt: number }[] = [];
  if (agreed?.compensation) {
    for (const c of agreed.compensation) {
      if (!validPerson(c.from) || !validPerson(c.to)) {
        notes.push(`代償金 ${c.from}→${c.to}：当事者が見つからない（無視）`);
        continue;
      }
      // 代償金を払う人が分割で遺産を何も取得していなければ、代償分割として扱えない（贈与などの検討が要る）
      const payerGot = [...itemShare.values()].some((m) => (m.get(c.from)?.n ?? 0n) > 0n);
      if (!payerGot) addOos("代償金を払う人が分割で遺産を取得していない");
      let amt = Math.trunc(c.amount);
      if (c.basis) {
        // 相基通11の2-10(2)：代償金の額を特定の財産の時価をもとに決めたとき、代償金 × その財産の相続税評価額 ÷ 時価（円未満切捨て）
        const bv = vals.find((x) => x.item.id === c.basis!.item);
        if (bv && c.basis.marketValue > 0) {
          amt = yenFloor(c.amount, Qn(bv.value, Math.trunc(c.basis.marketValue)));
          notes.push(`代償金 ${fmt(c.amount)}：${bv.item.label}の時価 ${fmt(c.basis.marketValue)} をもとに決めたので × 評価額 ${fmt(bv.value)} ÷ 時価 = ${fmt(amt)}`);
        } else notes.push(`代償金 ${c.from}→${c.to}：もとにした財産 ${c.basis.item} が見つからない（額面で計算）`);
      }
      comps.push({ from: c.from, to: c.to, amt });
    }
  }
  // 未分割の部分の分け方（相続税法55条：民法の相続分。寄与分を除き、特別受益（民法903条）は入れる）。
  //   T = 分割の対象になる財産（小規模宅地等の前の価額）の合計、L = 民法の法定相続分、
  //   G = 相続人が亡くなった方から受けた相続時精算課税の贈与（婚姻・養子縁組・生計の資本の贈与＝特別受益とする。贈与の額そのもの。
  //       質疑応答事例「未分割の場合の課税価格（相続時精算課税適用財産がある場合）」）。暦年課税の贈与は入れない、
  //   D = 各人が分割で取得した価額（代償金は払った人から引き、受け取った人に足す：相基通11の2-9）＋ G。
  //   不足額 = (T + ΣG) × L − D（0未満は0）。未分割の部分は不足額の割合で分ける（一部だけ分けたときは穴埋め方式）。
  //   何も分けておらず贈与もなければ法定相続分と同じ
  const memberIdx = new Map(ms.map((m, i) => [m.id, i]));
  const heirOrder = [...civilShares].filter(([, q]) => q.n > 0n).sort((a, b) => memberIdx.get(a[0])! - memberIdx.get(b[0])!);
  const civilHeir = new Set(heirOrder.map(([who]) => who));
  let undivWeights: { who: string; w: Q }[] = heirOrder.map(([who, q]) => ({ who, w: q }));
  const special903 = new Map<string, number>();
  for (const g of s.gifts) {
    if (!g.settlement || !civilHeir.has(g.to) || !validPerson(g.to) || g.date > death) continue;
    special903.set(g.to, (special903.get(g.to) ?? 0) + Math.trunc(g.amount));
  }
  const anyDecided = plans.some((p) => p.decided.length > 0);
  if (plans.some((p) => qcmp(p.rest, ZERO) > 0) && (anyDecided || special903.size > 0)) {
    const T = plans.reduce((x, p) => x + p.v.value, 0);
    const G = [...special903.values()].reduce((x, g) => x + g, 0);
    const D = new Map<string, Q>();
    const addD = (who: string, q: Q): void => {
      D.set(who, qadd(D.get(who) ?? ZERO, q));
    };
    for (const p of plans) for (const d of p.decided) addD(d.who, qmul(Qn(p.v.value), d.f));
    for (const c of comps) {
      addD(c.from, Qn(-c.amt));
      addD(c.to, Qn(c.amt));
    }
    for (const [who, g] of special903) addD(who, Qn(g));
    const ws = heirOrder.map(([who, q]) => {
      const e = qsub(qmul(Qn(T + G), q), D.get(who) ?? ZERO);
      return { who, w: qcmp(e, ZERO) > 0 ? e : ZERO };
    });
    const sw = ws.reduce((x, w) => qadd(x, w.w), ZERO);
    if (sw.n > 0n) {
      undivWeights = ws.filter((w) => w.w.n > 0n).map((w) => ({ who: w.who, w: qdiv(w.w, sw) }));
      const giftNote = G > 0 ? `、特別受益（精算課税の贈与）${[...special903].map(([who, g]) => `${nameOf(who)} ${fmt(g)}`).join("・")}を足した ${fmt(T + G)} で計算` : "";
      const compNote = comps.length > 0 && anyDecided ? "、代償金は分割で取得した額に含めた" : "";
      notes.push(
        `${anyDecided ? "一部未分割（穴埋め方式）" : "未分割"}：分割対象の合計 ${fmt(T)}${giftNote}${compNote}、未分割の部分の割合 ${undivWeights.map((w) => `${nameOf(w.who)} ${qstr(w.w)}`).join("、")}`,
      );
    }
  }
  for (const { v, decided, rest } of plans) {
    const it = v.item;
    const parts = [...decided];
    if (qcmp(rest, ZERO) > 0) for (const w of undivWeights) parts.push({ who: w.who, f: qmul(rest, w.w), undiv: true });
    if (parts.some((p) => p.undiv)) anyUndivided = true;
    for (const r of splitValue(v.value, parts)) {
      const a = acc(r.who);
      if (r.undiv) a.undivided += r.amt;
      else a.divided += r.amt;
      if (qcmp(r.f, ZERO) > 0) a.acquired = true;
      a.itemParts.push(`${it.label}${r.undiv ? "(未分割)" : ""} ${fmt(r.amt)}`);
    }
  }

  /* ---------- 5. 生命保険金・退職手当金（3条1項1号・2号、12条1項5号・6号） ---------- */
  for (const it of s.estate) {
    if (it.type !== "insurance" && it.type !== "retirement") continue;
    if (!validPerson(it.recipient)) {
      // 受取人が被相続人本人などのときは本来の相続財産として法定相続分で按分
      notes.push(`${it.label}：受取人 ${it.recipient} が相続人等にいないため本来の財産として法定相続分で按分`);
      anyUndivided = true;
      for (const r of splitValue(it.amount, legalParts())) {
        const a = acc(r.who);
        a.undivided += r.amt;
        a.acquired = true;
      }
      continue;
    }
    const a = acc(it.recipient);
    a.acquired = true;
    if (it.type === "insurance") a.insurance += Math.trunc(it.amount);
    else a.retirement += Math.trunc(it.amount);
  }
  {
    const limit = 5_000_000 * N;
    for (const kind of ["insurance", "retirement"] as const) {
      const heirsRecv = [...accs.values()].filter((a) => heirIds.has(a.id) && a[kind] > 0);
      const tot = heirsRecv.reduce((x, a) => x + a[kind], 0);
      if (tot === 0) continue;
      // 非課税金額 = 限度額 × その相続人の受取額 / 相続人全員の受取額。
      // 円未満を切り捨てて合計が限度額に足りない分は、端数の大きい人（同じならIDの順）から1円ずつ足し、合計をちょうど限度額にする
      const exact = heirsRecv.map((a) => {
        const num = BigInt(limit) * BigInt(a[kind]);
        const fl = num / BigInt(tot);
        return { a, ex: tot <= limit ? a[kind] : Number(fl), rem: num - fl * BigInt(tot) };
      });
      if (tot > limit) {
        let short = limit - exact.reduce((x, e) => x + e.ex, 0);
        for (const e of [...exact].sort((x, y) => (y.rem > x.rem ? 1 : y.rem < x.rem ? -1 : x.a.id < y.a.id ? -1 : x.a.id > y.a.id ? 1 : 0))) {
          if (short <= 0) break;
          e.ex += 1;
          short -= 1;
        }
      }
      for (const { a, ex } of exact) {
        if (kind === "insurance") a.insuranceExempt = ex;
        else a.retirementExempt = ex;
      }
      notes.push(
        `${kind === "insurance" ? "生命保険金" : "退職手当金"}：相続人の受取 ${fmt(tot)}、非課税限度 ${fmt(limit)}（相続人でない人・放棄した人は非課税なし）`,
      );
    }
    for (const a of accs.values()) {
      a.divided += a.insurance - a.insuranceExempt + (a.retirement - a.retirementExempt);
    }
  }

  /* ---------- 6. 代償分割（相基通11の2-9・11の2-10。額は 4. で決めた） ---------- */
  if (comps.length > 0) {
    for (const c of comps) {
      acc(c.from).compPaid += c.amt;
      const r = acc(c.to);
      r.compRecv += c.amt;
      r.acquired = true;
      notes.push(`代償金：${nameOf(c.from)}→${nameOf(c.to)} ${fmt(c.amt)}`);
    }
    for (const a of accs.values()) a.divided += a.compRecv - a.compPaid;
  }

  /* ---------- 7. 生前贈与 ---------- */
  // 令和8年中の相続では、暦年課税の加算期間は「相続開始の日の3年前の同じ日」以後
  // （令和5年改正附則：令和6年1月1日以後の贈与は7年。令和8年の相続では3年前の日が令和5年中なので3年と同じ）
  const windowStart = yearsBefore(death, 3);
  const settleByYear = new Map<string, number>();
  /** 暦年課税の贈与を受贈者・年ごとに集計（19条の贈与税額控除の按分に使う） */
  const calByYear = new Map<string, { total: number; tax: number; added: number }>();
  for (const g of s.gifts) {
    if (!validPerson(g.to)) {
      notes.push(`贈与 ${g.to}：受贈者が見つからない（無視）`);
      continue;
    }
    if (g.date > death) {
      notes.push(`贈与 ${g.date}：相続開始後の日付（無視）`);
      continue;
    }
    if (g.settlement) {
      const key = `${g.to}|${g.date.slice(0, 4)}`;
      settleByYear.set(key, (settleByYear.get(key) ?? 0) + Math.trunc(g.amount));
      acc(g.to).settlementTax += Math.trunc(g.giftTaxPaid);
    } else {
      const key = `${g.to}|${g.date.slice(0, 4)}`;
      const y = calByYear.get(key) ?? { total: 0, tax: 0, added: 0 };
      y.total += Math.trunc(g.amount);
      y.tax += Math.trunc(g.giftTaxPaid);
      if (g.date >= windowStart) {
        y.added += Math.trunc(g.amount);
        acc(g.to).gifts3y += Math.trunc(g.amount);
      }
      calByYear.set(key, y);
    }
  }
  // 19条：控除する贈与税額 = その年分の贈与税額 × 加算した贈与の価額 / その年分の贈与税の課税価格（円未満切捨て）
  // （亡くなった方以外からの贈与はないものとする）
  for (const [key, y] of calByYear) {
    if (y.added === 0 || y.tax === 0 || y.total === 0) continue;
    acc(key.split("|")[0]).giftTax3y += yenFloor(y.tax, Qn(y.added, y.total));
  }
  for (const [key, amt] of settleByYear) {
    const [who, y] = key.split("|");
    // 21条の15：精算課税の贈与財産を加算。令和6年以後の贈与は年110万円の基礎控除後の額（21条の11の2）
    const add = Number(y) >= 2024 ? Math.max(0, amt - 1_100_000) : amt;
    const a = acc(who);
    a.settlement += add;
    a.acquired = true; // 21条の16：相続等で取得しなかった精算課税適用者も取得したものとみなす
  }
  for (const a of accs.values()) {
    if (!a.acquired && a.gifts3y > 0) {
      notes.push(`${nameOf(a.id)}：相続・遺贈で取得していないので3年以内の贈与は加算しない`);
      a.gifts3y = 0;
      a.giftTax3y = 0;
    }
  }

  /* ---------- 8. 債務・葬式費用（13条） ---------- */
  for (const d of s.debts) {
    const isFuneral = d.kind === "funeral";
    const byLegal = (s.division.kind === "undivided" && !isFuneral) || d.bearers.length === 0;
    if (byLegal) {
      // 未分割の債務は法定相続分で負担したものとする（相基通13-3）
      for (const r of splitValue(Math.trunc(d.amount), legalParts())) acc(r.who).debts += r.amt;
      continue;
    }
    for (const b of d.bearers) {
      const m = byId.get(b.who);
      if (!m || m.predeceased) {
        notes.push(`${d.label}：負担者 ${b.who} が見つからない（控除しない）`);
        continue;
      }
      if (heirIds.has(b.who)) acc(b.who).debts += Math.trunc(b.amount);
      else if (isFuneral && m.renounced) {
        // 相基通13-1：放棄した人が現実に負担した葬式費用は、遺贈財産の価額から控除してよい
        acc(b.who).funeralRenounced += Math.trunc(b.amount);
      } else notes.push(`${d.label}：${m.name}は相続人でないので${isFuneral ? "葬式費用" : "債務"}を控除できない`);
    }
  }

  /* ---------- 範囲外の判定（相続人・取得者について） ---------- */
  for (const m of ms) {
    if (m.predeceased) continue;
    if (!heirIds.has(m.id) && !accs.get(m.id)?.acquired) continue;
    if (m.nonResident) addOos("日本に住所がない相続人・受遺者（制限納税義務者等）");
    if (m.diedAfter) addOos("数次相続（申告前に相続人が死亡）");
  }

  /* ---------- 9. 小規模宅地等の候補（措法69条の4） ---------- */
  // 候補は（土地, 取得者）の組ごと（付表1の1行ずつ）。1つの宅地を何人かで取得したときは、取得者ごとにその人の要件を見て、
  // その人の持分に応ずる部分だけが対象（措法69条の4第3項「…親族が相続又は遺贈により取得した持分の割合に応ずる部分に限る」、
  // タックスアンサー No.4124）。土地の要件（自宅の敷地・事業や貸付に使っていた）は土地ごと、人の要件は人ごと
  const cands: SmallCand[] = [];
  for (const v of vals) {
    const it = v.item;
    if (it.type !== "land" && it.type !== "condo") continue;
    const sl = it.smallLand;
    if (!sl || !v.smallOk || !v.area) continue;
    if (!agreed) {
      notes.push(`${it.label}：未分割のため小規模宅地等の特例は使えない（措法69条の4第4項、分割見込書で後から適用可）`);
      continue;
    }
    const users = [sl, ...(sl.others ?? [])];
    const several = users.length > 1;
    const seenUser = new Set<string>();
    for (const u of users) {
      const who = several ? `${it.label}（${nameOf(u.acquirer)}の分）` : it.label;
      if (seenUser.has(u.acquirer)) {
        notes.push(`${who}：同じ人が2回書かれている（1回分だけ）`);
        continue;
      }
      seenUser.add(u.acquirer);
      const m = byId.get(u.acquirer);
      if (!m || m.predeceased || m.relation === "other") {
        notes.push(`${who}：取得者が被相続人の親族でないため小規模宅地等の特例は使えない`);
        continue;
      }
      // 分割で取得した持分だけ（未分割の残りは特例の対象にならない。措法69条の4第4項）
      const f = itemShare.get(it.id)?.get(u.acquirer);
      if (!f || f.n === 0n) {
        notes.push(`${who}：小規模宅地等の取得者がこの土地を（分割で）取得していない`);
        continue;
      }
      const why = smallPersonFails(sl.kind, m, u);
      if (why) {
        notes.push(`${who}：${why}ので、この人の持分には小規模宅地等の特例を使えない`);
        continue;
      }
      const landValue = it.type === "condo" ? (condoLand.get(it.id) ?? 0) : v.value;
      let shareValue = yenFloor(landValue, f);
      let shareArea = qmul(v.area, f);
      // 貸付事業用で空室がある（賃貸割合<1）とき：貸付事業に使っている部分だけが対象（措通69の4-24の2。一時的な空室は賃貸割合に含めて入力する）。
      // 対象の価額 = 貸している部分の価額（自用地 × 賃貸割合 × (1 − 借地権割合 × 0.3) など）× 持分（円未満切捨て）、
      // 対象の面積 = 持分の面積 × 賃貸割合（0.01㎡未満切捨て）。空室の部分は自用地（借地権）のまま特例の外（情報 平成22.7.13 06）
      if (sl.kind === "rental" && v.rented) {
        const rentedArea = Qn(qfloor(qmul(qmul(shareArea, v.rented.ratio), Qn(100))), 100);
        shareValue = yenFloor(v.rented.value, f);
        notes.push(`${who}：貸付事業用は貸している部分（賃貸割合 ${qstr(v.rented.ratio)}）の ${qnum(rentedArea)}㎡・${fmt(shareValue)}円だけ`);
        shareArea = rentedArea;
      }
      // 付表1 ⑤ 選択特例対象宅地等の面積 ≦ ③。その人が特例を使う面積を決めていれば、⑤ はその面積まで
      let cap = shareArea;
      if (u.selectedSqm !== undefined) {
        const chosen = decQ(u.selectedSqm);
        if (qcmp(chosen, ZERO) <= 0) {
          notes.push(`${who}：特例を使う面積が0以下（使わない）`);
          continue;
        }
        if (qcmp(chosen, shareArea) < 0) {
          cap = chosen;
          notes.push(`${who}：特例を使う面積は ${u.selectedSqm}㎡まで（持分に応ずる面積 ${qnum(shareArea)}㎡のうち）`);
        }
      }
      cands.push({ itemId: it.id, label: who, kind: sl.kind, acquirer: u.acquirer, shareArea, shareValue, cap });
    }
  }

  /* ---------- 10. 課税価格と税額 ---------- */
  const order = ms.map((m) => m.id);
  const spouseM = ms.find((m) => m.relation === "spouse" && !m.predeceased);

  const evaluate = (
    sels: SmallSel[],
  ): {
    persons: PersonResult[];
    total: number;
    totalTaxable: number;
    net: number;
    reduction: number;
    taxParts: ReturnType<typeof totalTaxFor>;
    transferred: number;
  } => {
    const red = new Map<string, number>();
    for (const x of sels) red.set(x.cand.acquirer, (red.get(x.cand.acquirer) ?? 0) + x.reduction);
    const persons: PersonResult[] = [];
    const ids = order.filter((id) => validPerson(id) && (heirIds.has(id) || accs.get(id)?.acquired));
    const spouseForm = { part1: 0, debts: 0, undiv: 0, gifts: 0 };
    for (const id of ids) {
      const a = acc(id);
      const p1 = a.divided - (red.get(id) ?? 0) + a.undivided;
      const p2 = a.settlement;
      // 放棄者の葬式費用は遺贈財産（①）の範囲で控除
      const p3 = a.debts + Math.min(a.funeralRenounced, Math.max(0, p1));
      const p4 = Math.max(0, p1 + p2 - p3); // 赤字のときは0
      const p5 = a.acquired ? a.gifts3y : 0;
      const taxable = floor1000(p4 + p5); // 1,000円未満切捨て
      if (spouseM && id === spouseM.id) {
        spouseForm.part1 = a.divided - (red.get(id) ?? 0) + a.settlement;
        spouseForm.debts = p3;
        spouseForm.undiv = a.undivided;
        spouseForm.gifts = p5;
      }
      persons.push({
        id,
        name: nameOf(id),
        part1: p1,
        part2: p2,
        part3: p3,
        part4: p4,
        part5: p5,
        taxable,
        calc: 0,
        add20: 0,
        giftCredit: 0,
        spouseRelief: 0,
        minor: 0,
        disabled: 0,
        successive: 0,
        settlementCredit: 0,
        payable: 0,
        refund: 0,
      });
    }
    const totalTaxable = persons.reduce((x, p) => x + p.taxable, 0);
    const tt = totalTaxFor(totalTaxable, basic, law16);
    const T = tt.total;
    // 17条：相続税の総額 × 各人の課税価格 / 課税価格の合計（按分割合は分数のまま、円未満切捨て）
    const rem = new Map<string, number>();
    for (const p of persons) {
      p.calc = totalTaxable > 0 ? Number((BigInt(T) * BigInt(p.taxable)) / BigInt(totalTaxable)) : 0;
      const m = byId.get(p.id)!;
      p.add20 = surcharge20(m, heirIds, civ) ? Math.floor(p.calc / 5) : 0; // 18条：2割加算（円未満切捨て）
      let t = p.calc + p.add20;
      // 19条：暦年課税分の贈与税額控除（加算された贈与に係る贈与税額。算出税額が限度）
      p.giftCredit = p.part5 > 0 ? Math.min(accs.get(p.id)?.giftTax3y ?? 0, t) : 0;
      t -= p.giftCredit;
      rem.set(p.id, t);
    }
    // 19条の2：配偶者の税額軽減（第5表）
    if (spouseM && rem.has(spouseM.id) && totalTaxable > 0) {
      const sp = persons.find((p) => p.id === spouseM.id)!;
      const legalAmt = yenFloor(totalTaxable, spouseLegal19_2); // 課税価格の合計 × 法定相続分（円未満切捨て）
      const cap = Math.max(160_000_000, legalAmt);
      const f4 = Math.max(0, spouseForm.debts - spouseForm.undiv); // ④ = ② − ③（③>②なら0）
      const f6 = floor1000(Math.max(spouseForm.part1 - f4 + spouseForm.gifts, spouseForm.gifts)); // ⑥（1,000円未満切捨て）
      const f8 = Math.min(f6, cap);
      const f10 = Number((BigInt(T) * BigInt(f8)) / BigInt(totalTaxable));
      sp.spouseRelief = Math.min(f10, rem.get(sp.id)!);
      rem.set(sp.id, rem.get(sp.id)! - sp.spouseRelief);
    }
    // 19条の3・19条の4：未成年者控除・障害者控除（15条2項の相続人で、財産を取得した人）
    let transferred = 0;
    const transferExcess = (excess: number, from: string, field: "minor" | "disabled"): void => {
      // 控除しきれない分は扶養義務者の相続税額から控除（施行令4条の3 等：協議がなければ相続税額の比で按分）。
      // 扶養義務者は、その人の配偶者・直系血族・兄弟姉妹（相基通1の2-1）。生計を一にする三親等内の親族などは数えない
      const ben = byId.get(from)!;
      const pool = persons.filter((q) => q.id !== from && isSupporter(ben, byId.get(q.id)!) && (rem.get(q.id) ?? 0) > 0);
      if (excess <= 0 || pool.length === 0) return;
      const sum = pool.reduce((x, q) => x + rem.get(q.id)!, 0);
      transferred += Math.min(sum, excess);
      if (sum <= excess) {
        for (const q of pool) {
          q[field] += rem.get(q.id)!;
          rem.set(q.id, 0);
        }
        return;
      }
      let given = 0;
      const shares = pool.map((q) => {
        const g = Math.floor((excess * rem.get(q.id)!) / sum);
        given += g;
        // 切り捨てた端数（按分の余り）
        return { q, g, cut: (excess * rem.get(q.id)!) % sum };
      });
      // 切捨てで残った1円ずつは、按分の端数が大きい人から（最大剰余。同じなら一覧の順）
      let left = excess - given;
      for (const x of [...shares].sort((a, b) => b.cut - a.cut)) {
        if (left > 0 && rem.get(x.q.id)! - x.g > 0) {
          x.g += 1;
          left--;
        }
      }
      for (const x of shares) {
        x.q[field] += x.g;
        rem.set(x.q.id, rem.get(x.q.id)! - x.g);
      }
    };
    for (const field of ["minor", "disabled"] as const) {
      const excesses: { from: string; amt: number }[] = [];
      for (const p of persons) {
        const m = byId.get(p.id)!;
        if (!hypAll.has(p.id) || !accs.get(p.id)?.acquired) continue;
        const age = m.unborn ? 0 : ageAt(m.birthDate, death);
        let amt = 0;
        if (field === "minor" && age < 18) {
          amt = 100_000 * (18 - age);
          // 19条の3第3項：前の相続でも控除を受けたときは、最初の相続のときの控除額 − すでに控除を受けた額 まで。
          // 最初の相続のときの控除額は、今回の相続が令和4年4月1日以後なら、そのときの年齢から18歳までの年数×10万円（相基通19の3-5（注））
          const pc = m.priorMinorCredit;
          if (pc) {
            const first = 100_000 * Math.max(0, 18 - ageAt(m.birthDate, pc.date));
            const cap = Math.max(0, first - Math.trunc(pc.amount));
            if (cap < amt) noteOnce(`${m.name}：前の相続でも未成年者控除を受けた（最初 ${fmt(first)} − 控除済み ${fmt(pc.amount)}）→ ${fmt(cap)} まで`);
            amt = Math.min(amt, cap);
          }
        }
        if (field === "disabled" && m.disability && age < 85) {
          const per = m.disability === "special" ? 200_000 : 100_000;
          amt = per * (85 - age);
          // 19条の4第3項（19条の3第3項の準用）：今回の控除額は 限度額 F − すでに控除を受けた額 A を超えない。
          //   X＝最初の相続のときの年齢、Y＝今回の相続のときの年齢。F は最初の相続のときの区分で決まる：
          //   ・一般障害者だった人が今は特別障害者：F = 20万×(85−Y) + 10万×(Y−X)（相基通19の4-4）
          //   ・特別障害者だった：F = 20万×(85−X)（最初の相続のときに受けられた額）
          //   ・今と同じ区分（special の記載なしを含む）：F = 今の区分の額×(85−X)
          //   A > F は入力の矛盾（前の相続の区分か控除額が違う）なので計算しない
          const pc = m.priorDisabilityCredit;
          if (pc) {
            const X = ageAt(m.birthDate, pc.date);
            const Y = age;
            const wasSpecial = pc.special ?? m.disability === "special";
            let F: number;
            let how: string;
            if (!wasSpecial && m.disability === "special") {
              F = 200_000 * Math.max(0, 85 - Y) + 100_000 * Math.max(0, Math.min(Y, 85) - X);
              how = `一般→特別：20万×(85−${Y})＋10万×(${Y}−${X})`;
            } else if (wasSpecial) {
              F = 200_000 * Math.max(0, 85 - X);
              how = `前の相続は特別：20万×(85−${X})`;
            } else {
              F = 100_000 * Math.max(0, 85 - X);
              how = `一般：10万×(85−${X})`;
            }
            const A = Math.trunc(pc.amount);
            if (A > F) addOos("前の相続で受けた障害者控除の額が、そのときの区分で受けられる額を超えている（入力の矛盾）");
            const cap = Math.max(0, F - A);
            if (cap < amt) noteOnce(`${m.name}：前の相続でも障害者控除を受けた（限度額 ${fmt(F)}［${how}］ − 控除済み ${fmt(A)}）→ ${fmt(cap)} まで`);
            amt = Math.min(amt, cap);
          }
        }
        if (amt === 0) continue;
        const use = Math.min(amt, rem.get(p.id)!);
        p[field] += use;
        rem.set(p.id, rem.get(p.id)! - use);
        if (amt > use) excesses.push({ from: p.id, amt: amt - use });
      }
      for (const e of excesses) transferExcess(e.amt, e.from, field);
    }
    // 20条：相次相続控除（相続人のみ）
    const pi = s.decedent.priorInheritance;
    if (pi && pi.yearsAgo < 10 && pi.prevTax > 0) {
      const A = Math.trunc(pi.prevTax);
      const B = Math.trunc(pi.prevAcquired);
      const C = persons.reduce((x, p) => x + p.part4, 0); // 今回取得した全員の純資産価額の合計（第1表④）
      const E = Math.floor(pi.yearsAgo);
      if (C > 0) {
        let ratio = B - A > 0 ? Qn(C, B - A) : ONE;
        if (qcmp(ratio, ONE) > 0) ratio = ONE;
        const totalCredit = yenFloor(A, ratio, Qn(10 - E, 10));
        for (const p of persons) {
          if (!heirIds.has(p.id)) continue;
          const amt = yenFloor(totalCredit, Qn(p.part4, C));
          p.successive = Math.min(amt, rem.get(p.id)!);
          rem.set(p.id, rem.get(p.id)! - p.successive);
        }
      }
    }
    // ⑲ 差引税額 → ⑳ 精算課税分の贈与税額控除（控除しきれない分は還付：33条の2）→ 100円未満切捨て
    let total = 0;
    let net = 0;
    for (const p of persons) {
      const t = rem.get(p.id)!;
      // ⑰ 相続時精算課税分の贈与税額控除額：その人が納めた精算課税の贈与税の合計（100円未満切捨て。第1表⑰の欄は百円単位）
      const st = floor100(accs.get(p.id)?.settlementTax ?? 0);
      p.settlementCredit = st;
      const after = t - st;
      if (after >= 0) p.payable = floor100(after);
      else p.refund = -after;
      total += p.payable;
      net += p.payable - p.refund;
    }
    const reduction = sels.reduce((x, y) => x + y.reduction, 0);
    return { persons, total, totalTaxable, net, reduction, taxParts: tt, transferred };
  };

  // 小規模宅地等の選び方：家族は納める税額の合計が一番少なくなる組合せを選ぶ。並べ方ごとに前から使う選び方を比べたあと、
  // 同じ種類の候補のあいだで面積を分け直す選び方も調べる（限度面積はどの人の分にどれだけ使ってもよい。措法69条の4第1項）
  const smallScore = (sel: SmallSel[]) => {
    const r = evaluate(sel);
    return { net: r.net, reduction: r.reduction };
  };
  const chosen = splitSmallLand(cands, chooseSmallLand(cands, smallScore), smallScore);
  const base = evaluate([]);
  const fin = evaluate(chosen);
  for (const x of chosen)
    notes.push(
      `小規模宅地等：${x.cand.label}（${x.cand.kind}、${nameOf(x.cand.acquirer)}）${(Number(qfloor(qmul(x.area, Qn(100)))) / 100).toFixed(2)}㎡ 減額 ${fmt(x.reduction)}`,
    );

  /* ---------- 11. まとめ ---------- */
  for (const p of fin.persons) {
    const a = acc(p.id);
    const bits = [
      `①${fmt(p.part1)}`,
      p.part2 ? `②${fmt(p.part2)}` : "",
      p.part3 ? `③${fmt(p.part3)}` : "",
      `④${fmt(p.part4)}`,
      p.part5 ? `⑤${fmt(p.part5)}` : "",
      `⑥${fmt(p.taxable)}`,
      `算出${fmt(p.calc)}`,
      p.add20 ? `2割${fmt(p.add20)}` : "",
      p.giftCredit ? `贈与控除${fmt(p.giftCredit)}` : "",
      p.spouseRelief ? `配偶者軽減${fmt(p.spouseRelief)}` : "",
      p.minor ? `未成年${fmt(p.minor)}` : "",
      p.disabled ? `障害者${fmt(p.disabled)}` : "",
      p.successive ? `相次${fmt(p.successive)}` : "",
      p.settlementCredit ? `精算控除${fmt(p.settlementCredit)}` : "",
      `納付${fmt(p.payable)}`,
      p.refund ? `還付${fmt(p.refund)}` : "",
      a.insurance ? `保険${fmt(a.insurance)}(非課税${fmt(a.insuranceExempt)})` : "",
      a.retirement ? `退職${fmt(a.retirement)}(非課税${fmt(a.retirementExempt)})` : "",
    ].filter(Boolean);
    notes.push(`${p.name}：${bits.join(" ")}`);
  }
  notes.push(
    `課税価格の合計 ${fmt(fin.totalTaxable)} − 基礎控除 ${fmt(basic)} = 課税遺産総額 ${fmt(fin.taxParts.base)}；` +
      `相続税の総額 ${fmt(fin.taxParts.total)} [${fin.taxParts.parts.map((x) => `${nameOf(x.id)} ${fmt(x.amount)}→${fmt(x.tax)}`).join("、")}]`,
  );
  if (s.division.kind === "undivided" || anyUndivided)
    notes.push(
      "未分割の財産あり：法定相続分で課税価格を計算。配偶者の税額軽減・小規模宅地等は未分割分に使えない。「申告期限後3年以内の分割見込書」を出す",
    );
  if (fin.transferred > 0)
    notes.push(
      `未成年者・障害者控除の控除しきれない分 ${fmt(fin.transferred)} を扶養義務者（配偶者・直系血族・兄弟姉妹）の税額から相続税額の比で控除した`,
    );
  if (cands.length > 0 && chosen.length === 0) notes.push("小規模宅地等：使っても税額が変わらないため選ばなかった");

  // 申告が要る：課税価格の合計が基礎控除を超える（特例を使って0円になる場合を含む）、
  // または精算課税の贈与税を引ききれず還付を受ける（還付は申告書を出さないと受けられない。33条の2）
  const refundOnly = base.totalTaxable <= basic && fin.persons.some((p) => p.refund > 0);
  if (refundOnly) notes.push("基礎控除以下だが、相続時精算課税の贈与税の還付を受けるため申告する");
  const filingRequired = base.totalTaxable > basic || refundOnly;
  return {
    computable: oos.length === 0,
    outOfScope: oos.length ? oos.join(" / ") : undefined,
    legalHeirCount: N,
    basicDeduction: basic,
    totalTaxablePrice: fin.totalTaxable,
    totalTax: fin.taxParts.total,
    persons: fin.persons.map((p) => ({ id: p.id, taxablePrice: p.taxable, payable: p.payable, ...(p.refund ? { refund: p.refund } : {}) })),
    filingRequired,
    notes,
  };
}

/** 候補 c に面積 area を選んだときの減額。小規模宅地等の価額 = 持分の価額 × 選んだ面積 / 持分の面積（円未満切捨て）、減額 = その × 割合（円未満切捨て） */
function smallSelOf(c: SmallCand, area: Q): SmallSel {
  const part = qcmp(area, c.shareArea) === 0 ? c.shareValue : yenFloor(c.shareValue, qdiv(area, c.shareArea));
  return { cand: c, area, reduction: yenFloor(part, SMALL_RATE[c.kind]) };
}

/** 2つの候補のあいだで分け直す面積の刻み（0.01㎡）がこの数以下なら、全部の刻みを調べる */
const SMALL_SCAN_ALL = 4000;
/** 刻みが多いときに、はじめに調べる粗い刻みの点の数 */
const SMALL_SCAN_COARSE = 400;
/** 1件で分け直しを調べる回数の上限（候補が多いときに時間がかかりすぎないように） */
const SMALL_SCAN_BUDGET = 40000;

/**
 * 限度面積の分け直し。限度面積は、宅地等を取得した人全員の同意で、どの宅地（1つの宅地を何人かで取得したときは、どの人の持分）に
 * どれだけ使うかを選べる（措法69条の4第1項、付表1の同意欄）。並べ方ごとに前から使う選び方（chooseSmallLand）だけでは、
 * 贈与税額控除など、その人の算出税額までしか引けない控除を引ききれない人がいるとき、何人かに分けた方が家族全体の税額が
 * 少なくなる選び方を見落とす。そこで、同じ種類の2つの候補 p・q の面積の合計 S を保ったまま（同じ種類なので限度面積の換算は
 * 変わらない）、q の面積 y を 0.01㎡ 刻みで動かす（p は S − y。どちらも0以上・その人の上限 cap 以下で、0.01㎡の倍数か上限ちょうど）。
 * 刻みの数が SMALL_SCAN_ALL 以下なら全部を、多ければ SMALL_SCAN_COARSE 点ほどの粗い刻みを調べてから、よかった2点の前後を
 * 0.01㎡ 刻みで全部調べる。net（納付税額の合計−還付）が下がるときだけ分け直し、下がらなくなるまで繰り返す。
 * 同じ組の中では net が小さい点、同じなら減額の大きい点、それも同じなら今の面積に近い点をとる
 */
function splitSmallLand(cands: SmallCand[], start: SmallSel[], score: (sel: SmallSel[]) => { net: number; reduction: number }): SmallSel[] {
  const area = new Map<SmallCand, Q>(cands.map((c) => [c, start.find((x) => x.cand === c)?.area ?? ZERO]));
  const pairs: [SmallCand, SmallCand, boolean][] = [];
  cands.forEach((p, i) => cands.slice(i + 1).forEach((q) => p.kind === q.kind && pairs.push([p, q, false])));
  // 種類の違う2つ（貸付事業用の候補があるときだけ。そのときの限度面積は換算した合計で決まる）：q の面積 y を動かし、
  // p には、ほかをそのままにして限度面積の残りで使えるだけ使う（自宅の一部＋アパートの大部分のような組合せ）
  // 全部の候補を上限まで使っても限度面積に収まるときは、分け直す必要がない（減らすと減額が減るだけ）ので調べない
  const capOf = (k: SmallLandKind) => cands.filter((c) => c.kind === k).reduce((x, c) => qadd(x, c.cap), ZERO);
  const capAll = qadd(qadd(qmul(capOf("residence"), Qn(200, 330)), qmul(capOf("business"), Qn(200, 400))), capOf("rental"));
  if (cands.some((c) => c.kind === "rental") && qcmp(capAll, Qn(200)) > 0) cands.forEach((p) => cands.forEach((q) => p.kind !== q.kind && pairs.push([p, q, true])));
  if (!pairs.length) return start;
  const selsOf = (m: Map<SmallCand, Q>) => cands.filter((c) => qcmp(m.get(c)!, ZERO) > 0).map((c) => smallSelOf(c, m.get(c)!));
  /** その候補に選べる面積か（0以上・上限以下で、0.01㎡の倍数か上限ちょうど） */
  const ok = (c: SmallCand, x: Q) => qcmp(x, ZERO) >= 0 && qcmp(x, c.cap) <= 0 && (100n % x.d === 0n || qcmp(x, c.cap) === 0);
  /** ほかの候補の面積が m のとき、候補 c に使えるいちばん大きい面積（限度面積の残りまでで 0.01㎡未満切捨て。上限 cap まで） */
  const roomFor = (c: SmallCand, m: Map<SmallCand, Q>): Q => {
    let A = ZERO;
    let B = ZERO;
    let C = ZERO;
    for (const d of cands) {
      if (d === c) continue;
      if (d.kind === "residence") A = qadd(A, m.get(d)!);
      else if (d.kind === "business") B = qadd(B, m.get(d)!);
      else C = qadd(C, m.get(d)!);
    }
    const used = qadd(qadd(qmul(A, Qn(200, 330)), qmul(B, Qn(200, 400))), C);
    let max: Q;
    if (c.kind === "rental") max = qsub(Qn(200), used);
    else {
      max = qsub(Qn(SMALL_LIMIT[c.kind]), c.kind === "residence" ? A : B);
      if (qcmp(C, ZERO) > 0) max = qmin(max, qmul(qsub(Qn(200), used), Qn(SMALL_LIMIT[c.kind], 200)));
    }
    if (qcmp(max, ZERO) <= 0) return ZERO;
    return qcmp(c.cap, max) <= 0 ? c.cap : Qn(qfloor(qmul(max, Qn(100))), 100);
  };
  let cur = score(selsOf(area));
  let budget = SMALL_SCAN_BUDGET;
  for (let improved = true; improved && budget > 0; ) {
    improved = false;
    for (const [p, q, cross] of pairs) {
      const S = qadd(area.get(p)!, area.get(q)!);
      const yLo = cross ? ZERO : qcmp(qsub(S, p.cap), ZERO) > 0 ? qsub(S, p.cap) : ZERO;
      // 種類が違うときは、p を0にしたときに q に使える面積まで
      const yHi = cross ? roomFor(q, new Map(area).set(p, ZERO)) : qmin(q.cap, S);
      if (qcmp(yLo, yHi) >= 0) continue;
      const y0 = area.get(q)!;
      let best = { y: y0, net: cur.net, reduction: cur.reduction };
      const dist = (y: Q) => Math.abs(qnum(qsub(y, y0)));
      const tried = new Set<string>();
      /** q を y にしたときの p の面積 */
      const xOf = (y: Q): Q => {
        if (!cross) return qsub(S, y);
        const m = new Map(area);
        m.set(q, y);
        return roomFor(p, m);
      };
      const tryY = (y: Q) => {
        const key = qstr(y);
        if (tried.has(key) || budget <= 0) return;
        tried.add(key);
        if (!ok(q, y) || qcmp(y, y0) === 0) return;
        const x = xOf(y);
        if (!ok(p, x)) return;
        budget--;
        const m = new Map(area);
        m.set(p, x);
        m.set(q, y);
        const sc = score(selsOf(m));
        if (sc.net < best.net || (sc.net === best.net && (sc.reduction > best.reduction || (sc.reduction === best.reduction && dist(y) < dist(best.y)))))
          best = { y, net: sc.net, reduction: sc.reduction };
      };
      const hLo = qceil(qmul(yLo, Qn(100)));
      const hHi = qfloor(qmul(yHi, Qn(100)));
      tryY(yLo);
      tryY(yHi);
      const n = Number(hHi - hLo);
      if (n <= SMALL_SCAN_ALL) {
        for (let h = hLo; h <= hHi; h++) tryY(Qn(h, 100));
      } else {
        const step = BigInt(Math.ceil(n / SMALL_SCAN_COARSE));
        const coarse: { h: bigint; net: number; reduction: number }[] = [];
        for (let h = hLo; h <= hHi; h += step) {
          tryY(Qn(h, 100));
          const sc = qcmp(best.y, Qn(h, 100)) === 0 ? best : undefined;
          if (sc) coarse.push({ h, net: sc.net, reduction: sc.reduction });
        }
        // 粗い刻みでよかった点（いちばんよい点と、その前に見つけた点）の前後 step を全部
        for (const c of coarse.slice(-2)) for (let h = c.h - step; h <= c.h + step; h++) if (h >= hLo && h <= hHi) tryY(Qn(h, 100));
        // 今の面積の前後 step も全部（今の点のすぐ近くに下がる点があることがある）
        const h0 = qfloor(qmul(y0, Qn(100)));
        for (let h = h0 - step; h <= h0 + step; h++) if (h >= hLo && h <= hHi) tryY(Qn(h, 100));
      }
      if (best.net < cur.net) {
        area.set(p, xOf(best.y));
        area.set(q, best.y);
        cur = { net: best.net, reduction: best.reduction };
        improved = true;
      }
    }
  }
  return selsOf(area);
}

/**
 * 小規模宅地等の面積の選び方を全部試す（候補の並べ方ごとに、前から限度いっぱいまで使う）。
 * 限度面積（措法69条の4第2項）：
 *   貸付事業用を選ばない：特定居住用 ≦330㎡、特定事業用 ≦400㎡（合計730㎡まで）
 *   貸付事業用を選ぶ：特定居住用×200/330 ＋ 特定事業用×200/400 ＋ 貸付事業用 ≦ 200㎡
 * 選ぶ面積は限度で切られるとき 0.01㎡ 未満を切り捨てる。
 * 評価関数の net（納付税額の合計−還付）が最も小さいもの、同じなら減額の大きいものを選ぶ。
 */
function chooseSmallLand(cands: SmallCand[], score: (sel: SmallSel[]) => { net: number; reduction: number }): SmallSel[] {
  if (cands.length === 0) return [];
  const fill = (orderC: SmallCand[]): SmallSel[] => {
    const sels: SmallSel[] = [];
    let A = ZERO;
    let B = ZERO;
    let C = ZERO;
    for (const c of orderC) {
      const used = qadd(qadd(qmul(A, Qn(200, 330)), qmul(B, Qn(200, 400))), C); // 貸付事業用の換算
      let max: Q;
      if (c.kind === "rental") max = qsub(Qn(200), used);
      else {
        const own = qsub(Qn(SMALL_LIMIT[c.kind]), c.kind === "residence" ? A : B);
        max = own;
        if (qcmp(C, ZERO) > 0) {
          const conv = qmul(qsub(Qn(200), used), Qn(SMALL_LIMIT[c.kind], 200));
          max = qmin(own, conv);
        }
      }
      if (qcmp(max, ZERO) <= 0) continue;
      // ⑤ は ③（取得者の持分に応ずる面積）とその人が選んだ面積（cap）の小さい方まで、さらに限度面積の残りまで
      let area: Q;
      if (qcmp(c.cap, max) <= 0) area = c.cap;
      else area = Qn(qfloor(qmul(max, Qn(100))), 100); // 0.01㎡未満切捨て
      if (qcmp(area, ZERO) <= 0) continue;
      sels.push(smallSelOf(c, area));
      if (c.kind === "residence") A = qadd(A, area);
      else if (c.kind === "business") B = qadd(B, area);
      else C = qadd(C, area);
    }
    return sels;
  };
  const orders: SmallCand[][] = [];
  if (cands.length <= 7) {
    const perm = (rest: SmallCand[], cur: SmallCand[]): void => {
      if (rest.length === 0) {
        orders.push(cur);
        return;
      }
      for (let i = 0; i < rest.length; i++) perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...cur, rest[i]]);
    };
    perm(cands, []);
  } else {
    // 多すぎるときは、限度面積1㎡あたりの減額の大きい順などいくつかの並べ方だけ試す
    const eff = (c: SmallCand): number =>
      (qnum(qmul(Qn(c.shareValue), SMALL_RATE[c.kind])) / qnum(c.shareArea)) *
      (c.kind === "rental" ? 1 : SMALL_LIMIT[c.kind] / 200);
    orders.push([...cands].sort((a, b) => eff(b) - eff(a)));
    orders.push([...cands].sort((a, b) => (a.kind === "rental" ? 1 : 0) - (b.kind === "rental" ? 1 : 0) || eff(b) - eff(a)));
    orders.push([...cands].sort((a, b) => (a.kind === "rental" ? 0 : 1) - (b.kind === "rental" ? 0 : 1) || eff(b) - eff(a)));
  }
  let best: SmallSel[] = [];
  let bestScore = score([]);
  const seen = new Set<string>();
  for (const o of orders) {
    const sel = fill(o);
    const key = sel
      .map((x) => `${x.cand.itemId}/${x.cand.acquirer}:${qstr(x.area)}`)
      .sort()
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const sc = score(sel);
    if (sc.net < bestScore.net || (sc.net === bestScore.net && sc.reduction > bestScore.reduction)) {
      best = sel;
      bestScore = sc;
    }
  }
  return best;
}
