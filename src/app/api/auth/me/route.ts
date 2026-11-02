import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ user: await currentUser() }, { headers: { "cache-control": "no-store" } });
}
