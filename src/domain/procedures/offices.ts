/**
 * 提出先・請求先の種類。どの種類の窓口に行くかはルールで決め、
 * その住所を管轄する具体的な窓口（名称・所在地・電話番号）はコンパスくんが公式サイトで調べる。
 */
export type OfficeKind = "city" | "pension" | "taxOffice" | "legalAffairs" | "familyCourt" | "notary" | "metroTax";

export const OFFICE_LABEL: Record<OfficeKind, string> = {
  city: "市区町村役場",
  pension: "年金事務所",
  taxOffice: "税務署",
  legalAffairs: "法務局",
  familyCourt: "家庭裁判所",
  notary: "公証役場",
  metroTax: "都税事務所",
};

/** 住所から都道府県と市区町村を取り出す（政令市は区まで） */
export function cityOf(address: string): { pref: string; city: string } {
  const a = address.replace(/\s/g, "");
  const pref = a.match(/^(東京都|北海道|京都府|大阪府|.{2,3}県)/)?.[1] ?? "";
  const rest = a.slice(pref.length);
  const city = rest.match(/^(.+?市.+?区|.+?郡.+?[町村]|.+?[市区町村])/)?.[1] ?? "";
  return { pref, city };
}

/** 東京23区の固定資産税は都税事務所が扱う */
export const isTokyoWard = (address: string) => {
  const { pref, city } = cityOf(address);
  return pref === "東京都" && /区$/.test(city) && !/市/.test(city);
};
