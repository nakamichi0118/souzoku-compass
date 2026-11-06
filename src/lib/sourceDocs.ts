/**
 * 財産・債務を、どの資料（撮影・アップロードした書類）から登録したかを残し、財産の画面から開けるようにする。
 * 資料のファイルは docFiles.ts（ログイン中はサーバー、デモはこの端末）にあり、財産には そのファイルの id と名前だけを持つ。
 */
import type { Case, SourceFile } from "@/domain/types";
import type { Ref } from "./extract";

/** 1つの財産に残す元の資料の数の上限（古いものから外す） */
export const MAX_SOURCES = 30;
/** 見本の書類（保存しない）を指す印 */
export const SAMPLE_PREFIX = "sample:";

/** 読み取った書類。id がないのは保存しなかった書類（マイナンバーと分かったものなど） */
export interface Source {
  fileId?: string;
  /** 保存したときのファイル名（画像は .jpg に変わる） */
  name: string;
}

const add = (list: SourceFile[] | undefined, src: Source): SourceFile[] | undefined => {
  const cur = list ?? [];
  if (!src.fileId) return cur.length ? cur : undefined;
  return [...cur.filter((x) => x.id !== src.fileId), { id: src.fileId, name: src.name.slice(0, 200) }].slice(-MAX_SOURCES);
};

/** 読み取って登録・更新した財産（債務）に、元の資料を付ける。贈与は対象外（id がないため） */
export function withSource(c: Case, ref: Ref, src: Source): Case {
  if ("index" in ref) return c;
  const docFrom = src.name.slice(0, 200);
  if (ref.type === "asset")
    return {
      ...c,
      assets: c.assets.map((a) => {
        if (a.id !== ref.id) return a;
        const sourceFiles = add(a.sourceFiles, src);
        return { ...a, docFrom, ...(sourceFiles ? { sourceFiles } : {}) };
      }),
    };
  return {
    ...c,
    debts: c.debts.map((d) => {
      if (d.id !== ref.id) return d;
      const sourceFiles = add(d.sourceFiles, src);
      return { ...d, docFrom, ...(sourceFiles ? { sourceFiles } : {}) };
    }),
  };
}

/** 画面に出す元の資料の1件 */
export type Shown<F> = { kind: "file"; file: F } | { kind: "sample"; docId: string } | { kind: "gone"; name: string };

/**
 * 財産に残した元の資料を、いま保存されている書類に当てはめる。
 * id で見つからないときは、ファイル名で探す（この端末に保存していた書類をログイン後にサーバーへ移すと id が変わるため）。
 * 前の版で登録した財産は docFrom（ファイル名）だけを持つので、それも名前で探す。
 * どれにも当たらなければ「保存されていない資料」として名前だけを出す。
 */
export function resolveSources<F extends { id: string; name: string }>(list: SourceFile[] | undefined, docFrom: string | undefined, files: F[]): Shown<F>[] {
  const out: Shown<F>[] = [];
  const seen = new Set<string>();
  const one = (id: string | undefined, name: string) => {
    if (id?.startsWith(SAMPLE_PREFIX)) {
      const docId = id.slice(SAMPLE_PREFIX.length);
      if (!seen.has(id)) out.push({ kind: "sample", docId });
      seen.add(id);
      return;
    }
    const f = (id ? files.find((x) => x.id === id) : undefined) ?? [...files].reverse().find((x) => x.name === name && !seen.has(x.id));
    if (f) {
      if (!seen.has(f.id)) out.push({ kind: "file", file: f });
      seen.add(f.id);
    } else if (!seen.has(`gone:${name}`)) {
      seen.add(`gone:${name}`);
      out.push({ kind: "gone", name });
    }
  };
  if (list?.length) for (const s of list) one(s.id, s.name);
  else if (docFrom && docFrom !== "手元にあり") one(undefined, docFrom);
  return out;
}
