/**
 * 地図でクリックした場所から、国税庁の路線価図（令和8年分）の図番号を探す。
 *
 * 1. 国土地理院の逆ジオコーダで、市区町村コードと町丁目名を調べる
 * 2. 国土地理院の市区町村コード表で、都道府県名・市区町村名に直す
 * 3. 国税庁「路線価図」の市区町村一覧から、その市区町村の町丁名索引のページを開く
 * 4. 町丁名索引で、その町丁目が載っている図番号を取り出す（PDF の URL を組み立てる）
 *
 * 図の位置（枠）は推定しない。図番号の候補を返すだけで、位置合わせは地図上で行う。
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

/** 町丁目名の表記ゆれをそろえる（例：「霞ヶ関三丁目」「霞が関３」→「霞が関3」） */
export function normalizeTown(s: string): string {
  let t = s.normalize("NFKC").replace(/[\s　]/g, "");
  t = t.replace(/^(大字|字)/, "");
  t = t.replace(/[ヶケヵ]/g, "が");
  t = t.replace(/([一二三四五六七八九十]+)丁目$/, (_, k: string) => String(kanjiNumber(k)));
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
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** 市区町村一覧のページから「市区町村名 → 町丁名索引ページ」を取り出す */
export function parseCityList(html: string): { name: string; href: string }[] {
  const out: { name: string; href: string }[] = [];
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']?([^"'\s>]*[a-z]\d+fr\.htm)["']?[^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = decodeEntities(m[2].replace(/<[^>]+>/g, "")).trim();
    if (name) out.push({ name, href: m[1] });
  }
  return out;
}

/**
 * 市区町村一覧から、国土地理院の市区町村名（例：福岡市博多区）に当たるものを選ぶ。
 * 一覧には「博多区」のように区名だけで載っていることがあるので、末尾が一致するもののうち
 * いちばん長く一致するものを選ぶ。
 */
export function pickCity<T extends { name: string }>(cities: T[], city: string): T | undefined {
  const exact = cities.find((c) => normalizeCity(c.name) === city);
  if (exact) return exact;
  const hits = cities.filter((c) => {
    const n = normalizeCity(c.name);
    return n.length >= 2 && (n.endsWith(city) || city.endsWith(n));
  });
  return hits.sort((a, b) => normalizeCity(b.name).length - normalizeCity(a.name).length)[0];
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

// ---------------------------------------------------------------- 取得（キャッシュ付き）

const cache = new Map<string, Promise<string>>();

async function fetchText(url: string): Promise<string> {
  let p = cache.get(url);
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
  /** 町丁名索引のページ（自動で見つからなかったときに案内する） */
  indexUrl?: string;
  message?: string;
}

export async function findSheets(lat: number, lng: number): Promise<FindResult> {
  const rev = JSON.parse(await fetchText(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`)) as {
    results?: { muniCd: string; lv01Nm: string };
  };
  if (!rev.results) return { pref: null, city: null, town: null, sheets: [], message: "この場所の住所が分かりませんでした。" };
  const muni = parseMuni(await fetchText("https://maps.gsi.go.jp/js/muni.js")).get(String(Number(rev.results.muniCd)));
  const town = rev.results.lv01Nm && rev.results.lv01Nm !== "－" ? rev.results.lv01Nm : null;
  if (!muni) return { pref: null, city: null, town, sheets: [], message: "市区町村が分かりませんでした。" };
  const dir = PREF_DIRS[muni.pref];
  if (!dir) return { ...muni, town, sheets: [], message: "都道府県が分かりませんでした。" };

  const base = `${NTA}/${YEAR_DIR}/${dir}/prices/`;
  const cities = parseCityList(await fetchText(`${base}city_frm.htm`));
  const city =
    pickCity(cities, muni.city);
  if (!city) return { ...muni, town, sheets: [], indexUrl: `${base}city_frm.htm`, message: "この市区町村の路線価図が見つかりませんでした（倍率地域の可能性があります）。" };
  const indexUrl = new URL(city.href, base).toString();
  if (!town) return { ...muni, town, sheets: [], indexUrl, message: "町丁目名が分からないため、索引から図番号を選んでください。" };

  const index = parseTownIndex(await fetchText(indexUrl));
  const key = normalizeTown(town);
  let nos = index.get(key);
  if (!nos) {
    // 「一番町」のように丁目のない町名や、丁目の区切りが違う場合
    const hit = [...index.entries()].find(([k]) => (!/\d$/.test(k) || !/\d$/.test(key)) && k.replace(/\d+$/, "") === key.replace(/\d+$/, ""));
    nos = hit?.[1];
  }
  if (!nos?.length) return { ...muni, town, sheets: [], indexUrl, message: `索引に「${town}」が見つかりませんでした（路線価が付いていない地域の可能性があります）。` };
  return {
    ...muni,
    town,
    indexUrl,
    sheets: nos.map((no) => ({ no, pdfUrl: `${base}pdf/${no}.pdf`, pageUrl: `${base}html/${no}f.htm` })),
  };
}
