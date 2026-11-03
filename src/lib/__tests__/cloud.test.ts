import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishSignIn, kvSet, localIsMine, onOwnerChanged, setLoadedForTest } from "@/lib/cloud";
import { authExpired, flushQueue, hasUnsent, resetQueueForTest } from "@/lib/saveQueue";
import { SAVE_FAILED, SAVE_RECOVERED } from "@/lib/saveStatus";

const MODE_KEY = "souzoku-compass-mode";
const A = "souzoku-compass:a";
const B = "souzoku-compass:b";

/** 値を自分のプロパティに持つ保存領域の代わり（Object.keys で項目を数えられるように） */
function fakeStorage() {
  const s: Record<string, string> = {};
  Object.defineProperties(s, {
    getItem: { value: (k: string) => (Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null) },
    setItem: { value: (k: string, v: string) => void (s[k] = String(v)) },
    removeItem: { value: (k: string) => void delete s[k] },
  });
  return s as Record<string, string> & Storage;
}

let store: ReturnType<typeof fakeStorage>;
let win: EventTarget & { location: { href: string; reload: ReturnType<typeof vi.fn> } };
let puts: { set: Record<string, string>; del: string[] }[];
/** 保存の送信に返す状態 */
let putStatus: number;
/** ログイン中の人（/api/auth/me が返す） */
let me: string | null;
let events: string[];

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetQueueForTest();
  store = fakeStorage();
  win = Object.assign(new EventTarget(), { location: { href: "", reload: vi.fn() } });
  puts = [];
  putStatus = 200;
  me = "u1";
  events = [];
  win.addEventListener(SAVE_FAILED, (e) => events.push(String((e as CustomEvent).detail)));
  win.addEventListener(SAVE_RECOVERED, () => events.push("recovered"));
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("window", win);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") return new Response(JSON.stringify({ user: me ? { id: me, email: "", name: "", createdAt: "" } : null }), { status: 200 });
      puts.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: putStatus });
    }),
  );
  // u1 がログインして開いた画面
  store.setItem(MODE_KEY, "cloud:u1");
  setLoadedForTest("cloud", "cloud:u1");
});
afterEach(() => {
  resetQueueForTest();
  setLoadedForTest("none", undefined);
  vi.unstubAllGlobals();
});

/** ログインが切れて、a を送れなかった状態にする */
async function expire() {
  putStatus = 401;
  kvSet(A, "1");
  expect(await flushQueue()).toBe(false);
  expect(authExpired()).toBe(true);
  puts = [];
  putStatus = 200;
}

describe("ログインが切れたあと、もう一度ログインしたとき", () => {
  it("同じ人なら、送れなかった入力を新しいログインで送ってから開き直す", async () => {
    await expire();
    kvSet(B, "2");
    await finishSignIn("/my", "u1");
    expect(puts).toEqual([{ set: { [A]: "1", [B]: "2" }, del: [] }]);
    expect(hasUnsent()).toBe(false);
    expect(win.location.href).toBe("/my");
  });

  it("ログインした人が渡されなければ、問い合わせて確かめる", async () => {
    await expire();
    await finishSignIn("/my");
    expect(puts).toEqual([{ set: { [A]: "1" }, del: [] }]);
  });

  it("別の人なら、前の人の入力をその人のアカウントへ送らない", async () => {
    await expire();
    await finishSignIn("/my", "u2");
    expect(puts).toEqual([]);
    expect(hasUnsent()).toBe(false);
    // 開き直すまでの間に書いても送らない
    kvSet(B, "2");
    expect(await flushQueue()).toBe(true);
    expect(puts).toEqual([]);
    expect(win.location.href).toBe("/my");
  });

  it("送れていない入力がなければ、何も送らずに開き直す", async () => {
    await finishSignIn("/my");
    expect(puts).toEqual([]);
    expect(win.location.href).toBe("/my");
  });
});

describe("別のタブで写しの持ち主が変わったとき", () => {
  it("ログインが切れただけなら、送っていない入力を残して開いたままにする", async () => {
    await expire();
    // 別のタブが「ログインが切れた」と判断して、写しを消した
    store.removeItem(A);
    store.removeItem(MODE_KEY);
    onOwnerChanged();
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(hasUnsent()).toBe(true);
    // 消された写しには、この人の入力を書き戻さない
    kvSet(B, "2");
    expect(store.getItem(B)).toBeNull();
    expect(localIsMine()).toBe(false);
  });

  it("送っていない入力がなければ、すぐに開き直す", () => {
    store.removeItem(MODE_KEY);
    onOwnerChanged();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it("別の人がログインしたら、送っていない入力は送らず、書き出しの案内を出して開いたままにする", async () => {
    kvSet(A, "1");
    store.setItem(MODE_KEY, "cloud:u2");
    onOwnerChanged();
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(events).toEqual(["switched"]);
    expect(await flushQueue()).toBe(true);
    expect(puts).toEqual([]);
    // その人の写しにも書かず、その人の値も取り込まない
    kvSet(B, "2");
    expect(store.getItem(B)).toBeNull();
    expect(localIsMine()).toBe(false);
  });

  it("同じ人が別のタブでもう一度ログインしたら、送れなかった入力を送り、そのタブの写しにも渡す", async () => {
    await expire();
    store.removeItem(MODE_KEY);
    onOwnerChanged();
    // 別のタブで同じ人がログインして、サーバーのデータ（a はまだ古い）を写しに置いた
    store.setItem(MODE_KEY, "cloud:u1");
    store.setItem(A, "old");
    onOwnerChanged();
    expect(store.getItem(A)).toBe("1");
    await tick();
    expect(puts).toEqual([{ set: { [A]: "1" }, del: [] }]);
    await tick();
    expect(events).toContain("recovered");
    expect(hasUnsent()).toBe(false);
    expect(win.location.reload).not.toHaveBeenCalled();
  });
});
