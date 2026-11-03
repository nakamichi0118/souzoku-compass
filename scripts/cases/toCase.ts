/**
 * シナリオ（scenario.ts）→ アプリの入力（src/domain/types.ts の Case）への変換。
 *
 * 「この相続の家族が、相続コンパスの画面にふつうに入力したらこうなる」という Case を作る。
 * - アプリに入力欄がそのままあるもの（続柄・放棄・半血・養子・障害者・非居住者、路線価の道路、倍率、
 *   マンションの補正の要素、上場株式の4つの価格、保険金の受取人、債務の負担者、3年以内の贈与、
 *   分け方の割合、特定居住用の小規模宅地等、相次相続控除・相続時精算課税の有無）は、そのまま写す。
 * - アプリに入力のしかたがまったくないもの（代償分割、借地権、特定事業用・貸付事業用の小規模宅地等、
 *   相次相続控除や精算課税の金額、未分割の申告 など）は、Case に入れずに unrepresentable[] に書く。
 * - アプリの入力欄で「ふつうの人ならこう入れる」という入れ方があるもの（貸家建付地を自分で使う土地として入れる、
 *   貸家を自宅の家屋と同じように入れる、補正が必要な土地を補正なしで入れる など）は、その入れ方で Case を作り、
 *   approximations[] に書く。実行側（run.ts）は、それでもアプリの答えが正しいか、黙って間違えるかを確かめる。
 *
 * 根拠の確認（入力の写し方が正しいか）だけのために、アプリの部品（奥行価格補正率・相続人の判定・評価）を使う。
 * 正しい答えの計算（oracle.ts）とは独立に動く。
 */
import { determineHeirs } from "../../src/domain/heirs";
import type {
  Allocation,
  Asset,
  Case,
  Debt,
  LandAsset,
  LandMethod,
  Person,
  PriorGift,
  RegistryInfo,
} from "../../src/domain/types";
import { type District, depthCorrection } from "../../src/domain/valuation/depth";
import { type Edge, type RoadInput, evaluateRoads } from "../../src/domain/valuation/roads";
import type { SmallResidentialCheck } from "../../src/domain/valuation/smallResidential";
import type { EstateItem, Member, Scenario, ScenarioRoad } from "./scenario";

export interface ToCaseResult {
  /** アプリに入力する相続（作れないときは null） */
  case: Case | null;
  /** アプリに入力のしかたがなく、Case に入れなかった事柄（答えが変わる可能性があるもの） */
  unrepresentable: string[];
  /** ふつうの人の入れ方で近似して Case に入れた事柄（アプリがそれでも正しいかを確かめる） */
  approximations: string[];
}

/** unrepresentable / approximations に使う名前（集計に使うので、表記をここでそろえる） */
export const FEATURE = {
  // 入力のしかたがないもの
  compensation: "代償分割",
  undivided: "未分割",
  partlyUndivided: "一部未分割",
  leasehold: "借地権",
  smallBusiness: "小規模宅地（特定事業用）",
  smallRental: "小規模宅地（貸付事業用）",
  priorInheritanceAmount: "相次相続控除の金額",
  settlementAmount: "相続時精算課税の金額",
  recipientMissing: "保険金等の受取人が相続人等にいない",
  roadsTooMany: "同じ向きに3本以上の路線",
  // 近似して入れたもの
  rentedLand: "貸家建付地（自用地として入力）",
  leasedLand: "貸宅地（自用地として入力）",
  rentedHouse: "貸家（自用家屋として入力）",
  rentedCondo: "賃貸中のマンション（自用として入力）",
  largeLot: "地積規模の大きな宅地（補正なしで入力）",
  irregular: "不整形地（補正なしで入力）",
  setback: "セットバック（補正なしで入力）",
  spouseResidenceRight: "配偶者居住権（設定なしとして入力）",
  frontage: "間口狭小・奥行長大補正（入力欄なし）",
  debtBearers: "債務の負担者（法定相続分で入力）",
  multiplierDigits: "倍率（小数4桁以下を丸めて入力）",
  stockPriceDigits: "株価（1銭未満を丸めて入力）",
  areaDigits: "面積（0.01㎡未満を丸めて入力）",
} as const;

