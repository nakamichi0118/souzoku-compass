import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoCase } from "@/data/demo";
import type { Case } from "@/domain/types";

// 画面は useCase() の中身だけを見るので、テストでは store を差し替える
const ctx: { data: Case } = { data: demoCase };
vi.mock("@/lib/store", () => ({ useCase: () => ({ data: ctx.data, update: () => {}, loaded: true }) }));
vi.mock("@/components/shell/AppShell", () => ({ AppHeader: () => null }));

const { RegistrationPage } = await import("../RegistrationPage");
const render = (c: Case) => {
  ctx.data = c;
  return renderToStaticMarkup(createElement(RegistrationPage));
};

describe("相続登記の画面", () => {
  it("同じ地域の土地と家屋は、提出先の法務局を1つの枠にまとめ、見出しは財産の名前にする", () => {
    const html = render(structuredClone(demoCase));
    const card = html.slice(html.indexOf("提出先の法務局"), html.indexOf("1. 登記簿の内容を入れる"));
    expect(card).toContain("自宅敷地・自宅家屋");
    expect(card).toContain("マンション（架空レジデンス305号室）");
    // 枠は地域ごと（千代田区・横浜市）の2つ
    expect(card.split('class="rounded-lg border border-stone-200 p-3"').length - 1).toBe(2);
  });

  it("期限と司法書士への相談のすすめは見えたまま残し、条文はたたむ", () => {
    const html = render(structuredClone(demoCase));
    expect(html).toContain("期限は<strong>");
    expect(html).toContain("司法書士への相談をおすすめします。");
    expect(html.indexOf("不動産登記法76条の2")).toBeGreaterThan(html.indexOf("根拠（法律）"));
    expect(html).not.toContain("登記原因証明情報");
  });

  it("期限は、やることリスト・カレンダーと同じ（2024年3月以前に亡くなった方は2027年3月31日）", () => {
    const old = structuredClone(demoCase);
    old.decedent.deathDate = "2023-06-01";
    expect(render(old)).toContain("期限は<strong>2027年3月31日（水）</strong>");
    expect(render(structuredClone(demoCase))).toContain("期限は<strong>2029年3月15日（木）</strong>");
  });

  it("不動産がないときは、1行とボタンだけ出す", () => {
    const c = structuredClone(demoCase);
    c.assets = c.assets.filter((a) => a.kind !== "land" && a.kind !== "building" && a.kind !== "condo");
    const html = render(c);
    expect(html).toContain("まだ不動産がありません。");
    expect(html).toContain('href="/case/assets"');
  });
});
