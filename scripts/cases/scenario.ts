/**
 * 相続のテストケース（シナリオ）の形。
 *
 * アプリの入力（src/domain/types.ts の Case）とは別に、「実際の相続で起きること」をそのまま書く。
 * アプリで入力できない事柄（貸家建付地・代償分割・未分割など）も書けるようにしてあり、
 * シナリオ → アプリの入力への変換（toCase.ts）で、入力できないものは「入力できない」と記録する。
 *
 * 金額は円の整数、日付は YYYY-MM-DD、面積は㎡。亡くなった日は令和8年（2026年）中。
 */

export type MemberRelation =
  | "spouse"
  | "child"
  | "adoptedChild" // 普通養子
  | "grandchild" // 孫（代襲相続人、または受遺者）
  | "greatGrandchild"
  | "parent"
  | "grandparent"
  | "sibling"
  | "nephewNiece"
  | "other"; // 相続人でない受遺者（内縁の配偶者・知人・法人ではない個人）

export interface Member {
  id: string;
  name: string;
  relation: MemberRelation;
  birthDate: string;
  /** 亡くなった方より先に亡くなっている */
  predeceased?: boolean;
  /** 代襲相続人のとき、先に亡くなった親の id */
  substituteOf?: string;
  /** 相続を放棄した */
  renounced?: boolean;
  /** 兄弟姉妹で、父母の一方だけが同じ（半血） */
  halfBlood?: boolean;
  /** 養子のうち、実子とみなされるもの（特別養子・配偶者の連れ子養子・代襲相続人の養子） */
  adoptedCountsAsBiological?: boolean;
  /** 孫を養子にした（代襲相続人でない孫養子は2割加算） */
  grandchildAdopted?: boolean;
  /** 障害者控除（一般・特別） */
  disability?: "general" | "special";
  /** 日本に住所がない */
  nonResident?: boolean;
  /** 亡くなった方の後、申告前に亡くなった（数次相続） */
  diedAfter?: string;
  /** 亡くなった時点で胎児（生まれた日を birthDate に書く） */
  unborn?: boolean;
}

/** 道路1本（路線価方式） */
export interface ScenarioRoad {
  /** 正面・側方・裏面（二方） */
  position: "front" | "side" | "back";
  /** 路線価（円/㎡、千円単位の表示を円にしたもの） */
  price: number;
  /** その道路から見た奥行距離（m） */
  depth: number;
  /** 間口（m） */
  frontage: number;
  /** 路線価の記号（借地権割合 A〜G） */
  leaseLetter: "A" | "B" | "C" | "D" | "E" | "F" | "G";
}

export type LandValuation =
  | {
      kind: "rosenka";
      district: "ビル街地区" | "高度商業地区" | "繁華街地区" | "普通商業・併用住宅地区" | "普通住宅地区" | "中小工場地区" | "大工場地区";
      roads: ScenarioRoad[];
    }
  | { kind: "multiplier"; fixedAssetValue: number; rate: number; leaseRatio?: number };

/** 土地の使い方（評価が変わる） */
export type LandUse =
  | "self" // 自分で使っている（自用地）
  | "rentedHouse" // 貸家（アパート等）の敷地＝貸家建付地
  | "leasedLand" // 人に土地を貸して建物を建ててもらっている＝貸宅地（底地）
  | "leasehold" // 人の土地を借りて家を建てている＝借地権
  | "parking"; // 青空駐車場（自用地として評価）

/** 小規模宅地等の特例の種類 */
export type SmallLandKind =
  | "residence" // 特定居住用（330㎡・80%）
  | "business" // 特定事業用（400㎡・80%）
  | "rental"; // 貸付事業用（200㎡・50%）

