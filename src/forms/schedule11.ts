/**
 * 第11表（相続税がかかる財産の明細書）と付表1〜4への割り当て。
 *
 * 財産の種類ごとに付表を選ぶ：
 *   付表1 土地・家屋（分譲マンションは敷地利用権と区分所有建物の2行）
 *   付表2 有価証券
 *   付表3 現金・預貯金
 *   付表4 家庭用財産・その他（生命保険金等・退職手当金等の課税部分を含む）
 */
import type { AssetLine, PersonTax, TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { valueAsset } from "@/domain/valuation";
import { yen } from "./format";
import type { PageFill, PageKey } from "./render";

const ROWS_PER_PAGE = 8;
/** 地目 → 第15表の番号（①田 ②畑 ③宅地 ④山林 ⑤その他の土地） */
const LAND_CAT: Record<string, number> = { 田: 1, 畑: 2, 宅地: 3, 山林: 4, 雑種地: 5, その他: 5 };
const ACQ_PER_ROW = 3;

/** 付表の1項目（財産の明細＋分割が確定した取得者） */
export interface ScheduleItem {
  values: Record<string, string | number | undefined>;
  value: number;
  /** 第15表の番号（①〜㉘） */
  cat: number;
  /** 分割が確定した取得者と取得価額。空なら未分割 */
  acquirers: { personId: string; amount: number }[];
}

/** 所在地を「都道府県」「市区町村」「大字・丁目」「地番等」に分ける（表示用の簡易分割） */
export function splitLocation(loc: string) {
  let rest = loc.trim();
  const pref = rest.match(/^(東京都|北海道|京都府|大阪府|[^\s都道府県]{2,3}県)/)?.[1] ?? "";
  rest = rest.slice(pref.length);
  const city = rest.match(/^([^\s]+?市[^\s]+?区|[^\s]+?郡[^\s]+?[町村]|[^\s]+?[市区町村])/)?.[1] ?? "";
  rest = rest.slice(city.length);
  const m = rest.match(/^(.*?)([0-9０-９].*)$/);
  return { pref, city, town: m ? m[1] : rest, lot: m ? m[2] : "" };
}

function landItems(line: AssetLine): ScheduleItem[] {
  const a = line.asset;
  const net = line.byPerson.map((b) => ({ ...b }));
  if (a.kind === "land") {
    const loc = splitLocation(a.location);
    const m = a.method;
    return [
      {
        cat: LAND_CAT[a.landUse],
        value: line.valuation.value - line.reduction,
        acquirers: net,
        values: {
          kind: a.landUse,
          use: "自用地",
          ...loc,
          area: a.areaSqm.toLocaleString("ja-JP", { maximumFractionDigits: 2 }),
          unit: m.type === "rosenka" ? yen(line.valuation.unitPrice) : m.type === "multiplier" ? `${m.multiplier}倍` : "",
          fixed: m.type === "multiplier" ? yen(m.fixedAssetValue) : "",
          note: line.reduction > 0 ? "小規模宅地等" : "",
        },
      },
    ];
  }
  if (a.kind === "building") {
    const loc = splitLocation(a.location);
    return [
      {
        cat: 10,
        value: line.valuation.value,
        acquirers: net,
        values: { kind: "家屋", use: "自用家屋", ...loc, unit: "1.0倍", fixed: yen(a.fixedAssetValue) },
      },
    ];
  }
  if (a.kind === "condo") {
    // 敷地利用権（土地）と区分所有建物（家屋）に分けて記載する
    const loc = splitLocation(a.location);
    const total = line.valuation.value;
    const land = valueAsset({ ...a, buildingFixedAssetValue: 0 }).value;
    const sr = a.smallResidential?.acquirerId;
    const landBy: ScheduleItem["acquirers"] = [];
    const bldgBy: ScheduleItem["acquirers"] = [];
    for (const b of net) {
      // net は小規模宅地等の減額後。減額前に戻してから土地・家屋に按分し、減額は敷地利用権の行から差し引く
      const cut = b.personId === sr ? line.reduction : 0;
      const gross = b.amount + cut;
      const landGross = total ? Math.floor((gross * land) / total) : 0;
      landBy.push({ personId: b.personId, amount: landGross - cut });
      bldgBy.push({ personId: b.personId, amount: gross - landGross });
    }
    return [
      {
        cat: 3,
        value: land - line.reduction,
        acquirers: landBy,
        values: {
          kind: "宅地",
          use: "自用地",
          ...loc,
          area: a.landShareSqm.toLocaleString("ja-JP", { maximumFractionDigits: 2 }),
          note: line.reduction > 0 ? "敷地権・小規模" : "敷地権",
        },
      },
      {
        cat: 10,
        value: total - land,
        acquirers: bldgBy,
        values: {
          kind: "家屋",
          use: "自用家屋",
          ...loc,
          area: a.exclusiveAreaSqm.toLocaleString("ja-JP", { maximumFractionDigits: 2 }),
          fixed: yen(a.buildingFixedAssetValue),
          note: "区分所有",
        },
      },
    ];
  }
  return [];
}

function stockItems(line: AssetLine): ScheduleItem[] {
  const a = line.asset;
  if (a.kind !== "listedStock" && a.kind !== "unlistedStock") return [];
  return [
    {
      cat: a.kind === "listedStock" ? 19 : 18,
      value: line.valuation.value,
      acquirers: line.byPerson,
      values: {
        kind: a.kind === "listedStock" ? "上場株式" : "取引相場のない株式",
        brand: a.label,
        qty: a.shares.toLocaleString("ja-JP"),
        unit: a.kind === "listedStock" ? yen(line.valuation.unitPrice) : "",
        note: "",
      },
    },
  ];
}

function moneyItems(line: AssetLine): ScheduleItem[] {
  const a = line.asset;
  if (a.kind !== "deposit" && a.kind !== "cash") return [];
  return [
    {
      cat: 23,
      value: line.valuation.value,
      acquirers: line.byPerson,
      values:
        a.kind === "cash"
          ? { type: "現金", place: a.label }
          : {
              type: a.accountType ?? "預貯金",
              bank: a.institution ?? a.label,
              branch: a.branch,
              place: a.accruedInterest ? `既経過利息 ${yen(a.accruedInterest)}円を含む` : "",
            },
    },
  ];
}

function otherItems(line: AssetLine): ScheduleItem[] {
  const a = line.asset;
  if (a.kind !== "household" && a.kind !== "other") return [];
  return [
    {
      cat: a.kind === "household" ? 24 : 28,
      value: line.valuation.value,
      acquirers: line.byPerson,
      values: { kind: a.kind === "household" ? "家庭用財産" : "その他の財産", name: a.label },
    },
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
        values: { kind: "生命保険金等", name: "生命保険金等（第9表の課税金額）" },
      });
    const ret = p.retirement - p.retirementExempt;
    if (ret > 0)
      items.push({
        cat: 26,
        value: ret,
        acquirers: [{ personId: p.person.id, amount: ret }],
        values: { kind: "退職手当金等", name: "退職手当金等（第10表の課税金額）" },
      });
  }
  return items;
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

