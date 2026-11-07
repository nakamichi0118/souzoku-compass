/**
 * 第11表（相続税がかかる財産の明細書）と付表1〜4への割り当て。
 *
 * 財産の種類ごとに付表を選ぶ：
 *   付表1 土地・家屋（分譲マンションは敷地利用権と区分所有建物の2行）
 *   付表2 有価証券
 *   付表3 現金・預貯金
 *   付表4 家庭用財産・その他（生命保険金等・退職手当金等の課税部分・代償金を含む）
 *
 * 付表1の「特例」欄には、小規模宅地等の特例で減額した土地（マンションは敷地利用権の行）に特例番号「1」
 * （租税特別措置法第69条の4）を書く。マンションの「備考」欄には敷地権の割合（例：10000分の169）を書く。
 * 一部の部屋が空いている貸家建付地などに貸付事業用宅地等の特例を使ったときは、貸している部分（特例の対象）と
 * 空いている部分（自用地として評価・特例の対象外）を別の行にする（splitVacant）。
 * 1つの宅地等を何人かで受け継いで特例を使うときも、宅地等は1行（国税庁 FAQ（相続税申告書第11表）：面積はその土地等の面積、
 * 価額は特例適用後の金額、特例は「1」）にし、取得財産の価額に、特例を使った人はその人の減額を引いた額（付表1の④−⑦）を書く。
 *
 * 分け方が決まっていない（未分割の）部分は、付表の「分割が確定した財産」には書かず、
 * 第11表の合計表の「② 未分割財産の価額」に法定相続分で取得したものとした額を書く。
 */
import type { AssetLine, PersonTax, TaxResult } from "@/domain/tax/engine";
import { area100, usedArea } from "@/domain/area";
import type { Case, LandUse } from "@/domain/types";
import { type Usage, valueAsset } from "@/domain/valuation";
import { smallLines } from "./attachments";
import { yen, yenOrBlank } from "./format";
import type { PageFill, PageKey } from "./render";

const ROWS_PER_PAGE = 8;
/** 地目 → 第15表の番号（①田 ②畑 ③宅地 ④山林 ⑤その他の土地） */
const LAND_CAT: Record<string, number> = { 田: 1, 畑: 2, 宅地: 3, 山林: 4, 雑種地: 5, その他: 5 };
const ACQ_PER_ROW = 3;
/** 土地の使い方 → 第11表の利用区分 */
const LAND_USAGE: Record<LandUse, Usage> = {
  self: "自用地",
  rentedHouse: "貸家建付地",
  leasedLand: "貸宅地",
  leasehold: "借地権",
  rentedLeasehold: "貸家建付借地権",
};
/** 付表1の「特例」欄の特例番号（申告のしかたの「特例番号表」。1 ＝ 租税特別措置法第69条の4 小規模宅地等の特例） */
const SMALL_LAND_SPECIAL_NO = "1";

/** 付表の1項目（財産の明細＋分割が確定した取得者） */
export interface ScheduleItem {
  values: Record<string, string | number | undefined>;
  value: number;
  /** 第15表の番号（①〜㉘） */
  cat: number;
  /** 分割が確定した取得者と取得価額（付表の「分割が確定した財産」欄）。空なら全部未分割。代償金を払う人はマイナス */
  acquirers: { personId: string; amount: number }[];
  /** 未分割の部分を法定相続分で取得したものとした価額。付表には書かず、第11表の合計表②と第15表に入れる */
  undivided: { personId: string; amount: number }[];
  /** マンションを2行に分けたときの、どちらの行か（site 敷地利用権、building 区分所有建物）。付表には書かない */
  part?: "site" | "building";
}

type Part = { personId: string; amount: number; undivided: boolean };

