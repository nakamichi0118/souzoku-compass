import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoCase } from "@/data/demo";
import { calculate, type TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";

// 画面は useCase() の中身だけを見るので、テストでは store を差し替える
const ctx: { data: Case; result: TaxResult | null } = { data: demoCase, result: null };
vi.mock("@/lib/store", () => ({
  useCase: () => ({ ...ctx, update: () => {}, replace: () => {}, loaded: true, error: null }),
  newId: () => "new-id",
}));
vi.mock("@/lib/planStore", () => ({ usePlan: () => ({ setStatus: () => {}, statusOf: () => undefined, done: [], iv: {} }) }));
vi.mock("@/lib/progress", async (orig) => ({ ...(await orig<typeof import("@/lib/progress")>()), filingSteps: () => [] }));

const { DecedentStep } = await import("../DecedentStep");
const { HeirsStep } = await import("../HeirsStep");
const { AssetsStep } = await import("../AssetsStep");
const { DebtsStep } = await import("../DebtsStep");
const { GuidePanel } = await import("../../GuidePanel");
const { StepBar } = await import("../../StepBar");
const { STEPS } = await import("@/lib/steps");

const clone = () => structuredClone(demoCase);
const render = (c: ComponentType, data: Case = clone()) => {
  ctx.data = data;
  ctx.result = calculate(data);
  return renderToStaticMarkup(createElement(c));
};
const text = (html: string) => html.replace(/<[^>]+>/g, "");

beforeEach(() => {
  ctx.data = demoCase;
  ctx.result = null;
});

describe("ステップの帯と Tips（全ステップ共通）", () => {
  it("帯は短い名前にし、パソコンでは8つとも名前を出す（いまのステップ以外は、スマホでは番号だけ）", () => {
    expect(STEPS.map((s) => s.short)).toEqual(["亡くなった方", "相続人", "財産", "債務・葬式費用", "確認", "分け方", "税額", "書類"]);
    const html = renderToStaticMarkup(createElement(StepBar, { current: "tax" }));
    expect(html).toContain('<span class="whitespace-nowrap">税額</span>');
    expect(html).toContain('<span class="sr-only lg:not-sr-only lg:whitespace-nowrap">書類</span>');
    // 帯の左の「相続税申告」は出さない
    expect(html).not.toContain("相続税申告");
    // 見出し・前後のボタンは今の名前のまま
    expect(STEPS.find((s) => s.slug === "documents")?.title).toBe("書類の作成");
  });

  it("税額の確認の Tips に AI の説明を出さない", () => {
    const html = render(() => createElement(GuidePanel, { step: "tax" }));
    expect(html).not.toContain("AI");
    expect(html).toContain("このステップのTips");
  });

  it("画面や想定質問と同じことは Tips に書かない（亡くなった方：期限・提出先、相続人：放棄・養子）", () => {
    const decedent = text(render(() => createElement(GuidePanel, { step: "decedent" })));
    const tips = decedent.slice(decedent.indexOf("このステップのTips"), decedent.indexOf("コンパスくんに相談"));
    expect(tips).not.toContain("10か月以内");
    expect(tips).not.toContain("所轄する税務署");
    expect(tips).toContain("令和8年（2026年）中に亡くなった方");
    const heirs = text(render(() => createElement(GuidePanel, { step: "heirs" })));
    const heirTips = heirs.slice(heirs.indexOf("このステップのTips"), heirs.indexOf("コンパスくんに相談"));
    expect(heirTips).toContain("代襲相続");
    expect(heirTips).not.toContain("基礎控除の人数");
  });

  it("横の欄は Tips だけ（コンパスくんへの質問は右下のチャットから）", () => {
    const html = render(() => createElement(GuidePanel, { step: "decedent" }));
    expect(html).toContain("このステップのTips");
    expect(html).not.toContain("<textarea");
  });
});

describe("亡くなった方", () => {
  it("期限は日付と数え方を1行で出し、専門用語は欄の名前から外す", () => {
    const t = text(render(DecedentStep));
    expect(t).toContain("申告・納税の期限：令和9年1月15日（亡くなったことを知った日の翌日から10か月。休日なら次の平日）");
    expect(t).toContain("亡くなった日");
    expect(t).not.toContain("相続開始日");
    // 見出しは大見出しと同じなので出さない
    expect(t).not.toContain("亡くなった方の情報");
  });

  it("精算課税の補足は1行にし、残りは「詳しく」に畳む（消さない）", () => {
    const html = render(DecedentStep);
    expect(html).toContain("「相続時精算課税選択届出書」を出した贈与のことです。");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>詳しく<\/summary><p[^>]*>選んだ後に受けた贈与は、何年前のものでも相続税の計算に足します（令和6年以降の贈与は、毎年110万円までの部分を除きます）。<\/p><\/details>/);
  });

  it("令和8年以外の年は、止まる理由を出す", () => {
    const c = clone();
    c.decedent = { ...c.decedent, deathDate: "2025-12-01" };
    expect(text(render(DecedentStep, c))).toContain("令和8年（2026年）中に亡くなった方だけが対象です（ほかの年は税制・様式が違うため）。");
  });

  it("提出先の税務署は、欄の右に「税務署」と出して名前だけ入れてもらう", () => {
    const html = render(DecedentStep);
    expect(html).toContain("最後の住所を担当する税務署");
    expect(html).toMatch(/value="麹町"[^>]*\/><span class="shrink-0 text-sm text-stone-600">税務署<\/span>/);
  });
});

