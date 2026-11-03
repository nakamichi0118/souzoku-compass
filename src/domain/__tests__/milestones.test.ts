import { describe, expect, it } from "vitest";
import { blankInterview, demoInterview, type Interview } from "../procedures/interview";
import { buildTimeline, periodLabel, shortName, type Timeline } from "../procedures/milestones";
import { buildTasks, type Task } from "../procedures/rules";

/** カレンダーに載せる手続き（overall.ts の live と同じ：該当する場合だけの手続きと「不要」にしたものを除く） */
const liveOf = (iv: Interview, na: string[] = []) => buildTasks(iv).tasks.filter((t) => !t.optional && !na.includes(t.id));
const demo = (p: Partial<Interview> = {}) => ({ ...demoInterview(), ...p });
const marks = (tl: Timeline) => tl.stops.flatMap((s) => s.milestones);
const ids = (tl: Timeline) => marks(tl).map((m) => m.id);
const groupOf = (tl: Timeline, id: string) => tl.stops.find((s) => s.tasks.some((e) => e.task.id === id))?.milestones[0].id ?? (tl.after.some((e) => e.task.id === id) ? "after" : undefined);

const task = (id: string, date: string, hard = false) => ({ id, date, title: `手続き${id}`, hard, optional: false }) as unknown as Task;

describe("手続きごとの区切り（デモの家族：2026年3月15日に亡くなった）", () => {
  const tl = buildTimeline(liveOf(demo()), { death: "2026-03-15", today: "2026-11-03", done: [] });

  it("亡くなった日・法律上の期限・遺産分割協議を、日付の順に区切りにする", () => {
    expect(marks(tl).map((m) => [m.name, m.date, m.kind, m.period])).toEqual([
      ["亡くなった日", "2026-03-15", "start", undefined],
      ["死亡届", "2026-03-23", "deadline", "7日以内"],
      ["年金の停止", "2026-03-24", "deadline", "10日以内"],
      ["健康保険の手続き", "2026-03-30", "deadline", "14日以内"],
      ["相続放棄・限定承認", "2026-06-15", "deadline", "3か月"],
      ["遺産分割協議", "2026-11-15", "aim", "8か月"],
      ["相続税の申告・納付", "2027-01-15", "deadline", "10か月"],
      ["相続登記", "2029-03-15", "deadline", "3年"],
    ]);
  });

  it("準確定申告が必要ない家族には、準確定申告の区切りを出さない（還付を受ける場合だけの手続きはカレンダーに載せない）", () => {
    expect(ids(tl)).not.toContain("final-return");
    expect(groupOf(tl, "final-return")).toBeUndefined();
  });

  it("準確定申告が必要な家族（個人事業）には、4か月の区切りと廃業届の1か月の区切りを出す", () => {
    const self = buildTimeline(liveOf(demo({ work: "selfEmployed" })), { death: "2026-03-15", today: "2026-11-03", done: [] });
    const m = marks(self);
    expect(m.find((x) => x.id === "final-return")).toMatchObject({ name: "準確定申告", date: "2026-07-15", period: "4か月", kind: "deadline" });
    expect(m.find((x) => x.id === "business-close")).toMatchObject({ name: "廃業届", period: "1か月" });
  });

  it("区切りの下には、前の区切りの翌日からその日までの手続きを日付の順にまとめる", () => {
    const renounce = tl.stops.find((s) => s.milestones[0].id === "renounce")!;
    const dates = renounce.tasks.map((e) => e.task.date);
    expect(dates[0]).toBe("2026-04-15");
    expect(dates.at(-1)).toBe("2026-06-15");
    expect([...dates].sort()).toEqual(dates);
    // 亡くなってすぐの葬儀・初七日は、死亡届の期限（3月23日）までにすること
    expect(groupOf(tl, "funeral")).toBe("death-report");
    expect(groupOf(tl, "shonanoka")).toBe("death-report");
    // 財産の評価（9月15日）は遺産分割協議の目安の日まで、預貯金の名義変更（相続税の期限と同じ日）は相続税の期限まで
    expect(groupOf(tl, "asset-valuation")).toBe("division");
    expect(groupOf(tl, "bank-transfer")).toBe("inheritance-tax");
    // 法要は相続登記の期限まで。そのあとの手続きはない
    expect(groupOf(tl, "sankaiki")).toBe("registration");
    expect(tl.after).toEqual([]);
  });

  it("区切りにした手続きは、下の手続きの一覧には重ねて出さない。どの手続きもどこか1か所に出る", () => {
    const listed = [...ids(tl).filter((id) => id !== "death"), ...tl.stops.flatMap((s) => s.tasks.map((e) => e.task.id)), ...tl.after.map((e) => e.task.id)];
    expect(listed.sort()).toEqual(liveOf(demo()).map((t) => t.id).sort());
  });

  it("「不要」にした手続きは区切りにしない。その下の手続きは次の区切りへ回る", () => {
    const na = buildTimeline(liveOf(demo(), ["renounce"]), { death: "2026-03-15", today: "2026-11-03", done: [] });
    expect(ids(na)).not.toContain("renounce");
    expect(groupOf(na, "renounce")).toBeUndefined();
    expect(groupOf(na, "koseki")).toBe("division");
    // 該当する場合だけの手続き（法定相続情報・空き家の特別控除など）も出さない
    for (const id of ["houtei-joho", "vacant-home", "sale-cost"]) expect(groupOf(na, id) ?? ids(na).find((x) => x === id)).toBeUndefined();
  });

  it("済んだ・期限を過ぎた・これからの状態と、いちばん近い期限", () => {
    const m = (id: string, t: Timeline) => marks(t).find((x) => x.id === id)!;
    expect(m("death", tl).state).toBe("start");
    expect(m("renounce", tl).state).toBe("late");
    expect(m("division", tl)).toMatchObject({ state: "open", next: false }); // 目安は「いちばん近い期限」にしない
    expect(m("inheritance-tax", tl)).toMatchObject({ state: "open", next: true });
    expect(marks(tl).filter((x) => x.next)).toHaveLength(1);
    // 相続税の申告を済ませたら、次の期限は相続登記
    const done = buildTimeline(liveOf(demo()), { death: "2026-03-15", today: "2026-11-03", done: ["inheritance-tax", "death-report", "funeral"] });
    expect(m("inheritance-tax", done)).toMatchObject({ state: "done", next: false });
    expect(m("registration", done).next).toBe(true);
    expect(m("death-report", done).state).toBe("done");
    expect(done.stops[1].tasks.map((e) => [e.task.id, e.state])).toEqual([
      ["funeral", "done"],
      ["shonanoka", "late"],
    ]);
    // 目安の日を過ぎた遺産分割協議
    expect(m("division", buildTimeline(liveOf(demo()), { death: "2026-03-15", today: "2026-11-16", done: [] })).state).toBe("late");
  });
});

