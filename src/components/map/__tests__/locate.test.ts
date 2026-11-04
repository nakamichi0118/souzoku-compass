import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Progress, progressValue } from "@/components/compass/ProgressBar";
import type { LatLng, Road } from "@/domain/geo/lot";

// ブラウザでしか動かない部分（地図の画像・PDF の描画・道路の線での位置合わせ）は差し替える
const log: string[] = [];
vi.mock("../capture", () => ({
  captureGsiMap: vi.fn(async () => {
    log.push("map:start");
    await new Promise((ok) => setTimeout(ok, 5));
    log.push("map:end");
    return { blob: new Blob(["map"], { type: "image/png" }), width: 1280, height: 960, toLatLng: (): LatLng => [35.68, 139.76] };
  }),
}));
let renders = 0;
vi.mock("../sheet", () => ({
  renderPdfPage: vi.fn(async (buf: ArrayBuffer) => {
    const no = new TextDecoder().decode(buf);
    log.push(`render:${no}:start`);
    // 先の候補ほど遅く描き終わる（それでもコンパスくんに見せる順は候補の順のまま）
    await new Promise((ok) => setTimeout(ok, no === "A" ? 30 : 10));
    log.push(`render:${no}:end`);
    renders++;
    return { src: `blob:sheet-${no}`, width: 1600, height: 1131, paper: { widthMm: 420, heightMm: 297 }, pages: 1 };
  }),
  sheetField: vi.fn(async () => ({})),
}));
vi.mock("@/domain/geo/autoAlign", () => ({ autoAlign: vi.fn(() => null) }));

const { locateSheet, LOCATE_PROGRESS } = await import("../locate");

const property: LatLng = [35.68, 139.76];
const roads: Road[] = [{ line: [property, [35.681, 139.761]] } as unknown as Road];
const candidates = [
  { no: "A", pdfUrl: "https://www.rosenka.nta.go.jp/A.pdf" },
  { no: "B", pdfUrl: "https://www.rosenka.nta.go.jp/B.pdf" },
];

let sentSheets: string[] = [];
let failSheet: string | null = null;
const revoked: string[] = [];

beforeEach(() => {
  log.length = 0;
  revoked.length = 0;
  sentSheets = [];
  failSheet = null;
  renders = 0;
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u: string) => void revoked.push(u));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input.startsWith("/api/rosenka/sheet")) {
        const no = decodeURIComponent(input).match(/\/(\w+)\.pdf$/)?.[1] ?? "";
        if (no === failSheet) return Response.json({ error: "路線価図を読み込めませんでした。" }, { status: 502 });
        return new Response(new TextEncoder().encode(no));
      }
      if (input.startsWith("blob:")) return new Response(new Blob(["png"], { type: "image/png" }));
      if (input === "/api/rosenka/locate") {
        log.push("ask");
        sentSheets = (init?.body as FormData).getAll("sheetNo") as string[];
        // 土地が図 B の真ん中にある（目印の組はなし）
        return Response.json({ sheetNo: "B", confidence: "high", landOnSheet: { x: 800, y: 565 }, points: [], reason: "町名と道路の形が一致" });
      }
      throw new Error(`unexpected fetch ${input}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("路線価図を探す間の進み具合", () => {
  it("読み込み（図と地図を1つずつ）→ コンパスくん → 道路の線で合わせる、の順に、途切れずに 0 から 1 まで進む", async () => {
    const steps: { msg: string; p: Progress }[] = [];
    const r = await locateSheet({ property, candidates, cache: new Map(), roads, onStep: (msg, p) => steps.push({ msg, p }) });
    expect(r.no).toBe("B");
    expect(r.frame).not.toBeNull();

    const msgs = steps.map((s) => s.msg);
    expect(msgs).toEqual([
      "候補の路線価図を国税庁のサイトから読み込んでいます",
      "候補の路線価図を国税庁のサイトから読み込んでいます",
      "候補の路線価図を国税庁のサイトから読み込んでいます",
      "土地が載っている路線価図を探しています",
      "道路の線に合わせて、重なりを細かく調整しています",
    ]);
    const ps = steps.map((s) => s.p);
    expect(ps[0].at).toBe(0);
    expect(ps[ps.length - 1].until).toBe(1);
    // 段階の終わり ＝ 次の段階の始まり。バーは戻らない
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i].at).toBeCloseTo(ps[i - 1].until, 12);
      expect(progressValue(ps[i - 1], 1e9)).toBeLessThan(ps[i].at);
    }
    // 読み込みは 1/4 まで。コンパスくんの段階がいちばん長い（目安 45 秒）
    expect(ps[3]).toMatchObject({ at: LOCATE_PROGRESS.LOADED, until: LOCATE_PROGRESS.ANSWERED, expectSec: 45 });
    expect(ps.every((p) => p.at >= 0 && p.until <= 1 && p.at < p.until)).toBe(true);
  });

  it("地図の画像は図の読み込みと同時に用意する。コンパスくんに見せる図の順は候補の順のまま", async () => {
    await locateSheet({ property, candidates, cache: new Map(), roads: [] });
    const firstRenderEnd = log.findIndex((x) => x.endsWith(":end") && x.startsWith("render"));
    expect(log.indexOf("map:start")).toBeLessThan(firstRenderEnd);
    // B が先に描き終わっても、送る順は A, B
    expect(log.indexOf("render:B:end")).toBeLessThan(log.indexOf("render:A:end"));
    expect(sentSheets).toEqual(["A", "B"]);
    expect(log.indexOf("ask")).toBeGreaterThan(log.indexOf("render:A:end"));
    expect(log.indexOf("ask")).toBeGreaterThan(log.indexOf("map:end"));
    // 選ばれなかった図の画像は捨てる
    expect(revoked).toContain("blob:sheet-A");
  });

  it("道路の線がなければ、合わせる段階は出さない", async () => {
    const msgs: string[] = [];
    await locateSheet({ property, candidates, cache: new Map(), roads: [], onStep: (m) => msgs.push(m) });
    expect(msgs.at(-1)).toBe("土地が載っている路線価図を探しています");
  });

  it("図が1枚でも読み込めなければやめる。ほかの図の描画が終わるのを待ってから、作った画像を捨てる", async () => {
    failSheet = "B";
    await expect(locateSheet({ property, candidates, cache: new Map(), roads })).rejects.toThrow("路線価図を読み込めませんでした。");
    expect(renders).toBe(1);
    expect(revoked).toEqual(["blob:sheet-A"]);
    expect(log).not.toContain("ask");
  });
});
