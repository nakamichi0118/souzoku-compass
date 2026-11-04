import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/domain/procedures/rules";
import { showBelowHeader, topBelowHeader } from "../scroll";
import { RowStatus } from "../StatusButtons";

const { keepShown, listScrollFor, MemoBox, rowDate, splitLead, TaskRow, tip, UploadPrompt } = await import("../TasksPage");

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
  const rowHtml = (p: { task?: Task; status?: "open" | "done" | "na"; now?: string; showDept?: boolean } = {}) =>
    renderToStaticMarkup(
      createElement(TaskRow, { task: p.task ?? task, status: p.status ?? "open", selected: false, hasMemo: false, now: p.now ?? "2026-11-03", showDept: p.showDept, onMark: () => {}, onSelect: () => {} }),
    );
  const text = (html: string) => html.replace(/<[^>]+>/g, "");

  it("スマホで手続きの名前が数文字で切れないよう、2行まで出す", () => {
    const html = rowHtml();
    expect(html).toMatch(/<p class="line-clamp-2 font-semibold[^"]*">遺産分割協議と協議書の作成<\/p>/);
    expect(html).not.toMatch(/class="truncate font-semibold/);
    // カレンダーなどから開いたときに、一覧をこの行まで送るための目印
    expect(html).toMatch(/^<li data-task="division" /);
  });

  it("2行目は「目安 12月1日（火）」だけ。分類は出さず、今年の日付は年を省く（スマホでも日付が切れない）", () => {
    const t2 = text(rowHtml());
    expect(t2).toContain("目安 12月1日（火）");
    expect(t2).not.toContain("調べる・決める");
    expect(t2).not.toContain("2026年");
    // 来年以降の日付は年もつける
    expect(text(rowHtml({ task: { ...task, date: "2027-01-15", hard: true } }))).toContain("期限 2027年1月15日（金）");
  });

  it("窓口ごとの表示では、担当課の名前は残す", () => {
    expect(text(rowHtml({ task: { ...task, dept: "戸籍の窓口" }, showDept: true }))).toContain("戸籍の窓口・目安 12月1日（火）");
  });

  it("札は期限を過ぎたときの「N日超過」だけ。「未着手」「期限あり」「✓ 完了」は出さない", () => {
    expect(text(rowHtml())).not.toMatch(/未着手|期限あり|完了$/);
    const hard = rowHtml({ task: { ...task, hard: true } });
    expect(text(hard)).not.toContain("期限あり");
    // 期限のある手続きは、日付をオレンジの太字にして示す
    expect(hard).toMatch(/<span class="font-semibold text-orange-700">期限 (<!-- -->)?12月1日（火）<\/span>/);
    expect(text(rowHtml({ status: "done" }))).not.toContain("✓ 完了");
    const late = rowHtml({ now: "2026-12-04" });
    expect(late).toMatch(/<span class="shrink-0 rounded-full [^"]*bg-rose-100[^"]*">3日超過<\/span>/);
    // 済ませた手続きは、過ぎていても札を出さない
    expect(text(rowHtml({ status: "done", now: "2026-12-04" }))).not.toContain("超過");
  });

  it("済んだ手続きは緑ではなくグレーで見せる", () => {
    const html = rowHtml({ status: "done" });
    expect(html).not.toMatch(/emerald/);
    expect(html).toContain("accent-stone-500");
    expect(html).toMatch(/text-stone-400 line-through/);
  });
});

describe("一覧の行の日付（rowDate）", () => {
  it("今年なら月日と曜日だけ、ほかの年は年から", () => {
    expect(rowDate("2026-11-15", "2026-11-04")).toBe("11月15日（日）");
    expect(rowDate("2027-01-15", "2026-11-04")).toBe("2027年1月15日（金）");
    expect(rowDate("2025-12-31", "2026-01-02")).toBe("2025年12月31日（水）");
  });
});

describe("詳細の説明文（splitLead）", () => {
  it("最初の1文だけを見せ、残りは「詳しく」に回す", () => {
    expect(splitLead("誰が何を受け継ぐかを相続人全員で決め、協議書に署名・実印を押します。期限の2か月前を目安にしています。")).toEqual([
      "誰が何を受け継ぐかを相続人全員で決め、協議書に署名・実印を押します。",
      "期限の2か月前を目安にしています。",
    ]);
  });
  it("かっこの中の「。」では切らない。1文だけなら残りは空", () => {
    expect(splitLead("口座が止まります（引き落としも止まります。）。残高証明書をもらいます。")).toEqual(["口座が止まります（引き落としも止まります。）。", "残高証明書をもらいます。"]);
    expect(splitLead("亡くなってから満2年の命日に行う法要です。")).toEqual(["亡くなってから満2年の命日に行う法要です。", ""]);
    expect(splitLead("句点なし")).toEqual(["句点なし", ""]);
  });
});

describe("ワンポイント（tip）", () => {
  it("目安の日がある手続きに「期限はありません」と出さない（日付の欄と食い違うため、決まり文句は出さない）", () => {
    expect(tip(task)).toBeNull();
    expect(tip({ ...task, hard: true, category: "税金" })).toBeNull();
  });
  it("葬儀・法要では、日付が一般的な目安であることを1文で伝える", () => {
    const s = tip({ ...task, category: "葬儀・法要" })!;
    expect(s).toContain("一般的な目安");
    expect(s.match(/。/g)).toHaveLength(1);
    expect(s).not.toContain("期限はありません");
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

  it("入力例は短いラベルにする", () => {
    const html = renderToStaticMarkup(createElement(MemoBox, { value: "", onSave: () => {} }));
    expect(html).toContain('placeholder="例：担当者・電話番号・郵送した日"');
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
