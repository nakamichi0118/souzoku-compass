"use client";

import type { ItemStatus } from "@/lib/planStore";

/** 相続税申告の画面の進み具合で自動的に完了になった項目に出す説明（押せなくした「完了」に添える） */
export const AUTO_DONE_NOTE = "申告の画面で済んだので、自動で完了にしています。";

/**
 * 一覧の行につける「完了」チェックと「不要」ボタン。
 * locked に理由を渡すと、ほかの画面の進み具合で自動的に決まる項目として、押せなくする（理由は押そうとしたときに表示）
 * スマホの指でも押し分けられるよう、見た目はそのままで、どちらもまわりの余白（高さ36px）まで押せる。押せる範囲は重ならない。
 * muted のときは、チェックを緑ではなくグレーにする（カレンダーでは済んだ手続きをグレーで見せる）
 */
export function RowStatus({ status, onChange, label, locked, muted }: { status: ItemStatus; onChange: (s: ItemStatus) => void; label: string; locked?: string; muted?: boolean }) {
  return (
    <span className="-ml-2 flex shrink-0 items-center" title={locked}>
      <label className={`grid h-9 w-9 place-items-center ${locked ? "" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          checked={status === "done"}
          disabled={!!locked}
          onChange={() => onChange(status === "done" ? "open" : "done")}
          className={`h-5 w-5 disabled:opacity-60 ${muted ? "accent-stone-500" : "accent-emerald-600"}`}
          aria-label={`${label}を完了にする`}
        />
      </label>
      <button
        type="button"
        onClick={() => onChange(status === "na" ? "open" : "na")}
        disabled={!!locked}
        aria-pressed={status === "na"}
        aria-label={`${label}を不要にする`}
        title={locked ?? "自分には関係ない・やらない場合"}
        className="group flex h-9 items-center px-1 disabled:opacity-40"
      >
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4 ${status === "na" ? "border-stone-500 bg-stone-500 text-white" : "border-stone-300 text-stone-500 group-hover:bg-stone-100"}`}>不要</span>
      </button>
    </span>
  );
}

/** 詳細画面の「完了」「不要」ボタン。locked のときはボタンの代わりに理由を表示する。済んだ状態は緑ではなくグレーで見せる */
export function DetailStatus({ status, onChange, locked }: { status: ItemStatus; onChange: (s: ItemStatus) => void; locked?: string }) {
  const btn = "rounded-full px-4 py-2 text-sm font-bold";
  if (locked)
    return (
      <div className="max-w-xs text-right">
        <span className={`${btn} inline-block bg-stone-100 text-stone-600`}>✓ 完了</span>
        <p className="mt-1 text-xs text-stone-500">{locked}</p>
      </div>
    );
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onChange(status === "done" ? "open" : "done")} className={`${btn} ${status === "done" ? "bg-stone-100 text-stone-600 hover:bg-stone-200" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
        {status === "done" ? "✓ 完了（戻す）" : "完了にする"}
      </button>
      <button type="button" onClick={() => onChange(status === "na" ? "open" : "na")} className={`${btn} ${status === "na" ? "bg-stone-500 text-white" : "border border-stone-300 text-stone-600 hover:bg-stone-100"}`}>
        {status === "na" ? "不要（戻す）" : "不要にする"}
      </button>
    </div>
  );
}