/** 所在地を「都道府県」「市区町村」「大字・丁目」「地番等」に分ける（表示用の簡易分割） */
export function splitLocation(loc: string) {
  let rest = loc.trim();
  const pref = rest.match(/^(東京都|北海道|京都府|大阪府|[^\s都道府県]{2,3}県)/)?.[1] ?? "";
  rest = rest.slice(pref.length);
  const city = rest.match(/^([^\s]+?市[^\s]+?区|[^\s]+?郡[^\s]+?[町村]|[^\s]+?[市区町村])/)?.[1] ?? "";
  rest = rest.slice(city.length);
  // 「梅田3丁目1番」のように丁目を数字で書いたときも、丁目までを大字・丁目に含める
  const chome = rest.match(/^(.*?[0-9０-９]+丁目)(.*)$/);
  if (chome) return { pref, city, town: chome[1], lot: chome[2].trim() };
  const m = rest.match(/^(.*?)([0-9０-９].*)$/);
  return { pref, city, town: m ? m[1] : rest, lot: m ? m[2] : "" };
}

/**
 * 取得者ごとの価額を、分割が確定した部分と未分割の部分に分ける。
 * エンジンの byPerson は両方を合わせた額（小規模宅地等の減額は分割が確定した部分から引いてある）
 */
function partsOf(line: AssetLine): Part[] {
  const und = new Map<string, number>();
  for (const u of line.undivided ?? []) und.set(u.personId, (und.get(u.personId) ?? 0) + u.amount);
  const out: Part[] = [];
  for (const b of line.byPerson) {
    const u = und.get(b.personId) ?? 0;
    if (b.amount - u !== 0) out.push({ personId: b.personId, amount: b.amount - u, undivided: false });
    if (u !== 0) out.push({ personId: b.personId, amount: u, undivided: true });
  }
  return out;
}

function item(cat: number, value: number, parts: Part[], values: ScheduleItem["values"]): ScheduleItem {
  const pick = (undivided: boolean) => parts.filter((p) => p.undivided === undivided).map(({ personId, amount }) => ({ personId, amount }));
  return { cat, value, values, acquirers: pick(false), undivided: pick(true) };
}

/**
 * 登記簿の「敷地権の種類と割合」（例：所有権　10000分の169）から、割合だけを「10000分の169」の形で取り出す。
 * 「169/10000」と書いたものも同じ形にする。割合の形でなければ入力のまま、なければ空欄
 */
export function siteRightRatio(siteRight: string | undefined): string {
  const t = (siteRight ?? "").trim();
  if (!t) return "";
  const num = "([0-9０-９][0-9０-９,，]*)";
  const clean = (x: string) => x.replace(/[,，]/g, "");
  const m = t.match(new RegExp(`${num}\\s*分の\\s*${num}`));
  if (m) return `${clean(m[1])}分の${clean(m[2])}`;
  const s = t.match(new RegExp(`${num}\\s*[/／]\\s*${num}`));
  if (s) return `${clean(s[2])}分の${clean(s[1])}`;
  return t;
}

/** 整数 a × b ÷ d（1円未満切捨て）。桁あふれしないよう BigInt で計算する */
const mulDiv = (a: number, b: number, d: number) => (d > 0 ? Number((BigInt(a) * BigInt(b)) / BigInt(d)) : 0);

/** 面積（㎡）の表示。0.01㎡単位で持った値を「120」「16.8」のように書く */
/** 面積（㎡）。計算と同じく0.01㎡未満は切り捨て */
const areaText = (sqm: number) => usedArea(sqm).toLocaleString("ja-JP", { maximumFractionDigits: 2 });

/** 特例を使う人の、分け方で決まった持分（エンジンと同じく、最後の分け方の、その人の最初の正しい割合） */
function srShare(c: Case, assetId: string, personId: string) {
  let shares: Case["allocations"][number]["shares"] = [];
  for (const al of c.allocations) if (al.assetId === assetId) shares = al.shares;
  return shares.find((s) => s.personId === personId && Number.isInteger(s.numerator) && Number.isInteger(s.denominator) && s.numerator > 0 && s.denominator > 0);
}

