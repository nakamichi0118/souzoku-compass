"use client";

import { AlertTriangle, Bell, Clock, Megaphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useOutsideClose } from "./useOutsideClose";
import { jpDate } from "@/domain/procedures/dates";
import { type Notice, useNotices } from "@/lib/notices";
import { useOverall } from "@/lib/overall";

type Tab = "personal" | "system";

function Item({ n, unread, onOpen }: { n: Notice; unread: boolean; onOpen?: () => void }) {
  const Icon = n.kind === "system" ? Megaphone : n.level === "danger" ? AlertTriangle : Clock;
  const color = n.level === "danger" ? "text-rose-600" : n.level === "warn" ? "text-orange-600" : "text-brand";
  const body = (
    <div className="flex gap-3">
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} aria-hidden />
      <div className="min-w-0">
        <p className={`text-sm ${unread ? "font-bold text-stone-900" : "font-semibold text-stone-700"}`}>
          {unread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-orange-500 align-middle" aria-label="未読" />}
          {n.title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-stone-600">{n.kind === "system" ? `${jpDate(n.date)}　${n.body}` : n.body}</p>
      </div>
    </div>
  );
  return n.href ? (
    <Link href={n.href} onClick={onOpen} className="block rounded-lg px-3 py-2 hover:bg-stone-50">
      {body}
    </Link>
  ) : (
    <div className="px-3 py-2">{body}</div>
  );
}

export function NoticeTabs({ compact, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  const o = useOverall();
  const nt = useNotices(o);
  const [tab, setTab] = useState<Tab>("personal");
  const list = tab === "personal" ? nt.personal : nt.system;
  const count = (k: Tab) => (k === "personal" ? nt.personal : nt.system).filter(nt.unread).length;
  // 見たタブのお知らせは既読にする（少し表示してから）
  useEffect(() => {
    const ids = list.filter(nt.unread).map((n) => n.id);
    if (ids.length === 0) return;
    const t = setTimeout(() => nt.markRead(ids), 1500);
    return () => clearTimeout(t);
  }, [list, nt]);
  return (
    <div>
      <div className="flex gap-1 border-b border-stone-200 px-2">
        {(
          [
            ["personal", "あなたへのお知らせ"],
            ["system", "相続コンパスから"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand font-bold text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800"}`}>
            {l}
            {count(k) > 0 && <span className="ml-1 rounded-full bg-orange-500 px-1.5 text-[10px] font-bold text-white">{count(k)}</span>}
          </button>
        ))}
      </div>
      <div className={`${compact ? "max-h-[min(24rem,calc(100dvh-10rem))] overflow-y-auto" : ""} divide-y divide-stone-100 py-1`}>
        {list.length === 0 && <p className="px-3 py-6 text-center text-sm text-stone-500">{tab === "personal" ? "いま急ぎのお知らせはありません。" : "お知らせはありません。"}</p>}
        {(compact ? list.slice(0, 8) : list).map((n) => (
          <Item key={n.id} n={n} unread={nt.unread(n)} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

/** 右上のお知らせ（ベル）。押すとお知らせの一覧が開く */
export function NoticeBell() {
  const o = useOverall();
  const nt = useNotices(o);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, setOpen);
  return (
    // スマホでは、一覧を画面の幅いっぱい（左右に余白）で出す。ベルの位置に合わせると左にはみ出すため
    <div ref={ref} className="shrink-0 sm:relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="relative rounded-full p-2 hover:bg-stone-100" aria-label={`お知らせ（未読${nt.unreadCount}件）`} aria-expanded={open}>
        <Bell className="h-5 w-5 text-brand" aria-hidden />
        {nt.unreadCount > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">{nt.unreadCount}</span>}
      </button>
      {open && (
        <div className="absolute inset-x-4 top-full z-50 mt-1 rounded-xl border border-stone-200 bg-white shadow-xl sm:inset-x-auto sm:right-0 sm:top-auto sm:w-96">
          <NoticeTabs compact onOpen={() => setOpen(false)} />
          <Link href="/my/notices" onClick={() => setOpen(false)} className="block border-t border-stone-100 px-3 py-2 text-center text-sm text-sky-800 hover:bg-stone-50">
            すべてのお知らせを見る
          </Link>
        </div>
      )}
    </div>
  );
}
