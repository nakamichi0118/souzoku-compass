import { NextResponse } from "next/server";
import { buildDivisionDoc } from "@/documents/division";
import { renderDivision } from "@/documents/renderDivision";
import { failureMessage, readCaseRequest } from "@/server/caseRequest";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r0 = await readCaseRequest(req, "division");
  if ("res" in r0) return r0.res;
  try {
    const pdf = await renderDivision(buildDivisionDoc(r0.case));
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("遺産分割協議書.pdf")}`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: failureMessage(e, "遺産分割協議書を作れませんでした。入力内容を確かめてください。") }, { status: 400 });
  }
}
