"use client";

/**
 * 税務署に出す書類一式：撮影・アップロードした書類を提出の順に並べ、申告書と一緒に1つのPDFにする。
 * 印刷してそのまま出せる。印鑑証明書は原本を出すので、PDFには「ここに原本」の紙が入る。
 */
import { useState } from "react";
import { Button, Card, Note } from "@/components/ui";
import { DocFiles } from "@/components/docs/DocFiles";
import { civilHeirIds } from "@/domain/heirs";
import { DOCS } from "@/domain/procedures/documents";
import { jpDate } from "@/domain/procedures/dates";
import { docName, itemReady, submissionItems } from "@/domain/filing/submission";
import { buildBundle, filesFor } from "@/lib/bundle";
import { useDocFiles } from "@/lib/docFiles";
import { saveBlob } from "@/lib/download";
import { useOverall } from "@/lib/overall";

export function SubmissionBundle({ formsReady, getForms }: { formsReady: boolean; getForms: () => Promise<Blob> }) {
  const o = useOverall();
  const store = useDocFiles();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = o.case;
  const items = submissionItems({
    taxDocs: o.tasks.find((t) => t.id === "inheritance-tax")?.docs ?? [],
    smallLand: !!o.result?.assets.some((l) => l.reduction > 0),
    will: o.iv.will !== "none" && o.iv.will !== "unknown",
  });
  const count = (d: string) => store.of(d).length;
  const inkanCount = (() => {
    try {
      return civilHeirIds(c.persons).size;
    } catch {
      return c.persons.length;
    }
  })();
  const missing = items.filter((i) => !i.generated && !i.optional && !i.original && !itemReady(i, count, formsReady));
  const t = c.filing?.taxOffice?.trim();
  const office = t ? (t.endsWith("税務署") ? t : `${t}税務署`) : "亡くなった方の住所地の税務署";

  const make = async () => {
    setBusy(true);
    setErr(null);
    try {
      const forms = formsReady ? await getForms() : null;
      const blob = await buildBundle({ items, files: store.files, forms, decedent: c.decedent.name, deathDate: c.decedent.deathDate ? jpDate(c.decedent.deathDate) : "", office, inkanCount });
      saveBlob(blob, "相続税申告_提出書類一式.pdf");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="bundle" className="scroll-mt-24">
      <Card title="税務署に出す書類一式">
        <p className="mb-3 text-sm text-stone-600">撮った書類を提出の順に並べ、申告書と一緒に1つのPDFにします。印刷してそのまま出せます。</p>
        <ol className="space-y-2">
          {items.map((item, i) => {
            const ok = item.original ? o.done.includes("doc:inkan") : itemReady(item, count, formsReady);
            const n = filesFor(item, store.files).length;
            const state = item.generated ? (formsReady ? "入ります" : "まだ作れません") : item.original ? "原本を同封" : n > 0 ? `${n}枚` : item.optional ? "あれば" : "まだ";
            const canAdd = !item.generated && !item.original;
            return (
              <li key={item.id} className={`rounded-lg border ${item.original ? "border-amber-300 bg-amber-50" : ok ? "border-stone-200 bg-stone-50" : "border-stone-200 bg-white"}`}>
                <button type="button" disabled={!canAdd} onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id} className="flex w-full items-start gap-3 p-3 text-left">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${ok ? "bg-stone-300 text-stone-700" : "bg-brand text-white"}`}>{ok ? "✓" : i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-stone-900">{item.label}</span>
                    {item.note && <span className={`block text-xs ${item.original ? "font-bold text-amber-800" : "text-stone-500"}`}>{item.note}</span>}
                  </span>
                  <span className={`shrink-0 text-xs font-bold ${ok || item.optional ? "text-stone-500" : "text-orange-700"}`}>
                    {state}
                    {canAdd && <span className="ml-1 text-teal-800">{open === item.id ? "▴" : "▾"}</span>}
                  </span>
                </button>
                {open === item.id && canAdd && (
                  <div className="space-y-3 border-t border-stone-100 px-3 py-3 sm:pl-12">
                    {item.docIds.map((d) => (
                      <div key={d}>
                        <p className="mb-1 text-sm font-semibold text-stone-700">{docName(d)}</p>
                        <DocFiles docId={d} onAdded={() => DOCS[d] && !DOCS[d].readable && o.setStatus(`doc:${d}`, "done")} />
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {!formsReady && <p className="mt-3 text-sm text-stone-600">申告書は、上で同意してPDFを作れるようになると入ります。</p>}
        {missing.length > 0 && <p className="mt-2 text-sm text-orange-800">まだ：{missing.map((m) => m.label).join("、")}</p>}
        <div className="mt-3">
          <Button onClick={() => void make()} disabled={busy}>
            {busy ? "まとめています…" : "提出書類一式をダウンロード"}
          </Button>
        </div>
        {err && (
          <div className="mt-3">
            <Note tone="stop">{err}</Note>
          </div>
        )}
        <p className="mt-3 text-xs text-stone-500">{store.cloud ? "撮った書類は、ご本人だけが見られるよう保存しています。" : "デモでは、撮った書類はこの端末の中にだけ保存します。"}</p>
      </Card>
    </div>
  );
}
