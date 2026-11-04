/**
 * 税理士への相談（利用者が相談のフォームから送ったもの）と、その後のやりとりの保存先。
 * Cloud Run では Firestore の consults コレクション、手元の開発とテストではメモリに保存する。
 */
import type { Firestore } from "@google-cloud/firestore";

export interface ConsultMessage {
  from: "user" | "firm";
  text: string;
  at: string;
}

export interface ConsultRecord {
  id: string;
  userId: string;
  userEmail: string;
  name: string;
  prefecture: string;
  contact: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  /** 事務所が最後に見た時刻・利用者が最後に見た時刻（未読の数え方に使う） */
  firmSeenAt?: string;
  userSeenAt?: string;
  messages: ConsultMessage[];
  /** 打ち合わせ（オンライン面談）の案内 */
  meeting?: { url: string; at?: string; note?: string };
}

export interface ConsultDb {
  create(r: ConsultRecord): Promise<void>;
  get(id: string): Promise<ConsultRecord | null>;
  listByUser(userId: string): Promise<ConsultRecord[]>;
  listAll(): Promise<ConsultRecord[]>;
  update(id: string, fn: (r: ConsultRecord) => ConsultRecord): Promise<ConsultRecord | null>;
}

const newestFirst = (a: ConsultRecord, b: ConsultRecord) => b.updatedAt.localeCompare(a.updatedAt);

export function memoryConsultDb(): ConsultDb {
  const m = new Map<string, ConsultRecord>();
  return {
    async create(r) {
      m.set(r.id, structuredClone(r));
    },
    async get(id) {
      return structuredClone(m.get(id) ?? null);
    },
    async listByUser(userId) {
      return [...m.values()].filter((r) => r.userId === userId).sort(newestFirst).map((r) => structuredClone(r));
    },
    async listAll() {
      return [...m.values()].sort(newestFirst).map((r) => structuredClone(r));
    },
    async update(id, fn) {
      const cur = m.get(id);
      if (!cur) return null;
      const next = fn(structuredClone(cur));
      m.set(id, next);
      return structuredClone(next);
    },
  };
}

export function firestoreConsultDb(fs: Firestore): ConsultDb {
  const col = fs.collection("consults");
  return {
    async create(r) {
      await col.doc(r.id).create(r);
    },
    async get(id) {
      const d = await col.doc(id).get();
      return d.exists ? (d.data() as ConsultRecord) : null;
    },
    async listByUser(userId) {
      const q = await col.where("userId", "==", userId).get();
      return q.docs.map((d) => d.data() as ConsultRecord).sort(newestFirst);
    },
    async listAll() {
      const q = await col.orderBy("updatedAt", "desc").limit(200).get();
      return q.docs.map((d) => d.data() as ConsultRecord);
    },
    async update(id, fn) {
      const ref = col.doc(id);
      return fs.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        if (!cur.exists) return null;
        const next = fn(cur.data() as ConsultRecord);
        tx.set(ref, next);
        return next;
      });
    },
  };
}

let db: ConsultDb | null = null;
export async function getConsultDb(): Promise<ConsultDb> {
  if (db) return db;
  if (process.env.K_SERVICE || process.env.FIRESTORE_EMULATOR_HOST || process.env.USE_FIRESTORE === "1") {
    const mod = (await import("@google-cloud/firestore")) as typeof import("@google-cloud/firestore") & { default?: typeof import("@google-cloud/firestore") };
    const Firestore = mod.Firestore ?? mod.default?.Firestore;
    db = firestoreConsultDb(new Firestore({ ignoreUndefinedProperties: true }));
  } else db = memoryConsultDb();
  return db;
}
/** テスト用 */
export const setConsultDb = (d: ConsultDb | null) => (db = d);
