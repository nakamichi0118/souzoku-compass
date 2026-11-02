import { describe, expect, it } from "vitest";
import { normalizeTown, parseCityList, parseMuni, parseTownIndex } from "../rosenkaIndex";

describe("路線価図の図番号さがし", () => {
  it("町丁目名の表記ゆれをそろえる", () => {
    expect(normalizeTown("霞が関三丁目")).toBe("霞が関3");
    expect(normalizeTown("霞ヶ関３")).toBe("霞が関3");
    expect(normalizeTown("大字見本十二丁目")).toBe("見本12");
    expect(normalizeTown("一番町")).toBe("一番町");
  });

  it("市区町村一覧から町丁名索引のリンクを取り出す", () => {
    const html = `<ul><li><a href="d24204fr.htm">千代田区</a></li><li><A HREF='./d24301fr.htm'><span>横浜市　鶴見区</span></A></li><li><a href="../index.htm">戻る</a></li></ul>`;
    expect(parseCityList(html)).toEqual([
      { name: "千代田区", href: "d24204fr.htm" },
      { name: "横浜市　鶴見区", href: "./d24301fr.htm" },
    ]);
  });

  it("表の形に関係なく、町丁目名に続く図番号を取り出す", () => {
    const table = `<table><tr><th>町丁名</th><th>路線価図番号</th></tr>
      <tr><td>霞が関３</td><td><a href="html/15029f.htm">15029</a>&nbsp;<a href="html/15030f.htm">15030</a></td></tr>
      <tr><td>一番町</td><td><a href="html/15009f.htm">15009</a></td></tr></table>`;
    const m = parseTownIndex(table);
    expect(m.get("霞が関3")).toEqual(["15029", "15030"]);
    expect(m.get("一番町")).toEqual(["15009"]);
    // 1行に2つの町が並ぶ形
    const twoCol = `<tr><td>内神田１</td><td><a href="https://x/html/16012f.htm">16012</a></td><td>内神田２</td><td><a href="https://x/html/16016f.htm">16016</a></td></tr>`;
    const m2 = parseTownIndex(twoCol);
    expect(m2.get("内神田1")).toEqual(["16012"]);
    expect(m2.get("内神田2")).toEqual(["16016"]);
  });

  it("国土地理院の市区町村コード表を読む", () => {
    const js = `GSI.MUNI_ARRAY["13101"] = '13,東京都,13101,千代田区';\nGSI.MUNI_ARRAY["14101"] = '14,神奈川県,14101,横浜市　鶴見区';\nGSI.MUNI_ARRAY["01100"] = '1,北海道,1100,札幌市';`;
    const m = parseMuni(js);
    expect(m.get("13101")).toEqual({ pref: "東京都", city: "千代田区" });
    expect(m.get("14101")?.city).toBe("横浜市鶴見区");
    expect(m.get("1100")?.pref).toBe("北海道");
  });
});
