/**
 * 書類の画像・PDF（残高証明書、固定資産税の課税明細書、保険金支払通知書など）から
 * 財産の入力候補を取り出す。結果は「候補」として画面に表示し、本人が確認してから登録する。
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { guardAi } from "@/server/guard";
import { z } from "zod";
import { MODEL, getClient } from "@/server/claude";

const Prices = z.object({
  close: z.number().nullable().describe("亡くなった日の終値（円）"),
  monthAvg: z.number().nullable().describe("亡くなった月の終値の月平均（円）"),
  prevMonthAvg: z.number().nullable().describe("前月の終値の月平均（円）"),
  prev2MonthAvg: z.number().nullable().describe("前々月の終値の月平均（円）"),
});

const ExtractedAsset = z.object({
  kind: z
    .enum(["deposit", "cash", "land", "building", "condo", "insurance", "listedStock", "debt", "funeral", "gift", "other"])
    .describe("deposit=預貯金、cash=現金、land=土地、building=家屋、condo=分譲マンション、insurance=死亡保険金、listedStock=上場株式・投資信託、debt=借入金・未払いの税金や医療費、funeral=葬儀費用、gift=生前の贈与、other=その他の財産"),
  label: z.string().describe("銀行名・支店名・所在地・銘柄名など、財産を特定する名前"),
  institution: z.string().nullable().describe("預貯金の金融機関名・証券会社名・保険会社名・債権者名。なければ null"),
  branch: z.string().nullable().describe("預貯金の支店名。なければ null"),
  accountType: z.string().nullable().describe("預貯金の種類（普通預金・定期預金など）。預貯金以外は null"),
  amount: z.number().nullable().describe("預金残高・現金の額・保険金額・債務の額・葬儀費用・贈与額など（円）"),
  accruedInterest: z.number().nullable().describe("既経過利息（円）。記載がなければ null"),
  location: z.string().nullable().describe("土地・家屋・マンションの所在地番"),
  lotNumber: z.string().nullable().describe("地番（土地）"),
  houseNumber: z.string().nullable().describe("家屋番号（家屋・マンション）"),
  areaSqm: z.number().nullable().describe("土地の地積・家屋の床面積（㎡）"),
  fixedAssetValue: z.number().nullable().describe("固定資産税評価額（円）"),
  routePrice: z.number().nullable().describe("書類に路線価（1㎡あたり、円）が書かれていればその額。千円単位の表記は円に直す"),
  personName: z.string().nullable().describe("保険金の受取人・葬儀費用や債務を負担した人・贈与を受けた人・現金を受け取る人の氏名（書かれていれば）"),
  shares: z.number().nullable().describe("株数・口数"),
  prices: Prices.nullable().describe("上場株式の4つの価格（書かれていれば）"),
  condo: z
    .object({
      exclusiveAreaSqm: z.number().nullable().describe("専有部分の床面積（㎡）"),
      landShareSqm: z.number().nullable().describe("敷地権の面積（土地全体の地積 × 敷地権の割合、㎡）"),
      landValueBeforeCorrection: z.number().nullable().describe("敷地利用権の評価額（区分所有補正前、円）"),
      buildingFixedAssetValue: z.number().nullable().describe("区分所有建物の固定資産税評価額（円）"),
      builtYears: z.number().nullable().describe("築年数（年）"),
      builtMonths: z.number().nullable().describe("築年数の月（か月）"),
      totalFloors: z.number().nullable().describe("建物の総階数"),
      floor: z.number().nullable().describe("所在する階"),
    })
    .nullable()
    .describe("分譲マンションの区分所有補正に使う値（マンションのときだけ）"),
  giftTaxPaid: z.number().nullable().describe("贈与のときに納めた贈与税（円）"),
  date: z.string().nullable().describe("書類の基準日・支払日・贈与の日（YYYY-MM-DD）"),
  evidence: z.string().describe("値を読み取った箇所の原文（短く）"),
});
const Result = z.object({
  documentType: z.string().describe("書類の種類（例：残高証明書、固定資産税課税明細書、葬儀費用の領収書）"),
  assets: z.array(ExtractedAsset).describe("書類に書かれている財産・債務・葬儀費用・贈与。1つの書類に複数あれば分ける"),
  notes: z.array(z.string()).describe("読み取れなかった項目や注意点。利用者向けのやさしい日本語で書き、項目名の英語やデータの形の説明は書かない"),
});

const SYSTEM = `あなたは相続手続きの書類から財産情報を読み取る担当です。書類に書かれている値だけを、書かれているとおりに取り出してください。
推測で値を補わず、読み取れない項目は null にして notes に理由を書いてください。金額は円単位の整数にしてください。
評価額の計算はしないでください。
同じ財産を、別々の候補として重ねて出さないでください（例：土地と家屋は分けるが、同じ土地を2回出さない）。
notes は書類を見ている一般の方に向けて書き、英語の項目名（amount・kind など）や「スキーマ」「null」などの言葉は使わないでください。`;

const MEDIA = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

export async function POST(req: Request) {
  const blocked = await guardAi("extract");
  if (blocked) return blocked;
  const client = getClient();
  if (!client) return NextResponse.json({ error: "この環境では Claude に接続していません。" }, { status: 503 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "ファイルがありません。" }, { status: 400 });
  if (!MEDIA.has(file.type)) return NextResponse.json({ error: "画像（PNG/JPEG）かPDFを選んでください。" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return NextResponse.json({ error: "ファイルが大きすぎます（15MBまで）。" }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const source =
    file.type === "application/pdf"
      ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
      : ({
          type: "image",
          source: { type: "base64", media_type: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data },
        } as const);
  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "medium", format: zodOutputFormat(Result) },
      system: SYSTEM,
      messages: [{ role: "user", content: [source, { type: "text", text: "この書類から相続財産の情報を取り出してください。" }] }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) {
      return NextResponse.json({ error: "書類を読み取れませんでした。" }, { status: 422 });
    }
    return NextResponse.json(res.parsed_output);
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude への問い合わせに失敗しました（${e.status}）。` }, { status: 502 });
    }
    throw e;
  }
}
