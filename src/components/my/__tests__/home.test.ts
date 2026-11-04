import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 見出し・流れ・月のカレンダーは別のテストで確かめるので、ここでは中身を出さない
vi.mock("@/components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  PageHead: ({ title, say }: { title: string; say?: ReactNode }) => createElement("header", null, createElement("h1", null, title), say && createElement("p", { "data-say": "" }, say)),
}));
vi.mock("../MilestoneView", () => ({ MilestoneFlow: () => createElement("div", { "data-flow": "" }) }));
vi.mock("@/components/plan/MonthCalendar", () => ({ MonthCalendar: () => createElement("div", { "data-month": "" }) }));

const task = (id: string, title: string, date: string, hard = false) => ({ id, title, date, hard });
const main = [
  task("division", "遺産分割協議と協議書の作成", "2026-11-15"),
  task("inheritance-tax", "相続税の申告と納付", "2027-01-15", true),
  task("bank", "預貯金の解約・名義変更", "2027-01-15"),
  task("stock", "株式・投資信託の名義変更（移管）", "2027-01-15"),
  task("memorial1", "一周忌法要", "2027-03-15"),
  task("memorial3", "三回忌法要", "2028-03-15"),
  task("registration", "不動産の相続登記", "2029-03-15", true),
];
const steps = ["亡くなった方", "相続人", "財産", "債務・葬式費用", "申告前の確認", "遺産の分け方", "税額の確認", "書類の作成"].map((title, i) => ({ slug: `s${i}`, title, done: i < 4 }));
let overall: Record<string, unknown>;
beforeEach(() => {
  overall = {
    loaded: true,
    heard: true,
    valid: true,
    est: { verdict: "likely", taxableTotal: 107_360_000, basicDeduction: 48_000_000, roughTaxAfterSpouse: 3_930_000 },
    precise: { taxable: 107_360_000, basic: 48_000_000, payable: 3_930_000 },
    verdict: "likely",
    account: { name: "相続 一郎" },
    iv: { deathDate: "2026-03-15" },
    pct: 56,
    main,
    live: main,
    done: [],
    now: "2026-11-04",
    next: main[0],
    steps,
    filing: true,
    byCategory: new Map([["戸籍・住民票", [{ done: true }, { done: false }]]]),
    closed: () => false,
    statusOf: () => "open",
  };
});
vi.mock("@/lib/overall", () => ({ useOverall: () => overall }));

const { Home } = await import("../Home");
const render = () => renderToStaticMarkup(createElement(Home));
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("ホームの文字", () => {
  it("見出しの吹き出しは1文だけ", () => {
    const say = render().match(/<p data-say="">([^<]*)<\/p>/)?.[1];
    expect(say).toBe("今日はここから始めましょう。");
  });

  it("「このあとの手続き」は近い3件だけ。残りは「すべて見る ›」から（期限はやることリストに残る）", () => {
    const t = text(render());
    for (const s of ["相続税の申告と納付", "預貯金の解約・名義変更", "株式・投資信託の名義変更（移管）"]) expect(t).toContain(s);
    for (const s of ["一周忌法要", "三回忌法要", "不動産の相続登記"]) expect(t).not.toContain(s);
    expect(render()).toMatch(/href="\/my\/tasks"[^>]*>すべて見る(<!-- -->)? ›/);
    expect(t).not.toContain("期限の近いものから進めましょう。");
    // 期限と日付・あと何日は残す
    expect(t).toContain("期限 2027年1月15日（金）（あと72日）");
  });

  it("カードの札は期限を過ぎたときだけ。「未着手」「期限あり」は出さない", () => {
    expect(text(render())).not.toMatch(/未着手|期限あり/);
    overall.now = "2027-01-18";
    overall.next = undefined;
    expect(text(render())).toContain("3日超過");
  });

  it("申告の進み具合は吹き出しを出さず、続きへの小さなリンクだけ（大きいボタンは「続きを進める」の1つ）", () => {
    const html = render();
    expect(text(html)).not.toContain("へ進みましょう");
    expect(html).toMatch(/href="\/case\/s4"[^>]*>申告の続き（(<!-- -->)?申告前の確認(<!-- -->)?） ›/);
    // 同じ先へ行く右上のリンクは出さない
    expect(text(html)).not.toContain("申告書づくりへ");
  });

  it("申告のステップがすべて済んだら、右上に「申告書づくりへ」を出す", () => {
    overall.steps = steps.map((s) => ({ ...s, done: true }));
    const html = render();
    expect(html).toMatch(/href="\/case\/documents"[^>]*>申告書づくりへ(<!-- -->)? ›/);
    expect(text(html)).not.toContain("申告の続き（");
  });

  it("コンパスくんに相談は、答えが出るまで吹き出しを出さず、質問ボタンは3つ", () => {
    const t = text(render());
    expect(t).toContain("コンパスくんに相談");
    expect(t).not.toMatch(/困ったときは|なんでも聞いて|気軽に聞いて/);
    expect(t).not.toContain("相続税の申告が必要か知りたい");
    expect(t).toContain("四十九日までに何を準備すればいい？");
  });

  it("相続税の見込みは、判定と3つの金額と、計算結果か目安かの区別を残す", () => {
    const t = text(render());
    expect(t).toContain("課税価格の合計");
    expect(t).toContain("基礎控除");
    expect(t).toContain("納める相続税の合計");
    expect(t).toContain("財産を評価した結果です。");
    overall.precise = undefined;
    expect(text(render())).toContain("聞き取りからの目安です。");
  });

  it("質問に答える前は、吹き出し1文と［質問に答える］ボタンだけ", () => {
    overall.heard = false;
    const html = render();
    expect(html.match(/<p data-say="">([^<]*)<\/p>/)?.[1]).toBe("まずは状況を教えてください（約3分）。");
    expect(html).toMatch(/href="\/my\/hearing"[^>]*>質問に答える ›/);
    expect(text(html)).not.toContain("答えにあわせて");
  });
});
