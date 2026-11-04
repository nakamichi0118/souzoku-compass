import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// 見出し・流れ・リストの中身は別のテストで確かめるので、ここでは目印だけを出す
vi.mock("@/components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  PageHead: ({ title, say }: { title: string; say?: ReactNode }) => createElement("header", null, createElement("h1", null, title), say && createElement("p", { "data-say": "" }, say)),
}));
vi.mock("@/components/my/MilestoneView", () => ({
  MilestoneFlow: () => createElement("div", { "data-flow": "" }),
  MilestoneView: () => createElement("ol", { "data-list": "" }),
}));
vi.mock("@/components/plan/MonthCalendar", () => ({ MonthCalendar: () => createElement("div", { "data-month": "" }) }));
vi.mock("@/components/my/UploadPrompt", () => ({ docsToUpload: () => [], UploadPrompt: () => null }));
vi.mock("@/components/my/StatusButtons", () => ({ AUTO_DONE_NOTE: "" }));
vi.mock("@/domain/procedures/share", () => ({ encodeInterview: () => "x" }));

const task = (id: string, title: string, date: string, hard = false) => ({ id, title, date, hard });
const main = [task("death", "死亡届", "2026-03-23", true), task("division", "遺産分割協議と協議書の作成", "2026-11-15"), task("inheritance-tax", "相続税の申告と納付", "2027-01-15", true)];
let overall: Record<string, unknown>;
beforeEach(() => {
  overall = { loaded: true, heard: true, valid: true, iv: { deathDate: "2026-03-15" }, main, live: main, done: ["death"], autoDone: [], now: "2026-11-04", verdict: "likely", closed: (id: string) => id === "death", setStatus() {} };
});
vi.mock("@/lib/overall", () => ({ useOverall: () => overall }));
beforeAll(() => vi.stubGlobal("window", { location: { host: "example.test", origin: "https://example.test" } }));
afterAll(() => vi.unstubAllGlobals());

const { CalendarPage } = await import("../CalendarPage");
const render = () => renderToStaticMarkup(createElement(CalendarPage));
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("カレンダーの文字", () => {
  it("吹き出しは1文。色の説明は短いラベル", () => {
    const html = render();
    expect(html.match(/<p data-say="">([^<]*)<\/p>/)?.[1]).toBe("オレンジは法律で決まった期限です。");
    expect(text(html)).toContain("期限（法律）");
  });

  it("右の「これからの予定」は出さない（同じ予定がリストに出ている）。手続きの流れは残す", () => {
    const html = render();
    expect(text(html)).not.toContain("これからの予定");
    expect(text(html)).not.toContain("遺産分割協議と協議書の作成");
    expect(html).toContain("data-flow");
    expect(html).toContain('aria-label="手続きの流れ"');
  });

  it("日付を過ぎた手続きの知らせは、リストの上に出す", () => {
    expect(render()).not.toContain("日付を過ぎた手続き");
    overall.now = "2026-11-20";
    const html = render();
    expect(html).toMatch(/日付を過ぎた手続きが(<!-- -->)?1(<!-- -->)?件あります。<\/p><ol data-list=""/);
  });

  it("カレンダーに入れる説明は短く。通知と、追加し直すことは残す", () => {
    const t = text(render());
    expect(t).toMatch(/3(<!-- -->)?件をまとめて追加し、期限の1週間前と前日に通知します。/);
    expect(t).toContain("答えを変えたり「不要」にしたりしたら、追加し直してください。");
    expect(t).not.toContain("専用のカレンダー");
    for (const s of ["Googleカレンダーに追加", "iPhone・Macに追加", "Outlook・その他（ファイルを保存）"]) expect(t).toContain(s);
  });

  it("いちばん下の注記は、専門用語を使わずに数え方を残す", () => {
    const t = text(render());
    expect(t).toContain("期限は亡くなった日から数えています（土日祝・年末年始なら次の平日）。");
    expect(t).not.toContain("起算日");
  });

  it("質問に答える前は、1文と［質問に答える］ボタンだけ", () => {
    overall.heard = false;
    const html = render();
    expect(html.match(/<p data-say="">([^<]*)<\/p>/)?.[1]).toBe("質問に答えると、期限がここに並びます。");
    expect(html).toMatch(/href="\/my\/hearing"[^>]*>質問に答える ›/);
  });
});
