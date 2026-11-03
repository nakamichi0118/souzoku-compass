/**
 * 地図でクリックした場所から、国税庁の路線価図（令和8年分）の図番号を探す。
 *
 * 1. 国土地理院の逆ジオコーダで、市区町村コードと町丁目名を調べる
 * 2. 国土地理院の市区町村コード表で、都道府県名・市区町村名に直す
 * 3. 国税庁「路線価図」の市区町村一覧から、その市区町村の町丁名索引のページを開く
 * 4. 町丁名索引で、その町丁目が載っている図番号を取り出す（PDF の URL を組み立てる）
 * 5. 候補の図のページにある「接続している図」の表から、図どうしの並び（東西南北）を組み立てる
 *
 * 図の位置（枠）は推定しない。図番号の候補と並びを返すだけで、位置合わせは地図上で行う。
 * あわせて、その市区町村の「評価倍率表」（路線価のない地域で使う表）の PDF の URL も返す。
 */

const NTA = "https://www.rosenka.nta.go.jp";
const YEAR_DIR = "main_r08";

/** 都道府県 → 国税庁サイトのフォルダ（国税局/都道府県） */
export const PREF_DIRS: Record<string, string> = {
  北海道: "sapporo/hokkaido",
  青森県: "sendai/aomori",
  岩手県: "sendai/iwate",
  宮城県: "sendai/miyagi",
  秋田県: "sendai/akita",
  山形県: "sendai/yamagata",
  福島県: "sendai/fukusima",
  茨城県: "kanto/ibaraki",
  栃木県: "kanto/tochigi",
  群馬県: "kanto/gunma",
  埼玉県: "kanto/saitama",
  新潟県: "kanto/niigata",
  長野県: "kanto/nagano",
  東京都: "tokyo/tokyo",
  千葉県: "tokyo/chiba",
  神奈川県: "tokyo/kanagawa",
  山梨県: "tokyo/yamanasi",
  富山県: "kanazawa/toyama",
  石川県: "kanazawa/isikawa",
  福井県: "kanazawa/fukui",
  愛知県: "nagoya/aichi",
  岐阜県: "nagoya/gifu",
  静岡県: "nagoya/sizuoka",
  三重県: "nagoya/mie",
  大阪府: "osaka/osaka",
  奈良県: "osaka/nara",
  和歌山県: "osaka/wakayama",
  滋賀県: "osaka/shiga",
  京都府: "osaka/kyoto",
  兵庫県: "osaka/hyogo",
  鳥取県: "hirosima/tottori",
  島根県: "hirosima/simane",
  岡山県: "hirosima/okayama",
  広島県: "hirosima/hirosima",
  山口県: "hirosima/yamaguti",
  徳島県: "takamatu/tokusima",
  香川県: "takamatu/kagawa",
  愛媛県: "takamatu/ehime",
  高知県: "takamatu/koti",
  福岡県: "fukuoka/fukuoka",
  佐賀県: "fukuoka/saga",
  長崎県: "fukuoka/nagasaki",
  熊本県: "kumamoto/kumamoto",
  大分県: "kumamoto/oita",
  宮崎県: "kumamoto/miyazaki",
  鹿児島県: "kumamoto/kagosima",
  沖縄県: "okinawa/okinawa",
};

const KANJI_DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 漢数字（〜九十九）を数字に */
function kanjiNumber(s: string): number {
  if (s === "十") return 10;
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? KANJI_DIGIT[m[1]] : 1) * 10 + (m[2] ? KANJI_DIGIT[m[2]] : 0);
  return KANJI_DIGIT[s] ?? NaN;
}

/**
 * 町丁目名の表記ゆれをそろえる（例：「霞ヶ関三丁目」「霞が関３」→「霞が関3」、「北一条西二丁目」「北１条西２」→「北1条西2」）。
 * 国土地理院は漢数字、国税庁の索引は数字で書くことが多いので、「条」「線」「号」「番」「丁目」の前の漢数字は
 * 名前のどこにあっても数字にする（「一番町」→「1番町」）。比べる両方に同じ変換をかけるので、どちらの書き方でも一致する。
 */
