import Link from "next/link";
import { LogoMark } from "./compass/CompassKun";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-sky-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold text-sky-950">
          <LogoMark size={34} />
          相続コンパス
        </Link>
        <nav className="hidden flex-1 gap-6 text-sm font-medium text-stone-700 md:flex">
          <Link href="/#progress" className="hover:text-sky-800">
            進み具合
          </Link>
          <Link href="/#features" className="hover:text-sky-800">
            特長
          </Link>
          <Link href="/case/decedent" className="hover:text-sky-800">
            相続税申告
          </Link>
          <Link href="/case/map" className="hover:text-sky-800">
            土地の評価
          </Link>
        </nav>
        <Link href="/start" className="ml-auto rounded-full bg-sky-700 px-5 py-2 text-sm font-bold text-white shadow hover:bg-sky-800 md:ml-0">
          はじめる
        </Link>
      </div>
    </header>
  );
}
