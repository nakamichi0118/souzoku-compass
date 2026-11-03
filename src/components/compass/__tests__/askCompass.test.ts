import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AskCompass, type AskState } from "../AskCompass";

const state = (p: Partial<AskState> = {}): AskState => ({ step: "tasks", q: "", setQ: () => {}, busy: false, answer: null, asked: null, ask: async () => {}, pick: () => {}, ...p });
const render = (p?: Partial<AskState>) => renderToStaticMarkup(createElement(AskCompass, { state: state(p), placeholder: "例：この手続きは何をするの？" }));

describe("コンパスくんに相談（スマホ）", () => {
  it("入力欄の文字はスマホで 16px（iPhone で画面が拡大されない）", () => {
    const ta = render().match(/<textarea [^>]*>/)?.[0] ?? "";
    expect(ta).toMatch(/class="[^"]*\btext-base\b[^"]*\bsm:text-sm\b/);
    expect(ta).not.toMatch(/class="(?:[^"]*\s)?text-sm\b/);
  });

  it("スマホでは横の大きな顔を出さず、余白も小さくして答えの幅を広くとる", () => {
    const html = render({ asked: "期限を過ぎてしまったらどうなる？", answer: "答え" });
    expect(html).toMatch(/<section class="[^"]*\bp-3\b[^"]*\bsm:p-5\b/);
    // 52px の顔は sm 以上だけ。スマホでは見出しの横に小さく出す
    expect(html).toMatch(/<span class="hidden sm:block"><img [^>]*width="52"/);
    expect(html).toMatch(/<span class="sm:hidden"><img [^>]*width="32"[^>]*\/><\/span>コンパスくんに相談/);
    expect(html).toContain("「期限を過ぎてしまったらどうなる？」");
  });
});
