import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { blankInterview, demoInterview } from "@/domain/procedures/interview";
import { buildTasks, type Task } from "@/domain/procedures/rules";
import { MilestoneView } from "../MilestoneView";

const { ViewSwitch } = await import("../CalendarPage");

const live = buildTasks(demoInterview()).tasks.filter((t) => !t.optional);
const render = (p: { tasks?: Task[]; done?: string[]; today?: string } = {}) =>
  renderToStaticMarkup(createElement(MilestoneView, { tasks: p.tasks ?? live, done: p.done ?? ["death-report", "funeral"], today: p.today ?? "2026-11-03", death: "2026-03-15" }));
/** スマホでも出す縦の並び（パソコンだけの横の並びのあと） */
const vertical = (html: string) => html.slice(html.indexOf('<div class="relative">'));
/** パソコンだけの横の並び */
const strip = (html: string) => html.slice(0, html.indexOf('<div class="relative">'));
const order = (html: string, words: string[]) => words.map((w) => html.indexOf(w));

describe("カレンダーの「手続きごと」", () => {
  const html = render();

  it("縦の並び：亡くなった日から、期限の名前・期間・日付を順に出す", () => {
    const v = vertical(html);
    const pos = order(v, ["亡くなった日", "死亡届", "年金の停止", "健康保険の手続き", "相続放棄・限定承認", "遺産分割協議", "相続税の申告・納付", "相続登記"]);
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(v).toContain("2026年3月15日（日）");
    expect(v).toContain(">7日以内<");
    expect(v).toContain(">3か月<");
    expect(v).toContain(">10か月<");
    expect(v).toContain("2029年3月15日（木）");
    // 準確定申告が必要ない家族には出さない
    expect(html).not.toContain("準確定申告");
  });

  it("区切りと手続きは、それぞれの手続きの画面へつながる（亡くなった日はつながない）", () => {
    const v = vertical(html);
    expect(v).toContain('href="/my/tasks?id=renounce"');
    expect(v).toContain('href="/my/tasks?id=koseki"');
    expect(v).not.toContain("id=death\"");
  });

  it("状態：完了・期限を過ぎています・あと○日・いちばん近い期限", () => {
    const v = vertical(html);
    expect(v).toContain("完了</span>");
    expect(v.match(/>期限を過ぎています</g)).toHaveLength(3); // 年金・健康保険・相続放棄
    expect(v).toContain(">あと12日<"); // 遺産分割協議（11月15日）
    expect(v.match(/いちばん近い期限/g)).toHaveLength(1);
    // いちばん近い期限（相続税）の行を目立たせる
    expect(v).toMatch(/<a class="[^"]*bg-orange-50 ring-1 ring-orange-300" href="\/my\/tasks\?id=inheritance-tax"/);
    expect(v).toMatch(/いちばん近い期限<\/span>/);
  });

  it("区切りの下に、それまでにする手続きを短い日付と状態で出す", () => {
    const v = vertical(html);
    expect(v.match(/この期限までにすること/g)!.length).toBeGreaterThanOrEqual(3);
    expect(v).toContain("この日までにすること"); // 目安（遺産分割協議）の下
    expect(v).toMatch(/>3月18日<\/span><span class="[^"]*line-through[^"]*">通夜・葬儀・火葬<span class="sr-only">（完了）<\/span>/);
    expect(v).toMatch(/text-rose-700">3月21日<\/span><span [^>]*>初七日法要<span [^>]*>過ぎています<\/span>/);
    // 区切りと違う年の手続きは、年もつける（相続登記の下の一周忌・三回忌）
    expect(v).toContain(">2027年3月15日<");
    expect(v).toContain(">2028年3月15日<");
    // 相続税と同じ年の手続きは月日だけ
    expect(v).toContain(">1月15日<");
  });

  it("今日の印を、過ぎた期限（相続放棄）とこれからの目安（遺産分割協議）のあいだに出す", () => {
    const v = vertical(html);
    const [before, today, after] = order(v, ["相続放棄・限定承認", "今日 2026年11月3日（火）", "遺産分割協議"]);
    expect(before).toBeLessThan(today);
    expect(today).toBeLessThan(after);
    expect(v.match(/今日 /g)).toHaveLength(1);
  });

  it("最後の区切りよりあとの手続きは「そのあと」にまとめる", () => {
    const extra = { ...live[0], id: "later", title: "あとの手続き", date: "2030-05-01", hard: false } as Task;
    const v = vertical(render({ tasks: [...live, extra] }));
    const [last, rest, item] = order(v, ["相続登記", "そのあと", "あとの手続き"]);
    expect(last).toBeLessThan(rest);
    expect(rest).toBeLessThan(item);
    // 「そのあと」には「までにすること」の見出しをつけない
    expect(v.slice(rest)).not.toContain("までにすること");
  });

  it("パソコンだけ、上に期限の箱を横に並べる（入りきらなければ折り返す）。今日の位置に印をつける", () => {
    const s = strip(html);
    expect(s).toMatch(/^<div><ol class="mb-5 hidden flex-wrap gap-2 lg:flex">/);
    expect(s.match(/<li class="w-\[9.5rem\]">/g)).toHaveLength(8);
    expect(s).not.toMatch(/overflow-x|whitespace-nowrap/);
    const [renounce, mark, division] = order(s, ["相続放棄・限定承認", ">今日<", "遺産分割協議"]);
    expect(renounce).toBeLessThan(mark);
    expect(mark).toBeLessThan(division);
    // 箱には名前・期間・日付
    expect(s).toMatch(/相続税の申告・納付<\/span><span class="text-xs text-stone-500">10か月<\/span><span [^>]*>2027年<\/span><span [^>]*>1月15日（金）<\/span>/);
    expect(s).toMatch(/<span class="mr-1 font-semibold text-sky-800">目安<\/span>8か月/);
    // いちばん近い期限の箱を目立たせる
    expect(s).toMatch(/<a class="[^"]*bg-orange-50 ring-2 ring-orange-400" href="\/my\/tasks\?id=inheritance-tax"/);
    expect(s.match(/ring-orange-400/g)).toHaveLength(1);
  });

  it("今日がすべての期限よりあとなら、今日の印はいちばん下", () => {
    const v = vertical(render({ today: "2029-04-01" }));
    expect(v.indexOf("今日 2029年4月1日（日）")).toBeGreaterThan(v.indexOf("相続登記"));
    expect(v).not.toContain("いちばん近い期限");
  });

  it("「そのあと」の手続きもすべて過ぎていれば、今日の印は「そのあと」より下。残っていれば「そのあと」の前", () => {
    // 不動産も相続税の申告もない家族：最後の区切りは相続放棄、そのあとに一周忌・三回忌
    const tasks = buildTasks({ ...blankInterview(), deathDate: "2026-03-15" }).tasks.filter((t) => !t.optional);
    const late = vertical(render({ tasks, done: [], today: "2029-01-10" }));
    const [rest, sankaiki, today] = order(late, ["そのあと", "三回忌法要", "今日 2029年1月10日"]);
    expect(rest).toBeGreaterThan(0);
    expect(rest).toBeLessThan(sankaiki);
    expect(sankaiki).toBeLessThan(today);
    const mid = vertical(render({ tasks, done: [], today: "2027-06-01" }));
    expect(mid.indexOf("今日 2027年6月1日")).toBeLessThan(mid.indexOf("そのあと"));
    expect(mid.match(/今日 /g)).toHaveLength(1);
  });

  it("今日より前の区切りでは、済んだ手続きを「済んだ手続き（○件）」にたたむ。済んでいない手続きと、これからの区切りの手続きはたたまない", () => {
    // デモの家族と同じく、今日より前の手続きはすべて済んでいる（初七日だけ済んでいない）
    const past = live.filter((t) => t.date < "2026-11-03" && t.id !== "shonanoka").map((t) => t.id);
    const v = vertical(render({ done: past }));
    const details = v.match(/<details>[\s\S]*?<\/details>/g)!;
    // 今日より前の死亡届（葬儀）と相続放棄（4月15日〜6月15日の13件）の2か所
    expect(details).toHaveLength(2);
    expect(details[0]).toContain("済んだ手続き（1件）");
    expect(details[0]).toContain("通夜・葬儀・火葬");
    expect(details[1]).toContain("済んだ手続き（13件）");
    expect(details[1]).toContain("四十九日法要・納骨");
    expect(v).not.toMatch(/<details[^>]*open/);
    // 済んでいない初七日は、たたまずに出す
    expect(v.indexOf("初七日法要")).toBeLessThan(v.indexOf("済んだ手続き（1件）"));
    expect(details.join("")).not.toContain("初七日法要");
    // たたんだ手続きしかないまとまり（相続放棄の下）には「この期限までにすること」の見出しを出さない
    expect(v.match(/この期限までにすること/g)).toHaveLength(3); // 死亡届・相続税・相続登記
    const renounce = v.slice(v.indexOf("相続放棄・限定承認"), v.indexOf("今日 2026年11月3日"));
    expect(renounce).not.toContain("までにすること");
    // 今日のあとの区切りの下の手続きは、済んでいても（遺産分割協議の前の財産の評価）たたまない
    const ahead = v.slice(v.indexOf("今日 2026年11月3日"));
    expect(ahead).not.toContain("<details>");
    expect(ahead).toMatch(/line-through[^"]*">財産の評価額を確定する/);
    expect(ahead).toContain("預貯金の解約・名義変更");
  });

  it("スマホでは日付を名前の上に出して名前に幅をとり、広い画面では日付の欄の幅をそろえる。指で押しやすい高さ", () => {
    const v = vertical(html);
    // 日付と名前を、スマホでは縦に、広い画面では横に並べる
    expect(v).toMatch(/<span class="flex min-w-0 flex-1 flex-col sm:flex-row sm:gap-2"><span class="shrink-0 whitespace-nowrap text-xs tabular-nums sm:text-sm sm:min-w-\[5em\] text-stone-500">1月15日<\/span>/);
    // 年のつく日付があるまとまり（相続登記の下の一周忌・三回忌）は、日付の欄を広くする
    expect(v).toMatch(/sm:min-w-\[8.5em\] text-stone-500">2027年3月15日<\/span>/);
    // 名前の欄に、決まった最小幅の日付の欄を横に並べない
    expect(v).not.toContain("min-w-[4.5em]");
    expect(v.match(/<a class="-mx-1.5 flex items-start gap-2 rounded-lg px-1.5 py-1.5 text-sm/g)!.length).toBeGreaterThan(10);
  });
});

describe("表示の切り替え", () => {
  it("「手続きごと」「月ごと」の2つで、選んでいるほうを押した状態にする", () => {
    const html = renderToStaticMarkup(createElement(ViewSwitch, { view: "steps", onChange: () => {} }));
    expect(html.match(/<button /g)).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="true"[^>]*>手続きごと</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>月ごと</);
    // 指で押しやすい高さ
    expect(html.match(/min-h-10/g)).toHaveLength(2);
  });
});
