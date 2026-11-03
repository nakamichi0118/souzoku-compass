/**
 * 第11表（相続税がかかる財産の明細書）と付表1〜4への割り当て。
 *
 * 財産の種類ごとに付表を選ぶ：
 *   付表1 土地・家屋（分譲マンションは敷地利用権と区分所有建物の2行）
 *   付表2 有価証券
 *   付表3 現金・預貯金
 *   付表4 家庭用財産・その他（生命保険金等・退職手当金等の課税部分・代償金を含む）
 *
 * 分け方が決まっていない（未分割の）部分は、付表の「分割が確定した財産」には書かず、
 * 第11表の合計表の「② 未分割財産の価額」に法定相続分で取得したものとした額を書く。
 */
import type { AssetLine, PersonTax, TaxResult } from "@/domain/tax/engine";
import type { Case, LandUse } from "@/domain/types";
import { type Usage, valueAsset } from "@/domain/valuation";
import { yen, yenOrBlank } from "./format";
import type { PageFill, PageKey } from "./render";

const ROWS_PER_PAGE = 8;
/** 地目 → 第15表の番号（①田 ②畑 ③宅地 ④山林 ⑤その他の土地） */
const LAND_CAT: Record<string, number> = { 田: 1, 畑: 2, 宅地: 3, 山林: 4, 雑種地: 5, その他: 5 };
const ACQ_PER_ROW = 3;
/** 土地の使い方 → 第11表の利用区分 */
const LAND_USAGE: Record<LandUse, Usage> = { self: "自用地", rentedHouse: "貸家建付地", leasedLand: "貸宅地", leasehold: "借地権" };

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

/** 整数 a × b ÷ d（1円未満切捨て）。桁あふれしないよう BigInt で計算する */
const mulDiv = (a: number, b: number, d: number) => (d > 0 ? Number((BigInt(a) * BigInt(b)) / BigInt(d)) : 0);

function landItems(line: AssetLine): ScheduleItem[] {
  const a = line.asset;
  const parts = partsOf(line);
  if (a.kind === "land") {
    const loc = splitLocation(a.location);
    const m = a.method;
    return [
      item(LAND_CAT[a.landUse], line.valuation.value - line.reduction, parts, {
        kind: a.landUse,
        // 利用区分：自用地・貸家建付地・貸宅地・借地権（評価の計算で決まったもの。なければ土地の使い方から）
        use: line.valuation.usage ?? LAND_USAGE[a.use ?? "self"],
        ...loc,
        area: a.areaSqm.toLocaleString("ja-JP", { maximumFractionDigits: 2 }),
        unit: m.type === "rosenka" ? yen(line.valuation.unitPrice) : m.type === "multiplier" ? `${m.multiplier}倍` : "",
        fixed: m.type === "multiplier" ? yen(m.fixedAssetValue) : "",
        note: line.reduction > 0 ? "小規模宅地等" : "",
      }),
    ];
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
    const sr = line.small?.acquirerId ?? a.smallResidential?.acquirerId;
    const landParts: Part[] = [];
    const bldgParts: Part[] = [];
    for (const p of parts) {
      // 価額は小規模宅地等の減額後。減額前に戻してから土地・家屋に按分し、減額は敷地利用権の行から差し引く
      const cut = !p.undivided && p.personId === sr ? line.reduction : 0;
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
    return [
      item(3, land - line.reduction, landParts, {
        kind: "宅地",
        // 人に貸している部屋の敷地利用権は貸家建付地、部屋は貸家
        use: a.rented ? "貸家建付地" : "自用地",
        ...loc,
        area: a.landShareSqm.toLocaleString("ja-JP", { maximumFractionDigits: 2 }),
        note: line.reduction > 0 ? "敷地権・小規模" : "敷地権",
      }),
      item(10, total - land, bldgParts, {
        kind: "家屋",
        use: a.rented ? "貸家" : "自用家屋",
        ...loc,
        area: a.exclusiveAreaSqm.toLocaleString("ja-JP", { maximumFractionDigits: 2 }),
        fixed: yen(a.buildingFixedAssetValue),
        note: "区分所有",
      }),
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
 * エンジンと同じ条件（1円以上の整数・払う人と受け取る人が別の、計算に入っている人）のものだけを載せる
 */
function compensationItems(c: Case, r: TaxResult): ScheduleItem[] {
  const ids = new Set(r.persons.map((p) => p.person.id));
  const name = new Map(c.persons.map((p) => [p.id, p.name]));
  return (c.compensation ?? [])
    .filter((x) => Number.isSafeInteger(x.amount) && x.amount > 0 && x.fromId !== x.toId && ids.has(x.fromId) && ids.has(x.toId))
    .map((x) => ({
      cat: 28,
      value: 0,
      acquirers: [
        { personId: x.fromId, amount: -x.amount },
        { personId: x.toId, amount: x.amount },
      ],
      undivided: [],
      values: { kind: "代償財産", name: "代償金", place: `${name.get(x.fromId) ?? ""}が${name.get(x.toId) ?? ""}に支払うもの` },
    }));
}

/** 付表1〜4に載せる財産（付表ごと） */
function allItems(c: Case, r: TaxResult) {
  const lines = r.assets;
  return {
    land: lines.flatMap(landItems),
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
