/** 遺産分割協議書を A4 縦の PDF にする */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { loadFont, wrap } from "@/forms/render";
import type { DivisionDoc } from "./division";

const W = 595.28;
const H = 841.89;
const M = { left: 62, right: 62, top: 70, bottom: 64 };
const INK = rgb(0.08, 0.08, 0.08);

class Writer {
  page!: PDFPage;
  y = 0;
  pageNo = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.pageNo++;
    this.y = H - M.top;
    this.page.drawText(`${this.pageNo}`, { x: W / 2 - 3, y: 32, size: 9, font: this.font, color: INK });
  }
  ensure(h: number) {
    if (this.y - h < M.bottom) this.newPage();
  }
  text(s: string, opt: { size?: number; indent?: number; gap?: number; center?: boolean } = {}) {
    const size = opt.size ?? 10.5;
    const indent = opt.indent ?? 0;
    const width = W - M.left - M.right - indent;
    for (const para of s.split("\n")) {
      const hang = para.match(/^[　\s]+/)?.[0].length ?? 0;
      for (const line of wrap(this.font, para, size, width)) {
        this.ensure(size * 1.7);
        const x = opt.center ? (W - this.font.widthOfTextAtSize(line, size)) / 2 : M.left + indent + (line === para.slice(0, line.length) ? 0 : hang * size);
        this.page.drawText(line, { x, y: this.y - size, size, font: this.font, color: INK });
        this.y -= size * 1.7;
      }
    }
    this.y -= opt.gap ?? 0;
  }
  line(x1: number, x2: number) {
    this.page.drawLine({ start: { x: x1, y: this.y }, end: { x: x2, y: this.y }, thickness: 0.6, color: INK });
  }
}

export async function renderDivision(d: DivisionDoc): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFont(), { subset: true });
  doc.setTitle(d.title);
  const w = new Writer(doc, font);

  w.text(d.title, { size: 20, center: true, gap: 18 });
  for (const l of d.decedent) w.text(l, { indent: 20 });
  w.y -= 12;
  w.text(d.preamble, { gap: 12 });
  for (const a of d.articles) {
    w.text(a.heading, { gap: 4 });
    for (const it of a.items) w.text(it, { indent: 22, gap: 4 });
    w.y -= 8;
  }
  w.text(d.closing, { gap: 18 });
  w.text("令和　　年　　月　　日", { indent: 20, gap: 18 });

  for (const s of d.signers) {
    const blockH = s.minor ? 150 : 100;
    w.ensure(blockH);
    w.text(`相続人${s.relation ? `（${s.relation}）` : ""}`, { size: 10, indent: 20, gap: 2 });
    w.text(`住所　${s.address}`, { indent: 40, gap: 10 });
    w.text("氏名", { indent: 40 });
    w.y += 4;
    w.line(M.left + 75, W - M.right - 40);
    w.page.drawText("実印", { x: W - M.right - 30, y: w.y + 2, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
    w.page.drawEllipse({ x: W - M.right - 22, y: w.y + 6, xScale: 14, yScale: 14, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.6 });
    w.y -= 6;
    w.text(`（${s.name}）`, { size: 8.5, indent: 75, gap: 6 });
    if (s.minor) {
      w.text("上記法定代理人（親権者）", { size: 10, indent: 40, gap: 2 });
      w.text("住所", { indent: 40, gap: 8 });
      w.text("氏名", { indent: 40 });
      w.y += 4;
      w.line(M.left + 75, W - M.right - 40);
      w.y -= 10;
    }
    w.y -= 14;
  }
  return doc.save();
}
