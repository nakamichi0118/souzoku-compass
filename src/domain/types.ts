import type { Receivable } from "./review/receivables";
/**
 * 相続コンパスのドメインモデル。
 * 金額はすべて円単位の整数、日付は ISO 8601 (YYYY-MM-DD) 文字列。
 */
import type { ReviewState } from "./review/topics";

import type { District } from "./valuation/depth";
import type { RoadInput } from "./valuation/roads";
import type { SmallResidentialCheck } from "./valuation/smallResidential";

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
  /** 亡くなった日（先に亡くなった方・あとから亡くなった方の確認用） */
  deathDate?: ISODate;
  /** 先に亡くなった子・兄弟姉妹に子どもがいるか（代襲相続人の確認用） */
  hasChildren?: boolean;
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
  /** 孫養子が、先に亡くなった子の代わりに相続する人（代襲相続人）でもある（二重の資格）。自動計算の対象外 */
  alsoSubstituteHeir?: boolean;
  /** 障害者控除の区分 */
  disability?: "none" | "general" | "special";
  /** 住所（申告書第1表・遺産分割協議書用） */
  address?: string;
  occupation?: string;
  phone?: string;
  /** 国外に住所がある（非居住者）。自動完結の対象外 */
  nonResident?: boolean;
  /**
   * 以前の相続でも未成年者控除を受けた（相続税法19条の3第3項）。
   * date：その前の相続（最初に控除を受けた相続）が始まった日。amount：これまでの相続で控除を受けた金額の合計（扶養義務者から引いた分を含む）
   */
  priorMinorCredit?: PriorCredit;
  /** 以前の相続でも障害者控除を受けた（相続税法19条の4第3項）。中身は priorMinorCredit と同じ */
  priorDisabilityCredit?: PriorCredit;
}

/** 以前の相続で受けた未成年者控除・障害者控除 */
export interface PriorCredit {
  /** 最初に控除を受けた相続が始まった日 */
  date?: ISODate;
  /** これまでに控除を受けた金額の合計（本人と扶養義務者の分の合計） */
  amount?: number;
  /**
   * 障害者控除のときだけ：最初に控除を受けた相続のときの区分が特別障害者だったか（true＝特別、false＝一般、未設定＝今と同じ区分）。
   * 区分が変わったときの計算は相基通19の4-4
   */
  special?: boolean;
}

export interface Decedent {
  name: string;
  kana?: string;
  birthDate: ISODate;
  deathDate: ISODate;
  address: string;
  /** 最後の住所の郵便番号 */
  zip?: string;
  occupation?: string;
  /** 亡くなった方が、亡くなる前10年以内に相続で財産を受け取り相続税を納めていた（相次相続控除の対象）。"unknown"＝分からない（控除は見込まず、確かめ方を案内する） */
  priorInheritanceTax?: boolean | "unknown";
  /**
   * 相続時精算課税を選んで贈与した財産がある（贈与の欄で「精算課税」の印を付けた贈与を計算に入れる）。
   * "unknown"＝分からない。入れ忘れると後で追加の納税になりやすいので、確かめるまで計算を止める
   */
  settlementGift?: boolean | "unknown";
  /**
   * 相次相続控除の計算に使う前の相続の内容（priorInheritanceTax のとき）。
   * 相続税法20条：A × C/(B−A)（100/100が上限） × (10−E)/10
   */
  priorInheritance?: {
    /** 前の相続が始まった日（前の相続で亡くなった方が亡くなった日）。経過年数 E（1年未満切捨て）に使う */
    date?: ISODate;
    /** A：今回亡くなった方が、前の相続で納めた相続税額 */
    prevTax?: number;
    /** B：今回亡くなった方が、前の相続で取得した財産の価額（債務控除後） */
    prevAcquired?: number;
  };
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
  /** 書類から読み取って登録したが、まだ確かめていない・入っていない項目（確認待ち） */
  pending?: string[];
  /** この財産の書類（残高証明書など）：読み取った書類のファイル名か「手元にあり」。資料集めの印は書類の種類ごとなので、口座・土地ごとにはこちらで見る */
  docFrom?: string;
}

export type LandMethod =
  | {
      type: "rosenka";
      /** 正面路線の路線価（道路が1つの場合の入力。roads があればそちらを使う） */
      routePrice: number;
      depthCorrection: number;
      otherCorrection?: number;
      /** 地区区分（奥行価格補正・加算率に使う） */
      district?: District;
      /** 面している道路ごとの路線価と奥行（2つ以上の道路に面する場合の評価に使う） */
      roads?: RoadInput[];
      /** 地図で合わせた土地の枠（間口・奥行・向き）。以前の四角形の入力 */
      lot?: { center: [number, number]; width: number; depth: number; rotation: number };
      /** 地図で囲んだ土地の形（多角形の頂点の緯度経度、順番どおり） */
      shape?: [number, number][];
      /** 土地の形の各辺が道路に接しているか（本人が確かめたもの。i 番目は 頂点i → 頂点i+1 の辺） */
      edgeOn?: boolean[];
    }
  | {
      type: "multiplier";
      fixedAssetValue: number;
      multiplier: number;
      /** 倍率の出典（国税庁の評価倍率表のどの行か。本人が確認したもの） */
      source?: { city: string; town: string; area?: string; pdfUrl?: string; page?: number };
    }
  | {
      type: "manual";
      value: number;
      /** 不特定多数の人が通り抜けに使う私道で、評価しない（0円。財産評価基本通達24）と本人が選んだ */
      publicPrivateRoad?: boolean;
    };

