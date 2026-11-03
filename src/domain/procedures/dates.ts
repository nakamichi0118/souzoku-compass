/**
 * 手続きの期限日の計算。日付は "YYYY-MM-DD" の文字列で扱い、タイムゾーンの影響を受けないよう UTC で計算する。
 *
 * - 「〇日以内」（戸籍法の死亡届など）は、届出の起算日を1日目として数える（戸籍法43条1項）。
 * - 「〇か月以内」「〇年以内」は、起算日の翌日から数え、期間の末日はその応当日の前日（民法140条・143条）。
 *   応当日がない月（例：1月30日の1か月後）は、その月の末日。月末に亡くなった場合は、n か月後の月の末日
 *   （monthsDeadline）。
 * - 期限が土曜・日曜・国民の祝日・年末年始（12月29日〜1月3日）にあたる場合は、その翌日（休日が続けば
 *   その次の平日）にずらす（民法142条、国税通則法10条2項・同施行令2条2項）。
 *   祝日は「国民の祝日に関する法律」の定め（固定日・ハッピーマンデー・春分/秋分の日・振替休日・国民の休日）から計算する。
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

/** n か月後の同じ日（その日がなければ月末）。法要の日（一周忌など）に使う。法律上の期限には monthsDeadline を使う */
export function addMonths(start: ISODate, n: number): ISODate {
  const d = parse(start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))));
}

export const addYears = (start: ISODate, n: number) => addMonths(start, n * 12);

/**
 * 「〇か月以内」の期限の日（民法140条・143条）。起算日の翌日から数えて n か月目の応当日の前日で、
 * 応当日がなければその月の末日。
 * 月末に亡くなった場合は、翌日が翌月1日になるので、期限は n か月後の月の末日になる
 * （例：2月28日に亡くなった場合の10か月は12月28日ではなく12月31日）。それ以外は addMonths と同じ日になる。
 */
export function monthsDeadline(start: ISODate, n: number): ISODate {
  const d = parse(start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const monthEnd = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  if (d.getUTCDate() === monthEnd) return fmt(new Date(Date.UTC(y, m + n + 1, 0)));
  return addMonths(start, n);
}

/** 「〇年以内」の期限の日（monthsDeadline と同じ数え方） */
export const yearsDeadline = (start: ISODate, n: number) => monthsDeadline(start, n * 12);

/** 早いほうの日付 */
export const earlier = (a: ISODate, b: ISODate): ISODate => (a <= b ? a : b);

/** この端末の今日の日付（"YYYY-MM-DD"、端末の時刻で数える） */
export function todayISO(): ISODate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 春分日・秋分日（1980〜2099年に使われる計算式） */
const equinox = (y: number, base: number) => Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
/** その月の第n月曜日 */
const nthMonday = (y: number, m: number, n: number) => {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
};

/** 国民の祝日に関する法律2条の祝日（振替休日・国民の休日を除く） */
function baseHolidays(y: number): Set<string> {
  const p = (m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return new Set([
    p(1, 1),
    p(1, nthMonday(y, 1, 2)),
    p(2, 11),
    p(2, 23),
    p(3, equinox(y, 20.8431)),
    p(4, 29),
    p(5, 3),
    p(5, 4),
    p(5, 5),
    p(7, nthMonday(y, 7, 3)),
    p(8, 11),
    p(9, nthMonday(y, 9, 3)),
    p(9, equinox(y, 23.2488)),
    p(10, nthMonday(y, 10, 2)),
    p(11, 3),
    p(11, 23),
  ]);
}

const holidayCache = new Map<number, Set<string>>();
/** 振替休日（祝日が日曜なら次の平日）と国民の休日（祝日にはさまれた平日）を含めた祝日 */
export function holidaysOf(y: number): Set<string> {
  const hit = holidayCache.get(y);
  if (hit) return hit;
  const base = baseHolidays(y);
  const all = new Set(base);
  for (const h of base) {
    if (parse(h).getUTCDay() !== 0) continue;
    let d = addDays(h, 1);
    while (all.has(d)) d = addDays(d, 1);
    all.add(d);
  }
  for (const h of base) {
    const mid = addDays(h, 1);
    if (!all.has(mid) && base.has(addDays(h, 2)) && parse(mid).getUTCDay() !== 0) all.add(mid);
  }
  holidayCache.set(y, all);
  return all;
}

/** 役所・税務署が閉まっている日（土日・祝日・年末年始） */
export function isClosedDay(date: ISODate): boolean {
  const d = parse(date);
  const w = d.getUTCDay();
  const md = date.slice(5);
  return w === 0 || w === 6 || md >= "12-29" || md <= "01-03" || holidaysOf(d.getUTCFullYear()).has(date);
}

/** 期限が休みの日なら、次の開いている日にずらす */
export function nextOpenDay(date: ISODate): ISODate {
  let d = date;
  while (isClosedDay(d)) d = addDays(d, 1);
  return d;
}

/** 土日なら翌月曜日にずらす（祝日を考えない単純なずらし。期限には nextOpenDay を使う） */
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
