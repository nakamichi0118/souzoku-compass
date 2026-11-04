import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { blankInterview, demoInterview } from "@/domain/procedures/interview";
import { buildTasks, type Task } from "@/domain/procedures/rules";
import { MilestoneFlow, MilestoneView } from "../MilestoneView";

const { ViewSwitch } = await import("../CalendarPage");

const live = buildTasks(demoInterview()).tasks.filter((t) => !t.optional);
type P = { tasks?: Task[]; done?: string[]; today?: string; locked?: (id: string) => string | undefined };
const props = (p: P) => ({ tasks: p.tasks ?? live, done: p.done ?? ["death-report", "funeral"], today: p.today ?? "2026-11-03", death: "2026-03-15" });
const render = (p: P = {}) => renderToStaticMarkup(createElement(MilestoneView, { ...props(p), onMark: () => {}, locked: p.locked }));
/** スマホでもパソコンでも出す縦の並び */
const vertical = (html: string) => html;
/** パソコンだけ、上に出す期限の流れ */
const flow = (p: P = {}) => renderToStaticMarkup(createElement(MilestoneFlow, props(p)));
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
    expect(v).toMatch(/<div class="[^"]*bg-orange-50 ring-1 ring-orange-300"><span class="pt-1">(?:(?!<\/li>)[\s\S])*href="\/my\/tasks\?id=inheritance-tax"/);
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
    expect(v.match(/<a class="-mr-1.5 flex min-w-0 flex-1 items-start rounded-lg py-2 /g)!.length).toBeGreaterThan(10);
  });
});