export interface RosenkaSheet {
  /** 国税庁の路線価図PDFのURL（アップロードした場合はなし） */
  url?: string;
  page?: number;
  points: { img: [number, number]; latlng: [number, number] }[];
  /** 路線価図1枚分の枠（中心・縮尺の分母・回転角） */
  frame?: { center: [number, number]; scale: number; rotation: number };
  /** 読み取った路線価の表記（例：420D） */
  notation?: string;
}

/** 地図で評価している途中の内容 */
export interface MapDraft {
  step: number;
  route?: "rosenka" | "ratio";
  shape?: [number, number][];
  edgeOn?: boolean[];
  district?: string;
  sheet?: Omit<RosenkaSheet, "notation">;
}

/** 相続登記の申請書に書く事項（登記事項証明書・固定資産税の課税明細書から写す） */
export interface RegistryInfo {
  /** 固定資産評価額（登録免許税の課税標準）。マンションは区分建物の評価額 */
  assessedValue?: number;
  /** 地番（土地）。未入力なら所在から推定 */
  lotNumber?: string;
  /** 家屋番号（建物・区分建物） */
  houseNumber?: string;
  /** 種類（例：居宅） */
  buildingType?: string;
  /** 構造（例：木造かわらぶき2階建） */
  structure?: string;
  /** 床面積（例：1階 62.10㎡ 2階 48.30㎡） */
  floorArea?: string;
  /** 一棟の建物の名称（マンション） */
  buildingName?: string;
  /** 敷地権の目的である土地の所在・地番・地目・地積（マンション） */
  siteLand?: string;
  /** 敷地権の種類と割合（例：所有権 10000分の215） */
  siteRight?: string;
  /** 敷地権の土地の固定資産評価額 × 敷地権の割合（マンション） */
  siteAssessedValue?: number;
}

export interface LandAsset extends AssetBase {
  kind: "land";
  location: string;
  areaSqm: number;
  landUse: "宅地" | "田" | "畑" | "山林" | "雑種地" | "その他";
  method: LandMethod;
  /** 地図で選択した地点 */
  geo?: { lat: number; lng: number };
  /** 地図に重ねた路線価図（基準点は画像の幅・高さを1とした座標と緯度経度の組） */
  rosenkaSheet?: RosenkaSheet;
  /**
   * 地図で評価している途中の内容（評価額には使わない）。開き直したら、このステップから続ける。
   * 評価を反映したら消す
   */
  mapDraft?: MapDraft;
  /** 土地の使い方（評価が変わる）。未設定は "self"（自分で使っている＝自用地） */
  use?: LandUse;
  /** 貸家建付地・貸家建付借地権の賃貸割合（0より大きく1以下。未設定は1＝全部貸している） */
  rentRatio?: number;
  /**
   * 借地権割合（0より大きく1未満。例 0.6）。貸家建付地・貸宅地・借地権の評価に使う。
   * 未設定なら、路線価方式は正面の道路の記号（A〜G）から、倍率方式は評価倍率表の借地権割合から決める
   */
  leaseRatio?: number;
  /**
   * 評価に影響する、この土地の事情（本人が選んだもの）。どれかがあると、相続コンパスでは評価せず税理士への相談を案内する
   * irregular：形がいびつ（旗竿地・三角形・L字など）、setback：道路の幅が4m未満で建て替えのとき下がる部分がある、
   * spouseResidence：配偶者居住権を設定した
   */
  condition?: "irregular" | "setback" | "spouseResidence";
  /** 小規模宅地等の特例を適用する（種類は smallLandKind で使い方と答えから決める） */
  smallResidential?: SmallLandRelief;
  registry?: RegistryInfo;
}

/** 土地の使い方 */
export type LandUse =
  | "self" // 自分で使っている（自宅・空き地・青空駐車場など）
  | "rentedHouse" // アパート・貸家を建てて貸している（貸家建付地）
  | "leasedLand" // 土地を人に貸し、相手が建物を建てている（貸宅地）
  | "leasehold" // 人の土地を借りて建物を建てている（借地権）
  | "rentedLeasehold"; // 人の土地を借りてアパート・貸家を建て、家賃をもらって貸している（貸家建付借地権。通達28）

/** 小規模宅地等の特例の種類（租税特別措置法69条の4） */
export type SmallLandKind =
  | "residence" // 特定居住用宅地等（330㎡まで80%減額）
  | "business" // 特定事業用宅地等（400㎡まで80%減額）
  | "rental"; // 貸付事業用宅地等（200㎡まで50%減額）

