"use client";

import { useEffect, useRef } from "react";
import { DOCS } from "@/domain/procedures/documents";
import type { Task } from "@/domain/procedures/rules";
import { OfficeLookup } from "./OfficeLookup";

/** 亡くなった方の住所で請求先が決まる書類（戸籍は本籍地、登記事項証明書はどこでも取れるので除く） */
const LOOKUP = new Set(["juminhyoJokyo", "hyokaCert", "nayose", "houteiJoho"]);

/** 手続きリストに出てくる書類をまとめた「書類集めリスト」 */
export function collectDocs(tasks: Task[]) {
  const m = new Map<string, Task[]>();
  for (const t of tasks) for (const id of t.docs) if (DOCS[id]) m.set(id, [...(m.get(id) ?? []), t]);
  return [...m.entries()].map(([id, used]) => ({ doc: DOCS[id], used }));
}

export function DocsPanel({ tasks, done, toggle, address, focus }: { tasks: Task[]; done: string[]; toggle: (id: string) => void; address: string; focus?: string | null }) {
  const items = collectDocs(tasks);
  const refs = useRef<Record<string, HTMLLIElement | null>>({});
  useEffect(() => {
    if (focus) refs.current[focus]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);
  const got = items.filter((i) => done.includes(`doc:${i.doc.id}`)).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">
        あなたの手続きで必要になる書類は <strong>{items.length}種類</strong>（そろったもの {got}種類）。同じ書類を複数の手続きで使うので、まとめて請求すると手間が減ります。
      </p>
      <ul className="space-y-2">
        {items.map(({ doc, used }) => {
          const key = `doc:${doc.id}`;
          const ok = done.includes(key);
          return (
            <li
              key={doc.id}
              ref={(el) => {
                refs.current[doc.id] = el;
              }}
              className={`rounded-xl border bg-white p-4 ${focus === doc.id ? "border-sky-500 ring-2 ring-sky-200" : "border-stone-200"}`}
            >
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={ok} onChange={() => toggle(key)} className="mt-1 h-5 w-5 shrink-0 accent-sky-700" aria-label={`${doc.name}がそろった`} />
                <div className="min-w-0 flex-1 space-y-2 text-sm leading-relaxed text-stone-700">
                  <p className={`text-base font-bold ${ok ? "text-stone-400 line-through" : "text-stone-900"}`}>📄 {doc.name}</p>
                  <p>{doc.purpose}</p>
                  <p className="text-xs text-stone-500">使う手続き：{used.map((t) => t.title).join("／")}</p>
                  {!ok && (
                    <>
                      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_1fr]">
                        <dt className="font-semibold text-stone-500">請求先</dt>
                        <dd>{doc.where}</dd>
                        <dt className="font-semibold text-stone-500">請求の方法</dt>
                        <dd>{doc.how.join("／")}</dd>
                        {doc.need.length > 0 && (
                          <>
                            <dt className="font-semibold text-stone-500">必要なもの</dt>
                            <dd>{doc.need.join("、")}</dd>
                          </>
                        )}
                        <dt className="font-semibold text-stone-500">手数料</dt>
                        <dd>{doc.fee}</dd>
                      </dl>
                      {doc.tip && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">💡 {doc.tip}</p>}
                      {doc.office && address && LOOKUP.has(doc.id) && (
                        <OfficeLookup kind={doc.office} address={address} forProperty={doc.id === "hyokaCert" || doc.id === "nayose"} dept={doc.office === "city" ? `${doc.name}の請求窓口` : undefined} />
                      )}
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-stone-500">手数料・請求方法は一般的な目安です。自治体や金融機関によって異なります。</p>
    </div>
  );
}
