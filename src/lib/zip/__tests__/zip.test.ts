import { deflateRawSync } from "node:zlib";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeCsv, extractFile } from "../../../../scripts/zip/unzip";
import { addBusinessZips, buildZipIndex, cleanTown, parseCsvLine } from "../parse";
import { clearZipCache, lookupZip, nextAddress, normalizeZip } from "../lookup";
import { AddressField } from "@/components/ui/AddressField";

/** 日本郵便の CSV と同じ並びの1行（カナとフラグは使わないので仮の値） */
const row = (code: string, zip: string, pref: string, city: string, town: string) =>
  `${code},"${zip.slice(0, 3)}  ","${zip}","ｶﾅ","ｶﾅ","ｶﾅ","${pref}","${city}","${town}",0,0,0,0,0,0`;

describe("parseCsvLine", () => {
  it("かっこ・カンマ・\"\" を含む値を分ける", () => {
    expect(parseCsvLine('01101,"060  ","0600042","a,b","x""y"')).toEqual(["01101", "060  ", "0600042", "a,b", 'x"y']);
  });
});

describe("cleanTown", () => {
  it("町域なしの決まり文句は空にする", () => {
    expect(cleanTown("以下に掲載がない場合")).toBe("");
    expect(cleanTown("蘭越町の次に番地がくる場合")).toBe("");
    expect(cleanTown("檜原村一円")).toBe("");
  });
  it("「一円」という町名だけのときは残す", () => {
    expect(cleanTown("一円")).toBe("一円");
  });
  it("かっこ書きを外す", () => {
    expect(cleanTown("大通西（１～１９丁目）")).toBe("大通西");
    expect(cleanTown("丸の内（次のビルを除く）")).toBe("丸の内");
    expect(cleanTown("西新宿新宿アイランドタワー（地階・階層不明）")).toBe("西新宿新宿アイランドタワー");
    expect(cleanTown("千代田")).toBe("千代田");
  });
});

describe("buildZipIndex", () => {
  const csv = [
    "\uFEFF" + row("13101", "1000001", "東京都", "千代田区", "千代田"),
    row("13101", "1000005", "東京都", "千代田区", "丸の内（次のビルを除く）"),
    row("01101", "0600000", "北海道", "札幌市中央区", "以下に掲載がない場合"),
    row("01101", "0600042", "北海道", "札幌市中央区", "大通西（１～１９丁目）"),
    // 1つの郵便番号に2つの町域
    row("47201", "9000001", "沖縄県", "那覇市", "港町"),
    row("47201", "9000001", "沖縄県", "那覇市", "前島"),
    // かっこ書きを外すと同じになる行は1つにまとめる
    row("47201", "9000002", "沖縄県", "那覇市", "曙（１丁目）"),
    row("47201", "9000002", "沖縄県", "那覇市", "曙（２丁目）"),
    // 古い形式：かっこが次の行で閉じる
    row("02201", "0300111", "青森県", "青森市", "荒川（藤戸「１１９－２番地」、"),
    row("02201", "0300111", "青森県", "青森市", "柴田）"),
    row("02201", "0300112", "青森県", "青森市", "八ツ役"),
  ].join("\r\n");
  const idx = buildZipIndex(csv);

  it("上3桁ごとにまとめ、下4桁で引ける", () => {
    expect(idx.get("100")).toEqual({ "0001": [[12, "千代田区", "千代田"]], "0005": [[12, "千代田区", "丸の内"]] });
    expect(idx.get("060")?.["0000"]).toEqual([[0, "札幌市中央区", ""]]);
    expect(idx.get("060")?.["0042"]).toEqual([[0, "札幌市中央区", "大通西"]]);
  });
  it("同じ郵便番号の町域は候補として並べ、同じものは1つにする", () => {
    expect(idx.get("900")?.["0001"]?.map((r) => r[2])).toEqual(["港町", "前島"]);
    expect(idx.get("900")?.["0002"]).toEqual([[46, "那覇市", "曙"]]);
  });
  it("古い形式で行が分かれた町域をつなげる", () => {
    expect(idx.get("030")?.["0111"]).toEqual([[1, "青森市", "荒川"]]);
    expect(idx.get("030")?.["0112"]).toEqual([[1, "青森市", "八ツ役"]]);
  });
  it("知らない都道府県名は止める（データの形が変わったとき）", () => {
    expect(() => buildZipIndex(row("99999", "1234567", "架空県", "架空市", "架空町"))).toThrow(/都道府県/);
  });
});

describe("addBusinessZips", () => {
  /** 事業所の個別郵便番号の CSV と同じ並びの1行（名前・住所は架空） */
  const biz = (zip: string, name: string, pref: string, city: string, town: string, banchi: string, kind = "0") =>
    `13101,"ｶｸｳ","${name}","${pref}","${city}","${town}","${banchi}","${zip}","100  ","銀座",${kind},0,0`;
  it("番地まで入れ、名前も持つ。私書箱は入れない", () => {
    const chunks = buildZipIndex(row("13101", "1000001", "東京都", "千代田区", "千代田"));
    const n = addBusinessZips([biz("1008388", "架空銀行", "東京都", "千代田区", "丸の内", "一丁目1番1号"), biz("1008799", "私書箱", "東京都", "千代田区", "大手町", "二丁目3番1号", "1")].join("\r\n"), chunks);
    expect(n).toBe(1);
    expect(chunks.get("100")?.["8388"]).toEqual([[12, "千代田区", "丸の内一丁目1番1号", "架空銀行"]]);
    expect(chunks.get("100")?.["8799"]).toBeUndefined();
    expect(chunks.get("100")?.["0001"]).toEqual([[12, "千代田区", "千代田"]]);
  });
});