export function normalizeTown(s: string): string {
  let t = s.normalize("NFKC").replace(/[\s　]/g, "");
  t = t.replace(/^(大字|字)/, "");
  t = t.replace(/[ヶケヵ]/g, "が");
  t = t.replace(/[一二三四五六七八九十]+(?=条|線|号|番|丁目)/g, (k) => {
    const n = kanjiNumber(k);
    return Number.isNaN(n) ? k : String(n);
  });
  t = t.replace(/(\d+)丁目$/, "$1");
  return t;
}

/** 市区町村名をそろえる（空白を除く） */
export const normalizeCity = (s: string) => s.normalize("NFKC").replace(/[\s　]/g, "");

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/**
 * 市区町村一覧のページから「市区町村名 → ページ」を取り出す。
 * 路線価図の一覧（prices/city_frm.htm）は町丁名索引（…fr.htm）、
 * 評価倍率表の一覧（ratios/city_frm.htm）は倍率表のページ（…rf.htm）へのリンクが並ぶ。
 */
export function parseCityList(html: string, suffix: "fr" | "rf" = "fr"): { name: string; href: string }[] {
  const out: { name: string; href: string }[] = [];
  const re = new RegExp(`<a\\s[^>]*href\\s*=\\s*["']?([^"'\\s>]*[a-z]\\d+${suffix}\\.htm)["']?[^>]*>([\\s\\S]*?)<\\/a>`, "gi");
  for (const m of html.matchAll(re)) {
    const name = decodeEntities(m[2].replace(/<[^>]+>/g, "")).trim();
    if (name) out.push({ name, href: m[1] });
  }
  return out;
}

/** 一覧のリンク（j16101fr.htm・j16101rf.htm）から市区町村の記号（j16101）を取り出す */
const cityCode = (href: string) => href.match(/([a-z]\d+)(?:fr|rf)\.htm$/i)?.[1];

/** 一覧の名前が、国土地理院の市区町村名とそのまま同じか（都道府県名つきで書かれていても同じとみなす） */
const sameCity = (name: string, city: string, pref?: string) => {
  const n = normalizeCity(name);
  return n === city || (!!pref && n === normalizeCity(pref) + city);
};

/** 同じ市区町村を指すかを比べるための印（一覧の記号、なければ名前） */
const cityId = (c: { name: string; href?: string }) => (c.href && cityCode(c.href)) || normalizeCity(c.name);

/**
 * 市区町村一覧から、国土地理院の市区町村名（例：福岡市博多区）に当たるものを選ぶ。
 * 1. 名前がそのまま同じもの（「福岡県福岡市博多区」のように都道府県名つきでもよい）
 * 2. なければ、一覧には「博多区」のように区名だけで載っていることがあるので、末尾が一致するもののうち
 *    いちばん長く一致するもの
 * 同じ長さで一致するものが別々の市区町村のとき（横浜市と相模原市の「緑区」など）は、決められないので選ばない
 * （ambiguous が true）。
 */
export function matchCity<T extends { name: string; href?: string }>(cities: T[], city: string, pref?: string): { hit?: T; ambiguous: boolean } {
  const len = (c: T) => normalizeCity(c.name).length;
  const exact = cities.filter((c) => sameCity(c.name, city, pref));
  let top = exact;
  if (!exact.length) {
    const hits = cities.filter((c) => {
      const n = normalizeCity(c.name);
      return n.length >= 2 && (n.endsWith(city) || city.endsWith(n));
    });
    const best = Math.max(0, ...hits.map(len));
    top = hits.filter((c) => len(c) === best);
  }
  const ids = new Set(top.map(cityId));
  return ids.size === 1 ? { hit: top[0], ambiguous: false } : { ambiguous: ids.size > 1 };
}

/** matchCity の選んだもの（決められなければ undefined） */
export function pickCity<T extends { name: string; href?: string }>(cities: T[], city: string, pref?: string): T | undefined {
  return matchCity(cities, city, pref).hit;
}

/**
 * 町丁名索引のページから、町丁目ごとの図番号を取り出す。
 * ページの表の形に依存しないよう、本文を「文字」と「図番号のリンク」の並びとして読み、
 * 町丁目名の後に続く図番号をその町丁目のものとする。
 */
