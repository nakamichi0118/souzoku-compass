"use client";

/**
 * 財産・債務を登録した元の資料。押すと別のタブで開き、登録された金額・所在と見比べられる。
 */
import { ExternalLink, FileText } from "lucide-react";
import { SAMPLE } from "@/components/extract/Reader";
import { useDocFiles } from "@/lib/docFiles";
import { resolveSources } from "@/lib/sourceDocs";

const linkCls = "flex min-w-0 items-center gap-2 rounded-lg border border-stone-300 bg-white py-1.5 pl-1.5 pr-3 text-sm text-sky-900 hover:bg-sky-50";

function Thumb({ src, type, name }: { src: string; type: string; name: string }) {
  return (
    <span className="grid h-12 w-9 shrink-0 place-items-center overflow-hidden rounded border border-stone-200 bg-stone-50 text-stone-500">
      {type.startsWith("image/") && src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" title={name} />
      ) : (
        <FileText className="h-4 w-4" aria-hidden />
      )}
    </span>
  );
}

export function SourceDocs({ ids, docFrom }: { ids?: string[]; docFrom?: string }) {
  // 書類から登録していない財産では、書類の一覧を読みにいかない
  if (!ids?.length && (!docFrom || docFrom === "手元にあり")) return null;
  return <Shown ids={ids} docFrom={docFrom} />;
}

function Shown({ ids, docFrom }: { ids?: string[]; docFrom?: string }) {
  const { files } = useDocFiles();
  const shown = resolveSources(ids, docFrom, files);
  if (!shown.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-stone-600">元の資料（押すと開きます）</p>
      <ul className="flex flex-wrap gap-2">
        {shown.map((s, i) => (
          <li key={i} className="min-w-0 max-w-full">
            {s.kind === "file" ? (
              <a href={s.file.src || undefined} target="_blank" rel="noreferrer" className={linkCls}>
                <Thumb src={s.file.src} type={s.file.type} name={s.file.name} />
                <span className="min-w-0 truncate">{s.file.name}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            ) : s.kind === "sample" && SAMPLE[s.docId] ? (
              <a href={SAMPLE[s.docId].url} target="_blank" rel="noreferrer" className={linkCls}>
                <Thumb src="" type="application/pdf" name={SAMPLE[s.docId].name} />
                <span className="min-w-0 truncate">{SAMPLE[s.docId].name}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            ) : s.kind === "gone" ? (
              <span className="flex min-w-0 items-center gap-2 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-500">
                <span className="min-w-0 truncate">{s.name}</span>
                <span className="shrink-0 text-xs">（保存されていません）</span>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
