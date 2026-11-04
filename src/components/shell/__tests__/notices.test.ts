import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Notice } from "@/lib/notices";

vi.mock("@/lib/cloud", () => ({ kvGet: () => null, kvSet: () => {} }));

const { byDate, NoticeItem } = await import("../Notices");

const sys = (id: string, date: string, title = id, body = `${id}の本文`): Notice => ({ id, kind: "system", level: "info", date, title, body });
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("相続コンパスからのお知らせ（タイトルだけ、押すと本文）", () => {
  it("タイトルを summary に置き、本文は details の中（閉じた状態）に入れる。日付は各行に出さない", () => {
    const html = renderToStaticMarkup(createElement(NoticeItem, { n: sys("a", "2026-11-04", "スマホで使いやすくしました", "本文です。"), unread: false }));
    expect(html).toMatch(/^<details class="group"><summary [^>]*>[\s\S]*スマホで使いやすくしました[\s\S]*<\/summary><p [^>]*>本文です。<\/p><\/details>$/);
    expect(html).not.toContain("open=");
    expect(text(html)).not.toContain("2026年11月4日");
  });

  it("未読なら、タイトルの頭に点を出す", () => {
    const html = renderToStaticMarkup(createElement(NoticeItem, { n: sys("a", "2026-11-04"), unread: true }));
    expect(html).toMatch(/<summary [^>]*>[\s\S]*aria-label="未読"[\s\S]*<\/summary>/);
  });

  it("日付は、同じ日のまとまりの見出しに1回だけ（並び順は変えない）", () => {
    const groups = byDate([sys("a", "2026-11-04"), sys("b", "2026-11-04"), sys("c", "2026-11-03"), sys("d", "2026-11-02")]);
    expect(groups.map(([d, l]) => [d, l.map((n) => n.id)])).toEqual([
      ["2026-11-04", ["a", "b"]],
      ["2026-11-03", ["c"]],
      ["2026-11-02", ["d"]],
    ]);
  });
});

describe("あなたへのお知らせ", () => {
  it("タイトルと期限の行を出し、押すと手続きを開く", () => {
    const n: Notice = { id: "soon:x", kind: "personal", level: "warn", date: "2026-11-15", title: "「遺産分割協議」の目安まであと11日です", body: "目安：2026年11月15日（日）", href: "/my/tasks?id=x" };
    const html = renderToStaticMarkup(createElement(NoticeItem, { n, unread: false }));
    expect(html).toMatch(/^<a [^>]*href="\/my\/tasks\?id=x"/);
    expect(text(html)).toContain("「遺産分割協議」の目安まであと11日です");
    expect(text(html)).toContain("目安：2026年11月15日（日）");
    expect(html).not.toContain("<details");
  });
});
