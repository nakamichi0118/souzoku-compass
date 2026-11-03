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

import { roadsFromGeoJSON, widthOf } from "../roads";
describe("国土地理院の道路中心線", () => {
  it("幅員区分から幅を求め、緯度経度の順に直す", () => {
    expect(widthOf("5.5m-13m未満")).toBe(9.25);
    expect(widthOf("3m未満")).toBeCloseTo(2.4);
    expect(widthOf(undefined)).toBeUndefined();
    const r = roadsFromGeoJSON({ features: [{ geometry: { type: "LineString", coordinates: [[130.42, 33.59], [130.421, 33.59]] }, properties: { rnkWidth: "3m-5.5m未満" } }] });
    expect(r[0].line[0]).toEqual([33.59, 130.42]);
    expect(r[0].width).toBe(4.25);
  });
});

import { buildLayout, parseNeighbors, type Neighbor } from "../rosenkaIndex";
describe("路線価図のとなりの図と並び", () => {
  const BASE = "https://www.rosenka.nta.go.jp/main_r08/fukuoka/fukuoka/prices/";

  it("「当図と接続している路線価図番号」の表から、となりの図を東西南北つきで取り出す", () => {
    // 属性の書き方がまちまち、閉じタグの抜け、タグの入れ子、空のマス、外側のレイアウト用の表
    const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS"><title>路線価図 09073</title></head>
      <body><table width="100%" border="0"><tr><td>
        <p class="ttl">当図と接続している路線価図番号</p>
        <TABLE class="setsuzoku" border=1 cellpadding="2">
          <TR>
            <TD align="center"><A HREF="09065f.htm">09065</A></TD>
            <td align=center><a class="lnk" href='./09066f.htm' target="_self"><font size="2">09066</font></a></td>
            <td><a href="https://www.rosenka.nta.go.jp/main_r08/fukuoka/fukuoka/prices/html/09067f.htm">09067</a></td>
          </TR>
          <tr>
            <td><a href="09072f.htm">09072</a>
            <th bgcolor="#ffcc99"><b>当&nbsp;図</b></th>
            <td>&nbsp;<a href="09074f.htm">09074</a>&nbsp;</td>
          </tr>
          <tr><td><a href=09078f.htm>09078</a></td><td><a href="09079f.htm">09079</a></td><td>　</td></tr>
        </TABLE>
      </td></tr>
      <tr><td><a href="../../ratios/html/j16101rf.htm">評価倍率表</a></td></tr></table>
      <table><tr><td><a href="09001f.htm">09001</a></td></tr></table></body></html>`;
    expect(parseNeighbors(html)).toEqual([
      { no: "09065", dx: -1, dy: -1 },
      { no: "09066", dx: 0, dy: -1 },
      { no: "09067", dx: 1, dy: -1 },
      { no: "09072", dx: -1, dy: 0 },
      { no: "09074", dx: 1, dy: 0 },
      { no: "09078", dx: -1, dy: 1 },
      { no: "09079", dx: 0, dy: 1 },
    ]);
  });

  it("見出しが表の中にある形、北の行がない端の図、表がないページ", () => {
    const html = `<table><caption>接続図</caption><tbody>
      <tr><th colspan="3">当図と接続している路線価図番号</th></tr>
      <tr><td></td><td>当図</td><td><a href="html/15030f.htm"><span>15030</span></a></td></tr>
      <tr><td><a href="html/15040f.htm">15040</a></td><td><a href="html/15041f.htm">15041</a></td><td></td></tr>
    </tbody></table>`;
    expect(parseNeighbors(html)).toEqual([
      { no: "15030", dx: 1, dy: 0 },
      { no: "15040", dx: -1, dy: 1 },
      { no: "15041", dx: 0, dy: 1 },
    ]);
    expect(parseNeighbors(`<p>当図と接続している路線価図番号</p><table><tr><td><a href="1f.htm">戻る</a></td></tr></table>`)).toEqual([]);
    expect(parseNeighbors("")).toEqual([]);
  });

  // 09073 を中心に、09079 が南、09074 が東
  const grid = (rows: (string | null)[][]): Neighbor[] =>
    rows.flatMap((r, y) => r.flatMap((no, x) => (no && !(x === 1 && y === 1) ? [{ no, dx: (x - 1) as -1 | 0 | 1, dy: (y - 1) as -1 | 0 | 1 }] : [])));
  const n09073 = grid([["09065", "09066", "09067"], ["09072", null, "09074"], ["09078", "09079", "09080"]]);
  const n09079 = grid([["09072", "09073", "09074"], ["09078", null, "09080"], ["09084", "09085", "09086"]]);
  const n09074 = grid([["09066", "09067", "09068"], ["09073", null, "09075"], ["09079", "09080", "09081"]]);

  it("3枚の候補とそのとなりの図を、最初の候補を基準に並べる", () => {
    const layout = buildLayout(["09073", "09079", "09074"], new Map([["09073", n09073], ["09079", n09079], ["09074", n09074]]), BASE);
    const at = (no: string) => layout.find((l) => l.no === no);
    expect(at("09073")).toEqual({ no: "09073", col: 0, row: 0, candidate: true, pdfUrl: `${BASE}pdf/09073.pdf` });
    expect(at("09079")).toMatchObject({ col: 0, row: 1, candidate: true });
    expect(at("09074")).toMatchObject({ col: 1, row: 0, candidate: true });
    expect(at("09080")).toMatchObject({ col: 1, row: 1, candidate: false });
    expect(at("09068")).toMatchObject({ col: 2, row: -1 });
    expect(at("09081")).toMatchObject({ col: 2, row: 1 });
    expect(at("09085")).toMatchObject({ col: 0, row: 2 });
    // 重なりなし・北西から南東の順
    expect(layout.map((l) => `${l.no}@${l.col},${l.row}`)).toEqual([
      "09065@-1,-1", "09066@0,-1", "09067@1,-1", "09068@2,-1",
      "09072@-1,0", "09073@0,0", "09074@1,0", "09075@2,0",
      "09078@-1,1", "09079@0,1", "09080@1,1", "09081@2,1",
      "09084@-1,2", "09085@0,2", "09086@1,2",
    ]);
    expect(layout.filter((l) => l.candidate).map((l) => l.no).sort()).toEqual(["09073", "09074", "09079"]);
  });

  it("ページが読めなかった図も、ほかの図のつながりから逆にたどって並べる。つながらない候補は並べない", () => {
    const layout = buildLayout(["09079", "09073", "09200"], new Map([["09073", n09073]]), BASE);
    const at = (no: string) => layout.find((l) => l.no === no);
    expect(at("09079")).toMatchObject({ col: 0, row: 0, candidate: true });
    expect(at("09073")).toMatchObject({ col: 0, row: -1, candidate: true });
    expect(at("09065")).toMatchObject({ col: -1, row: -2 });
    expect(at("09200")).toBeUndefined();
    expect(layout).toHaveLength(9);
    expect(buildLayout([], new Map(), BASE)).toEqual([]);
    expect(buildLayout(["09073"], new Map(), BASE)).toEqual([{ no: "09073", col: 0, row: 0, candidate: true, pdfUrl: `${BASE}pdf/09073.pdf` }]);
  });

  it("評価倍率表の市区町村一覧（…rf.htm）を読む", () => {
    const html = `<ul><li><a href="html/j16101rf.htm">福岡市博多区</a></li><li><A HREF='html/j46341rf.htm'><span>糟屋郡　粕屋町</span></A></li>
      <li><a href="../prices/j16102fr.htm">中央区（路線価図）</a></li><li><a href="../index.htm">戻る</a></li></ul>`;
    const cities = parseCityList(html, "rf");
    expect(cities).toEqual([
      { name: "福岡市博多区", href: "html/j16101rf.htm" },
      { name: "糟屋郡　粕屋町", href: "html/j46341rf.htm" },
    ]);
    expect(pickCity(cities, "糟屋郡粕屋町")?.href).toBe("html/j46341rf.htm");
    // 既定では町丁名索引（…fr.htm）だけ
    expect(parseCityList(html)).toEqual([{ name: "中央区（路線価図）", href: "../prices/j16102fr.htm" }]);
  });
});
