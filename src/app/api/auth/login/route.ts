import { NextResponse } from "next/server";
import { createSession, login, normalizeEmail, resetAttempts, tooManyAttempts } from "@/server/auth/auth";
import { clientKey, sameOrigin, withSession } from "@/server/auth/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const key = `login:${await clientKey()}:${normalizeEmail(String(b.email ?? ""))}`;
  if (tooManyAttempts(key)) return NextResponse.json({ error: "ログインの失敗が続いたため、10分ほど待ってからお試しください。" }, { status: 429 });
  const user = await login(String(b.email ?? ""), String(b.password ?? ""));
  if (!user) return NextResponse.json({ error: "メールアドレスかパスワードが違います。" }, { status: 401 });
  resetAttempts(key);
  return withSession(NextResponse.json({ user }), await createSession(user.id));
}