export type EstateItem =
  | { id: string; type: "deposit" | "cash" | "household" | "other"; label: string; amount: number; foreign?: boolean }
  | { id: string; type: "listedStock"; label: string; shares: number; prices: { close: number; monthAvg: number; prevMonthAvg: number; prev2MonthAvg: number } }
  | { id: string; type: "unlistedStock"; label: string; shares: number; value: number }
  | { id: string; type: "insurance" | "retirement"; label: string; amount: number; recipient: string }
  | {
      id: string;
      type: "land";
      label: string;
      areaSqm: number;
      landUse: "宅地" | "田" | "畑" | "山林" | "雑種地";
      valuation: LandValuation;
      use: LandUse;
      /** 貸家建付地・貸家の賃貸割合（0〜1、既定1） */
      rentRatio?: number;
      /** 小規模宅地等の特例を使う */
      smallLand?: { kind: SmallLandKind; acquirer: string };
      /** 配偶者居住権が設定されている */
      spouseResidenceRight?: boolean;
      /** 地積規模の大きな宅地などの補正の対象（アプリでは評価しない減額） */
      needsReduction?: "largeLot" | "irregular" | "setback";
      foreign?: boolean;
    }
  | { id: string; type: "building"; label: string; fixedAssetValue: number; rented?: boolean; rentRatio?: number }
  | {
      id: string;
      type: "condo";
      label: string;
      /** 敷地権の自用地評価額（補正前） */
      landValue: number;
      buildingFixedAssetValue: number;
      builtYears: number;
      builtMonths: number;
      totalFloors: number;
      floor: number;
      landShareSqm: number;
      exclusiveAreaSqm: number;
      rented?: boolean;
      smallLand?: { kind: SmallLandKind; acquirer: string };
    };

export interface ScenarioDebt {
  id: string;
  kind: "debt" | "funeral";
  label: string;
  amount: number;
  /** 負担する人ごとの金額 */
  bearers: { who: string; amount: number }[];
}

export interface ScenarioGift {
  to: string;
  date: string;
  amount: number;
  giftTaxPaid: number;
  /** 相続時精算課税を選んだ贈与（令和6年以降は年110万円の基礎控除あり） */
  settlement?: boolean;
}

/** 遺産の分け方 */
export type Division =
  | { kind: "agreed"; shares: Record<string, { who: string; n: number; d: number }[]>; compensation?: { from: string; to: string; amount: number }[] }
  | { kind: "undivided" }; // 申告期限までに分割されていない（法定相続分で課税価格を計算）

export interface Scenario {
  id: string;
  /** どんな相続か（日本語の短い説明） */
  title: string;
  /** どの特徴を含むか（集計用。例：「配偶者と子2人」「貸家建付地」「代償分割」） */
  tags: string[];
  decedent: {
    name: string;
    birthDate: string;
    deathDate: string;
    address: string;
    /** 10年以内に相続税を払って財産を受け取っていた（相次相続控除） */
    priorInheritance?: { yearsAgo: number; prevTax: number; prevAcquired: number };
  };
  members: Member[];
  estate: EstateItem[];
  debts: ScenarioDebt[];
  gifts: ScenarioGift[];
  division: Division;
}

/** 正しい答え（アプリとは別に、法令・通達から計算したもの） */
export interface Expected {
  /** この相続を正しく計算できる（false なら、正しくは「税理士に相談」と案内して止めるべき相続） */
  computable: boolean;
  /** computable=false の理由 */
  outOfScope?: string;
  legalHeirCount: number;
  basicDeduction: number;
  /** 課税価格の合計（各人の1,000円未満切捨ての合計） */
  totalTaxablePrice: number;
  /** 相続税の総額 */
  totalTax: number;
  /** 一人ひとりの課税価格と納付税額（100円未満切捨て。還付・0円は0）と還付される税額（相続時精算課税の贈与税が引ききれないとき） */
  persons: { id: string; taxablePrice: number; payable: number; refund?: number }[];
  /** 申告が必要か（課税価格の合計が基礎控除を超える、または特例の適用で0円になる場合も必要） */
  filingRequired: boolean;
  /** 計算の過程（確認用の短いメモ） */
  notes: string[];
}
