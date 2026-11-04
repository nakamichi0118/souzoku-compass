/** 税理士への相談：送る（POST）・自分の相談（事務所の人は全員分）の一覧（GET） */
import { NextResponse } from "next/server";
import { isStaffEmail } from "@/data/consultFirm";
import { currentUser, sameOrigin } from "@/server/auth/http";
import { overLimit } from "@/server/limit";
import { NewConsult, createConsult, firstError, view } from "@/server/consult/service";
import { getConsultDb } from "@/server/consult/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const all = new URL(req.url).searchParams.get("all") === "1";
  if (all && !isStaffEmail(user.email)) return NextResponse.json({ error: "事務所のアカウントでログインしてください。" }, { status: 403 });
  const db = await getConsultDb();
  const list = all ? await db.listAll() : await db.listByUser(user.id);
  return NextResponse.json({ items: list.map((r) => view(r, all)), staff: isStaffEmail(user.email) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!(await sameOrigin(true))) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "相談を送るには、ログインしてください。" }, { status: 401 });
  if (overLimit(`consult:${user.id}`, 10, 60 * 60_000)) return NextResponse.json({ error: "送る回数が多すぎます。少し時間をおいてお試しください。" }, { status: 429 });
  const parsed = NewConsult.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 });
  const r = await createConsult(user, parsed.data);
  return NextResponse.json({ item: view(r, false) });
}
