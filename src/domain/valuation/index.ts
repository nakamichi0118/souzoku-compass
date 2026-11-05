/**
 * 財産の評価（相続税評価額）。結果は円単位の整数。
 * 小数は 1/1000 単位（借地権割合・賃貸割合は 1/10000 単位）の整数で扱い、浮動小数点の誤差を持ち込まない。
 *
 * 土地は、まず自分で使っている土地（自用地）としての評価額を出し（路線価方式・倍率方式・直接入力）、
 * そのあと土地の使い方で、貸家建付地・貸宅地・借地権・貸家建付借地権の評価にする（財産評価基本通達25〜28）。
 * 家屋・マンションの部屋は、人に貸していれば貸家として評価する（通達93）。
 * 形がいびつ・地積規模の大きな宅地（通達20-2）にあたる土地は、評価を下げる計算をしていないため、
 * 税理士への相談を案内する（修正した補正率・評価額を入れれば計算する）。セットバックが必要な土地は止めず、減額しない評価額で計算し、
 * 相談するかは本人が選ぶ（減額しかないので、相談しなくても過少にはならない）。配偶者居住権を設定した土地は、いつも税理士への相談を案内する。
 * ただし倍率方式の宅地は、固定資産税評価額 × 倍率で評価し（通達21-2）、土地の形は固定資産税評価額に反映されているため、
 * 形がいびつでも形による補正はせず、そのまま計算する（地積規模の大きな宅地は21-2のただし書で比べるため、相談を案内する）。
 */
import type { Asset, CondoAsset, LandAsset, LandMethod, LandUse } from "../types";
import type { District } from "./depth";
import {
  LEASE_RATIO_BY_LETTER,
  RENT_RATIO_MESSAGE,
  RENTAL_RIGHT_RATIO,
  leaseLetterOf,
  leasedLand,
  leaseholdRight,
  ratio4,
  ratioText,
  rentedBuilding,
  rentedHouseLand,
  rentedHouseLandPart,
  rentedLeaseholdPart,
  rentedLeaseholdRight,
  validLease4,
  validRent4,
} from "./lease";
import { evaluateRoads } from "./roads";

/** 第11表の利用区分 */
export type Usage = "自用地" | "貸家建付地" | "貸宅地" | "借地権" | "貸家建付借地権" | "自用家屋" | "貸家";

export interface Valuation {
  value: number;
  /** 第11表の「単価」「倍数」「数量」欄、説明表示用。土地の単価は自用地としての1㎡当たりの価額 */
  unitPrice?: number;
  multiplier?: number;
  quantity?: string;
  steps: string[];
  /** 自動評価できず専門家への相談が必要 */
  needsConsultation?: string;
  /** 自用地（自用家屋）としての評価額。人に貸している・人の土地を借りているなどで評価額と違うときだけ */
  selfUseValue?: number;
  /** 第11表の利用区分（土地・家屋） */
  usage?: Usage;
  /** 評価に使った借地権割合（貸家建付地・貸宅地・借地権・貸しているマンションの敷地） */
  leaseRatio?: number;
  /**
   * 貸付事業用宅地等の対象になる「貸している部分」の土地（または土地の上の権利）の評価額（持分100%・土地全体で計算）。
   * 賃貸割合が1未満の貸家建付地・貸家建付借地権・貸しているマンションの敷地利用権のときだけ設定する。
   * 国税庁「貸家建付地等の一部が空室の場合の小規模宅地等の特例」：貸している部分＝自用地価額×賃貸割合×(1−借地権割合×借家権割合)、
   * 空いている部分は自用地（借地権）として評価し特例の対象外。マンションは区分所有補正後・建物分を除く敷地利用権だけ。
   */
  rentedLandPart?: number;
}

const thou = (x: number) => Math.round(x * 1000); // 小数3桁までの値を整数化

/** 整数 a × 整数 b ÷ d（1未満切捨て）。桁あふれしないよう BigInt で計算する（ありえない大きさの入力でも止まらないようにする） */
function mulDiv(a: number, b: number, d: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return Math.floor((a * b) / d);
  return Number((BigInt(a) * BigInt(b)) / BigInt(d));
}

/**
 * 1㎡当たりの価額（円）× 地積（㎡）。1円未満切捨て。
 * 地積は0.01㎡単位の整数にしてから掛け、浮動小数点の誤差で1円ずれないようにする。
 */
export function perSqmTimesArea(perSqm: number, areaSqm: number): number {
  return mulDiv(Math.floor(perSqm), Math.round(areaSqm * 100), 100);
}

/**
 * 区分所有補正率を使わない建物かどうか（「居住用の区分所有財産の評価について」（注）1）。
 * 地階を除く階数が2以下の建物と、住まい用の部屋が3室以下でそのすべてを持ち主や親族が住まいに使っている建物は対象外。
 * 対象外なら理由を、対象なら null を返す。
 */
export function condoExclusion(c: Pick<CondoAsset, "totalFloors" | "fewUnitsFamily">): string | null {
  if (c.fewUnitsFamily) return "住まい用の部屋が3室以下で、そのすべてを持ち主や親族が住まいに使っているため区分所有補正なし";
  if (c.totalFloors > 0 && c.totalFloors <= 2) return "地階を除く階数が2以下のため区分所有補正なし";
  return null;
}

