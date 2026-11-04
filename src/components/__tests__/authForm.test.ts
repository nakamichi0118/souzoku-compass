import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cloud", () => ({ useSession: () => ({ signedIn: () => {} }) }));

const { AuthForm } = await import("../auth/AuthForm");

const render = (kind: "signup" | "login") => renderToStaticMarkup(createElement(AuthForm, { kind }));

describe("利用者登録・ログインの画面（スマホ）", () => {
  it("同意の文は、リンクと文を1つのまとまりにする（スマホで2つの列に分かれない）", () => {
    const html = render("signup");
    expect(html).toMatch(/<span class="min-w-0"><a [^>]*href="\/privacy"[^>]*>プライバシーポリシー<\/a>に同意します<\/span>/);
    // チェックボックスは指で押しやすい大きさにし、縮めない
    expect(html).toMatch(/<input type="checkbox"[^>]*class="[^"]*h-5 w-5 shrink-0/);
  });

  it("画面に固定した部品はなく、ボタンを隠すものがない", () => {
    for (const kind of ["signup", "login"] as const) {
      const html = render(kind);
      expect(html).not.toMatch(/class="[^"]*\b(fixed|sticky)\b/);
      expect(html).toContain('type="submit"');
    }
    expect(render("signup")).toContain("マイページを作成する");
  });

  it("試作版のあいだは、架空の内容で試すよう登録の画面に短く出す（ログインには出さない）", () => {
    expect(render("signup")).toContain("架空の内容でお試しください");
    expect(render("login")).not.toContain("架空の内容でお試しください");
  });

  it("入力欄の文字は 16px（iPhone で画面が拡大されない）", () => {
    const html = render("signup");
    const inputs = html.match(/<input [^>]*>/g) ?? [];
    const textInputs = inputs.filter((i) => !i.includes('type="checkbox"'));
    expect(textInputs).toHaveLength(3);
    for (const i of textInputs) expect(i).toMatch(/class="[^"]*\btext-base\b/);
  });
});
