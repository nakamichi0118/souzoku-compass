import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const overall = {
  loaded: true,
  account: { name: "相続 一郎" },
  valid: true,
  heard: true,
  live: new Array(30),
  doneTasks: 10,
  docs: new Array(15).fill({ na: false }),
  doneDocs: 3,
  iv: { decedentName: "相続 太郎" },
  pct: 28,
  finished: 28,
  total: 49,
  signOut() {},
};
vi.mock("@/lib/overall", () => ({ useOverall: () => overall }));
vi.mock("@/lib/notices", () => ({ useNotices: () => ({ personal: [], system: [], unread: () => true, unreadCount: 2, markRead() {} }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/my/tasks", useRouter: () => ({ replace() {}, push() {} }) }));

const { AppHeader, NAV, NavLinks } = await import("../AppShell");

const header = () => renderToStaticMarkup(createElement(AppHeader));
/** class 属性に、指定したクラスがすべて入っている要素の開始タグ */
const tagWith = (html: string, ...cls: string[]) =>
  (html.match(/<[a-z]+ [^>]*>/g) ?? []).filter((t) => {
    const c = t.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    return cls.every((x) => c.includes(x));
  });

describe("マイページ共通の見出し（スマホ）", () => {
  it("横に送る帯のメニューは、幅のある画面（lg 以上）だけに出す", () => {
    const html = header();
    const nav = html.match(/<nav [^>]*aria-label="メニュー"[^>]*>/)?.[0] ?? "";
    expect(nav).toMatch(/class="[^"]*\bhidden\b[^"]*\blg:flex\b/);
  });

  it("▾ のボタンは、スマホではメニューの印で、指で押しやすい高さがある", () => {
    const html = header();
    const btn = html.match(/<button [^>]*aria-expanded="false"[^>]*>[\s\S]*?<\/button>/g)?.at(-1) ?? "";
    expect(btn).toContain("min-h-9");
    expect(btn).toMatch(/lucide-menu[^"]*lg:hidden|lg:hidden[^"]*lucide-menu/);
    expect(btn).toContain('<span class="sr-only md:hidden">メニュー</span>');
  });

  it("全体の進捗の行は、スマホで1行に収める（言葉の途中で折り返さない。件数は幅のある画面だけ）", () => {
    const html = header();
    expect(tagWith(html, "whitespace-nowrap").length).toBeGreaterThanOrEqual(2);
    expect(html).toMatch(/<span class="whitespace-nowrap text-stone-600">全体の進捗<\/span>/);
    expect(html).toMatch(/<span class="[^"]*\bhidden\b[^"]*\bsm:inline\b[^"]*">（28 \/ 49 件）<\/span>|<span class="[^"]*\bhidden\b[^"]*\bsm:inline\b[^"]*">（<!-- -->28<!-- --> \/ <!-- -->49<!-- --> 件）<\/span>/);
    expect(html).toMatch(/<span class="min-w-0 truncate [^"]*">相続 太郎さんの相続<\/span>/);
  });

  it("帯には「〇〇さんの相続」だけを出す（同じことを言う「手続き中の相続」の札は出さない）", () => {
    const html = header();
    expect(html).toContain("相続 太郎さんの相続");
    expect(html).not.toContain("手続き中の相続");
  });

  it("お知らせと使い方の欄は、スマホではボタンではなく見出しの幅に合わせる（左にはみ出さない）", () => {
    const html = header();
    expect(tagWith(html, "shrink-0", "sm:relative")).toHaveLength(2);
    // 一覧を合わせる先の行
    expect(tagWith(html, "relative", "mx-auto", "max-w-7xl")).toHaveLength(1);
  });
});

describe("メニューの項目（NavLinks）", () => {
  const links = (path: string) => renderToStaticMarkup(createElement(NavLinks, { path, left: { tasks: 20, docs: 0 }, className: "x" }));

  it("すべての項目を出し、いまのページに印をつける。残りの件数は 1 件以上のときだけ", () => {
    const html = links("/my/tasks");
    for (const n of NAV) expect(html).toContain(`href="${n.href}"`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*href="\/my\/tasks"[^>]*aria-current="page"|<a [^>]*aria-current="page"[^>]*href="\/my\/tasks"/);
    expect(html).toContain('aria-label="残り20件"');
    expect(html).not.toContain("残り0件");
  });
});

describe("「財産と相続税」の行き先", () => {
  it("はじめは ①亡くなった方。まだ終わっていない最初のステップを渡せばそこへ", () => {
    const html = (caseHref?: string) => renderToStaticMarkup(createElement(NavLinks, { path: "/my", left: null, className: "x", caseHref }));
    expect(html()).toContain('href="/case/decedent"');
    expect(html("/case/heirs")).toContain('href="/case/heirs"');
    expect(html("/case/heirs")).not.toContain('href="/case/assets"');
  });
});

describe("使い方（ヘルプ）", () => {
  it("画面ごとに使い方があり、財産と相続税は①から順にと案内する", async () => {
    const { helpFor, HELP } = await import("@/data/help");
    expect(helpFor("/my")?.id).toBe("home");
    expect(helpFor("/my/tasks")?.id).toBe("tasks");
    expect(helpFor("/case/heirs")?.id).toBe("case");
    expect(helpFor("/case/map")?.id).toBe("map");
    expect(helpFor("/case/registration")?.id).toBe("papers");
    expect(helpFor("/case/decedent")?.what).toContain("①亡くなった方から");
    // 文は短く（できることは3つまで）
    for (const h of HELP) expect(h.points.length).toBeLessThanOrEqual(3);
  });
});
