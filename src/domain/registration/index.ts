/**
 * 相続登記（相続による所有権移転登記）の申請書の内容と登録免許税を組み立てる。
 *
 * 根拠：
 * - 不動産登記法18条・不動産登記令3条（申請情報）、同7条（添付情報：登記原因証明情報・住所証明情報）
 * - 登録免許税法9条・別表第一1(二)イ（相続による所有権の移転：課税標準の1000分の4）
 * - 同法10条（課税標準＝固定資産課税台帳の価格）、15条（課税標準の1,000円未満切捨て）、
 *   19条（税額が1,000円未満なら1,000円）、国税通則法119条（100円未満切捨て）
 * - 租税特別措置法84条の2の3第2項（不動産の価額が100万円以下の土地の相続登記は免税。令和9年3月31日まで）
 * - 持分を取得する場合の課税標準は、不動産の価額×持分（登録免許税法施行令7条…持分の価額）
 */
import { splitLocation } from "@/forms/schedule11";
import { wareki } from "@/forms/format";
import type { Asset, Case, Person } from "@/domain/types";

export const REG_RATE_PER_MILLE = 4;
export const SMALL_LAND_EXEMPT = 1_000_000;

export type RegProperty =
  | { kind: "land"; assetId: string; label: string; location: string; lot: string; landUse: string; area: string; value: number; exempt: boolean }
  | { kind: "building"; assetId: string; label: string; location: string; houseNumber: string; type: string; structure: string; floorArea: string; value: number }
  | {
      kind: "condo";
      assetId: string;
      label: string;
      location: string;
      buildingName: string;
      houseNumber: string;
      type: string;
      structure: string;
      floorArea: string;
      siteLand: string;
      siteRight: string;
      value: number;
    };

export interface RegApplicant {
  personId: string;
  name: string;
  address: string;
  phone: string;
  /** 持分（単独なら空） */
  share: string;
}

export interface RegApplication {
  /** 取得する人の組み合わせ（同じ組み合わせ・持分の不動産は1件の申請にまとめる） */
  key: string;
  applicants: RegApplicant[];
  properties: RegProperty[];
  /** 課税価格（1,000円未満切捨て） */
  taxBase: number;
  /** 登録免許税（100円未満切捨て、最低1,000円） */
  tax: number;
  exemptLots: string[];
  cause: string;
  decedent: string;
  missing: string[];
}

const floor1000 = (n: number) => Math.floor(n / 1000) * 1000;
const floor100 = (n: number) => Math.floor(n / 100) * 100;
const kanjiShare = (n: number, d: number) => (n === d ? "" : `${d}分の${n}`);

/** 登録免許税（相続による所有権移転） */
export function registrationTax(taxBase: number): number {
  if (taxBase <= 0) return 0;
  return Math.max(1000, floor100((taxBase * REG_RATE_PER_MILLE) / 1000));
}

function property(a: Asset, missing: string[]): RegProperty | null {
  const r = a.kind === "land" || a.kind === "building" || a.kind === "condo" ? (a.registry ?? {}) : null;
  if (!r) return null;
  const need = (v: string | number | undefined, what: string) => {
    if (v === undefined || v === "" || v === 0) missing.push(`「${a.label}」の${what}`);
  };
  if (a.kind === "land") {
    const loc = splitLocation(a.location);
    const value = r.assessedValue ?? 0;
    need(r.assessedValue, "固定資産評価額");
    return {
      kind: "land",
      assetId: a.id,
      label: a.label,
      location: `${loc.pref}${loc.city}${loc.town}`,
      lot: r.lotNumber || loc.lot || "",
      landUse: a.landUse,
      area: `${a.areaSqm.toFixed(2)}㎡`,
      value,
      exempt: value > 0 && value <= SMALL_LAND_EXEMPT,
    };
  }
  if (a.kind === "building") {
    const value = r.assessedValue ?? a.fixedAssetValue;
    need(r.houseNumber, "家屋番号");
    need(r.structure, "構造");
    need(r.floorArea, "床面積");
    return {
      kind: "building",
      assetId: a.id,
      label: a.label,
      location: a.location.replace(/\s*家屋番号.*$/, ""),
      houseNumber: r.houseNumber ?? "",
      type: r.buildingType || "居宅",
      structure: r.structure ?? "",
      floorArea: r.floorArea ?? "",
      value,
    };
  }
  if (a.kind === "condo") {
    need(r.houseNumber, "家屋番号");
    need(r.siteRight, "敷地権の割合");
    need(r.siteAssessedValue, "敷地権の評価額");
    return {
      kind: "condo",
      assetId: a.id,
      label: a.label,
      location: a.location,
      buildingName: r.buildingName ?? "",
      houseNumber: r.houseNumber ?? "",
      type: r.buildingType || "居宅",
      structure: r.structure ?? "",
      floorArea: r.floorArea ?? `${a.exclusiveAreaSqm.toFixed(2)}㎡`,
      siteLand: r.siteLand ?? "",
      siteRight: r.siteRight ?? "",
      value: (r.assessedValue ?? a.buildingFixedAssetValue) + (r.siteAssessedValue ?? 0),
    };
  }
  return null;
}

/** 遺産分割で決まった取得者ごとに、相続登記の申請をまとめる */
export function buildRegistrations(c: Case): RegApplication[] {
  const persons = new Map<string, Person>(c.persons.map((p) => [p.id, p]));
  const allocs = new Map(c.allocations.map((a) => [a.assetId, a]));
  const apps = new Map<string, RegApplication>();
  const death = wareki(c.decedent.deathDate);
  for (const a of c.assets) {
    const missing: string[] = [];
    const prop = property(a, missing);
    if (!prop) continue;
    const al = allocs.get(a.id);
    if (!al || al.shares.length === 0) continue;
    const key = al.shares.map((s) => `${s.personId}:${s.numerator}/${s.denominator}`).join(",");
    let app = apps.get(key);
    if (!app) {
      app = {
        key,
        applicants: al.shares.map((s) => {
          const p = persons.get(s.personId);
          return { personId: s.personId, name: p?.name ?? "", address: p?.address ?? "", phone: p?.phone ?? "", share: kanjiShare(s.numerator, s.denominator) };
        }),
        properties: [],
        taxBase: 0,
        tax: 0,
        exemptLots: [],
        cause: `${death ? death.text : c.decedent.deathDate}相続`,
        decedent: c.decedent.name,
        missing: [],
      };
      apps.set(key, app);
    }
    app.properties.push(prop);
    app.missing.push(...missing);
  }
  for (const app of apps.values()) {
    const taxable = app.properties.filter((p) => !(p.kind === "land" && p.exempt)).reduce((s, p) => s + p.value, 0);
    app.taxBase = floor1000(taxable);
    app.tax = registrationTax(app.taxBase);
    app.exemptLots = app.properties.filter((p): p is Extract<RegProperty, { kind: "land" }> => p.kind === "land" && p.exempt).map((p) => `${p.location}${p.lot}`);
    for (const ap of app.applicants) {
      if (!ap.address) app.missing.push(`${ap.name || "取得する人"}さんの住所`);
    }
  }
  return [...apps.values()];
}
