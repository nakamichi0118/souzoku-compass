/**
 * 日本郵便の郵便番号データから、public/zip/{上3桁}.json を作る（Docker のビルドで実行する）。
 *
 *   npx tsx scripts/zip/build.ts              … 日本郵便のサイトから取ってくる
 *   npx tsx scripts/zip/build.ts --csv a.csv [--business b.csv]  … 手元の CSV から作る（テスト用）
 *
 * データ：日本郵便「郵便番号データダウンロード」（住所の郵便番号、1レコード1行・UTF-8 形式）。
 * 取れなかったときは、Shift_JIS 形式（読み仮名データの促音・拗音を小書きで表記するもの）も試す。
 * 会社・役所などの個別の郵便番号（事業所の個別郵便番号）も足す（銀行・市役所の住所が番地まで入る）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addBusinessZips, buildZipIndex } from "../../src/lib/zip/parse";
import { decodeCsv, extractFile } from "./unzip";

// 2026年5月にダウンロードの場所が /service/search/zipcode/download/ に変わった（古い場所は 404）
const BASE = "https://www.post.japanpost.jp/service/search/zipcode/download";
const SOURCES = [`${BASE}/utf/zip/utf_ken_all.zip`, `${BASE}/kogaki/zip/ken_all.zip`];
/** 会社・役所などの個別の郵便番号（取れなくても続ける） */
const BUSINESS = [`${BASE}/office/zip/jigyosyo.zip`];

async function download(sources: string[]): Promise<string> {
  const errors: string[] = [];
  for (const url of sources) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const zip = Buffer.from(await res.arrayBuffer());
        const { data } = extractFile(zip, (n) => /\.csv$/i.test(n));
        console.log(`郵便番号データ：${url}（${zip.length} バイト）`);
        return decodeCsv(data);
      } catch (e) {
        errors.push(`${url} #${attempt}: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw new Error(`郵便番号データを取れませんでした\n${errors.join("\n")}`);
}

async function main() {
  const args = process.argv.slice(2);
  const csvAt = args.indexOf("--csv");
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 ? args[outAt + 1] : join(process.cwd(), "public", "zip");
  const bizAt = args.indexOf("--business");
  const csv = csvAt >= 0 ? decodeCsv(readFileSync(args[csvAt + 1])) : await download(SOURCES);
  const chunks = buildZipIndex(csv);
  let zips = 0;
  for (const c of chunks.values()) zips += Object.keys(c).length;
  // 少なすぎるときはデータの形が変わったとみて止める（テスト用の CSV は除く）
  if (csvAt < 0 && zips < 100_000) throw new Error(`郵便番号が少なすぎます（${zips} 件）`);
  try {
    const biz = bizAt >= 0 ? decodeCsv(readFileSync(args[bizAt + 1])) : csvAt < 0 ? await download(BUSINESS) : "";
    if (biz) console.log(`会社・役所などの個別の郵便番号 ${addBusinessZips(biz, chunks)} 件を足しました`);
  } catch (e) {
    console.warn(`会社・役所などの個別の郵便番号は入れませんでした：${(e as Error).message}`);
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // 000〜999 のすべてを書く（使われていない上3桁は空の表）。表がないときは「用意できていない」と分かるように
  for (let h = 0; h < 1000; h++) {
    const head = String(h).padStart(3, "0");
    writeFileSync(join(out, `${head}.json`), JSON.stringify(chunks.get(head) ?? {}));
  }
  console.log(`郵便番号 ${zips} 件を書きました（上3桁 ${chunks.size} 種類、${out}）`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
