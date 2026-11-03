import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Claude・国税庁のサイトにはつながず、呼び出し方と結果の扱いだけを確かめる
const { parse, findRatioPdf } = vi.hoisted(() => ({ parse: vi.fn(), findRatioPdf: vi.fn() }));
vi.mock("@/server/guard", () => ({ guardAi: vi.fn(async () => null) }));
vi.mock("@/server/claude", () => ({ MODEL: "test-model", getClient: () => ({ messages: { parse } }) }));
vi.mock("@/server/rosenkaIndex", async (orig) => ({ ...(await orig<typeof import("@/server/rosenkaIndex")>()), findRatioPdf }));

import { POST as ratio } from "@/app/api/rosenka/ratio/route";
import { POST as locate } from "@/app/api/rosenka/locate/route";

const PDF = "https://www.rosenka.nta.go.jp/main_r08/fukuoka/fukuoka/ratios/pdf/j16101rt.pdf";
const post = (body: unknown) => new Request("http://localhost/api/rosenka/ratio", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const row = (i: number) => ({ page: 2, town: `見本町${i}丁目`, area: "", leaseRatio: "60", residential: "路線", paddy: null, field: null, forest: null });

beforeEach(() => {
  parse.mockReset();
  findRatioPdf.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("評価倍率表の読み取り", () => {
  it("日本の外の地点は受け付けない", async () => {
    const res = await ratio(post({ lat: 10, lng: 130 }));
    expect(res.status).toBe(400);
    expect(findRatioPdf).not.toHaveBeenCalled();
  });

  it("評価倍率表が見つからなければ、Claude に聞かずに案内を返す", async () => {
    findRatioPdf.mockResolvedValue({ pref: "福岡県", city: "見本村", town: "大字見本", pdfUrl: null, message: "この市区町村の評価倍率表が見つかりませんでした。" });
    const res = await ratio(post({ lat: 33.5, lng: 130.4 }));
    expect(await res.json()).toEqual({ pref: "福岡県", city: "見本村", town: "大字見本", pdfUrl: null, rows: [], notes: ["この市区町村の評価倍率表が見つかりませんでした。"] });
    expect(parse).not.toHaveBeenCalled();
  });

  it("PDF を文書として渡し、8行までにして、同じ町は覚えておく", async () => {
    findRatioPdf.mockResolvedValue({ pref: "福岡県", city: "福岡市博多区", town: "見本町四丁目", pdfUrl: PDF });
    const fetchMock = vi.fn<(url: string | URL) => Promise<Response>>(async () => new Response(Buffer.from("%PDF-1.4 見本"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: { rows: Array.from({ length: 10 }, (_, i) => row(i + 1)), notes: ["見本"] } });

    const body = await (await ratio(post({ lat: 33.59, lng: 130.42 }))).json();
    expect(body).toMatchObject({ pref: "福岡県", city: "福岡市博多区", town: "見本町四丁目", pdfUrl: PDF, notes: ["見本"] });
    expect(body.rows).toHaveLength(8);
    expect(String(fetchMock.mock.calls[0][0])).toBe(PDF);
    const req = parse.mock.calls[0][0];
    expect(req.output_config.effort).toBe("medium");
    expect(req.messages[0].content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(req.messages[0].content[1].text).toContain("見本町四丁目");

    // 表記ゆれ（4丁目）でも同じ町として覚えたものを使う
    findRatioPdf.mockResolvedValue({ pref: "福岡県", city: "福岡市博多区", town: "見本町4丁目", pdfUrl: PDF });
    const again = await (await ratio(post({ lat: 33.59, lng: 130.42 }))).json();
    expect(again.rows).toHaveLength(8);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("国税庁から PDF でないものが返ったら、Claude に渡さない", async () => {
    findRatioPdf.mockResolvedValue({ pref: "福岡県", city: "福岡市博多区", town: "別町", pdfUrl: PDF });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>お探しのページは見つかりません</html>", { status: 200 })));
    const res = await ratio(post({ lat: 33.59, lng: 130.42 }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/評価倍率表/);
    expect(parse).not.toHaveBeenCalled();
  });
});

/** 幅と高さだけ入った PNG の先頭部分（中身は見ないので画像としては不完全でよい） */
function png(w: number, h: number): File {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return new File([b], "x.png", { type: "image/png" });
}

function form(nos: string[]) {
  const f = new FormData();
  f.append("map", png(1200, 900));
  for (const no of nos) {
    f.append("sheet", png(2000, 1400));
    f.append("sheetNo", no);
    f.append("sheetSize", "1,1"); // 画像から読めるときは画像の大きさを使う
  }
  f.append("town", "見本町四丁目");
  return new Request("http://localhost/api/rosenka/locate", { method: "POST", body: f });
}

describe("地図と路線価図の位置合わせ", () => {
  const answer = {
    sheetNo: "9079",
    confidence: "medium",
    landOnSheet: { x: 900, y: 600 },
    points: [
      { map: { x: 100, y: 120 }, sheet: { x: 300, y: 200 }, what: "交差点" },
      { map: { x: 1100, y: 800 }, sheet: { x: 1800, y: 1300 }, what: "道路の角" },
      { map: { x: 5000, y: 10 }, sheet: { x: 10, y: 10 }, what: "地図の外" },
    ],
    reason: "道路の形が同じです。",
  };

  it("画像の大きさを伝え、図番号を渡した番号に合わせ、画像の外の点を除く", async () => {
    parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: answer });
    const body = await (await locate(form(["09073", "09079"]))).json();
    expect(body.sheetNo).toBe("09079");
    expect(body.landOnSheet).toEqual({ x: 900, y: 600 });
    expect(body.points.map((p: { what: string }) => p.what)).toEqual(["交差点", "道路の角"]);
    const req = parse.mock.calls[0][0];
    expect(req.output_config.effort).toBe("high");
    const texts = req.messages[0].content.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text);
    expect(texts[0]).toContain("幅1200×高さ900");
    expect(texts[2]).toContain("09079");
    expect(texts[2]).toContain("幅2000×高さ1400");
    expect(texts.at(-1)).toContain("見本町四丁目");
    expect(req.messages[0].content.filter((c: { type: string }) => c.type === "image")).toHaveLength(3);
  });

  it("渡していない図番号が返ったら、図なしとして目印も返さない", async () => {
    parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: { ...answer, sheetNo: "12345" } });
    const body = await (await locate(form(["09073"]))).json();
    expect(body).toMatchObject({ sheetNo: null, landOnSheet: null, points: [] });
  });

  it("図番号と画像の数が合わなければ受け付けない", async () => {
    const f = new FormData();
    f.append("map", png(10, 10));
    f.append("sheet", png(10, 10));
    f.append("sheet", png(10, 10));
    f.append("sheetNo", "09073");
    const res = await locate(new Request("http://localhost/api/rosenka/locate", { method: "POST", body: f }));
    expect(res.status).toBe(400);
    expect(parse).not.toHaveBeenCalled();
  });
});
