/** 1つの書類：中身を読む（GET）・種類を変える（PATCH {docId}）・消す（DELETE）。本人の書類だけ */
import { NextResponse } from "next/server";
import { currentUser, sameOrigin } from "@/server/auth/http";
import { getFileDb } from "@/server/files/store";
import { isDocId } from "@/server/files/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const NOT_FOUND = () => NextResponse.json({ error: "書類が見つかりません。" }, { status: 404 });

export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const r = await (await getFileDb()).get(user.id, (await params).id);
  if (!r) return NOT_FOUND();
  return new NextResponse(Buffer.from(r.bytes), {
    headers: {
      "content-type": r.meta.type,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.meta.name)}`,
    },
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await sameOrigin(true))) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!isDocId(body?.docId)) return NextResponse.json({ error: "書類の種類が正しくありません。" }, { status: 400 });
  const m = await (await getFileDb()).move(user.id, (await params).id, body.docId);
  return m ? NextResponse.json({ ok: true }) : NOT_FOUND();
}

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await sameOrigin(true))) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  return (await (await getFileDb()).remove(user.id, (await params).id)) ? NextResponse.json({ ok: true }) : NOT_FOUND();
}
