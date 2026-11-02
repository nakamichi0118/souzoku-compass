/**
 * 国税庁様式（令和8年分）のページ画像に値を重ね書きしてPDFを作る。
 * 欄の位置は scripts/forms/calibrate.py が生成した layout.json に従う。
 */
import fs from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFImage, rgb } from "pdf-lib";
import layoutJson from "./r08/layout.json";

export interface FieldBox {
  x: number;
  y: number;
  w: number;
  h: number;
  align: "left" | "right" | "center";
  size: number;
  lines?: number;
}
type Layout = Record<string, { title: string; fields: Record<string, FieldBox> }>;
export const layout = layoutJson as unknown as Layout;

export type PageKey = keyof typeof layoutJson;
export interface PageFill {
  page: PageKey;
  values: Record<string, string | number | undefined | null>;
}

const A4 = { w: 595.22, h: 842 };
const ROOT = process.cwd();

let fontBytes: Uint8Array | undefined;
export async function loadFont() {
  fontBytes ??= await fs.readFile(path.join(ROOT, "assets/fonts/ipag.ttf"));
  return fontBytes;
}

export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const ch of text) {
    // 句読点・閉じ括弧は行頭に置かない（ぶら下げ）
    if (font.widthOfTextAtSize(line + ch, size) > width && line && !"、。，．）」』".includes(ch)) {
      out.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) out.push(line);
  return out;
}

function drawField(page: ReturnType<PDFDocument["addPage"]>, font: PDFFont, box: FieldBox, raw: string) {
  // 1桁用の狭い欄では余白を詰める
  const pad = Math.min(box.align === "right" ? 1.5 : 3, box.w * 0.08);
  const innerW = box.w - pad * 2;
  let size = box.size;
  const maxLines = box.lines ?? 1;
  let lines = maxLines > 1 ? wrap(font, raw, size, innerW) : [raw];
  // 欄に収まるまで文字を小さくする
  while (size > 5) {
    const tooWide = lines.some((l) => font.widthOfTextAtSize(l, size) > innerW);
    const tooTall = lines.length * size * 1.15 > box.h - 2;
    if (!tooWide && !tooTall && lines.length <= maxLines) break;
    size -= 0.5;
    lines = maxLines > 1 ? wrap(font, raw, size, innerW) : [raw];
  }
  const lineH = size * 1.15;
  const blockH = lines.length * lineH;
  let y = box.y + (box.h + blockH) / 2 - size * 0.95;
  for (const l of lines) {
    const tw = font.widthOfTextAtSize(l, size);
    const x =
      box.align === "right" ? box.x + box.w - pad - tw : box.align === "center" ? box.x + (box.w - tw) / 2 : box.x + pad;
    page.drawText(l, { x, y, size, font, color: rgb(0.05, 0.1, 0.35) });
    y -= lineH;
  }
}

export async function renderForms(fills: PageFill[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle("相続税の申告書（令和8年分用）");
  doc.setCreator("相続コンパス");
  doc.setSubject("国税庁 相続税の申告書等の様式（令和8年分用）に記入したもの");
  const font = await doc.embedFont(await loadFont(), { subset: true });
  const images = new Map<string, PDFImage>();
  for (const fill of fills) {
    const def = layout[fill.page];
    if (!def) throw new Error(`unknown page ${fill.page}`);
    let img = images.get(fill.page);
    if (!img) {
      img = await doc.embedPng(await fs.readFile(path.join(ROOT, `public/forms/r08/${fill.page}.png`)));
      images.set(fill.page, img);
    }
    const page = doc.addPage([A4.w, A4.h]);
    page.drawImage(img, { x: 0, y: 0, width: A4.w, height: A4.h });
    for (const [id, v] of Object.entries(fill.values)) {
      if (v === undefined || v === null || v === "") continue;
      const box = def.fields[id];
      if (!box) throw new Error(`unknown field ${fill.page}.${id}`);
      drawField(page, font, box, String(v));
    }
  }
  return doc.save();
}
