import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NumInput, OptionalNumInput, YenInput } from "../index";
import { Panel } from "../Panel";

describe("単位つきの入力欄（スマホ）", () => {
  it("入力欄は幅いっぱい（w-full）にして、決まった幅で枠の外へはみ出さない", () => {
    const yen = renderToStaticMarkup(createElement(YenInput, { value: 1000, onChange: () => {} }));
    const num = renderToStaticMarkup(createElement(NumInput, { value: 12.5, onChange: () => {}, unit: "㎡" }));
    const opt = renderToStaticMarkup(createElement(OptionalNumInput, { value: undefined, onChange: () => {}, accept: () => true }));
    for (const html of [yen, num, opt]) expect(html).toMatch(/<input [^>]*class="w-full min-w-0 flex-1 /);
  });
});

describe("マイページの枠の見出し（Panel）", () => {
  it("「…を見る ›」は縮めず折り返さない。入らないときは見出しの下へ回す", () => {
    const html = renderToStaticMarkup(Panel({ title: "相続税申告の進捗（7ステップ）", more: { href: "/case/assets", label: "申告書づくりへ" }, children: "x" }));
    expect(html).toMatch(/<div class="[^"]*\bflex-wrap\b/);
    expect(html).toMatch(/<a [^>]*class="[^"]*\bml-auto shrink-0 whitespace-nowrap [^"]*"[^>]*>申告書づくりへ<!-- --> ›<\/a>|<a [^>]*class="[^"]*\bml-auto shrink-0 whitespace-nowrap [^"]*"[^>]*>申告書づくりへ ›<\/a>/);
  });
});
