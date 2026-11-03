"use client";

import { useState } from "react";
import type { Asset, Case, Debt, LandMethod, Person, PriorGift } from "@/domain/types";

/** /api/extract が返す、書類から読み取った候補 */
export interface ExtractedAsset {
  kind: "deposit" | "cash" | "land" | "building" | "condo" | "insurance" | "listedStock" | "debt" | "funeral" | "gift" | "other";
  label: string;
  institution?: string | null;
  branch?: string | null;
  accountType?: string | null;
  amount: number | null;
  accruedInterest: number | null;
  location: string | null;
  lotNumber?: string | null;
  houseNumber?: string | null;
  areaSqm: number | null;
  fixedAssetValue: number | null;
  routePrice?: number | null;
  personName?: string | null;
  shares?: number | null;
  prices?: { close: number | null; monthAvg: number | null; prevMonthAvg: number | null; prev2MonthAvg: number | null } | null;
  condo?: {
    exclusiveAreaSqm: number | null;
    landShareSqm: number | null;
    landValueBeforeCorrection: number | null;
    buildingFixedAssetValue: number | null;
    builtYears: number | null;
    builtMonths: number | null;
    totalFloors: number | null;
    floor: number | null;
  } | null;
  giftTaxPaid?: number | null;
  date: string | null;
  evidence: string;
}
export interface Extracted {
  documentType: string;
  assets: ExtractedAsset[];
  notes: string[];
}

/** 読み取った候補がどこに入るか */
export const TARGET_LABEL: Record<ExtractedAsset["kind"], string> = {
  deposit: "預貯金",
  cash: "現金",
  land: "土地",
  building: "家屋",
  condo: "分譲マンション",
  insurance: "死亡保険金",
  listedStock: "上場株式",
  debt: "債務",
  funeral: "葬式費用",
  gift: "生前の贈与",
  other: "その他の財産",
};
export const destination = (k: ExtractedAsset["kind"]) => (k === "debt" || k === "funeral" ? "債務・葬式費用" : k === "gift" ? "生前の贈与" : "財産");

/** 漢数字（一〜九十九）を算用数字にする（所在の照合用） */
const KANJI: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const kanjiNum = (t: string) =>
  t.replace(/([一二三四五六七八九]?)(十?)([一二三四五六七八九]?)(?=丁目|番|号)/g, (m, a: string, ten: string, b: string) => {
    if (!m) return m;
    const n = ten ? (a ? KANJI[a] : 1) * 10 + (b ? KANJI[b] : 0) : KANJI[a || b] ?? 0;
    return String(n);
  });
const norm = (t: string | null | undefined) => kanjiNum((t ?? "").normalize("NFKC")).replace(/[\s　]/g, "").replace(/丁目|番地|番|号|の/g, "-").replace(/-+$/, "");

/** 書類に書かれた氏名を、登録した家族に当てはめる（姓だけ・名だけの記載も） */
export function matchPerson(name: string | null | undefined, persons: Person[]): Person | undefined {
  const n = (name ?? "").normalize("NFKC").replace(/[\s　様殿]/g, "");
  if (!n) return undefined;
  const living = persons.filter((p) => !p.predeceased);
  const full = living.find((p) => p.name.replace(/[\s　]/g, "") === n);
  if (full) return full;
  const part = living.filter((p) => {
    const pn = p.name.replace(/[\s　]/g, "");
    return pn.length > 0 && (pn.endsWith(n) || n.endsWith(pn) || p.name.split(/[\s　]/).includes(n));
  });
  return part.length === 1 ? part[0] : undefined;
}

const pos = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? v : 0);
/** 空でない文字列か（書類から読めた文字だけを使うため） */
const has = (s: string | null | undefined): s is string => typeof s === "string" && s.trim() !== "";
/** YYYY-MM-DD の形で、実在する日付だけを通す（それ以外は「読めなかった」として扱う） */
export function isoDate(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "";
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : "";
}

