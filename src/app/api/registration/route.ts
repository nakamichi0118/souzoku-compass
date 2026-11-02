import { NextResponse } from "next/server";
import { renderRegistration } from "@/documents/renderRegistration";
import { buildRegistrations } from "@/domain/registration";
import type { Case } from "@/domain/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Case | null;
  if (!body?.assets) return NextResponse.json({ error: "入力が正しくありません。" }, { status: 400 });
  const apps = buildRegistrations(body);
  if (apps.length === 0) return NextResponse.json({ error: "取得する人が決まった不動産がありません。" }, { status: 400 });
  const pdf = await renderRegistration(apps);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("登記申請書_相続.pdf")}`,
    },
  });
}