/**
 * 一部の部屋が空いている貸家建付地・貸家建付借地権（マンションの人に貸している部屋の敷地を含む）に貸付事業用宅地等の
 * 特例を使ったときは、特例を使う人の分を次の2行に分ける（ほかの人が取得した分は、もとの利用区分のまま3行目にまとめる）。
 *   1行目 貸している部分：特例の対象。価額は付表1の⑧（④ − ⑦）。付表1の注4「⑧欄の金額を第11表の付表1の価額欄に転記」
 *   2行目 空いている部分：特例の対象外。自用地（貸家建付借地権は借地権）として評価した額。別表1の「3 特例の対象とならない宅地等」
 * 1つの宅地等を何人かで受け継いで、それぞれが特例を使うときは、1行目・2行目に特例を使う人を並べ、取得財産の価額は
 * 人ごとに書く（1行目はその人の⑧、2行目はその人の持分の空いている部分の額）。
 * 各行の価額の合計（＝第11表・第15表に入る額）と、取得者ごとの金額の合計は、1行で書いたときと変わらない。
 * 分けられないとき（空いている部分の価額が出ないなど）は undefined（これまでどおり1行で書く）
 */
function splitVacant(
  c: Case,
  line: AssetLine,
  base: { cat: number; value: number; parts: Part[]; values: ScheduleItem["values"]; lotArea: number; vacantUse: Usage; vacantNote?: string },
): ScheduleItem[] | undefined {
  const a = line.asset;
  const srs = smallLines(line);
  const rentedLand = line.valuation.rentedLandPart;
  const partlyRented =
    a.kind === "land" ? (a.use === "rentedHouse" || a.use === "rentedLeasehold") && (a.rentRatio ?? 1) < 1 : a.kind === "condo" && !!a.rented && (a.rentRatio ?? 1) < 1;
  if (!srs.length || srs.some((x) => x.detail.kind !== "rental") || rentedLand === undefined || !partlyRented) return undefined;
  const lot100 = area100(base.lotArea);
  const rest = [...base.parts];
  const rentedParts: Part[] = [];
  const vacantParts: Part[] = [];
  let rented100 = 0;
  let vacant100 = 0;
  let shares100 = 0;
  for (const { detail: s, reduction } of srs) {
    const k = rest.findIndex((p) => p.personId === s.acquirerId && !p.undivided);
    if (k < 0) return undefined;
    const [sr] = rest.splice(k, 1);
    // 特例を使う人の持分に応じた面積（エンジンと同じく 0.01㎡ 単位）。持分が分からず、ほかに取得した人もいなければ全部
    const share = srShare(c, a.id, s.acquirerId) ?? (base.parts.length === 1 ? { numerator: 1, denominator: 1 } : undefined);
    if (!share) return undefined;
    const share100 = area100((base.lotArea * share.numerator) / share.denominator);
    const r100 = area100(s.area);
    const rentedValue = s.value - reduction; // 付表1の⑧
    const vacantValue = sr.amount + reduction - s.value; // 持分の価額 − 貸している部分の価額（④）
    if (!(rentedValue >= 0) || !(vacantValue > 0) || !(share100 > r100)) return undefined;
    rentedParts.push({ personId: sr.personId, amount: rentedValue, undivided: false });
    vacantParts.push({ personId: sr.personId, amount: vacantValue, undivided: false });
    rented100 += r100;
    vacant100 += share100 - r100;
    shares100 += share100;
  }
  const pick = (ps: Part[]) => ({
    acquirers: ps.filter((p) => !p.undivided).map(({ personId, amount }) => ({ personId, amount })),
    undivided: ps.filter((p) => p.undivided).map(({ personId, amount }) => ({ personId, amount })),
  });
  const total = (ps: Part[]) => ps.reduce((t, p) => t + p.amount, 0);
  const rentedValue = total(rentedParts);
  const vacantValue = total(vacantParts);
  const out: ScheduleItem[] = [
    { cat: base.cat, value: rentedValue, values: { ...base.values, area: areaText(rented100 / 100), special: SMALL_LAND_SPECIAL_NO }, ...pick(rentedParts) },
    {
      cat: base.cat,
      value: vacantValue,
      values: { ...base.values, use: base.vacantUse, area: areaText(vacant100 / 100), fixed: "", special: "", ...(base.vacantNote ? { note: base.vacantNote } : {}) },
      ...pick(vacantParts),
    },
  ];
  const othersValue = base.value - rentedValue - vacantValue;
  if (rest.length || othersValue !== 0)
    out.push({ cat: base.cat, value: othersValue, values: { ...base.values, area: areaText(Math.max(0, lot100 - shares100) / 100), fixed: "", special: "" }, ...pick(rest) });
  return out;
}

