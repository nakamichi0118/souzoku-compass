"use client";

/**
 * 税務署に出す書類一式のPDFを、この端末の中で作る（書類の画像はサーバーへ送らない）。
 * 表紙（書類の一覧）→ 申告書 → 戸籍 → … の順に重ねる。印鑑証明書は原本を出すので、PDFには「ここに原本」の紙を入れる。
 * 日本語の文字は、ブラウザの文字で canvas に描いて画像として入れる（PDFに日本語の字体を埋め込まずに済む）。
 */
import { PDFDocument } from "pdf-lib";
import type { DocFile } from "./docFiles";
import { docName, type SubmitItem } from "@/domain/filing/submission";

const A4 = { w: 595.28, h: 841.89 };

type Line = { text: string; size?: number; bold?: boolean; color?: string; gap?: number };

/** 文字だけのページを画像にする（A4・150dpi） */
async function textPage(lines: Line[]): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = 1240;
  c.height = 1754;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  let y = 140;
  const left = 110;
  const maxW = c.width - left * 2;
  for (const l of lines) {
    const size = l.size ?? 30;
    ctx.font = `${l.bold ? "bold " : ""}${size}px "Hiragino Sans","Yu Gothic","Noto Sans JP","Meiryo",sans-serif`;
    ctx.fillStyle = l.color ?? "#1c1917";
    // 長い行は折り返す
    let row = "";
    for (const ch of l.text) {
      if (ctx.measureText(row + ch).width > maxW) {
        ctx.fillText(row, left, y);
        y += size * 1.5;
        row = "";
      }
      row += ch;
    }
    ctx.fillText(row, left, y);
    y += size * 1.5 + (l.gap ?? 0);
  }
  const blob = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error("表紙を作れませんでした。"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

async function addImagePage(pdf: PDFDocument, bytes: Uint8Array, type: string) {
  const img = type === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const landscape = img.width > img.height;
  const pw = landscape ? A4.h : A4.w;
  const ph = landscape ? A4.w : A4.h;
  const m = 24;
  const s = Math.min((pw - m * 2) / img.width, (ph - m * 2) / img.height);
  const page = pdf.addPage([pw, ph]);
  page.drawImage(img, { x: (pw - img.width * s) / 2, y: (ph - img.height * s) / 2, width: img.width * s, height: img.height * s });
}

/** 1つのファイルを足し、足したページ数を返す（読めないPDFは飛ばして 0） */
async function addFile(pdf: PDFDocument, f: { load: () => Promise<Blob>; type: string }): Promise<number> {
  const bytes = new Uint8Array(await (await f.load()).arrayBuffer());
  if (f.type === "application/pdf") {
    try {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await pdf.copyPages(src, src.getPageIndices());
      pages.forEach((p) => pdf.addPage(p));
      return pages.length;
    } catch {
      return 0;
    }
  }
  if (f.type === "image/jpeg" || f.type === "image/png") {
    await addImagePage(pdf, bytes, f.type);
    return 1;
  }
  return 0;
}

export interface BundleInput {
  items: SubmitItem[];
  files: DocFile[];
  /** 申告書のPDF（作れないときは null） */
  forms: Blob | null;
  decedent: string;
  deathDate: string;
  office: string;
  inkanCount: number;
}

/** 欄ごとに入れるファイル（欄の書類の種類の順、同じ種類は入れた順） */
export const filesFor = (item: SubmitItem, files: DocFile[]) => item.docIds.flatMap((d) => files.filter((f) => f.docId === d));

export async function buildBundle(x: BundleInput): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("相続税の申告 提出書類");
  // 表紙のページ数を数えるため、先に中身を別のPDFに作ってから表紙を前に足す
  const body = await PDFDocument.create();
  const counts: Record<string, number> = {};
  for (const item of x.items) {
    let n = 0;
    if (item.generated === "forms") {
      if (x.forms) {
        const forms = x.forms;
        n = await addFile(body, { load: async () => forms, type: "application/pdf" });
      }
    } else if (item.original) {
      await addImagePage(
        body,
        await textPage([
          { text: item.label, size: 44, bold: true, gap: 30 },
          { text: `ここに原本（${x.inkanCount}通）を重ねてください。`, size: 34, bold: true, color: "#b45309", gap: 16 },
          { text: "印鑑証明書はコピーではなく原本を出します。", size: 28 },
          { text: "遺産分割協議書に押した実印のものを、相続人全員の分そろえます。", size: 28 },
        ]),
        "image/png",
      );
      n = 0;
    } else if (item.selfOnly) {
      // マイナンバーの写しは預からないので、差し込む場所だけ示す
      await addImagePage(
        body,
        await textPage([
          { text: item.label, size: 44, bold: true, gap: 30 },
          { text: "ここに、ご自身で用意した写しを重ねてください。", size: 34, bold: true, color: "#b45309", gap: 16 },
          { text: "相続人それぞれのマイナンバーカードの表と裏の写し", size: 28 },
          { text: "（カードがなければ、通知カードと運転免許証などの写し）", size: 28 },
        ]),
        "image/png",
      );
      n = 0;
    } else {
      for (const f of filesFor(item, x.files)) n += await addFile(body, f);
    }
    counts[item.id] = n;
  }
  const lines: Line[] = [
    { text: "相続税の申告　提出書類", size: 46, bold: true, gap: 20 },
    { text: `亡くなった方：${x.decedent || "（未入力）"}${x.deathDate ? `（${x.deathDate}に死亡）` : ""}`, size: 28 },
    { text: `提出先：${x.office}`, size: 28, gap: 24 },
    { text: "印刷して、この順に重ねて出してください。", size: 30, bold: true, gap: 24 },
  ];
  x.items.forEach((item, i) => {
    const n = counts[item.id];
    const state = item.generated === "forms" ? (x.forms ? `${n}枚` : "別に印刷してください") : item.original ? "原本を同封" : item.selfOnly ? "ご自身で同封" : n > 0 ? `${n}枚` : item.optional ? "なし" : "まだありません";
    lines.push({ text: `□ ${i + 1}. ${item.label}　…　${state}`, size: 30, bold: true, color: !item.optional && !item.original && !item.selfOnly && n === 0 ? "#be123c" : "#1c1917" });
    if (item.note) lines.push({ text: `　　${item.note}`, size: 24, color: "#57534e", gap: 8 });
  });
  lines.push({ text: "", gap: 16 });
  lines.push({ text: "★ 印鑑証明書は原本が必要です（コピー不可）。", size: 28, bold: true, color: "#b45309" });
  lines.push({ text: "郵送するときは、申告書の控えと切手を貼った返信用封筒を同封すると、", size: 24, color: "#57534e" });
  lines.push({ text: "受付印を押した控えが戻ってきます。", size: 24, color: "#57534e" });
  await addImagePage(pdf, await textPage(lines), "image/png");
  const rest = await pdf.copyPages(body, body.getPageIndices());
  rest.forEach((p) => pdf.addPage(p));
  const out = await pdf.save();
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

/** 一覧に出す、欄に入っている書類の名前（「戸籍謄本 2枚」など） */
export function filesSummary(item: SubmitItem, files: DocFile[]): string {
  const parts = item.docIds.map((d) => [docName(d).replace(/（.*?）/g, ""), files.filter((f) => f.docId === d).length] as const).filter(([, n]) => n > 0);
  return parts.map(([name, n]) => `${name} ${n}枚`).join("、");
}