/** 区分所有補正率の計算（評価通達 居住用の区分所有財産の評価について、令和6年1月1日以後） */
export function condoCorrection(c: Pick<
  CondoAsset,
  "builtYearsMonths" | "totalFloors" | "floor" | "landShareSqm" | "exclusiveAreaSqm"
>) {
  const years = c.builtYearsMonths.years + (c.builtYearsMonths.months > 0 ? 1 : 0); // 1年未満切上げ
  const A = -33 * years; // ×1/1000
  const floorIndex = Math.min(1000, Math.floor((c.totalFloors * 1000) / 33)); // 第4位切捨て、上限1
  const B = Math.floor((floorIndex * 239) / 1000); // 第4位切捨て
  const C = 18 * Math.max(0, c.floor); // 地階は0
  // 敷地持分狭小度：第4位切上げ
  const narrowness = Math.ceil(
    (Math.round(c.landShareSqm * 100) * 1000) / Math.round(c.exclusiveAreaSqm * 100),
  );
  // D：第4位切上げ（絶対値が大きくなる方向。国税庁計算例 0.350×△1.195=△0.419）
  const D = -Math.ceil((narrowness * 1195) / 1000);
  const ratio = A + B + C + D + 3220; // 評価乖離率 ×1/1000
  let correction: number; // 区分所有補正率 ×1/10000
  let note: string;
  if (ratio <= 0) {
    correction = 0;
    note = "評価乖離率が0以下のため評価しません";
  } else if (1000 / ratio < 0.6) {
    correction = ratio * 6; // ×0.6 → 1/10000単位
    note = "評価水準が0.6未満のため 評価乖離率×0.6";
  } else if (ratio < 1000) {
    correction = ratio * 10;
    note = "評価水準が1を超えるため 評価乖離率";
  } else {
    correction = 10000;
    note = "評価水準が0.6以上1以下のため補正なし";
  }
  return { years, A, B, C, D, narrowness, ratio, correction, note };
}

/**
 * 修正した補正率を入れたときの案内。「補正率を修正」の欄は路線価方式の画面にしかないので、路線価方式のときだけ使う。
 * 減額なし（当てはまらない）と言われたときは 1 を入れれば計算する
 */
export const ADVISOR_HINT_RATE =
  "補正率が分かったら、土地の画面の「補正率を修正」で入れると、その補正率で計算します（減額なしなら 1 を入れてください）。";

/**
 * 人に貸している・人の土地を借りている土地で、評価額を直接入力するときの注意。
 * 直接入力の額は自用地としての評価額として扱い、貸家建付地・貸宅地・借地権などの計算はこのあとする（二重に下げないため）
 */
export const SELF_USE_VALUE_NOTE =
  "入れるのは、その土地を自分で持って自分で使っているとした場合の評価額（自用地としての評価額）です。貸している分・借りている分の計算は、このあと相続コンパスがします。";

/** 税理士に評価額を出してもらったときの案内（倍率方式・直接入力の土地）。人に貸している・借りている土地は自用地としての額を入れる */
export function advisorHintValue(use: LandUse | undefined): string {
  return "税理士に評価額を出してもらったら、評価方法を「評価額を直接入力」にして入れると計算します。" + (use && use !== "self" ? SELF_USE_VALUE_NOTE : "");
}

/** 評価方法に合わせた、税理士に確認した値の入れ方の案内 */
const advisorHint = (method: LandMethod["type"], use: LandUse | undefined) => (method === "rosenka" ? ADVISOR_HINT_RATE : advisorHintValue(use));

type Condition = NonNullable<LandAsset["condition"]>;

/**
 * 倍率方式の宅地は、固定資産税評価額 × 倍率で評価する（財産評価基本通達21-2）。土地の形は固定資産税評価額に反映されているため、
 * 形がいびつでも形による補正（不整形地の補正）はしない（評価の説明に出す文）
 */
export const MULTIPLIER_SHAPE_STEP = "倍率方式では、土地の形は固定資産税評価額に反映されているため、形による補正はしません";

/** 倍率方式の宅地で「形がいびつ」を選んだときの案内（補正しないので、「特になし」と同じ評価額になる） */
const MULTIPLIER_SHAPE_NOTE = `${MULTIPLIER_SHAPE_STEP}（「特になし」と同じ評価額です）。`;

/**
 * 倍率方式の宅地以外の土地（田・畑・山林・雑種地など）で形がいびつなとき。近くの宅地と比べて評価する土地（市街地の農地・雑種地など）では、
 * 形に合わせた補正をすることがあるため、相談を案内する
 */
const MULTIPLIER_OTHER_SHAPE_TEXT =
  "宅地以外の土地（田・畑・山林・雑種地など）は、近くの宅地と比べて評価する場合などに、形に合わせて評価を下げられることがあります（不整形地の補正）。";

/** 形がいびつでも形による補正をしない土地か：倍率方式の宅地（形は固定資産税評価額に反映されている。通達21-2） */
const shapeInFixedAssetValue = (method: LandMethod["type"], landUse: LandAsset["landUse"] | undefined) => method === "multiplier" && (landUse ?? "宅地") === "宅地";