/** 書類から読み取れなかったため、登録後に確かめる・入れる項目 */
export function missingItems(x: ExtractedAsset, persons: Person[]): string[] {
  const m: string[] = [];
  if (x.kind === "land") {
    if (!pos(x.areaSqm)) m.push("地積");
    m.push(pos(x.routePrice) ? "奥行と地区区分（地図で土地の形を合わせると入ります）" : "路線価または倍率（地図で路線価図を確認します）");
  }
  if (x.kind === "insurance" && !matchPerson(x.personName, persons)) m.push(x.personName ? `受取人（書類では「${x.personName}」さん。相続人の登録と名前を合わせてください）` : "受取人");
  if (x.kind === "listedStock") {
    if (!pos(x.shares)) m.push("株数");
    const p = x.prices;
    if (!p || ![p.close, p.monthAvg, p.prevMonthAvg, p.prev2MonthAvg].every((v) => pos(v))) m.push("4つの価格（亡くなった日の終値と、その月・前月・前々月の平均）");
  }
  if (x.kind === "condo") {
    const c = x.condo;
    if (!c || !pos(c.exclusiveAreaSqm) || !pos(c.landShareSqm) || !pos(c.totalFloors) || c.builtYears == null || c.floor == null) m.push("区分所有補正に使う値（築年数・総階数・階・専有面積・敷地権の面積）");
    if (!c || !pos(c.landValueBeforeCorrection)) m.push("敷地利用権の評価額（路線価×敷地権の面積など）");
  }
  if ((x.kind === "debt" || x.kind === "funeral") && !matchPerson(x.personName, persons)) m.push("負担する人");
  if (x.kind === "gift") {
    if (!matchPerson(x.personName, persons)) m.push("贈与を受けた人");
    if (!isoDate(x.date)) m.push("贈与の日");
  }
  if (x.amount == null && ["deposit", "cash", "insurance", "debt", "funeral", "gift", "other"].includes(x.kind)) m.push("金額");
  return m;
}

/** 読み取った候補を財産データの形にする。書類にない値は推定せず「確認待ち」として残す */
export function toAsset(x: ExtractedAsset, persons: Person[] = []): Asset {
  const id = crypto.randomUUID().slice(0, 8);
  const pending = missingItems(x, persons);
  const base = { id, label: x.label, ...(pending.length ? { pending } : {}) };
  const reg = { ...(x.lotNumber ? { lotNumber: x.lotNumber } : {}), ...(x.houseNumber ? { houseNumber: x.houseNumber } : {}), ...(pos(x.fixedAssetValue) ? { assessedValue: x.fixedAssetValue! } : {}) };
  if (x.kind === "land") {
    const rp = pos(x.routePrice);
    return {
      ...base,
      kind: "land",
      location: x.location ?? "",
      areaSqm: pos(x.areaSqm),
      landUse: "宅地",
      method: rp ? { type: "rosenka", routePrice: rp, depthCorrection: 1, roads: [{ edge: 0, price: rp, depth: 0 }] } : { type: "multiplier", fixedAssetValue: pos(x.fixedAssetValue), multiplier: 0 },
      registry: reg,
    };
  }
  if (x.kind === "building") return { ...base, kind: "building", location: x.location ?? "", fixedAssetValue: pos(x.fixedAssetValue), registry: reg };
  if (x.kind === "condo") {
    const c = x.condo;
    return {
      ...base,
      kind: "condo",
      location: x.location ?? "",
      landValueBeforeCorrection: pos(c?.landValueBeforeCorrection),
      buildingFixedAssetValue: pos(c?.buildingFixedAssetValue) || pos(x.fixedAssetValue),
      builtYearsMonths: { years: c?.builtYears ?? 0, months: c?.builtMonths ?? 0 },
      totalFloors: pos(c?.totalFloors),
      floor: c?.floor ?? 0,
      landShareSqm: pos(c?.landShareSqm),
      exclusiveAreaSqm: pos(c?.exclusiveAreaSqm),
      registry: reg,
    };
  }
  if (x.kind === "insurance") return { ...base, kind: "insurance", amount: pos(x.amount), recipientId: matchPerson(x.personName, persons)?.id ?? "" };
  if (x.kind === "listedStock") {
    const p = x.prices;
    return { ...base, kind: "listedStock", shares: pos(x.shares), prices: { close: pos(p?.close), monthAvg: pos(p?.monthAvg), prevMonthAvg: pos(p?.prevMonthAvg), prev2MonthAvg: pos(p?.prev2MonthAvg) } };
  }
  return {
    ...base,
    kind: x.kind === "deposit" ? "deposit" : x.kind === "cash" ? "cash" : "other",
    amount: pos(x.amount),
    accruedInterest: x.accruedInterest ?? undefined,
    institution: x.institution ?? undefined,
    branch: x.branch ?? undefined,
    accountType: x.accountType ?? undefined,
  };
}

export function toDebt(x: ExtractedAsset, persons: Person[]): Debt {
  const who = matchPerson(x.personName, persons);
  const amount = pos(x.amount);
  return { id: crypto.randomUUID().slice(0, 8), kind: x.kind === "funeral" ? "funeral" : "debt", label: x.label, amount, creditor: x.institution ?? undefined, bearers: who ? [{ personId: who.id, amount }] : [] };
}

