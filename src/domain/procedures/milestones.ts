/**
 * カレンダーの「手続きごと」の表示に使う、期限（マイルストーン）ごとのまとまり。
 *
 * - 区切り（マイルストーン）は、亡くなった日・法律上の期限がある手続き（hard）・遺産分割協議（目安の区切り）
 * - それぞれの区切りの下に、前の区切りの翌日からその区切りの日までが日付の、ほかの手続きをまとめる。
 *   最後の区切りよりあとの手続きは「そのあと」にまとめる
 * - 同じ日の区切りは1つのまとまり（Stop）にし、その下の手続きは一度だけ出す
 * - 渡す手続きは、カレンダーに載せるもの（該当する場合だけの手続きを除いたもの）。
 *   「不要」にした手続きも渡し、グレーで残す（カレンダーから「不要」を戻せるように）
 */
import type { Task } from "./rules";
import { monthsDeadline, nextOpenDay, withinDays, yearsDeadline, type ISODate } from "./dates";

export type MilestoneKind = "start" | "deadline" | "aim";
/** 済んだ・不要にした・日付を過ぎた（済んでいない）・これから */
export type EntryState = "done" | "na" | "late" | "open";

export interface Milestone {
  /** 手続きの id（亡くなった日は "death"） */
  id: string;
  /** 短い名前（「死亡届」など） */
  name: string;
  date: ISODate;
  kind: MilestoneKind;
  /** 亡くなった日から数えた期間（「7日以内」「3か月」など）。決まった期間にあたらなければ出さない */
  period?: string;
  state: EntryState | "start";
  /** いちばん近い期限（済んでいない法律上の期限のうち、今日以降でいちばん早い日のもの） */
  next: boolean;
  task?: Task;
}

export interface Entry {
  task: Task;
  state: EntryState;
}

/** 同じ日の区切りと、その日までにする手続き */
export interface Stop {
  date: ISODate;
  milestones: Milestone[];
  /** 前の区切りの翌日からこの日までが日付の、ほかの手続き（日付の順） */
  tasks: Entry[];
}

export interface Timeline {
  stops: Stop[];
  /** 最後の区切りよりあとの手続き */
  after: Entry[];
  /**
   * 「今日」の印の位置：stops[todayAt] の前（今日がその日と同じでも前）。
   * stops.length なら最後の区切りのあと（「そのあと」の前）、stops.length + 1 なら「そのあと」の手続きもすべて過ぎたあと
   */
  todayAt: number;
}

/** 遺産分割協議は法律上の期限ではないが、相続税の申告に向けた目安の区切りにする */
const AIM_IDS = ["division"];

/**
 * 区切りの短い名前と、亡くなった日からの期間。期間は、日付から求めた候補が2つ以上あたるとき
 * （休日でずれて、7日以内と10日以内の期限が同じ日になるときなど）にだけ、どちらかを選ぶのに使う
 */
const KNOWN: Record<string, { name: string; periods?: string[] | ((t: Pick<Task, "title">) => string[]) }> = {
  "death-report": { name: "死亡届", periods: ["7日以内"] },
  // 国民年金だけなら14日以内、それ以外（厚生年金・遺族年金・分からない）は10日以内（種類は手続きの名前に出ている）
  "pension-stop": { name: "年金の停止", periods: (t) => [t.title.includes("国民年金") ? "14日以内" : "10日以内"] },
  "health-insurance": { name: "健康保険の手続き", periods: ["14日以内"] },
  "household-head": { name: "世帯主の変更", periods: ["14日以内"] },
  "business-close": { name: "廃業届", periods: ["1か月"] },
  renounce: { name: "相続放棄・限定承認", periods: ["3か月"] },
  "final-return": { name: "準確定申告", periods: ["4か月"] },
  division: { name: "遺産分割協議", periods: ["8か月", "10か月"] },
  "inheritance-tax": { name: "相続税の申告・納付", periods: ["10か月"] },
  registration: { name: "相続登記", periods: ["3年"] },
};

