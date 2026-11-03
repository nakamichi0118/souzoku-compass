/**
 * 土地のまわりの地理院地図（標準地図）を1枚の画像にする（コンパスくんに見せる用）。
 *
 * 地理院タイルは、世界をズームごとに 256 画素四方の画像に分けたもの（Web メルカトル図法）。
 * ズーム z では世界全体が 256·2^z 画素四方になる。必要なタイルを読み込んで canvas に並べる。
 * ブラウザでだけ動く（document・Image は関数の中でだけ使う）。
 */
type LL = [number, number];

const TILE = 256;
/** 標準地図のタイルがあるいちばん細かいズーム。これより細かいときは拡大して使う */
const MAX_TILE_ZOOM = 18;
/** メルカトル図法で表せる緯度の限界 */
const MAX_LAT = 85.0511287798;
const TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png";

/** 緯度経度 → ズーム z での世界全体の画素座標（左上が 0,0） */
export function latLngToPixel([lat, lng]: LL, z: number): LL {
  const size = TILE * 2 ** z;
  const s = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size];
}

/** ズーム z での世界全体の画素座標 → 緯度経度 */
export function pixelToLatLng([x, y]: LL, z: number): LL {
  const size = TILE * 2 ** z;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  return [lat, (x / size) * 360 - 180];
}

export interface TileLayout {
  /** 画像の左上の、世界全体の画素座標（ズーム z） */
  x0: number;
  y0: number;
  z: number;
  /** 並べるタイル（dx, dy は画像の上の左上の位置、size は描く大きさ） */
  tiles: { z: number; x: number; y: number; dx: number; dy: number; size: number }[];
}

/** center を中心にした width × height 画素の画像に、どのタイルをどこへ描けばよいかを求める */
export function tileLayout(center: LL, zoom: number, width: number, height: number): TileLayout {
  const z = Math.round(zoom);
  const tz = Math.min(z, MAX_TILE_ZOOM);
  const size = TILE * 2 ** (z - tz);
  const n = 2 ** tz;
  const [cx, cy] = latLngToPixel(center, z);
  // 画素の境目に合わせると、タイルの継ぎ目がぼやけない
  const x0 = Math.round(cx - width / 2);
  const y0 = Math.round(cy - height / 2);
  const tiles: TileLayout["tiles"] = [];
  for (let ty = Math.floor(y0 / size); ty <= Math.floor((y0 + height - 1) / size); ty++) {
    if (ty < 0 || ty >= n) continue; // 北極・南極の外側にはタイルがない
    for (let tx = Math.floor(x0 / size); tx <= Math.floor((x0 + width - 1) / size); tx++) {
      tiles.push({ z: tz, x: ((tx % n) + n) % n, y: ty, dx: tx * size - x0, dy: ty * size - y0, size });
    }
  }
  return { x0, y0, z, tiles };
}

/** タイル画像を読み込む。読み込めないとき・時間がかかりすぎるときは null（その部分は白いまま） */
function loadTile(src: string, timeoutMs = 15000): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    const done = (v: HTMLImageElement | null) => {
      clearTimeout(timer);
      ok(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    img.crossOrigin = "anonymous";
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = src;
  });
}

/**
 * center を中心にした地理院地図の PNG 画像を作る。
 * marker を付けると、中心に赤い丸を描く。toLatLng・toPixel で画像上の位置と緯度経度を行き来できる。
 */
export async function captureGsiMap(
  center: LL,
  opts: { zoom?: number; width?: number; height?: number; marker?: boolean } = {},
): Promise<{ blob: Blob; width: number; height: number; toLatLng: (x: number, y: number) => LL; toPixel: (ll: LL) => LL }> {
  const { zoom = 17, width = 1280, height = 960, marker = false } = opts;
  const { x0, y0, z, tiles } = tileLayout(center, zoom, width, height);
  const toLatLng = (x: number, y: number) => pixelToLatLng([x0 + x, y0 + y], z);
  const toPixel = (ll: LL): LL => {
    const [x, y] = latLngToPixel(ll, z);
    return [x - x0, y - y0];
  };

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  await Promise.all(
    tiles.map(async (t) => {
      const img = await loadTile(TILE_URL.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y)));
      if (img) ctx.drawImage(img, t.dx, t.dy, t.size, t.size);
    }),
  );

  if (marker) {
    const [mx, my] = toPixel(center);
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(mx, my, 18, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 出典（地理院タイルを使うときの決まり）
  const credit = "出典：国土地理院（地理院タイル）";
  ctx.font = "12px sans-serif";
  const tw = ctx.measureText(credit).width;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillRect(width - tw - 10, height - 20, tw + 10, 20);
  ctx.fillStyle = "#44403c";
  ctx.textBaseline = "middle";
  ctx.fillText(credit, width - tw - 5, height - 10);

  const blob = await new Promise<Blob>((ok, ng) => canvas.toBlob((b) => (b ? ok(b) : ng(new Error("地図の画像を作れませんでした"))), "image/png"));
  return { blob, width, height, toLatLng, toPixel };
}