function landItems(c: Case, line: AssetLine): ScheduleItem[] {
  const a = line.asset;
  const parts = partsOf(line);
  if (a.kind === "land") {
    const loc = splitLocation(a.location);
    const m = a.method;
    const cat = LAND_CAT[a.landUse];
    const value = line.valuation.value - line.reduction;
    // 利用区分：自用地・貸家建付地・貸宅地・借地権（評価の計算で決まったもの。なければ土地の使い方から）
    const use = line.valuation.usage ?? LAND_USAGE[a.use ?? "self"];
    const values: ScheduleItem["values"] = {
      kind: a.landUse,
      use,
      ...loc,
      area: areaText(a.areaSqm),
      unit: m.type === "rosenka" ? yen(line.valuation.unitPrice) : m.type === "multiplier" ? `${m.multiplier}倍` : "",
      fixed: m.type === "multiplier" ? yen(m.fixedAssetValue) : "",
      special: line.reduction > 0 ? SMALL_LAND_SPECIAL_NO : "",
    };
    // 空いている部分は自用地として評価する（貸家建付借地権の土地なら、自分で使っている借地権）
    const vacantUse: Usage = a.use === "rentedLeasehold" ? "借地権" : "自用地";
    return splitVacant(c, line, { cat, value, parts, values, lotArea: a.areaSqm, vacantUse, vacantNote: "空室部分" }) ?? [item(cat, value, parts, values)];
  }
  if (a.kind === "building") {
    const loc = splitLocation(a.location);
    return [
      item(10, line.valuation.value, parts, {
        kind: "家屋",
        use: line.valuation.usage ?? (a.rented ? "貸家" : "自用家屋"),
        ...loc,
        unit: "1.0倍",
        fixed: yen(a.fixedAssetValue),
      }),
    ];
  }
  if (a.kind === "condo") {
    // 敷地利用権（土地）と区分所有建物（家屋）に分けて記載する
    const loc = splitLocation(a.location);
    const total = line.valuation.value;
    const land = valueAsset({ ...a, buildingFixedAssetValue: 0 }).value;
    // 特例を使う人ごとの減額（付表1の⑦）。何人かで受け継いでそれぞれが使うときは、その人の分だけ
    const cuts = new Map<string, number>();
    for (const x of smallLines(line)) cuts.set(x.detail.acquirerId, (cuts.get(x.detail.acquirerId) ?? 0) + x.reduction);
    const landParts: Part[] = [];
    const bldgParts: Part[] = [];
    for (const p of parts) {
      // 価額は小規模宅地等の減額後。減額前に戻してから土地・家屋に按分し、減額は敷地利用権の行から差し引く
      const cut = p.undivided ? 0 : (cuts.get(p.personId) ?? 0);
      const gross = p.amount + cut;
      const landGross = mulDiv(Math.max(0, gross), Math.max(0, land), total);
      landParts.push({ ...p, amount: landGross - cut });
      bldgParts.push({ ...p, amount: gross - landGross });
    }
    // 按分の端数（1円未満の切捨て）で、各行の価額と取得者ごとの金額の合計がずれないように、
    // ずれた分を1人の土地と家屋の間で付け替える（その人の合計額は変わらない）
    const diff = land - line.reduction - landParts.reduce((s, b) => s + b.amount, 0);
    if (diff !== 0) {
      const i = bldgParts.findIndex((b, k) => b.amount - diff >= 0 && landParts[k].amount + diff >= 0);
      if (i >= 0) {
        landParts[i].amount += diff;
        bldgParts[i].amount -= diff;
      }
    }
    const siteValues: ScheduleItem["values"] = {
      kind: "宅地",
      // 人に貸している部屋の敷地利用権は貸家建付地、部屋は貸家
      use: a.rented ? "貸家建付地" : "自用地",
      ...loc,
      area: areaText(a.landShareSqm),
      special: line.reduction > 0 ? SMALL_LAND_SPECIAL_NO : "",
      // 区分所有の財産は、備考に敷地利用権（敷地権）の割合を書く。登記簿の割合が入っていなければ空欄（手書きで記入する）
      note: siteRightRatio(a.registry?.siteRight),
    };
    // 一部の部屋が空いていて貸付事業用宅地等の特例を使うときは、敷地利用権の行を貸している部分と空いている部分（自用地）に分ける
    const sites = splitVacant(c, line, { cat: 3, value: land - line.reduction, parts: landParts, values: siteValues, lotArea: a.landShareSqm, vacantUse: "自用地" }) ?? [
      item(3, land - line.reduction, landParts, siteValues),
    ];
    return [
      ...sites.map((it) => ({ ...it, part: "site" as const })),
      {
        ...item(10, total - land, bldgParts, {
          kind: "家屋",
          use: a.rented ? "貸家" : "自用家屋",
          ...loc,
          area: areaText(a.exclusiveAreaSqm),
          fixed: yen(a.buildingFixedAssetValue),
          note: "区分所有",
        }),
        part: "building" as const,
      },
    ];
  }
  return [];
}

