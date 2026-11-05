"use client";

import { X } from "lucide-react";
import { useCallback, useState } from "react";
import { Reader } from "@/components/extract/Reader";
import { DOCS } from "@/domain/procedures/documents";
import type { Task } from "@/domain/procedures/rules";

/** 手続きを済ませたときに、撮影・アップロードを案内する書類（まだ集めていないもの。戸籍なども） */
export const docsToUpload = (task: Pick<Task, "docs">, done: string[]) => task.docs.filter((d) => DOCS[d] && !done.includes(`doc:${d}`));

/**
 * 手続きを済ませたときに出す案内：届いた書類をその場でアップロードして財産に登録できる。
 * 画面の下に固定するので、案内と同じ高さの余白をページの下に足して、後ろに隠れたボタンも上へ送れば押せるようにする。
 * 開いて長くなっても上の見出しには重ならず、案内の中で上下に動かせる
 */
export function UploadPrompt({ docs, open, onOpen, onClose, onRegistered }: { docs: string[]; open: boolean; onOpen: () => void; onClose: () => void; onRegistered: (doc: string, all?: boolean) => void }) {
  const names = docs.map((d) => DOCS[d].name.replace(/（.*?）/g, ""));
  const [h, setH] = useState(0);
  const card = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const update = () => setH(el.offsetHeight);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <>
      <div aria-hidden style={{ height: h }} />
      <div
        ref={card}
        role="status"
        className="fixed inset-x-3 bottom-3 z-40 mx-auto max-h-[calc(100dvh-10rem)] max-w-xl overflow-y-auto overscroll-contain rounded-2xl border border-teal-200 bg-white p-4 shadow-2xl sm:left-auto sm:right-4 sm:mx-0"
      >
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/compass-kun-main.png" alt="" className="h-12 w-auto shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-stone-900">お疲れさまでした！</p>
            <p className="mt-0.5 text-sm text-stone-700">
              「{names.join("」「")}」が届いたら、ここで撮影しませんか？{docs.some((d) => DOCS[d].readable) ? "金額はコンパスくんが読み取って、財産に登録します。" : "税務署に出す書類にまとめておきます。"}
            </p>
            {!open && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={onOpen} className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800">
                  いま撮影する
                </button>
                <button type="button" onClick={onClose} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50">
                  届いてから（資料集めでいつでもできます）
                </button>
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="-m-2 shrink-0 p-2 text-stone-400 hover:text-stone-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        {open && (
          <div className="mt-3 space-y-3 sm:max-h-[60vh] sm:overflow-y-auto">
            {docs.map((d) => (
              <div key={d}>
                <p className="mb-1 text-sm font-semibold text-stone-700">{DOCS[d].name}</p>
                <Reader docId={d} read={!!DOCS[d].readable} onRegistered={(all) => onRegistered(d, all)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