export function parseTownIndex(html: string): Map<string, string[]> {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const tokens: ({ kind: "text"; v: string } | { kind: "sheet"; v: string })[] = [];
  const re = /<a\s[^>]*href\s*=\s*["']?[^"'\s>]*?(\d{5,6})f\.htm["']?[^>]*>[\s\S]*?<\/a>|<[^>]+>|([^<]+)/gi;
  for (const m of body.matchAll(re)) {
    if (m[1]) tokens.push({ kind: "sheet", v: m[1] });
    else if (m[2]) {
      const v = decodeEntities(m[2]).trim();
      if (v) tokens.push({ kind: "text", v });
    }
  }
  const map = new Map<string, string[]>();
  let current: string | null = null;
  for (const t of tokens) {
    if (t.kind === "text") {
      current = /\D/.test(t.v) && t.v.length <= 30 ? normalizeTown(t.v) : current;
    } else if (current) {
      const list = map.get(current) ?? [];
      if (!list.includes(t.v)) list.push(t.v);
      map.set(current, list);
    }
  }
  return map;
}

/** 国土地理院の市区町村コード表（muni.js）を読む */
export function parseMuni(js: string): Map<string, { pref: string; city: string }> {
  const map = new Map<string, { pref: string; city: string }>();
  for (const m of js.matchAll(/\[\s*["'](\d+)["']\s*\]\s*=\s*["']([^"']*)["']/g)) {
    const [, pref, , city] = m[2].split(",");
    if (pref && city) map.set(String(Number(m[1])), { pref, city: normalizeCity(city) });
  }
  return map;
}

// ---------------------------------------------------------------- 図どうしの並び

/** となりの図。dx は西 -1・東 +1、dy は北 -1・南 +1 */
export interface Neighbor {
  no: string;
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

/** 表のマスの文字（タグを除き、空白をつめる） */
const cellText = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, "")).normalize("NFKC").replace(/\s/g, "");

/** 表の1行をマスに分ける（横につながったマスは、その分だけ列を進める） */
function splitCells(row: string): { html: string; col: number }[] {
  const tags = [...row.matchAll(/<t[dh]\b([^>]*)>/gi)];
  let col = 0;
  return tags.map((m, i) => {
    const end = i + 1 < tags.length ? tags[i + 1].index : row.length;
    const html = row.slice(m.index + m[0].length, end).replace(/<\/t[dhr]>[\s\S]*$/i, "");
    const cell = { html, col };
    col += Math.max(1, Number(m[1].match(/colspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1));
    return cell;
  });
}

/** マスの中の図番号のリンク（…/html/09066f.htm）から図番号を取り出す */
function sheetNoIn(html: string): string | undefined {
  const href = html.match(/<a\s[^>]*href\s*=\s*["']?[^"'\s>]*?(\d{5,6})f\.htm/i)?.[1];
  if (href) return href;
  return /<a\s/i.test(html) ? cellText(html).match(/^(\d{5,6})$/)?.[1] : undefined;
}

/**
 * 路線価図のページにある「当図と接続している路線価図番号」の 3×3 の表から、となりの図を取り出す。
 * 真ん中のマスが「当図」で、上の行が北、左の列が西。空のマスやリンクのないマスは飛ばす。
 * 表が見つからなければ空の配列。
 */
export function parseNeighbors(html: string): Neighbor[] {
  const body = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  // ほかの表を中に持たない表（いちばん内側の表）だけを見る
  for (const t of body.matchAll(/<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table>/gi)) {
    const rows = t[1].split(/<tr\b[^>]*>/i).slice(1).map(splitCells);
    for (let r = 0; r < rows.length; r++) {
      const center = rows[r].find((c) => cellText(c.html) === "当図");
      if (!center) continue;
      const out: Neighbor[] = [];
      for (const dy of [-1, 0, 1] as const) {
        for (const c of rows[r + dy] ?? []) {
          const dx = c.col - center.col;
          if (dx < -1 || dx > 1 || (dx === 0 && dy === 0)) continue;
          const no = sheetNoIn(c.html);
          if (no && !out.some((n) => n.no === no)) out.push({ no, dx: dx as -1 | 0 | 1, dy });
        }
      }
      return out;
    }
  }
  return [];
}

/** 図の並びの1枚。col は東へ +1、row は南へ +1（最初の候補の図が 0, 0） */
export interface SheetLayoutItem {
  no: string;
  col: number;
  row: number;
  /** 町丁名索引で、その町丁目が載っているとされた図か */
  candidate: boolean;
  pdfUrl: string;
  /** 最初の候補の図とつながっていない図（並びの下に1行あけて、別のかたまりとして置く） */
  separate?: true;
}

/**
 * 候補の図と、そのとなりの図を、最初の候補を基準にした格子の上に並べる。
 * neighboursByNo は「図番号 → その図のページに書かれたとなりの図」。
 * 片方の図にしか書かれていないつながりも逆向きにたどる。
 * 最初の候補とつながらない候補も落とさず、そのとなりの図とひとかたまりにして、並びの下に1行あけて左から置く。
 * pricesBase は路線価図のフォルダ（…/prices/）。
 */
export function buildLayout(candidates: string[], neighboursByNo: Map<string, Neighbor[]>, pricesBase: string): SheetLayoutItem[] {
  if (!candidates.length) return [];
  const links = new Map<string, { no: string; dx: number; dy: number }[]>();
  const link = (a: string, b: string, dx: number, dy: number) => links.set(a, [...(links.get(a) ?? []), { no: b, dx, dy }]);
  for (const [no, list] of neighboursByNo) {
    for (const n of list) {
      link(no, n.no, n.dx, n.dy);
      link(n.no, no, -n.dx, -n.dy);
    }
  }
  const pos = new Map<string, { col: number; row: number }>();
  /** start からつながる図を、start を 0, 0 とした格子に並べる（すでにほかのかたまりに置いた図は飛ばす） */
  const cluster = (start: string) => {
    const local = new Map([[start, { col: 0, row: 0 }]]);
    const taken = new Set(["0,0"]);
    const queue = [start];
    while (queue.length) {
      const no = queue.shift()!;
      const p = local.get(no)!;
      for (const n of links.get(no) ?? []) {
        const q = { col: p.col + n.dx, row: p.row + n.dy };
        // 食い違う情報があっても、1つの図は1か所、1つの場所には1枚だけ（先に決まったほうを使う）
        if (pos.has(n.no) || local.has(n.no) || taken.has(`${q.col},${q.row}`)) continue;
        local.set(n.no, q);
        taken.add(`${q.col},${q.row}`);
        queue.push(n.no);
      }
    }
    return [...local];
  };
  for (const [no, p] of cluster(candidates[0])) pos.set(no, p);

  // つながらない候補のかたまりは、最初のかたまりの下に1行あけて、左から1列ずつあけて並べる（はみ出したら次の段へ）
  const main = [...pos.values()];
  const left = Math.min(...main.map((p) => p.col));
  const width = Math.max(3, Math.max(...main.map((p) => p.col)) - left + 1);
  let top = Math.max(...main.map((p) => p.row)) + 2;
  let x = left;
  let shelf = 0;
  const separate = new Set<string>();
  for (const c of candidates) {
    if (pos.has(c)) continue;
    const items = cluster(c);
    const c0 = Math.min(...items.map(([, p]) => p.col));
    const r0 = Math.min(...items.map(([, p]) => p.row));
    const w = Math.max(...items.map(([, p]) => p.col)) - c0 + 1;
    const h = Math.max(...items.map(([, p]) => p.row)) - r0 + 1;
    if (x > left && x + w > left + width) {
      top += shelf + 1;
      x = left;
      shelf = 0;
    }
    for (const [no, p] of items) {
      pos.set(no, { col: p.col - c0 + x, row: p.row - r0 + top });
      separate.add(no);
    }
    x += w + 1;
    shelf = Math.max(shelf, h);
  }

  const isCandidate = new Set(candidates);
  return [...pos]
    .map(([no, p]) => ({
      no,
      ...p,
      candidate: isCandidate.has(no),
      pdfUrl: `${pricesBase}pdf/${no}.pdf`,
      ...(separate.has(no) ? { separate: true as const } : {}),
    }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

// ---------------------------------------------------------------- 取得（キャッシュ付き）

const cache = new Map<string, Promise<string>>();

/** 取得する。keep=false（地点ごとに違う問い合わせ）は覚えておかない */
async function fetchText(url: string, keep = true): Promise<string> {
  let p = keep ? cache.get(url) : undefined;
  if (!p) {
    p = (async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${url} を取得できませんでした（${res.status}）`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const head = new TextDecoder("latin1").decode(buf.slice(0, 2048));
      const ct = res.headers.get("content-type") ?? "";
      const sjis = /shift_jis|sjis|x-sjis/i.test(ct) || /charset\s*=\s*["']?(shift_jis|sjis|x-sjis)/i.test(head);
      return new TextDecoder(sjis ? "shift_jis" : "utf-8").decode(buf);
    })();
    if (!keep) return p;
    // 町丁名の索引のページは全国で数千。使い続けても膨らみすぎないよう、古いものから消す
    if (cache.size >= 2000) cache.delete(cache.keys().next().value as string);
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

export interface SheetCandidate {
  no: string;
  pdfUrl: string;
  pageUrl: string;
}

export interface FindResult {
  pref: string | null;
  city: string | null;
  town: string | null;
  sheets: SheetCandidate[];
  /** 候補の図とそのとなりの図の並び（作れなかったときはない） */
  layout?: SheetLayoutItem[];
  /** 町丁名索引のページ（自動で見つからなかったときに案内する） */
  indexUrl?: string;
  /** この市区町村の評価倍率表の PDF（見つかったとき） */
  ratioUrl?: string;
  message?: string;
}

type Place = { pref: string; city: string; town: string | null; dir: string };
type NoPlace = { pref: string | null; city: string | null; town: string | null; message: string };

/** 国土地理院の逆ジオコーダで、地点の都道府県・市区町村・町丁目と国税庁サイトのフォルダを調べる */
async function whereIs(lat: number, lng: number): Promise<Place | NoPlace> {
  const rev = JSON.parse(await fetchText(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`, false)) as {
    results?: { muniCd: string; lv01Nm: string };
  };
  if (!rev.results) return { pref: null, city: null, town: null, message: "この場所の住所が分かりませんでした。" };
  const muni = parseMuni(await fetchText("https://maps.gsi.go.jp/js/muni.js")).get(String(Number(rev.results.muniCd)));
  const town = rev.results.lv01Nm && rev.results.lv01Nm !== "－" ? rev.results.lv01Nm : null;
  if (!muni) return { pref: null, city: null, town, message: "市区町村が分かりませんでした。" };
  const dir = PREF_DIRS[muni.pref];
  if (!dir) return { ...muni, town, message: "都道府県が分かりませんでした。" };
  return { ...muni, town, dir };
}

type CityLink = { name: string; href: string };

interface CityMatch {
  /** 路線価図の一覧の項目（町丁名索引へのリンク）。路線価図のない市区町村や、決められなかったときはない */
  price?: CityLink;
  /** 市区町村の記号（評価倍率表の PDF の名前に使う） */
  code?: string;
  /** 同じ名前で一致するものが別々にあり、決められなかったか */
  ambiguous: boolean;
  /** 評価倍率表の一覧を取得できなかったときのエラー */
  listError?: unknown;
}

/**
 * 路線価図の一覧と評価倍率表の一覧から、その市区町村を決める。2つの一覧は同じ記号（j16101fr.htm・j16101rf.htm）を使う。
 * 1. 路線価図の一覧に、名前がそのまま同じものがあればそれ
 * 2. 評価倍率表の一覧に、名前がそのまま同じものがあれば、その記号。路線価図の一覧からは同じ記号のものだけを選ぶ
 *    （区名だけで並ぶ一覧で、別の市の同じ名前の区を選ばないため。なければ路線価図のない市区町村）
 * 3. なければ、それぞれの一覧で末尾が一致するもの（1つに決まるときだけ）
 */
async function resolveCity(root: string, pref: string, city: string, priceCities: CityLink[]): Promise<CityMatch> {
  const price = matchCity(priceCities, city, pref);
  if (price.hit && sameCity(price.hit.name, city, pref)) return { price: price.hit, code: cityCode(price.hit.href), ambiguous: false };
  // 路線価図が1枚もない町村は、評価倍率表の一覧にだけ載っている
  let ratioCities: CityLink[] = [];
  let listError: unknown;
  try {
    ratioCities = parseCityList(await fetchText(`${root}ratios/city_frm.htm`), "rf");
  } catch (e) {
    listError = e;
  }
  const ratio = matchCity(ratioCities, city, pref);
  if (ratio.hit && sameCity(ratio.hit.name, city, pref)) {
    const code = cityCode(ratio.hit.href);
    return { price: code ? priceCities.find((c) => cityCode(c.href) === code) : undefined, code, ambiguous: false };
  }
  if (price.hit) return { price: price.hit, code: cityCode(price.hit.href), ambiguous: false };
  if (ratio.hit) return { code: cityCode(ratio.hit.href), ambiguous: false };
  return { ambiguous: price.ambiguous || ratio.ambiguous, listError };
}

/** 候補の図のページを開き、となりの図から並びを作る（作れなければ undefined） */
async function sheetLayout(nos: string[], base: string): Promise<SheetLayoutItem[] | undefined> {
  const list = nos.slice(0, 12);
  const pages = await Promise.allSettled(list.map((no) => fetchText(`${base}html/${no}f.htm`)));
  const neighbours = new Map<string, Neighbor[]>();
  pages.forEach((p, i) => {
    if (p.status === "fulfilled") neighbours.set(list[i], parseNeighbors(p.value));
  });
  if (![...neighbours.values()].some((n) => n.length)) return undefined;
  return buildLayout(nos, neighbours, base);
}

export async function findSheets(lat: number, lng: number): Promise<FindResult> {
  const place = await whereIs(lat, lng);
  if (!("dir" in place)) return { ...place, sheets: [] };
  const { dir, town, ...muni } = place;

  const root = `${NTA}/${YEAR_DIR}/${dir}/`;
  const base = `${root}prices/`;
  const cities = parseCityList(await fetchText(`${base}city_frm.htm`));
  const { price: city, code, ambiguous } = await resolveCity(root, muni.pref, muni.city, cities);
  const ratioUrl = code ? `${root}ratios/pdf/${code}rt.pdf` : undefined;
  if (!city) {
    const message = ambiguous
      ? "同じ名前の市区町村が一覧にいくつかあるため、自動で決められませんでした。一覧から選んでください。"
      : "この市区町村の路線価図が見つかりませんでした（倍率地域の可能性があります）。";
    return { ...muni, town, sheets: [], indexUrl: `${base}city_frm.htm`, ratioUrl, message };
  }
  const indexUrl = new URL(city.href, base).toString();
  if (!town) return { ...muni, town, sheets: [], indexUrl, ratioUrl, message: "町丁目名が分からないため、索引から図番号を選んでください。" };

  const index = parseTownIndex(await fetchText(indexUrl));
  const key = normalizeTown(town);
  let nos = index.get(key);
  if (!nos) {
    // 「一番町」のように丁目のない町名や、丁目の区切りが違う場合
    const hit = [...index.entries()].find(([k]) => (!/\d$/.test(k) || !/\d$/.test(key)) && k.replace(/\d+$/, "") === key.replace(/\d+$/, ""));
    nos = hit?.[1];
  }
  if (!nos?.length) return { ...muni, town, sheets: [], indexUrl, ratioUrl, message: `索引に「${town}」が見つかりませんでした（路線価が付いていない地域の可能性があります）。` };
  // 並びが作れなくても、図番号の候補は返す
  const layout = await sheetLayout(nos, base).catch(() => undefined);
  return {
    ...muni,
    town,
    indexUrl,
    ratioUrl,
    sheets: nos.map((no) => ({ no, pdfUrl: `${base}pdf/${no}.pdf`, pageUrl: `${base}html/${no}f.htm` })),
    ...(layout ? { layout } : {}),
  };
}

export interface RatioPdfResult {
  pref: string | null;
  city: string | null;
  town: string | null;
  pdfUrl: string | null;
  message?: string;
}

/** 地図上の地点から、その市区町村の評価倍率表（令和8年分）の PDF の URL を探す */
export async function findRatioPdf(lat: number, lng: number): Promise<RatioPdfResult> {
  const place = await whereIs(lat, lng);
  if (!("dir" in place)) return { ...place, pdfUrl: null };
  const { dir, town, ...muni } = place;
  const root = `${NTA}/${YEAR_DIR}/${dir}/`;
  const priceCities = parseCityList(await fetchText(`${root}prices/city_frm.htm`).catch(() => ""));
  const { code, listError } = await resolveCity(root, muni.pref, muni.city, priceCities);
  // 一覧が取れずに見つからなかったときは「見つからない」ではなく、探せなかったことを伝える
  if (!code && listError) throw listError;
  const pdfUrl = code ? `${root}ratios/pdf/${code}rt.pdf` : null;
  if (!pdfUrl) return { ...muni, town, pdfUrl: null, message: "この市区町村の評価倍率表が見つかりませんでした。" };
  return { ...muni, town, pdfUrl };
}