/** 補正率（評価額）を入れれば計算する事情 */
const CONDITION_BODY: Record<Exclude<Condition, "spouseResidence">, { text: string; what: string }> = {
  irregular: {
    text: "形がいびつな土地（旗竿地・三角形・L字など）は、形に合わせて評価を下げられます（不整形地の補正）。",
    what: "形の補正",
  },
  setback: {
    text: "前の道路の幅が4m未満で、建て替えのときに道路にするため下がる部分（セットバック）がある土地は、その部分の評価を下げられます。",
    what: "セットバックの補正",
  },
};

/**
 * 配偶者居住権を設定した土地は、評価方法にかかわらずいつも相談を案内する。
 * 家と土地を、配偶者居住権・居住建物の所有権・敷地利用権・敷地の所有権の4つに分けて評価し（相続税法23条の2）、小規模宅地等の特例の計算も変わるため
 */
const SPOUSE_RESIDENCE_MESSAGE =
  "配偶者居住権を設定した家と土地は、「配偶者居住権」「家の所有権」「土地を使う権利」「土地の所有権」の4つに分けて評価し、小規模宅地等の特例の計算も変わります。相続コンパスではこの計算をしていないため、税理士にご相談ください。";

/** セットバックの減額をしていないときの説明（止めずに、減額しない評価額で計算する） */
export const SETBACK_STEP =
  "前の道路の幅が4m未満の可能性があります。セットバックの減額はしていません（税理士に相談すると下がる可能性があります）";

const NOT_CALCULATED = "相続コンパスではこの計算をしていないため、税理士にご相談ください。";

/** 古いデータなどで知らない事情が入っていても止まらないよう、知っている事情だけを扱う */
const isCondition = (c: unknown): c is Condition => c === "irregular" || c === "setback" || c === "spouseResidence";

/**
 * 評価に影響する土地の事情ごとの案内（相続コンパスでは評価しない）。
 * 税理士に確認した値の入れ方は評価方法で変える：路線価方式は「補正率を修正」、倍率方式・直接入力は評価額の直接入力。
 * largeLotArea を渡すと（地積規模の大きな宅地にもあたりうるとき）、その案内と、補正率（評価額）に両方の補正を含めることも書く。
 * 倍率方式で形がいびつなとき：宅地（landUse を渡さなければ宅地とみなす）は形による補正をしないことを、宅地以外は補正できる場合があることを書く
 */
export function conditionMessage(
  condition: Condition,
  method: LandMethod["type"],
  opts: { use?: LandUse; largeLotArea?: 500 | 1000; landUse?: LandAsset["landUse"] } = {},
): string {
  if (condition === "spouseResidence") return SPOUSE_RESIDENCE_MESSAGE;
  const t = opts.largeLotArea;
  if (condition === "irregular" && method === "multiplier") {
    if (shapeInFixedAssetValue(method, opts.landUse)) return MULTIPLIER_SHAPE_NOTE + (t == null ? "" : largeLotMessage(t, method, opts.use));
    return MULTIPLIER_OTHER_SHAPE_TEXT + NOT_CALCULATED + advisorHint(method, opts.use);
  }
  const { text, what } = CONDITION_BODY[condition];
  if (t == null) return text + NOT_CALCULATED + advisorHint(method, opts.use);
  return (
    text +
    `また、${t.toLocaleString()}㎡以上の広い宅地は「地積規模の大きな宅地」として評価額が下がることがあります（財産評価基本通達20-2）。` +
    NOT_CALCULATED +
    (method === "rosenka"
      ? `税理士に確認する補正率は、${what}と地積規模の大きな宅地の補正（規模格差補正率）の両方を含めたものにしてください。`
      : `税理士に出してもらう評価額は、${what}と地積規模の大きな宅地の補正の両方を反映したものにしてください。`) +
    advisorHint(method, opts.use)
  );
}

/** 修正した補正率（0より大きく1以下。1は「減額なし」と確認したもの）。入っていなければ undefined */
function advisorRate(m: LandMethod): number | undefined {
  if (m.type !== "rosenka") return undefined;
  const oc = m.otherCorrection;
  return oc != null && oc > 0 && oc <= 1 ? oc : undefined;
}

/**
 * 税理士に確認した値で評価する土地か（事情がある土地・広い土地でも、この値で計算する）。
 * 評価額を直接入力した土地、または修正した補正率（0より大きく1以下）を入れた路線価方式の土地。
 * 配偶者居住権はいつも相談（直接入力でも計算しない）
 */
function advisorValued(a: LandAsset, condition: Condition | "largeLot"): boolean {
  if (condition === "spouseResidence") return false;
  if (a.method.type === "manual") return true;
  return advisorRate(a.method) != null;
}

/** 都道府県（所在の先頭から読む） */
const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県",
  "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県",
  "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

/**
 * 三大都市圏（首都圏・近畿圏・中部圏）に市町村の一部でも入りうる都府県。
 * 三大都市圏かどうかは市町村ごとに決まるが、相続コンパスでは都府県で広めに判定し、500㎡以上で相談を案内する
 */
const METRO_PREFECTURES: readonly string[] = ["東京都", "神奈川県", "埼玉県", "千葉県", "茨城県", "京都府", "大阪府", "兵庫県", "奈良県", "愛知県", "三重県"];

/** 所在の先頭の都道府県名。読めなければ undefined */
export function prefectureOf(location: string | undefined): string | undefined {
  const s = (location ?? "").normalize("NFKC").trim();
  return PREFECTURES.find((p) => s.startsWith(p));
}

