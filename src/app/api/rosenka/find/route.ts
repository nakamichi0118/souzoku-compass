/** 地図上の地点から、国税庁の路線価図（令和8年分）の図番号の候補を返す */
import { NextResponse } from "next/server";
import { findSheets } from "@/server/rosenkaIndex";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 20 || lat > 46 || lng < 122 || lng > 154) {
    return NextResponse.json({ error: "日本国内の地点を指定してください。" }, { status: 400 });
  }
  try {
    return NextResponse.json(await findSheets(lat, lng));
  } catch (e) {
    return NextResponse.json({ error: `路線価図を探せませんでした（${e instanceof Error ? e.message : String(e)}）。` }, { status: 502 });
  }
}
