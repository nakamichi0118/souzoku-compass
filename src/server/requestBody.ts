/**
 * リクエストの本文を、決めた大きさまでだけ読む。
 * 大きすぎる本文を最後まで読み込んでからでは、メモリを使い切られるおそれがあるため、
 * 宣言された大きさ（content-length）と、実際に読んだ量の両方で途中で打ち切る。
 */

/** 本文を文字列で返す。max バイトを超えたら null */
export async function readText(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** 本文を JSON として読む。大きすぎれば "tooLarge"、JSON でなければ "invalid" */
export async function readJson(req: Request, max: number): Promise<{ ok: true; value: unknown } | { ok: false; reason: "tooLarge" | "invalid" }> {
  const raw = await readText(req, max);
  if (raw === null) return { ok: false, reason: "tooLarge" };
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
