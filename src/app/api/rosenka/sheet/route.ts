/**
 * 国税庁「財産評価基準書 路線価図・評価倍率表」の路線価図PDFを中継する。
 * ブラウザから直接読み込むと別サイトの制約（CORS）で画像化できないため、サーバーで取得して返す。
 * 取得先は www.rosenka.nta.go.jp の PDF・画像に限定する。
 */
import { NextResponse } from "next/server";
import { clientKey, sameOrigin } from "@/server/auth/http";
import { overLimit } from "@/server/limit";
import { MAX_SHEET_BYTES, checkSheetUrl } from "@/server/rosenka";

export const runtime = "nodejs";

/** 10分あたりの回数（地図で何枚か見比べても届かない、ゆとりのある数） */
const LIMIT = 200;

export async function GET(req: Request) {
  // 別のサイトから中継に使われないよう、このサイトの画面からの呼び出しだけを受ける
  if (!(await sameOrigin())) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  if (overLimit(`rosenka:sheet:${await clientKey()}`, LIMIT, 10 * 60_000)) {
    return NextResponse.json({ error: "短い時間に何度も使われたため、少し休んでいます。10分ほどしてからお試しください。" }, { status: 429 });
  }
  const u = checkSheetUrl(new URL(req.url).searchParams.get("url"));
  if (typeof u === "string") return NextResponse.json({ error: u }, { status: 400 });
  try {
    const res = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return NextResponse.json({ error: `路線価図を取得できませんでした（${res.status}）。` }, { status: 502 });
    if (Number(res.headers.get("content-length") ?? 0) > MAX_SHEET_BYTES) return NextResponse.json({ error: "ファイルが大きすぎます。" }, { status: 413 });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_SHEET_BYTES) return NextResponse.json({ error: "ファイルが大きすぎます。" }, { status: 413 });
    const type = /\.pdf$/i.test(u.pathname) ? "application/pdf" : (res.headers.get("content-type") ?? "application/octet-stream");
    return new Response(buf, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
  } catch {
    return NextResponse.json({ error: "国税庁のサイトに接続できませんでした。PDFを保存してアップロードしてください。" }, { status: 502 });
  }
}
