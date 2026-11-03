import { describe, expect, it } from "vitest";
import { frameCorners, framePairs, type Frame } from "../geo/frame";
import { frameFromPairs } from "../geo/fit";

const paper = { widthMm: 420, heightMm: 297 };

describe("基準点から路線価図の枠を求める", () => {
  it.each<Frame>([
    { center: [33.59, 130.42], scale: 1500, rotation: 0 },
    { center: [35.68, 139.76], scale: 2500, rotation: 7.5 },
    { center: [43.06, 141.35], scale: 1000, rotation: -12 },
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
  it("1点では求めない", () => {
    expect(frameFromPairs([{ img: [0.5, 0.5], latlng: [33.59, 130.42] }], paper)).toBeNull();
  });
});
