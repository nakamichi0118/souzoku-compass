/**
 * 国土地理院の道路中心線（ベクトルタイル experimental_rdcl、ズーム16）から、地点の周りの道路を取り出す。
 * https://github.com/gsi-cyberjapan/experimental_rdcl
 */
import { type Road, metersPerDegree } from "@/domain/geo/lot";

const Z = 16;
const tileOf = (lat: number, lng: number) => {
  const n = 2 ** Z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y };
};

/** 幅員区分の文字（例：「5.5m-13m未満」）から、だいたいの幅（m）を求める */
export function widthOf(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const nums = [...v.normalize("NFKC").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (nums.length >= 2) return (nums[0] + nums[1]) / 2;
  if (nums.length === 1) return v.includes("未満") ? nums[0] * 0.8 : v.includes("以上") ? nums[0] * 1.1 : nums[0];
  return undefined;
}

interface Feature {
  geometry?: { type: string; coordinates: unknown };
  properties?: Record<string, unknown>;
}

/** GeoJSON の道路を Road（緯度経度の並び）にする */
export function roadsFromGeoJSON(json: { features?: Feature[] }): Road[] {
  const out: Road[] = [];
  for (const f of json.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    const width = widthOf(f.properties?.rnkWidth);
    const lines = g.type === "LineString" ? [g.coordinates as number[][]] : g.type === "MultiLineString" ? (g.coordinates as number[][][]) : [];
    for (const l of lines) if (l.length >= 2) out.push({ line: l.map(([lng, lat]) => [lat, lng] as [number, number]), width });
  }
  return out;
}

const cache = new Map<string, Road[]>();

async function tile(x: number, y: number): Promise<Road[]> {
  const key = `${x}/${y}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/${Z}/${x}/${y}.geojson`, { signal: AbortSignal.timeout(10_000) });
  const roads = res.status === 404 ? [] : res.ok ? roadsFromGeoJSON(await res.json()) : null;
  if (!roads) throw new Error(`道路の情報を取得できませんでした（${res.status}）`);
  if (cache.size > 500) cache.clear();
  cache.set(key, roads);
  return roads;
}

/** 地点から半径 radius m の範囲にかかるタイルの道路をまとめて返す */
export async function roadsAround(lat: number, lng: number, radius = 80): Promise<Road[]> {
  const k = metersPerDegree(lat);
  const dLat = radius / k.lat;
  const dLng = radius / k.lng;
  const a = tileOf(lat + dLat, lng - dLng);
  const b = tileOf(lat - dLat, lng + dLng);
  const jobs: Promise<Road[]>[] = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) jobs.push(tile(x, y));
  const inBox = (p: [number, number]) => Math.abs(p[0] - lat) <= dLat * 1.5 && Math.abs(p[1] - lng) <= dLng * 1.5;
  return (await Promise.all(jobs)).flat().filter((r) => r.line.some(inBox));
}
