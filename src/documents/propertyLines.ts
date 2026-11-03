/**
 * 不動産の表示（登記簿の項目順）。登記申請書と遺産分割協議書で同じ記載にするための共通部品。
 */
import type { RegProperty } from "@/domain/registration";

/** blank は、まだ入っていない項目に入れる文字（申請書は手書きできるよう空欄、協議書は「登記事項証明書のとおり」） */
export function propertyLines(p: RegProperty, blank = ""): string[] {
  const v = (s: string) => s || blank;
  if (p.kind === "land") return [`所　　在　${v(p.location)}`, `地　　番　${v(p.lot)}`, `地　　目　${p.landUse}`, `地　　積　${p.area}`];
  if (p.kind === "building")
    return [`所　　在　${v(p.location)}`, `家屋番号　${v(p.houseNumber)}`, `種　　類　${v(p.type)}`, `構　　造　${v(p.structure)}`, `床 面 積　${v(p.floorArea)}`];
  return [
    "一棟の建物の表示",
    `　所　　在　${v(p.location)}`,
    ...(p.buildingName ? [`　建物の名称　${p.buildingName}`] : []),
    "専有部分の建物の表示",
    `　家屋番号　${v(p.houseNumber)}`,
    `　種　　類　${v(p.type)}`,
    `　構　　造　${v(p.structure)}`,
    `　床 面 積　${v(p.floorArea)}`,
    "敷地権の目的である土地の表示",
    `　${v(p.siteLand)}`,
    "敷地権の表示",
    `　${v(p.siteRight)}`,
  ];
}