describe("カレンダーから「完了」「不要」を付ける", () => {
  const html = render();

  it("区切りの手続きにも、その下の手続きにも、やることリストと同じチェックと「不要」を付ける（亡くなった日には付けない）", () => {
    const boxes = html.match(/<input type="checkbox"[^>]*>/g)!;
    expect(boxes).toHaveLength(live.length);
    expect(html.match(/>不要<\/span><\/button>/g)).toHaveLength(live.length);
    expect(html).toContain('aria-label="相続税の申告と納付を完了にする"');
    expect(html).toContain('aria-label="通夜・葬儀・火葬を完了にする"');
    expect(html).not.toContain("亡くなった日を完了にする");
    // 済んだ手続きはチェック済み
    expect(html).toMatch(/<input type="checkbox"[^>]*aria-label="死亡届の提出と火葬許可の申請を完了にする" checked=""/);
  });

  it("済んだ・不要にしたものは緑ではなくグレー（チェックもグレー）", () => {
    expect(html).not.toMatch(/emerald/);
    expect(flow()).not.toMatch(/emerald/);
    expect(html).toMatch(/accent-stone-500/);
    expect(html).toMatch(/bg-stone-100 px-2 text-xs font-semibold leading-5 text-stone-500"><svg[^>]*>[\s\S]*?<\/svg>完了<\/span>/);
  });

  it("「不要」にした手続きも消さずにグレーで残し、「不要」を押した状態にする。いちばん近い期限にはしない", () => {
    const v = render({ done: ["death-report", "funeral", "na:inheritance-tax", "na:bank-transfer"] });
    expect(v).toContain("相続税の申告・納付");
    expect(v).toMatch(/text-stone-500"><svg[^>]*>[\s\S]*?<\/svg>不要<\/span>/);
    expect(v).toMatch(/aria-pressed="true"[^>]*><span [^>]*>不要<\/span><\/button><\/span><a [^>]*href="\/my\/tasks\?id=bank-transfer"/);
    expect(v).toMatch(/line-through">預貯金の解約・名義変更<span class="sr-only">（不要）<\/span>/);
    // 次の期限は相続登記
    expect(v).toMatch(/<div class="[^"]*ring-orange-300"><span class="pt-1">(?:(?!<\/li>)[\s\S])*href="\/my\/tasks\?id=registration"/);
  });

  it("相続税申告の画面で自動で完了にした手続きは、押せないチェックにする", () => {
    const v = render({ done: ["death-report", "asset-valuation"], locked: (id) => (id === "asset-valuation" ? "自動で完了" : undefined) });
    expect(v).toMatch(/<span class="-ml-2 flex shrink-0 items-center" title="自動で完了"><label [^>]*><input type="checkbox" disabled=""[^>]*aria-label="財産の評価額を確定する（相続税の申告の準備）を完了にする" checked=""/);
    expect(v.match(/disabled=""/g)).toHaveLength(2); // チェックと「不要」
  });

  it("今日より前の区切りで済んだ・不要にした手続きをたたむ。不要が入るときは見出しにも出す", () => {
    const past = live.filter((t) => t.date < "2026-11-03" && t.id !== "shonanoka" && t.id !== "funeral").map((t) => t.id);
    const v = render({ done: [...past, "na:funeral"] });
    expect(v).toContain("済んだ・不要にした手続き（1件）");
    expect(v).toContain("済んだ手続き（13件）");
  });
});

describe("パソコンの上に出す、期限の流れ", () => {
  const html = flow();
  const cols = html.match(/<li class="row-span-5 grid grid-rows-subgrid[^"]*">/g)!;

  it("亡くなった日から期限を1本の線でつないで1行に並べ、今日の列を入れる（横に動かさない）", () => {
    // 亡くなった日・死亡届・年金・健康保険・相続放棄・今日・遺産分割協議・相続税・相続登記
    expect(cols).toHaveLength(9);
    expect(html).toMatch(/^<ol class="grid grid-rows-\[auto_auto_auto_auto_auto\]" style="grid-template-columns:(minmax\(0,1fr\) ){5}minmax\(3.25rem,0.5fr\)( minmax\(0,1fr\)){3}">/);
    expect(html).not.toMatch(/overflow-x|whitespace-nowrap|flex-wrap/);
    const pos = order(html, ["亡くなった日", "死亡届", "年金の停止", "健康保険の手続き", "相続放棄・限定承認", ">今日<", "遺産分割協議", "相続税の申告・納付", "相続登記"]);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it("今日までの線を濃い色、そのあとを薄い色にする。端の列は外側に線を出さない", () => {
    const segs = html.match(/<span aria-hidden="true" class="absolute left-[^"]*h-1 -translate-y-1\/2 (bg-sky-600|bg-stone-200)"><\/span>/g)!;
    // 9列で、左右の半分の線が 8 本ずつ
    expect(segs).toHaveLength(16);
    expect(segs.filter((x) => x.includes("bg-sky-600"))).toHaveLength(10); // 亡くなった日〜今日の列の左半分まで
    expect(segs.filter((x) => x.includes("bg-stone-200"))).toHaveLength(6);
  });

  it("名前・期間・日付・残りの日数。年は変わったところだけ。いちばん近い期限を目立たせる", () => {
    expect(html).toMatch(/相続税の申告・納付<\/span><span [^>]*>10か月<\/span><span [^>]*><span [^>]*>2027年<\/span><span [^>]*>1月15日<\/span><span [^>]*>（金）<\/span><\/span><span [^>]*><span class="font-bold text-orange-800">あと73日<\/span>/);
    expect(html.match(/>2026年</g)).toHaveLength(1);
    expect(html.match(/>2027年</g)).toHaveLength(1);
    expect(html).toContain(">2029年<");
    expect(html).toMatch(/<span class="mr-1 font-semibold text-sky-800">目安<\/span>8か月/);
    expect(html).toMatch(/<a class="[^"]*bg-orange-50 ring-1 ring-orange-300" href="\/my\/tasks\?id=inheritance-tax"/);
    expect(html.match(/ring-orange-300/g)).toHaveLength(1);
    // 済んだ区切りは「完了」をグレーで
    expect(html).toMatch(/text-stone-400">死亡届<\/span>/);
    expect(html).toContain('<span class="font-semibold text-stone-500">完了</span>');
    // 亡くなった日はどこにもつながない
    expect(html).not.toContain('id=death"');
  });

  it("今日がすべての期限よりあとなら、今日の列はいちばん右", () => {
    const late = flow({ today: "2029-04-01" });
    expect(late.lastIndexOf(">今日<")).toBeGreaterThan(late.indexOf("相続登記"));
    expect(late).not.toContain("bg-stone-200");
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
