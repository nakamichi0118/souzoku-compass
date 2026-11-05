/**
 * 撮影・アップロードした書類の保存先。ログインした本人だけが読み書きできる。
 * Cloud Run では Firestore に保存する。1つの文書は1MiBまでなので、ファイルを700KBずつに分けて docFileChunks に入れ、
 * 一覧の情報（名前・種類など）は docFiles に入れる。手元の開発とテストではメモリに保存する。
 */
import type { Firestore } from "@google-cloud/firestore";

export interface FileMeta {
  id: string;
  userId: string;
  docId: string;
  name: string;
  type: string;
  size: number;
  addedAt: string;
  chunks: number;
}

export interface FileDb {
  create(meta: FileMeta, bytes: Uint8Array): Promise<void>;
  list(userId: string): Promise<FileMeta[]>;
  get(userId: string, id: string): Promise<{ meta: FileMeta; bytes: Uint8Array } | null>;
  move(userId: string, id: string, docId: string): Promise<FileMeta | null>;
  remove(userId: string, id: string): Promise<boolean>;
}

export const CHUNK = 700_000;
const byAdded = (a: FileMeta, b: FileMeta) => a.addedAt.localeCompare(b.addedAt);

export function memoryFileDb(): FileDb {
  const m = new Map<string, { meta: FileMeta; bytes: Uint8Array }>();
  const mine = (userId: string, id: string) => {
    const r = m.get(id);
    return r && r.meta.userId === userId ? r : null;
  };
  return {
    async create(meta, bytes) {
      m.set(meta.id, { meta: { ...meta }, bytes: bytes.slice() });
    },
    async list(userId) {
      return [...m.values()].filter((r) => r.meta.userId === userId).map((r) => ({ ...r.meta })).sort(byAdded);
    },
    async get(userId, id) {
      const r = mine(userId, id);
      return r ? { meta: { ...r.meta }, bytes: r.bytes.slice() } : null;
    },
    async move(userId, id, docId) {
      const r = mine(userId, id);
      if (!r) return null;
      r.meta.docId = docId;
      return { ...r.meta };
    },
    async remove(userId, id) {
      return !!mine(userId, id) && m.delete(id);
    },
  };
}

export function firestoreFileDb(fs: Firestore): FileDb {
  const files = fs.collection("docFiles");
  const chunks = fs.collection("docFileChunks");
  const own = async (userId: string, id: string) => {
    const d = await files.doc(id).get();
    const meta = d.exists ? (d.data() as FileMeta) : null;
    return meta && meta.userId === userId ? meta : null;
  };
  return {
    async create(meta, bytes) {
      const batch = fs.batch();
      for (let i = 0; i < meta.chunks; i++) {
        batch.set(chunks.doc(`${meta.id}_${i}`), { fileId: meta.id, userId: meta.userId, i, data: Buffer.from(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) });
      }
      // 一覧の情報は最後に入れる（途中で失敗しても、中身のない書類が一覧に出ない）
      await batch.commit();
      await files.doc(meta.id).create(meta);
    },
    async list(userId) {
      const q = await files.where("userId", "==", userId).get();
      return q.docs.map((d) => d.data() as FileMeta).sort(byAdded);
    },
    async get(userId, id) {
      const meta = await own(userId, id);
      if (!meta) return null;
      const parts = await fs.getAll(...Array.from({ length: meta.chunks }, (_, i) => chunks.doc(`${id}_${i}`)));
      const bufs = parts.map((p) => (p.data()?.data as Buffer | undefined) ?? Buffer.alloc(0));
      return { meta, bytes: new Uint8Array(Buffer.concat(bufs)) };
    },
    async move(userId, id, docId) {
      const meta = await own(userId, id);
      if (!meta) return null;
      await files.doc(id).update({ docId });
      return { ...meta, docId };
    },
    async remove(userId, id) {
      const meta = await own(userId, id);
      if (!meta) return false;
      const batch = fs.batch();
      batch.delete(files.doc(id));
      for (let i = 0; i < meta.chunks; i++) batch.delete(chunks.doc(`${id}_${i}`));
      await batch.commit();
      return true;
    },
  };
}

let db: FileDb | null = null;
export async function getFileDb(): Promise<FileDb> {
  if (db) return db;
  if (process.env.K_SERVICE || process.env.FIRESTORE_EMULATOR_HOST || process.env.USE_FIRESTORE === "1") {
    const mod = (await import("@google-cloud/firestore")) as typeof import("@google-cloud/firestore") & { default?: typeof import("@google-cloud/firestore") };
    const Firestore = mod.Firestore ?? mod.default?.Firestore;
    db = firestoreFileDb(new Firestore({ ignoreUndefinedProperties: true }));
  } else {
    // 開発中は API ごとに別に読み込まれるので、メモリの保存先は共有する
    const g = globalThis as { __souzokuFileDb?: FileDb };
    db = g.__souzokuFileDb ??= memoryFileDb();
  }
  return db;
}
/** テスト用 */
export const setFileDb = (d: FileDb | null) => (db = d);