/**
 * 地積規模の大きな宅地（財産評価基本通達20-2）にあたりうる面積（㎡）。
 * 三大都市圏は500㎡以上、それ以外は1,000㎡以上。都道府県が分からなければ500㎡（安全側）
 */
export function largeLotThreshold(location: string | undefined): 500 | 1000 {
  const p = prefectureOf(location);
  return p && !METRO_PREFECTURES.includes(p) ? 1000 : 500;
}

/** 地積規模の大きな宅地の対象になりうる地区（路線価方式）。倍率方式の宅地も対象になりうる */
const LARGE_LOT_DISTRICTS: readonly District[] = ["普通住宅地区", "普通商業・併用住宅地区"];

/** 地積規模の大きな宅地にあたりうるとき、その面積の基準（500㎡・1,000㎡）。あたらなければ null。直接入力の土地は見ない */
function largeLotArea(a: LandAsset): 500 | 1000 | null {
  if (a.landUse !== "宅地") return null;
  const m = a.method;
  const target = m.type === "multiplier" || (m.type === "rosenka" && LARGE_LOT_DISTRICTS.includes(m.district ?? "普通住宅地区"));
  if (!target) return null;
  const t = largeLotThreshold(a.location);
  return Math.round(a.areaSqm * 100) >= t * 100 ? t : null;
}

/** 地積規模の大きな宅地にあたりうるときの案内 */
function largeLotMessage(t: 500 | 1000, method: LandMethod["type"], use: LandUse | undefined): string {
  return (
    `${t.toLocaleString()}㎡以上の広い宅地は、「地積規模の大きな宅地」として評価額が下がることがあります（財産評価基本通達20-2。広い土地は分けて売るときに道路などが必要になり、そのぶん安くなるため）。` +
    "下がるかどうかは場所・用途地域・容積率などで決まり、相続コンパスではこの計算をしていないため、税理士にご相談ください。" +
    advisorHint(method, use)
  );
}

/** 土地の使い方ごとの利用区分と説明 */
const USE_LABEL: Record<Exclude<LandUse, "self">, { usage: Usage; note: string }> = {
  rentedHouse: { usage: "貸家建付地", note: "家賃をもらって貸しているアパート・貸家の敷地は、借りている人の権利の分だけ低く評価します" },
  leasedLand: { usage: "貸宅地", note: "地代をもらって人に貸し、相手が建物を建てている土地は、相手の借地権の分を引いて評価します" },
  leasehold: { usage: "借地権", note: "人の土地を借りて建物を建てている権利は、土地の評価額に借地権割合を掛けて評価します" },
  rentedLeasehold: {
    usage: "貸家建付借地権",
    note: "人の土地を借りて建てたアパート・貸家を貸しているときの借地権は、借地権の評価額から借りている人の権利の分を引いて評価します",
  },
};

/** 賃貸割合を使う土地の使い方（貸家建付地・貸家建付借地権） */
const usesRentRatio = (use: LandUse) => use === "rentedHouse" || use === "rentedLeasehold";

const LEASE_RATIO_MISSING =
  "借地権割合が分かりません。土地の画面で借地権割合を選んでください。路線価図では路線価の数字のあとの記号（A＝90%・B＝80%・C＝70%・D＝60%・E＝50%・F＝40%・G＝30%）、倍率地域では評価倍率表の「借地権割合」の欄に書いてあります。";
const LEASE_RATIO_INVALID = "借地権割合が正しくありません。借地権割合は0より大きく1未満の数です（例：60%なら0.6）。土地の画面で直してください。";