export function toGift(x: ExtractedAsset, persons: Person[]): PriorGift {
  // 受け取った人・贈与の日が読めなければ空のまま登録する（贈与の入力欄で「入れてください」と表示され、入れるまで申告書は作れない）
  return { personId: matchPerson(x.personName, persons)?.id ?? "", date: isoDate(x.date), amount: pos(x.amount), giftTaxPaid: pos(x.giftTaxPaid) };
}

export type Ref = { type: "asset" | "debt"; id: string } | { type: "gift"; index: number };

/** すでに登録されているものと同じか（預貯金：金融機関と金額、土地・家屋・マンション：所在、株式：銘柄、現金：現金どうし） */
export function findSame(x: ExtractedAsset, c: Case): Ref | undefined {
  if (x.kind === "debt" || x.kind === "funeral") {
    const d = c.debts.find((d) => d.kind === (x.kind === "funeral" ? "funeral" : "debt") && d.amount === x.amount);
    return d ? { type: "debt", id: d.id } : undefined;
  }
  if (x.kind === "gift") {
    const i = c.priorGifts.findIndex((g) => g.amount === x.amount && (!x.date || g.date === x.date));
    return i >= 0 ? { type: "gift", index: i } : undefined;
  }
  const a = c.assets.find((a) => {
    if (a.kind === "deposit" && x.kind === "deposit") {
      const sameBank = (!!x.institution && a.institution === x.institution) || a.label.includes(x.institution ?? x.label);
      return sameBank && a.amount === x.amount && (!x.accountType || !a.accountType || a.accountType === x.accountType);
    }
    if ((a.kind === "land" || a.kind === "building" || a.kind === "condo") && a.kind === x.kind) {
      const same = !!x.location && norm(a.location) === norm(x.location);
      const sameHouse = !!x.houseNumber && norm(a.registry?.houseNumber) === norm(x.houseNumber);
      return same || sameHouse;
    }
    if (a.kind === "listedStock" && x.kind === "listedStock") return norm(a.label).includes(norm(x.label)) || norm(x.label).includes(norm(a.label));
    if (a.kind === "cash" && x.kind === "cash") return true;
    if ((a.kind === "insurance" || a.kind === "other") && a.kind === x.kind) return a.amount === x.amount && (a.label === x.label || a.kind === "insurance");
    return false;
  });
  return a ? { type: "asset", id: a.id } : undefined;
}

/** 土地の評価方法が、評価額を出せるだけそろっているか（valueLand と同じ条件） */
function methodReady(m: LandMethod): boolean {
  if (m.type === "rosenka") return m.roads?.length ? m.roads.every((r) => r.price > 0 && r.depth > 0) : m.routePrice > 0 && m.depthCorrection > 0;
  if (m.type === "multiplier") return m.fixedAssetValue > 0 && m.multiplier > 0;
  return m.value > 0;
}

/** 「確認待ち」の項目ごとに、登録済みの値でもう埋まっているかを確かめる */
const PENDING_RULES: [RegExp, (a: Asset, living: Set<string>) => boolean][] = [
  [/^地積/, (a) => a.kind === "land" && a.areaSqm > 0],
  [/^(奥行と地区区分|路線価または倍率)/, (a) => a.kind === "land" && methodReady(a.method)],
  [/^受取人/, (a, living) => (a.kind === "insurance" || a.kind === "retirement") && living.has(a.recipientId)],
  [/^株数/, (a) => a.kind === "listedStock" && a.shares > 0],
  [/^4つの価格/, (a) => a.kind === "listedStock" && [a.prices.close, a.prices.monthAvg, a.prices.prevMonthAvg, a.prices.prev2MonthAvg].every((v) => v > 0)],
  [
    /^区分所有補正/,
    (a) => a.kind === "condo" && a.exclusiveAreaSqm > 0 && a.landShareSqm > 0 && a.totalFloors > 0 && a.floor > 0 && (a.builtYearsMonths.years > 0 || a.builtYearsMonths.months > 0),
  ],
  [/^敷地利用権/, (a) => a.kind === "condo" && a.landValueBeforeCorrection > 0],
  [/^金額/, (a) => "amount" in a && a.amount > 0],
];

