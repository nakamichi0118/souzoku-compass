"use client";

import { useEffect, useState } from "react";
import { CompassAvatar } from "@/components/compass/CompassKun";
import { type Progress, ProgressBar } from "@/components/compass/ProgressBar";

/**
 * コンパスくんが土地や路線価図を探している間、画面全体を覆って操作できないようにする（キャンセルだけ押せる）。
 * すぐ終わる待ちでちらつかないよう、少したってから出す
 */
export function BusyOverlay({ message, progress, onCancel, delayMs = 400 }: { message: string; progress?: Progress | null; onCancel: () => void; delayMs?: number }) {
  const [shown, setShown] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) return;
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  return (
    // 覆いは出す前から置き、押しても下の地図に届かないようにする（見えるのは少したってから）
    <div className={`fixed inset-0 z-[2000] flex items-center justify-center p-4 transition-colors ${shown ? "bg-stone-900/45" : "bg-transparent"}`} aria-busy="true">
      {shown && (
        <div role="alertdialog" aria-modal="true" aria-label={message} className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-2xl">
          <div className="flex justify-center">
            <CompassAvatar size={64} thinking />
          </div>
          <ProgressBar message={message} progress={progress} className="mt-3 text-sm text-teal-900" />
          <button type="button" onClick={onCancel} className="mt-4 min-h-11 rounded-full border border-stone-300 px-6 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            キャンセル
          </button>
        </div>
      )}
    </div>
  );
}