export function valueLand(a: LandAsset): Valuation {
  const quantity = `${a.areaSqm}㎡`;
  const consult = (needsConsultation: string): Valuation => ({ value: 0, quantity, steps: [], needsConsultation });
  const use = a.use ?? "self";
  // 評価を下げる事情がある土地は、下げない評価額で確定させない。広い宅地にもあたりうるなら、その案内もいっしょに出す。
  // 倍率方式の宅地は、形が固定資産税評価額に反映されているので、形がいびつでも止めない（広い宅地なら次で案内する）
  const big = largeLotArea(a);
  const shapeInFav = a.condition === "irregular" && shapeInFixedAssetValue(a.method.type, a.landUse);
  // セットバックは評価を下げるだけなので止めない。減額しない（高めの）評価額で進め、相談するかは本人が選ぶ
  const setbackOpen = a.condition === "setback" && !advisorValued(a, "setback");
  if (isCondition(a.condition) && a.condition !== "setback" && !shapeInFav && !advisorValued(a, a.condition))
    return consult(conditionMessage(a.condition, a.method.type, { use, largeLotArea: big ?? undefined, landUse: a.landUse }));
  if (big != null && !advisorValued(a, "largeLot")) return consult(largeLotMessage(big, a.method.type, use));
  const { valuation: computed, notation } = selfUseLand(a);
  const self = setbackOpen && !computed.needsConsultation ? { ...computed, steps: [...computed.steps, SETBACK_STEP] } : computed;
  if (self.needsConsultation || (a.method.type === "manual" && a.method.publicPrivateRoad)) return self;
  // 古いデータなどで知らない使い方が入っていても止まらないよう、自用地として扱う
  const label = use === "self" ? undefined : USE_LABEL[use];
  if (!label) return { ...self, usage: "自用地" };
  const yen = (n: number) => n.toLocaleString("ja-JP");
  const { usage, note } = label;
  // 賃貸割合（貸家建付地・貸家建付借地権だけ使う）
  const rent4 = ratio4(a.rentRatio ?? 1);
  if (usesRentRatio(use) && !validRent4(rent4))
    return consult(
      RENT_RATIO_MESSAGE +
        (use === "rentedLeasehold"
          ? "建物をまったく貸していなければ、土地の使い方で「人の土地を借りて、自宅などの建物を建てている（借地権）」を選んでください。"
          : "まったく貸していなければ、土地の使い方で「自分で使っている」を選んでください。"),
    );
  // 借地権割合：入力があればそれを、なければ路線価図の記号から（路線価方式のとき）
  let lease4: number | undefined;
  let from = "";
  if (a.leaseRatio != null && a.leaseRatio > 0) {
    lease4 = ratio4(a.leaseRatio);
    if (!validLease4(lease4)) return consult(LEASE_RATIO_INVALID);
  } else if (a.method.type === "rosenka") {
    const letter = leaseLetterOf(notation);
    if (letter) {
      lease4 = ratio4(LEASE_RATIO_BY_LETTER[letter]);
      from = `（路線価図の記号 ${letter}）`;
    }
  }
  if (lease4 == null) return consult(LEASE_RATIO_MISSING);
  const S = self.value;
  const L = ratioText(lease4);
  let value: number;
  let formula: string;
  // 貸付事業用宅地等の対象になる、貸している部分の評価額（一部が空いているときだけ）
  let rentedLandPart: number | undefined;
  if (use === "rentedHouse") {
    value = rentedHouseLand(S, lease4, rent4);
    formula = `自用地の評価額 ${yen(S)}円 ×（1 − 借地権割合 ${L}${from} × 借家権割合 ${RENTAL_RIGHT_RATIO} × 賃貸割合 ${ratioText(rent4)}）`;
    if (rent4 < 10000) rentedLandPart = rentedHouseLandPart(S, lease4, rent4);
  } else if (use === "rentedLeasehold") {
    value = rentedLeaseholdRight(S, lease4, rent4);
    formula = `自用地の評価額 ${yen(S)}円 × 借地権割合 ${L}${from} ×（1 − 借家権割合 ${RENTAL_RIGHT_RATIO} × 賃貸割合 ${ratioText(rent4)}）`;
    if (rent4 < 10000) rentedLandPart = rentedLeaseholdPart(S, lease4, rent4);
  } else if (use === "leasedLand") {
    value = leasedLand(S, lease4);
    formula = `自用地の評価額 ${yen(S)}円 ×（1 − 借地権割合 ${L}${from}）`;
  } else {
    value = leaseholdRight(S, lease4);
    formula = `自用地の評価額 ${yen(S)}円 × 借地権割合 ${L}${from}`;
  }
  return {
    ...self,
    value,
    usage,
    selfUseValue: S,
    leaseRatio: lease4 / 10000,
    ...(rentedLandPart != null ? { rentedLandPart } : {}),
    steps: [...self.steps, `${usage}（${note}）：${formula} = ${yen(value)}円`],
  };
}

/** 不整形地で修正した補正率（1未満）を使うときの説明（通達20-4は不整形地を除く。付表5（注）3） */
const IRREGULAR_RATE_STEP =
  "形がいびつな土地（不整形地）なので、間口が狭い・奥行が長い補正はせず、修正した補正率（不整形地補正率。間口が狭い分を含む）を使います（財産評価基本通達20-4・付表5（注）3）";

/**
 * 不整形地で修正した補正率が 1（減額なし）のときの説明。不整形地補正率は間口狭小補正率を超えない（付表5（注）3）ので、
 * 1 なら間口狭小補正率も1で、間口が狭い・奥行が長い補正（通達20-4）はふつうどおりする
 */
const IRREGULAR_NO_REDUCTION_STEP =
  "形がいびつな土地ですが、修正した補正率が 1（減額なし）なので、間口が狭い・奥行が長い補正はふつうどおりします（財産評価基本通達20-4）";