/** 小規模宅地等の特例の入力（土地・マンション共通） */
export interface SmallLandRelief {
  applies: boolean;
  acquirerId?: string;
  check?: SmallResidentialCheck;
  /** マンション：特例の対象にする敷地権の面積（未設定は敷地権の面積） */
  landShareSqm?: number;
  /**
   * 取得する人が、受け継いだ面積のうち特例を使う面積の上限（㎡。付表1の⑤「選択特例対象宅地等の面積」に入れる面積）。
   * 未設定なら、限度面積の範囲でできるだけ使う（ほかの土地との割り当てはエンジンが決める）
   */
  selectedSqm?: number;
  /**
   * この土地を一緒に受け継ぎ、特例を使うほかの人（共有で取得したとき）。
   * check からは人ごとの答え（livedTogether・keep・continues・confirmedByAdvisor）だけを使い、
   * 土地についての答え（ownHome・special・business・familyHome・recent）は最初の人の check を使う
   */
  others?: SmallLandAcquirer[];
}

/** 小規模宅地等の特例を使う2人目以降の取得者 */
export interface SmallLandAcquirer {
  acquirerId: string;
  check?: SmallResidentialCheck;
  /** この人が特例を使う面積の上限（㎡）。未設定なら限度面積の範囲でできるだけ使う */
  selectedSqm?: number;
}

export interface BuildingAsset extends AssetBase {
  kind: "building";
  location: string;
  fixedAssetValue: number;
  /** 人に貸している家屋（貸家）。評価は 固定資産税評価額 ×（1 − 借家権割合0.3 × 賃貸割合） */
  rented?: boolean;
  /** 賃貸割合（0より大きく1以下。未設定は1） */
  rentRatio?: number;
  registry?: RegistryInfo;
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
  /** 居住用の専有部分が3室以下で、そのすべてを本人・親族が住まいに使っている（区分所有補正の対象外） */
  fewUnitsFamily?: boolean;
  /** 人に貸している部屋。部屋は貸家、敷地利用権は貸家建付地として評価する */
  rented?: boolean;
  /** 賃貸割合（0より大きく1以下。未設定は1） */
  rentRatio?: number;
  /** 敷地の借地権割合（0より大きく1未満。貸している部屋のときに使う。路線価図の記号 A〜G から） */
  leaseRatio?: number;
  smallResidential?: SmallLandRelief;
  registry?: RegistryInfo;
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
  /** 亡くなったあとに受け取るお金（還付金・高額療養費など）。種類と日付で相続財産になるかを決める（domain/review/receivables.ts） */
  receivable?: Receivable;
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
  /** 申告書（第13表）用：債権者・支払先の氏名又は名称と住所 */
  creditor?: string;
  creditorAddress?: string;
  /** 申告書（第13表）の種類 */
  debtType?: "公租公課" | "銀行借入金" | "未払金" | "その他";
  /** 負担者ごとの金額 */
  bearers: { personId: string; amount: number }[];
}

/** 遺産分割：財産ごとに誰がどれだけ取得するか（割合） */
export interface Allocation {
  assetId: string;
  shares: { personId: string; numerator: number; denominator: number }[];
}

/**
 * 亡くなった方からの生前贈与。
 * 暦年課税：相続開始前3年以内のものを加算（令和8年中の相続開始は3年）。
 * 相続時精算課税（settlement）：期間に関係なく加算。令和6年以後の贈与は年110万円の基礎控除を引いた額。
 */
export interface PriorGift {
  personId: string;
  date: ISODate;
  amount: number;
  giftTaxPaid: number;
  /** 相続時精算課税を選んだ贈与 */
  settlement?: boolean;
}

/** 代償金：財産を多く受け継いだ人が、ほかの相続人に払うお金（代償分割） */
export interface Compensation {
  fromId: string;
  toId: string;
  amount: number;
  /**
   * 代償金の額を、特定の財産の時価（通常の取引価額）をもとに決めた（相続税の申告のしかた・相基通11の2-10(2)）。
   * このとき課税価格に入れる代償金の額は 代償金 × その財産の相続税評価額 ÷ 時価（1円未満切捨て）
   */
  basis?: { assetId: string; marketValue: number };
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
  /**
   * 申告期限までに分け方が決まらない（未分割）。true のとき、取得者が決まっていない財産は
   * 民法の法定相続分で取得したものとして計算する（相続税法55条）
   */
  undivided?: boolean;
  /** 代償金（代償分割） */
  compensation?: Compensation[];
  /** 申告書の提出先税務署・提出日 */
  /** taxOfficeFrom：税務署を住所から自動で入れたときの、その住所（番地より前）。住所が変わったら調べ直す */
  filing?: { taxOffice: string; taxOfficeFrom?: string; submitDate?: ISODate };
  /** 相続税申告のステップのうち「次へ」で完了にしたもの（進捗表示用。計算には使わない） */
  /** completed：「次へ」で完了にしたステップ。formsKey：申告書PDFを作ったときの入力の目印（src/lib/progress.ts formsKey） */
  progress?: { completed: string[]; formsKey?: string };
  /** 申告前の確認（財産の入れ漏れ・お金の動き・特殊事情。計算には使わない） */
  review?: ReviewState;
}
