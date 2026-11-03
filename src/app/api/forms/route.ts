import { NextResponse } from "next/server";
import { calculate } from "@/domain/tax/engine";
import { buildFilingPages } from "@/forms/filing";
import { renderForms } from "@/forms/render";
import { failureMessage, readCaseRequest } from "@/server/caseRequest";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r0 = await readCaseRequest(req, "forms");
  if ("res" in r0) return r0.res;
  const c = r0.case;
  try {
    const r = calculate(c);
    if (r.blockers.length > 0) {
      return NextResponse.json({ error: "自動では作成できない事項があります。", blockers: r.blockers }, { status: 422 });
    }
    const pdf = await renderForms(buildFilingPages(c, r));
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("相続税申告書_令和8年分.pdf")}`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: failureMessage(e, "申告書を作れませんでした。入力内容を確かめてください。") }, { status: 400 });
  }
}
