/**
 * 第6表（未成年者控除額・障害者控除額の計算書）、第9表（生命保険金などの明細書）、
 * 第10表（退職手当金などの明細書）、第11・11の2表の付表1（小規模宅地等についての課税価格の計算明細書）。
 * 金額はすべて計算エンジンの結果をそのまま写す（ここでは計算し直さない）。
 */
import type { PersonTax, TaxResult } from "@/domain/tax/engine";
import type { Case, DeemedAsset } from "@/domain/types";
import { yen } from "./format";
import type { PageFill } from "./render";

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const sqm = (n: number) => (Math.round(n * 100) / 100).toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- 第9表・第10表

function deemedPages(c: Case, r: TaxResult, kind: "insurance" | "retirement"): PageFill[] {
  const assets = c.assets.filter((a): a is DeemedAsset => a.kind === kind);
  if (assets.length === 0) return [];
  const page = kind === "insurance" ? "t09" : "t10";
  const name = new Map(c.persons.map((p) => [p.id, p.name]));
  const received = (p: PersonTax) => (kind === "insurance" ? p.insurance : p.retirement);
  const exempt = (p: PersonTax) => (kind === "insurance" ? p.insuranceExempt : p.retirementExempt);
  // 2 課税される金額の計算：相続人（放棄した人を除く）が受け取った場合だけ記入する
  const heirs = r.persons.filter((p) => p.isCivilHeir && received(p) > 0);
  const limit = kind === "insurance" ? r.insuranceExemptLimit : r.retirementExemptLimit;
  const rowPages = chunk(assets, 5);
  const heirPages = chunk(heirs, 5);
  const n = Math.max(rowPages.length, heirPages.length, 1);
  const pages: PageFill[] = [];
  for (let i = 0; i < n; i++) {
    const values: PageFill["values"] = { "d.name": c.decedent.name };
    (rowPages[i] ?? []).forEach((a, j) => {
      values[`r${j}.company`] = a.label;
      if (kind === "retirement") values[`r${j}.kind`] = "退職手当金";
      values[`r${j}.amount`] = yen(a.amount);
      values[`r${j}.recipient`] = name.get(a.recipientId) ?? "";
    });
    if (i === 0 && heirs.length > 0) {
      values.count = r.legalHeirCount;
      values.limit = yen(limit, ",000,000");
      values["total.received"] = yen(sum(heirs.map(received)));
      values["total.exempt"] = yen(sum(heirs.map(exempt)));
      values["total.taxable"] = yen(sum(heirs.map((p) => received(p) - exempt(p))));
    }
    (heirPages[i] ?? []).forEach((p, j) => {
      values[`h${j}.name`] = p.person.name;
      values[`h${j}.received`] = yen(received(p));
      values[`h${j}.exempt`] = yen(exempt(p));
      values[`h${j}.taxable`] = yen(received(p) - exempt(p));
    });
    pages.push({ page, values });
  }
  return pages;
}

export const build09 = (c: Case, r: TaxResult) => deemedPages(c, r, "insurance");
export const build10 = (c: Case, r: TaxResult) => deemedPages(c, r, "retirement");

// ---------------------------------------------------------------- 第6表

/** 第6表③：第1表の（⑨＋⑪－⑫－⑬）の相続税額（贈与税額控除・配偶者の税額軽減の後）。エンジンの値をそのまま使う */
export const beforeOtherCredits = (p: PersonTax) => p.beforeOtherCredits;

