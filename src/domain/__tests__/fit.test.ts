import { describe, expect, it } from "vitest";
import { distanceM, frameCorners, framePairs, type Frame } from "../geo/frame";
import { frameFromPairs, framePoint, pairsAgree, type FitPair } from "../geo/fit";
import { projector } from "../geo/lot";

const paper = { widthMm: 420, heightMm: 297 };

describe("基準点から路線価図の枠を求める", () => {
  it.each<Frame>([
    { center: [33.59, 130.42], scale: 1500, rotation: 0 },
    { center: [35.68, 139.76], scale: 2500, rotation: 7.5 },
    { center: [43.06, 141.35], scale: 1000, rotation: -12 },
    // 北が真上でない（大きく傾いた）路線価図
    { center: [34.69, 135.5], scale: 1500, rotation: 45 },
    { center: [34.69, 135.5], scale: 2500, rotation: -120 },
    { center: [34.69, 135.5], scale: 1000, rotation: 170 },
  ])("枠の3つの角から元の枠に戻る（%o）", (f) => {
    const got = frameFromPairs(framePairs(f, paper), paper)!;
    expect(Math.abs(got.scale - f.scale)).toBeLessThanOrEqual(1);
    expect(got.rotation).toBeCloseTo(f.rotation, 0);
    expect(got.center[0]).toBeCloseTo(f.center[0], 5);
    expect(got.center[1]).toBeCloseTo(f.center[1], 5);
  });
  it("図の内側の2点だけでも求まる", () => {
    const f: Frame = { center: [33.59, 130.42], scale: 2000, rotation: 3 };
    const [nw, ne, se] = frameCorners(f, paper);
    // 対角線上の 1/4 と 3/4 の点
    const mid = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const got = frameFromPairs(
      [
        { img: [0.25, 0.25], latlng: mid(nw, se, 0.25) },
        { img: [0.75, 0.75], latlng: mid(nw, se, 0.75) },
      ],
      paper,
    )!;
    expect(got.scale).toBeGreaterThan(1950);
    expect(got.scale).toBeLessThan(2050);
    expect(Math.abs(got.rotation - 3)).toBeLessThan(0.5);
    expect(ne).toBeTruthy();
  });
  it("枠の上の位置：四隅は frameCorners と同じ", () => {
    const f: Frame = { center: [35.68, 139.76], scale: 2500, rotation: 50 };
    const c = frameCorners(f, paper);
    ([[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][]).forEach((img, i) => {
      expect(distanceM(framePoint(f, paper, img), c[i])).toBeLessThan(0.01);
    });
    expect(distanceM(framePoint(f, paper, [0.5, 0.5]), f.center)).toBeLessThan(0.01);
  });

  describe("点の組が枠とよく合っているか", () => {
    const f: Frame = { center: [34.69, 135.5], scale: 1500, rotation: 45 };
    const imgs: [number, number][] = [[0.2, 0.3], [0.7, 0.25], [0.45, 0.8], [0.6, 0.6]];
    const exact: FitPair[] = imgs.map((img) => ({ img, latlng: framePoint(f, paper, img) }));
    /** 地図の上の点を東へ east m ずらす */
    const shift = (p: FitPair, east: number): FitPair => ({ img: p.img, latlng: projector(p.latlng).from(east, 0) });

    it("45°傾いた図でも、目印が3組以上ぴったり合えば使える", () => {
      const got = frameFromPairs(exact, paper)!;
      expect(got.rotation).toBeCloseTo(45, 0);
      expect(pairsAgree(exact, paper, got)).toBe(true);
    });

    it("目印を選ぶときの少しのずれ（10m程度）は合っているとする", () => {
      const noisy = exact.map((p, i) => shift(p, i % 2 ? 10 : -10));
      expect(pairsAgree(noisy, paper, frameFromPairs(noisy, paper)!)).toBe(true);
    });

    it("1組だけ大きくずれていれば合っていない", () => {
      const bad = [...exact.slice(0, 3), shift(exact[3], 150)];
      expect(pairsAgree(bad, paper, frameFromPairs(bad, paper)!)).toBe(false);
    });

    it("2組だけでは確かめられない", () => {
      const two = exact.slice(0, 2);
      expect(pairsAgree(two, paper, frameFromPairs(two, paper)!)).toBe(false);
    });
  });

  it("1点では求めない", () => {
    expect(frameFromPairs([{ img: [0.5, 0.5], latlng: [33.59, 130.42] }], paper)).toBeNull();
  });
});