/** 自用地としての評価額（路線価方式・倍率方式・直接入力）。notation は借地権割合の記号を読む路線価の表記 */
function selfUseLand(a: LandAsset): { valuation: Valuation; notation?: string } {
  const m = a.method;
  const quantity = `${a.areaSqm}㎡`;
  const consult = (needsConsultation: string) => ({ valuation: { value: 0, quantity, steps: [], needsConsultation } as Valuation });
  if (m.type === "rosenka") {
    // 未入力のまま0円で計算すると課税価格が過少になるため、そろうまで確定しない
    if (!(a.areaSqm > 0)) return consult("地積（土地の面積）が未入力です。固定資産税の課税明細書や登記事項証明書を見て入力してください。");
    if (m.roads?.length) {
      // 入れかけの道路を外して計算すると、角地などが道路1つの土地として低く評価されるため、すべての道路がそろうまで確定しない
      if (m.roads.some((r) => !(r.price > 0) || !(r.depth > 0)))
        return consult("路線価か奥行が未入力の道路があります。面しているすべての道路に路線価と奥行を入れてください（面していない道路は削除してください）。路線価図を見て入力できます。");
    } else if (!(m.routePrice > 0) || !(m.depthCorrection > 0)) {
      return consult("路線価と奥行価格補正率が未入力です。固定資産税の課税明細書や路線価図を見て入力してください。");
    }
    // 補正率を修正。未入力・0以下は「補正なし」（1）として扱い、0円にならないようにする
    const oc = m.otherCorrection != null && m.otherCorrection > 0 ? m.otherCorrection : 1;
    if (oc > 1) return consult(`修正した補正率（${m.otherCorrection}）が1を超えています。補正率は0より大きく1以下の数です。土地の画面で正しい補正率に直すか、空欄にしてください（空欄なら補正なしで計算します）。`);
    const ocStep = oc !== 1 ? ` × 補正 ${oc}` : "";
    // 広い宅地で修正した補正率を使うときは、その率に地積規模の大きな宅地の補正も含めたものとして扱う
    const bigStep =
      advisorRate(m) != null && largeLotArea(a) != null
        ? [`修正した補正率 ${oc} は、地積規模の大きな宅地の補正（規模格差補正率。財産評価基本通達20-2）も含めた率として使います`]
        : [];
    if (m.roads?.length) {
      // 不整形地で修正した補正率が1未満なら、それは間口狭小補正率を含む不整形地補正率なので、
      // 間口狭小・奥行長大の補正（通達20-4）をせず、その率だけを掛ける（二重に下げない）。
      // 1（減額なし）なら間口狭小補正率も1のはずなので（付表5（注）3）、20-4はふつうどおりする（形がいびつと選ばない土地より高くしない）
      const rate = advisorRate(m);
      const irregular = a.condition === "irregular" && rate != null && rate < 1;
      const r = evaluateRoads(m.district ?? "普通住宅地区", m.roads, { irregular })!;
      const irregularNoReduction = a.condition === "irregular" && rate === 1 && r.frontageRate != null;
      const per = Math.floor((r.perSqm * thou(oc)) / 1000);
      const value = perSqmTimesArea(per, a.areaSqm);
      return {
        valuation: {
          value,
          unitPrice: per,
          quantity,
          steps: [
            ...r.steps,
            ...(irregular ? [IRREGULAR_RATE_STEP] : irregularNoReduction ? [IRREGULAR_NO_REDUCTION_STEP] : []),
            ...bigStep,
            ...(ocStep ? [`${r.perSqm.toLocaleString()}円/㎡${ocStep} = ${per.toLocaleString()}円/㎡`] : []),
            `${per.toLocaleString()}円/㎡ × ${a.areaSqm}㎡ = ${value.toLocaleString()}円`,
          ],
        },
        // 借地権割合は正面の道路の路線価の記号で決まる
        notation: r.front.notation,
      };
    }
    const per = Math.floor((m.routePrice * thou(m.depthCorrection) * thou(oc)) / 1_000_000);
    const value = perSqmTimesArea(per, a.areaSqm);
    return {
      valuation: {
        value,
        unitPrice: per,
        quantity,
        steps: [
          ...bigStep,
          `路線価 ${m.routePrice.toLocaleString()}円 × 奥行価格補正率 ${m.depthCorrection}${ocStep} = ${per.toLocaleString()}円/㎡`,
          `${per.toLocaleString()}円/㎡ × ${a.areaSqm}㎡ = ${value.toLocaleString()}円`,
        ],
      },
      notation: a.rosenkaSheet?.notation,
    };
  }
  if (m.type === "multiplier") {
    if (!(m.multiplier > 0) || !(m.fixedAssetValue > 0)) {
      return consult("固定資産税評価額と倍率（国税庁の評価倍率表）が未入力です。確認して入力してください。");
    }
    const value = Math.floor((m.fixedAssetValue * thou(m.multiplier)) / 1000);
    return {
      valuation: {
        value,
        multiplier: m.multiplier,
        quantity,
        steps: [
          `固定資産税評価額 ${m.fixedAssetValue.toLocaleString()}円 × 倍率 ${m.multiplier} = ${value.toLocaleString()}円`,
          // 形がいびつでも、形は固定資産税評価額に反映されているので補正しない（通達21-2）
          ...(a.condition === "irregular" && shapeInFixedAssetValue(m.type, a.landUse) ? [`${MULTIPLIER_SHAPE_STEP}（財産評価基本通達21-2）`] : []),
        ],
      },
    };
  }
  // 不特定多数の人が通り抜けに使う私道は評価しない（財産評価基本通達24）。本人がそう選んだときだけ0円にする
  if (m.publicPrivateRoad) return { valuation: { value: 0, quantity, steps: ["誰でも通り抜けできる私道のため評価しない（財産評価基本通達24）"] } };
  // 直接入力：0円のまま確定すると課税価格が過少になるため止める。
  // 人に貸している・借りている土地は、入れた額を自用地としての評価額として、このあと貸家建付地などの計算をする
  const lent = a.use != null && a.use !== "self";
  if (!(m.value > 0))
    return consult(
      "土地の評価額が未入力です。評価額を入力してください。" +
        (lent ? SELF_USE_VALUE_NOTE : "") +
        "誰でも通り抜けできる私道で評価しない土地なら、土地の画面でそのことを選んでください。",
    );
  return { valuation: { value: Math.floor(m.value), quantity, steps: [lent ? "自用地としての評価額（自分で持って自分で使っているとした場合）を直接入力" : "評価額を直接入力"] } };
}

