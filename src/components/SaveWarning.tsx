"use client";

import { useEffect, useState } from "react";
import { usePlan } from "@/lib/planStore";
import { SAVE_FAILED } from "@/lib/saveStatus";
import { useCase } from "@/lib/store";

/** 保存に失敗したら、入力をファイルに書き出して退避できるようにする */
export function SaveWarning() {
  const [failed, setFailed] = useState(false);
  const { data } = useCase();
  const { iv, done, account } = usePlan();
  useEffect(() => {
    const on = () => setFailed(true);
    window.addEventListener(SAVE_FAILED, on);
    return () => window.removeEventListener(SAVE_FAILED, on);
  }, []);
  if (!failed) return null;
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), account, interview: iv, done, case: data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "souzoku-compass-backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  return (
    <div role="alert" className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-950 shadow-lg">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1">
          <strong>入力内容をこのブラウザに保存できませんでした。</strong>
          このまま画面を閉じたり再読み込みしたりすると、最後に保存できた状態に戻ります。ファイルに書き出して退避してください。
        </p>
        <button type="button" onClick={exportJson} className="rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800">
          入力内容をファイルに書き出す
        </button>
        <button type="button" onClick={() => setFailed(false)} className="text-rose-800 underline">
          閉じる
        </button>
      </div>
    </div>
  );
}