export function buildSchedule11(c: Case, r: TaxResult): PageFill[] {
  // 財産を取得した人の一覧（第11表の項番）
  const acquirers = r.persons.filter((p) => p.acquired > 0 || p.inherited > 0 || p.insurance > 0 || p.retirement > 0);
  const acquirerNo = new Map(acquirers.map((p, i) => [p.person.id, i + 1]));
  const lines = r.assets;
  const undivided = lines.some((l) => l.asset.kind !== "insurance" && l.asset.kind !== "retirement" && l.byPerson.length === 0);
  const divided = lines.some((l) => l.asset.kind !== "insurance" && l.asset.kind !== "retirement" && l.byPerson.length > 0);

  const pages: PageFill[] = [];
  for (let i = 0; i < Math.max(1, acquirers.length); i += 10) {
    const values: PageFill["values"] = {
      "d.name": c.decedent.name,
      divStatus: undivided ? (divided ? "2" : "3") : "1",
    };
    acquirers.slice(i, i + 10).forEach((p, j) => {
      const no = i + j + 1;
      values[`l${j}.no`] = no;
      values[`l${j}.name`] = p.person.name;
      values[`s${j}.no`] = no;
      // 分割財産の価額 ＝ 付表1〜4の「分割が確定した財産」の合計（第1表①へ転記）
      values[`s${j}.divided`] = yen(p.acquired);
      values[`s${j}.total`] = yen(p.acquired);
    });
    pages.push({ page: "t11", values });
  }

  const name = c.decedent.name;
  const land = lines.flatMap(landItems);
  const stock = lines.flatMap(stockItems);
  const money = lines.flatMap(moneyItems);
  const other = [...lines.flatMap(otherItems), ...deemedItems(r.persons)];
  if (land.length) pages.push(...schedulePages("t11_f1", name, land, acquirerNo));
  if (stock.length) pages.push(...schedulePages("t11_f2", name, stock, acquirerNo));
  if (money.length) pages.push(...schedulePages("t11_f3", name, money, acquirerNo));
  if (other.length) pages.push(...schedulePages("t11_f4", name, other, acquirerNo));
  return pages;
}

/** 付表に載せた財産の取得価額の合計（第11表②と一致することの検算用） */
export function scheduleTotals(c: Case, r: TaxResult) {
  const lines = r.assets;
  const items = [...lines.flatMap(landItems), ...lines.flatMap(stockItems), ...lines.flatMap(moneyItems), ...lines.flatMap(otherItems), ...deemedItems(r.persons)];
  const byPerson = new Map<string, number>();
  for (const it of items) for (const a of it.acquirers) byPerson.set(a.personId, (byPerson.get(a.personId) ?? 0) + a.amount);
  return { items, byPerson };
}
