/**
 * ログインした利用者のデータ（聞き取りの答え・手続きの記録・財産と遺産分割など）の読み書き。
 * 画面の保存領域のキーごとに JSON 文字列で持つ。
 */
import { NextResponse } from "next/server";
import { getDb } from "@/server/auth/db";
import { currentUser, sameOrigin } from "@/server/auth/http";
import { readText } from "@/server/requestBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX = "souzoku-compass:";
/** Firestore の1文書の上限（1MiB）より小さく */
const MAX_BYTES = 900_000;

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const d = await (await getDb()).getData(user.id);
  return NextResponse.json({ kv: d?.kv ?? {}, updatedAt: d?.updatedAt ?? null }, { headers: { "cache-control": "no-store" } });
}

async function write(req: Request) {
  if (!(await sameOrigin())) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  // 大きすぎる本文は最後まで読まずに断る（日本語は1文字3バイトなので、文字数の上限の3倍まで読む）
  const raw = await readText(req, MAX_BYTES * 3);
  if (raw === null || raw.length > MAX_BYTES) return NextResponse.json({ error: "保存するデータが大きすぎます。" }, { status: 413 });
  let body: { set?: Record<string, unknown>; del?: unknown[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "データの形が正しくありません。" }, { status: 400 });
  }
  const set: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.set ?? {})) if (k.startsWith(PREFIX) && typeof v === "string") set[k] = v;
  const del = (body.del ?? []).filter((k): k is string => typeof k === "string" && k.startsWith(PREFIX));
  const db = await getDb();
  const cur = await db.getData(user.id);
  const size = JSON.stringify({ ...(cur?.kv ?? {}), ...set }).length;
  if (size > MAX_BYTES) return NextResponse.json({ error: "保存するデータが大きすぎます。" }, { status: 413 });
  const next = await db.patchData(user.id, set, del);
  return NextResponse.json({ ok: true, updatedAt: next.updatedAt });
}

export const PUT = write;
// ページを閉じるときの送信（navigator.sendBeacon は POST のみ）
export const POST = write;
