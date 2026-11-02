import { NextResponse } from "next/server";
import { buildDivisionDoc } from "@/documents/division";
import { renderDivision } from "@/documents/renderDivision";
import type { Case } from "@/domain/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const c = (await req.json()) as Case;
  try {
    const pdf = await renderDivision(buildDivisionDoc(c));
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("遺産分割協議書.pdf")}`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
