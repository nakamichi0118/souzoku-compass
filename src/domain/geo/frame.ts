/**
 * 路線価図1枚分の範囲（枠）を地図上に置くための計算。
 *
 * 枠の大きさ ＝ 用紙の大きさ × 縮尺 で求める（例：A3横 420mm × 1/2,500 → 地上で 1,050m）。
 * 中心・縮尺・回転は利用者が地図上で合わせる。索引図などの外部データは使わない。
 * 数百m〜数km の範囲なので、緯度経度は中心付近で平面とみなして計算する（誤差は重ね表示に影響しない程度）。
 */
import { metersPerDegree } from "./lot";

export type LatLng = [number, number];

export interface Frame {
  center: LatLng;
  /** 縮尺の分母（2500 なら 1/2,500） */
  scale: number;
  /** 回転角（度、時計回り。路線価図の上が真北からずれている場合に使う） */
  rotation: number;
}

export interface Paper {
  widthMm: number;
  heightMm: number;
}

/** 路線価図の読み込み前に使う用紙（A3横） */
export const DEFAULT_PAPER: Paper = { widthMm: 420, heightMm: 297 };


/** 枠の四隅（左上・右上・右下・左下）の緯度経度 */
export function frameCorners(f: Frame, paper: Paper): [LatLng, LatLng, LatLng, LatLng] {
  const w = (paper.widthMm * f.scale) / 1000; // 地上の幅（m）
  const h = (paper.heightMm * f.scale) / 1000;
  const th = (f.rotation * Math.PI) / 180;
  const k = metersPerDegree(f.center[0]);
  // 画像の座標（右が x、下が y）で見た四隅を、東・北方向のメートルに直す
  const corner = (sx: number, sy: number): LatLng => {
    const x = sx * (w / 2);
    const y = -sy * (h / 2); // 画像の下向き → 南向き
    const east = x * Math.cos(th) + y * Math.sin(th);
    const north = -x * Math.sin(th) + y * Math.cos(th);
    return [f.center[0] + north / k.lat, f.center[1] + east / k.lng];
  };
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

/** 枠を基準点の組（画像の正規化座標 ↔ 緯度経度）にする。重ね表示はこの3点から求める */
export function framePairs(f: Frame, paper: Paper): { img: [number, number]; latlng: LatLng }[] {
  const [nw, ne, , sw] = frameCorners(f, paper);
  return [
    { img: [0, 0], latlng: nw },
    { img: [1, 0], latlng: ne },
    { img: [0, 1], latlng: sw },
  ];
}

/** 地上の距離（m）。枠の大きさの確認用 */
export function distanceM(a: LatLng, b: LatLng): number {
  const k = metersPerDegree((a[0] + b[0]) / 2);
  return Math.hypot((a[0] - b[0]) * k.lat, (a[1] - b[1]) * k.lng);
}

/** 点が枠の中にあるか */
export function insideFrame(p: LatLng, corners: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const [yi, xi] = corners[i];
    const [yj, xj] = corners[j];
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
