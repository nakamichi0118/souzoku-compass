import { describe, expect, it } from "vitest";
import { autoAlign, distanceField, roadEdgePoints } from "../geo/autoAlign";
import { projector, type LatLng, type Road } from "../geo/lot";

const O: LatLng = [33.59, 130.42];
const P = projector(O);
const paper = { widthMm: 420, heightMm: 297 };

/** 道路の両端の線を、正しい枠で描いた「路線価図」の画像（暗い画素の配列）を作る */
function render(roads: Road[], w: number, h: number, dx: number, dy: number, scale: number, rot: number) {
  const dark = new Uint8Array(w * h);
  const ppm = w / ((paper.widthMm * scale) / 1000);
  const th = (rot * Math.PI) / 180;
  for (const [e0, n0] of roadEdgePoints(roads, O, 0.5)) {
    const e = e0 - dx;
    const n = n0 - dy;
    const x = e * Math.cos(th) - n * Math.sin(th);
    const y = e * Math.sin(th) + n * Math.cos(th);
    const px = Math.round(w / 2 + x * ppm);
    const py = Math.round(h / 2 - y * ppm);
    if (px >= 0 && py >= 0 && px < w && py < h) dark[py * w + px] = 1;
  }
  return dark;
}

describe("路線価図の自動位置合わせ", () => {
  const xs = [-230, -95, 20, 160, 300];
  const ys = [-170, -60, 55, 190];
  const roads: Road[] = [
    ...xs.map((x) => ({ line: [P.from(x, -400), P.from(x, 400)], width: 6 })),
    ...ys.map((y) => ({ line: [P.from(-500, y), P.from(500, y)], width: 6 })),
    { line: [P.from(-300, -300), P.from(250, 260)], width: 8 }, // 斜めの道路
  ];

  it("ずれた枠から、道路が重なる位置・縮尺・向きを見つける", () => {
    const w = 1000;
    const h = Math.round((w * paper.heightMm) / paper.widthMm);
    const truth = { dx: 170, dy: -120, scale: 2500, rot: 1.5 };
    const dark = render(roads, w, h, truth.dx, truth.dy, truth.scale, truth.rot);
    const f = { d: distanceField(dark, w, h), w, h };
    const r = autoAlign(f, paper, roads, O, { center: O, scale: 2600, rotation: 0 })!;
    expect(r).not.toBeNull();
    const [cx, cy] = P.to(r.frame.center);
    expect(Math.abs(cx - truth.dx)).toBeLessThan(3);
    expect(Math.abs(cy - truth.dy)).toBeLessThan(3);
    expect(Math.abs(r.frame.scale - truth.scale) / truth.scale).toBeLessThan(0.02);
    expect(Math.abs(r.frame.rotation - truth.rot)).toBeLessThan(0.6);
    expect(r.score).toBeLessThan(r.before);
  });
});