/** テスト用の ZIP を、APPNOTE の形どおりに組み立てる */
function makeZip(name: string, content: Buffer, method: 0 | 8): Buffer {
  const data = method === 8 ? deflateRawSync(content) : content;
  const nameBuf = Buffer.from(name, "latin1");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdStart = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

describe("extractFile / decodeCsv", () => {
  const text = Buffer.from(row("13101", "1000001", "東京都", "千代田区", "千代田"), "utf8");
  it("Deflate と無圧縮の ZIP から CSV を取り出す", () => {
    expect(extractFile(makeZip("utf_ken_all.csv", text, 8), (n) => n.endsWith(".csv")).data.equals(text)).toBe(true);
    expect(extractFile(makeZip("KEN_ALL.CSV", text, 0), (n) => /\.csv$/i.test(n)).data.equals(text)).toBe(true);
  });
  it("ZIP でないものは止める", () => {
    expect(() => extractFile(Buffer.from("not a zip at all, just some text here"), () => true)).toThrow(/ZIP/);
  });
  it("UTF-8 でも Shift_JIS でも読む", () => {
    expect(decodeCsv(Buffer.from("東京都", "utf8"))).toBe("東京都");
    expect(decodeCsv(Buffer.from([0x93, 0x8c, 0x8b, 0x9e, 0x93, 0x73]))).toBe("東京都");
  });
});

describe("normalizeZip", () => {
  it("全角・ハイフンなしを 123-4567 の形にする", () => {
    expect(normalizeZip("１０００００１")).toBe("100-0001");
    expect(normalizeZip("1000001")).toBe("100-0001");
    expect(normalizeZip("100ー0001")).toBe("100-0001");
    expect(normalizeZip("〒100-0001")).toBe("100-0001");
  });
  it("打っている途中はそのまま（数字とハイフンだけ）", () => {
    expect(normalizeZip("100-")).toBe("100-");
    expect(normalizeZip("10a0")).toBe("100");
  });
});

describe("lookupZip", () => {
  beforeEach(() => clearZipCache());
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
  it("上3桁の表を1回だけ取り、下4桁の候補を住所の形で返す", async () => {
    const f = vi.fn(async () => ok({ "0001": [[12, "千代田区", "千代田"]] }));
    expect(await lookupZip("100-0001", f as unknown as typeof fetch)).toEqual([{ pref: "東京都", city: "千代田区", town: "千代田", address: "東京都千代田区千代田" }]);
    expect(await lookupZip("1000002", f as unknown as typeof fetch)).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith("/zip/100.json");
  });
  it("表がない（ビルドで作れなかった）・取れなかったときは null で、次にもう一度試す", async () => {
    const missing = vi.fn(async () => ({ ok: false, status: 404 }) as Response);
    expect(await lookupZip("9990000", missing as unknown as typeof fetch)).toBeNull();
    const down = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    expect(await lookupZip("1110000", down as unknown as typeof fetch)).toBeNull();
    expect(await lookupZip("1110000", down as unknown as typeof fetch)).toBeNull();
    expect(down).toHaveBeenCalledTimes(2);
  });
  it("会社・役所の個別の郵便番号は、名前と番地までの住所を返す", async () => {
    const f = vi.fn(async () => ok({ "8388": [[12, "千代田区", "丸の内一丁目1番1号", "架空銀行"]] }));
    expect(await lookupZip("100-8388", f as unknown as typeof fetch)).toEqual([{ pref: "東京都", city: "千代田区", town: "丸の内一丁目1番1号", address: "東京都千代田区丸の内一丁目1番1号", name: "架空銀行" }]);
  });
  it("7桁でなければ調べない", async () => {
    const f = vi.fn();
    expect(await lookupZip("100-00", f as unknown as typeof fetch)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("nextAddress", () => {
  const found = "東京都千代田区千代田";
  it("空なら入れる", () => expect(nextAddress("", found, null)).toBe(found));
  it("前に自動で入れた部分だけ入れ替え、足した番地は残す", () => {
    expect(nextAddress("東京都千代田区丸の内1-1", found, "東京都千代田区丸の内")).toBe("東京都千代田区千代田1-1");
  });
  it("同じ住所から始まっていればそのまま", () => {
    expect(nextAddress("東京都千代田区千代田1-1", found, null)).toBe("東京都千代田区千代田1-1");
  });
  it("自分で入れた別の住所は書き換えない", () => {
    expect(nextAddress("大阪府大阪市北区梅田1-1", found, null)).toBeNull();
  });
});

describe("AddressField", () => {
  it("郵便番号と住所の欄に名前があり、スマホで数字の入力になる", () => {
    const html = renderToStaticMarkup(createElement(AddressField, { label: "住所", address: "東京都", onAddress: () => {}, zip: "100-0001", onZip: () => {} }));
    expect(html).toContain('aria-label="郵便番号"');
    expect(html).toMatch(/inputmode="numeric"/i);
    expect(html).toContain('value="100-0001"');
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>住所<\/label>.*id="\1"/);
  });
  it("ラベルを出さないときは住所の欄に名前を付ける", () => {
    const html = renderToStaticMarkup(createElement(AddressField, { address: "", onAddress: () => {}, ariaLabel: "亡くなった方の最後の住所" }));
    expect(html).toContain('aria-label="亡くなった方の最後の住所"');
    expect(html).not.toContain("<label");
  });
});