describe("今日の位置", () => {
  const live = liveOf(demo());
  const at = (today: string) => {
    const tl = buildTimeline(live, { death: "2026-03-15", today, done: [] });
    return tl.todayAt < tl.stops.length ? tl.stops[tl.todayAt].milestones[0].id : "end";
  };
  it("今日より前の区切りのあと、今日以降でいちばん早い区切りの前に置く", () => {
    expect(at("2026-11-03")).toBe("division");
    expect(at("2026-06-16")).toBe("division");
    expect(at("2026-03-25")).toBe("health-insurance");
  });
  it("今日が区切りの日なら、その区切りの前（まだ間に合う）", () => {
    expect(at("2026-06-15")).toBe("renounce");
    expect(at("2026-03-15")).toBe("death");
  });
  it("最後の区切りを過ぎたら、いちばん下", () => {
    expect(at("2029-03-16")).toBe("end");
  });
  it("最後の区切りを過ぎても「そのあと」の手続きが残っていれば、「そのあと」の前。すべて過ぎていれば、そのさらにあと", () => {
    // 不動産も相続税の申告もない家族：最後の区切りは相続放棄（6月15日）、そのあとに一周忌・三回忌
    const blank = liveOf({ ...blankInterview(), deathDate: "2026-03-15" });
    const tl = (today: string) => buildTimeline(blank, { death: "2026-03-15", today, done: [] });
    expect(tl("2026-11-03")).toMatchObject({ todayAt: tl("2026-11-03").stops.length });
    expect(tl("2028-03-15").todayAt).toBe(tl("2028-03-15").stops.length);
    expect(tl("2028-03-16").todayAt).toBe(tl("2028-03-16").stops.length + 1);
    expect(tl("2029-01-10").after.every((e) => e.state === "late")).toBe(true);
  });
});

describe("区切りのまとめ方（境い目）", () => {
  const tasks = [task("a", "2026-04-10", true), task("x", "2026-04-10"), task("y", "2026-04-11"), task("b", "2026-05-01", true), task("c", "2026-05-01", true), task("z", "2026-04-20"), task("w", "2026-06-01")];
  const tl = buildTimeline(tasks, { death: "2026-04-01", today: "2026-04-15", done: [] });

  it("区切りと同じ日の手続きはその区切りに、翌日の手続きは次の区切りに入れる", () => {
    expect(groupOf(tl, "x")).toBe("a");
    expect(groupOf(tl, "y")).toBe("b");
    expect(groupOf(tl, "z")).toBe("b");
  });

  it("同じ日の区切りは1つのまとまりにし、その下の手続きは一度だけ出す。どちらも「いちばん近い期限」", () => {
    const may = tl.stops.find((s) => s.date === "2026-05-01")!;
    expect(may.milestones.map((m) => m.id)).toEqual(["b", "c"]);
    expect(may.tasks.map((e) => e.task.id)).toEqual(["y", "z"]);
    expect(may.milestones.every((m) => m.next)).toBe(true);
    expect(tl.stops).toHaveLength(3);
  });

  it("最後の区切りよりあとの手続きは「そのあと」にまとめる", () => {
    expect(tl.after.map((e) => e.task.id)).toEqual(["w"]);
    const blank = buildTimeline(liveOf({ ...blankInterview(), deathDate: "2026-03-15" }), { death: "2026-03-15", today: "2026-11-03", done: [] });
    expect(blank.after.map((e) => e.task.id)).toEqual(["isshuki", "sankaiki"]);
  });

  it("名前の短い言い方がない手続きは、手続きの名前のまま", () => {
    expect(marks(tl)[1].name).toBe("手続きa");
    expect(shortName({ id: "inheritance-tax", title: "相続税の申告と納付" })).toBe("相続税の申告・納付");
  });
});

