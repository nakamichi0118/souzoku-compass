"use client";

/**
 * 撮影・アップロードした書類のファイル。書類の種類（資料集めの書類の id など）ごとに分けて持ち、
 * 税務署に出す書類一式のPDFを作るときに使う。
 * ログインしているときはサーバー（/api/files）に保存し、ほかの端末からも見られる。
 * デモ（とログインしていないとき）は、この端末のブラウザ（IndexedDB）にだけ保存する。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "./cloud";
import { NO_UPLOAD, NO_UPLOAD_NOTE } from "@/domain/filing/submission";

export interface DocFile {
  id: string;
  /** 書類の種類（DOCS の id、または submission.ts の追加の種類） */
  docId: string;
  name: string;
  type: string;
  size: number;
  addedAt: string;
  /** 画面に出すときの URL */
  src: string;
  /** 中身を読む */
  load(): Promise<Blob>;
}

interface LocalRec {
  id: string;
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

const localList = async (owner: string) => (await tx<LocalRec[]>("readonly", (s) => s.index("owner").getAll(owner))).sort((a, b) => a.addedAt.localeCompare(b.addedAt));

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

/** 同じ書類が2回入ったときに知らせるための、すでに保存した書類と同じもの */
export interface Duplicate {
  name: string;
  file: File;
  same: DocFile;
}

/**
 * 選んだ書類を、まだ保存していないものと、保存済みの書類と同じもの（同じ書類を2回入れたもの）に分ける。
 * 保存するときと同じ変換をしてから、種類と大きさ（バイト数）が同じなら同じ書類とみなす（名前は変えられるので見ない）。
 * 1回で同じ書類を2つ選んだときも、2つ目を同じものとする（same.docId が空）
 */
export async function splitDuplicates(list: File[], saved: DocFile[]): Promise<{ fresh: File[]; dups: Duplicate[] }> {
  const fresh: File[] = [];
  const dups: Duplicate[] = [];
  const seen: DocFile[] = [...saved];
  for (const file of list) {
    let n: File;
    try {
      n = await normalizeImage(file);
    } catch {
      fresh.push(file);
      continue;
    }
    const hit = seen.find((x) => x.type === n.type && x.size === n.size);
    if (hit) {
      dups.push({ name: file.name, file, same: hit });
      continue;
    }
    fresh.push(file);
    seen.push({ id: "", docId: "", name: file.name, type: n.type, size: n.size, addedAt: "", src: "", load: async () => n });
  }
  return { fresh, dups };
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** 保存先：サーバー（ログイン中）か、この端末 */
interface Backend {
  list(): Promise<DocFile[]>;
  add(docId: string, f: File): Promise<DocFile>;
  remove(id: string): Promise<void>;
  move(id: string, docId: string): Promise<void>;
}

async function check(r: Response, fallback: string) {
  if (r.ok) return r;
  const j = await r.json().catch(() => ({}));
  throw new Error(j.error ?? fallback);
}

type Meta = Omit<DocFile, "src" | "load">;
const serverView = (m: Meta): DocFile => {
  const src = `/api/files/${encodeURIComponent(m.id)}`;
  return { ...m, src, load: async () => (await check(await fetch(src), "書類を読み込めませんでした。")).blob() };
};

const server: Backend = {
  async list() {
    const j = await (await check(await fetch("/api/files", { cache: "no-store" }), "書類の一覧を読み込めませんでした。")).json();
    return (j.items as Meta[]).map(serverView);
  },
  async add(docId, f) {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("docId", docId);
    const j = await (await check(await fetch("/api/files", { method: "POST", body: fd }), "書類を保存できませんでした。")).json();
    return serverView(j.item as Meta);
  },
  async remove(id) {
    await check(await fetch(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" }), "書類を消せませんでした。");
  },
  async move(id, docId) {
    await check(await fetch(`/api/files/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ docId }) }), "書類の種類を変えられませんでした。");
  },
};

/** 端末に保存した書類の表示用 URL（書類ごとに1つ。消したときに捨てる） */
const localUrls = new Map<string, string>();
const urlOf = (r: LocalRec) => {
  let u = localUrls.get(r.id);
  if (!u) localUrls.set(r.id, (u = URL.createObjectURL(r.blob)));
  return u;
};
const local = (owner: string): Backend => ({
  async list() {
    const recs = await localList(owner);
    // 以前に入ってしまったマイナンバーの書類は、この端末からも消す
    for (const r of recs.filter((x) => NO_UPLOAD.has(x.docId))) await tx("readwrite", (s) => s.delete(r.id));
    return recs.filter((r) => !NO_UPLOAD.has(r.docId)).map((r) => {
      const src = urlOf(r);
      return { id: r.id, docId: r.docId, name: r.name, type: r.type, size: r.size, addedAt: r.addedAt, src, load: async () => r.blob };
    });
  },
  async add(docId, f) {
    const rec: LocalRec = { id: newId(), docId, name: f.name.slice(0, 120), type: f.type, size: f.size, addedAt: new Date().toISOString(), owner, blob: f };
    await tx("readwrite", (s) => s.put(rec));
    return { ...rec, src: "", load: async () => f };
  },
  async remove(id) {
    await tx("readwrite", (s) => s.delete(id));
    const u = localUrls.get(id);
    if (u) URL.revokeObjectURL(u);
    localUrls.delete(id);
  },
  async move(id, docId) {
    const rec = await tx<LocalRec | undefined>("readonly", (s) => s.get(id));
    if (rec) await tx("readwrite", (s) => s.put({ ...rec, docId }));
  },
});

/** ログインした人が、以前この端末にだけ保存した書類をサーバーへ移す（移せたものは端末から消す） */
const moving = new Set<string>();
async function moveLocalToServer(owner: string) {
  if (moving.has(owner)) return;
  moving.add(owner);
  try {
    const recs = await localList(owner).catch(() => [] as LocalRec[]);
    for (const r of recs) {
      try {
        await server.add(r.docId, new File([r.blob], r.name, { type: r.type }));
        await tx("readwrite", (s) => s.delete(r.id));
      } catch {
        // 移せなかったものは端末に残し、次に開いたときにもう一度移す
      }
    }
    if (recs.length) changed();
  } finally {
    moving.delete(owner);
  }
}

/** ログインした人（デモはデモ用）の書類 */
export function useDocFiles() {
  const { user, mode } = useSession();
  const cloud = mode === "cloud" && !!user;
  const owner = user?.id ?? (mode === "demo" ? "demo" : "local");
  const [files, setFiles] = useState<DocFile[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const backend = useCallback(() => (cloud ? server : local(owner)), [cloud, owner]);
  useEffect(() => {
    let off = false;
    const load = () =>
      backend()
        .list()
        .then((x) => !off && setFiles(x))
        .catch(() => {
          // 読み込めないときは一覧は空のまま
        });
    load();
    if (cloud) void moveLocalToServer(owner);
    listeners.add(load);
    return () => {
      off = true;
      listeners.delete(load);
    };
  }, [backend, cloud, owner]);
  const add = useCallback(
    async (docId: string, list: File[]) => {
      setErr(null);
      const out: DocFile[] = [];
      if (NO_UPLOAD.has(docId)) {
        setErr(NO_UPLOAD_NOTE);
        return out;
      }
      try {
        for (const f of list) out.push(await backend().add(docId, await normalizeImage(f)));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "書類を保存できませんでした。");
      }
      if (out.length) changed();
      return out;
    },
    [backend],
  );
  const remove = useCallback(
    async (id: string) => {
      await backend().remove(id).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
      changed();
    },
    [backend],
  );
  const move = useCallback(
    async (f: DocFile, docId: string) => {
      await backend().move(f.id, docId).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
      changed();
    },
    [backend],
  );
  return { files, add, remove, move, err, cloud, of: (docId: string) => files.filter((f) => f.docId === docId) };
}
