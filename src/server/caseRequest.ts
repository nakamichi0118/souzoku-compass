/**
 * 書類を作る API（申告書・遺産分割協議書・登記申請書）の入口の確認。
 * このサイトの画面からの呼び出しだけを受け、同じ相手からの回数を抑え、
 * 送られた相続の入力を大きさ・件数・つながりの矛盾で確かめてから渡す。
 */
import { NextResponse } from "next/server";
import type { Case } from "@/domain/types";
import { clientKey, sameOrigin } from "./auth/http";
import { MAX_CASE_BYTES, checkCase } from "./caseSchema";
import { overLimit } from "./limit";
import { readJson } from "./requestBody";

/** 10分あたりの回数（画面から普通に使う分には届かない、ゆとりのある数） */
const LIMITS = { forms: 60, division: 60, registration: 60 } as const;

export const TOO_MANY = "短い時間に何度も使われたため、少し休んでいます。10分ほどしてからお試しください。";

/** 問題があれば返すべき応答を、なければ確かめた Case を返す */
export async function readCaseRequest(req: Request, name: keyof typeof LIMITS): Promise<{ case: Case } | { res: NextResponse }> {
  if (!(await sameOrigin(true))) return { res: NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 }) };
  if (overLimit(`pdf:${name}:${await clientKey()}`, LIMITS[name], 10 * 60_000)) return { res: NextResponse.json({ error: TOO_MANY }, { status: 429 }) };
  const body = await readJson(req, MAX_CASE_BYTES);
  if (!body.ok) {
    return body.reason === "tooLarge"
      ? { res: NextResponse.json({ error: "送られたデータが大きすぎます。" }, { status: 413 }) }
      : { res: NextResponse.json({ error: "入力データの形が正しくありません。画面を開き直してからお試しください。" }, { status: 400 }) };
  }
  const checked = checkCase(body.value);
  if (!checked.ok) return { res: NextResponse.json({ error: checked.error }, { status: 400 }) };
  return { case: checked.data };
}

/**
 * 書類を作る途中の失敗を、画面に見せる文にする。
 * 計算の側が出す日本語の説明（例：奥行距離は正の数で入力してください）はそのまま見せ、
 * それ以外（プログラムの内部の文言）は見せずにサーバーの記録にだけ残す。
 */
export function failureMessage(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/[぀-ヿ一-鿿]/.test(msg) && msg.length <= 300) return msg;
  console.error(e);
  return fallback;
}
