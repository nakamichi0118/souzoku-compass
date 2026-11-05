/**
 * 撮影・アップロードした書類が何の書類かを見分ける（戸籍謄本・印鑑証明書・残高証明書など）。
 * 答えは書類の種類の id だけ。画面ではその種類の欄に入れ、違っていれば本人が直せる。
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DOCS } from "@/domain/procedures/documents";
import { EXTRA_DOCS } from "@/domain/filing/submission";
import { guardAi } from "@/server/guard";
import { MODEL, getClient } from "@/server/claude";

const KINDS = [...Object.keys(DOCS), ...Object.keys(EXTRA_DOCS)] as [string, ...string[]];
const LIST = KINDS.map((k) => `- ${k}: ${DOCS[k]?.name ?? EXTRA_DOCS[k]}`).join("\n");

const Result = z.object({
  docId: z.enum(KINDS),
  title: z.string().describe("書類の表題（例：戸籍全部事項証明書）。30字まで"),
});

const SYSTEM = `相続の手続きの書類の画像を見て、次のどの種類の書類かを1つ選んでください。
${LIST}
戸籍は、亡くなった方の出生から死亡までの戸籍・除籍・改製原戸籍なら kosekiDecedent、亡くなった方が載っていない相続人の今の戸籍なら kosekiHeirs を選びます。
当てはまるものがなければ otherDoc を選びます。書類の中身（氏名・番号など）は書かないでください。`;

const MEDIA = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

export async function POST(req: Request) {
  const blocked = await guardAi("classify");
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
      : ({ type: "image", source: { type: "base64", media_type: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data } } as const);
  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 1000,
      output_config: { effort: "low", format: zodOutputFormat(Result) },
      system: SYSTEM,
      messages: [{ role: "user", content: [source, { type: "text", text: "この書類の種類を選んでください。" }] }],
    });
    if (!res.parsed_output) return NextResponse.json({ docId: "otherDoc", title: "" });
    return NextResponse.json({ docId: res.parsed_output.docId, title: res.parsed_output.title.slice(0, 30) });
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error("classify: Claude API error", e.status, e.message);
    return NextResponse.json({ error: "書類の種類を見分けられませんでした。種類を選んでください。" }, { status: 502 });
  }
}
