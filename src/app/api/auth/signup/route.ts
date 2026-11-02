import { NextResponse } from "next/server";
import { createSession, signup, tooManyAttempts } from "@/server/auth/auth";
import { clientKey, sameOrigin, withSession } from "@/server/auth/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  if (tooManyAttempts(`signup:${await clientKey()}`)) return NextResponse.json({ error: "しばらく時間をおいてからお試しください。" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as { name?: string; email?: string; password?: string };
  const r = await signup(String(b.name ?? ""), String(b.email ?? ""), String(b.password ?? ""));
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return withSession(NextResponse.json({ user: r.user }), await createSession(r.user.id));
}
