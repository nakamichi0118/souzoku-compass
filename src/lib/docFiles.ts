"use client";

/**
 * 撮影・アップロードした書類のファイル。サーバーには送らず、この端末のブラウザ（IndexedDB）に保存する。
 * 書類の種類（資料集めの書類の id など）ごとに分けて持ち、税務署に出す書類一式のPDFを作るときに使う。
 * ログインした人ごと（デモはデモ用）に分ける。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "./cloud";

export interface DocFile {
  id: string;
  /** 書類の種類（DOCS の id、または submission.ts の追加の種類） */
  docId: string;
  name: string;
  type: string;
  size: number;
  addedAt: string;
  owner: string;
  blob: Blob;
}

const DB = "souzoku-compass-files";
const STORE = "files";
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("この端末では書類を保存できません。"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: "id" });
      s.createIndex("owner", "owner");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("書類を保存できませんでした。"));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error ?? new Error("書類を保存できませんでした。"));
    t.onabort = () => reject(t.error ?? new Error("書類を保存できませんでした（端末の空き容量をご確認ください）。"));
  });
}

export async function listFiles(owner: string): Promise<DocFile[]> {
  const all = await tx<DocFile[]>("readonly", (s) => s.index("owner").getAll(owner));
  return all.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

/** 画像は向きを直して長い辺 2200px までの JPEG にする（保存とPDFの大きさを抑える） */
export async function normalizeImage(file: File | Blob, name = "photo.jpg"): Promise<File> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap === "undefined") return file instanceof File ? file : new File([file], name, { type: file.type });
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("画像を変換できませんでした。"))), "image/jpeg", 0.85));
  const base = (file instanceof File ? file.name : name).replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}

export async function addFile(owner: string, docId: string, file: File): Promise<DocFile> {
  const f = await normalizeImage(file);
  const rec: DocFile = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    docId,
    name: f.name.slice(0, 120),
    type: f.type,
    size: f.size,
    addedAt: new Date().toISOString(),
    owner,
    blob: f,
  };
  await tx("readwrite", (s) => s.put(rec));
  changed();
  return rec;
}

export async function removeFile(id: string) {
  await tx("readwrite", (s) => s.delete(id));
  changed();
}

export async function moveFile(f: DocFile, docId: string) {
  await tx("readwrite", (s) => s.put({ ...f, docId }));
  changed();
}

/** ログインした人（デモはデモ用）の書類 */
export function useDocFiles() {
  const { user, mode } = useSession();
  const owner = user?.id ?? (mode === "demo" ? "demo" : "local");
  const [files, setFiles] = useState<DocFile[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    const load = () =>
      listFiles(owner)
        .then((x) => !off && setFiles(x))
        .catch(() => {
          // 保存できない端末では一覧は空のまま
        });
    load();
    listeners.add(load);
    return () => {
      off = true;
      listeners.delete(load);
    };
  }, [owner]);
  const add = useCallback(
    async (docId: string, list: File[]) => {
      setErr(null);
      const out: DocFile[] = [];
      try {
        for (const f of list) out.push(await addFile(owner, docId, f));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "書類を保存できませんでした。");
      }
      return out;
    },
    [owner],
  );
  return { files, add, remove: removeFile, move: moveFile, err, of: (docId: string) => files.filter((f) => f.docId === docId) };
}
