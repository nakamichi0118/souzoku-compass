import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Choice, Counter } from "../inputs";

const { FinishBar, UnansweredTips, nextQuestion } = await import("../Hearing");

describe("答えたあとに送る先の質問（nextQuestion）", () => {
  const all = ["q1", "q2", "q3"];

  it("押した質問の次の質問へ送る", () => {
    expect(nextQuestion(all, "q1")).toBe("q2");
    expect(nextQuestion(all, "q2", "q2")).toBe("q3");
  });

  it("iPhone の Safari のようにボタンにフォーカスが移らなくても、押した質問から次を決める（一番上へ戻らない）", () => {
    expect(nextQuestion(all, "q2", null)).toBe("q3");
    expect(nextQuestion(all, "q2", undefined)).toBe("q3");
  });

  it("前に入力した欄にフォーカスが残っていても、押した質問を優先する", () => {
    expect(nextQuestion(all, "q2", "q1")).toBe("q3");
  });

  it("押した場所が分からないときだけ、フォーカスのある質問を使う（キーボードで選んだとき）", () => {
    expect(nextQuestion(all, null, "q1")).toBe("q2");
  });

  it("どの質問か分からないときは、最初の質問へは送らず、画面を動かさない", () => {
    expect(nextQuestion(all, null, null)).toBeNull();
    expect(nextQuestion(all, undefined)).toBeNull();
    // 押した質問が、もう画面にない
    expect(nextQuestion(all, "gone", null)).toBeNull();
  });

  it("最後の質問のあとは end", () => {
    expect(nextQuestion(all, "q3", null)).toBe("end");
  });

  it("画面の要素でもそのまま使える（同じ要素かどうかで探す）", () => {
    const els = [{ id: 1 }, { id: 2 }];
    expect(nextQuestion(els, els[0], null)).toBe(els[1]);
    expect(nextQuestion(els, { id: 1 }, null)).toBeNull();
  });
});

const bar = (p: { dateOk?: boolean; unanswered?: number }) => renderToStaticMarkup(createElement(FinishBar, { dateOk: p.dateOk ?? true, unanswered: p.unanswered ?? 0, onFinish: () => {} }));
/** スマホで見える文（sm 以上でだけ見せる部分を取り除く） */
const phoneText = (html: string) =>
  html
    .replace(/<span class="hidden sm:inline">.*?<\/span>/g, "")
    .replace(/<button id="hearing-finish"[\s\S]*?<\/button>/g, "")
    .replace(/<[^>]+>/g, "");
const disabledBtn = /<button[^>]*\sdisabled=""/;

describe("画面の下の「次へ」の帯（FinishBar）", () => {
  it("ボタンの文は短く、折り返さず、縮まない", () => {
    const html = bar({ unanswered: 3 });
    expect(html).toContain("マイページへ →");
    expect(html).toMatch(/<button[^>]*class="[^"]*shrink-0[^"]*whitespace-nowrap/);
    expect(html).toContain('id="hearing-finish"');
  });

  it("パソコンでもスマホでも、まだ選んでいない質問の数だけを短く出す（理由は下の Tips に畳む）", () => {
    const html = bar({ unanswered: 3 });
    // 幅で出し分ける文はない
    expect(html).not.toContain("sm:hidden");
    expect(html).not.toContain("hidden sm:inline");
    const phone = phoneText(html);
    expect(phone).toBe("選んでいない質問があと3問 ›");
    expect(html).not.toContain("仮の答え");
  });

  it("選んでいない質問があるときの理由は、パソコンでもスマホでも畳んだ Tips で読める", () => {
    const tips = renderToStaticMarkup(createElement(UnansweredTips));
    expect(tips).toMatch(/^<details class="[^"]*">/);
    expect(tips).not.toContain("sm:hidden");
    expect(tips).not.toMatch(/<details[^>]*open/);
    expect(tips).toContain("Tips：選んでいない質問があるときは");
    expect(tips).toContain("仮の答えで手続きを出すため、必要な手続きが抜けることがあります");
    expect(tips).toContain("答えはあとから変えられます。");
  });

  it("10問以上でも数え方は「問」（「16つ」のようにならない）", () => {
    const html = bar({ unanswered: 16 });
    expect(phoneText(html)).toBe("選んでいない質問があと16問 ›");
    expect(html).not.toMatch(/\d(<!-- -->)?つ/);
  });

  it("帯の文はどれも短い（帯を低くして、後ろのボタンを隠さない）", () => {
    for (const p of [{ dateOk: false }, { unanswered: 12 }, { unanswered: 0 }]) {
      expect(phoneText(bar(p)).length).toBeLessThanOrEqual(16);
    }
  });

  it("亡くなった日がないときも押せる（押すと亡くなった日の欄へ送る）。その案内だけを出す", () => {
    const html = bar({ dateOk: false, unanswered: 5 });
    expect(html).not.toMatch(disabledBtn);
    expect(phoneText(html)).toBe("亡くなった日を入力してください");
    expect(html).not.toContain("まだ選んでいない質問");
  });

  it("選んでいない質問の数は、押すとその質問へ送るボタン。答えていない質問を見せたあとは「このまま進む」", () => {
    const html = bar({ unanswered: 3 });
    expect(html).toMatch(/<button type="button" class="[^"]*underline[^"]*">選んでいない質問があと/);
    const after = renderToStaticMarkup(createElement(FinishBar, { dateOk: true, unanswered: 3, onFinish: () => {}, confirmSkip: true }));
    expect(after).toContain("このまま進む →");
    expect(bar({ unanswered: 0 })).toContain("マイページへ →");
  });

  it("全部答えたときは、あとから変えられることだけを出す", () => {
    const html = bar({ unanswered: 0 });
    expect(phoneText(html)).toBe("答えはあとから変えられます。");
    expect(html).not.toMatch(disabledBtn);
  });

  it("画面の下に固定し、iPhone の下端（ホームバー）の分の余白をとる。文は縮められる", () => {
    const html = bar({ unanswered: 1 });
    expect(html).toMatch(/class="fixed inset-x-0 bottom-0 /);
    expect(html).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
    expect(html).toMatch(/<p class="min-w-0 flex-1 /);
  });
});

describe("選択肢と人数のボタン（スマホ）", () => {
  it("選択肢は折り返して並び、指で押しやすい高さがある", () => {
    const html = renderToStaticMarkup(createElement(Choice<string>, { value: undefined, onChange: () => {}, options: [{ value: "a", label: "厚生年金（会社員だった）" }, { value: "b", label: "受け取っていない" }] }));
    expect(html).toContain('class="flex flex-wrap gap-2"');
    expect(html.match(/min-h-11/g)).toHaveLength(2);
    expect(html).toContain("max-w-full");
  });

  it("人数の増減ボタンはスマホで 44px", () => {
    const html = renderToStaticMarkup(createElement(Counter, { value: 1, onChange: () => {} }));
    expect(html.match(/h-11 w-11/g)).toHaveLength(2);
  });
});
