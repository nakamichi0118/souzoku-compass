/**
 * コンパスくん（Claude）を呼ぶ API の入口の確認。
 * 公開している URL から API キーを使い込まれないよう、このサイトの画面からの呼び出しだけを受け、
 * 同じ相手からの回数を抑える。
 */
import { NextResponse } from "next/server";
import { clientKey, sameOrigin } from "./auth/http";
import { overLimit } from "./limit";

const LIMITS = {
  assist: 40,
  extract: 30,
  rosenkaRead: 40,
  offices: 40,
} as const;

/** 問題があれば返すべき応答、なければ null */
export async function guardAi(name: keyof typeof LIMITS): Promise<NextResponse | null> {
  if (!(await sameOrigin(true))) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  if (overLimit(`ai:${name}:${await clientKey()}`, LIMITS[name], 10 * 60_000)) {
    return NextResponse.json({ error: "短い時間に何度も使われたため、少し休んでいます。10分ほどしてからお試しください。" }, { status: 429 });
  }
  return null;
}
