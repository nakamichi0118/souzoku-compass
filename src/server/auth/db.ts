/**
 * 利用者・ログイン中の記録・利用者ごとのデータの保存先。
 * Cloud Run では同じ GCP プロジェクトの Firestore を使う。手元の開発とテストではメモリに保存する。
 */
import type { Firestore } from "@google-cloud/firestore";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  /** scrypt$N$r$p$salt$hash（すべて base64url） */
  password: string;
  createdAt: string;
}
export interface SessionRecord {
  userId: string;
  expiresAt: number;
}
export interface UserData {
  /** 画面の保存領域のキーごとの JSON 文字列 */
  kv: Record<string, string>;
  updatedAt: string;
}

export interface AuthDb {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  getUser(id: string): Promise<UserRecord | null>;
  /** 同じメールアドレスの利用者がいれば false */
  createUser(u: UserRecord): Promise<boolean>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  putSession(tokenHash: string, s: SessionRecord): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  getData(userId: string): Promise<UserData | null>;
  patchData(userId: string, set: Record<string, string>, del: string[]): Promise<UserData>;
}

/** メールアドレスを、利用者の重複を防ぐための文書IDにする */
const emailKey = (email: string) => Buffer.from(email).toString("base64url");

export function memoryDb(): AuthDb {
  const users = new Map<string, UserRecord>();
  const byEmail = new Map<string, string>();
  const sessions = new Map<string, SessionRecord>();
  const data = new Map<string, UserData>();
  return {
    async findUserByEmail(email) {
      const id = byEmail.get(email);
      return id ? (users.get(id) ?? null) : null;
    },
    async getUser(id) {
      return users.get(id) ?? null;
    },
    async createUser(u) {
      if (byEmail.has(u.email)) return false;
      byEmail.set(u.email, u.id);
      users.set(u.id, u);
      return true;
    },
    async getSession(h) {
      return sessions.get(h) ?? null;
    },
    async putSession(h, s) {
      sessions.set(h, s);
    },
    async deleteSession(h) {
      sessions.delete(h);
    },
    async getData(id) {
      return data.get(id) ?? null;
    },
    async patchData(id, set, del) {
      const cur = data.get(id) ?? { kv: {}, updatedAt: "" };
      const kv = { ...cur.kv, ...set };
      for (const k of del) delete kv[k];
      const next = { kv, updatedAt: new Date().toISOString() };
      data.set(id, next);
      return next;
    },
  };
}

export function firestoreDb(fs: Firestore): AuthDb {
  const users = fs.collection("users");
  const emails = fs.collection("userEmails");
  const sessions = fs.collection("sessions");
  const data = fs.collection("userData");
  return {
    async findUserByEmail(email) {
      const e = await emails.doc(emailKey(email)).get();
      if (!e.exists) return null;
      const u = await users.doc(String(e.get("userId"))).get();
      return u.exists ? (u.data() as UserRecord) : null;
    },
    async getUser(id) {
      const u = await users.doc(id).get();
      return u.exists ? (u.data() as UserRecord) : null;
    },
    async createUser(u) {
      try {
        await fs.runTransaction(async (tx) => {
          const ref = emails.doc(emailKey(u.email));
          if ((await tx.get(ref)).exists) throw new Error("exists");
          tx.create(ref, { userId: u.id });
          tx.create(users.doc(u.id), u);
        });
        return true;
      } catch (e) {
        if (e instanceof Error && e.message === "exists") return false;
        throw e;
      }
    },
    async getSession(h) {
      const s = await sessions.doc(h).get();
      return s.exists ? (s.data() as SessionRecord) : null;
    },
    async putSession(h, s) {
      await sessions.doc(h).set(s);
    },
    async deleteSession(h) {
      await sessions.doc(h).delete();
    },
    async getData(id) {
      const d = await data.doc(id).get();
      return d.exists ? (d.data() as UserData) : null;
    },
    async patchData(id, set, del) {
      const ref = data.doc(id);
      return fs.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        const kv: Record<string, string> = { ...((cur.exists ? (cur.get("kv") as Record<string, string>) : {}) ?? {}), ...set };
        for (const k of del) delete kv[k];
        const next = { kv, updatedAt: new Date().toISOString() };
        tx.set(ref, next);
        return next;
      });
    },
  };
}

let db: AuthDb | null = null;
export async function getDb(): Promise<AuthDb> {
  if (db) return db;
  // Cloud Run（K_SERVICE）か Firestore エミュレータがあるときだけ Firestore を使う
  if (process.env.K_SERVICE || process.env.FIRESTORE_EMULATOR_HOST || process.env.USE_FIRESTORE === "1") {
    const mod = (await import("@google-cloud/firestore")) as typeof import("@google-cloud/firestore") & { default?: typeof import("@google-cloud/firestore") };
    // CommonJS のパッケージなので、読み込み方によっては default の下に入る
    const Firestore = mod.Firestore ?? mod.default?.Firestore;
    db = firestoreDb(new Firestore({ ignoreUndefinedProperties: true }));
  } else {
    console.warn("[auth] Firestore を使わず、メモリに保存します（開発用）");
    db = memoryDb();
  }
  return db;
}
/** テスト用 */
export const setDb = (d: AuthDb | null) => (db = d);
