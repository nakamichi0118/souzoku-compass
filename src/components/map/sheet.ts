/** 路線価図（PDF・画像）をブラウザで画像にする */
import type { Sheet } from "./MapView";

const TARGET_WIDTH = 3000;

async function loadPdf(data: ArrayBuffer) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
}

/** PDF の1ページを高解像度の画像にする */
export async function renderPdfPage(data: ArrayBuffer, pageNo = 1, width = TARGET_WIDTH): Promise<Sheet & { pages: number }> {
  const pdf = await loadPdf(data);
  const page = await pdf.getPage(Math.min(Math.max(1, pageNo), pdf.numPages));
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const blob = await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b!), "image/png"));
  // PDF の 1pt = 1/72 インチ から用紙の大きさ（mm）を求める
  const paper = { widthMm: (base.width * 25.4) / 72, heightMm: (base.height * 25.4) / 72 };
  return { src: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, paper, pages: pdf.numPages };
}

export async function loadImage(file: Blob): Promise<Sheet> {
  const src = URL.createObjectURL(file);
  const img = new Image();
  img.src = src;
  await img.decode();
  return { src, width: img.naturalWidth, height: img.naturalHeight };
}

/** 土地の位置の周辺を切り出し、中心に赤い印を付けた PNG を作る（Claude の読み取り用） */
export async function cropAround(sheet: Sheet, at: [number, number], w = 900, h = 700): Promise<Blob> {
  const img = new Image();
  img.src = sheet.src;
  await img.decode();
  const cx = at[0] * sheet.width;
  const cy = at[1] * sheet.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h, 0, 0, w, h);
  ctx.strokeStyle = "#e11d48";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 16, 0, Math.PI * 2);
  ctx.stroke();
  return new Promise((ok) => canvas.toBlob((b) => ok(b!), "image/png"));
}

/** 路線価図を縮小し、線や文字の暗い画素からの距離の表を作る（自動位置合わせ用） */
export async function sheetField(sheet: Sheet, width = 1000) {
  const { distanceField } = await import("@/domain/geo/autoAlign");
  const img = new Image();
  img.src = sheet.src;
  await img.decode();
  const w = width;
  const h = Math.round((sheet.height * w) / sheet.width);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < dark.length; i++) dark[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11 < 150 ? 1 : 0;
  return { d: distanceField(dark, w, h), w, h };
}

/** 画像を長い辺が max 画素以内になるよう縮めた PNG にする（コンパスくんに送る用） */
export async function shrink(sheet: Sheet, max = 1600): Promise<{ blob: Blob; width: number; height: number }> {
  const img = new Image();
  img.src = sheet.src;
  await img.decode();
  const k = Math.min(1, max / Math.max(sheet.width, sheet.height));
  const width = Math.round(sheet.width * k);
  const height = Math.round(sheet.height * k);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b!), "image/png"));
  return { blob, width, height };
}
