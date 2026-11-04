"use client";

import { CircleHelp } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { helpFor } from "@/data/help";
import { useOutsideClose } from "./useOutsideClose";

/** 右上の「使い方」：いま開いている画面の使い方を、その場で出す */
export function HelpButton() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, setOpen);
  const h = helpFor(path);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="使い方"
        className="flex min-h-9 items-center gap-1 rounded-full px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100"
      >
        <CircleHelp className="h-5 w-5 text-brand" aria-hidden />
        <span className="hidden sm:inline">使い方</span>
      </button>
      {open && (
        <div role="dialog" aria-label="この画面の使い方" className="absolute right-0 z-50 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white p-4 text-sm shadow-lg">
          {h ? (
            <>
              <p className="font-bold text-sky-950">{h.title}の使い方</p>
              <p className="mt-1 text-stone-700">{h.what}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-stone-700">
                {h.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-stone-700">画面ごとの使い方は、ヘルプにまとめています。</p>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-100 pt-2">
            <Link href={`/help${h ? `#${h.id}` : ""}`} onClick={close} className="font-semibold text-sky-800 hover:underline">
              ヘルプを見る ›
            </Link>
            <Link href="/my?guide=1" onClick={close} className="font-semibold text-sky-800 hover:underline">
              操作ガイド ›
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
