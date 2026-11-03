import { NextResponse } from "next/server";
import { createSession, login, loginKey, normalizeEmail, plausibleEmail, resetAttempts, tooManyAttempts } from "@/server/auth/auth";
import { clientKey, sameOrigin, withSession } from "@/server/auth/http";
import { readJson } from "@/server/requestBody";

export const runtime = "nodejs";

/** メールアドレスとパスワードだけなので、本文はこれで足りる */
const MAX_BODY = 4096;
const WRONG = "メールアドレスかパスワードが違います。";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const ip = await clientKey();
  // 接続元ごとの上限（メールアドレスを変えながらの総当たりも止める）
  if (tooManyAttempts(`login-ip:${ip}`, 30)) return NextResponse.json({ error: "ログインの試行が続いたため、10分ほど待ってからお試しください。" }, { status: 429 });
  const parsed = await readJson(req, MAX_BODY);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "tooLarge" ? "送られたデータが大きすぎます。" : "データの形が正しくありません。" }, { status: parsed.reason === "tooLarge" ? 413 : 400 });
  const b = (parsed.value ?? {}) as { email?: unknown; password?: unknown };
  const email = normalizeEmail(String(b.email ?? ""));
  // 形の正しくないメールアドレスは、照合も回数の記録もせずに断る（記録のキーを限りなく増やさない）
  if (!plausibleEmail(email)) return NextResponse.json({ error: WRONG }, { status: 401 });
  const key = loginKey(ip, email);
  if (tooManyAttempts(key)) return NextResponse.json({ error: "ログインの失敗が続いたため、10分ほど待ってからお試しください。" }, { status: 429 });
  const user = await login(email, String(b.password ?? ""));
  if (!user) return NextResponse.json({ error: WRONG }, { status: 401 });
  resetAttempts(key);
  return withSession(NextResponse.json({ user }), await createSession(user.id));
}
