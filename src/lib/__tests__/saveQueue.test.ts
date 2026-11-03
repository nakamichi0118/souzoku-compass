import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authExpired, flushQueue, isUnsaved, queueWrite, resetQueueForTest, setQueueEnabled } from "@/lib/saveQueue";

type Call = { body: { set: Record<string, string>; del: string[] }; resolve: (status: number) => void; reject: () => void };

/** 送信を1つずつ手で終わらせられる fetch の代わり */
function fakeFetch() {
  const calls: Call[] = [];
  const fn = vi.fn((_url: string, init: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      calls.push({
        body: JSON.parse(String(init.body)),
        resolve: (status) => resolve(new Response("{}", { status })),
        reject: () => reject(new Error("offline")),
      });
    });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetQueueForTest();
  setQueueEnabled(true);
});
afterEach(() => {
  resetQueueForTest();
  vi.unstubAllGlobals();
});

describe("サーバーへの保存の待ち行列", () => {
  it("同時に送るのは1つだけで、送っている間の書き込みは終わってから送る", async () => {
    const calls = fakeFetch();
    queueWrite("k:a", "1");
    const first = flushQueue();
    await tick();
    expect(calls).toHaveLength(1);
    queueWrite("k:a", "2");
    const second = flushQueue();
    await tick();
    expect(calls).toHaveLength(1); // 前の送信が終わるまで待つ
    calls[0].resolve(200);
    expect(await first).toBe(true);
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1].body.set).toEqual({ "k:a": "2" });
    calls[1].resolve(200);
    expect(await second).toBe(true);
  });

  it("古い送信が失敗しても、そのあとに書いた新しい値を古い値で戻さない", async () => {
    const calls = fakeFetch();
    queueWrite("k:a", "old");
    queueWrite("k:b", "keep");
    const first = flushQueue();
    await tick();
    queueWrite("k:a", "new");
    calls[0].reject();
    expect(await first).toBe(false);
    const second = flushQueue();
    await tick();
    // a は新しい値、b は送れなかったので送り直す
    expect(calls[1].body.set).toEqual({ "k:a": "new", "k:b": "keep" });
    calls[1].resolve(200);
    expect(await second).toBe(true);
  });

  it("消す書き込みが失敗したあとに同じ項目へ書いたら、消さずに新しい値を送る", async () => {
    const calls = fakeFetch();
    queueWrite("k:a", null);
    const first = flushQueue();
    await tick();
    queueWrite("k:a", "back");
    calls[0].reject();
    await first;
    const second = flushQueue();
    await tick();
    expect(calls[1].body).toEqual({ set: { "k:a": "back" }, del: [] });
    calls[1].resolve(200);
    await second;
  });

  it("送るものがなければ送らずに true、送れなかったら false を返す", async () => {
    const calls = fakeFetch();
    expect(await flushQueue()).toBe(true);
    expect(calls).toHaveLength(0);
    queueWrite("k:a", "1");
    expect(isUnsaved("k:a")).toBe(true);
    const p = flushQueue();
    await tick();
    calls[0].resolve(500);
    expect(await p).toBe(false);
    expect(isUnsaved("k:a")).toBe(true);
  });

  it("ログインが切れた（401）あとは送り直さない", async () => {
    const calls = fakeFetch();
    queueWrite("k:a", "1");
    const p = flushQueue();
    await tick();
    calls[0].resolve(401);
    expect(await p).toBe(false);
    expect(authExpired()).toBe(true);
    queueWrite("k:a", "2");
    expect(await flushQueue()).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("ログイン中でなければ何も送らない", async () => {
    const calls = fakeFetch();
    setQueueEnabled(false);
    queueWrite("k:a", "1");
    expect(await flushQueue()).toBe(true);
    expect(calls).toHaveLength(0);
    expect(isUnsaved("k:a")).toBe(false);
  });
});
