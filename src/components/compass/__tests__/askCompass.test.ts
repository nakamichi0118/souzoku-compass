import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AskCompass, type AskState } from "../AskCompass";

const state = (p: Partial<AskState> = {}): AskState => ({ step: "tasks", q: "", setQ: () => {}, busy: false, answer: null, asked: null, ask: async () => {}, pick: () => {}, ...p });
const render = (p?: Partial<AskState>) => renderToStaticMarkup(createElement(AskCompass, { state: state(p), placeholder: "例：この手続きは何をするの？" }));
const text = (html: string) => html.replace(/<[^>]+>/g, "");

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

describe("コンパスくんに相談（答えが出る前の文字）", () => {
  it("吹き出しは短い1文。入力欄の例は渡さなければ「質問を入力」", () => {
    const html = renderToStaticMarkup(createElement(AskCompass, { state: state() }));
    expect(text(html)).toContain("気軽に聞いてくださいね。");
    expect(text(html)).not.toContain("なんでも聞いて");
    expect(html).toContain('placeholder="質問を入力"');
    // 画面ごとの例を渡したときは、それを出す
    expect(render()).toContain('placeholder="例：この手続きは何をするの？"');
  });

  it("lead={null} なら、答えが出るまで吹き出しを出さない（ホーム）。答えが出たら出す", () => {
    const quiet = (p?: Partial<AskState>) => renderToStaticMarkup(createElement(AskCompass, { state: state({ step: "home", ...p }), lead: null }));
    expect(text(quiet())).not.toContain("聞いてくださいね");
    expect(quiet()).not.toContain("rotate-45");
    expect(text(quiet({ busy: true }))).toContain("ちょっと調べています…");
    expect(text(quiet({ asked: "必要な書類を知りたい", answer: "戸籍謄本です" }))).toContain("戸籍謄本です");
  });

  it("ホームの質問ボタンは3つ。「申告が必要か」は横の「相続税の見込み」が答えているので出さない", () => {
    const html = renderToStaticMarkup(createElement(AskCompass, { state: state({ step: "home" }), lead: null }));
    const chips = html.match(/<button type="button" class="rounded-full border[^"]*">[^<]*<\/button>/g) ?? [];
    expect(chips).toHaveLength(3);
    expect(text(html)).not.toContain("相続税の申告が必要か知りたい");
    expect(text(html)).toContain("相続税の計算の流れを知りたい");
  });
});

describe("想定質問の回答（faq）", () => {
  it("計算の流れの回答に、AIの説明は入れない（根拠の条文は残す）", async () => {
    const { FAQS } = await import("../faq");
    const flow = FAQS.home.find((f) => f.q === "相続税の計算の流れを知りたい")!.a;
    expect(flow).not.toMatch(/AI/);
    expect(flow).toContain("相続税法15〜19条");
    // 申告が必要かの回答は、税額の画面には残す
    expect(FAQS.tax.map((f) => f.q)).toContain("相続税の申告が必要か知りたい");
  });
});
