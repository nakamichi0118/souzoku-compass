import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/my/tasks", useRouter: () => ({ push() {} }) }));

const chat = await import("@/lib/compassChat");
const { CompassChat, stepFromPath } = await import("../CompassChat");
const { assistMessages } = await import("@/server/assist");
const { FAQS } = await import("../faq");

describe("右下のコンパスくん", () => {
  it("閉じているときは右下のアイコンだけ（押すとチャットが開く）", () => {
    const html = renderToStaticMarkup(createElement(CompassChat));
    expect(html).toContain('aria-label="コンパスくんに聞く"');
    expect(html).toMatch(/class="compass-fab fixed right-4/);
    expect(html).not.toContain('role="dialog"');
  });

  it("開くと、最初のあいさつと画面ごとの想定質問、入力欄（スマホで 16px）が出る", () => {
    chat.resetChat();
    chat.openChat(true);
    const html = renderToStaticMarkup(createElement(CompassChat));
    chat.openChat(false);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("いつでも聞いてくださいね。");
    expect(html).toContain(FAQS.tasks[0].q);
    expect(html.match(/<textarea [^>]*>/)?.[0]).toMatch(/\btext-base\b[^"]*\bsm:text-sm\b/);
  });

  it("画面の場所から想定質問の種類を決める", () => {
    expect(stepFromPath("/case/assets")).toBe("assets");
    expect(stepFromPath("/my/docs")).toBe("docs");
    expect(stepFromPath("/my/calendar")).toBe("home");
  });
});

describe("解決できましたか？", () => {
  it("答え終えた返事のあとにだけ出し、答えたら消える。相談するを選ぶと聞いたことを下書きに残す", () => {
    chat.resetChat();
    chat.pickFaq(FAQS.tasks[0]);
    const s = () => chat.useChat; // 型の確認だけ
    expect(s).toBeTypeOf("function");
    // FAQ の答えは、答え終えたものとして扱う
    const at = chat.askFeedbackAt({ msgs: [{ role: "user", text: "Q" }, { role: "assistant", text: "A", resolved: true }], feedback: {}, busy: false });
    expect(at).toBe(1);
    expect(chat.askFeedbackAt({ msgs: [{ role: "user", text: "Q" }, { role: "assistant", text: "A", resolved: true }], feedback: { 1: "yes" }, busy: false })).toBeNull();
    // 聞き返し・エラーのときは出さない
    expect(chat.askFeedbackAt({ msgs: [{ role: "user", text: "Q" }, { role: "assistant", text: "どちらですか？", resolved: false }], feedback: {}, busy: false })).toBeNull();
    expect(chat.askFeedbackAt({ msgs: [{ role: "user", text: "Q" }, { role: "assistant", text: "通信に失敗", local: true }], feedback: {}, busy: false })).toBeNull();
    expect(chat.askFeedbackAt({ msgs: [{ role: "user", text: "Q" }, { role: "assistant", text: "A", resolved: true }], feedback: {}, busy: true })).toBeNull();
  });

  it("「いいえ」は続けて聞けるように一言返す（Claude には送らない）", () => {
    chat.resetChat();
    chat.pickFaq(FAQS.tasks[0]);
    chat.answerFeedback(1, "no");
    let msgs: ReturnType<typeof chat.historyOf> = [];
    // 状態を読むため、いったんチャットを描いて中身を確かめる
    chat.openChat(true);
    const html = renderToStaticMarkup(createElement(CompassChat));
    chat.openChat(false);
    expect(html).toContain(chat.RETRY.slice(0, 10));
    expect(html).not.toContain("このチャットで解決できましたか？");
    msgs = chat.historyOf([
      { role: "user", text: "Q" },
      { role: "assistant", text: "A", resolved: true },
      { role: "assistant", text: chat.RETRY, local: true },
    ]);
    expect(msgs).toEqual([
      { role: "user", text: "Q" },
      { role: "assistant", text: "A" },
    ]);
  });

  it("答えが届かなかった質問は、エラーの返事といっしょに外す（次の質問と答えの組を崩さない）", () => {
    const h = chat.historyOf([
      { role: "user", text: "失敗した質問" },
      { role: "assistant", text: "通信に失敗しました。", local: true },
      { role: "user", text: "次の質問" },
      { role: "assistant", text: "次の答え", resolved: true },
    ]);
    expect(h).toEqual([
      { role: "user", text: "次の質問" },
      { role: "assistant", text: "次の答え" },
    ]);
  });

  it("相談の下書きには、聞いた質問だけを入れる", () => {
    const d = chat.consultDraft([
      { role: "user", text: "名義預金って何？" },
      { role: "assistant", text: "長い答え" },
      { role: "user", text: "孫の口座も\n入る？" },
    ]);
    expect(d).toBe("コンパスくんに聞いたこと：\n・名義預金って何？\n・孫の口座も 入る？");
    expect(d).not.toContain("長い答え");
    expect(chat.consultDraft([])).toBe("");
  });
});

describe("Claude に送るやりとり", () => {
  it("案件の情報は最初の発言にだけ付け、利用者→コンパスくんの順に交互に並べる", () => {
    const m = assistMessages({
      step: "tasks",
      context: "相続開始日: 2026-04-01",
      question: "期限は？",
      history: [
        { role: "assistant", text: "はじめの返事" },
        { role: "user", text: "準確定申告って？" },
        { role: "assistant", text: "亡くなった方の所得税です" },
        { role: "user", text: "答えが来なかった質問" },
      ],
    });
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(m[0].content).toContain('<case_context step="tasks">');
    expect(m[0].content).toContain("質問: 準確定申告って？");
    expect(m[2].content).toBe("期限は？");
  });

  it("1回だけの質問は今までどおり", () => {
    const m = assistMessages({ step: "tax", context: "c", question: "説明して" });
    expect(m).toHaveLength(1);
    expect(m[0].content).toContain("質問: 説明して");
  });
});

describe("想定質問の回答（faq）", () => {
  it("計算の流れの回答に、AIの説明は入れない（根拠の条文は残す）", () => {
    const flow = FAQS.home.find((f) => f.q === "相続税の計算の流れを知りたい")!.a;
    expect(flow).not.toMatch(/AI/);
    expect(flow).toContain("相続税法15〜19条");
    expect(FAQS.tax.map((f) => f.q)).toContain("相続税の申告が必要か知りたい");
  });

  it("ホームの想定質問は3つ。「申告が必要か」は横の「相続税の見込み」が答えているので出さない", () => {
    expect(FAQS.home).toHaveLength(3);
    expect(FAQS.home.map((f) => f.q)).not.toContain("相続税の申告が必要か知りたい");
  });
});
