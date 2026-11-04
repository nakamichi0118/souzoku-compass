/**
 * 書類の読み取り（/api/extract）で Claude に返してもらう形と、それを画面が使う形に直す処理。
 *
 * 構造化出力（output_config.format）は、anyOf や ["number","null"] のような「型が2つ以上ある項目」が
 * 1回の問い合わせで16個までに制限されている（超えると 400「Schema is too complex for compilation」）。
 * 財産の項目は「書いていなければ null」のものが30近くあるため、Claude には
 * 「書いてあった項目だけを {項目名, 値} の一覧で返す」形で答えてもらい、ここで元の形に組み立て直す。
 * この形には型が2つ以上ある項目が1つもない。
 */
import { z } from "zod";

export const KINDS = ["deposit", "cash", "land", "building", "condo", "insurance", "listedStock", "debt", "funeral", "gift", "other"] as const;

/** 数値で返す項目（項目名 → 説明） */
const NUMBER_FIELDS = {
  amount: "預金残高・現金の額・保険金額・債務の額・葬儀費用・贈与額など（円）",
  accruedInterest: "既経過利息（円）",
  areaSqm: "土地の地積・家屋の床面積（㎡）",
  fixedAssetValue: "固定資産税評価額（円）",
  routePrice: "書類に書かれた路線価（1㎡あたり、円）。千円単位の表記は円に直す",
  shares: "株数・口数",
  giftTaxPaid: "贈与のときに納めた贈与税（円）",
  "prices.close": "上場株式：亡くなった日の終値（円）",
  "prices.monthAvg": "上場株式：亡くなった月の終値の月平均（円）",
  "prices.prevMonthAvg": "上場株式：前月の終値の月平均（円）",
  "prices.prev2MonthAvg": "上場株式：前々月の終値の月平均（円）",
  "condo.exclusiveAreaSqm": "マンション：専有部分の床面積（㎡）",
  "condo.landShareSqm": "マンション：敷地権の面積（土地全体の地積 × 敷地権の割合、㎡）",
  "condo.landValueBeforeCorrection": "マンション：敷地利用権の評価額（区分所有補正前、円）",
  "condo.buildingFixedAssetValue": "マンション：区分所有建物の固定資産税評価額（円）",
  "condo.builtYears": "マンション：築年数（年）",
  "condo.builtMonths": "マンション：築年数の月（か月）",
  "condo.totalFloors": "マンション：建物の総階数",
  "condo.floor": "マンション：所在する階",
} as const;

/** 文字で返す項目（項目名 → 説明） */
const TEXT_FIELDS = {
  institution: "預貯金の金融機関名・証券会社名・保険会社名・債権者名",
  branch: "預貯金の支店名",
  accountType: "預貯金の種類（普通預金・定期預金など）",
  location: "土地・家屋・マンションの所在地番",
  lotNumber: "地番（土地）",
  houseNumber: "家屋番号（家屋・マンション）",
  personName: "保険金の受取人・葬儀費用や債務を負担した人・贈与を受けた人・現金を受け取る人の氏名",
  date: "書類の基準日・支払日・贈与の日（YYYY-MM-DD）",
} as const;

type NumberKey = keyof typeof NUMBER_FIELDS;
type TextKey = keyof typeof TEXT_FIELDS;
const FIELD_NAMES = [...Object.keys(NUMBER_FIELDS), ...Object.keys(TEXT_FIELDS)] as [string, ...string[]];

const fieldHelp = [...Object.entries(NUMBER_FIELDS), ...Object.entries(TEXT_FIELDS)].map(([k, d]) => `${k}=${d}`).join("、");