function stockItems(line: AssetLine): ScheduleItem[] {
  const a = line.asset;
  if (a.kind !== "listedStock" && a.kind !== "unlistedStock") return [];
  return [
    item(a.kind === "listedStock" ? 19 : 18, line.valuation.value, partsOf(line), {
      kind: a.kind === "listedStock" ? "上場株式" : "取引相場のない株式",
      brand: a.label,
      qty: a.shares.toLocaleString("ja-JP"),
      unit: a.kind === "listedStock" ? yen(line.valuation.unitPrice) : "",
      note: "",
    }),
  ];
}

function moneyItems(line: AssetLine): ScheduleItem[] {
  const a = line.asset;
  if (a.kind !== "deposit" && a.kind !== "cash") return [];
  return [
    item(
      23,
      line.valuation.value,
      partsOf(line),
      a.kind === "cash"
        ? { type: "現金", place: a.label }
        : {
            type: a.accountType ?? "預貯金",
            bank: a.institution ?? a.label,
            branch: a.branch,
            place: a.accruedInterest ? `既経過利息 ${yen(a.accruedInterest)}円を含む` : "",
          },
    ),
  ];
}

function otherItems(line: AssetLine): ScheduleItem[] {
  const a = line.asset;
  if (a.kind !== "household" && a.kind !== "other") return [];
  return [
    item(a.kind === "household" ? 24 : 28, line.valuation.value, partsOf(line), {
      kind: a.kind === "household" ? "家庭用財産" : "その他の財産",
      name: a.label,
    }),
  ];
}