type LandItem = Extract<EstateItem, { type: "land" }>;
type CondoItem = Extract<EstateItem, { type: "condo" }>;

/* ------------------------------------------------------------------ */
/* 間口狭小補正・奥行長大補正（付表6・7）。アプリに入力欄がないため、補正が要る土地かどうかの印付けだけに使う */
/* ------------------------------------------------------------------ */

/** 付表6 間口狭小補正率（百分率）。区切り：4未満, 4-6, 6-8, 8-10, 10-16, 16-22, 22-28, 28以上。ビル街の8m未満は表に定めなし（100とする） */
const FRONTAGE_BREAKS = [4, 6, 8, 10, 16, 22, 28];
const FRONTAGE_RATE: Record<District, number[]> = {
  ビル街地区: [100, 100, 100, 95, 97, 98, 99, 100],
  高度商業地区: [85, 94, 97, 100, 100, 100, 100, 100],
  繁華街地区: [90, 100, 100, 100, 100, 100, 100, 100],
  "普通商業・併用住宅地区": [90, 97, 100, 100, 100, 100, 100, 100],
  普通住宅地区: [90, 94, 97, 100, 100, 100, 100, 100],
  中小工場地区: [80, 85, 90, 95, 100, 100, 100, 100],
  大工場地区: [80, 85, 90, 95, 97, 98, 99, 100],
};
/** 付表7 奥行長大補正率（百分率）。奥行÷間口の区切り：2未満, 2-3, 3-4, 4-5, 5-6, 6-7, 7-8, 8以上 */
const LONG_BREAKS = [2, 3, 4, 5, 6, 7, 8];
const LONG_RATE: Record<District, number[]> = {
  ビル街地区: [100, 100, 100, 100, 100, 100, 100, 100],
  高度商業地区: [100, 100, 99, 98, 96, 94, 92, 90],
  繁華街地区: [100, 100, 99, 98, 96, 94, 92, 90],
  "普通商業・併用住宅地区": [100, 100, 99, 98, 96, 94, 92, 90],
  普通住宅地区: [100, 98, 96, 94, 92, 90, 90, 90],
  中小工場地区: [100, 100, 99, 98, 96, 94, 92, 90],
  大工場地区: [100, 100, 100, 100, 100, 100, 100, 100],
};
function frontageRate(district: District, frontage: number): number {
  let i = FRONTAGE_BREAKS.findIndex((b) => frontage < b);
  if (i < 0) i = FRONTAGE_BREAKS.length;
  return FRONTAGE_RATE[district][i];
}
function longRate(district: District, depth: number, frontage: number): number {
  if (!(frontage > 0)) return 100;
  let i = 0;
  LONG_BREAKS.forEach((b, k) => {
    if (depth >= b * frontage) i = k + 1;
  });
  return LONG_RATE[district][i];
}

/* ------------------------------------------------------------------ */
/* 小さな部品                                                           */
/* ------------------------------------------------------------------ */

/** 小数 digits 桁で表せるか（アプリは面積を0.01㎡、倍率を0.001、株価を0.01円の単位にそろえて計算する） */
const fitsDigits = (x: number, digits: number) => {
  const s = 10 ** digits;
  return Math.abs(Math.round(x * s) - x * s) < 1e-6;
};

/** 表示名の「（…）」の中身が所在（都道府県・市区町村を含む）ならそれを、なければ亡くなった方の住所を所在として使う */
function locationOf(label: string, fallback: string): string {
  const m = label.match(/（([^（）]+)）\s*$/);
  return m && /[都道府県市区町村郡]/.test(m[1]) ? m[1] : fallback;
}

