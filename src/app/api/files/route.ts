/** 撮影・アップロードした書類：自分の一覧（GET）・保存（POST、multipart の file と docId） */
import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/server/auth/http";
import { overLimit } from "@/server/limit";
import { CHUNK, getFileDb } from "@/server/files/store";
import { FILE_LIMITS, FILE_TYPES, isDocId } from "@/server/files/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = (m: { id: string; docId: string; name: string; type: string; size: number; addedAt: string }) => ({ id: m.id, docId: m.docId, name: m.name, type: m.type, size: m.size, addedAt: m.addedAt });

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const list = await (await getFileDb()).list(user.id);
  return NextResponse.json({ items: list.map(view) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!(await sameOrigin(true))) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > FILE_LIMITS.bytes + 100_000) return NextResponse.json({ error: "ファイルが大きすぎます（8MBまで）。" }, { status: 413 });
  if (overLimit(`files:${user.id}`, 200, 10 * 60_000)) return NextResponse.json({ error: "短い時間に多くの書類が送られました。少し時間をおいてお試しください。" }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const docId = form?.get("docId");
  if (!(file instanceof File)) return NextResponse.json({ error: "ファイルがありません。" }, { status: 400 });
  if (!isDocId(docId)) return NextResponse.json({ error: "書類の種類が正しくありません。" }, { status: 400 });
  if (!FILE_TYPES.has(file.type)) return NextResponse.json({ error: "画像（JPEG/PNG）かPDFを選んでください。" }, { status: 400 });
  if (file.size === 0 || file.size > FILE_LIMITS.bytes) return NextResponse.json({ error: "ファイルが大きすぎます（8MBまで）。" }, { status: 413 });
  const db = await getFileDb();
  const mine = await db.list(user.id);
  if (mine.length >= FILE_LIMITS.files || mine.reduce((s, m) => s + m.size, 0) + file.size > FILE_LIMITS.totalBytes) {
    return NextResponse.json({ error: "保存できる書類の量を超えました。いらない書類を消してください。" }, { status: 413 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const meta = {
    id: `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    userId: user.id,
    docId,
    name: (file.name || "書類").replace(/[\r\n]/g, " ").slice(0, 120),
    type: file.type,
    size: bytes.byteLength,
    addedAt: new Date().toISOString(),
    chunks: Math.max(1, Math.ceil(bytes.byteLength / CHUNK)),
  };
  await db.create(meta, bytes);
  return NextResponse.json({ item: view(meta) });
}
