/**
 * メールアドレスとパスワードによるログイン。
 * パスワードは scrypt で塩付きハッシュにして保存し、ログイン中の記録は乱数のトークンを
 * ハッシュにして保存する（データベースから漏れてもそのままでは使えない）。
 */
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { overLimit, resetLimit } from "../limit";
import { getDb, type UserRecord } from "./db";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const N = 16384;
const R = 8;
const P = 1;
const LEN = 32;

export const SESSION_COOKIE = "sc_session";
export const SESSION_DAYS = 30;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", N, R, P, salt.toString("base64url"), h.toString("base64url")].join("$");
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt") return false;
  const want = Buffer.from(hash, "base64url");
  const got = await scrypt(pw, Buffer.from(salt, "base64url"), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}

export const normalizeEmail = (e: string) => e.normalize("NFKC").trim().toLowerCase();
export const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254;
/** 8文字以上、英字と数字を両方含む */
export const passwordProblem = (pw: string): string | null =>
  pw.length < 8 ? "パスワードは8文字以上にしてください。" : pw.length > 128 ? "パスワードは128文字以内にしてください。" : !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? "パスワードには英字と数字を両方入れてください。" : null;

const tokenHash = (t: string) => createHash("sha256").update(t).digest("base64url");

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}
const pub = (u: UserRecord): PublicUser => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt });

export async function signup(name: string, email: string, password: string): Promise<{ user: PublicUser } | { error: string }> {
  const e = normalizeEmail(email);
  const n = name.trim().slice(0, 50);
  if (!n) return { error: "お名前を入力してください。" };
  if (!validEmail(e)) return { error: "メールアドレスの形が正しくありません。" };
  const bad = passwordProblem(password);
  if (bad) return { error: bad };
  const u: UserRecord = { id: randomUUID(), email: e, name: n, password: await hashPassword(password), createdAt: new Date().toISOString() };
  const ok = await (await getDb()).createUser(u);
  if (!ok) return { error: "このメールアドレスはすでに登録されています。ログインしてください。" };
  return { user: pub(u) };
}

export async function login(email: string, password: string): Promise<PublicUser | null> {
  const u = await (await getDb()).findUserByEmail(normalizeEmail(email));
  if (!u) {
    // 登録の有無で応答時間が変わらないよう、同じ計算をする
    await hashPassword(password);
    return null;
  }
  return (await verifyPassword(password, u.password)) ? pub(u) : null;
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await (await getDb()).putSession(tokenHash(token), { userId, expiresAt: Date.now() + SESSION_DAYS * 86400_000 });
  return token;
}

export async function userFromToken(token: string | undefined): Promise<PublicUser | null> {
  if (!token) return null;
  const db = await getDb();
  const s = await db.getSession(tokenHash(token));
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    await db.deleteSession(tokenHash(token));
    return null;
  }
  const u = await db.getUser(s.userId);
  return u ? pub(u) : null;
}

export async function endSession(token: string | undefined) {
  if (token) await (await getDb()).deleteSession(tokenHash(token));
}

// ---------------------------------------------------------------- 総当たり対策（簡易）

/** 同じ相手から10分に10回まで */
export const tooManyAttempts = (key: string) => overLimit(key, 10, 10 * 60_000);
export const resetAttempts = (key: string) => resetLimit(key);
