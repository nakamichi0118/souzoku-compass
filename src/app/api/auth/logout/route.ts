import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, endSession } from "@/server/auth/auth";
import { sameOrigin, withSession } from "@/server/auth/http";

export const runtime = "nodejs";

export async function POST() {
  // 別のサイトから勝手にログアウトさせられないよう、このサイトの画面からの呼び出しだけを受ける
  if (!(await sameOrigin())) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  await endSession((await cookies()).get(SESSION_COOKIE)?.value);
  return withSession(NextResponse.json({ ok: true }), null);
}
