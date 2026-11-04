"use client";

import { CalendarDays, Calculator, CircleHelp, FileText, House, ListChecks, Printer, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CompassAvatar } from "@/components/compass/CompassKun";
import { kvGet, kvSet, PREFIX } from "@/lib/cloud";

export const GUIDE_KEY = `${PREFIX}guide-seen`;

/** 操作ガイドの各ページ（メニューの名前と同じ言葉で） */
export const GUIDE_SLIDES: { Icon: LucideIcon; title: string; text: string }[] = [
  { Icon: House, title: "ホーム", text: "「続きを進める」を押すと、次にすることが開きます。迷ったらホームに戻りましょう。" },
  { Icon: ListChecks, title: "やることリスト", text: "必要な手続きを期限の近い順に並べています。済んだら「完了」、関係なければ「不要」を押します。" },
  { Icon: CalendarDays, title: "カレンダー", text: "期限を月ごとに見られます。いつものカレンダーにも入れられます。" },
  { Icon: FileText, title: "資料集め", text: "手続きと申告に使う書類です。どこで取るかが分かります。そろったらチェックを付けます。" },
  { Icon: Calculator, title: "財産と相続税", text: "①亡くなった方から順に入れると、相続税がかかるか判定し、申告書まで作れます。" },
  { Icon: Printer, title: "書類・帳票", text: "できた申告書や遺産分割協議書を、PDFで受け取ります。" },
  { Icon: CircleHelp, title: "困ったときは", text: "右上の「使い方」で、その画面の説明が出ます。コンパスくんにも質問できます。" },
];

/** はじめてマイページを開いたときの操作ガイド（ヘルプの「操作ガイド」からも開ける） */
export function FirstGuide() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    const again = new URLSearchParams(window.location.search).get("guide") === "1";
    if (again || !kvGet(GUIDE_KEY)) setOpen(true);
  }, []);
  if (!open) return null;
  const s = GUIDE_SLIDES[i];
  const last = i === GUIDE_SLIDES.length - 1;
  const done = () => {
    kvSet(GUIDE_KEY, "1");
    setOpen(false);
    // ?guide=1 で開いたときは、閉じたあとに URL から外す（再読み込みでまた開かないように）
    if (window.location.search.includes("guide=1")) window.history.replaceState(null, "", window.location.pathname);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 p-3 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="guide-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-stone-500">
            使い方ガイド {i + 1}/{GUIDE_SLIDES.length}
          </p>
          <button type="button" onClick={done} className="rounded-lg px-2 py-1 text-sm text-stone-500 hover:bg-stone-100">
            閉じる
          </button>
        </div>
        <div className="mt-3 flex items-start gap-3">
          <CompassAvatar size={48} />
          <div className="min-w-0">
            <h2 id="guide-title" className="flex items-center gap-2 text-lg font-bold text-sky-950">
              <s.Icon className="h-5 w-5 shrink-0 text-brand" aria-hidden />
              {s.title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-700">{s.text}</p>
          </div>
        </div>
        <div className="mt-4 flex justify-center gap-1.5" aria-hidden>
          {GUIDE_SLIDES.map((g, k) => (
            <span key={g.title} className={`h-1.5 w-5 rounded-full ${k === i ? "bg-sky-700" : "bg-stone-200"}`} />
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} className="min-h-11 flex-1 rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              戻る
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? done() : setI(i + 1))}
            className="min-h-11 flex-1 rounded-full bg-sky-700 px-4 py-2 text-sm font-bold text-white hover:bg-sky-800"
          >
            {last ? "はじめる" : "次へ"}
          </button>
        </div>
      </div>
    </div>
  );
}
