"use client";

import type { ItemStatus } from "@/lib/planStore";

/** 一覧の行につける「完了」チェックと「不要」ボタン */
export function RowStatus({ status, onChange, label }: { status: ItemStatus; onChange: (s: ItemStatus) => void; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <input
        type="checkbox"
        checked={status === "done"}
        onChange={() => onChange(status === "done" ? "open" : "done")}
        className="h-5 w-5 accent-emerald-600"
        aria-label={`${label}を完了にする`}
      />
      <button
        type="button"
        onClick={() => onChange(status === "na" ? "open" : "na")}
        aria-pressed={status === "na"}
        title="自分には関係ない・やらない場合"
        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status === "na" ? "border-stone-500 bg-stone-500 text-white" : "border-stone-300 text-stone-500 hover:bg-stone-100"}`}
      >
        不要
      </button>
    </span>
  );
}

/** 詳細画面の「完了」「不要」ボタン */
export function DetailStatus({ status, onChange }: { status: ItemStatus; onChange: (s: ItemStatus) => void }) {
  const btn = "rounded-full px-4 py-2 text-sm font-bold";
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onChange(status === "done" ? "open" : "done")} className={`${btn} ${status === "done" ? "bg-emerald-100 text-emerald-800" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
        {status === "done" ? "✓ 完了（戻す）" : "完了にする"}
      </button>
      <button type="button" onClick={() => onChange(status === "na" ? "open" : "na")} className={`${btn} ${status === "na" ? "bg-stone-500 text-white" : "border border-stone-300 text-stone-600 hover:bg-stone-100"}`}>
        {status === "na" ? "不要（戻す）" : "不要にする"}
      </button>
    </div>
  );
}
