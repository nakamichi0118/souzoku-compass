import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_DAYS, userFromToken } from "./auth";

export async function currentUser() {
  return userFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function clientKey() {
  const h = await headers();
  // Cloud Run は実際の接続元を末尾に足す（先頭は利用者が自由に書けるので使わない）
  return (h.get("x-forwarded-for") ?? "").split(",").pop()?.trim() || "local";
}

export function withSession(res: NextResponse, token: string | null) {
  res.cookies.set(SESSION_COOKIE, token ?? "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: token ? SESSION_DAYS * 86400 : 0,
  });
  return res;
}

/** 別のサイトから送られた書き込みを断る（Cookie を使う API の CSRF 対策） */
export async function sameOrigin(strict = false): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  // ブラウザは POST に必ず Origin を付ける。strict では Origin のない呼び出し（画面以外から）を断る
  if (!origin) return !strict && h.get("sec-fetch-site") !== "cross-site";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
