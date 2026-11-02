/**
 * 相続コンパスのドメインモデル。
 * 金額はすべて円単位の整数、日付は ISO 8601 (YYYY-MM-DD) 文字列。
 */

export type ISODate = string;

/** 被相続人との関係（続柄）。相続順位と2割加算の判定に使う */
export type Relation =
  | "spouse" // 配偶者
  | "child" // 子（実子）
  | "adoptedChild" // 養子
  | "grandchild" // 孫（代襲相続人、または孫養子でない受遺者）
  | "greatGrandchild" // ひ孫（再代襲）
  | "parent" // 父母
  | "grandparent" // 祖父母
  | "sibling" // 兄弟姉妹
  | "nephewNiece" // 甥姪（兄弟姉妹の代襲相続人）
  | "other"; // 相続人以外の受遺者（内縁・知人など）

export interface Person {
  id: string;
  name: string;
  kana?: string;
  relation: Relation;
  /** 申告書・協議書に書く続柄の表示（例：妻、長男、二女、孫） */
  relationLabel?: string;
  birthDate?: ISODate;
  /** 郵便番号（例：100-0001） */
  zip?: string;
  /** 被相続人より先に死亡（代襲の起点になる） */
  predeceased?: boolean;
  /** 代襲相続人の場合、被代襲者（先に亡くなった親）の id */
  substituteOf?: string;
  /** 相続放棄 */
  renounced?: boolean;
  /** 兄弟姉妹の場合：父母の一方のみを同じくする（半血） */
  halfBlood?: boolean;
  /** 養子の場合：実子とみなされる養子（特別養子・配偶者の連れ子養子・代襲相続人の養子） */
  adoptedCountsAsBiological?: boolean;
  /** 孫を養子にした場合（代襲相続人でない孫養子は2割加算の対象） */
  grandchildAdopted?: boolean;
  /** 障害者控除の区分 */
  disability?: "none" | "general" | "special";
  /** 住所（申告書第1表・遺産分割協議書用） */
  address?: string;
  occupation?: string;
  phone?: string;
  /** 国外に住所がある（非居住者）。自動完結の対象外 */
  nonResident?: boolean;
}

export interface Decedent {
  name: string;
  kana?: string;
  birthDate: ISODate;
  deathDate: ISODate;
  address: string;
  occupation?: string;
}

export type AssetKind =
  | "land" // 土地
  | "building" // 家屋（一戸建て等）
  | "condo" // 分譲マンション（敷地権＋区分所有建物）
  | "deposit" // 預貯金
  | "cash" // 現金
  | "listedStock" // 上場株式
  | "unlistedStock" // 非上場株式（評価額入力のみ）
  | "insurance" // 死亡保険金（みなし相続財産）
  | "retirement" // 死亡退職金（みなし相続財産）
  | "household" // 家庭用財産
  | "other"; // その他の財産

export interface AssetBase {
  id: string;
  kind: AssetKind;
  /** 所在・銀行名などの表示名 */
  label: string;
  /** 国外財産。自動完結の対象外 */
  foreign?: boolean;
}

export type LandMethod =
  | { type: "rosenka"; routePrice: number; depthCorrection: number; otherCorrection?: number }
  | { type: "multiplier"; fixedAssetValue: number; multiplier: number }
  | { type: "manual"; value: number };

export interface LandAsset extends AssetBase {
  kind: "land";
  location: string;
  areaSqm: number;
  landUse: "宅地" | "田" | "畑" | "山林" | "雑種地" | "その他";
  method: LandMethod;
  /** 地図で選択した地点 */
  geo?: { lat: number; lng: number };
  /** 小規模宅地等の特例（特定居住用宅地等）を適用する */
  smallResidential?: { applies: boolean; acquirerId?: string };
}

export interface BuildingAsset extends AssetBase {
  kind: "building";
  location: string;
  fixedAssetValue: number;
}

export interface CondoAsset extends AssetBase {
  kind: "condo";
  location: string;
  /** 敷地利用権の自用地評価額（路線価×地積×敷地権割合など）。補正前 */
  landValueBeforeCorrection: number;
  /** 区分所有建物の固定資産税評価額 */
  buildingFixedAssetValue: number;
  /** 区分所有補正率の計算要素 */
  builtYearsMonths: { years: number; months: number };
  totalFloors: number;
  floor: number;
  landShareSqm: number; // 敷地利用権の面積
  exclusiveAreaSqm: number; // 専有部分の床面積
  smallResidential?: { applies: boolean; acquirerId?: string; landShareSqm?: number };
}

export interface MoneyAsset extends AssetBase {
  kind: "deposit" | "cash" | "household" | "other";
  amount: number;
  /** 預貯金の既経過利息（源泉税控除後） */
  accruedInterest?: number;
  /** 申告書（第11表の付表3）用：金融機関名・支店名・口座種別 */
  institution?: string;
  branch?: string;
  accountType?: string;
}

export interface ListedStockAsset extends AssetBase {
  kind: "listedStock";
  shares: number;
  /** 課税時期の終値、課税時期の月・前月・前々月の終値平均のうち最も低い価額 */
  prices: { close: number; monthAvg: number; prevMonthAvg: number; prev2MonthAvg: number };
}

export interface UnlistedStockAsset extends AssetBase {
  kind: "unlistedStock";
  /** 税理士等が算定した評価額。未入力の場合は相談が必要 */
  value?: number;
  shares: number;
}

export interface DeemedAsset extends AssetBase {
  kind: "insurance" | "retirement";
  amount: number;
  /** 受取人（遺産分割の対象外。受取人が取得する） */
  recipientId: string;
}

export type Asset =
  | LandAsset
  | BuildingAsset
  | CondoAsset
  | MoneyAsset
  | ListedStockAsset
  | UnlistedStockAsset
  | DeemedAsset;

export interface Debt {
  id: string;
  kind: "debt" | "funeral";
  label: string;
  amount: number;
  /** 負担者ごとの金額 */
  bearers: { personId: string; amount: number }[];
}

/** 遺産分割：財産ごとに誰がどれだけ取得するか（割合） */
export interface Allocation {
  assetId: string;
  shares: { personId: string; numerator: number; denominator: number }[];
}

/** 相続開始前3年以内の暦年課税贈与（令和8年中の相続開始は3年） */
export interface PriorGift {
  personId: string;
  date: ISODate;
  amount: number;
  giftTaxPaid: number;
}

export interface Case {
  id: string;
  title: string;
  decedent: Decedent;
  persons: Person[];
  assets: Asset[];
  debts: Debt[];
  allocations: Allocation[];
  priorGifts: PriorGift[];
  /** 申告書の提出先税務署・提出日 */
  filing?: { taxOffice: string; submitDate?: ISODate };
}
