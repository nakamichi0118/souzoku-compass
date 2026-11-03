import { NextResponse } from "next/server";
import { renderRegistration } from "@/documents/renderRegistration";
import { buildRegistrations } from "@/domain/registration";
import { failureMessage, readCaseRequest } from "@/server/caseRequest";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r0 = await readCaseRequest(req, "registration");
  if ("res" in r0) return r0.res;
  try {
    const apps = buildRegistrations(r0.case);
    if (apps.length === 0) return NextResponse.json({ error: "取得する人が決まった不動産がありません。" }, { status: 400 });
    const pdf = await renderRegistration(apps);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("登記申請書_相続.pdf")}`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: failureMessage(e, "登記申請書を作れませんでした。入力内容を確かめてください。") }, { status: 400 });
  }
}
