import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const plan = { loaded: true, account: { name: "相続 一郎" } as { name: string } | null };
vi.mock("@/lib/planStore", () => ({ usePlan: () => plan }));
vi.mock("@/lib/store", () => ({ useCase: () => ({ data: {}, result: null }) }));
vi.mock("@/lib/progress", async (orig) => ({ ...(await orig<typeof import("@/lib/progress")>()), filingSteps: () => [] }));

const { HeaderCta } = await import("../HeaderCta");
const { SiteHeader } = await import("../SiteHeader");
const { StepBar } = await import("../StepBar");

const cta = (big?: boolean) => renderToStaticMarkup(createElement(HeaderCta, { big }));

describe("トップページの上の帯（スマホ）", () => {
  it("登録済みのとき、上の帯のボタンは名前を出さず1行（丸い形が2つに割れない）", () => {
    plan.account = { name: "相続 一郎" };
    const html = cta();
    expect(html).toMatch(/<a [^>]*class="inline-block whitespace-nowrap [^"]*"[^>]*>マイページへ<\/a>/);
    expect(html).not.toContain("一郎");
  });

  it("大きいボタンには名前を出し、1つのまとまりにする（幅が足りなければその中で折り返す）", () => {
    plan.account = { name: "相続 一郎" };
    const html = cta(true);
    expect(html).toContain("マイページへ（相続 一郎さん）");
    expect(html).toMatch(/class="inline-block max-w-full /);
  });

  it("まだ登録していないときは「はじめる」", () => {
    plan.account = null;
    expect(cta()).toContain(">はじめる</a>");
    expect(cta(true)).toContain("はじめる（無料・約3分）");
  });

  it("ロゴは縮めず、折り返さない", () => {
    const html = renderToStaticMarkup(createElement(SiteHeader));
    const logo = html.match(/<a [^>]*href="\/"[^>]*>/)?.[0] ?? "";
    expect(logo).toMatch(/class="[^"]*\bshrink-0\b[^"]*\bwhitespace-nowrap\b/);
  });
});

describe("相続税申告のステップの帯", () => {
  it("帯だけを横に送れるようにし（画面は横に動かない）、いまのステップに印をつける", () => {
    const html = renderToStaticMarkup(createElement(StepBar, { current: "tax" }));
    expect(html).toMatch(/<nav data-tour="steps" aria-label="進捗" class="min-w-0 flex-1 overflow-x-auto">/);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });
});
