import { describe, expect, it } from "vitest";
import { readJson, readText } from "../requestBody";

const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request("http://localhost/x", { method: "POST", body, headers });

describe("本文を決めた大きさまでだけ読む", () => {
  it("上限以内なら読み、超えたら null（宣言された大きさでも、実際に読んだ量でも）", async () => {
    expect(await readText(post("こんにちは"), 100)).toBe("こんにちは");
    expect(await readText(post("x".repeat(101)), 100)).toBeNull();
    // 宣言された大きさが上限を超えるなら読まずに断る
    expect(await readText(post("x", { "content-length": "999999" }), 100)).toBeNull();
    // 日本語はバイト数で数える（1文字3バイト）
    expect(await readText(post("あ".repeat(34)), 100)).toBeNull();
  });

  it("少しずつ届く本文も、上限を超えた時点で打ち切る", async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        sent += 1;
        if (sent > 1000) ctl.close();
        else ctl.enqueue(new Uint8Array(64));
      },
    });
    const req = new Request("http://localhost/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readText(req, 1000)).toBeNull();
    expect(sent).toBeLessThan(100);
  });

  it("JSON として読めないものと大きすぎるものを分けて返す", async () => {
    expect(await readJson(post('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
    expect(await readJson(post("{"), 100)).toEqual({ ok: false, reason: "invalid" });
    expect(await readJson(post("1".repeat(200)), 100)).toEqual({ ok: false, reason: "tooLarge" });
  });
});
