"use client";

/**
 * 書類の種類ごとに、撮影・アップロードした書類を並べ、追加・削除できるようにする。
 * ファイルはこの端末の中だけに保存する（src/lib/docFiles.ts）。
 */
import { Camera, FileText, Upload, X } from "lucide-react";
import { useState } from "react";
import { docName } from "@/domain/filing/submission";
import { splitDuplicates, useDocFiles, type DocFile, type Duplicate } from "@/lib/docFiles";
import { DocCamera } from "./DocCamera";

/** 撮影する・ファイルを選ぶ の2つのボタン */
export function AddButtons({ onFiles, label = "撮影する", multiple = true, disabled }: { onFiles: (f: File[]) => void; label?: string; multiple?: boolean; disabled?: boolean }) {
  const [cam, setCam] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setCam(true)} disabled={disabled} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60">
        <Camera className="h-4 w-4" aria-hidden />
        {label}
      </button>
      <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-teal-600 bg-white px-3 py-2 text-sm text-teal-800 hover:bg-teal-50 ${disabled ? "pointer-events-none opacity-60" : ""}`}>
        <Upload className="h-4 w-4" aria-hidden />
        ファイルを選ぶ
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = "";
            if (list.length) onFiles(list);
          }}
        />
      </label>
      {cam && (
        <DocCamera
          multi={multiple}
          onClose={() => setCam(false)}
          onDone={(files) => {
            setCam(false);
            if (files.length) onFiles(files);
          }}
        />
      )}
    </>
  );
}

/** 保存した書類の小さな見本（押すと別のタブで開く） */
export function FileThumbs({ files, onRemove }: { files: DocFile[]; onRemove?: (f: DocFile) => void }) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((f) => (
        <li key={f.id} className="relative">
          <a href={f.src} target="_blank" rel="noreferrer" className="block h-16 w-12 overflow-hidden rounded border border-stone-300 bg-white" title={f.name}>
            {f.type.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.src} alt={f.name} className="h-full w-full object-cover" />
            ) : (
              <span className="grid h-full place-items-center text-stone-500">
                <FileText className="h-5 w-5" aria-hidden />
                <span className="text-[9px]">PDF</span>
              </span>
            )}
          </a>
          {onRemove && (
            <button type="button" onClick={() => onRemove(f)} aria-label={`${f.name}を削除`} className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-stone-700 text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * 同じ書類を2回入れたときの案内。保存済みの書類は追加せず、どこに入っているかを示す。
 * 別の書類だったときのために「別の書類なので追加する」を出す
 */
export function DupNote({ dups, onForce, onClose }: { dups: Duplicate[]; onForce: () => void; onClose: () => void }) {
  if (!dups.length) return null;
  const where = (d: Duplicate) => (d.same.docId ? `「${docName(d.same.docId)}」${d.same.name && d.same.name !== d.name ? `（${d.same.name}）` : ""}` : "今回選んだ書類の中");
  return (
    <div role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {dups.length === 1 ? (
        <p>「{dups[0].name}」は{where(dups[0])}にアップロード済みなので、追加しませんでした。</p>
      ) : (
        <>
          <p>次の{dups.length}つはアップロード済みなので、追加しませんでした。</p>
          <ul className="mt-1 list-disc pl-5">
            {dups.map((d, i) => (
              <li key={i}>
                「{d.name}」→ {where(d)}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={onForce} className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-amber-900 hover:bg-amber-100">
          別の書類なので追加する
        </button>
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-amber-900 underline">
          閉じる
        </button>
      </div>
    </div>
  );
}

/** 1つの書類の種類の、保存した書類と追加のボタン */
export function DocFiles({ docId, onAdded, buttons = true }: { docId: string; onAdded?: (n: number) => void; buttons?: boolean }) {
  const store = useDocFiles();
  const mine = store.of(docId);
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState<Duplicate[]>([]);
  return (
    <div className="space-y-2">
      <FileThumbs files={mine} onRemove={(f) => void store.remove(f.id)} />
      {buttons && (
        <div className="flex flex-wrap items-center gap-2">
          <AddButtons
            disabled={busy}
            label={mine.length ? "追加で撮影" : "撮影する"}
            onFiles={async (list) => {
              setBusy(true);
              const split = await splitDuplicates(list, store.files);
              setDups(split.dups);
              const added = split.fresh.length ? await store.add(docId, split.fresh) : [];
              setBusy(false);
              if (added.length) onAdded?.(added.length);
            }}
          />
          {mine.length > 0 && <span className="text-xs text-stone-500">{mine.length}枚 保存済み</span>}
        </div>
      )}
      <DupNote
        dups={dups}
        onClose={() => setDups([])}
        onForce={async () => {
          const list = dups.map((d) => d.file);
          setDups([]);
          const added = await store.add(docId, list);
          if (added.length) onAdded?.(added.length);
        }}
      />
      {store.err && <p className="text-sm text-rose-700">{store.err}</p>}
    </div>
  );
}
