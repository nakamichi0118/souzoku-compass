/**
 * 手続きの期限日の計算。日付は "YYYY-MM-DD" の文字列で扱い、タイムゾーンの影響を受けないよう UTC で計算する。
 *
 * - 「〇日以内」（戸籍法の死亡届など）は、届出の起算日を1日目として数える（戸籍法43条1項）。
 * - 「〇か月以内」「〇年以内」は、起算日の翌日から数え、期間の末日は応当日（民法140条・143条）。
 *   応当日がない月（例：1月31日の1か月後）は、その月の末日。
 * - 期限が土曜・日曜にあたる場合は翌月曜日にずらす（民法142条、国税通則法10条2項）。
 *   祝日・年末年始は考慮しないため、画面で注意書きを出す。
 */
export type ISODate = string;

const parse = (d: ISODate) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export const isValidDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(parse(d).getTime()) && fmt(parse(d)) === d;

/** 起算日を1日目として n 日目の日付（n=7 なら起算日＋6日） */
export function withinDays(start: ISODate, n: number): ISODate {
  const d = parse(start);
  d.setUTCDate(d.getUTCDate() + n - 1);
  return fmt(d);
}

/** 単純に日数を足す（法要の日付など） */
export function addDays(start: ISODate, n: number): ISODate {
  const d = parse(start);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

/** n か月後の応当日（応当日がなければ月末） */
export function addMonths(start: ISODate, n: number): ISODate {
  const d = parse(start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))));
}

export const addYears = (start: ISODate, n: number) => addMonths(start, n * 12);

/** 土日なら翌月曜日にずらす */
export function skipWeekend(date: ISODate): ISODate {
  const d = parse(date);
  const w = d.getUTCDay();
  if (w === 6) d.setUTCDate(d.getUTCDate() + 2);
  if (w === 0) d.setUTCDate(d.getUTCDate() + 1);
  return fmt(d);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

/** 2026年11月6日（金） */
export function jpDate(date: ISODate): string {
  const d = parse(date);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}）`;
}

export const yearOf = (date: ISODate) => parse(date).getUTCFullYear();
export const monthOf = (date: ISODate) => parse(date).getUTCMonth() + 1;