export const ClaudeResult = z.object({
  documentType: z.string().describe("書類の種類（例：残高証明書、固定資産税課税明細書、葬儀費用の領収書）"),
  assets: z
    .array(
      z.object({
        kind: z
          .enum(KINDS)
          .describe("deposit=預貯金、cash=現金、land=土地、building=家屋、condo=分譲マンション、insurance=死亡保険金、listedStock=上場株式・投資信託、debt=借入金・未払いの税金や医療費、funeral=葬儀費用、gift=生前の贈与、other=その他の財産"),
        label: z.string().describe("銀行名・支店名・所在地・銘柄名など、財産を特定する名前"),
        fields: z
          .array(
            z.object({
              name: z.enum(FIELD_NAMES).describe(`項目名。${fieldHelp}`),
              value: z.string().describe("書類に書かれている値。金額・面積・数は数字だけ（カンマ・単位なし）で書く"),
            }),
          )
          .describe("書類に書かれていた項目だけを入れる。書かれていない項目は入れない（推測で補わない）"),
        evidence: z.string().describe("値を読み取った箇所の原文（短く）"),
      }),
    )
    .describe("書類に書かれている財産・債務・葬儀費用・贈与。1つの書類に複数あれば分ける"),
  notes: z.array(z.string()).describe("読み取れなかった項目や注意点。利用者向けのやさしい日本語で書き、項目名の英語やデータの形の説明は書かない"),
});
export type ClaudeResult = z.infer<typeof ClaudeResult>;

/** 画面（src/lib/extract.ts の Extracted）が受け取る形。書かれていない項目は null */
export type ExtractedOut = {
  kind: (typeof KINDS)[number];
  label: string;
  evidence: string;
  prices: { close: number | null; monthAvg: number | null; prevMonthAvg: number | null; prev2MonthAvg: number | null } | null;
  condo: {
    exclusiveAreaSqm: number | null;
    landShareSqm: number | null;
    landValueBeforeCorrection: number | null;
    buildingFixedAssetValue: number | null;
    builtYears: number | null;
    builtMonths: number | null;
    totalFloors: number | null;
    floor: number | null;
  } | null;
} & { [K in Exclude<NumberKey, `prices.${string}` | `condo.${string}`>]: number | null } & { [K in TextKey]: string | null };

/** 「1,234円」「38,250,000」「12.5㎡」などを数にする。数として読めなければ null */
export function parseNumber(v: string): number | null {
  const t = v.normalize("NFKC").replace(/[,，\s円㎡]|m2|m²|平方メートル|株|口|階|年|か月|ヶ月|ケ月/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function toExtracted(r: ClaudeResult): { documentType: string; assets: ExtractedOut[]; notes: string[] } {
  const assets = r.assets.map((a) => {
    const num = new Map<string, number | null>();
    const txt = new Map<string, string | null>();
    for (const f of a.fields) {
      const value = f.value.trim();
      if (!value) continue;
      if (f.name in NUMBER_FIELDS) {
        // 同じ項目が2回あれば、はじめのものを使う
        if (!num.has(f.name)) num.set(f.name, parseNumber(value));
      } else if (!txt.has(f.name)) txt.set(f.name, value);
    }
    const n = (k: NumberKey) => num.get(k) ?? null;
    const s = (k: TextKey) => txt.get(k) ?? null;
    const any = (prefix: string) => [...num.keys()].some((k) => k.startsWith(prefix) && num.get(k) != null);
    const out: ExtractedOut = {
      kind: a.kind,
      label: a.label,
      evidence: a.evidence,
      institution: s("institution"),
      branch: s("branch"),
      accountType: s("accountType"),
      amount: n("amount"),
      accruedInterest: n("accruedInterest"),
      location: s("location"),
      lotNumber: s("lotNumber"),
      houseNumber: s("houseNumber"),
      areaSqm: n("areaSqm"),
      fixedAssetValue: n("fixedAssetValue"),
      routePrice: n("routePrice"),
      personName: s("personName"),
      shares: n("shares"),
      giftTaxPaid: n("giftTaxPaid"),
      date: s("date"),
      prices: any("prices.")
        ? { close: n("prices.close"), monthAvg: n("prices.monthAvg"), prevMonthAvg: n("prices.prevMonthAvg"), prev2MonthAvg: n("prices.prev2MonthAvg") }
        : null,
      condo: any("condo.")
        ? {
            exclusiveAreaSqm: n("condo.exclusiveAreaSqm"),
            landShareSqm: n("condo.landShareSqm"),
            landValueBeforeCorrection: n("condo.landValueBeforeCorrection"),
            buildingFixedAssetValue: n("condo.buildingFixedAssetValue"),
            builtYears: n("condo.builtYears"),
            builtMonths: n("condo.builtMonths"),
            totalFloors: n("condo.totalFloors"),
            floor: n("condo.floor"),
          }
        : null,
    };
    return out;
  });
  return { documentType: r.documentType, assets, notes: r.notes };
}
