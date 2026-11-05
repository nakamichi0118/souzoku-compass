import { describe, expect, it } from "vitest";
import { apply, detectQuad, homography, isConvex, outputSize, warp } from "../scan";

/** 暗い机の上に、明るい紙（4つの角を持つ四角形）を置いた画像 */
function paper(w: number, h: number, corners: [number, number][]): Uint8Array {
  const g = new Uint8Array(w * h).fill(40);
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % 4];
      const z = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      const s = Math.sign(z);
      if (s && sign && s !== sign) return false;
      if (s) sign = s;
    }
    return true;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x + 0.5, y + 0.5)) g[y * w + x] = 230;
  return g;
}

describe("書類の四隅を探す", () => {
  it("斜めに置いた紙の四隅を、左上・右上・右下・左下の順で見つける", () => {
    const w = 160;
    const h = 120;
    const c: [number, number][] = [
      [30, 15],
      [130, 25],
      [120, 105],
      [20, 95],
    ];
    const q = detectQuad(paper(w, h, c), w, h)!;
    expect(q).not.toBeNull();
    q.forEach((p, i) => {
      expect(Math.abs(p.x * w - c[i][0])).toBeLessThan(3);
      expect(Math.abs(p.y * h - c[i][1])).toBeLessThan(3);
    });
  });

  it("明暗の差がない画像（白い机・真っ暗）では探さない", () => {
    expect(detectQuad(new Uint8Array(160 * 120).fill(200), 160, 120)).toBeNull();
  });

  it("紙が小さすぎるときは見つけたことにしない", () => {
    const g = paper(160, 120, [
      [70, 50],
      [80, 50],
      [80, 60],
      [70, 60],
    ]);
    expect(detectQuad(g, 160, 120)).toBeNull();
  });

  it("四角形でない明るいもの（三角形に近い形）は書類とみなさない", () => {
    const g = paper(160, 120, [
      [80, 5],
      [82, 6],
      [150, 115],
      [10, 115],
    ]);
    expect(detectQuad(g, 160, 120)).toBeNull();
  });

  it("ねじれた四角形は凸でない", () => {
    expect(isConvex([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toBe(false);
    expect(isConvex([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toBe(true);
  });
});

describe("斜めの書類を長方形に直す", () => {
  it("射影変換は4つの角を指定どおりに写す", () => {
    const from = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    const to = [{ x: 10, y: 5 }, { x: 90, y: 12 }, { x: 95, y: 70 }, { x: 3, y: 60 }];
    const h = homography(from, to)!;
    from.forEach((p, i) => {
      const r = apply(h, p);
      expect(r.x).toBeCloseTo(to[i].x, 6);
      expect(r.y).toBeCloseTo(to[i].y, 6);
    });
  });

  it("切り出す大きさは、向かい合う辺の長い方。長い辺は上限までに縮める", () => {
    expect(outputSize([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }])).toEqual({ w: 400, h: 300 });
    expect(outputSize([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }], 2000)).toEqual({ w: 2000, h: 1500 });
  });

  it("紙の部分だけを切り出す（出来上がりはほぼ全部が紙の明るさ）", () => {
    const w = 160;
    const h = 120;
    const c: [number, number][] = [[30, 15], [130, 25], [120, 105], [20, 95]];
    const g = paper(w, h, c);
    const rgba = new Uint8ClampedArray(w * h * 4);
    g.forEach((v, i) => rgba.set([v, v, v, 255], i * 4));
    const out = warp({ data: rgba, width: w, height: h }, c.map(([x, y]) => ({ x, y })))!;
    let bright = 0;
    for (let i = 0; i < out.width * out.height; i++) if (out.data[i * 4] > 180) bright++;
    expect(bright / (out.width * out.height)).toBeGreaterThan(0.95);
  });
});
