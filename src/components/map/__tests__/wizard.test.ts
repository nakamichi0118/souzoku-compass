import { describe, expect, it } from "vitest";
import type { Frontage } from "@/domain/geo/polygon";
import type { LandMethod } from "@/domain/types";
import {
  EMPTY_NOTES,
  FINE_MAX,
  FINE_MIN,
  candidatesFor,
  fineBase,
  frontageContext,
  fromTouch,
  keyOf,
  mergeReadings,
  nearestScale,
  needsRead,
  noteFor,
  notesFromSaved,
  readingContext,
  savedRoute,
  typeNote,
} from "../wizard";

const fr = (edges: number[], outside: [number, number]) => ({ edges, outside, roadIndex: 0, bearing: 0, frontage: 10, depthRect: 15 }) as Frontage;
const cand = (notation: string) => ({ notation, where: "土地の前の道路", distanceToMarker: "すぐ近く" });
const base = { property: [33.59, 130.42] as [number, number], sheetId: "https://www.rosenka.nta.go.jp/a.pdf", page: 1, pairs: [], frame: { center: [33.59, 130.42] as [number, number], scale: 1500, rotation: 0 } };

describe("路線価を読む条件", () => {
  it("場所・図・ページ・重ね方のどれかが変わると、条件も変わる", () => {
    const c0 = readingContext(base);
    expect(readingContext({ ...base })).toBe(c0);
    expect(readingContext({ ...base, property: [33.6, 130.42] })).not.toBe(c0);
    expect(readingContext({ ...base, sheetId: "https://www.rosenka.nta.go.jp/b.pdf" })).not.toBe(c0);
    expect(readingContext({ ...base, page: 2 })).not.toBe(c0);
    expect(readingContext({ ...base, frame: { ...base.frame, scale: 1600 } })).not.toBe(c0);
  });

  it("基準点が2つ以上あれば、枠ではなく基準点で決まる", () => {
    const pairs = [
      { img: [0.1, 0.1] as [number, number], latlng: [33.59, 130.42] as [number, number] },
      { img: [0.9, 0.9] as [number, number], latlng: [33.58, 130.43] as [number, number] },
    ];
    const c = readingContext({ ...base, pairs });
    expect(readingContext({ ...base, pairs, frame: null })).toBe(c);
    expect(readingContext({ ...base, pairs: pairs.slice(0, 1) })).toBe(readingContext(base));
  });

  it("同じ辺の番号でも、読み取りに使う道路の上の点が動けば別の条件になる", () => {
    const c = readingContext(base);
    expect(frontageContext(c, fr([0], [33.59, 130.42]))).not.toBe(frontageContext(c, fr([0], [33.5905, 130.42])));
  });
});

describe("路線価の欄", () => {
  const c1 = frontageContext(readingContext(base), fr([0], [33.59, 130.42]));
  const c2 = frontageContext(readingContext({ ...base, frame: { ...base.frame, rotation: 3 } }), fr([0], [33.59, 130.42]));

  it("前の条件で読んだ路線価は出さず、読み直す（重なりを直したあと・別の図を選んだあと）", () => {
    const n = mergeReadings(EMPTY_NOTES, [{ key: "0", ctx: c1, candidates: [cand("300D")] }], false);
    expect(noteFor(n, "0", c1)).toBe("300D");
    expect(needsRead(n, "0", c1)).toBe(false);
    expect(noteFor(n, "0", c2)).toBe("");
    expect(candidatesFor(n, "0", c2)).toBeUndefined();
    expect(needsRead(n, "0", c2)).toBe(true);
    const again = mergeReadings(n, [{ key: "0", ctx: c2, candidates: [cand("420D")] }], false);
    expect(noteFor(again, "0", c2)).toBe("420D");
  });

  it("図の外で読めなかった道路は、読んだことにしない", () => {
    // 読み取れなかった道路は結果に入れないので、次にまた読む
    const n = mergeReadings(EMPTY_NOTES, [], false);
    expect(needsRead(n, "0", c1)).toBe(true);
  });

  it("本人が入れた路線価は、自動の読み取りで上書きしない（条件が変わっても残す）", () => {
    let n = mergeReadings(EMPTY_NOTES, [{ key: "0", ctx: c1, candidates: [cand("420D")] }], false);
    n = typeNote(n, "0", "410D");
    expect(noteFor(n, "0", c2)).toBe("410D");
    n = mergeReadings(n, [{ key: "0", ctx: c2, candidates: [cand("420D")] }], false);
    expect(noteFor(n, "0", c2)).toBe("410D");
    expect(candidatesFor(n, "0", c2)?.map((c) => c.notation)).toEqual(["420D"]);
  });

  it("本人が読み直しを頼んだときは、読み取った路線価に置き換える（読めなければそのまま）", () => {
    let n = typeNote(EMPTY_NOTES, "0", "410D");
    n = mergeReadings(n, [{ key: "0", ctx: c1, candidates: [cand("読めない")] }], true);
    expect(noteFor(n, "0", c1)).toBe("410D");
    n = mergeReadings(n, [{ key: "0", ctx: c1, candidates: [cand("420D")] }], true);
    expect(noteFor(n, "0", c1)).toBe("420D");
    expect(n.mine["0"]).toBeUndefined();
  });

  it("読み取りの結果は、読んでいる間に入れた別の道路の路線価を消さない", () => {
    const start = EMPTY_NOTES;
    const typedMeanwhile = typeNote(start, "1", "300C");
    const merged = mergeReadings(typedMeanwhile, [{ key: "0", ctx: c1, candidates: [cand("420D")] }], false);
    expect(merged.text).toEqual({ "0": "420D", "1": "300C" });
  });

  it("前の読み取りで路線価が見つからなかったときは、古い路線価を残さない", () => {
    let n = mergeReadings(EMPTY_NOTES, [{ key: "0", ctx: c1, candidates: [cand("300D")] }], false);
    n = mergeReadings(n, [{ key: "0", ctx: c2, candidates: [] }], false);
    expect(noteFor(n, "0", c2)).toBe("");
  });

  it("欄を空にすると、また読み取りの結果を入れられる", () => {
    let n = typeNote(EMPTY_NOTES, "0", "410D");
    n = typeNote(n, "0", " ");
    expect(n.mine["0"]).toBeUndefined();
  });
});