describe("相続人", () => {
  it("住所・連絡先は畳み、入れてあれば見出しの横に1行で見せる（開けば4つの欄がある）", () => {
    const html = render(HeirsStep);
    const hanako = html.slice(html.indexOf("住所・連絡先（書類用）"));
    expect(hanako).toMatch(/^住所・連絡先（書類用）<span [^>]*>〒100-0099 東京都千代田区架空町一丁目2番3号 03-0000-0000<\/span><\/summary>/);
    for (const label of ["電話番号", "職業"]) expect(hanako).toContain(`>${label}</span>`);
    // 住所は郵便番号つきの欄（郵便番号を入れると住所が入る）
    expect(hanako).toContain('aria-label="郵便番号"');
    expect(hanako).toContain(">住所</label>");
    expect(html).not.toMatch(/<details[^>]*open[^>]*><summary[^>]*>住所・連絡先/);
  });

  it("下書きであることは残し、続柄の例は入力欄の中に出す", () => {
    const html = render(HeirsStep);
    expect(html).toContain("聞き取りの答えから下書きしました。違うところは直してください。");
    expect(html).toContain('placeholder="例：妻、長男、二女、孫"');
    expect(text(html)).not.toContain("続柄（書類に書く表記）");
    expect(text(html)).toContain("相続人と取り分");
    expect(text(html)).toContain("税の計算での人数");
  });

  it("先に亡くなった子の欄は、代わりに相続する人と「亡くなった方」の画面への道案内だけ", () => {
    const t = text(render(HeirsStep));
    expect(t).toContain("相続 次郎さんの分は、子ども（孫）が代わりに相続します。");
    expect(t).toContain("亡くなった方がこの方の相続で相続税を納めていたら、「亡くなった方」の画面で入れてください。");
    expect(t).not.toContain("被代襲者");
  });

  it("後に亡くなった家族は、税理士に相談する理由を2つとも残す", () => {
    const c = clone();
    c.persons = c.persons.map((p) => (p.id === "jiro" ? { ...p, deathDate: "2026-05-01" } : p));
    const t = text(render(HeirsStep, c));
    expect(t).toContain("申告書の書き方が特殊で");
    expect(t).toContain("相次相続控除も相続コンパスでは計算できないため、税理士にご相談ください。");
  });
});

describe("財産", () => {
  it("一覧の上の説明・合計を短くし、合計は特例の前の額だと分かるようにする", () => {
    const t = text(render(AssetsStep));
    expect(t).toContain("残高証明書は資料集めから読み取って登録できます。");
    expect(t).not.toContain("行をクリックすると");
    expect(t).toMatch(/財産の合計（特例・非課税枠を引く前）：[\d,]+円/);
  });

  it("書類の印は行ごとに出さず、まだの件数を1回だけ出す", () => {
    const html = render(AssetsStep);
    expect(html).not.toContain("書類まだ</span>");
    expect(html).toMatch(/（書類まだ \d+件）/);
  });

  it("相続人がいないときの注意は画面の上の1か所だけ", () => {
    const c = clone();
    c.persons = [];
    const t = text(render(AssetsStep, c));
    expect(t).toContain("先に相続人を登録してください（保険金の受取人や分け方で選ぶため）。");
    expect(t).not.toContain("相続人を登録してから選べます");
  });

  it("財産がないときは1行だけ（すぐ下に追加のボタン）", () => {
    const c = clone();
    c.assets = [];
    const t = text(render(AssetsStep, c));
    expect(t).toContain("まだ財産がありません。");
    expect(t).not.toContain("下の「財産を追加」から登録してください");
    expect(t).toContain("財産を追加");
  });
});

describe("債務・葬式費用", () => {
  it("申告書の表の番号と「債権者」は出さず、止まる理由は残す", () => {
    const c = clone();
    c.priorGifts = [{ personId: "", date: "", amount: 100_000, giftTaxPaid: 0 }];
    const t = text(render(DebtsStep, c));
    expect(t).not.toContain("第13表");
    expect(t).not.toContain("債権者");
    expect(t).toContain("支払先の住所");
    expect(t).toContain("受け取った人と贈与の日を入れてください（入れるまで税額も申告書も確定できません）。");
    expect(t).toContain("財産を受け取る人への贈与は、相続財産に足します（納めた贈与税は引けます）。");
  });

  it("追加のボタンは枠と見出しを付けずに並べる", () => {
    const html = render(DebtsStep);
    expect(text(html)).not.toMatch(/^追加する/);
    expect(html).not.toContain(">追加する</h2>");
    expect(html).toContain("＋ 葬式費用");
  });
});
