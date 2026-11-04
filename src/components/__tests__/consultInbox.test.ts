import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cloud", () => ({ useSession: () => ({ user: null, mode: "local" }) }));
vi.mock("@/lib/store", () => ({ useCase: () => ({ data: {}, result: null }) }));

const { ConsultInbox } = await import("../consult/ConsultThread");
type Item = Parameters<typeof ConsultInbox>[0]["items"][number];

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  userEmail: "you@example.com",
  name: "相続 一郎",
  prefecture: "東京都",
  contact: "you@example.com",
  content: "相談の文面",
  createdAt: "2026-11-04T03:00:00.000Z",
  updatedAt: "2026-11-04T03:00:00.000Z",
  messages: [],
  unread: 0,
  ...over,
});

const render = (items: Item[], staff: boolean) => renderToStaticMarkup(createElement(ConsultInbox, { items, staff, onChange: () => {}, empty: "まだ相談はありません。" }));

describe("税理士への相談のやりとり", () => {
  it("利用者の画面で相談が1件だけなら、左の一覧は出さない（日時は「相談の内容」に出る）", () => {
    const html = render([item("a")], false);
    expect(html).not.toContain("最終更新");
    expect(html).toContain("相談の内容（");
    expect(html).toContain("返事を待っています。");
  });

  it("事務所の画面と、利用者の相談が2件以上のときは一覧を出す", () => {
    expect(render([item("a")], true)).toContain("相続 一郎さん（東京都）");
    expect(render([item("a"), item("b")], false).match(/最終更新/g)).toHaveLength(2);
  });

  it("打ち合わせの案内には日時と参加ボタンを出す", () => {
    const html = render([item("a", { meeting: { url: "https://meet.google.com/x", at: "11/10 14:00" } })], false);
    expect(html).toContain("打ち合わせ：11/10 14:00");
    expect(html).toMatch(/<a href="https:\/\/meet.google.com\/x"[^>]*>.*参加する<\/a>/);
  });

  it("相談がないときは、渡した一言だけを出す", () => {
    expect(render([], false)).toBe("まだ相談はありません。");
  });
});
