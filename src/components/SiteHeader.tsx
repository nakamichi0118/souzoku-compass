import Link from "next/link";
import { LogoMark } from "./compass/CompassKun";
import { HeaderCta } from "./HeaderCta";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-sky-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold text-sky-950">
          <LogoMark size={34} />
          相続コンパス
        </Link>
        <nav className="hidden flex-1 gap-6 text-sm font-medium text-stone-700 md:flex">
          <Link href="/#how" className="hover:text-sky-800">
            使い方
          </Link>
          <Link href="/#features" className="hover:text-sky-800">
            できること
          </Link>
          <Link href="/demo" className="hover:text-sky-800">
            デモを見る
          </Link>
        </nav>
        <div className="ml-auto md:ml-0">
          <HeaderCta />
        </div>
      </div>
    </header>
  );
}
