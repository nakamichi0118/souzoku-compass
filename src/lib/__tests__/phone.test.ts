import { describe, expect, it } from "vitest";
import { joinPhone, phoneParts } from "../phone";

describe("電話番号を3つの枠に分ける", () => {
  it("区切りがあればその区切りで", () => {
    expect(phoneParts("0466-12-3456")).toEqual(["0466", "12", "3456"]);
    expect(phoneParts("０３（１２３４）５６７８")).toEqual(["03", "1234", "5678"]);
  });
  it("区切りがなければ桁数と先頭の番号から", () => {
    expect(phoneParts("09012345678")).toEqual(["090", "1234", "5678"]);
    expect(phoneParts("0312345678")).toEqual(["03", "1234", "5678"]);
    expect(phoneParts("0451234567")).toEqual(["045", "123", "4567"]);
    expect(phoneParts("0120123456")).toEqual(["0120", "123", "456"]);
    expect(phoneParts("")).toEqual(["", "", ""]);
  });
  it("保存はハイフンつなぎ、後ろの空の枠は落とす", () => {
    expect(joinPhone(["090", "1234", "5678"])).toBe("090-1234-5678");
    expect(joinPhone(["03", "", ""])).toBe("03");
    expect(joinPhone(["", "", ""])).toBe("");
    // 途中の枠が空でも、読み戻したときにずれない
    expect(phoneParts(joinPhone(["03", "", "5678"]))).toEqual(["03", "", "5678"]);
  });
});
