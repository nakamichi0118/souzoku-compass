/**
 * 書類の画像・PDF（残高証明書、固定資産税の課税明細書、保険金支払通知書など）から
 * 財産の入力候補を取り出す。結果は「候補」として画面に表示し、本人が確認してから登録する。
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MODEL, getClient } from "@/server/claude";

const ExtractedAsset = z.object({
  kind: z.enum(["deposit", "land", "building", "insurance", "listedStock", "other"]),
  label: z.string().describe("銀行名・支店名・所在地など、財産を特定する名前"),
  institution: z.string().nullable().describe("預貯金の金融機関名（例：○○銀行）。預貯金以外は null"),
  branch: z.string().nullable().describe("預貯金の支店名。預貯金以外は null"),
  accountType: z.string().nullable().describe("預貯金の種類（普通預金・定期預金など）。預貯金以外は null"),
  amount: z.number().nullable().describe("預金残高・保険金額など（円）。該当しなければ null"),
  accruedInterest: z.number().nullable().describe("既経過利息（円）。記載がなければ null"),
  location: z.string().nullable().describe("土地・家屋の所在地番"),
  areaSqm: z.number().nullable().describe("地積・床面積（㎡）"),
  fixedAssetValue: z.number().nullable().describe("固定資産税評価額（円）"),
  date: z.string().nullable().describe("書類の基準日（YYYY-MM-DD）"),
  evidence: z.string().describe("値を読み取った箇所の原文"),
});
const Result = z.object({
  documentType: z.string().describe("書類の種類（例：残高証明書、固定資産税課税明細書）"),
  assets: z.array(ExtractedAsset),
  notes: z.array(z.string()).describe("読み取れなかった項目や注意点"),
});

const SYSTEM = `あなたは相続手続きの書類から財産情報を読み取る担当です。書類に書かれている値だけを、書かれているとおりに取り出してください。
推測で値を補わず、読み取れない項目は null にして notes に理由を書いてください。金額は円単位の整数にしてください。
評価額の計算はしないでください（評価はアプリの計算エンジンが行います）。`;

const MEDIA = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

export async function POST(req: Request) {
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