describe("亡くなった日からの期間（休日でずれた期限）", () => {
  it("土日祝日でずれた期限も、ずらしたあとの日で比べる", () => {
    // 2026年3月15日の7日以内は3月21日（土）→ 3月23日（月）、14日以内は3月28日（土）→ 3月30日（月）
    expect(periodLabel("2026-03-15", "2026-03-23", true)).toBe("7日以内");
    expect(periodLabel("2026-03-15", "2026-03-30", true)).toBe("14日以内");
    // 1月7日の10か月は11月7日（土）→ 11月9日（月）
    const jan = marks(buildTimeline(liveOf(demo({ deathDate: "2026-01-07" })), { death: "2026-01-07", today: "2026-11-03", done: [] }));
    expect(jan.find((m) => m.id === "inheritance-tax")).toMatchObject({ date: "2026-11-09", period: "10か月" });
    expect(jan.find((m) => m.id === "registration")).toMatchObject({ date: "2029-01-09", period: "3年" });
  });

  it("目安（遺産分割協議）は休日でずらさない日で比べる", () => {
    // 8か月は11月15日（日）のまま
    expect(periodLabel("2026-03-15", "2026-11-15", false)).toBe("8か月");
    expect(periodLabel("2026-03-15", "2026-11-15", true)).toBeUndefined();
    // 相続税の申告がない家族の遺産分割協議は10か月
    const none = buildTimeline(liveOf(demo({ deposits: 1_000_000, homeValue: 0, otherRealEstate: 0, securities: 0, insurance: 0 })), { death: "2026-03-15", today: "2026-11-03", done: [] });
    expect(ids(none)).not.toContain("inheritance-tax");
    expect(marks(none).find((m) => m.id === "division")).toMatchObject({ date: "2027-01-15", period: "10か月", kind: "aim" });
  });

  it("休日で7日以内と10日以内の期限が同じ日になるときは、手続きから分かる期間を出す", () => {
    // 2026年7月12日の7日以内は7月18日（土）→ 海の日（20日）をはさんで21日（火）。10日以内もちょうど21日
    const jul = marks(buildTimeline(liveOf(demo({ deathDate: "2026-07-12" })), { death: "2026-07-12", today: "2026-07-13", done: [] }));
    expect(jul.filter((m) => m.date === "2026-07-21").map((m) => [m.id, m.period])).toEqual([
      ["death-report", "7日以内"],
      ["pension-stop", "10日以内"],
    ]);
    // 手続きが分からなければ、どちらとも決められないので出さない
    expect(periodLabel("2026-07-12", "2026-07-21", true)).toBeUndefined();
    expect(periodLabel("2026-07-12", "2026-07-21", true, { id: "unknown", title: "手続き" })).toBeUndefined();
  });

  it("休日で10日以内と14日以内の年金の期限が同じ日になるときは、厚生年金か国民年金かで期間を出す", () => {
    // 2026年4月23日の10日以内は5月2日（土）→ 5月7日（木）。14日以内も5月6日（振替休日）→ 5月7日
    const gw = marks(buildTimeline(liveOf(demo({ deathDate: "2026-04-23", pension: "employees" })), { death: "2026-04-23", today: "2026-04-24", done: [] }));
    expect(gw.filter((m) => m.date === "2026-05-07").map((m) => [m.id, m.period])).toEqual([
      ["pension-stop", "10日以内"],
      ["health-insurance", "14日以内"],
    ]);
    // 2025年12月18日の国民年金の14日以内は1月1日 → 年末年始のあとの1月5日（月）。10日以内も12月28日（日）→ 1月5日
    const ny = marks(buildTimeline(liveOf(demo({ deathDate: "2025-12-18", pension: "national" })), { death: "2025-12-18", today: "2025-12-19", done: [] }));
    expect(ny.find((m) => m.id === "pension-stop")).toMatchObject({ date: "2026-01-05", period: "14日以内" });
    expect(periodLabel("2026-04-23", "2026-05-07", true, { id: "pension-stop", title: "年金の受給停止（国民年金）" })).toBe("14日以内");
  });

  it("よくある期間にあたらない日には出さない", () => {
    expect(periodLabel("2026-03-15", "2026-04-01", true)).toBeUndefined();
    expect(periodLabel("2026-03-15", "2026-04-15", false)).toBe("1か月");
  });
});