/** 生命保険金等・退職手当金等は受取人ごとに、非課税金額を差し引いた課税部分を記載する（第9表・第10表④） */
function deemedItems(persons: PersonTax[]): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  for (const p of persons) {
    const ins = p.insurance - p.insuranceExempt;
    if (ins > 0)
      items.push({
        cat: 25,
        value: ins,
        acquirers: [{ personId: p.person.id, amount: ins }],
        undivided: [],
        values: { kind: "生命保険金等", name: "生命保険金等（第9表の課税金額）" },
      });
    const ret = p.retirement - p.retirementExempt;
    if (ret > 0)
      items.push({
        cat: 26,
        value: ret,
        acquirers: [{ personId: p.person.id, amount: ret }],
        undivided: [],
        values: { kind: "退職手当金等", name: "退職手当金等（第10表の課税金額）" },
      });
  }
  return items;
}

/**
 * 代償金（代償分割）。国税庁「相続税の申告のしかた」に従い、第11表の付表4に細目「代償財産」として1件ずつ書く。
 * 価額は「0」、取得財産の価額は、払う人はマイナス（△）、受け取る人はプラスで書く。第15表では「その他」（㉘）に入れる。
 * 金額はエンジンが課税価格に入れた額（TaxResult.compensation の value）。代償金を土地などの時価をもとに決めたときは
 * 代償金 × その財産の評価額 ÷ 時価 になり、協議書に書く代償金の額（amount）とは違うことがある（相基通11の2-10(2)）。
 * エンジンが足し引きしたもの（1円以上・払う人と受け取る人が別の、計算に入っている人）だけを載せる
 */
function compensationItems(c: Case, r: TaxResult): ScheduleItem[] {
  const ids = new Set(r.persons.map((p) => p.person.id));
  const name = new Map(c.persons.map((p) => [p.id, p.name]));
  return r.compensation
    .filter((x) => Number.isSafeInteger(x.value) && x.value > 0 && x.fromId !== x.toId && ids.has(x.fromId) && ids.has(x.toId))
    .map((x) => ({
      cat: 28,
      value: 0,
      acquirers: [
        { personId: x.fromId, amount: -x.value },
        { personId: x.toId, amount: x.value },
      ],
      undivided: [],
      values: { kind: "代償財産", name: "代償金", place: `${name.get(x.fromId) ?? ""}が${name.get(x.toId) ?? ""}に支払うもの` },
    }));
}

/** 付表1〜4に載せる財産（付表ごと） */
function allItems(c: Case, r: TaxResult) {
  const lines = r.assets;
  return {
    land: lines.flatMap((l) => landItems(c, l)),
    stock: lines.flatMap(stockItems),
    money: lines.flatMap(moneyItems),
    other: [...lines.flatMap(otherItems), ...deemedItems(r.persons), ...compensationItems(c, r)],
  };
}

/** 付表のページを組み立てる。取得者が3人を超える財産は次の行に続けて記載する */
function schedulePages(page: PageKey, decedentName: string, items: ScheduleItem[], acquirerNo: Map<string, number>): PageFill[] {
  type Row = { item?: ScheduleItem; no?: number; acq: ScheduleItem["acquirers"] };
  const rows: Row[] = [];
  items.forEach((item, idx) => {
    const acq = item.acquirers.filter((a) => a.amount !== 0);
    const n = Math.max(1, Math.ceil(acq.length / ACQ_PER_ROW));
    for (let k = 0; k < n; k++) {
      rows.push({ item: k === 0 ? item : undefined, no: k === 0 ? idx + 1 : undefined, acq: acq.slice(k * ACQ_PER_ROW, (k + 1) * ACQ_PER_ROW) });
    }
  });
  const pages: PageFill[] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    const values: PageFill["values"] = { "d.name": decedentName };
    rows.slice(i, i + ROWS_PER_PAGE).forEach((r, j) => {
      if (r.item) {
        values[`i${j}.no`] = r.no;
        values[`i${j}.value`] = yen(r.item.value);
        for (const [k, v] of Object.entries(r.item.values)) values[`i${j}.${k}`] = v;
      }
      r.acq.forEach((a, k) => {
        values[`i${j}.a${k}.no`] = acquirerNo.get(a.personId);
        values[`i${j}.a${k}.value`] = yen(a.amount);
      });
    });
    pages.push({ page, values });
  }
  return pages;
}

