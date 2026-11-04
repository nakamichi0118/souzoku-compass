"use client";

import { CalendarClock, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { FirmBadge } from "@/components/compass/ConsultForm";
import { CONSULT_FIRM } from "@/data/consultFirm";

export interface ConsultItem {
  id: string;
  userEmail: string;
  name: string;
  prefecture: string;
  contact: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  messages: { from: "user" | "firm"; text: string; at: string }[];
  meeting?: { url: string; at?: string; note?: string };
  unread: number;
}

const when = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

async function call(url: string, method: string, body?: unknown): Promise<ConsultItem> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "うまくいきませんでした。");
  return j.item;
}

/** 1件の相談のやりとり。staff は事務所の画面（打ち合わせの案内を入れられる） */
export function ConsultThread({ item, staff, onChange }: { item: ConsultItem; staff: boolean; onChange: (x: ConsultItem) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mt, setMt] = useState({ url: item.meeting?.url ?? "", at: item.meeting?.at ?? "", note: item.meeting?.note ?? "" });
  const run = async (fn: () => Promise<ConsultItem>) => {
    setBusy(true);
    setErr(null);
    try {
      onChange(await fn());
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (await run(() => call(`/api/consult/${item.id}`, "POST", { text }))) setText("");
  };
  const mine = (from: "user" | "firm") => (staff ? from === "firm" : from === "user");

  return (
    <div className="space-y-4">
      <details className="rounded-lg border border-stone-200 bg-white p-3 text-sm" open={staff}>
        <summary className="cursor-pointer font-semibold text-stone-800">
          相談の内容（{when(item.createdAt)}）
        </summary>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-stone-700 sm:grid-cols-[8rem_1fr]">
          <dt className="text-stone-500">お名前</dt>
          <dd>{item.name}</dd>
          <dt className="text-stone-500">都道府県</dt>
          <dd>{item.prefecture}</dd>
          <dt className="text-stone-500">連絡先</dt>
          <dd className="break-all">{item.contact}</dd>
          {staff && (
            <>
              <dt className="text-stone-500">登録のメール</dt>
              <dd className="break-all">{item.userEmail}</dd>
            </>
          )}
        </dl>
        <p className="mt-2 whitespace-pre-wrap rounded bg-stone-50 p-2 text-stone-800">{item.content}</p>
      </details>

      {item.meeting && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-teal-300 bg-teal-50 p-3 text-sm">
          <CalendarClock className="h-5 w-5 text-teal-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-teal-900">打ち合わせ{item.meeting.at ? `：${item.meeting.at}` : ""}</p>
            {item.meeting.note && <p className="text-stone-700">{item.meeting.note}</p>}
          </div>
          <a href={item.meeting.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white hover:bg-teal-800">
            <Video className="h-4 w-4" aria-hidden />
            打ち合わせに参加する
          </a>
        </div>
      )}

      <ul className="space-y-2">
        {item.messages.length === 0 && (
          <li className="text-sm text-stone-500">{staff ? "まだメッセージはありません。" : `${CONSULT_FIRM.name}からの返事を待っています。返事が届くと、ここに表示されます。`}</li>
        )}
        {item.messages.map((m, i) => (
          <li key={i} className={`flex ${mine(m.from) ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${mine(m.from) ? "bg-teal-700 text-white" : "border border-stone-200 bg-white text-stone-800"}`}>
              {!mine(m.from) && m.from === "firm" && (
                <div className="mb-1">
                  <FirmBadge size="sm" />
                </div>
              )}
              {!mine(m.from) && m.from === "user" && <p className="mb-1 text-xs font-semibold text-stone-500">{item.name}さん</p>}
              <p className="whitespace-pre-wrap">{m.text}</p>
              <p className={`mt-1 text-[11px] ${mine(m.from) ? "text-teal-100" : "text-stone-400"}`}>{when(m.at)}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} placeholder="メッセージを書く" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm" />
        <Button onClick={send} disabled={busy || !text.trim()}>
          送る
        </Button>
      </div>

      {staff && (
        <div className="space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
          <p className="font-semibold text-stone-800">打ち合わせの案内（Google Meet・Zoom などのURL）</p>
          <input value={mt.url} onChange={(e) => setMt({ ...mt, url: e.target.value })} placeholder="https://meet.google.com/…" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm" />
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={mt.at} onChange={(e) => setMt({ ...mt, at: e.target.value })} placeholder="日時（例：11月10日（火）14:00〜）" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm" />
            <input value={mt.note} onChange={(e) => setMt({ ...mt, note: e.target.value })} placeholder="ひとこと（任意）" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm" />
          </div>
          <Button variant="secondary" onClick={() => run(() => call(`/api/consult/${item.id}`, "PUT", mt))} disabled={busy}>
            {mt.url ? "案内を送る" : "案内を消す"}
          </Button>
        </div>
      )}
      {err && <p className="text-xs text-red-700">{err}</p>}
    </div>
  );
}

/** 相談の一覧と、選んだ相談のやりとり（利用者のページ・事務所の画面で共通） */
export function ConsultInbox({ items, staff, onChange, empty }: { items: ConsultItem[]; staff: boolean; onChange: (x: ConsultItem) => void; empty: React.ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null);
  const [loading, setLoading] = useState(false);
  const cur = items.find((x) => x.id === openId) ?? items[0];
  // 最初に開いている相談に未読があれば、読んだことにする
  const firstUnread = cur && cur.unread > 0 ? cur.id : null;
  useEffect(() => {
    if (firstUnread) void pick(firstUnread);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstUnread]);
  if (!items.length || !cur) return <>{empty}</>;
  async function pick(id: string) {
    setOpenId(id);
    setLoading(true);
    try {
      onChange(await call(`/api/consult/${id}`, "GET"));
    } catch {
      /* 一覧の内容のまま見せる */
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ul className="space-y-1">
        {items.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              onClick={() => pick(x.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${x.id === cur.id ? "border-teal-600 bg-teal-50" : "border-stone-200 bg-white hover:bg-stone-50"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-stone-800">{staff ? `${x.name}さん（${x.prefecture}）` : `相談（${when(x.createdAt)}）`}</span>
                {x.unread > 0 && <span className="rounded-full bg-orange-500 px-1.5 text-[11px] font-bold text-white">{x.unread}</span>}
              </span>
              <span className="block text-xs text-stone-500">最終更新 {when(x.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={loading ? "opacity-60" : ""}>
        <ConsultThread key={cur.id} item={cur} staff={staff} onChange={onChange} />
      </div>
    </div>
  );
}
