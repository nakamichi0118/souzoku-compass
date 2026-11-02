/** 相続登記の申請書（A4縦）。法務局の申請書の記載例と同じ項目順で作る */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { loadFont } from "@/forms/render";
import type { RegApplication, RegProperty } from "@/domain/registration";
import { Writer } from "./renderDivision";

const yen = (n: number) => `金${n.toLocaleString("ja-JP")}円`;

function propertyLines(p: RegProperty): string[] {
  if (p.kind === "land")
    return [`所　　在　${p.location}`, `地　　番　${p.lot || "（登記事項証明書のとおり）"}`, `地　　目　${p.landUse}`, `地　　積　${p.area}`];
  if (p.kind === "building")
    return [`所　　在　${p.location}`, `家屋番号　${p.houseNumber}`, `種　　類　${p.type}`, `構　　造　${p.structure}`, `床 面 積　${p.floorArea}`];
  return [
    "一棟の建物の表示",
    `　所　　在　${p.location}`,
    ...(p.buildingName ? [`　建物の名称　${p.buildingName}`] : []),
    "専有部分の建物の表示",
    `　家屋番号　${p.houseNumber}`,
    `　種　　類　${p.type}`,
    `　構　　造　${p.structure}`,
    `　床 面 積　${p.floorArea}`,
    "敷地権の目的である土地の表示",
    `　${p.siteLand}`,
    "敷地権の表示",
    `　${p.siteRight}`,
  ];
}

export async function renderRegistration(apps: RegApplication[], opts: { office?: string } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadFont(), { subset: true });
  doc.setTitle("登記申請書（相続）");
  apps.forEach((app) => {
    const w = new Writer(doc, font);
    w.text("登　記　申　請　書", { size: 20, center: true, gap: 16 });
    w.text("登記の目的　　所有権移転", { gap: 6 });
    w.text(`原　　　因　　${app.cause}`, { gap: 6 });
    w.text(`相　続　人　　（被相続人　${app.decedent}）`, { gap: 2 });
    for (const a of app.applicants) {
      w.text(`${a.share ? `持分${a.share}　` : ""}${a.address}`, { indent: 84 });
      w.text(`${a.name}`, { indent: 84 });
      w.text(`連絡先の電話番号　${a.phone || "　　　－　　　－　　　"}`, { indent: 84, gap: 6 });
    }
    w.text("添付情報", { gap: 2 });
    w.text("登記原因証明情報　　住所証明情報", { indent: 84, gap: 6 });
    w.text("□登記識別情報の通知を希望しません。", { gap: 8 });
    w.text(`令和　　年　　月　　日申請　　${opts.office ?? "　　　　　"}法務局　　　　　　（支局・出張所）`, { gap: 8 });
    w.text(`課税価格　　${yen(app.taxBase)}`, { gap: 2 });
    w.text(`登録免許税　${yen(app.tax)}`, { gap: 2 });
    if (app.exemptLots.length) w.text(`租税特別措置法第84条の2の3第2項により非課税（${app.exemptLots.join("、")}）`, { size: 9, indent: 10, gap: 2 });
    w.y -= 10;
    w.text("不動産の表示", { gap: 4 });
    app.properties.forEach((p) => {
      for (const l of propertyLines(p)) w.text(l, { indent: 20 });
      w.y -= 10;
    });
  });
  return doc.save();
}
