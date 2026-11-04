import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/domain/procedures/rules";
import { showBelowHeader, topBelowHeader } from "../scroll";
import { RowStatus } from "../StatusButtons";

const { keepShown, listScrollFor, MemoBox, TaskRow, UploadPrompt } = await import("../TasksPage");

describe("選んだ項目を見出しのすぐ下に出す（スマホ）", () => {
  it("要素の上の端を、固定した見出しの下から 8px あけたところに出す", () => {
    // いま 300px 送っていて、要素は画面の上から 1010px、見出しの下の端は 110px
    expect(topBelowHeader(300, 1010, 110)).toBe(300 + 1010 - 110 - 8);
    expect(topBelowHeader(0, 946, 130, 12)).toBe(946 - 130 - 12);
  });

  it("ページの上より上へは送らない", () => {
    expect(topBelowHeader(0, 20, 110)).toBe(0);
  });

  describe("画面を送る（showBelowHeader）", () => {
    let scrollTo: ReturnType<typeof vi.fn>;
    let media: Record<string, boolean>;
    let headPos: string;
    beforeEach(() => {
      scrollTo = vi.fn();
      media = {};
      headPos = "sticky";
      vi.stubGlobal("window", { scrollY: 200, scrollTo, matchMedia: (q: string) => ({ matches: !!media[q] }) });
      vi.stubGlobal("requestAnimationFrame", (f: () => void) => f());
      vi.stubGlobal("document", { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 110 }) }) });
      vi.stubGlobal("getComputedStyle", () => ({ position: headPos }));
    });
    afterEach(() => vi.unstubAllGlobals());
    const el = (top: number) => ({ getBoundingClientRect: () => ({ top }) }) as unknown as HTMLElement;

    it("見出しの高さを測って、そのすぐ下に送る", () => {
      showBelowHeader(() => el(1010));
      expect(scrollTo).toHaveBeenCalledWith({ top: 200 + 1010 - 110 - 8, behavior: "smooth" });
    });

    it("開いたときは、すぐに送る（smooth: false）。動きを減らす設定でも、すぐに送る", () => {
      showBelowHeader(() => el(500), { smooth: false });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 200 + 500 - 118, behavior: "auto" });
      media["(prefers-reduced-motion: reduce)"] = true;
      showBelowHeader(() => el(500));
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 200 + 500 - 118, behavior: "auto" });
    });

    it("見出しが固定されていなければ、見出しの分は引かない", () => {
      headPos = "static";
      showBelowHeader(() => el(500));
      expect(scrollTo).toHaveBeenCalledWith({ top: 200 + 500 - 8, behavior: "smooth" });
    });

    it("phoneOnly のときは、パソコンの幅（一覧と詳細が横に並ぶ）では送らない", () => {
      media["(min-width: 1024px)"] = true;
      showBelowHeader(() => el(500), { phoneOnly: true });
      expect(scrollTo).not.toHaveBeenCalled();
      // phoneOnly でなければ、パソコンの幅でも送る（資料集めの書類）
      showBelowHeader(() => el(500));
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });

    it("要素がまだ・もうないときは、何もしない", () => {
      showBelowHeader(() => null);
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });
});

describe("選ばずに開いて「完了にする」を押したとき（keepShown）", () => {
  it("詳細に出ている手続きを済ませたら、その手続きを選んだままにする（次の手続きに入れ替えない）", () => {
    expect(keepShown(null, "division", "division")).toBe(true);
  });
  it("URLで選んであるときや、ほかの手続き（一覧の行）を済ませたときは、何もしない", () => {
    expect(keepShown("division", "division", "division")).toBe(false);
    expect(keepShown(null, "division", "tax")).toBe(false);
    expect(keepShown(null, undefined, "tax")).toBe(false);
  });
});

