/** 緯度経度から町丁目名を調べる（国土地理院 逆ジオコーダ） */
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return NextResponse.json({ error: "緯度経度が正しくありません。" }, { status: 400 });
  try {
    const res = await fetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { results?: { muniCd: string; lv01Nm: string } };
    return NextResponse.json({ muniCd: json.results?.muniCd ?? null, town: json.results?.lv01Nm ?? null });
  } catch {
    return NextResponse.json({ error: "住所を調べられませんでした。" }, { status: 502 });
  }
}
