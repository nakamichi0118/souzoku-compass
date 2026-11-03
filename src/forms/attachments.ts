/**
 * 第6表（未成年者控除額・障害者控除額の計算書）、第7表（相次相続控除額の計算書）、第9表（生命保険金などの明細書）、
 * 第10表（退職手当金などの明細書）、第11・11の2表の付表1（小規模宅地等についての課税価格の計算明細書）と付表1（続）。
 * 金額は計算エンジンの結果をそのまま写す（第7表の各人の按分額だけは、様式の⑨×⑫を整数で計算して書く）。
 */
import type { AssetLine, PersonTax, TaxResult } from "@/domain/tax/engine";
import type { Case, DeemedAsset, SmallLandKind } from "@/domain/types";
import { wareki, yen } from "./format";
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

/** 扶養義務者として、ほかの人の引ききれない未成年者控除・障害者控除を自分の相続税額から引いた額（第6表⑥） */
const transferredIn = (p: PersonTax, kind: "minor" | "disability") => sum(p.transfersIn.filter((t) => t.kind === kind).map((t) => t.amount));

/** 第8の8表1の① 未成年者控除額（本人の分と、扶養義務者として引いた分） */
const minorTotal = (p: PersonTax) => p.minorCredit + transferredIn(p, "minor");

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
  // 扶養義務者の相続税額から控除する分（1枚に3人まで）
  const minorSupporters = chunk(r.persons.filter((p) => transferredIn(p, "minor") > 0), 3);
  const disabilitySupporters = chunk(r.persons.filter((p) => transferredIn(p, "disability") > 0), 3);
  const n = Math.max(minorPages.length, general.length, special.length, minorSupporters.length, disabilitySupporters.length);
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
    // ⑤ 扶養義務者の（⑨＋⑪－⑫－⑬）の相続税額、⑥ その人から引く未成年者控除額
    const sm = minorSupporters[i] ?? [];
    sm.forEach((p, j) => {
      values[`s${j}.name`] = p.person.name;
      values[`s${j}.tax`] = yen(beforeOtherCredits(p));
      values[`s${j}.credit`] = yen(transferredIn(p, "minor"));
    });
    if (sm.length > 0) {
      values["s.tax"] = yen(sum(sm.map(beforeOtherCredits)));
      values["s.credit"] = yen(sum(sm.map((p) => transferredIn(p, "minor"))));
    }
    // 障害者控除の③⑤は、相続税額から第8の8表1の①（未成年者控除額。扶養義務者として引いた分を含む）を引いた額
    const afterMinor = (p: PersonTax) => beforeOtherCredits(p) - minorTotal(p);
    const gs: [PersonTax, number][] = [...(general[i] ?? []).map((p, j) => [p, j] as [PersonTax, number]), ...(special[i] ?? []).map((p) => [p, 2] as [PersonTax, number])];
    gs.forEach(([p, j]) => {
      values[`g${j}.name`] = p.person.name;
      values[`g${j}.age`] = age(p);
      values[`g${j}.years`] = age(p);
      values[`g${j}.full`] = yen(p.disabilityCredit + p.disabilityExcess, "0,000");
      values[`g${j}.tax`] = yen(afterMinor(p));
      values[`g${j}.excess`] = yen(p.disabilityExcess);
    });
    if (gs.length > 0) {
      values["g.full"] = yen(sum(gs.map(([p]) => p.disabilityCredit + p.disabilityExcess)), "0,000");
      values["g.tax"] = yen(sum(gs.map(([p]) => afterMinor(p))));
      values["g.excess"] = yen(sum(gs.map(([p]) => p.disabilityExcess)));
    }
    const sd = disabilitySupporters[i] ?? [];
    sd.forEach((p, j) => {
      values[`t${j}.name`] = p.person.name;
      values[`t${j}.tax`] = yen(afterMinor(p));
      values[`t${j}.credit`] = yen(transferredIn(p, "disability"));
    });
    if (sd.length > 0) {
      values["t.tax"] = yen(sum(sd.map(afterMinor)));
      values["t.credit"] = yen(sum(sd.map((p) => transferredIn(p, "disability"))));
    }
    pages.push({ page: "t06", values });
  }
  return pages;
}

// ---------------------------------------------------------------- 第7表

/** 割合を小数点以下10桁まで（切捨て）の文字にする。1 のときは「1.00」 */
function ratioDecimal(n: number, d: number): string {
  if (d <= 0) return "";
  const unit = 10n ** 10n;
  const scaled = (BigInt(n) * unit) / BigInt(d);
  if (scaled >= unit) return "1.00";
  const frac = scaled.toString().padStart(10, "0").replace(/0+$/, "");
  return `0.${frac || "0"}`;
}

/**
 * 第7表（相次相続控除額の計算書）の「1 相次相続控除額の総額の計算」と「2(1) 一般の場合」。
 * 前の相続で亡くなった方の氏名・続柄・申告書の提出先は相続コンパスで聞いていないため空欄（手書きで記入する）。
 * 各人の⑬は ⑨×⑩/Ⓑ（1円未満切捨て）。第8の8表では、各人の相続税額を上限に引く（エンジンの相次相続控除額）
 */