describe("「完了」チェックと「不要」ボタン（RowStatus）", () => {
  const html = (locked?: string) => renderToStaticMarkup(createElement(RowStatus, { status: "open", onChange: () => {}, label: "死亡届", locked }));

  it("チェックは見た目そのままで、まわり 36px の枠ごと押せる", () => {
    expect(html()).toMatch(/<label class="grid h-9 w-9 place-items-center[^"]*"><input type="checkbox"[^>]*class="h-5 w-5 /);
  });

  it("「不要」も高さ 36px まで押せる。見た目の丸い枠は中に残す", () => {
    expect(html()).toMatch(/<button type="button"[^>]*class="group flex h-9 items-center[^"]*"><span class="rounded-full border[^"]*">不要<\/span><\/button>/);
  });

  it("読み上げでも、どの手続きの「不要」かが分かる", () => {
    expect(html()).toMatch(/<button type="button"[^>]*aria-label="死亡届を不要にする"/);
    expect(html()).toContain('aria-label="死亡届を完了にする"');
  });

  it("自動で決まる項目は、どちらも押せない", () => {
    const h = html("相続税申告の画面で済んでいます");
    expect(h).toMatch(/<input[^>]*disabled=""/);
    expect(h).toMatch(/<button[^>]*disabled=""/);
    expect(h).not.toContain("cursor-pointer");
  });
});

const task: Task = {
  id: "division",
  title: "遺産分割協議と協議書の作成",
  category: "調べる・決める",
  date: "2026-12-01",
  sortDate: "2026-12-01",
  hard: false,
  optional: false,
  important: true,
  what: "",
  where: "",
  bring: [],
  docs: [],
};

describe("やることリストの行（TaskRow）", () => {
  it("スマホで手続きの名前が数文字で切れないよう、2行まで出す", () => {
    const html = renderToStaticMarkup(
      createElement(TaskRow, { task, status: "open", selected: false, hasMemo: false, now: "2026-11-03", onMark: () => {}, onSelect: () => {} }),
    );
    expect(html).toMatch(/<p class="line-clamp-2 font-semibold[^"]*">遺産分割協議と協議書の作成<\/p>/);
    expect(html).not.toMatch(/class="truncate font-semibold/);
    // カレンダーなどから開いたときに、一覧をこの行まで送るための目印
    expect(html).toMatch(/^<li data-task="division" /);
  });
});

describe("ほかの画面から手続きを開いたときの、一覧の送り先（listScrollFor）", () => {
  it("行の上の端が、一覧の上の端から8pxあいたところに来る", () => {
    // 一覧の上の端が画面の300px、行が画面の1500px（一覧の中は送っていない）
    expect(listScrollFor(0, 1500, 300)).toBe(1192);
    // すでに送ってあれば、そのぶんも足す
    expect(listScrollFor(400, 1100, 300)).toBe(1192);
  });
  it("窓口ごとの表示では、上に貼りついた窓口の見出しの高さもあける", () => {
    expect(listScrollFor(0, 1500, 300, 36)).toBe(1156);
  });
  it("一覧のいちばん上の行なら送らない（マイナスにしない）", () => {
    expect(listScrollFor(0, 302, 300)).toBe(0);
  });
});

describe("メモ欄（MemoBox）", () => {
  it("iPhone で入力したときに画面が拡大されないよう、スマホでは 16px の文字にする", () => {
    const html = renderToStaticMarkup(createElement(MemoBox, { value: "", onSave: () => {} }));
    expect(html).toMatch(/<textarea[^>]*class="[^"]*\btext-base\b[^"]*\bsm:text-sm\b/);
  });
});

describe("済ませたあとのアップロードの案内（UploadPrompt）", () => {
  const html = renderToStaticMarkup(createElement(UploadPrompt, { docs: ["balanceCert"], open: false, onOpen: () => {}, onClose: () => {}, onRegistered: () => {} }));

  it("案内と同じ高さの余白をページの下に足す（後ろに隠れたボタンも上へ送れば押せる）", () => {
    // 余白は案内のすぐ前（ページの最後）。高さは描画したあとに案内を測って決める
    expect(html).toMatch(/<div aria-hidden="true" style="height:0"><\/div><div role="status"/);
  });

  it("開いて長くなっても上の見出しに重ならず、案内の中で動かせる", () => {
    expect(html).toMatch(/<div role="status" class="fixed [^"]*max-h-\[calc\(100dvh-10rem\)\][^"]*overflow-y-auto/);
  });

  it("「閉じる」は指で押しやすい大きさ", () => {
    expect(html).toMatch(/<button type="button" aria-label="閉じる" class="-m-2 shrink-0 p-2 /);
  });
});
