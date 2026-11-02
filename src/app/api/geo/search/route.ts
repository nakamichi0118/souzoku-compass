/** 住所から緯度経度を調べる（国土地理院 住所検索API） */
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ results: [] });
  try {
    const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { geometry: { coordinates: [number, number] }; properties: { title: string } }[];
    return NextResponse.json({
      results: json.slice(0, 8).map((r) => ({ title: r.properties.title, lng: r.geometry.coordinates[0], lat: r.geometry.coordinates[1] })),
    });
  } catch {
    return NextResponse.json({ error: "住所検索に接続できませんでした。地図を動かして場所を選んでください。" }, { status: 502 });
  }
}