export function build07(c: Case, r: TaxResult): PageFill[] {
  const s = r.successive;
  if (!s || !r.persons.some((p) => p.successiveCredit > 0)) return [];
  const prev = wareki(c.decedent.priorInheritance?.date);
  const death = wareki(c.decedent.deathDate);
  const heirs = r.persons.filter((p) => p.isCivilHeir && p.net > 0);
  const pages: PageFill[] = [];
  chunk(heirs, 5).forEach((group, i) => {
    const values: PageFill["values"] = { "d.name": c.decedent.name };
    if (i === 0) {
      Object.assign(values, {
        prevEra: prev?.code,
        prevY: prev?.year,
        prevM: prev?.month,
        prevD: prev?.day,
        deathEra: death?.code,
        deathY: death?.year,
        deathM: death?.month,
        deathD: death?.day,
        r03: s.years,
        r04: 10 - s.years,
        r05: yen(s.prevAcquired),
        r06: yen(s.prevTax),
        r07: yen(s.prevAcquired - s.prevTax),
        r08: yen(s.netTotal),
        "x.tax": yen(s.prevTax),
        "x.net": yen(s.netTotal),
        "x.base": yen(s.prevAcquired - s.prevTax),
        "x.years": 10 - s.years,
        total: yen(s.total),
      });
    }
    values.r09 = yen(s.total);
    values.r11 = yen(s.netTotal);
    group.forEach((p, j) => {
      values[`h${j}.name`] = p.person.name;
      values[`h${j}.net`] = yen(p.net);
      values[`h${j}.ratio`] = ratioDecimal(p.net, s.netTotal);
      values[`h${j}.credit`] = yen(s.netTotal > 0 ? Number((BigInt(s.total) * BigInt(p.net)) / BigInt(s.netTotal)) : 0);
    });
    pages.push({ page: "t07", values });
  });
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

/** 小規模宅地等の種類の番号（1 特定居住用宅地等、2 特定事業用宅地等、4 貸付事業用宅地等。3 特定同族会社事業用は扱わない） */
const KIND_NO: Record<SmallLandKind, string> = { residence: "1", business: "2", rental: "4" };

/** ① の「事業内容」。貸付事業用は貸しているものから書く。特定事業用は事業の内容を聞いていないため空欄（手書きで記入する） */
function businessText(l: AssetLine): string {
  if (l.small?.kind !== "rental") return "";
  const a = l.asset;
  return a.kind === "land" && a.use === "leasedLand" ? "貸地" : "貸家";
}

/** 付表1に書ける宅地等の数と同意の氏名の数。書ききれない分は付表1（続）に書く（付表1は3件・6人、付表1（続）は5件・6人） */
const F1_LOTS = 3;
const F1C_LOTS = 5;
const F1_NAMES = 6;

export function buildF1(c: Case, r: TaxResult): PageFill[] {
  const lots = r.assets.filter((l) => l.small && l.reduction > 0);
  if (lots.length === 0) return [];
  const name = new Map(c.persons.map((p) => [p.id, p.name]));
  const agree = agreeingPersonIds(r).map((id) => name.get(id) ?? "");
  // ⑩ 種類ごとの「⑤選択した面積」の合計
  const areaOf = (k: SmallLandKind) => sum(lots.filter((l) => l.small!.kind === k).map((l) => l.small!.selectedArea));
  const has = (k: SmallLandKind) => lots.some((l) => l.small!.kind === k);
  // 付表1に書ききれない宅地等（4件目から）・同意の氏名（7人目から）は、様式の注意書きどおり付表1（続）に続けて書く（黙って省かない）
  const restLots = chunk(lots.slice(F1_LOTS), F1C_LOTS);
  const restNames = chunk(agree.slice(F1_NAMES), F1_NAMES);
  const fill = (values: PageFill["values"], names: string[], group: AssetLine[]) => {
    names.forEach((who, j) => (values[`agree${j}`] = who));
    group.forEach((l, j) => {
      const s = l.small!;
      // 減額割合（⑨）は種類ごとに様式に印字済み（80/100・50/100）
      values[`b${j}.kind`] = KIND_NO[s.kind];
      values[`b${j}.acquirer`] = name.get(s.acquirerId) ?? "";
      values[`b${j}.business`] = businessText(l);
      values[`b${j}.location`] = "location" in l.asset ? l.asset.location : l.asset.label;
      values[`b${j}.area`] = sqm(s.area);
      values[`b${j}.value`] = yen(s.value);
      values[`b${j}.selArea`] = sqm(s.selectedArea);
      values[`b${j}.selValue`] = yen(s.selectedValue);
      values[`b${j}.reduction`] = yen(l.reduction);
      values[`b${j}.taxable`] = yen(s.value - l.reduction);
    });
    return values;
  };
  const first = fill({ "d.name": c.decedent.name }, agree.slice(0, F1_NAMES), lots.slice(0, F1_LOTS));
  // 「限度面積要件」の判定（付表1だけにある欄）：⑩ 種類ごとの面積の合計、⑪ 貸付事業用宅地等がなければイ、あればロ
  if (has("residence")) first.area1 = sqm(areaOf("residence"));
  if (has("business")) first.area2 = sqm(areaOf("business"));
  if (has("rental")) first.area4 = sqm(areaOf("rental"));
  if (!has("rental")) {
    if (has("residence")) first.limitA = sqm(areaOf("residence"));
    if (has("business")) first.limitA2 = sqm(areaOf("business"));
  } else {
    if (has("residence")) first.limitB1 = sqm(areaOf("residence"));
    if (has("business")) first.limitB2 = sqm(areaOf("business"));
    first.limitB4 = sqm(areaOf("rental"));
  }
  const pages: PageFill[] = [{ page: "t11_11_2_f1", values: first }];
  for (let i = 0; i < Math.max(restLots.length, restNames.length); i++) {
    pages.push({ page: "t11_11_2_f1c", values: fill({ "d.name": c.decedent.name }, restNames[i] ?? [], restLots[i] ?? []) });
  }
  return pages;
}
