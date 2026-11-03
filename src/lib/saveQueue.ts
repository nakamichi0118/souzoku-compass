/**
 * サーバーへ送る書き込みの待ち行列（ログイン中だけ使う）。
 *
 * - 書き込みは少し待ってまとめて送る
 * - 同時に送るのは1つだけ。送っている間に書かれた分は、送り終わってから次にまとめて送る
 * - 送れなかった分は戻して、次に送り直す。ただし、そのあと同じ項目に新しい値が書かれていれば、新しいほうを残す
 *   （古い値で新しい値を上書きしないため）
 * - ログインの期限が切れた（401）ときは送り直さず、もう一度ログインするよう知らせる。
 *   送れなかった分は残しておき、同じ人がもう一度ログインしたら送る（別の人がログインしたら捨てる）
 */
import { reportSaveFailure } from "./saveStatus";

const ENDPOINT = "/api/me/data";
/** 書き込みから送るまで待つ時間（続けて入力した分をまとめる） */
export const SAVE_DELAY_MS = 800;

let enabled = false;
const pending = { set: new Map<string, string>(), del: new Set<string>() };
/** 項目ごとの書き込みの番号。送れなかった分を戻すとき、そのあとに書かれたかを見分ける */
const version = new Map<string, number>();
let seq = 0;
/** いま送っている途中の項目 */
const inflight = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** 送る順番待ち。前の送信が終わってから次を送る */
let chain: Promise<boolean> = Promise.resolve(true);
let authLost = false;

interface Batch {
  set: Record<string, string>;
  del: string[];
  ver: Map<string, number>;
}

function cancelTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** サーバーへ送るかどうか（ログイン中だけ送る） */
export function setQueueEnabled(on: boolean) {
  enabled = on;
  if (!on) cancelTimer();
}

/** ログインの期限が切れて、サーバーが受け付けなくなった */
export const authExpired = () => authLost;
export const hasPending = () => pending.set.size > 0 || pending.del.size > 0;
/** まだサーバーに届いていない書き込みがあるか（送っている途中のもの・ログインが切れて送れないものを含む） */
export const hasUnsent = () => hasPending() || inflight.size > 0 || authLost;
/** このタブで書いて、まだサーバーに届いていない値があるか */
export const isUnsaved = (key: string) => pending.set.has(key) || pending.del.has(key) || inflight.has(key);

/** 書き込みを待ち行列に入れる（null で消す） */
export function queueWrite(key: string, value: string | null) {
  if (!enabled) return;
  version.set(key, ++seq);
  if (value === null) {
    pending.set.delete(key);
    pending.del.add(key);
  } else {
    pending.del.delete(key);
    pending.set.set(key, value);
  }
  cancelTimer();
  timer = setTimeout(() => void flushQueue(), SAVE_DELAY_MS);
}

function take(): Batch {
  const b: Batch = { set: Object.fromEntries(pending.set), del: [...pending.del], ver: new Map() };
  for (const k of [...pending.set.keys(), ...pending.del]) b.ver.set(k, version.get(k) ?? 0);
  pending.set.clear();
  pending.del.clear();
  return b;
}

/** 送れなかった分を戻す。そのあと同じ項目に書かれていれば、新しいほうを残す */
function putBack(b: Batch) {
  const unchanged = (k: string) => (version.get(k) ?? 0) === b.ver.get(k);
  for (const [k, v] of Object.entries(b.set)) {
    if (!unchanged(k)) continue;
    pending.del.delete(k);
    pending.set.set(k, v);
  }
  for (const k of b.del) {
    if (!unchanged(k)) continue;
    pending.set.delete(k);
    pending.del.add(k);
  }
}

const wire = (b: Batch) => JSON.stringify({ set: b.set, del: b.del });

async function sendOnce(): Promise<boolean> {
  if (!enabled || !hasPending()) return true;
  if (authLost) {
    reportSaveFailure("auth");
    return false;
  }
  const b = take();
  const keys = [...Object.keys(b.set), ...b.del];
  for (const k of keys) inflight.add(k);
  try {
    const res = await fetch(ENDPOINT, { method: "PUT", headers: { "content-type": "application/json" }, body: wire(b) });
    if (res.status === 401) authLost = true;
    if (!res.ok) throw new Error(String(res.status));
    return true;
  } catch {
    putBack(b);
    reportSaveFailure(authLost ? "auth" : "network");
    return false;
  } finally {
    for (const k of keys) inflight.delete(k);
  }
}

/**
 * 待っている書き込みをサーバーへ送る。送っている途中のものがあれば、それが終わってから残りを送る。
 * すべて届いた（送るものがない）ときは true、届かなかったときは false。
 */
export function flushQueue(): Promise<boolean> {
  cancelTimer();
  chain = chain.then(sendOnce, sendOnce);
  return chain;
}

/** 同じ人がもう一度ログインした：残っている書き込みを、新しいログインで送れるようにする */
export function resumeAfterLogin() {
  authLost = false;
}

/** 送っていない書き込み（別のタブへ渡すため）。送っている途中のものは含まない */
export function unsentWrites(): { set: Record<string, string>; del: string[] } {
  return { set: Object.fromEntries(pending.set), del: [...pending.del] };
}

/**
 * 送っていない書き込みを捨てる（別の人がログインしたとき、その人のアカウントへ送らないため）。
 * 送っている途中のものが失敗しても、戻さない
 */
export function dropUnsent() {
  cancelTimer();
  for (const k of [...pending.set.keys(), ...pending.del, ...inflight]) version.set(k, ++seq);
  pending.set.clear();
  pending.del.clear();
  authLost = false;
}

/** ページを閉じるとき：残りを sendBeacon で送る（送れなければ戻しておく） */
export function sendRestWithBeacon() {
  if (!enabled || authLost || !hasPending() || typeof navigator === "undefined" || !navigator.sendBeacon) return;
  const b = take();
  if (!navigator.sendBeacon(ENDPOINT, new Blob([wire(b)], { type: "application/json" }))) putBack(b);
}

/** テスト用：初めの状態に戻す */
export function resetQueueForTest() {
  cancelTimer();
  enabled = false;
  pending.set.clear();
  pending.del.clear();
  version.clear();
  inflight.clear();
  chain = Promise.resolve(true);
  authLost = false;
}
