"use client";

/**
 * 書類をまとめて撮影・アップロードすると、コンパスくんが何の書類かを見分けて、種類ごとに仕分ける。
 * 違っていたらその場で種類を直せる。金額を読める書類は、続けて読み取って財産に登録できる。
 */
import { useState } from "react";
import { Reader } from "@/components/extract/Reader";
import { EXTRA_DOCS, docName } from "@/domain/filing/submission";
import { DOCS } from "@/domain/procedures/documents";
import { useDocFiles, type DocFile } from "@/lib/docFiles";
import { usePlan } from "@/lib/planStore";
import { AddButtons } from "./DocFiles";

const CHOICES = [...Object.keys(DOCS), ...Object.keys(EXTRA_DOCS)];

async function classify(f: File): Promise<string> {
  try {
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch("/api/classify", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    return r.ok && typeof j.docId === "string" && CHOICES.includes(j.docId) ? j.docId : "otherDoc";
  } catch {
    return "otherDoc";
  }
}

export function AutoSort() {
  const store = useDocFiles();
  const plan = usePlan();
  const [rows, setRows] = useState<{ rec: DocFile; file: File; read?: boolean }[]>([]);
  const [busy, setBusy] = useState(0);
  // 金額を読まない書類（戸籍・印鑑証明書など）は、入れたら「そろった」にする
  const markDone = (docId: string) => {
    if (DOCS[docId] && !DOCS[docId].readable) plan.setStatus(`doc:${docId}`, "done");
  };
  const add = async (list: File[]) => {
    setBusy((n) => n + list.length);
    for (const f of list) {
      const docId = await classify(f);
      const [rec] = await store.add(docId, [f]);
      if (rec) {
        markDone(docId);
        setRows((r) => [{ rec, file: f }, ...r]);
      }
      setBusy((n) => n - 1);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AddButtons onFiles={(l) => void add(l)} label="撮影して仕分ける" />
      </div>
      {busy > 0 && <p className="text-sm text-teal-900">コンパスくんが仕分けています（残り{busy}枚）</p>}
      {store.err && <p className="text-sm text-rose-700">{store.err}</p>}
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map(({ rec, file, read }) => (
            <li key={rec.id} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-stone-600">{rec.name}</span>
                <span className="text-stone-500">→</span>
                <select
                  aria-label="書類の種類"
                  value={rec.docId}
                  onChange={(e) => {
                    const docId = e.target.value;
                    void store.move(rec, docId);
                    markDone(docId);
                    setRows((r) => r.map((x) => (x.rec.id === rec.id ? { ...x, rec: { ...rec, docId } } : x)));
                  }}
                  className="max-w-full rounded border border-stone-300 bg-white px-2 py-1 text-base font-semibold text-stone-900 sm:text-sm"
                >
                  {CHOICES.map((id) => (
                    <option key={id} value={id}>
                      {docName(id)}
                    </option>
                  ))}
                </select>
                {DOCS[rec.docId]?.readable && !read && (
                  <button type="button" onClick={() => setRows((r) => r.map((x) => (x.rec.id === rec.id ? { ...x, read: true } : x)))} className="rounded-lg bg-sky-700 px-3 py-1.5 font-semibold text-white hover:bg-sky-800">
                    金額を読み取る
                  </button>
                )}
              </div>
              {read && (
                <div className="mt-2">
                  <Reader docId={rec.docId} file={file} save={false} onRegistered={() => plan.setStatus(`doc:${rec.docId}`, "done")} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
