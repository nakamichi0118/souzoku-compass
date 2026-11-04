/**
 * 人が亡くなった後の手続きのルール表。
 * 各手続きの「対象になる条件」「期限（法定）または目安」「どこで」「何を持って」「根拠」を、
 * 法令と各省庁の公開案内をもとに今回独自に整理したもの。Claude は使わず、このルール表だけで手続きリストを作る。
 *
 * 期限の起算日は、簡単のため「亡くなった日（＝亡くなったことを知った日）」とする。
 */
import { addDays, addYears, earlier, jpDate, monthsDeadline, nextOpenDay, withinDays, yearOf, yearsDeadline, monthOf, type ISODate } from "./dates";
import type { OfficeKind } from "./offices";
import { estimate, needsFinalReturn, type Estimate, type Interview, type Verdict } from "./interview";

/** 年金の受給停止の手続き名に出す年金の種類（国民年金だけ14日以内、それ以外は10日以内） */
const PENSION_LABEL: Record<Interview["pension"], string> = {
  none: "",
  employees: "厚生年金",
  national: "国民年金",
  survivor: "遺族年金",
  unknown: "受けていたか確認",
};

export type Category = "届出" | "葬儀・法要" | "調べる・決める" | "お金の受け取り" | "税金" | "名義変更・解約" | "不動産";

export interface Ctx {
  iv: Interview;
  est: Estimate;
}

export interface Rule {
  id: string;
  title: string | ((x: Ctx) => string);
  category: Category;
  /** 期限または目安の日付 */
  due: (death: ISODate, x: Ctx) => ISODate;
  /** true なら法律上の期限、false なら目安 */
  hard: boolean;
  /**
   * false なら、期限が土日祝日・年末年始でも次の平日にずらさない。
   * 「この日までに売る」のように、役所への提出ではない期限に使う（休日でずれるのは提出や納付の期限だけ）
   */
  shiftHoliday?: false;
  /** 並べる順の基準日（期限より前に済ませる手続き。例：火葬許可は火葬の前） */
  sortDue?: (death: ISODate) => ISODate;
  /** 目安の手続きに、別に法律上の期限がある場合 */
  limit?: { due: (death: ISODate) => ISODate; text: string };
  applies: (x: Ctx) => boolean;
  /** 該当する場合だけ行う手続き（カレンダーには入れない） */
  optional?: boolean | ((x: Ctx) => boolean);
  important?: (x: Ctx) => boolean;
  what: string | ((x: Ctx) => string);
  where: string;
  bring?: string[];
  law?: string;
  source?: { label: string; url?: string };
  /** アプリ内で続けて作業できる画面 */
  link?: { href: string; label: string };
  /** 提出先の窓口の種類と担当課（住所から具体的な窓口を調べる） */
  office?: OfficeKind | ((x: Ctx) => OfficeKind | undefined);
  dept?: string;
  /** 集める書類（documents.ts の id） */
  docs?: string[] | ((x: Ctx) => string[]);
}

const d = (n: number) => (death: ISODate) => withinDays(death, n);
/** 「〇か月以内」「〇年以内」（目安の日も同じ数え方にそろえる） */
const m = (n: number) => (death: ISODate) => monthsDeadline(death, n);
const y = (n: number) => (death: ISODate) => yearsDeadline(death, n);
/** 法要の日（亡くなった日と同じ月日） */
const anniversary = (n: number) => (death: ISODate) => addYears(death, n);
const always = () => true;
const hasWill = ({ iv }: Ctx) => iv.will === "notarized" || iv.will === "handwritten" || iv.will === "handwrittenStored";
const hasRealEstate = ({ iv }: Ctx) => iv.homeValue > 0 || iv.otherRealEstate > 0;
const securitiesDocs = ({ iv }: Ctx) => (iv.securities > 0 ? ["securitiesCert"] : []);
const realEstateDocs = (x: Ctx, docs: string[]) => (hasRealEstate(x) ? docs : []);
const taxFiling = ({ est }: Ctx) => est.verdict === "likely" || est.verdict === "relief";

/**
 * 亡くなった方が青色申告の承認を受けていた場合の、事業を引き継ぐ相続人の青色申告の承認申請の期限
 * （所得税基本通達144-1）：亡くなった月が1〜8月なら4か月以内、9〜10月ならその年の12月31日、11〜12月なら翌年2月15日
 */
export function blueFilerDue(death: ISODate): ISODate {
  const mo = monthOf(death);
  const yr = yearOf(death);
  if (mo <= 8) return monthsDeadline(death, 4);
  if (mo <= 10) return `${yr}-12-31`;
  return `${yr + 1}-02-15`;
}

/**
 * 亡くなった方が青色申告ではなかった場合の期限（所得税法144条）：引き継いだ日（亡くなった日）から2か月以内。
 * 1月1日〜15日に引き継いだ場合は、その年の3月15日
 */
export function newBusinessBlueDue(death: ISODate): ISODate {
  return death.slice(5) <= "01-15" ? `${yearOf(death)}-03-15` : monthsDeadline(death, 2);
}

