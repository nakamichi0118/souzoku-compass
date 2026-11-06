/**
 * 財産・債務を、どの資料（撮影・アップロードした書類）から登録したかを残し、財産の画面から開けるようにする。
 * 資料のファイルは docFiles.ts（ログイン中はサーバー、デモはこの端末）にあり、財産には そのファイルの id だけを持つ。
 */
import type { Case } from "@/domain/types";
import type { Ref } from "./extract";

/** 1つの財産に残す元の資料の数の上限（古いものから外す） */
export const MAX_SOURCES = 30;
/** 見本の書類（保存しない）を指す印 */
export const SAMPLE_PREFIX = "sample:";

export interface Source {
  /** 保存した書類ファイルの id、または sample:書類の種類 */
  fileId?: string;
  /** 書類のファイル名 */
  name: string;
}

const add = (ids: string[] | undefined, id: string | undefined) => {
  const cur = ids ?? [];
  if (!id) return cur.length ? cur : undefined;
  return [...cur.filter((x) => x !== id), id].slice(-MAX_SOURCES);
};

/** 読み取って登録・更新した財産（債務）に、元の資料を付ける。贈与は対象外（id がないため） */
export function withSource(c: Case, ref: Ref, src: Source): Case {
  if ("index" in ref) return c;
  const name = src.name.slice(0, 200);
  if (ref.type === "asset")
    return {
      ...c,
      assets: c.assets.map((a) => {
        if (a.id !== ref.id) return a;
        const sourceFiles = add(a.sourceFiles, src.fileId);
        return { ...a, docFrom: name, ...(sourceFiles ? { sourceFiles } : {}) };
      }),
    };
  return {
    ...c,
    debts: c.debts.map((d) => {
      if (d.id !== ref.id) return d;
      const sourceFiles = add(d.sourceFiles, src.fileId);
      return { ...d, docFrom: name, ...(sourceFiles ? { sourceFiles } : {}) };
    }),
  };
}

/** 画面に出す元の資料の1件 */
export type Shown<F> = { kind: "file"; file: F } | { kind: "sample"; docId: string } | { kind: "gone"; name: string };

/**
 * 財産に残した元の資料を、いま保存されている書類に当てはめる。
 * id で見つからないときは、ファイル名で探す（この端末に保存していた書類をログイン後にサーバーへ移すと id が変わるため。前の版で登録した財産も名前だけを持つ）。
 * どれにも当たらなければ「消された資料」として名前だけを出す。
 */
export function resolveSources<F extends { id: string; name: string }>(ids: string[] | undefined, docFrom: string | undefined, files: F[]): Shown<F>[] {
  const out: Shown<F>[] = [];
  const seen = new Set<string>();
  const push = (f: F) => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    out.push({ kind: "file", file: f });
  };
  for (const id of ids ?? []) {
    if (id.startsWith(SAMPLE_PREFIX)) {
      out.push({ kind: "sample", docId: id.slice(SAMPLE_PREFIX.length) });
      continue;
    }
    const f = files.find((x) => x.id === id);
    if (f) push(f);
  }
  const named = docFrom && docFrom !== "手元にあり" ? docFrom : undefined;
  if (named && !out.some((s) => (s.kind === "file" && s.file.name === named) || s.kind === "sample")) {
    const byName = files.filter((x) => x.name === named);
    if (byName.length) byName.slice(-1).forEach(push);
    else out.push({ kind: "gone", name: named });
  }
  return out;
}
