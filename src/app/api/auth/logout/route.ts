import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, endSession } from "@/server/auth/auth";
import { withSession } from "@/server/auth/http";

export const runtime = "nodejs";

export async function POST() {
  await endSession((await cookies()).get(SESSION_COOKIE)?.value);
  return withSession(NextResponse.json({ ok: true }), null);
}