/**
 * 事業を引き継ぐ場合の青色申告の承認申請の期限。
 * 聞き取りでは亡くなった方が青色申告をしていたかを聞いていないので、間に合わなくならないよう早いほうの日を使う。
 */
export const blueReturnDue = (death: ISODate): ISODate => earlier(blueFilerDue(death), newBusinessBlueDue(death));

/**
 * 空き家の譲渡所得の特別控除で、売る期限（租税特別措置法35条3項）：
 * 相続開始の日から同日以後3年を経過する日（3年後の同じ日の前日）の属する年の12月31日
 */
export const vacantHomeDue = (death: ISODate) => `${yearOf(addDays(addYears(death, 3), -1))}-12-31`;

/** 今の法律で、空き家の特別控除の対象になる売却の最後の日（令和9年12月31日。延長されることがある） */
export const VACANT_HOME_LAST_SALE = "2027-12-31";

/**
 * 相続税の取得費加算で、売る期限（租税特別措置法39条）：相続税の申告期限の翌日以後3年を経過する日。
 * 申告期限は休日なら次の平日にずれるので、ずれた後の申告期限から数える
 */
export const saleCostDue = (death: ISODate) => yearsDeadline(nextOpenDay(monthsDeadline(death, 10)), 3);

/** 相続登記の義務が始まった日（不動産登記法の改正。令和3年法律第24号） */
export const REGISTRATION_START = "2024-04-01";
/**
 * 相続登記の期限。取得を知った日（ここでは亡くなった日）から3年。2024年4月1日より前の相続は、
 * 施行日（2024年4月1日）から3年の 2027年3月31日 と、知った日から3年 の遅い方（改正法附則5条6項）
 */
export const registrationDue = (death: ISODate): ISODate => {
  const d = yearsDeadline(death, 3);
  return d < "2027-03-31" ? "2027-03-31" : d;
};

