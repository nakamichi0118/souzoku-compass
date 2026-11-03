import { describe, expect, it } from "vitest";
import { latLngToPixel, pixelToLatLng, tileLayout } from "../capture";

describe("地理院タイルの座標計算", () => {
  it("緯度0・経度0はズーム1で世界の真ん中（256, 256）", () => {
    const [x, y] = latLngToPixel([0, 0], 1);
    expect(x).toBeCloseTo(256, 9);
    expect(y).toBeCloseTo(256, 9);
    const [lat, lng] = pixelToLatLng([256, 256], 1);
    expect(lat).toBeCloseTo(0, 9);
    expect(lng).toBeCloseTo(0, 9);
  });

  it("左上の端は経度 -180°・緯度 約85.05°", () => {
    const [lat, lng] = pixelToLatLng([0, 0], 3);
    expect(lng).toBeCloseTo(-180, 9);
    expect(lat).toBeCloseTo(85.0511287798, 6);
  });

  it("東京駅はズーム18でタイル (232847, 103226) に入る（別の式で確かめた値）", () => {
    const [x, y] = latLngToPixel([35.681236, 139.767125], 18);
    expect(Math.floor(x / 256)).toBe(232847);
    expect(Math.floor(y / 256)).toBe(103226);
  });

  it("緯度経度 → 画素 → 緯度経度 で元に戻る", () => {
    for (const ll of [
      [35.681236, 139.767125],
      [43.06417, 141.34694],
      [26.2125, 127.68111],
      [-33.86, 151.21],
    ] as [number, number][]) {
      for (const z of [5, 12, 17, 20]) {
        const [lat, lng] = pixelToLatLng(latLngToPixel(ll, z), z);
        expect(lat).toBeCloseTo(ll[0], 9);
        expect(lng).toBeCloseTo(ll[1], 9);
      }
    }
  });

  it("ズームが1つ上がると画素座標は2倍", () => {
    const a = latLngToPixel([35.0, 135.0], 16);
    const b = latLngToPixel([35.0, 135.0], 17);
    expect(b[0]).toBeCloseTo(a[0] * 2, 6);
    expect(b[1]).toBeCloseTo(a[1] * 2, 6);
  });
});

describe("タイルの並べ方", () => {
  it("ズーム1の世界全体（512×512）は4枚で埋まる", () => {
    const t = tileLayout([0, 0], 1, 512, 512);
    expect(t.x0).toBe(0);
    expect(t.y0).toBe(0);
    expect(t.tiles.map((k) => [k.x, k.y, k.dx, k.dy, k.size])).toEqual([
      [0, 0, 0, 0, 256],
      [1, 0, 256, 0, 256],
      [0, 1, 0, 256, 256],
      [1, 1, 256, 256, 256],
    ]);
  });

  it("画像の中心が指定した地点になり、画像全体がタイルで覆われる", () => {
    const center: [number, number] = [35.681236, 139.767125];
    const w = 1280;
    const h = 960;
    const t = tileLayout(center, 17, w, h);
    const [cx, cy] = latLngToPixel(center, 17);
    expect(Math.abs(cx - t.x0 - w / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(cy - t.y0 - h / 2)).toBeLessThanOrEqual(0.5);
    // 左上・右下の角がどれかのタイルに入っている
    const covered = (px: number, py: number) => t.tiles.some((k) => px >= k.dx && px < k.dx + k.size && py >= k.dy && py < k.dy + k.size);
    expect(covered(0, 0)).toBe(true);
    expect(covered(w - 1, h - 1)).toBe(true);
    expect(t.tiles.every((k) => k.z === 17 && k.size === 256)).toBe(true);
  });

  it("ズーム18より細かいときは、ズーム18のタイルを拡大して使う", () => {
    const t = tileLayout([35.681236, 139.767125], 19, 600, 400);
    expect(t.z).toBe(19);
    expect(t.tiles.every((k) => k.z === 18 && k.size === 512)).toBe(true);
  });

  it("経度180°をまたぐとタイル番号が折り返し、極の外側のタイルは使わない", () => {
    const t = tileLayout([85, 179.99], 2, 512, 512);
    expect(t.tiles.every((k) => k.x >= 0 && k.x < 4 && k.y >= 0 && k.y < 4)).toBe(true);
    expect(t.tiles.some((k) => k.x === 0)).toBe(true);
    expect(t.tiles.some((k) => k.x === 3)).toBe(true);
  });
});
