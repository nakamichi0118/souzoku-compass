import { NextResponse } from "next/server";
import { createSession, signup, tooManyAttempts } from "@/server/auth/auth";
import { clientKey, sameOrigin, withSession } from "@/server/auth/http";
import { readJson } from "@/server/requestBody";

export const runtime = "nodejs";

/** お名前・メールアドレス・パスワードだけなので、本文はこれで足りる */
const MAX_BODY = 4096;

export async function POST(req: Request) {
  if (!(await sameOrigin())) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  if (tooManyAttempts(`signup:${await clientKey()}`)) return NextResponse.json({ error: "しばらく時間をおいてからお試しください。" }, { status: 429 });
  const parsed = await readJson(req, MAX_BODY);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "tooLarge" ? "送られたデータが大きすぎます。" : "データの形が正しくありません。" }, { status: parsed.reason === "tooLarge" ? 413 : 400 });
  const b = (parsed.value ?? {}) as { name?: unknown; email?: unknown; password?: unknown };
  const r = await signup(String(b.name ?? ""), String(b.email ?? ""), String(b.password ?? ""));
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return withSession(NextResponse.json({ user: r.user }), await createSession(r.user.id));
}
