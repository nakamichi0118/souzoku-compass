import { describe, expect, it } from "vitest";
import { type Affine, apply, invert, residuals, solveTransform } from "../geo/georef";

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe("路線価図の位置合わせ（座標変換）", () => {
  // 0.5倍・30度回転・平行移動の相似変換
  const th = Math.PI / 6;
  const truth: Affine = [0.5 * Math.cos(th), 0.5 * Math.sin(th), -0.5 * Math.sin(th), 0.5 * Math.cos(th), 120, -40];
  const pts: [number, number][] = [
    [0, 0],
    [1000, 200],
    [300, 900],
    [800, 700],
  ];
  const pairs = pts.map((p) => ({ src: p, dst: apply(truth, p) }));

  it("2点で相似変換を復元する", () => close(solveTransform(pairs.slice(0, 2))!, truth));
  it("3点以上でアフィン変換を復元する", () => close(solveTransform(pairs)!, truth));
  it("一般のアフィン変換（縦横で縮尺が異なる）も3点で復元する", () => {
    const m: Affine = [0.8, 0.1, -0.05, 1.2, 10, 20];
    close(solveTransform(pts.slice(0, 3).map((p) => ({ src: p, dst: apply(m, p) })))!, m);
  });
  it("逆変換で元の点に戻る", () => close(apply(invert(truth), apply(truth, [123, 456])), [123, 456]));
  it("ずれ（残差）は誤差のない点で0", () => residuals(solveTransform(pairs)!, pairs).forEach((r) => expect(r).toBeLessThan(1e-6)));
  it("基準点が1点では変換を求めない", () => expect(solveTransform(pairs.slice(0, 1))).toBeNull());
  it("一直線上の3点はエラー", () => {
    expect(() => solveTransform([0, 1, 2].map((i) => ({ src: [i, i] as [number, number], dst: [i, i] as [number, number] })))).toThrow();
  });
});
