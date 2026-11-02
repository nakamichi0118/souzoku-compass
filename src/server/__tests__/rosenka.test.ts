import { describe, expect, it } from "vitest";
import { checkSheetUrl } from "../rosenka";

describe("路線価図URLの確認", () => {
  it("国税庁の路線価図PDFは許可", () => {
    expect(checkSheetUrl("https://www.rosenka.nta.go.jp/main_r08/tokyo/tokyo/prices/pdf/12345.pdf")).toBeInstanceOf(URL);
  });
  it.each([
    "http://www.rosenka.nta.go.jp/a.pdf",
    "https://evil.example.com/a.pdf",
    "https://www.rosenka.nta.go.jp.evil.com/a.pdf",
    "https://user@www.rosenka.nta.go.jp/a.pdf",
    "https://www.rosenka.nta.go.jp:8443/a.pdf",
    "https://www.rosenka.nta.go.jp/index.htm",
    "not a url",
  ])("%s は拒否", (u) => expect(typeof checkSheetUrl(u)).toBe("string"));
});
