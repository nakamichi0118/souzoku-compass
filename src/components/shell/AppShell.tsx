"use client";

import { isStaffEmail } from "@/data/consultFirm";
import { CalendarDays, Calculator, FileText, House, ListChecks, Menu, Printer, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/compass/CompassKun";
import { centerCurrent } from "@/components/ui/scroll";
import { NoticeBell } from "./Notices";
import { useOutsideClose } from "./useOutsideClose";
import { useOverall } from "@/lib/overall";

export const NAV: { href: string; label: string; Icon: LucideIcon; match: (p: string) => boolean; count?: "tasks" | "docs" }[] = [
  { href: "/my", label: "ホーム", Icon: House, match: (p) => p === "/my" },
  { href: "/my/tasks", label: "やることリスト", Icon: ListChecks, match: (p) => p.startsWith("/my/tasks"), count: "tasks" },
  { href: "/my/calendar", label: "カレンダー", Icon: CalendarDays, match: (p) => p.startsWith("/my/calendar") },
  { href: "/my/docs", label: "資料集め", Icon: FileText, match: (p) => p.startsWith("/my/docs"), count: "docs" },
  { href: "/case/assets", label: "財産と相続税", Icon: Calculator, match: (p) => p.startsWith("/case/") && p !== "/case/registration" },
  { href: "/my/papers", label: "書類・帳票", Icon: Printer, match: (p) => p.startsWith("/my/papers") || p === "/case/registration" },
];

/** メニューの項目（横並びのメニューと、スマホで ▾ から開くメニューの両方で使う） */
export function NavLinks({ path, left, className, onPick }: { path: string; left: { tasks: number; docs: number } | null; className: string; onPick?: () => void }) {
  return NAV.map((n) => {
    const on = n.match(path);
    return (
      <Link key={n.href} href={n.href} onClick={onPick} aria-current={on ? "page" : undefined} className={`${className} ${on ? "bg-sky-100 text-sky-900" : "text-stone-600 hover:bg-stone-100"}`}>
        <n.Icon className={`h-4 w-4 shrink-0 ${on ? "text-brand" : "text-brand/80"}`} aria-hidden />
        {n.label}
        {n.count && left && left[n.count] > 0 && (
          <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[11px] font-bold tabular-nums text-white" aria-label={`残り${left[n.count]}件`}>
            {left[n.count]}
          </span>
        )}
      </Link>
    );
  });
}

/** マイページ共通の枠（ナビゲーション・手続き中の相続・全体の進捗） */
export function AppHeader() {
  const o = useOverall();
  const path = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useOutsideClose(menu, menuRef, setMenu);
  // まだ終わっていない件数（不要にしたものは数えない）
  const left = o.valid && o.heard ? { tasks: o.live.length - o.doneTasks, docs: o.docs.filter((d) => !d.na).length - o.doneDocs } : null;

  useEffect(() => {
    if (o.loaded && !o.account) router.replace("/login");
  }, [o.loaded, o.account, router]);

  // 横並びのメニューに収まらないときも、いまのページの項目が見えるようにする
  useEffect(() => centerCurrent(navRef.current), [path]);

  const close = () => setMenu(false);
  return (
    <header className="sticky top-0 z-40 border-b border-sky-100 bg-white/95 backdrop-blur">
      {/* スマホ・タブレットでは、メニューを横に並べず ▾ の中に入れる（横に送る帯にしない） */}
      <div className="relative mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
        <Link href="/my" className="flex shrink-0 items-center gap-2 text-lg font-bold whitespace-nowrap text-sky-950">
          <LogoMark size={30} />
          <span className="lg:hidden xl:inline">相続コンパス</span>
        </Link>
        <nav ref={navRef} className="hidden min-w-0 flex-1 gap-1 overflow-x-auto lg:flex" aria-label="メニュー">
          <NavLinks path={path} left={left} className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium" />
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0">
          <NoticeBell />
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              aria-expanded={menu}
              className="flex min-h-9 items-center gap-1 rounded-full px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100"
            >
              <Menu className="h-5 w-5 text-brand lg:hidden" aria-hidden />
              <span className="sr-only md:hidden">メニュー</span>
              <UserRound className="hidden h-5 w-5 text-brand lg:block" aria-hidden /> <span className="hidden md:inline">{o.account?.name ?? ""}さん</span> ▾
            </button>
            {menu && (
              <div className="absolute right-0 z-50 mt-1 max-h-[calc(100dvh-4rem)] w-56 overflow-y-auto rounded-xl border border-stone-200 bg-white p-1 text-sm shadow-lg">
                <div className="mb-1 border-b border-stone-100 pb-1 lg:hidden">
                  <NavLinks path={path} left={left} onPick={close} className="flex items-center gap-2 rounded-lg px-3 py-2 font-medium" />
                </div>
                <Link href="/my/hearing" onClick={close} className="block rounded-lg px-3 py-2 hover:bg-stone-50">
                  聞き取りの答えを直す
                </Link>
                <Link href="/my/consult" onClick={close} className="block rounded-lg px-3 py-2 hover:bg-stone-50">
                  税理士への相談
                </Link>
                {isStaffEmail(o.account?.email) && (
                  <Link href="/firm" onClick={close} className="block rounded-lg px-3 py-2 hover:bg-stone-50">
                    事務所の画面
                  </Link>
                )}
                <Link href="/" onClick={close} className="block rounded-lg px-3 py-2 hover:bg-stone-50">
                  相続コンパスのトップ
                </Link>
                <button
                  type="button"
                  className="block w-full rounded-lg px-3 py-2 text-left text-stone-600 hover:bg-stone-50"
                  onClick={() => o.signOut()}
                >
                  ログアウト
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {o.valid && o.heard && (
        <div className="border-t border-sky-50 bg-sky-50/60">
          {/* スマホでは1行に収める（名前が長いときは省略する） */}
          <div className="mx-auto flex max-w-7xl items-center gap-x-3 gap-y-1 px-4 py-1.5 text-sm sm:flex-wrap sm:gap-x-4">
            <span className="hidden shrink-0 rounded bg-stone-200 px-1.5 py-0.5 text-[11px] text-stone-600 sm:inline">手続き中の相続</span>
            <span className="min-w-0 truncate font-semibold text-stone-800">{o.iv.decedentName ? `${o.iv.decedentName}さんの相続` : "あなたの相続"}</span>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-stone-600">全体の進捗</span>
              <span className="h-2 w-14 overflow-hidden rounded-full bg-white sm:w-48">
                <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${o.pct}%` }} />
              </span>
              <span className="whitespace-nowrap font-bold tabular-nums text-stone-800">
                {o.pct}%<span className="ml-1 hidden text-xs font-normal text-stone-500 sm:inline">（{o.finished} / {o.total} 件）</span>
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
