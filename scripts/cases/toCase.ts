/**
 * シナリオ（scenario.ts）→ アプリの入力（src/domain/types.ts の Case）への変換。
 *
 * 「この相続の家族が、相続コンパスの画面にふつうに入力したらこうなる」という Case を作る。
 * - アプリに入力欄がそのままあるもの（続柄・放棄・半血・養子・障害者・非居住者、路線価の道路と間口、倍率、
 *   土地の使い方（貸家建付地・貸宅地・借地権）と賃貸割合・借地権割合、評価に影響する土地の事情、
 *   貸家・賃貸中のマンション、マンションの補正の要素、上場株式の4つの価格、保険金の受取人、債務の負担者、
 *   3年以内の贈与と相続時精算課税の贈与、分け方の割合と未分割、代償金、小規模宅地等（特定居住用・特定事業用・貸付事業用）、
 *   相次相続控除の前の相続の内容）は、そのまま写す。
 * - アプリに入力のしかたがまったくないもの（受取人が相続人等にいない保険金、同じ向きに3本以上の路線 など）は、
 *   Case に入れずに unrepresentable[] に書く。
 * - アプリの入力欄で「ふつうの人ならこう入れる」という入れ方があるもの（負担する人が決まっていない債務を法定相続分で入れる、
 *   細かすぎる小数を丸めて入れる など）は、その入れ方で Case を作り、approximations[] に書く。
 *   実行側（run.ts）は、それでもアプリの答えが正しいか、黙って間違えるかを確かめる。
 *
 * 根拠の確認（入力の写し方が正しいか）だけのために、アプリの部品（奥行価格補正率・相続人の判定・特例の種類と判定）を使う。
 * 正しい答えの計算（oracle.ts）とは独立に動く。
 */
import { determineHeirs } from "../../src/domain/heirs";
import type {
  Allocation,
  Asset,
  Case,
  Compensation,
  CondoAsset,
  Debt,
  LandAsset,
  LandMethod,
  Person,
  PriorGift,
  RegistryInfo,
  SmallLandRelief,
} from "../../src/domain/types";
import { depthCorrection } from "../../src/domain/valuation/depth";
import type { Edge, RoadInput } from "../../src/domain/valuation/roads";
import { type SmallResidentialCheck, judgeSmallResidential, shouldApply, smallLandKind } from "../../src/domain/valuation/smallResidential";
import type { CondoItemExt } from "./generate";
import type { EstateItem, Member, Scenario, ScenarioRoad, SmallLandKind } from "./scenario";

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
  recipientMissing: "保険金等の受取人が相続人等にいない",
  roadsTooMany: "同じ向きに3本以上の路線",
  // 近似して入れたもの
  smallKindMismatch: "小規模宅地（アプリが決める特例の種類がシナリオと違う）",
  debtBearers: "債務の負担者（法定相続分で入力）",
  multiplierDigits: "倍率（小数4桁以下を丸めて入力）",
  stockPriceDigits: "株価（1銭未満を丸めて入力）",
  areaDigits: "面積（0.01㎡未満を丸めて入力）",
} as const;

type LandItem = Extract<EstateItem, { type: "land" }>;

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

/** 路線価図の表記（例：210000円・D → 210D）。末尾の記号から、アプリが借地権割合を決める */
const notation = (r: ScenarioRoad) => `${Math.round(r.price / 1000)}${r.leaseLetter}`;

