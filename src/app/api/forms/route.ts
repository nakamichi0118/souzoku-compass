import { NextResponse } from "next/server";
import { calculate } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { buildFilingPages } from "@/forms/filing";
import { renderForms } from "@/forms/render";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const c = (await req.json()) as Case;
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
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