export const shortName = (t: Pick<Task, "id" | "title">) => KNOWN[t.id]?.name ?? t.title;

/** 亡くなった日から数える、よくある期間 */
const PERIODS: { label: string; date: (death: ISODate) => ISODate }[] = [
  ...[7, 10, 14].map((n) => ({ label: `${n}日以内`, date: (death: ISODate) => withinDays(death, n) })),
  ...[1, 2, 3, 4, 6, 8, 10].map((n) => ({ label: `${n}か月`, date: (death: ISODate) => monthsDeadline(death, n) })),
  ...[1, 2, 3, 5].map((n) => ({ label: `${n}年`, date: (death: ISODate) => yearsDeadline(death, n) })),
];

/**
 * その日が、亡くなった日から数えたよくある期間の日にあたれば、その期間（「3か月」など）。
 * shifted：法律上の期限のように、休日なら次の平日にずらした日と比べる。
 * あたる期間が2つ以上あるときは、手続きから分かる期間で選び、選べなければ出さない（違う期間を出さないため）
 */
export function periodLabel(death: ISODate, date: ISODate, shifted: boolean, task?: Pick<Task, "id" | "title">): string | undefined {
  const hits = PERIODS.filter((p) => (shifted ? nextOpenDay(p.date(death)) : p.date(death)) === date).map((p) => p.label);
  if (hits.length <= 1) return hits[0];
  if (!task) return undefined;
  const periods = KNOWN[task.id]?.periods ?? [];
  const expected = typeof periods === "function" ? periods(task) : periods;
  const known = hits.filter((h) => expected.includes(h));
  return known.length === 1 ? known[0] : undefined;
}

const byDate = <T extends { date: ISODate }>(xs: T[]) => xs.map((x, i) => [x, i] as const).sort(([a, i], [b, j]) => (a.date < b.date ? -1 : a.date > b.date ? 1 : i - j)).map(([x]) => x);

/** 手続きを、区切りごとのまとまりに分ける */
export function buildTimeline(tasks: Task[], opts: { death: ISODate; today: ISODate; done: string[]; na?: string[] }): Timeline {
  const { death, today, done, na = [] } = opts;
  const stateOf = (t: Task): EntryState => (done.includes(t.id) ? "done" : na.includes(t.id) ? "na" : t.date < today ? "late" : "open");
  const isMilestone = (t: Task) => t.hard || AIM_IDS.includes(t.id);
  const marks = byDate(tasks.filter(isMilestone));
  const nextDate = marks.find((t) => t.hard && stateOf(t) === "open")?.date;

  const start: Milestone = { id: "death", name: "亡くなった日", date: death, kind: "start", state: "start", next: false };
  const milestones: Milestone[] = [
    start,
    ...marks.map((t): Milestone => ({
      id: t.id,
      name: shortName(t),
      date: t.date,
      kind: t.hard ? "deadline" : "aim",
      period: periodLabel(death, t.date, t.hard, t),
      state: stateOf(t),
      next: t.hard && t.date === nextDate && stateOf(t) === "open",
      task: t,
    })),
  ];

  const stops: Stop[] = [];
  for (const m of milestones) {
    const last = stops.at(-1);
    if (last && last.date === m.date) last.milestones.push(m);
    else stops.push({ date: m.date, milestones: [m], tasks: [] });
  }
  const after: Entry[] = [];
  for (const t of byDate(tasks.filter((t) => !isMilestone(t)))) {
    // その手続きの日付と同じか、それよりあとのいちばん早い区切りに入れる
    const stop = stops.find((s) => t.date <= s.date);
    (stop ? stop.tasks : after).push({ task: t, state: stateOf(t) });
  }
  const at = stops.findIndex((s) => s.date >= today);
  // 区切りをすべて過ぎたときは、「そのあと」の手続きもすべて過ぎていれば、そのさらにあと
  const todayAt = at >= 0 ? at : after.length > 0 && after.every((e) => e.task.date < today) ? stops.length + 1 : stops.length;
  return { stops, after, todayAt };
}
