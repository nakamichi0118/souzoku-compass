/**
 * ZIP ファイルから、名前が条件に合う最初のファイルを取り出す（ZIP の仕様：PKWARE APPNOTE）。
 * 終わりの「中央ディレクトリの終わり」→ 中央ディレクトリ → 各ファイルの先頭、の順にたどる。
 * 圧縮は「無圧縮(0)」と「Deflate(8)」だけに対応する。
 */
import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function extractFile(zip: Buffer, match: (name: string) => boolean): { name: string; data: Buffer } {
  // 中央ディレクトリの終わり（22バイト＋コメント最大65535バイト）を後ろから探す
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP ファイルではありません");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== CENTRAL) throw new Error("ZIP の中央ディレクトリが壊れています");
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localAt = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("latin1");
    p += 46 + nameLen + extraLen + commentLen;
    if (!match(name)) continue;
    if (zip.readUInt32LE(localAt) !== LOCAL) throw new Error("ZIP のファイルの先頭が壊れています");
    const start = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    const raw = zip.subarray(start, start + compSize);
    if (method === 0) return { name, data: Buffer.from(raw) };
    if (method === 8) return { name, data: inflateRawSync(raw) };
    throw new Error(`対応していない圧縮方式です（${method}）`);
  }
  throw new Error("ZIP の中に目的のファイルがありません");
}

/** UTF-8 として読めなければ Shift_JIS として読む */
export function decodeCsv(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}
