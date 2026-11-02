/** デモ用の「残高証明書」見本PDF（架空の銀行・架空の人物）を作る */
import fs from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { loadFont } from "../../src/forms/render";

async function main() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFont(), { subset: true });
  const page = doc.addPage([595.28, 841.89]);
  const ink = rgb(0.1, 0.1, 0.1);
  const t = (s: string, x: number, y: number, size = 11) => page.drawText(s, { x, y, size, font, color: ink });
  page.drawText("見本（架空のデータです）", { x: 150, y: 420, size: 40, font, color: rgb(0.9, 0.3, 0.3), opacity: 0.18, rotate: { type: "degrees", angle: 30 } as never });
  t("残 高 証 明 書", 225, 760, 22);
  t("相続 太郎 様（ご相続人 相続 一郎 様）", 60, 700, 12);
  t("令和8年4月10日", 420, 730);
  t("下記のとおり、令和8年3月15日現在の残高を証明いたします。", 60, 660);
  const rows: [string, string][] = [
    ["金融機関", "みほん銀行 架空支店"],
    ["預金種類", "普通預金"],
    ["口座番号", "1234567"],
    ["名義人", "相続 太郎"],
    ["残高", "38,250,000円"],
    ["既経過利息（税引後）", "1,234円"],
    ["基準日", "令和8年3月15日"],
  ];
  let y = 610;
  for (const [k, v] of rows) {
    page.drawRectangle({ x: 60, y: y - 8, width: 475, height: 30, borderColor: ink, borderWidth: 0.6 });
    page.drawLine({ start: { x: 220, y: y - 8 }, end: { x: 220, y: y + 22 }, thickness: 0.6, color: ink });
    t(k, 70, y + 2);
    t(v, 232, y + 2, 12);
    y -= 30;
  }
  t("上記の金額には、基準日までの既経過利息を含みません。", 60, y - 20, 10);
  t("株式会社みほん銀行 架空支店　支店長　見本 次郎", 260, y - 80);
  t("※このPDFは相続コンパスのデモ用に作った架空の書類です。実在の金融機関・人物とは関係ありません。", 60, 60, 8.5);
  fs.writeFileSync(process.argv[2] ?? "public/demo/zandaka-sample.pdf", await doc.save());
}
main();
