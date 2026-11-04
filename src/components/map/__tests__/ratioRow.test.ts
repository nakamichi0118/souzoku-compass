import fs from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { type TextBox, findRowBox, fromPdfText, normText, toLines } from "../ratioRow";

/** 1行ぶんの文字（左上が原点の割合） */
const cell = (str: string, left: number, top: number, w = 0.08, h = 0.012): TextBox => ({ str, left, top, right: left + w, bottom: top + h });
/** 評価倍率表のような表：町名・適用地域・借地権割合・宅地の倍率が横に並ぶ */
const table: TextBox[] = [
  cell("音順", 0.05, 0.05), cell("町（丁目）又は大字名", 0.1, 0.05), cell("適用地域名", 0.3, 0.05), cell("宅地", 0.6, 0.05),
  cell("ひ", 0.05, 0.1), cell("東", 0.1, 0.1), cell("全域", 0.3, 0.1), cell("50", 0.5, 0.1), cell("1.4", 0.6, 0.1),
  cell("東町", 0.1, 0.13), cell("全域", 0.3, 0.13), cell("60", 0.5, 0.13), cell("路線", 0.6, 0.13),
  cell("長門石町", 0.1, 0.16), cell("市街化区域", 0.3, 0.16), cell("60", 0.5, 0.16), cell("路線", 0.6, 0.16),
  // 町名の欄は1回だけ書かれ、次の行は適用地域だけ
  cell("市街化調整区域", 0.3, 0.19), cell("50", 0.5, 0.19), cell("1.4", 0.6, 0.19),
  cell("以東の地域", 0.3, 0.22), cell("1.1", 0.6, 0.22),
];

describe("評価倍率表のページで選んだ行を探す", () => {
  it("文字のそろえ方：全角・半角、空白、ヶ・ケ・が、先頭の大字", () => {
    expect(normText("大字 霞ヶ関 ４丁目")).toBe("霞ケ関4丁目");
    expect(normText("霞が関")).toBe(normText("霞ケ関"));
  });

  it("同じ高さの文字を1行にまとめる", () => {
    const lines = toLines(table);
    expect(lines).toHaveLength(6);
    expect(lines[1].map((x) => x.str)).toEqual(["ひ", "東", "全域", "50", "1.4"]);
  });

  it("町名と適用地域が同じ行の帯を返す（上下に少し余白）", () => {
    const b = findRowBox(table, { town: "長門石町", area: "市街化区域", residential: "路線" })!;
    expect(b.top).toBeLessThan(0.16);
    expect(b.top).toBeGreaterThan(0.15);
    expect(b.bottom).toBeGreaterThan(0.172);
    expect(b.bottom).toBeLessThan(0.18);
    expect(b.left).toBeLessThan(0.1);
    expect(b.right).toBeGreaterThan(0.68);
  });

  it("「東」のような短い町名は、欄の文字と同じ行だけ（「東町」「以東の地域」には当てない）", () => {
    const b = findRowBox(table, { town: "東", area: "全域", residential: "1.4", leaseRatio: "50" })!;
    expect(b.top).toBeGreaterThan(0.09);
    expect(b.bottom).toBeLessThan(0.12);
  });

  it("町名が1回だけ書かれた表では、適用地域の行を選ぶ", () => {
    const b = findRowBox(table, { town: "長門石町", area: "市街化調整区域", residential: "1.4" })!;
    expect(b.top).toBeGreaterThan(0.18);
    expect(b.bottom).toBeLessThan(0.21);
  });

  it("当たる行がなければ null（推測で枠を出さない）", () => {
    expect(findRowBox(table, { town: "西町", area: "全域" })).toBeNull();
    expect(findRowBox(table, { town: "", area: "全域" })).toBeNull();
    expect(findRowBox([], { town: "東", area: "" })).toBeNull();
  });
});

describe("PDF の文字の位置を、左上が原点の割合に直す", () => {
  it("回転していないページ：PDF の左下原点から、左上原点へ", () => {
    // 幅 800・高さ 600 のページの、左から 100・下から 500 に、幅 80・高さ 10 の文字
    const [b] = fromPdfText([{ str: "東", transform: [10, 0, 0, 10, 100, 500], width: 80, height: 10 }], (x, y) => [x, 600 - y], 800, 600);
    expect(b.left).toBeCloseTo(0.125);
    expect(b.right).toBeCloseTo(0.225);
    expect(b.top).toBeCloseTo(90 / 600);
    expect(b.bottom).toBeCloseTo(100 / 600);
  });

  it("実際の PDF（pdf-lib で作ったもの）を PDF.js で読んでも、書いた位置に枠が来る。90度回したページでもページの中に収まる", async () => {
    const font = await fs.readFile(path.join(process.cwd(), "assets/fonts/ipag.ttf"));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    for (const rotate of [0, 90]) {
      const doc = await PDFDocument.create();
      doc.registerFontkit(fontkit);
      const f = await doc.embedFont(font, { subset: true });
      const page = doc.addPage([842, 595]);
      if (rotate) page.setRotation(degrees(rotate));
      const rows: [string, string, string, number][] = [
        ["東町", "全域", "路線", 500],
        ["東", "全域", "1.4", 470],
        ["長門石町", "市街化調整区域", "1.4", 440],
      ];
      for (const [town, area, res, y] of rows) {
        page.drawText(town, { x: 80, y, size: 10, font: f });
        page.drawText(area, { x: 240, y, size: 10, font: f });
        page.drawText(res, { x: 520, y, size: 10, font: f });
      }
      const bytes = await doc.save();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true }).promise;
      const p = await pdf.getPage(1);
      const vp = p.getViewport({ scale: 1 });
      const content = await p.getTextContent();
      const items = content.items.filter((x): x is Extract<typeof x, { str: string }> => "str" in x);
      const box = findRowBox(fromPdfText(items, (x, y) => vp.convertToViewportPoint(x, y), vp.width, vp.height), { town: "東", area: "全域", residential: "1.4" })!;
      expect(box, `rotate ${rotate}`).not.toBeNull();
      if (rotate === 0) {
        // 下から 470pt の行：上からの割合は (595 - 470) / 595 のあたり
        expect(box.bottom).toBeGreaterThan((595 - 472) / 595);
        expect(box.top).toBeLessThan((595 - 478) / 595);
        expect(box.left).toBeLessThan(80 / 842);
        expect(box.right).toBeGreaterThan(530 / 842);
      } else {
        // 90度回したページは縦長に表示される。枠はページの中に収まる（少なくとも町名の欄に当たる）
        expect(vp.width).toBeCloseTo(595);
        for (const v of [box.left, box.top, box.right, box.bottom]) expect(v >= 0 && v <= 1).toBe(true);
        expect(box.right).toBeGreaterThan(box.left);
        expect(box.bottom).toBeGreaterThan(box.top);
      }
    }
  });
});
