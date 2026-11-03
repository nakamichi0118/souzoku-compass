/** 申告書への記入用の書式 */

/** 金額を3桁区切りにし、様式に印字済みの末尾（"000" ",000" "00" "000,000"）を取り除く */
export function yen(n: number | undefined, preprinted = ""): string {
  if (n === undefined || n === null) return "";
  const s = Math.trunc(n).toLocaleString("ja-JP");
  if (!preprinted) return s;
  if (n === 0) return ""; // 0円は空欄（印字済みの0だけが残る）
  if (!s.endsWith(preprinted)) {
    throw new Error(`金額 ${s} の末尾が印字済みの「${preprinted}」と一致しません（端数処理漏れ）`);
  }
  return s.slice(0, -preprinted.length);
}

/** 0 のときは空欄にする */
export const yenOrBlank = (n: number | undefined, preprinted = "") => (n ? yen(n, preprinted) : "");

const ERAS = [
  { code: "5", name: "令和", start: "2019-05-01" },
  { code: "4", name: "平成", start: "1989-01-08" },
  { code: "3", name: "昭和", start: "1926-12-25" },
  { code: "2", name: "大正", start: "1912-07-30" },
  { code: "1", name: "明治", start: "1868-10-23" },
];

/** 西暦日付を和暦に（様式の元号コード 1:明治 2:大正 3:昭和 4:平成 5:令和） */
export function wareki(iso: string | undefined) {
  if (!iso) return undefined;
  const era = ERAS.find((e) => iso >= e.start);
  if (!era) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  const ey = y - Number(era.start.slice(0, 4)) + 1;
  return { code: era.code, name: era.name, year: ey, month: m, day: d, text: `${era.name}${ey === 1 ? "元" : ey}年${m}月${d}日` };
}

export function ageAt(birth: string | undefined, at: string): number | undefined {
  if (!birth) return undefined;
  const [by, bm, bd] = birth.split("-").map(Number);
  const [y, m, d] = at.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  // 亡くなった後に生まれた子（胎児）は0歳とする
  return Math.max(0, age);
}
