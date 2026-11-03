/** 地点の周りの道路の中心線（国土地理院）を返す。土地の枠をどの道路に面しているか判定するのに使う */
import { NextResponse } from "next/server";
import { roadsAround } from "@/server/roads";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 20 || lat > 46 || lng < 122 || lng > 154) {
    return NextResponse.json({ error: "日本国内の地点を指定してください。" }, { status: 400 });
  }
  try {
    return NextResponse.json({ roads: await roadsAround(lat, lng) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "道路の情報を取得できませんでした。" }, { status: 502 });
  }
}