/** 遺産の分割状況：1 全部分割、2 一部分割、3 全部未分割（保険金・退職金・代償金は分割の対象外なので数えない） */
export function divisionStatus(r: TaxResult): "1" | "2" | "3" {
  const lines = r.assets.filter((l) => l.asset.kind !== "insurance" && l.asset.kind !== "retirement");
  const und = (l: AssetLine) => (l.undivided ?? []).some((u) => u.amount !== 0) || l.byPerson.length === 0;
  const div = (l: AssetLine) => partsOf(l).some((p) => !p.undivided);
  if (!lines.some(und)) return "1";
  return lines.some(div) ? "2" : "3";
}

export function buildSchedule11(c: Case, r: TaxResult): PageFill[] {
  const { land, stock, money, other } = allItems(c, r);
  // 財産を取得した人の一覧（第11表の項番）。付表に名前が出る人（代償金を払う人・未分割の財産を法定相続分で取得した人を含む）
  const onSchedule = new Set([land, stock, money, other].flat().flatMap((it) => [...it.acquirers, ...it.undivided].filter((a) => a.amount !== 0).map((a) => a.personId)));
  const acquirers = r.persons.filter((p) => p.acquired > 0 || p.inherited > 0 || p.insurance > 0 || p.retirement > 0 || onSchedule.has(p.person.id));
  const acquirerNo = new Map(acquirers.map((p, i) => [p.person.id, i + 1]));

  const pages: PageFill[] = [];
  for (let i = 0; i < Math.max(1, acquirers.length); i += 10) {
    const values: PageFill["values"] = {
      "d.name": c.decedent.name,
      divStatus: divisionStatus(r),
    };
    acquirers.slice(i, i + 10).forEach((p, j) => {
      const no = i + j + 1;
      values[`l${j}.no`] = no;
      values[`l${j}.name`] = p.person.name;
      values[`s${j}.no`] = no;
      // ① 分割財産の価額 ＝ 付表1〜4の「分割が確定した財産」の合計、② 未分割財産の価額（法定相続分で取得したものとした額）、
      // ③ ①＋② ＝ 第1表①へ転記
      values[`s${j}.divided`] = yen(p.acquired - p.undivided);
      values[`s${j}.undivided`] = yenOrBlank(p.undivided);
      values[`s${j}.total`] = yen(p.acquired);
    });
    pages.push({ page: "t11", values });
  }

  const name = c.decedent.name;
  if (land.length) pages.push(...schedulePages("t11_f1", name, land, acquirerNo));
  if (stock.length) pages.push(...schedulePages("t11_f2", name, stock, acquirerNo));
  if (money.length) pages.push(...schedulePages("t11_f3", name, money, acquirerNo));
  if (other.length) pages.push(...schedulePages("t11_f4", name, other, acquirerNo));
  return pages;
}

/**
 * 付表に載せた財産の取得価額の合計（第11表の合計表と一致することの検算用）。
 * byPerson は未分割の部分を含む額（第1表①）、dividedByPerson は付表の「分割が確定した財産」の合計（合計表①）
 */
export function scheduleTotals(c: Case, r: TaxResult) {
  const { land, stock, money, other } = allItems(c, r);
  const items = [...land, ...stock, ...money, ...other];
  const byPerson = new Map<string, number>();
  const dividedByPerson = new Map<string, number>();
  const add = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v);
  for (const it of items) {
    for (const a of it.acquirers) {
      add(byPerson, a.personId, a.amount);
      add(dividedByPerson, a.personId, a.amount);
    }
    for (const a of it.undivided) add(byPerson, a.personId, a.amount);
  }
  return { items, byPerson, dividedByPerson };
}