/** 路線価図の表記（例：210000円・D → 210D） */
const notation = (r: ScenarioRoad) => `${Math.round(r.price / 1000)}${r.leaseLetter}`;

/**
 * 道路を土地の辺（0 正面・1/3 側方・2 裏面）に割り当てる。
 * 正面（front）と裏面（back）は向かい合う辺、側方（side）はそれと直角の辺。
 * アプリは「奥行価格補正後の価額が高い道路（同じなら路線価が高い方、さらに同じなら先に入れた方）」を正面にし、
 * 正面の向かいの辺を裏面、それ以外を側方とみなすので、向きの関係が崩れないよう辺を割り当てる。
 */
function roadsToEdges(roads: ScenarioRoad[]): { inputs: RoadInput[]; order: ScenarioRoad[]; tooMany: boolean } {
  // 正面 → 側方 → 裏面 の順に並べる（同じ値のときにアプリが正面を先に選ぶように）
  const rank = { front: 0, side: 1, back: 2 } as const;
  const order = [...roads].sort((a, b) => rank[a.position] - rank[b.position]);
  const axis0: Edge[] = [0, 2]; // 正面・裏面の向き
  const axis1: Edge[] = [1, 3]; // 側方の向き
  let used0 = 0;
  let used1 = 0;
  let tooMany = false;
  const inputs = order.map((r): RoadInput => {
    let edge: Edge;
    if (r.position === "side") {
      if (used1 >= 2) tooMany = true;
      edge = axis1[used1++ % 2];
    } else if (r.position === "front") {
      if (used0 >= 2) tooMany = true;
      edge = axis0[used0++ % 2];
    } else {
      // 裏面：正面の向かい（2）。すでに使われていれば 0
      if (used0 >= 2) tooMany = true;
      edge = used0 === 0 ? 2 : axis0[used0 % 2];
      used0++;
    }
    return { edge, price: r.price, depth: r.depth, notation: notation(r) };
  });
  return { inputs, order, tooMany };
}