export function build06(c: Case, r: TaxResult): PageFill[] {
  // 相続開始時の年齢はエンジンが計算したもの（亡くなった後に生まれた子は0歳）
  const age = (p: PersonTax) => p.age ?? 0;
  const minors = r.persons.filter((p) => p.minorCredit + p.minorExcess > 0);
  const disabled = r.persons.filter((p) => p.disabilityCredit + p.disabilityExcess > 0);
  if (minors.length === 0 && disabled.length === 0) return [];
  // 一般障害者は左の2列、特別障害者は右の1列
  const general = chunk(disabled.filter((p) => p.person.disability !== "special"), 2);
  const special = chunk(disabled.filter((p) => p.person.disability === "special"), 1);
  const minorPages = chunk(minors, 3);
  const n = Math.max(minorPages.length, general.length, special.length);
  const pages: PageFill[] = [];
  for (let i = 0; i < n; i++) {
    const values: PageFill["values"] = { "d.name": c.decedent.name };
    const ms = minorPages[i] ?? [];
    ms.forEach((p, j) => {
      const years = 18 - age(p);
      values[`m${j}.name`] = p.person.name;
      values[`m${j}.age`] = age(p);
      values[`m${j}.years`] = age(p);
      values[`m${j}.full`] = yen(years * 100_000, "0,000");
      values[`m${j}.tax`] = yen(beforeOtherCredits(p));
      values[`m${j}.excess`] = yen(p.minorExcess);
    });
    if (ms.length > 0) {
      values["m.full"] = yen(sum(ms.map((p) => (18 - age(p)) * 100_000)), "0,000");
      values["m.tax"] = yen(sum(ms.map(beforeOtherCredits)));
      values["m.excess"] = yen(sum(ms.map((p) => p.minorExcess)));
    }
    const gs: [PersonTax, number][] = [...(general[i] ?? []).map((p, j) => [p, j] as [PersonTax, number]), ...(special[i] ?? []).map((p) => [p, 2] as [PersonTax, number])];
    gs.forEach(([p, j]) => {
      values[`g${j}.name`] = p.person.name;
      values[`g${j}.age`] = age(p);
      values[`g${j}.years`] = age(p);
      values[`g${j}.full`] = yen(p.disabilityCredit + p.disabilityExcess, "0,000");
      values[`g${j}.tax`] = yen(beforeOtherCredits(p) - p.minorCredit);
      values[`g${j}.excess`] = yen(p.disabilityExcess);
    });
    if (gs.length > 0) {
      values["g.full"] = yen(sum(gs.map(([p]) => p.disabilityCredit + p.disabilityExcess)), "0,000");
      values["g.tax"] = yen(sum(gs.map(([p]) => beforeOtherCredits(p) - p.minorCredit)));
      values["g.excess"] = yen(sum(gs.map(([p]) => p.disabilityExcess)));
    }
    pages.push({ page: "t06", values });
  }
  return pages;
}

// ---------------------------------------------------------------- 付表1

/**
 * 1 特例の適用にあたっての同意：特例の対象となり得る宅地等を取得した全員の氏名（措置法施行令40条の2第5項3号）。
 * 特例を受ける人だけでなく、自宅の敷地として特例の取得者を選んだ土地・マンションを一緒に取得した人も含める。
 * 並びは申告書の人の順。
 */
export function agreeingPersonIds(r: TaxResult): string[] {
  const ids = new Set<string>();
  for (const l of r.assets) {
    if (l.small && l.reduction > 0) ids.add(l.small.acquirerId);
    const a = l.asset;
    if ((a.kind === "land" || a.kind === "condo") && a.smallResidential?.acquirerId) {
      for (const b of l.byPerson) if (b.amount > 0) ids.add(b.personId);
    }
  }
  const order = new Map(r.persons.map((p, i) => [p.person.id, i]));
  const pos = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...ids].sort((x, y) => pos(x) - pos(y));
}

export function buildF1(c: Case, r: TaxResult): PageFill[] {
  const lots = r.assets.filter((l) => l.small && l.reduction > 0);
  if (lots.length === 0) return [];
  const name = new Map(c.persons.map((p) => [p.id, p.name]));
  const agree = agreeingPersonIds(r).map((id) => name.get(id) ?? "");
  const selected = sum(lots.map((l) => l.small!.selectedArea));
  // 同意欄は1枚に6人まで。7人以上なら2枚目以降の付表1に続けて書く（黙って省かない）
  const lotPages = chunk(lots, 3);
  const agreePages = chunk(agree, 6);
  const n = Math.max(lotPages.length, agreePages.length);
  return Array.from({ length: n }, (_, i) => {
    const group = lotPages[i] ?? [];
    const values: PageFill["values"] = { "d.name": c.decedent.name };
    (agreePages[i] ?? []).forEach((who, j) => (values[`agree${j}`] = who));
    group.forEach((l, j) => {
      const s = l.small!;
      values[`b${j}.kind`] = "1"; // 特定居住用宅地等
      values[`b${j}.acquirer`] = name.get(s.acquirerId) ?? "";
      values[`b${j}.location`] = "location" in l.asset ? l.asset.location : l.asset.label;
      values[`b${j}.area`] = sqm(s.area);
      values[`b${j}.value`] = yen(s.value);
      values[`b${j}.selArea`] = sqm(s.selectedArea);
      values[`b${j}.selValue`] = yen(s.selectedValue);
      values[`b${j}.reduction`] = yen(l.reduction);
      values[`b${j}.taxable`] = yen(s.value - l.reduction);
    });
    if (i === 0) {
      values.area1 = sqm(selected);
      values.limitA = sqm(selected);
    }
    return { page: "t11_11_2_f1", values };
  });
}
