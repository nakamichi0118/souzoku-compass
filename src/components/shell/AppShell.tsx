"use client";

import { CalendarDays, Calculator, FileText, House, ListChecks, Printer, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/compass/CompassKun";
import { NoticeBell } from "./Notices";
import { useOverall } from "@/lib/overall";

const NAV: { href: string; label: string; Icon: LucideIcon; match: (p: string) => boolean }[] = [
  { href: "/my", label: "ホーム", Icon: House, match: (p) => p === "/my" },
  { href: "/my/tasks", label: "やることリスト", Icon: ListChecks, match: (p) => p.startsWith("/my/tasks") },
  { href: "/my/calendar", label: "カレンダー", Icon: CalendarDays, match: (p) => p.startsWith("/my/calendar") },
  { href: "/my/docs", label: "資料集め", Icon: FileText, match: (p) => p.startsWith("/my/docs") },
  { href: "/case/assets", label: "財産と相続税", Icon: Calculator, match: (p) => p.startsWith("/case/") && p !== "/case/registration" },
  { href: "/my/papers", label: "書類・帳票", Icon: Printer, match: (p) => p.startsWith("/my/papers") || p === "/case/registration" },
];

/** マイページ共通の枠（ナビゲーション・手続き中の相続・全体の進捗） */
export function AppHeader() {
  const o = useOverall();
  const path = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (o.loaded && !o.account) router.replace("/login");
  }, [o.loaded, o.account, router]);

  return (
    <header className="sticky top-0 z-40 border-b border-sky-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
        <Link href="/my" className="flex shrink-0 items-center gap-2 text-lg font-bold text-sky-950">
          <LogoMark size={30} />
          <span className="hidden lg:inline">相続コンパス</span>
        </Link>
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="メニュー">
          {NAV.map((n) => {
            const on = n.match(path);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium ${on ? "bg-sky-100 text-sky-900" : "text-stone-600 hover:bg-stone-100"}`}
              >
                <n.Icon className={`h-4 w-4 ${on ? "text-brand" : "text-brand/80"}`} aria-hidden />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <NoticeBell />
        <div className="relative shrink-0">
          <button type="button" onClick={() => setMenu((m) => !m)} className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-stone-700 hover:bg-stone-100">
            <UserRound className="h-5 w-5 text-brand" aria-hidden /> <span className="hidden md:inline">{o.account?.name ?? ""}さん</span> ▾
          </button>
          {menu && (
            <div className="absolute right-0 mt-1 w-52 rounded-xl border border-stone-200 bg-white p-1 text-sm shadow-lg">
              <Link href="/my/hearing" className="block rounded-lg px-3 py-2 hover:bg-stone-50">
                聞き取りの答えを直す
              </Link>
              <Link href="/" className="block rounded-lg px-3 py-2 hover:bg-stone-50">
                相続コンパスのトップ
              </Link>
              <button
                type="button"
                className="block w-full rounded-lg px-3 py-2 text-left text-stone-600 hover:bg-stone-50"
                onClick={() => {
                  o.signOut();
                  router.push("/");
                }}
              >
                ログアウト
              </button>
            </div>
          )}
        </div>
      </div>
      {o.valid && o.heard && (
        <div className="border-t border-sky-50 bg-sky-50/60">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-sm">
            <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[11px] text-stone-600">手続き中の相続</span>
            <span className="font-semibold text-stone-800">{o.iv.decedentName ? `${o.iv.decedentName}さんの相続` : "あなたの相続"}</span>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-stone-600">全体の進捗</span>
              <span className="h-2 w-32 overflow-hidden rounded-full bg-white sm:w-48">
                <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${o.pct}%` }} />
              </span>
              <span className="font-bold tabular-nums text-stone-800">
                {o.pct}%<span className="ml-1 text-xs font-normal text-stone-500">（{o.finished} / {o.total} 件）</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

export function AppShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50/70 to-stone-50">
      <AppHeader />
      <main className={`mx-auto ${wide ? "max-w-7xl" : "max-w-6xl"} px-4 py-6`}>{children}</main>
    </div>
  );
}

/** ページの見出し（コンパスくんの吹き出しつき） */
export function PageHead({ title, lead, say, actions }: { title: string; lead?: string; say?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/compass-kun-main.png" alt="コンパスくん" className="h-20 w-auto shrink-0" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-sky-950">{title}</h1>
          {lead && <p className="text-sm text-stone-600">{lead}</p>}
          {say && <p className="mt-1 inline-block rounded-2xl rounded-tl-none border border-sky-100 bg-white px-3 py-1.5 text-sm text-stone-800 shadow-sm">{say}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}
