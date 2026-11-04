/**
 * 日本郵便の郵便番号データから、public/zip/{上3桁}.json を作る（Docker のビルドで実行する）。
 *
 *   npx tsx scripts/zip/build.ts              … 日本郵便のサイトから取ってくる
 *   npx tsx scripts/zip/build.ts --csv a.csv  … 手元の CSV から作る（テスト用）
 *
 * データ：日本郵便「郵便番号データダウンロード」（住所の郵便番号、1レコード1行・UTF-8 形式）。
 * 取れなかったときは、Shift_JIS 形式（読み仮名データの促音・拗音を小書きで表記するもの）も試す。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildZipIndex } from "../../src/lib/zip/parse";
import { decodeCsv, extractFile } from "./unzip";

const SOURCES = [
  "https://www.post.japanpost.jp/zipcode/dl/utf/zip/utf_ken_all.zip",
  "https://www.post.japanpost.jp/zipcode/dl/kogaki/zip/ken_all.zip",
];

async function download(): Promise<string> {
  const errors: string[] = [];
  for (const url of SOURCES) {
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
  const csv = csvAt >= 0 ? decodeCsv(readFileSync(args[csvAt + 1])) : await download();
  const chunks = buildZipIndex(csv);
  let zips = 0;
  for (const c of chunks.values()) zips += Object.keys(c).length;
  // 少なすぎるときはデータの形が変わったとみて止める（テスト用の CSV は除く）
  if (csvAt < 0 && zips < 100_000) throw new Error(`郵便番号が少なすぎます（${zips} 件）`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const [head, chunk] of chunks) writeFileSync(join(out, `${head}.json`), JSON.stringify(chunk));
  console.log(`郵便番号 ${zips} 件を ${chunks.size} ファイルに書きました（${out}）`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