/** 特定居住用の小規模宅地等で、アプリの確認の質問に「使える」と判定される答え（取得者が配偶者・同居親族） */
function qualifyingCheck(acquirer: Member | undefined): SmallResidentialCheck {
  if (acquirer?.relation === "spouse") return { ownHome: "yes", special: "no" };
  return { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" };
}

/* ------------------------------------------------------------------ */
/* 本体                                                                 */
/* ------------------------------------------------------------------ */

export function toCase(s: Scenario): ToCaseResult {
  const unrepresentable: string[] = [];
  const approximations: string[] = [];
  const unrep = (k: string) => {
    if (!unrepresentable.includes(k)) unrepresentable.push(k);
  };
  const approx = (k: string) => {
    if (!approximations.includes(k)) approximations.push(k);
  };
  const byId = new Map(s.members.map((m) => [m.id, m]));
  const death = s.decedent.deathDate;

  /* ---------- 亡くなった方 ---------- */
  const pi = s.decedent.priorInheritance;
  // 相次相続控除：10年以内の相続で相続税を納めていた（アプリは「ある」を選ぶと税理士への相談を案内して止まる）
  const priorInheritanceTax = !!pi && pi.yearsAgo < 10 && pi.prevTax > 0;
  if (priorInheritanceTax) unrep(FEATURE.priorInheritanceAmount);
  const settlementGift = s.gifts.some((g) => g.settlement);
  if (settlementGift) unrep(FEATURE.settlementAmount);

  /* ---------- 家族 ---------- */
  const persons: Person[] = s.members.map((m): Person => {
    const p: Person = { id: m.id, name: m.name, relation: m.relation, birthDate: m.birthDate };
    // 孫を養子にした人は、画面では「養子」＋「孫を養子にした」と入れる
    if (m.grandchildAdopted) {
      p.relation = "adoptedChild";
      p.grandchildAdopted = true;
    }
    if (m.predeceased) {
      p.predeceased = true;
      p.hasChildren = s.members.some((x) => x.substituteOf === m.id);
    }
    // 亡くなった方の後に亡くなった人（数次相続）は、画面では「すでに亡くなっている」＋亡くなった日（亡くなった方より後）と入れる
    if (m.diedAfter) {
      p.predeceased = true;
      p.deathDate = m.diedAfter;
    }
    if (m.substituteOf) {
      const parent = byId.get(m.substituteOf);
      if (m.grandchildAdopted) {
        // 孫養子で、先に亡くなった子の代襲相続人でもある（二重の資格）。画面では養子の欄のチェックで入れ、親子のつながりは入れない
        if (parent?.predeceased) p.alsoSubstituteHeir = true;
      } else {
        p.substituteOf = m.substituteOf;
      }
    }
    if (m.renounced) p.renounced = true;
    if (m.halfBlood) p.halfBlood = true;
    if (m.adoptedCountsAsBiological) p.adoptedCountsAsBiological = true;
    if (m.disability) p.disability = m.disability;
    if (m.nonResident) p.nonResident = true;
    return p;
  });
  const living = new Set(persons.filter((p) => !p.predeceased).map((p) => p.id));

  /* ---------- 財産 ---------- */
  const assets: Asset[] = [];
  /** Case に入れなかった財産（分け方からも外す） */
  const dropped = new Set<string>();
  for (const it of s.estate) {
    switch (it.type) {
      case "deposit":
      case "cash":
      case "household":
      case "other": {
        assets.push({ id: it.id, kind: it.type, label: it.label, amount: it.amount, ...(it.foreign ? { foreign: true } : {}) });
        break;
      }
      case "listedStock": {
        if (!Object.values(it.prices).every((p) => fitsDigits(p, 2))) approx(FEATURE.stockPriceDigits);
        assets.push({ id: it.id, kind: "listedStock", label: it.label, shares: it.shares, prices: { ...it.prices } });
        break;
      }
      case "unlistedStock": {
        assets.push({ id: it.id, kind: "unlistedStock", label: it.label, shares: it.shares, value: it.value });
        break;
      }
      case "insurance":
      case "retirement": {
        if (!living.has(it.recipient)) unrep(FEATURE.recipientMissing);
        assets.push({ id: it.id, kind: it.type, label: it.label, amount: it.amount, recipientId: it.recipient });
        break;
      }
      case "building": {
        if (it.rented) approx(FEATURE.rentedHouse);
        const registry: RegistryInfo = { assessedValue: it.fixedAssetValue };
        assets.push({ id: it.id, kind: "building", label: it.label, location: locationOf(it.label, s.decedent.address), fixedAssetValue: it.fixedAssetValue, registry });
        break;
      }
      case "condo": {
        const land = toCondo(it, s, byId, unrep, approx);
        assets.push(land);
        break;
      }
      case "land": {
        const land = toLand(it, s, byId, unrep, approx);
        if (land) assets.push(land);
        else dropped.add(it.id);
        break;
      }
    }
  }

  /* ---------- 分け方 ---------- */
  const allocations: Allocation[] = [];
  if (s.division.kind === "undivided") {
    // アプリには未分割のまま申告する計算がない（取得者が決まっていない財産があると止まる）。分け方は入れない
    if (s.estate.some((it) => it.type !== "insurance" && it.type !== "retirement")) unrep(FEATURE.undivided);
  } else {
    const div = s.division;
    for (const it of s.estate) {
      if (it.type === "insurance" || it.type === "retirement" || dropped.has(it.id)) continue;
      const shares = div.shares[it.id] ?? [];
      if (shares.length === 0) {
        unrep(FEATURE.partlyUndivided);
        continue;
      }
      // 割合の合計が1に満たない財産は、残りが未分割。アプリは合計が1でないと止まる
      const total = shares.reduce((a, x) => a + x.n / x.d, 0);
      if (Math.abs(total - 1) > 1e-9) unrep(FEATURE.partlyUndivided);
      // 1円未満の端数をだれに寄せるかは分け方の約束ごと。シナリオでは「割合がいちばん大きい人（同じなら先の人）」、
      // アプリは「先頭の取得者」に寄せるので、割合の大きい順（同じなら元の順）に並べて入れる
      const ordered = shares.map((x, i) => ({ x, i })).sort((a, b) => b.x.n * a.x.d - a.x.n * b.x.d || a.i - b.i).map((o) => o.x);
      allocations.push({ assetId: it.id, shares: ordered.map((x) => ({ personId: x.who, numerator: x.n, denominator: x.d })) });
    }
    if (div.compensation?.length) unrep(FEATURE.compensation);
  }

  /* ---------- 債務・葬式費用 ---------- */
  const debts: Debt[] = s.debts.map((d): Debt => {
    let bearers = d.bearers.map((b) => ({ personId: b.who, amount: b.amount }));
    if (bearers.length === 0) {
      // 負担する人が決まっていない債務：画面では負担者を選ばないと止まるので、法定相続分で分けて入れる
      approx(FEATURE.debtBearers);
      bearers = splitByLegalShares(d.amount, persons);
    }
    return {
      id: d.id,
      kind: d.kind,
      label: d.label,
      amount: d.amount,
      debtType: d.kind === "debt" ? (/借入|ローン/.test(d.label) ? "銀行借入金" : /税/.test(d.label) ? "公租公課" : "未払金") : undefined,
      bearers,
    };
  });

  /* ---------- 3年以内の贈与（暦年課税） ---------- */
  // 期間外の贈与も入れる（アプリが自分で3年以内かどうかを判定するので、その判定も確かめられる）
  const priorGifts: PriorGift[] = s.gifts
    .filter((g) => !g.settlement)
    .map((g) => ({ personId: g.to, date: g.date, amount: g.amount, giftTaxPaid: g.giftTaxPaid }));

  const c: Case = {
    id: s.id,
    title: s.title,
    decedent: {
      name: s.decedent.name,
      birthDate: s.decedent.birthDate,
      deathDate: death,
      address: s.decedent.address,
      ...(priorInheritanceTax ? { priorInheritanceTax: true } : {}),
      ...(settlementGift ? { settlementGift: true } : {}),
    },
    persons,
    assets,
    debts,
    allocations,
    priorGifts,
  };
  return { case: c, unrepresentable, approximations };
}

/** 土地。入力のしかたがない土地（借地権）は null */
function toLand(
  it: LandItem,
  s: Scenario,
  byId: Map<string, Member>,
  unrep: (k: string) => void,
  approx: (k: string) => void,
): LandAsset | null {
  // 借地権：亡くなった方は土地を持っていないので、ふつうは土地として入れない（アプリに借地権の入力欄はない）
  if (it.use === "leasehold") {
    unrep(FEATURE.leasehold);
    if (it.smallLand?.kind === "business") unrep(FEATURE.smallBusiness);
    if (it.smallLand?.kind === "rental") unrep(FEATURE.smallRental);
    return null;
  }
  if (it.use === "rentedHouse") approx(FEATURE.rentedLand);
  if (it.use === "leasedLand") approx(FEATURE.leasedLand);
  if (it.needsReduction === "largeLot") approx(FEATURE.largeLot);
  if (it.needsReduction === "irregular") approx(FEATURE.irregular);
  if (it.needsReduction === "setback") approx(FEATURE.setback);
  if (it.spouseResidenceRight) approx(FEATURE.spouseResidenceRight);
  if (!fitsDigits(it.areaSqm, 2)) approx(FEATURE.areaDigits);

  let method: LandMethod;
  let registry: RegistryInfo | undefined;
  const v = it.valuation;
  if (v.kind === "rosenka") {
    const { inputs, order, tooMany } = roadsToEdges(v.roads);
    if (tooMany) unrep(FEATURE.roadsTooMany);
    const front = order.find((r) => r.position === "front") ?? order[0];
    method = {
      type: "rosenka",
      routePrice: front.price,
      depthCorrection: depthCorrection(v.district, front.depth),
      district: v.district,
      roads: inputs,
    };
    // アプリが正面に選ぶ道路で、間口狭小・奥行長大の補正が要るか（アプリには間口の入力欄がない）
    const ev = evaluateRoads(v.district, inputs);
    if (ev) {
      const k = inputs.findIndex((r) => r.edge === ev.front.edge && r.price === ev.front.price && r.depth === ev.front.depth);
      const fr = order[k >= 0 ? k : 0];
      if (frontageRate(v.district, fr.frontage) < 100 || longRate(v.district, fr.depth, fr.frontage) < 100) approx(FEATURE.frontage);
    }
  } else {
    if (!fitsDigits(v.rate, 3)) approx(FEATURE.multiplierDigits);
    method = { type: "multiplier", fixedAssetValue: v.fixedAssetValue, multiplier: v.rate };
    registry = { assessedValue: v.fixedAssetValue };
  }

  const land: LandAsset = {
    id: it.id,
    kind: "land",
    label: it.label,
    location: locationOf(it.label, s.decedent.address),
    areaSqm: it.areaSqm,
    landUse: it.landUse,
    method,
    ...(it.foreign ? { foreign: true } : {}),
    ...(registry ? { registry } : {}),
  };
  const sl = it.smallLand;
  if (sl?.kind === "residence") {
    land.smallResidential = { applies: true, acquirerId: sl.acquirer, check: qualifyingCheck(byId.get(sl.acquirer)) };
  } else if (sl?.kind === "business") {
    unrep(FEATURE.smallBusiness);
  } else if (sl?.kind === "rental") {
    unrep(FEATURE.smallRental);
  }
  return land;
}

/** 分譲マンション（敷地権＋区分所有建物） */
function toCondo(it: CondoItem, s: Scenario, byId: Map<string, Member>, unrep: (k: string) => void, approx: (k: string) => void): Asset {
  if (it.rented) approx(FEATURE.rentedCondo);
  if (!fitsDigits(it.landShareSqm, 2) || !fitsDigits(it.exclusiveAreaSqm, 2)) approx(FEATURE.areaDigits);
  const sl = it.smallLand;
  if (sl?.kind === "business") unrep(FEATURE.smallBusiness);
  if (sl?.kind === "rental") unrep(FEATURE.smallRental);
  return {
    id: it.id,
    kind: "condo",
    label: it.label,
    location: locationOf(it.label, s.decedent.address),
    landValueBeforeCorrection: it.landValue,
    buildingFixedAssetValue: it.buildingFixedAssetValue,
    builtYearsMonths: { years: it.builtYears, months: it.builtMonths },
    totalFloors: it.totalFloors,
    floor: it.floor,
    landShareSqm: it.landShareSqm,
    exclusiveAreaSqm: it.exclusiveAreaSqm,
    registry: { assessedValue: it.buildingFixedAssetValue },
    ...(sl?.kind === "residence"
      ? { smallResidential: { applies: true, acquirerId: sl.acquirer, check: qualifyingCheck(byId.get(sl.acquirer)) } }
      : {}),
  };
}

/** 金額を民法の法定相続分で分ける（各人1円未満切捨て、端数は相続分の大きい人へ） */
function splitByLegalShares(amount: number, persons: Person[]): { personId: string; amount: number }[] {
  const civil = determineHeirs(persons, "civil");
  const parts = [...civil.byPerson].map(([personId, f]) => ({ personId, f, amount: Number((BigInt(amount) * f.n) / f.d) }));
  if (parts.length === 0) return [];
  const rest = amount - parts.reduce((a, p) => a + p.amount, 0);
  let best = parts[0];
  for (const p of parts) if (p.f.n * best.f.d > best.f.n * p.f.d) best = p;
  best.amount += rest;
  return parts.filter((p) => p.amount > 0).map(({ personId, amount }) => ({ personId, amount }));
}
