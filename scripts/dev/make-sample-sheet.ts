/**
 * デモ用の「架空の路線価図」PDFを作る（実在の路線価図ではありません）。
 * 道路の線と路線価の表記（例：420D）だけを描いた、操作確認用のサンプルです。
 */
import fs from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";

async function main() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync("assets/fonts/ipag.ttf"), { subset: true });
  const page = doc.addPage([842, 595]); // A4 横
  const ink = rgb(0.1, 0.1, 0.1);
  page.drawText("【デモ用・架空】路線価図サンプル　架空町一丁目", { x: 30, y: 560, size: 16, font, color: ink });
  page.drawText("※実在の地域・路線価ではありません。操作確認用のサンプルです。", { x: 30, y: 540, size: 10, font, color: rgb(0.7, 0, 0) });
  // 道路（縦3本・横3本）
  const xs = [140, 420, 700];
  const ys = [120, 300, 480];
  for (const x of xs) page.drawRectangle({ x: x - 8, y: 60, width: 16, height: 470, borderColor: ink, borderWidth: 1 });
  for (const y of ys) page.drawRectangle({ x: 60, y: y - 8, width: 720, height: 16, borderColor: ink, borderWidth: 1 });
  // 交差点の番号（位置合わせの目印）
  let n = 1;
  for (const y of ys) for (const x of xs) page.drawText(String(n++), { x: x - 3, y: y - 4, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  // 路線価
  const labels: [string, number, number][] = [
    ["420D", 270, 312],
    ["400D", 560, 312],
    ["380D", 270, 132],
    ["360D", 560, 132],
    ["450C", 270, 492],
    ["470C", 560, 492],
    ["410D", 150, 200],
    ["430D", 430, 200],
    ["390D", 710, 200],
    ["415D", 430, 390],
  ];
  for (const [t, x, y] of labels) page.drawText(t, { x, y, size: 13, font, color: ink });
  // 街区番号
  page.drawText("2", { x: 280, y: 220, size: 20, font, color: rgb(0.5, 0.5, 0.5) });
  page.drawText("3", { x: 560, y: 220, size: 20, font, color: rgb(0.5, 0.5, 0.5) });
  fs.writeFileSync("public/demo/rosenka-sample.pdf", await doc.save());
}
main();
