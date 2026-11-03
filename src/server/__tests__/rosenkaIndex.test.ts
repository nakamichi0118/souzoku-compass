import { describe, expect, it } from "vitest";
import { normalizeTown, parseCityList, parseMuni, parseTownIndex, pickCity } from "../rosenkaIndex";

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

  it("区名だけで載っている一覧（福岡市博多区 → 博多区）からも町丁名索引を見つける", () => {
    const html = `<li><a href="j16101fr.htm">博多区</a></li><li><a href="j16102fr.htm">中央区</a></li><li><a href="j16201fr.htm">北九州市小倉北区</a></li>`;
    const cities = parseCityList(html);
    expect(cities.map((c) => c.href)).toEqual(["j16101fr.htm", "j16102fr.htm", "j16201fr.htm"]);
    expect(pickCity(cities, "福岡市博多区")?.href).toBe("j16101fr.htm");
    expect(pickCity(cities, "北九州市小倉北区")?.href).toBe("j16201fr.htm");
    expect(pickCity(cities, "福岡市東区")).toBeUndefined();
    const index = `<table><tr><th class="th_idx" colspan="4">は</th></tr>
      <tr><th class="cell_empty"></th><th>博多駅前４</th><td><a href="html/09078f.htm">09078</a></td><td><a href="html/09079f.htm">09079</a></td><td><a href="html/09084f.htm">09084</a></td></tr>
      <tr><th class="cell_empty"></th><th>博多駅中央街</th><td><a href="html/09073f.htm">09073</a></td><td><a href="html/09079f.htm">09079</a></td></tr></table>`;
    const m = parseTownIndex(index);
    expect(m.get(normalizeTown("博多駅前四丁目"))).toEqual(["09078", "09079", "09084"]);
    expect(m.get("博多駅中央街")).toEqual(["09073", "09079"]);
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
