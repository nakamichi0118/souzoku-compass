import { afterEach, describe, expect, it, vi } from "vitest";
import { findRatioPdf, findSheets, matchCity, normalizeTown, parseCityList, parseMuni, parseTownIndex, pickCity } from "../rosenkaIndex";

describe("路線価図の図番号さがし", () => {
  it("町丁目名の表記ゆれをそろえる", () => {
    expect(normalizeTown("霞が関三丁目")).toBe("霞が関3");
    expect(normalizeTown("霞ヶ関３")).toBe("霞が関3");
    expect(normalizeTown("大字見本十二丁目")).toBe("見本12");
    expect(normalizeTown("一番町")).toBe("1番町");
  });

  it("名前の途中にある漢数字（条・線・号・番・丁目の前）も、両方の書き方で同じになる", () => {
    // 国土地理院は漢数字、国税庁の索引は数字
    const same = (a: string, b: string) => expect(normalizeTown(a)).toBe(normalizeTown(b));
    expect(normalizeTown("北一条西二丁目")).toBe("北1条西2");
    same("北一条西二丁目", "北１条西２丁目");
    same("北一条西二丁目", "北１条西２");
    same("南二十一条西十一丁目", "南２１条西１１");
    same("東一線", "東１線");
    same("北五号", "北５号");
    same("一番町", "１番町");
    same("麻布十番一丁目", "麻布十番１");
    same("上十条三丁目", "上十条３");
    // 条・線・号・番・丁目の前でない漢数字や、数としておかしい並びはそのまま
    expect(normalizeTown("八丁堀")).toBe("八丁堀");
    expect(normalizeTown("三田")).toBe("三田");
    expect(normalizeTown("九十九里")).toBe("九十九里");
    expect(normalizeTown("一一丁目")).toBe("一一丁目");
    // 別の町どうしが同じにならない
    expect(normalizeTown("北一条西二丁目")).not.toBe(normalizeTown("北二条西一丁目"));
    expect(normalizeTown("一番町")).not.toBe(normalizeTown("北一番丁"));
  });

  it("条丁目の町名（北１条西２丁目）も索引から見つける", () => {
    const index = `<table><tr><td>北１条西２丁目</td><td><a href="html/01003f.htm">01003</a></td></tr>
      <tr><td>北１条西３</td><td><a href="html/01004f.htm">01004</a></td></tr>
      <tr><td>一番町</td><td><a href="html/01009f.htm">01009</a></td></tr></table>`;
    const m = parseTownIndex(index);
    expect(m.get(normalizeTown("北一条西二丁目"))).toEqual(["01003"]);
    expect(m.get(normalizeTown("北一条西三丁目"))).toEqual(["01004"]);
    expect(m.get(normalizeTown("１番町"))).toEqual(["01009"]);
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
    // 都道府県名つきで載っていても、名前がそのまま同じものとして選ぶ
    expect(pickCity([{ name: "福岡県福岡市博多区", href: "j16101fr.htm" }, { name: "博多区", href: "j99999fr.htm" }], "福岡市博多区", "福岡県")?.href).toBe("j16101fr.htm");
    const index = `<table><tr><th class="th_idx" colspan="4">は</th></tr>
      <tr><th class="cell_empty"></th><th>博多駅前４</th><td><a href="html/09078f.htm">09078</a></td><td><a href="html/09079f.htm">09079</a></td><td><a href="html/09084f.htm">09084</a></td></tr>
      <tr><th class="cell_empty"></th><th>博多駅中央街</th><td><a href="html/09073f.htm">09073</a></td><td><a href="html/09079f.htm">09079</a></td></tr></table>`;
    const m = parseTownIndex(index);
    expect(m.get(normalizeTown("博多駅前四丁目"))).toEqual(["09078", "09079", "09084"]);
    expect(m.get("博多駅中央街")).toEqual(["09073", "09079"]);
  });

  it("区名だけの一覧で、別の市に同じ名前の区があるときは、どちらとも決めない", () => {
    // 横浜市と相模原市の「緑区」「南区」（並び順で横浜市を選んでしまわない）
    const html = `<p>横浜市</p><a href="d14113fr.htm">緑区</a><a href="d14114fr.htm">南区</a><a href="d14116fr.htm">鶴見区</a>
      <p>相模原市</p><a href="d14151fr.htm">緑区</a><a href="d14153fr.htm">南区</a><a href="d14152fr.htm">中央区</a>`;
    const cities = parseCityList(html);
    expect(pickCity(cities, "相模原市緑区")).toBeUndefined();
    expect(matchCity(cities, "相模原市緑区")).toEqual({ ambiguous: true });
    expect(pickCity(cities, "横浜市南区")).toBeUndefined();
    // 1つしかない区は選ぶ
    expect(pickCity(cities, "相模原市中央区")?.href).toBe("d14152fr.htm");
    expect(matchCity(cities, "横浜市鶴見区")).toEqual({ hit: { name: "鶴見区", href: "d14116fr.htm" }, ambiguous: false });
    // 名前がそのまま同じものがあれば、それを選ぶ
    const full = parseCityList(`<a href="d14113rf.htm">横浜市緑区</a><a href="d14151rf.htm">相模原市緑区</a>`, "rf");
    expect(pickCity(full, "相模原市緑区")?.href).toBe("d14151rf.htm");
    // 同じ市区町村が2回載っているだけなら決められる
    expect(pickCity([...cities, { name: "中央区", href: "./d14152fr.htm" }], "相模原市中央区")?.href).toBe("d14152fr.htm");
    expect(matchCity(cities, "川崎市川崎区")).toEqual({ ambiguous: false });
  });

  it("表の形に関係なく、町丁目名に続く図番号を取り出す", () => {
    const table = `<table><tr><th>町丁名</th><th>路線価図番号</th></tr>
      <tr><td>霞が関３</td><td><a href="html/15029f.htm">15029</a>&nbsp;<a href="html/15030f.htm">15030</a></td></tr>
      <tr><td>一番町</td><td><a href="html/15009f.htm">15009</a></td></tr></table>`;
    const m = parseTownIndex(table);
    expect(m.get("霞が関3")).toEqual(["15029", "15030"]);
    expect(m.get(normalizeTown("一番町"))).toEqual(["15009"]);
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

  it("ページが読めなかった図も、ほかの図のつながりから逆にたどって並べる。つながらない候補は下に分けて並べる", () => {
    const layout = buildLayout(["09079", "09073", "09200"], new Map([["09073", n09073]]), BASE);
    const at = (no: string) => layout.find((l) => l.no === no);
    expect(at("09079")).toMatchObject({ col: 0, row: 0, candidate: true });
    expect(at("09079")?.separate).toBeUndefined();
    expect(at("09073")).toMatchObject({ col: 0, row: -1, candidate: true });
    expect(at("09065")).toMatchObject({ col: -1, row: -2 });
    // 最初のかたまり（-2〜0行目）の下に1行あけて、左端から
    expect(at("09200")).toEqual({ no: "09200", col: -1, row: 2, candidate: true, pdfUrl: `${BASE}pdf/09200.pdf`, separate: true });
    expect(layout).toHaveLength(10);
    expect(buildLayout([], new Map(), BASE)).toEqual([]);
    expect(buildLayout(["09073"], new Map(), BASE)).toEqual([{ no: "09073", col: 0, row: 0, candidate: true, pdfUrl: `${BASE}pdf/09073.pdf` }]);
  });

  it("最初の候補とつながらない候補も、そのとなりの図といっしょに、重ならないように並べる", () => {
    const east = (no: string): Neighbor[] => [{ no, dx: 1, dy: 0 }];
    const layout = buildLayout(["05001", "05010", "05020", "05030"], new Map([["05001", east("05002")], ["05010", east("05011")]]), BASE);
    expect(layout.map((l) => `${l.no}@${l.col},${l.row}${l.separate ? "*" : ""}`)).toEqual([
      "05001@0,0", "05002@1,0",
      "05010@0,2*", "05011@1,2*",
      // 幅（3列）をこえるので次の段へ
      "05020@0,4*", "05030@2,4*",
    ]);
    expect(layout.filter((l) => l.candidate).map((l) => l.no)).toEqual(["05001", "05010", "05020", "05030"]);
    expect(new Set(layout.map((l) => `${l.col},${l.row}`)).size).toBe(layout.length);
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

describe("地点から路線価図と評価倍率表を探す（国税庁・国土地理院にはつながない）", () => {
  afterEach(() => vi.unstubAllGlobals());

  const NTA = "https://www.rosenka.nta.go.jp/main_r08";
  const MUNI = `GSI.MUNI_ARRAY["14113"] = '14,神奈川県,14113,横浜市　緑区';
GSI.MUNI_ARRAY["14151"] = '14,神奈川県,14151,相模原市　緑区';
GSI.MUNI_ARRAY["27127"] = '27,大阪府,27127,大阪市　北区';
GSI.MUNI_ARRAY["27146"] = '27,大阪府,27146,堺市　北区';`;
  /** 緯度ごとの地点（市区町村コードと町丁目名） */
  const PLACES: Record<string, { muniCd: string; lv01Nm: string }> = {
    "35.6": { muniCd: "14151", lv01Nm: "橋本一丁目" },
    "35.5": { muniCd: "14113", lv01Nm: "長津田一丁目" },
    "34.6": { muniCd: "27146", lv01Nm: "新金岡町" },
  };
  const PAGES: Record<string, string> = {
    "https://maps.gsi.go.jp/js/muni.js": MUNI,
    // 路線価図の一覧は区名だけ。横浜市と相模原市に同じ名前の区がある
    [`${NTA}/tokyo/kanagawa/prices/city_frm.htm`]: `<p>横浜市</p><a href="d14113fr.htm">緑区</a><p>相模原市</p><a href="d14151fr.htm">緑区</a>`,
    // 評価倍率表の一覧は市の名前つき
    [`${NTA}/tokyo/kanagawa/ratios/city_frm.htm`]: `<a href="html/d14113rf.htm">横浜市緑区</a><a href="html/d14151rf.htm">相模原市緑区</a>`,
    [`${NTA}/tokyo/kanagawa/prices/d14151fr.htm`]: `<tr><td>橋本１</td><td><a href="html/31001f.htm">31001</a></td></tr>`,
    [`${NTA}/tokyo/kanagawa/prices/d14113fr.htm`]: `<tr><td>長津田１</td><td><a href="html/21001f.htm">21001</a></td></tr>`,
    [`${NTA}/osaka/osaka/prices/city_frm.htm`]: `<p>大阪市</p><a href="c27127fr.htm">北区</a><p>堺市</p><a href="c27146fr.htm">北区</a>`,
  };
  const stub = () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://mreversegeocoder.gsi.go.jp/")) {
        const lat = new URL(url).searchParams.get("lat") ?? "";
        return new Response(JSON.stringify({ results: PLACES[lat] }), { status: 200 });
      }
      const page = PAGES[url];
      return page === undefined ? new Response("", { status: 404 }) : new Response(page, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("区名だけの一覧でも、評価倍率表の一覧の名前から正しい市の区を選ぶ（相模原市緑区）", async () => {
    stub();
    const r = await findSheets(35.6, 139.3);
    expect(r).toMatchObject({ pref: "神奈川県", city: "相模原市緑区", town: "橋本一丁目" });
    expect(r.indexUrl).toBe(`${NTA}/tokyo/kanagawa/prices/d14151fr.htm`);
    expect(r.ratioUrl).toBe(`${NTA}/tokyo/kanagawa/ratios/pdf/d14151rt.pdf`);
    expect(r.sheets.map((s) => s.no)).toEqual(["31001"]);
    expect((await findRatioPdf(35.6, 139.3)).pdfUrl).toBe(`${NTA}/tokyo/kanagawa/ratios/pdf/d14151rt.pdf`);

    const y = await findSheets(35.5, 139.5);
    expect(y.indexUrl).toBe(`${NTA}/tokyo/kanagawa/prices/d14113fr.htm`);
    expect(y.sheets.map((s) => s.no)).toEqual(["21001"]);
    expect((await findRatioPdf(35.5, 139.5)).pdfUrl).toBe(`${NTA}/tokyo/kanagawa/ratios/pdf/d14113rt.pdf`);
  });

  it("どちらの区か決められないときは、別の市の図や倍率表を返さず、一覧から選ぶよう案内する", async () => {
    const fetchMock = stub();
    const r = await findSheets(34.6, 135.5);
    expect(r).toMatchObject({ city: "堺市北区", sheets: [], indexUrl: `${NTA}/osaka/osaka/prices/city_frm.htm` });
    expect(r.ratioUrl).toBeUndefined();
    expect(r.message).toMatch(/一覧から選んでください/);
    // 大阪市北区の索引は開かない
    expect(fetchMock.mock.calls.map(([u]) => String(u))).not.toContain(`${NTA}/osaka/osaka/prices/c27127fr.htm`);
    // 評価倍率表の一覧が取れなければ、「見つからない」ではなく探せなかったことにする
    await expect(findRatioPdf(34.6, 135.5)).rejects.toThrow(/取得できませんでした/);
  });
});