/**
 * 道路を土地の辺（0 正面・1/3 側方・2 裏面）に割り当てる。
 * 正面（front）と裏面（back）は向かい合う辺、側方（side）はそれと直角の辺。
 * アプリは「奥行価格補正後の価額が高い道路（同じなら路線価が高い方、さらに同じなら先に入れた方）」を正面にし、
 * 正面の向かいの辺を裏面、それ以外を側方とみなすので、向きの関係が崩れないよう辺を割り当てる。
 * 間口はどの道路にも入れる（アプリは正面に選んだ道路の間口で間口狭小・奥行長大の補正をする）。
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
    return { edge, price: r.price, depth: r.depth, notation: notation(r), frontage: r.frontage };
  });
  return { inputs, order, tooMany };
}

/**
 * 小規模宅地等の確認の質問への答え。シナリオでは要件を満たしている前提なので、「使える」と判定される答えにする。
 * - 特定居住用：自宅の敷地で事情なし。配偶者以外は同居していて住み続け・持ち続ける
 * - 特定事業用：自宅でなく、亡くなった方の事業に使っていた土地。引き継いで続け、持ち続け、3年以内に始めた事業でない
 * - 貸付事業用：貸し続け、持ち続け、3年以内に貸し始めたものでない
 */
function qualifyingCheck(kind: SmallLandKind, acquirer: Member | undefined): SmallResidentialCheck {
  if (kind === "business") return { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" };
  if (kind === "rental") return { continues: "yes", keep: "yes", recent: "no" };
  if (acquirer?.relation === "spouse") return { ownHome: "yes", special: "no" };
  return { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" };
}

/** 青空駐車場の答え：自宅の敷地でも、自分の事業に使っていた土地でもない（特例は使えないと判定される） */
const PARKING_CHECK: SmallResidentialCheck = { ownHome: "no", business: "no" };

/**
 * 小規模宅地等の入力。画面と同じく、答えと取得者から「適用する」を決める。
 * アプリが使い方と答えから決める特例の種類がシナリオの種類と違えば、近似として記録する
 */
function smallReliefOf(
  a: Pick<LandAsset, "kind" | "use"> | Pick<CondoAsset, "kind" | "rented">,
  sl: { kind: SmallLandKind; acquirer: string },
  check: SmallResidentialCheck,
  persons: Person[],
  approx: (k: string) => void,
  compareKind = true,
): SmallLandRelief {
  const withCheck = { ...a, smallResidential: { check } } as Parameters<typeof smallLandKind>[0];
  const kind = smallLandKind(withCheck);
  if (compareKind && kind !== sl.kind) approx(FEATURE.smallKindMismatch);
  const acquirer = persons.find((p) => p.id === sl.acquirer && !p.predeceased);
  const applies = shouldApply(judgeSmallResidential(check, acquirer, kind), check);
  return { applies, acquirerId: sl.acquirer, check };
}

/** 日付の n 年前の同じ月日（その年に2月29日がなければ2月28日）。n が0のときは前日（同じ日は前の相続の日として入れられない） */
function yearsBefore(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (n <= 0) return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  const yy = y - n;
  const leap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
  const dd = m === 2 && d === 29 && !leap ? 28 : d;
  return `${yy}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
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
  // 相次相続控除：10年以内の相続で相続税を納めていた。前の相続の日・納めた相続税額・取得した財産の価額を入れる
  const priorInheritanceTax = !!pi && pi.yearsAgo < 10 && pi.prevTax > 0;
  const settlementGift = s.gifts.some((g) => g.settlement);

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
  // 亡くなった時点で生きていた家族（あとから亡くなった人を含む）。分け方・代償金で選べるのはこの人たち
  const alive = new Set(s.members.filter((m) => !m.predeceased).map((m) => m.id));

  /* ---------- 財産 ---------- */
  const assets: Asset[] = [];
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
        const registry: RegistryInfo = { assessedValue: it.fixedAssetValue };
        assets.push({
          id: it.id,
          kind: "building",
          label: it.label,
          location: locationOf(it.label, s.decedent.address),
          fixedAssetValue: it.fixedAssetValue,
          // 人に貸している家屋（貸家）は「貸している」を選び、賃貸割合を入れる
          ...(it.rented ? { rented: true } : {}),
          ...(it.rented && it.rentRatio !== undefined ? { rentRatio: it.rentRatio } : {}),
          registry,
        });
        break;
      }
      case "condo": {
        assets.push(toCondo(it, s, byId, persons, approx));
        break;
      }
      case "land": {
        assets.push(toLand(it, s, byId, persons, unrep, approx));
        break;
      }
    }
  }

  /* ---------- 分け方 ---------- */
  const allocations: Allocation[] = [];
  let undivided = false;
  const divisible = s.estate.filter((it) => it.type !== "insurance" && it.type !== "retirement");
  if (s.division.kind === "undivided") {
    // 申告期限までに分け方が決まらない：画面で「分け方がまだ決まっていない」を選び、取得者は入れない（法定相続分で計算される）
    if (divisible.length > 0) undivided = true;
  } else {
    const div = s.division;
    for (const it of divisible) {
      // 画面で選べるのは、亡くなった時点で生きていた家族だけ
      const shares = (div.shares[it.id] ?? []).filter((x) => alive.has(x.who));
      if (shares.length === 0) {
        // 取得者が決まっていない財産：「分け方がまだ決まっていない」を選ぶ（この財産は法定相続分で計算される）
        undivided = true;
        continue;
      }
      // 割合の合計が1に満たない財産は、残りが未分割。「分け方がまだ決まっていない」を選び、決まった分だけ入れる
      const total = shares.reduce((a, x) => a + x.n / x.d, 0);
      if (total < 1 - 1e-9) undivided = true;
      // 1円未満の端数をだれに寄せるかは分け方の約束ごと。シナリオでは「割合がいちばん大きい人（同じなら先の人）」、
      // アプリは「先頭の取得者」に寄せるので、割合の大きい順（同じなら元の順）に並べて入れる
      const ordered = shares.map((x, i) => ({ x, i })).sort((a, b) => b.x.n * a.x.d - a.x.n * b.x.d || a.i - b.i).map((o) => o.x);
      allocations.push({ assetId: it.id, shares: ordered.map((x) => ({ personId: x.who, numerator: x.n, denominator: x.d })) });
    }
  }
  // 代償金（代償分割）：払う人・受け取る人・金額。画面で選べるのは、亡くなった時点で生きていた家族だけ
  const compensation: Compensation[] =
    s.division.kind === "agreed"
      ? (s.division.compensation ?? []).filter((x) => alive.has(x.from) && alive.has(x.to)).map((x) => ({ fromId: x.from, toId: x.to, amount: x.amount }))
      : [];

  /* ---------- 債務・葬式費用 ---------- */
  // 遺産の全部が未分割のときの債務は、法定相続分で負担したものとする（相基通13-3）。画面では負担する人を入れずに
  // 「分け方がまだ決まっていない」を選ぶと法定相続分で計算されるので、負担する人は入れない（葬式費用は実際に払った人を入れる）
  const debts: Debt[] = s.debts.map((d): Debt => {
    let bearers = d.bearers.map((b) => ({ personId: b.who, amount: b.amount }));
    if (s.division.kind === "undivided" && undivided && d.kind === "debt") bearers = [];
    else if (bearers.length === 0 && !undivided) {
      // 負担する人が決まっていない債務：分け方が決まっていると画面では負担者を選ばないと止まるので、法定相続分で分けて入れる
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

  /* ---------- 生前贈与（暦年課税・相続時精算課税） ---------- */
  // 期間外の暦年課税の贈与も入れる（アプリが自分で3年以内かどうかを判定するので、その判定も確かめられる）。
  // 相続時精算課税の贈与は「相続時精算課税」の印を付けて、いつの贈与でも入れる
  const priorGifts: PriorGift[] = s.gifts.map((g) => ({
    personId: g.to,
    date: g.date,
    amount: g.amount,
    giftTaxPaid: g.giftTaxPaid,
    ...(g.settlement ? { settlement: true } : {}),
  }));

  const c: Case = {
    id: s.id,
    title: s.title,
    decedent: {
      name: s.decedent.name,
      birthDate: s.decedent.birthDate,
      deathDate: death,
      address: s.decedent.address,
      ...(priorInheritanceTax
        ? { priorInheritanceTax: true, priorInheritance: { date: yearsBefore(death, pi!.yearsAgo), prevTax: pi!.prevTax, prevAcquired: pi!.prevAcquired } }
        : {}),
      ...(settlementGift ? { settlementGift: true } : {}),
    },
    persons,
    assets,
    debts,
    allocations,
    priorGifts,
    ...(undivided ? { undivided: true } : {}),
    ...(compensation.length ? { compensation } : {}),
  };
  return { case: c, unrepresentable, approximations };
}

/** 土地。青空駐車場は「自分で使っている」土地として入れる */
function toLand(
  it: LandItem,
  s: Scenario,
  byId: Map<string, Member>,
  persons: Person[],
  unrep: (k: string) => void,
  approx: (k: string) => void,
): LandAsset {
  if (!fitsDigits(it.areaSqm, 2)) approx(FEATURE.areaDigits);
  const use = it.use === "parking" ? "self" : it.use;
  const leased = use === "rentedHouse" || use === "leasedLand" || use === "leasehold";

  let method: LandMethod;
  let registry: RegistryInfo | undefined;
  let leaseRatio: number | undefined;
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
    // 借地権割合は、アプリが正面の道路の表記の記号（A〜G）から決める
  } else {
    if (!fitsDigits(v.rate, 3)) approx(FEATURE.multiplierDigits);
    method = { type: "multiplier", fixedAssetValue: v.fixedAssetValue, multiplier: v.rate };
    registry = { assessedValue: v.fixedAssetValue };
    // 倍率地域の借地権割合は、評価倍率表の「借地権割合」の欄から入れる
    if (leased && v.leaseRatio !== undefined) leaseRatio = v.leaseRatio;
  }

  // 評価に影響する事情。地積規模の大きな宅地は、アプリが面積から自分で気づくので入れない
  const condition: LandAsset["condition"] =
    it.needsReduction === "irregular" ? "irregular" : it.needsReduction === "setback" ? "setback" : it.spouseResidenceRight ? "spouseResidence" : undefined;

  const land: LandAsset = {
    id: it.id,
    kind: "land",
    label: it.label,
    location: locationOf(it.label, s.decedent.address),
    areaSqm: it.areaSqm,
    landUse: it.landUse,
    method,
    ...(use !== "self" ? { use } : {}),
    ...(use === "rentedHouse" && it.rentRatio !== undefined ? { rentRatio: it.rentRatio } : {}),
    ...(leaseRatio !== undefined ? { leaseRatio } : {}),
    ...(condition ? { condition } : {}),
    ...(it.foreign ? { foreign: true } : {}),
    ...(registry ? { registry } : {}),
  };
  const sl = it.smallLand;
  if (sl) {
    // 青空駐車場（建物や構築物のない土地）は、自宅の敷地でも事業に使っていた土地でもないと答える（特例は使えない）
    const parking = it.use === "parking";
    const check = parking ? PARKING_CHECK : qualifyingCheck(sl.kind, byId.get(sl.acquirer));
    land.smallResidential = smallReliefOf(land, sl, check, persons, approx, !parking);
  }
  return land;
}

/** 分譲マンション（敷地権＋区分所有建物） */
function toCondo(it: CondoItemExt, s: Scenario, byId: Map<string, Member>, persons: Person[], approx: (k: string) => void): CondoAsset {
  if (!fitsDigits(it.landShareSqm, 2) || !fitsDigits(it.exclusiveAreaSqm, 2)) approx(FEATURE.areaDigits);
  const condo: CondoAsset = {
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
    // 人に貸している部屋は「貸している」を選び、賃貸割合と敷地の借地権割合（路線価図の記号）を入れる
    ...(it.rented ? { rented: true } : {}),
    ...(it.rented && it.rentRatio !== undefined ? { rentRatio: it.rentRatio } : {}),
    ...(it.rented && it.leaseRatio !== undefined ? { leaseRatio: it.leaseRatio } : {}),
    registry: { assessedValue: it.buildingFixedAssetValue },
  };
  const sl = it.smallLand;
  if (sl) condo.smallResidential = smallReliefOf(condo, sl, qualifyingCheck(sl.kind, byId.get(sl.acquirer)), persons, approx);
  return condo;
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
