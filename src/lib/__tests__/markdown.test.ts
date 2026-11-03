import { describe, expect, it } from "vitest";
import { classifyLine } from "@/components/compass/markdownLine";

describe("コンパスくんの回答の行の見分け方", () => {
  it("番号付きの箇条書きを見分ける", () => {
    expect(classifyLine("1. 戸籍を集める")).toEqual({ kind: "item", ordered: true, text: "戸籍を集める" });
    expect(classifyLine("2) 申告書を作る")).toEqual({ kind: "item", ordered: true, text: "申告書を作る" });
    expect(classifyLine("3．提出する")).toEqual({ kind: "item", ordered: true, text: "提出する" });
    expect(classifyLine("10.期限を確かめる")).toEqual({ kind: "item", ordered: true, text: "期限を確かめる" });
  });

  it("小数で始まる行は箇条書きにせず、数字をそのまま残す", () => {
    expect(classifyLine("1.5倍になります。")).toEqual({ kind: "text", text: "1.5倍になります。" });
    expect(classifyLine("0.8を掛けます。")).toEqual({ kind: "text", text: "0.8を掛けます。" });
    expect(classifyLine("10.21%の税率です")).toEqual({ kind: "text", text: "10.21%の税率です" });
  });

  it("見出し・箇条書き・空行・ふつうの文を見分ける", () => {
    expect(classifyLine("## まとめ")).toEqual({ kind: "heading", text: "まとめ" });
    expect(classifyLine("- 預金")).toEqual({ kind: "item", ordered: false, text: "預金" });
    expect(classifyLine("   ")).toEqual({ kind: "blank" });
    expect(classifyLine("  ふつうの文です。 ")).toEqual({ kind: "text", text: "ふつうの文です。" });
  });
});
