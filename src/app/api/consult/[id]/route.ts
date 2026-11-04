/** 1件の相談：読む（GET・既読にする）・メッセージを送る（POST）・打ち合わせの案内（PUT、事務所の人だけ） */
import { NextResponse } from "next/server";
import { isStaffEmail } from "@/data/consultFirm";
import { currentUser, sameOrigin } from "@/server/auth/http";
import { overLimit } from "@/server/limit";
import { Meeting, NewMessage, addMessage, firstError, markSeen, setMeeting, view } from "@/server/consult/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const NOT_FOUND = () => NextResponse.json({ error: "相談が見つかりません。" }, { status: 404 });

async function staffView(email: string, userEmail: string) {
  return isStaffEmail(email) && email !== userEmail;
}

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const r = await markSeen(user, (await params).id);
  if (!r) return NOT_FOUND();
  return NextResponse.json({ item: view(r, await staffView(user.email, r.userEmail)) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, { params }: Ctx) {
  if (!(await sameOrigin(true))) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  if (overLimit(`consultMsg:${user.id}`, 60, 60 * 60_000)) return NextResponse.json({ error: "送る回数が多すぎます。少し時間をおいてお試しください。" }, { status: 429 });
  const parsed = NewMessage.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 });
  const r = await addMessage(user, (await params).id, parsed.data.text);
  if (!r) return NOT_FOUND();
  return NextResponse.json({ item: view(r, await staffView(user.email, r.userEmail)) });
}

export async function PUT(req: Request, { params }: Ctx) {
  if (!(await sameOrigin(true))) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const user = await currentUser();
  if (!user || !isStaffEmail(user.email)) return NextResponse.json({ error: "事務所のアカウントでログインしてください。" }, { status: 403 });
  const parsed = Meeting.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstError(parsed.error) }, { status: 400 });
  const r = await setMeeting(user, (await params).id, parsed.data);
  if (!r) return NOT_FOUND();
  return NextResponse.json({ item: view(r, true) });
}
