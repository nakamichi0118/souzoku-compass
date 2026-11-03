"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { flush, useSession } from "@/lib/cloud";
import { usePlan } from "@/lib/planStore";
import { SAVE_FAILED, SAVE_RECOVERED, type SaveFailure } from "@/lib/saveStatus";
import { useCase } from "@/lib/store";
import { saveBlob } from "@/lib/download";

const MESSAGE: Record<SaveFailure, { title: string; body: string }> = {
  network: {
    title: "入力内容を保存できませんでした。",
    body: "通信が切れている可能性があります。次に入力したときにもう一度送りますが、念のためファイルに書き出して退避できます。",
  },
  leaving: {
    title: "入力内容を保存できなかったため、ログアウトを取りやめました。",
    body: "このまま進むと、保存していない入力が消えてしまいます。通信が戻ってから「もう一度保存する」を押すか、ファイルに書き出して退避してください。",
  },
  auth: {
    title: "ログインの有効期限が切れたため、入力内容を保存できませんでした。",
    body: "同じメールアドレスでもう一度ログインすると、保存できなかった入力をまとめて保存します。念のため、先にファイルに書き出して退避することもできます。",
  },
  switched: {
    title: "別のタブで、別のメールアドレスでログインしたか、デモに切り替えました。",
    body: "このタブの入力は、ほかの人のデータと混ざらないよう、もう保存しません。保存していない入力をファイルに書き出してから、画面を開き直してください。",
  },
};

/** 保存に失敗したら、入力をファイルに書き出して退避できるようにする */
export function SaveWarning() {
  const [failed, setFailed] = useState<SaveFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const { mode } = useSession();
  const { data } = useCase();
  const { iv, done, account, memos } = usePlan();
  useEffect(() => {
    const on = (e: Event) => {
      const kind = (e as CustomEvent<SaveFailure | undefined>).detail ?? "network";
      // 「別のタブで切り替えた」「ログインが切れた」「ログアウトを取りやめた」の知らせは、ふつうの失敗の知らせで上書きしない
      setFailed((cur) => (cur === "switched" || (cur === "auth" && kind !== "switched") || (cur === "leaving" && kind === "network") ? cur : kind));
    };
    // 別のタブでもう一度ログインして、送れなかった入力を送り終えた
    const recovered = () => setFailed((cur) => (cur === "switched" ? cur : null));
    window.addEventListener(SAVE_FAILED, on);
    window.addEventListener(SAVE_RECOVERED, recovered);
    return () => {
      window.removeEventListener(SAVE_FAILED, on);
      window.removeEventListener(SAVE_RECOVERED, recovered);
    };
  }, []);
  if (!failed) return null;
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), account, interview: iv, done, memos, case: data }, null, 2)], { type: "application/json" });
    saveBlob(blob, "souzoku-compass-backup.json");
  };
  const retry = async () => {
    setBusy(true);
    const ok = await flush();
    setBusy(false);
    if (ok) setFailed(null);
  };
  const msg = MESSAGE[failed];
  if (failed === "switched") {
    // このタブではもう保存しないので、入力を続けられないよう画面をふさぐ
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 px-4">
        <div role="alertdialog" aria-modal="true" aria-labelledby="save-switched-title" className="w-full max-w-md rounded-xl border-2 border-rose-400 bg-white p-6 text-sm text-stone-800 shadow-2xl">
          <p id="save-switched-title" className="text-base font-bold text-rose-950">
            {msg.title}
          </p>
          <p className="mt-2">{msg.body}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={exportJson} className="rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800">
              入力内容をファイルに書き出す
            </button>
            <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-stone-300 bg-white px-4 py-2 font-semibold text-stone-800 hover:bg-stone-100">
              画面を開き直す
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div role="alert" className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-950 shadow-lg">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1">
          <strong>{msg.title}</strong>
          {msg.body}
        </p>
        <button type="button" onClick={exportJson} className="rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800">
          入力内容をファイルに書き出す
        </button>
        {failed === "auth" ? (
          <Link href="/login" className="rounded-lg border border-rose-400 bg-white px-4 py-2 font-semibold text-rose-800 hover:bg-rose-100">
            もう一度ログインする
          </Link>
        ) : (
          mode === "cloud" && (
            <button type="button" onClick={() => void retry()} disabled={busy} className="rounded-lg border border-rose-400 bg-white px-4 py-2 font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-60">
              {busy ? "保存しています…" : "もう一度保存する"}
            </button>
          )
        )}
        <button type="button" onClick={() => setFailed(null)} className="text-rose-800 underline">
          閉じる
        </button>
      </div>
    </div>
  );
}