/** 書類から分からなかった項目と前から残っていた確認待ちのうち、まだ埋まっていないものだけを残す */
function stillPending(items: string[], a: Asset, persons: Person[]): string[] {
  const living = new Set(persons.filter((p) => !p.predeceased).map((p) => p.id));
  const seen = new Set<number | string>();
  const out: string[] = [];
  for (const item of items) {
    const i = PENDING_RULES.findIndex(([re]) => re.test(item));
    if (i >= 0 && PENDING_RULES[i][1](a, living)) continue;
    const key = i >= 0 ? i : item;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * 登録済みの財産に、書類から読めた値だけを重ねる。
 * 読めなかった項目（null・0・空）と、書類にない入力（分け方・特例・地図の枠など）は、登録済みの値のまま残す。
 * 種類が違うときは null（上書きせず別の財産として登録する）。
 */
function mergeAsset(old: Asset, x: ExtractedAsset, persons: Person[]): Asset | null {
  const fresh = toAsset(x, persons);
  if (fresh.kind !== old.kind) return null;
  const reg = { ...(has(x.lotNumber) ? { lotNumber: x.lotNumber } : {}), ...(has(x.houseNumber) ? { houseNumber: x.houseNumber } : {}), ...(pos(x.fixedAssetValue) ? { assessedValue: pos(x.fixedAssetValue) } : {}) };
  const location = has(x.location) ? { location: x.location } : {};
  let m: Asset;
  switch (old.kind) {
    case "land": {
      const om = old.method;
      const rp = pos(x.routePrice);
      // 地図で入れた土地の形や奥行は、評価がまだそろっていなくても消さない
      const drawn = om.type === "rosenka" && (!!om.lot || !!om.shape?.length || !!om.roads?.some((r) => r.depth > 0));
      const method: LandMethod =
        fresh.kind === "land" && rp && !methodReady(om) && !drawn
          ? fresh.method
          : om.type === "multiplier" && pos(x.fixedAssetValue)
            ? { ...om, fixedAssetValue: pos(x.fixedAssetValue) }
            : om;
      m = { ...old, ...location, ...(pos(x.areaSqm) ? { areaSqm: pos(x.areaSqm) } : {}), method, registry: { ...old.registry, ...reg } };
      break;
    }
    case "building":
      m = { ...old, ...location, ...(pos(x.fixedAssetValue) ? { fixedAssetValue: pos(x.fixedAssetValue) } : {}), registry: { ...old.registry, ...reg } };
      break;
    case "condo": {
      const c = x.condo;
      const bfv = pos(c?.buildingFixedAssetValue) || pos(x.fixedAssetValue);
      m = {
        ...old,
        ...location,
        ...(pos(c?.landValueBeforeCorrection) ? { landValueBeforeCorrection: pos(c?.landValueBeforeCorrection) } : {}),
        ...(bfv ? { buildingFixedAssetValue: bfv } : {}),
        ...(c?.builtYears != null ? { builtYearsMonths: { years: c.builtYears, months: c.builtMonths ?? 0 } } : {}),
        ...(pos(c?.totalFloors) ? { totalFloors: pos(c?.totalFloors) } : {}),
        ...(c?.floor != null ? { floor: c.floor } : {}),
        ...(pos(c?.landShareSqm) ? { landShareSqm: pos(c?.landShareSqm) } : {}),
        ...(pos(c?.exclusiveAreaSqm) ? { exclusiveAreaSqm: pos(c?.exclusiveAreaSqm) } : {}),
        registry: { ...old.registry, ...reg },
      };
      break;
    }
    case "insurance":
    case "retirement": {
      const who = matchPerson(x.personName, persons);
      m = { ...old, ...(pos(x.amount) ? { amount: pos(x.amount) } : {}), ...(who ? { recipientId: who.id } : {}) };
      break;
    }
    case "listedStock": {
      const p = x.prices;
      const pick = (v: number | null | undefined, cur: number) => pos(v) || cur;
      m = {
        ...old,
        ...(pos(x.shares) ? { shares: pos(x.shares) } : {}),
        prices: {
          close: pick(p?.close, old.prices.close),
          monthAvg: pick(p?.monthAvg, old.prices.monthAvg),
          prevMonthAvg: pick(p?.prevMonthAvg, old.prices.prevMonthAvg),
          prev2MonthAvg: pick(p?.prev2MonthAvg, old.prices.prev2MonthAvg),
        },
      };
      break;
    }
    case "deposit":
    case "cash":
    case "household":
    case "other":
      m = {
        ...old,
        ...(pos(x.amount) ? { amount: pos(x.amount) } : {}),
        ...(typeof x.accruedInterest === "number" && x.accruedInterest >= 0 ? { accruedInterest: x.accruedInterest } : {}),
        ...(has(x.institution) ? { institution: x.institution } : {}),
        ...(has(x.branch) ? { branch: x.branch } : {}),
        ...(has(x.accountType) ? { accountType: x.accountType } : {}),
      };
      break;
    default:
      return null;
  }
  m.label = old.label || fresh.label;
  // 確認待ちは、重ねたあとの値で数え直す（書類で埋まった項目は外し、まだ空の項目は残す）
  const pending = stillPending([...missingItems(x, persons), ...(old.pending ?? [])], m, persons);
  if (pending.length) m.pending = pending;
  else delete m.pending;
  return m;
}

/** 登録済みの債務・葬式費用に、書類から読めた値だけを重ねる */
function mergeDebt(old: Debt, x: ExtractedAsset, persons: Person[]): Debt {
  const who = matchPerson(x.personName, persons);
  const amount = pos(x.amount) || old.amount;
  let bearers = old.bearers;
  // 負担する人を自分で分けていた（2人以上）ときは、その分け方を残す
  if (who && bearers.length <= 1) bearers = [{ personId: who.id, amount }];
  else if (!who && bearers.length === 1 && bearers[0].amount === old.amount) bearers = [{ ...bearers[0], amount }];
  return { ...old, label: old.label || x.label, amount, ...(has(x.institution) ? { creditor: x.institution } : {}), bearers };
}

/** 登録済みの贈与に、書類から読めた値だけを重ねる */
function mergeGift(old: PriorGift, x: ExtractedAsset, persons: Person[]): PriorGift {
  const who = matchPerson(x.personName, persons);
  const date = isoDate(x.date);
  return {
    ...old,
    ...(who ? { personId: who.id } : {}),
    ...(date ? { date } : {}),
    ...(pos(x.amount) ? { amount: pos(x.amount) } : {}),
    ...(typeof x.giftTaxPaid === "number" && x.giftTaxPaid >= 0 ? { giftTaxPaid: x.giftTaxPaid } : {}),
  };
}

/** 読み取った候補を登録する。replace があれば、その既存の項目に読み取れた値だけを重ねる（id は残す） */
export function applyExtracted(c: Case, x: ExtractedAsset, replace?: Ref): { next: Case; ref: Ref } {
  if (x.kind === "debt" || x.kind === "funeral") {
    const old = replace?.type === "debt" ? c.debts.find((y) => y.id === replace.id) : undefined;
    if (old && replace) {
      const merged = mergeDebt(old, x, c.persons);
      return { next: { ...c, debts: c.debts.map((y) => (y.id === old.id ? merged : y)) }, ref: replace };
    }
    const d = toDebt(x, c.persons);
    return { next: { ...c, debts: [...c.debts, d] }, ref: { type: "debt", id: d.id } };
  }
  if (x.kind === "gift") {
    if (replace?.type === "gift" && replace.index < c.priorGifts.length) {
      const merged = mergeGift(c.priorGifts[replace.index], x, c.persons);
      return { next: { ...c, priorGifts: c.priorGifts.map((y, i) => (i === replace.index ? merged : y)) }, ref: replace };
    }
    return { next: { ...c, priorGifts: [...c.priorGifts, toGift(x, c.persons)] }, ref: { type: "gift", index: c.priorGifts.length } };
  }
  const old = replace?.type === "asset" ? c.assets.find((y) => y.id === replace.id) : undefined;
  const merged = old ? mergeAsset(old, x, c.persons) : null;
  if (old && merged && replace) return { next: { ...c, assets: c.assets.map((y) => (y.id === old.id ? merged : y)) }, ref: replace };
  // 更新する相手が見つからない・種類が違うときは、消さずに別の財産として登録する
  const a = toAsset(x, c.persons);
  return { next: { ...c, assets: [...c.assets, a] }, ref: { type: "asset", id: a.id } };
}

/** 登録した項目がいまも残っているか */
export function refExists(c: Case, r: Ref): boolean {
  if ("index" in r) return r.index < c.priorGifts.length;
  return r.type === "asset" ? c.assets.some((a) => a.id === r.id) : c.debts.some((d) => d.id === r.id);
}

/** 書類のファイルを送って読み取る */
export function useExtract() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Extracted | null>(null);
  const [file, setFile] = useState<string | null>(null);
  async function read(f: File) {
    setBusy(true);
    setErr(null);
    setRes(null);
    setFile(f.name);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/extract", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "読み取りに失敗しました");
      setRes(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function readSample(url: string, name: string) {
    const b = await (await fetch(url)).blob();
    await read(new File([b], name, { type: b.type || "application/pdf" }));
  }
  return { busy, err, res, file, read, readSample, reset: () => setRes(null) };
}
