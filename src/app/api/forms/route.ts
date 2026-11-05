import { NextResponse } from "next/server";
import { draftReason } from "@/domain/review/topics";
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
    const consent = c.review?.consent;
    if (!consent?.terms || !consent.responsibility) {
      return NextResponse.json({ error: "利用規約への同意と、申告内容の責任についての確認にチェックを入れてください。" }, { status: 400 });
    }
    const pdf = await renderForms(buildFilingPages(c, r), { draft: draftReason(c.review, c.decedent.deathDate) });
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