/** 貸家：固定資産税評価額 ×（1 − 借家権割合0.3 × 賃貸割合）（財産評価基本通達93） */
function rentedHouse(fixedAssetValue: number, rentRatio: number | undefined): Valuation {
  const rent4 = ratio4(rentRatio ?? 1);
  if (!validRent4(rent4)) {
    return { value: 0, steps: [], needsConsultation: `${RENT_RATIO_MESSAGE}まったく貸していなければ「家賃をもらって人に貸している」を外してください。` };
  }
  const self = Math.floor(fixedAssetValue);
  const value = rentedBuilding(self, rent4);
  return {
    value,
    multiplier: 1.0,
    usage: "貸家",
    selfUseValue: self,
    steps: [
      `固定資産税評価額 ${fixedAssetValue.toLocaleString()}円 × 1.0`,
      `貸家（人に貸している家屋は、借りている人の権利の分だけ低く評価します）：${self.toLocaleString()}円 ×（1 − 借家権割合 ${RENTAL_RIGHT_RATIO} × 賃貸割合 ${ratioText(rent4)}） = ${value.toLocaleString()}円`,
    ],
  };
}

export function valueAsset(a: Asset): Valuation {
  switch (a.kind) {
    case "land":
      return valueLand(a);
    case "building":
      if (!(a.fixedAssetValue > 0)) {
        return { value: 0, steps: [], needsConsultation: "家屋の固定資産税評価額が未入力です。固定資産税の課税明細書（または評価証明書）を見て入力してください。" };
      }
      if (!a.rented) {
        return {
          value: a.fixedAssetValue,
          multiplier: 1.0,
          usage: "自用家屋",
          steps: [`固定資産税評価額 ${a.fixedAssetValue.toLocaleString()}円 × 1.0`],
        };
      }
      return rentedHouse(a.fixedAssetValue, a.rentRatio);
    case "condo": {
      const excluded = condoExclusion(a);
      // 未入力のまま計算すると0円や過少な評価になるため、そろうまで確定しない（補正の対象外なら補正に使う値は不要）
      const missing = [
        !(a.landValueBeforeCorrection > 0) && "敷地利用権の評価額",
        !(a.landShareSqm > 0) && "敷地利用権の面積",
        !excluded && !(a.totalFloors > 0) && "総階数",
        !excluded && !(a.exclusiveAreaSqm > 0) && "専有部分の面積",
        !excluded && !(a.floor >= 1) && "所在階",
      ].filter((x): x is string => !!x);
      if (missing.length) {
        return {
          value: 0,
          steps: [],
          needsConsultation:
            `${missing.join("・")}が未入力です。登記事項証明書や固定資産税の課税明細書を見て入力してください。` +
            (missing.includes("所在階") ? "地下にある部屋は、相続コンパスでは計算できないため税理士にご相談ください。" : ""),
        };
      }
      // ありえない組み合わせのまま計算すると、もっともらしい評価額が出てしまうため止める
      const { years: by, months: bm } = a.builtYearsMonths ?? { years: 0, months: 0 };
      const impossible = [
        a.totalFloors > 0 && a.floor > a.totalFloors && `所在階（${a.floor}階）が建物の総階数（${a.totalFloors}階）より上になっています`,
        (!Number.isInteger(by) || by < 0) && "築年数の年が0以上の整数になっていません",
        (!Number.isInteger(bm) || bm < 0 || bm > 11) && "築年数の月が0〜11になっていません",
      ].filter((x): x is string => !!x);
      if (impossible.length) {
        return { value: 0, steps: [], needsConsultation: `${impossible.join("。")}。登記事項証明書を見て入れ直してください。` };
      }
      let correction = 10000; // 区分所有補正率 ×1/10000
      let first: string;
      if (excluded) {
        first = `${excluded}（区分所有補正率 1）`;
      } else {
        const c = condoCorrection(a);
        if (c.ratio <= 0) {
          return {
            value: 0,
            steps: [],
            needsConsultation: "評価乖離率が0以下になるため、通常の方法では評価できません（国税庁の通達では個別に評価します）。税理士にご相談ください。",
          };
        }
        correction = c.correction;
        first = `評価乖離率 ${(c.ratio / 1000).toFixed(3)}（${c.note}）→ 区分所有補正率 ${(c.correction / 10000).toFixed(4)}`;
      }
      const land = Math.floor((a.landValueBeforeCorrection * correction) / 10000);
      const bldg = Math.floor((a.buildingFixedAssetValue * correction) / 10000);
      const steps = [
        first,
        `敷地利用権 ${a.landValueBeforeCorrection.toLocaleString()}円 × 補正率 = ${land.toLocaleString()}円`,
        `区分所有権 ${a.buildingFixedAssetValue.toLocaleString()}円 × 補正率 = ${bldg.toLocaleString()}円`,
      ];
      // 人に貸している部屋：部屋は貸家、敷地利用権は貸家建付地として、区分所有補正のあとの額から計算する（財産評価基本通達26・93）
      let landValue = land;
      let bldgValue = bldg;
      const rentedPart: Pick<Valuation, "selfUseValue" | "leaseRatio" | "rentedLandPart"> = {};
      if (a.rented) {
        const rent4 = ratio4(a.rentRatio ?? 1);
        if (!validRent4(rent4)) {
          return { value: 0, steps: [], needsConsultation: `${RENT_RATIO_MESSAGE}まったく貸していなければ「家賃をもらって人に貸している」を外してください。` };
        }
        const lease4 = a.leaseRatio != null && a.leaseRatio > 0 ? ratio4(a.leaseRatio) : undefined;
        if (lease4 == null) {
          return {
            value: 0,
            steps: [],
            needsConsultation:
              "人に貸している部屋の敷地は、借地権割合を使って評価します。マンションの画面で借地権割合を選んでください（路線価図の、マンションが面している道路の路線価の数字のあとの記号 A〜G。倍率地域では評価倍率表の「借地権割合」の欄）。",
          };
        }
        if (!validLease4(lease4)) return { value: 0, steps: [], needsConsultation: LEASE_RATIO_INVALID.replace("土地の画面", "マンションの画面") };
        landValue = rentedHouseLand(land, lease4, rent4);
        bldgValue = rentedBuilding(bldg, rent4);
        // 一部の部屋が空いているとき：貸付事業用宅地等の対象は、敷地利用権（区分所有補正後・部屋の分を除く）のうち貸している部分だけ
        if (rent4 < 10000) rentedPart.rentedLandPart = rentedHouseLandPart(land, lease4, rent4);
        const R = ratioText(rent4);
        steps.push(
          `敷地利用権（貸家建付地）：${land.toLocaleString()}円 ×（1 − 借地権割合 ${ratioText(lease4)} × 借家権割合 ${RENTAL_RIGHT_RATIO} × 賃貸割合 ${R}） = ${landValue.toLocaleString()}円`,
          `区分所有権（貸家）：${bldg.toLocaleString()}円 ×（1 − 借家権割合 ${RENTAL_RIGHT_RATIO} × 賃貸割合 ${R}） = ${bldgValue.toLocaleString()}円`,
        );
        rentedPart.selfUseValue = land + bldg;
        rentedPart.leaseRatio = lease4 / 10000;
      }
      return {
        value: landValue + bldgValue,
        steps,
        ...rentedPart,
        // 部屋（家屋）の評価額が0円のままでは確定しない。ただし金額は返す：
        // 計算部分（engine・第11表）は家屋の評価額を0にして呼び、敷地利用権の部分だけの金額を得ているため
        ...(a.buildingFixedAssetValue > 0
          ? {}
          : { needsConsultation: "区分所有建物（部屋）の固定資産税評価額が未入力です。固定資産税の課税明細書を見て入力してください。" }),
      };
    }
    case "deposit":
    case "cash":
    case "household":
    case "other": {
      const v = a.amount + (a.accruedInterest ?? 0);
      return { value: v, steps: [a.accruedInterest ? `残高＋既経過利息` : `金額`] };
    }
    case "listedStock": {
      const p = a.prices;
      // 未入力（0）を最も低い価格として採用しないよう、4つの価格がそろうまで確定しない
      if (![p.close, p.monthAvg, p.prevMonthAvg, p.prev2MonthAvg].every((x) => x > 0) || !(a.shares > 0)) {
        return {
          value: 0,
          quantity: `${a.shares}株`,
          steps: [],
          needsConsultation: "株数と4つの価格（亡くなった日の終値、その月・前月・前々月の終値の平均）がそろっていません。証券会社の資料で確認して入力してください。",
        };
      }
      const unit = Math.min(p.close, p.monthAvg, p.prevMonthAvg, p.prev2MonthAvg);
      // 価格は小数（0.01円単位）、株数は0.001株単位の整数にして掛け、浮動小数点の誤差を持ち込まない（1円未満切捨て）
      const value = mulDiv(Math.round(unit * 100), thou(a.shares), 100_000);
      return {
        value,
        unitPrice: unit,
        quantity: `${a.shares}株`,
        steps: [`4つの価格のうち最も低い ${unit.toLocaleString()}円 × ${a.shares.toLocaleString()}株 = ${value.toLocaleString()}円`],
      };
    }
    case "unlistedStock":
      if (a.value == null) {
        return {
          value: 0,
          quantity: `${a.shares}株`,
          steps: [],
          needsConsultation: "非上場株式の評価額が未入力です。税理士にご相談ください。",
        };
      }
      return { value: a.value, quantity: `${a.shares}株`, steps: ["評価額を入力"] };
    case "insurance":
    case "retirement":
      return { value: a.amount, steps: ["受取金額"] };
  }
}

/**
 * 小規模宅地等の特例。付表1の⑤⑥⑦の順に計算する。
 * ⑥ = ④ × ⑤/③（1円未満切捨て）、⑦ = ⑥ × 減額割合（特定居住用・特定事業用 80/100、貸付事業用 50/100。1円未満切捨て）
 */
export function smallResidentialSelection(value: number, areaSqm: number, limitSqm = 330, ratePercent = 80) {
  if (areaSqm <= 0 || value <= 0) return { selectedArea: 0, selectedValue: 0, reduction: 0 };
  const area100 = Math.round(areaSqm * 100);
  const target100 = Math.min(area100, Math.max(0, Math.round(limitSqm * 100)));
  const selectedValue = Number((BigInt(value) * BigInt(target100)) / BigInt(area100));
  return { selectedArea: target100 / 100, selectedValue, reduction: Math.floor((selectedValue * ratePercent) / 100) };
}

export function smallResidentialReduction(value: number, areaSqm: number, limitSqm = 330, ratePercent = 80) {
  return smallResidentialSelection(value, areaSqm, limitSqm, ratePercent).reduction;
}
