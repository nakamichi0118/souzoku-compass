import { describe, expect, it } from "vitest";
import { DEFAULT_PAPER, distanceM, frameCorners, framePairs, insideFrame } from "../geo/frame";

describe("路線価図の枠", () => {
  const f = { center: [35.68, 139.76] as [number, number], scale: 2500, rotation: 0 };
  const [nw, ne, se, sw] = frameCorners(f, DEFAULT_PAPER);
  it("A3横・1/2,500 の枠は東西 1,050m・南北 742.5m", () => {
    expect(distanceM(nw, ne)).toBeCloseTo(1050, 0);
    expect(distanceM(nw, sw)).toBeCloseTo(742.5, 0);
  });
  it("回転なしなら北が上・東が右", () => {
    expect(nw[0]).toBeGreaterThan(sw[0]);
    expect(ne[1]).toBeGreaterThan(nw[1]);
    expect(nw[0]).toBeCloseTo(ne[0], 9);
  });
  it("回転しても大きさは変わらない", () => {
    const [a, b, , d] = frameCorners({ ...f, rotation: 30 }, DEFAULT_PAPER);
    expect(distanceM(a, b)).toBeCloseTo(1050, 0);
    expect(distanceM(a, d)).toBeCloseTo(742.5, 0);
  });
  it("中心は枠の中、遠くの点は枠の外", () => {
    expect(insideFrame(f.center, [nw, ne, se, sw])).toBe(true);
    expect(insideFrame([35.7, 139.76], [nw, ne, se, sw])).toBe(false);
  });
  it("画像の左上・右上・左下を枠の隅に対応させる", () => {
    const p = framePairs(f, DEFAULT_PAPER);
    expect(p.map((x) => x.img)).toEqual([[0, 0], [1, 0], [0, 1]]);
    expect(p[0].latlng).toEqual(nw);
  });
});