describe("評価を終えた土地を開き直したとき", () => {
  const ctx = readingContext(base);
  const front = fr([0], [33.59, 130.42]);
  const side = fr([1], [33.5902, 130.4203]);
  const dup = fr([3], [33.5901, 130.4199]);

  it("保存した路線価を辺の番号で道路に戻し、読み直さない", () => {
    const n = notesFromSaved(
      [
        { edge: 0, price: 410_000, depth: 15, notation: "410D" },
        { edge: 1, price: 300_000, depth: 10 },
      ],
      [front, side, dup],
      [0, 1, null],
      (f) => frontageContext(ctx, f),
    );
    expect(noteFor(n, keyOf(front), frontageContext(ctx, front))).toBe("410D");
    expect(noteFor(n, keyOf(side), frontageContext(ctx, side))).toBe("300");
    expect(needsRead(n, keyOf(front), frontageContext(ctx, front))).toBe(false);
    // 計算に入れていない道路は、保存した路線価がないので読む
    expect(needsRead(n, keyOf(dup), frontageContext(ctx, dup))).toBe(true);
    // 本人が確かめたものなので、自動の読み取りでは上書きしない
    const after = mergeReadings(n, [{ key: keyOf(front), ctx: "別の条件", candidates: [cand("420D")] }], false);
    expect(after.text[keyOf(front)]).toBe("410D");
  });
});

describe("路線価地域か倍率地域か（保存してある評価の方法から）", () => {
  const rosenka = (m: Partial<Extract<LandMethod, { type: "rosenka" }>>): LandMethod => ({ type: "rosenka", routePrice: 0, depthCorrection: 1, ...m });
  it("書類から読んだだけの仮の方法なら、決めない（場所から調べる）", () => {
    expect(savedRoute(rosenka({}))).toBeNull();
    expect(savedRoute({ type: "multiplier", fixedAssetValue: 48_000_000, multiplier: 0 })).toBeNull();
    expect(savedRoute({ type: "manual", value: 1 })).toBeNull();
  });
  it("路線価・道路・形・倍率が入っていれば、その方法で決まっている", () => {
    expect(savedRoute(rosenka({ routePrice: 420_000 }))).toBe("rosenka");
    expect(savedRoute(rosenka({ roads: [{ edge: 0, price: 420_000, depth: 13 }] }))).toBe("rosenka");
    expect(savedRoute(rosenka({ shape: [[35, 139], [35.0001, 139], [35.0001, 139.0001]] }))).toBe("rosenka");
    expect(savedRoute({ type: "multiplier", fixedAssetValue: 0, multiplier: 1.1 })).toBe("ratio");
  });
});

describe("縮尺の微調整", () => {
  /** つまみを v まで動かしたときの縮尺（画面と同じ計算） */
  const drag = (picked: number | null, scale: number, vs: number[]) => {
    let p = picked;
    let sc = scale;
    for (const v of vs) {
      const b = fineBase(p, sc);
      p = b;
      sc = Math.round(b * v);
    }
    return { picked: p, scale: sc };
  };

  it("基準の縮尺の真ん中を越えても、基準が変わって縮尺が飛ばない", () => {
    // 1/2,000 から 0.87 倍（1/1,740）まで動かしても、基準は 1/2,000 のまま
    expect(drag(2000, 2000, [0.9, 0.87, 0.865])).toEqual({ picked: 2000, scale: 1730 });
  });

  it("端まで動かしても、基準の 0.8〜1.25 倍の中にとどまる", () => {
    const up = drag(null, 1500, [1.17, 1.18, 1.19, 1.2, 1.21, 1.25, 1.25]);
    expect(up.scale).toBe(1875);
    const down = drag(null, 1500, [0.85, 0.83, 0.82, 0.8, 0.8]);
    expect(down.scale).toBe(1200);
  });

  it("幅の外の新しい枠が来たら、いちばん近い縮尺を基準にする", () => {
    expect(fineBase(2000, 1760)).toBe(2000);
    expect(fineBase(1500, 2600)).toBe(nearestScale(2600));
    expect(fineBase(null, 1760)).toBe(2000);
    expect(1500 * FINE_MIN).toBe(1200);
    expect(1500 * FINE_MAX).toBe(1875);
  });
});

describe("指の長押しを見分ける", () => {
  it("Leaflet が長押しで出す右クリックの代わりの操作や、指・ペンの操作は、指の操作とみなす", () => {
    expect(fromTouch({ _simulated: true })).toBe(true);
    expect(fromTouch({ pointerType: "touch" })).toBe(true);
    expect(fromTouch({ pointerType: "pen" })).toBe(true);
    expect(fromTouch({ sourceCapabilities: { firesTouchEvents: true } })).toBe(true);
  });
  it("マウスの右クリックは、指の操作ではない", () => {
    expect(fromTouch({ pointerType: "mouse" })).toBe(false);
    expect(fromTouch({ sourceCapabilities: { firesTouchEvents: false } })).toBe(false);
    expect(fromTouch({})).toBe(false);
    expect(fromTouch(undefined)).toBe(false);
  });
});