export const RULES: Rule[] = [
  // ---------------------------------------------------------------- 亡くなってすぐ
  {
    id: "death-report",
    office: "city",
    dept: "戸籍・住民の窓口（市民課など）",
    docs: ["deathCert"],
    title: "死亡届の提出と火葬許可の申請",
    category: "届出",
    due: d(7),
    // 火葬許可証がないと火葬できないため、期限は7日でも葬儀より前に並べる
    sortDue: (death) => death,
    hard: true,
    applies: always,
    what: "死亡診断書（死体検案書）と一体の死亡届を出し、同時に火葬許可証を受け取ります。葬儀社が代わりに提出してくれることが多い手続きです。死亡診断書は保険金の請求などでも使うので、提出前にコピーを数枚取っておきましょう。",
    where: "亡くなった場所・亡くなった方の本籍地・届出人の住所地のいずれかの市区町村役場",
    bring: ["死亡診断書（死体検案書）", "届出人の本人確認書類"],
    law: "戸籍法86条（知った日から7日以内）、墓地埋葬法5条",
  },
  {
    id: "funeral",
    title: "通夜・葬儀・火葬",
    category: "葬儀・法要",
    due: (death) => addDays(death, 3),
    hard: false,
    applies: always,
    what: "段取りは葬儀社が一緒に進めてくれます。あとの手続きのために覚えておきたいのは2つだけです。火葬は亡くなってから24時間が過ぎてから行います。葬儀社やお寺に払った費用の領収書（お布施はメモ）は、葬祭費の申請や相続税の計算で使うので保管しておきましょう。",
    where: "葬儀社・斎場",
    bring: ["火葬許可証"],
    law: "墓地埋葬法3条（24時間以内の火葬の禁止）",
  },
  {
    id: "shonanoka",
    title: "初七日法要",
    category: "葬儀・法要",
    due: (death) => addDays(death, 6),
    hard: false,
    applies: always,
    what: "亡くなった日を1日目として7日目に行う法要です。最近は葬儀の日にあわせて行う（繰り上げ初七日）ことが多くなっています。日付は仏式の一般的な数え方による目安です。",
    where: "寺院・自宅・斎場",
  },
  {
    id: "pension-stop",
    office: "pension",
    docs: ["pensionCert", "deathCert"],
    title: ({ iv }) => `年金の受給停止（${PENSION_LABEL[iv.pension]}）`,
    category: "届出",
    due: (death, { iv }) => withinDays(death, iv.pension === "national" ? 14 : 10),
    hard: true,
    applies: ({ iv }) => iv.pension !== "none",
    what: ({ iv }) =>
      (iv.pension === "unknown" ? "年金を受けていたか分からないときは、年金証書・振込通知書・通帳の「年金」の入金で確かめるか、年金事務所に問い合わせます。" : "") +
      "年金を受けていた方が亡くなったときは「受給権者死亡届」を出します。日本年金機構にマイナンバーが登録されている場合は省略できることがあります。亡くなった月の分までの年金で受け取っていないもの（未支給年金）は、同じ窓口で請求できます。",
    where: "年金事務所・街角の年金相談センター（国民年金のみの場合は市区町村役場でも可）",
    bring: ["年金証書", "死亡の事実が分かる書類（死亡診断書のコピー等）"],
    law: "厚生年金は10日以内、国民年金は14日以内（各法の施行規則）",
    source: { label: "日本年金機構「年金を受けている方が亡くなったとき」" },
  },
  {
    id: "health-insurance",
    office: "city",
    dept: "国民健康保険・後期高齢者医療・介護保険の窓口",
    title: "健康保険・介護保険の資格喪失と保険証の返却",
    category: "届出",
    due: d(14),
    hard: true,
    applies: ({ iv }) => iv.health === "kokuho" || iv.health === "kouki" || iv.health === "unknown",
    what: "国民健康保険・後期高齢者医療制度・介護保険の資格喪失の手続きをします。死亡届を出すと自動で処理される自治体もありますが、保険証などの返却は必要です。",
    where: "市区町村役場（保険年金の窓口）",
    bring: ["保険証・介護保険被保険者証", "届出人の本人確認書類"],
    law: "国民健康保険法9条・高齢者医療確保法・介護保険法（14日以内）",
  },
  {
    id: "employer",
    title: "勤務先への連絡（保険証の返却・最後の給与・死亡退職金）",
    category: "届出",
    due: d(5),
    hard: false,
    applies: ({ iv }) => iv.work === "employee" || iv.health === "shaho",
    what: "会社員だった場合は勤務先が健康保険・厚生年金の資格喪失を手続きします。保険証を返し、最後の給与・死亡退職金・会社の弔慰金の受け取り方を確認します。死亡退職金は相続税の対象（非課税枠あり）です。",
    where: "勤務先の総務・人事",
    bring: ["保険証", "社員証など"],
  },
  {
    id: "household-head",
    office: "city",
    dept: "住民票の窓口（市民課など）",
    title: "世帯主の変更届",
    category: "届出",
    due: d(14),
    hard: true,
    applies: ({ iv }) => iv.householdHead,
    what: "亡くなった方が世帯主で、残った世帯員が2人以上いる場合に新しい世帯主を届け出ます。残った世帯員が1人の場合は不要です。",
    where: "市区町村役場（住民票の窓口）",
    bring: ["届出人の本人確認書類"],
    law: "住民基本台帳法25条（14日以内）",
  },
  // ---------------------------------------------------------------- 1〜3か月
  {
    id: "will-search",
    office: ({ iv }) => (iv.will === "handwritten" ? "familyCourt" : iv.will === "handwrittenStored" ? "legalAffairs" : "notary"),
    docs: ({ iv }) => (iv.will === "handwrittenStored" ? ["willCert"] : ["kosekiDecedent"]),
    title: ({ iv }) =>
      iv.will === "notarized"
        ? "公正証書遺言の内容の確認"
        : iv.will === "handwrittenStored"
          ? "法務局に保管された遺言書の確認"
          : iv.will === "handwritten"
            ? "自筆の遺言書の検認（家庭裁判所）"
            : "遺言書があるかどうかを調べる",
    category: "調べる・決める",
    due: m(1),
    hard: false,
    applies: always,
    important: ({ iv }) => iv.will === "handwritten",
    what: ({ iv }) =>
      iv.will === "handwritten"
        ? "自宅などで見つかった自筆の遺言書は、開封せずに家庭裁判所で「検認」を受けます。検認をしないと、遺言書を使った銀行や登記の手続きができません。"
        : iv.will === "handwrittenStored"
          ? "法務局の自筆証書遺言書保管制度を使っていた場合は、「遺言書情報証明書」の交付を請求します。この場合は家庭裁判所の検認は不要です。"
          : iv.will === "notarized"
            ? "公正証書遺言は検認が不要で、すぐに手続きに使えます。遺言執行者が指定されているか確認しましょう。"
            : "遺言書の有無で、遺産の分け方が大きく変わります。公正証書遺言は全国の公証役場で検索でき、自筆の遺言書は法務局の保管制度を使っていないかを確認できます。自宅の金庫や貸金庫も確認します。",
    where: "公証役場（遺言検索）・法務局（遺言書保管所）・家庭裁判所（検認）",
    bring: ["亡くなった方の死亡が分かる戸籍謄本", "請求する人の本人確認書類"],
    law: "民法1004条（検認）、遺言書保管法",
  },
  {
    id: "koseki",
    office: "city",
    dept: "戸籍の窓口",
    docs: ["kosekiDecedent", "kosekiHeirs"],
    title: "戸籍を集めて相続人を確定する",
    category: "調べる・決める",
    due: m(1),
    hard: false,
    applies: always,
    what: "亡くなった方の出生から死亡までの戸籍謄本と、相続人全員の戸籍謄本を集めます。2024年3月からは、最寄りの役所で他の市区町村の戸籍もまとめて請求できるようになりました（広域交付）。",
    where: "市区町村役場（戸籍の窓口）",
    bring: ["請求する人の本人確認書類", "手数料"],
    link: { href: "/case/heirs", label: "相続人と法定相続分を確認する" },
  },
  {
    id: "houtei-joho",
    office: "legalAffairs",
    dept: "法定相続情報の窓口",
    docs: ["kosekiDecedent", "kosekiHeirs", "juminhyoJokyo", "houteiJoho"],
    title: "法定相続情報一覧図の写しの交付（任意）",
    category: "調べる・決める",
    due: m(2),
    hard: false,
    optional: true,
    applies: (x) => x.iv.deposits > 0 || x.iv.securities > 0 || hasRealEstate(x),
    what: "集めた戸籍と相続関係の一覧図を法務局に出すと、無料で証明書（写し）を何枚でも出してもらえます。銀行・証券会社・法務局（登記）・税務署で戸籍の束の代わりに使えるので、手続き先が多い場合に便利です。",
    where: "法務局",
    bring: ["戸籍謄本一式", "法定相続情報一覧図（自分で作成）", "申出人の本人確認書類"],
    source: { label: "法務局「法定相続情報証明制度について」", url: "https://houmukyoku.moj.go.jp/homu/page7_000013.html" },
  },
  {
    id: "estate-survey",
    docs: (x) => [...realEstateDocs(x, ["nayose", "touki"]), "credit"],
    title: "財産と借金を調べる",
    category: "調べる・決める",
    due: m(2),
    hard: false,
    applies: always,
    important: ({ iv }) => iv.debts === "large" || iv.debts === "unknown",
    what: "通帳・郵便物・固定資産税の納税通知書・証券会社からの取引報告書などから、財産と借金の一覧を作ります。必要な書類は「資料集め」にまとめてあります。借金は信用情報機関（CIC・JICC・全国銀行個人信用情報センター）に照会すると分かります。相続放棄をするかどうかは3か月以内に決める必要があるので、早めに調べます。",
    where: "銀行・証券会社・信用情報機関・市区町村（名寄帳）",
    bring: ["戸籍謄本（相続人であることの証明）", "本人確認書類"],
    link: { href: "/case/assets", label: "財産を登録して評価する" },
  },
  {
    id: "asset-valuation",
    title: "財産の評価額を確定する（相続税の申告の準備）",
    category: "税金",
    due: m(6),
    hard: false,
    applies: (x) => taxFiling(x),
    what: "「資料集め」で残高証明書・名寄帳・固定資産評価証明書などがそろったら（集めるのに1〜2か月かかります）、「財産と相続税」で財産を一つずつ登録して評価額を確定します。書類をアップロードすると、コンパスくんが金額を読み取って登録します。土地は地図で路線価を確認します。評価が終わると、分け方の話し合いと相続税の計算に進めます。",
    where: "相続コンパス（財産と相続税）",
    link: { href: "/case/assets", label: "財産を登録して評価する" },
  },
  {
    id: "bank-notice",
    docs: (x) => ["balanceCert", ...securitiesDocs(x)],
    title: "銀行・証券会社への連絡と残高証明書の取得",
    category: "調べる・決める",
    due: m(1),
    hard: false,
    applies: ({ iv }) => iv.deposits > 0 || iv.securities > 0,
    what: "金融機関に亡くなったことを伝えると口座が止まります（公共料金の引き落としも止まるので、支払い方法の変更も一緒に）。亡くなった日時点の残高証明書は、相続税の判定・申告と遺産分割で使います。葬儀費用などは、遺産分割前でも1つの銀行につき最大150万円まで引き出せる制度があります。",
    where: "取引のある銀行・証券会社",
    bring: ["死亡が分かる戸籍謄本", "相続人の本人確認書類", "通帳・キャッシュカード"],
    law: "民法909条の2（遺産分割前の預貯金の払戻し）",
  },
  {
    id: "renounce",
    office: "familyCourt",
    dept: "家事受付",
    docs: ["juminhyoJokyo", "kosekiDecedent", "kosekiHeirs"],
    title: "相続放棄・限定承認をするか決める",
    category: "調べる・決める",
    due: m(3),
    hard: true,
    applies: always,
    important: ({ iv }) => iv.debts === "large" || iv.debts === "unknown",
    what: ({ iv }) =>
      (iv.debts === "large"
        ? "借金が財産より多い場合は、相続放棄で借金を引き継がずに済みます。"
        : iv.debts === "unknown"
          ? "借金の有無が分からない場合は、まず調べてから判断します。"
          : "借金が少なければ通常は不要です。") +
      "家庭裁判所に申し立てる期限は3か月以内です。調査が間に合わないときは期限の延長を申し立てられます。財産を使ったり処分したりすると放棄できなくなるので注意してください。",
    where: "亡くなった方の最後の住所地の家庭裁判所",
    bring: ["相続放棄の申述書", "亡くなった方の住民票除票または戸籍附票", "申し立てる人の戸籍謄本"],
    law: "民法915条（知った時から3か月以内）",
  },
  {
    id: "special-agent",
    office: "familyCourt",
    dept: "家事受付",
    title: "未成年の相続人の特別代理人の選任",
    category: "調べる・決める",
    due: m(3),
    hard: false,
    applies: ({ iv }) => iv.minorHeir,
    what: "未成年の相続人と、その親権者（たとえば配偶者）がどちらも相続人のときは、遺産分割協議の前に家庭裁判所で特別代理人を選んでもらう必要があります。",
    where: "子の住所地の家庭裁判所",
    law: "民法826条",
  },
  {
    id: "insurance-claim",
    docs: ["deathCert", "kosekiHeirs", "insurancePay"],
    title: "生命保険金の請求",
    category: "お金の受け取り",
    due: m(2),
    hard: false,
    limit: { due: y(3), text: "請求できる期限は3年（保険法95条）" },
    applies: ({ iv }) => iv.insurance > 0,
    what: "受取人が保険会社に請求します。期限は3年ですが、受け取った金額と支払通知書は相続税の判定・申告に必要なので、申告の準備に間に合うよう早めに請求します。保険金は受取人のもので、遺産分割の対象にはなりません（相続税では500万円×法定相続人の数まで非課税）。",
    where: "保険会社",
    bring: ["保険証券", "死亡診断書のコピー", "受取人の戸籍謄本・本人確認書類"],
    law: "保険法95条",
  },
  {
    id: "funeral-benefit",
    office: ({ iv }) => (iv.health === "shaho" ? undefined : "city"),
    dept: "国民健康保険・後期高齢者医療の窓口",
    docs: ["funeralReceipt"],
    title: ({ iv }) => (iv.health === "shaho" ? "埋葬料の申請（健康保険）" : "葬祭費の申請"),
    category: "お金の受け取り",
    due: m(2),
    hard: false,
    limit: { due: y(2), text: "申請できる期限は葬儀の日（埋葬料は亡くなった日）の翌日から2年" },
    applies: always,
    what: ({ iv }) =>
      iv.health === "shaho"
        ? "会社の健康保険に入っていた方が亡くなったときは、埋葬を行った家族に埋葬料（5万円）が支給されます。"
        : "国民健康保険・後期高齢者医療制度に入っていた方の葬儀をした人（喪主）に、葬祭費が支給されます（金額は市区町村により3〜7万円程度）。",
    where: "国民健康保険・後期高齢者医療は市区町村役場、会社の健康保険は勤務先または協会けんぽ・健康保険組合",
    bring: ["葬儀の領収書（喪主の名前があるもの）", "保険証", "振込先口座"],
  },
  {
    id: "high-medical",
    office: ({ iv }) => (iv.health === "shaho" ? undefined : "city"),
    dept: "国民健康保険・後期高齢者医療の窓口",
    title: "高額療養費の請求",
    category: "お金の受け取り",
    due: m(3),
    hard: false,
    limit: { due: y(2), text: "診療月の翌月1日から2年" },
    applies: ({ iv }) => iv.highMedical,
    what: "亡くなる前の入院などで医療費の自己負担が上限額を超えていた場合は、相続人が払い戻しを請求できます。払い戻された額は相続財産になります。",
    where: "市区町村役場または加入していた健康保険",
    bring: ["病院の領収書", "相続人の振込先口座"],
  },
  {
    id: "survivor-pension",
    office: "pension",
    docs: ["pensionCert", "kosekiDecedent", "kosekiHeirs"],
    title: "遺族年金・未支給年金の請求",
    category: "お金の受け取り",
    due: m(3),
    hard: false,
    limit: { due: y(5), text: "請求できる期限は5年" },
    applies: ({ iv }) => iv.pension !== "none" || iv.work === "employee",
    what: "亡くなった方に生計を維持されていた配偶者や子は、遺族年金を受けられることがあります。年金を受けていた方の亡くなった月までの未支給分は、生計を同じくしていた家族が請求できます。受給の条件は年金事務所で確認します。",
    where: "年金事務所・街角の年金相談センター",
    bring: ["年金手帳・年金証書", "戸籍謄本", "世帯全員の住民票", "請求者の所得証明書", "振込先口座"],
    law: "国民年金法・厚生年金保険法（時効5年）",
  },
  // ---------------------------------------------------------------- 4か月
  {
    id: "final-return",
    office: "taxOffice",
    docs: ["withholding"],
    title: ({ iv }) => (needsFinalReturn(iv) === "required" ? "準確定申告（亡くなった年の所得税）" : "準確定申告（還付を受けられる場合）"),
    category: "税金",
    due: m(4),
    hard: true,
    applies: ({ iv }) => needsFinalReturn(iv) !== "notNeeded",
    optional: ({ iv }) => needsFinalReturn(iv) !== "required",
    important: ({ iv }) => needsFinalReturn(iv) === "required",
    what: ({ iv }) =>
      needsFinalReturn(iv) === "required"
        ? "亡くなった方が事業や不動産収入などで確定申告をしていた場合は、1月1日から亡くなった日までの所得を相続人が申告します。納めた所得税は相続税の債務になり、還付金は相続財産になります。"
        : "会社員で年末調整を受けずに亡くなった場合や、医療費が多かった場合は、申告すると所得税が戻ることがあります。年金収入が400万円以下で他の所得が20万円以下なら、申告は原則不要です。",
    where: "亡くなった方の住所地の税務署",
    bring: ["源泉徴収票", "医療費の領収書", "相続人全員の本人確認書類", "準確定申告書付表"],
    law: "所得税法124条・125条（知った日の翌日から4か月以内）",
    source: { label: "国税庁 タックスアンサー No.2022", url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2022.htm" },
  },
  {
    id: "business-close",
    office: "taxOffice",
    title: "個人事業の廃業届",
    category: "税金",
    due: m(1),
    hard: true,
    applies: ({ iv }) => iv.work === "selfEmployed",
    what: "亡くなった方が個人事業をしていた場合は、相続人が「個人事業の開業・廃業等届出書」を出します。消費税の課税事業者だった場合は「個人事業者の死亡届出書」も速やかに出します。",
    where: "亡くなった方の住所地の税務署",
    law: "所得税法229条（1か月以内）、消費税法57条",
  },
  {
    id: "business-blue",
    office: "taxOffice",
    title: "事業を引き継ぐ場合の青色申告の承認申請",
    category: "税金",
    due: (death) => blueReturnDue(death),
    hard: true,
    optional: true,
    applies: ({ iv }) => iv.work === "selfEmployed",
    what: "相続人が事業を引き継いで青色申告をする場合は、承認申請書を出します。亡くなった方が青色申告をしていた場合の期限は、亡くなった月で変わります（1〜8月なら4か月以内、9〜10月なら12月31日、11〜12月なら翌年2月15日）。青色申告ではなかった場合は、亡くなった日から2か月以内（1月1日〜15日に亡くなった場合は3月15日）です。ここでは、間に合わなくならないよう早いほうの日を期限にしています。引き継ぐ人がすでに自分の事業で申告している場合は期限が違うことがあるので、税務署に確認してください。",
    where: "引き継ぐ人の住所地の税務署",
    law: "所得税法144条・147条、所得税基本通達144-1",
  },
  // ---------------------------------------------------------------- 10か月
  {
    id: "division",
    docs: ["inkan"],
    title: "遺産分割協議と協議書の作成",
    category: "調べる・決める",
    due: (death, x) => monthsDeadline(death, taxFiling(x) ? 8 : 10),
    hard: false,
    applies: ({ iv, est }) => est.heirCount > 1 && iv.will !== "notarized",
    what: ({ est }) =>
      "誰が何を受け継ぐかを相続人全員で決め、協議書に署名・実印を押します。" +
      (est.verdict === "likely" || est.verdict === "relief"
        ? "配偶者の税額軽減や小規模宅地等の特例は、相続税の申告期限までに分割が決まっていることが前提なので、期限の2か月前を目安にしています。"
        : "期限はありませんが、銀行や不動産の名義変更に必要です。"),
    where: "相続人の間で",
    bring: ["相続人全員の印鑑証明書", "財産の一覧"],
    link: { href: "/case/division", label: "分け方を決めて協議書を作る" },
  },
  {
    id: "inheritance-tax",
    office: "taxOffice",
    docs: (x) => ["kosekiDecedent", "kosekiHeirs", "inkan", "balanceCert", ...securitiesDocs(x), ...realEstateDocs(x, ["touki", "hyokaCert"]), ...(x.iv.insurance > 0 ? ["insurancePay"] : []), "funeralReceipt"],
    title: ({ est }) =>
      est.verdict === "likely"
        ? "相続税の申告と納付"
        : est.verdict === "relief"
          ? "相続税の申告（税額が0円でも申告が必要）"
          : "相続税：申告は不要の見込み（財産が確定したら再確認）",
    category: "税金",
    due: m(10),
    hard: true,
    applies: always,
    important: (x) => taxFiling(x),
    optional: ({ est }) => est.verdict === "none",
    what: ({ est }) =>
      est.verdict === "likely"
        ? "財産の合計が基礎控除を超える見込みです。亡くなったことを知った日の翌日から10か月以内に申告し、納税します。"
        : est.verdict === "relief"
          ? "納める税額は0円の見込みですが、小規模宅地等の特例・配偶者の税額軽減を使うときや、相続時精算課税で納めた贈与税を返してもらうときは、申告しないと受けられません。税額が0円でも申告書の提出が必要です。"
          : est.verdict === "borderline"
            ? "基礎控除に近い金額です。財産の額が確定したら、相続税の計算画面で正確に確認しましょう。"
            : "財産の合計が基礎控除の範囲内なので、相続税はかからず、申告も不要の見込みです。",
    where: "亡くなった方の最後の住所地の税務署（e-Taxも可）",
    bring: ["申告書", "戸籍謄本", "遺産分割協議書の写し", "印鑑証明書", "財産・債務の資料"],
    law: "相続税法27条（知った日の翌日から10か月以内）",
    source: { label: "国税庁 タックスアンサー No.4205", url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/sozoku/4205.htm" },
    link: { href: "/case/decedent", label: "相続税を計算して申告書を作る" },
  },
  // ---------------------------------------------------------------- 名義変更・解約
  {
    id: "utilities",
    title: "公共料金・携帯電話・クレジットカード・サブスクの解約や名義変更",
    category: "名義変更・解約",
    due: m(1),
    hard: false,
    applies: always,
    what: "電気・ガス・水道は同居の家族の名義に変更し、亡くなった方だけが使っていた携帯電話・インターネット・クレジットカード・動画配信などは解約します。口座が止まると引き落としができなくなるので、支払い方法も変更します。",
    where: "各契約先（電話・Webで手続きできるものが多い）",
  },
  {
    id: "id-return",
    title: "運転免許証・パスポートなどの返納",
    category: "名義変更・解約",
    due: m(1),
    hard: false,
    applies: always,
    what: "運転免許証は警察署、パスポートは旅券窓口へ返納します。マイナンバーカード・印鑑登録は死亡届により失効するので、返納は原則不要です（手元で保管か廃棄）。",
    where: "警察署・運転免許センター・旅券窓口",
  },
  {
    id: "rented-home",
    title: "賃貸住宅の解約または契約者の変更",
    category: "名義変更・解約",
    due: m(1),
    hard: false,
    applies: ({ iv }) => iv.rentedHome,
    what: "賃貸借契約は相続されるので、住み続ける家族がいれば名義変更、いなければ解約と明け渡しをします。家財の片付けや敷金の精算も相続人が行います。",
    where: "大家さん・管理会社",
  },
  {
    id: "digital",
    title: "スマートフォン・ネット銀行・SNSなどデジタル遺品の確認",
    category: "名義変更・解約",
    due: m(1),
    hard: false,
    applies: ({ iv }) => iv.digital,
    what: "スマートフォンやパソコンの中に、ネット銀行・ネット証券・暗号資産・有料サービスがないか確認します。財産が見つかれば相続財産になります。SNSは追悼アカウントへの切り替えや削除ができます。",
    where: "各サービスの窓口",
  },
  {
    id: "bank-transfer",
    docs: ["kosekiDecedent", "kosekiHeirs", "inkan"],
    title: "預貯金の解約・名義変更",
    category: "名義変更・解約",
    due: m(10),
    hard: false,
    applies: ({ iv }) => iv.deposits > 0,
    what: "遺産分割協議（または遺言）で取得する人が決まったら、銀行で解約または名義変更をします。",
    where: "取引のある銀行",
    bring: ["遺産分割協議書または遺言書", "戸籍謄本または法定相続情報一覧図の写し", "相続人全員の印鑑証明書", "通帳・キャッシュカード"],
  },
  {
    id: "securities-transfer",
    docs: ["kosekiDecedent", "inkan"],
    title: "株式・投資信託の名義変更（移管）",
    category: "名義変更・解約",
    due: m(10),
    hard: false,
    applies: ({ iv }) => iv.securities > 0,
    what: "取得する人の証券口座に移します。取得する人が口座を持っていない場合は、同じ証券会社で口座を開きます。",
    where: "取引のある証券会社",
    bring: ["遺産分割協議書", "戸籍謄本または法定相続情報一覧図の写し", "印鑑証明書"],
  },
  {
    id: "car",
    title: "自動車の名義変更",
    category: "名義変更・解約",
    due: m(10),
    hard: false,
    applies: ({ iv }) => iv.car,
    what: "取得する人が決まったら移転登録をします。自動車保険の名義変更や、乗らない場合の売却・廃車も検討します。",
    where: "運輸支局（軽自動車は軽自動車検査協会）",
    bring: ["車検証", "遺産分割協議書", "戸籍謄本", "印鑑証明書"],
  },
  // ---------------------------------------------------------------- 1年〜
  {
    id: "isshuki",
    title: "一周忌法要",
    category: "葬儀・法要",
    due: anniversary(1),
    hard: false,
    applies: always,
    what: "亡くなった日から満1年の命日に行う法要です。命日より前の休日に行うのが一般的です。",
    where: "寺院・自宅など",
  },
  {
    id: "shijuku",
    title: "四十九日法要・納骨",
    category: "葬儀・法要",
    due: (death) => addDays(death, 48),
    hard: false,
    applies: always,
    what: "亡くなった日を1日目として49日目に行う法要で、納骨や香典返しもこの頃に行うことが多いです。四十九日の費用や香典返しは、相続税の葬式費用には含まれません。",
    where: "寺院・自宅・霊園",
  },
  {
    id: "sankaiki",
    title: "三回忌法要",
    category: "葬儀・法要",
    due: anniversary(2),
    hard: false,
    applies: always,
    what: "亡くなってから満2年の命日に行う法要です。",
    where: "寺院・自宅など",
  },
  {
    id: "iryubun",
    title: "遺留分侵害額の請求（遺言で取り分が少なかった場合）",
    category: "調べる・決める",
    due: y(1),
    hard: true,
    optional: true,
    applies: hasWill,
    what: "遺言で特定の人に多く遺された結果、配偶者・子・親の最低限の取り分（遺留分）を下回った場合は、多く受け取った人にお金を請求できます。相続と遺留分の侵害を知った時から1年以内です。",
    where: "相手方（話し合いがまとまらなければ家庭裁判所の調停）",
    law: "民法1046条・1048条",
  },
  {
    id: "registration",
    office: "legalAffairs",
    dept: "不動産登記の窓口",
    docs: ["kosekiDecedent", "kosekiHeirs", "juminhyoJokyo", "juminhyoHeir", "hyokaCert", "inkan"],
    title: "不動産の相続登記",
    category: "不動産",
    due: registrationDue,
    hard: true,
    applies: hasRealEstate,
    important: always,
    what: ({ iv }) =>
      `2024年4月から相続登記が義務になりました。相続で不動産を取得したことを知った日から3年以内に登記しないと、10万円以下の過料の対象になります。${
        iv.deathDate < REGISTRATION_START ? "2024年3月以前に亡くなった方の不動産は、2027年3月31日までに登記します。" : ""
      }遺産分割が決まったら早めに申請しましょう。`,
    where: "不動産の所在地を管轄する法務局",
    bring: ["登記申請書", "戸籍謄本または法定相続情報一覧図の写し", "遺産分割協議書", "固定資産評価証明書", "取得する人の住民票"],
    law: "不動産登記法76条の2",
    link: { href: "/case/registration", label: "登記申請書と登録免許税を作る" },
  },
  {
    id: "sale-cost",
    office: "taxOffice",
    title: "相続した不動産・株を売る場合の相続税の取得費加算",
    category: "税金",
    due: (death) => saleCostDue(death),
    hard: true,
    shiftHoliday: false,
    optional: true,
    applies: (x) => x.est.verdict === "likely" && (hasRealEstate(x) || x.iv.securities > 0),
    what: "相続税を払った人が、相続した財産を相続税の申告期限の翌日から3年以内（この日まで）に売ると、払った相続税の一部を取得費に加えて譲渡所得税を減らせます。この日は売る期限なので、休日でもずれません。手続きは売った年の確定申告でします。",
    where: "売った年の確定申告（税務署）",
    law: "租税特別措置法39条",
    source: { label: "国税庁 タックスアンサー No.3267", url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3267.htm" },
  },
  {
    id: "vacant-home",
    office: "taxOffice",
    title: "空き家になった実家を売る場合の3,000万円特別控除",
    category: "税金",
    due: (death) => earlier(vacantHomeDue(death), VACANT_HOME_LAST_SALE),
    hard: true,
    shiftHoliday: false,
    optional: true,
    applies: ({ iv }) => iv.homeValue > 0,
    what: ({ iv }) => {
      const legal = vacantHomeDue(iv.deathDate);
      return (
        "亡くなった方が一人で住んでいた家（昭和56年5月31日以前の建築など条件あり）を相続し、耐震改修や取り壊しのうえ売った場合は、譲渡所得から最大3,000万円（家を受け継いだ相続人が3人以上なら1人2,000万円）を差し引けます。売る期限は、亡くなった日から3年を経過する日の属する年の12月31日です。" +
        (legal > VACANT_HOME_LAST_SALE
          ? `ただし、今の法律ではこの特例は2027年（令和9年）12月31日までに売った場合だけが対象なので、ここではその日を期限にしています（法律が延長されれば${jpDate(legal)}まで）。売る前に、延長されたかどうかを税務署で確認してください。`
          : "")
      );
    },
    where: "売った年の確定申告（税務署）",
    law: "租税特別措置法35条3項",
    source: { label: "国税庁 タックスアンサー No.3306", url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/joto/3306.htm" },
  },
];

export interface Task {
  id: string;
  title: string;
  category: Category;
  date: ISODate;
  /** 並べる順の基準日 */
  sortDate: ISODate;
  hard: boolean;
  optional: boolean;
  important: boolean;
  what: string;
  where: string;
  bring: string[];
  law?: string;
  limit?: { date: ISODate; text: string };
  source?: Rule["source"];
  link?: Rule["link"];
  office?: OfficeKind;
  dept?: string;
  docs: string[];
}

const val = <T,>(v: T | ((x: Ctx) => T), x: Ctx): T => (typeof v === "function" ? (v as (x: Ctx) => T)(x) : v);

/** 聞き取りの答えから、その家族に必要な手続きを期限順に並べる */
export function buildTasks(iv: Interview, opts: { verdict?: Verdict } = {}): { tasks: Task[]; est: Estimate } {
  const rough = estimate(iv);
  // 相続税申告の画面で財産を評価済みなら、その計算結果による判定を優先する
  const est = opts.verdict ? { ...rough, verdict: opts.verdict } : rough;
  const x: Ctx = { iv, est };
  const death = iv.deathDate;
  const tasks = RULES.filter((r) => r.applies(x)).map((r): Task => {
    const raw = r.due(death, x);
    const date = r.hard && r.shiftHoliday !== false ? nextOpenDay(raw) : raw;
    return {
      id: r.id,
      title: val(r.title, x),
      category: r.category,
      date,
      sortDate: r.sortDue ? r.sortDue(death) : date,
      hard: r.hard,
      optional: r.optional === undefined ? false : val(r.optional, x),
      important: r.important ? r.important(x) : false,
      what: val(r.what, x),
      where: r.where,
      bring: r.bring ?? [],
      law: r.law,
      limit: r.limit ? { date: nextOpenDay(r.limit.due(death)), text: r.limit.text } : undefined,
      source: r.source,
      link: r.link,
      office: r.office === undefined ? undefined : val(r.office, x),
      dept: r.dept,
      docs: r.docs ? val(r.docs, x) : [],
    };
  });
  tasks.sort((a, b) => (a.sortDate < b.sortDate ? -1 : a.sortDate > b.sortDate ? 1 : 0));
  return { tasks, est };
}
