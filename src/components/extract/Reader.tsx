"use client";

import { Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fmt } from "@/components/ui";
import { TARGET_LABEL, applyExtracted, destination, findSame, missingItems, refExists, useExtract, type ExtractedAsset, type Ref } from "@/lib/extract";
import { useCase } from "@/lib/store";

/** 見本の書類で試せる書類 */
const SAMPLE: Record<string, { url: string; name: string }> = {
  balanceCert: { url: "/demo/zandaka-sample.pdf", name: "残高証明書（見本）.pdf" },
};

/** 書類から読み取った値のうち、原本と見比べる主な項目 */
function fields(x: ExtractedAsset): [string, string][] {
  const yen = (n: number | null | undefined) => (n != null ? `${fmt(n)}円` : null);
  const rows: [string, string | null][] = [
    ["金融機関・会社", [x.institution, x.branch, x.accountType].filter(Boolean).join(" ") || null],
    ["所在", x.location],
    ["地番・家屋番号", [x.lotNumber, x.houseNumber].filter(Boolean).join(" ") || null],
    ["面積", x.areaSqm ? `${x.areaSqm}㎡` : null],
    [x.kind === "debt" ? "債務の額" : x.kind === "funeral" ? "葬儀費用" : x.kind === "gift" ? "贈与の額" : "金額", yen(x.amount)],
    ["既経過利息", yen(x.accruedInterest)],
    ["固定資産税評価額", yen(x.fixedAssetValue)],
    ["路線価", x.routePrice ? `${fmt(x.routePrice)}円/㎡` : null],
    ["株数", x.shares ? `${fmt(x.shares)}株` : null],
    ["4つの価格", x.prices ? [x.prices.close, x.prices.monthAvg, x.prices.prevMonthAvg, x.prices.prev2MonthAvg].map((v) => (v ? fmt(v) : "—")).join("・") + "円" : null],
    ["専有面積・敷地権", x.condo ? `${x.condo.exclusiveAreaSqm ?? "—"}㎡・${x.condo.landShareSqm ?? "—"}㎡` : null],
    ["築年数・階", x.condo ? `${x.condo.builtYears ?? "—"}年${x.condo.builtMonths ? `${x.condo.builtMonths}か月` : ""}・${x.condo.totalFloors ?? "—"}階建ての${x.condo.floor ?? "—"}階` : null],
    [x.kind === "insurance" ? "受取人" : x.kind === "gift" ? "受け取った人" : x.kind === "debt" || x.kind === "funeral" ? "負担した人" : "人", x.personName ?? null],
    ["納めた贈与税", x.kind === "gift" ? yen(x.giftTaxPaid) : null],
    ["日付", x.date],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

/** アップロードした書類をコンパスくんが読み取り、確認してから財産・債務・贈与に登録する */
export function Reader({ docId, onRegistered }: { docId?: string; onRegistered?: () => void }) {
  const { data: c, update } = useCase();
  const ex = useExtract();
  // 書類ごとに、登録した項目を候補の番号で覚える（別の書類を読んだら消える）
  const [done, setDone] = useState<Record<number, Ref>>({});
  const [readId, setReadId] = useState(0);
  useEffect(() => setDone({}), [readId]);
  const sample = docId ? SAMPLE[docId] : undefined;
  const register = (x: ExtractedAsset, i: number, replace?: Ref) => {
    const r = applyExtracted(c, x, replace);
    update(() => r.next);
    setDone((d) => ({ ...d, [i]: r.ref }));
    onRegistered?.();
  };
  const read = (f: File) => {
    setReadId((n) => n + 1);
    void ex.read(f);
  };
  return (
    <div className="rounded-xl border-2 border-dashed border-teal-400 bg-teal-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
          <Upload className="h-4 w-4" aria-hidden />
          {ex.busy ? "コンパスくんが読み取り中…" : "写真・PDFをアップロード"}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            disabled={ex.busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) read(f);
            }}
          />
        </label>
        {sample && (
          <button
            type="button"
            disabled={ex.busy}
            onClick={() => {
              setReadId((n) => n + 1);
              void ex.readSample(sample.url, sample.name);
            }}
            className="rounded-lg border border-teal-600 bg-white px-3 py-2 text-sm text-teal-800 hover:bg-teal-50"
          >
            見本の書類で試す
          </button>
        )}
        {sample && (
          <a href={sample.url} target="_blank" rel="noreferrer" className="text-xs text-teal-800 underline">
            見本を開く
          </a>
        )}
      </div>
      <p className="mt-2 text-xs text-stone-500">金額や名前をコンパスくんが読み取ります。財産・債務・葬式費用・贈与のどこに入るかも振り分けます。登録する前に、必ず書類と見比べてください。</p>
      {ex.err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{ex.err}</p>}
      {ex.res && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold text-stone-700">
            読み取った書類：{ex.res.documentType}
            {ex.file ? `（${ex.file}）` : ""}
          </p>
          {ex.res.assets.length === 0 && <p className="text-sm text-stone-600">財産・債務の情報は見つかりませんでした。</p>}
          {ex.res.assets.map((x, i) => {
            const same = findSame(x, c);
            const mine = done[i] && refExists(c, done[i]) ? done[i] : undefined;
            const missing = missingItems(x, c.persons);
            const dest = destination(x.kind);
            const sameLabel = same && "id" in same ? (same.type === "asset" ? c.assets.find((a) => a.id === same.id)?.label : c.debts.find((d) => d.id === same.id)?.label) : "登録済みの贈与";
            return (
              <div key={`${readId}-${i}`} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-bold text-stone-900">
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">{TARGET_LABEL[x.kind]}</span>
                  {x.label}
                </p>
                <table className="mt-2 w-full text-left">
                  <tbody>
                    {fields(x).map(([k, v]) => (
                      <tr key={k} className="border-t border-stone-100">
                        <th className="w-32 py-1 pr-2 align-top text-xs font-medium text-stone-500">{k}</th>
                        <td className="py-1 font-semibold tabular-nums text-stone-900">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <details className="mt-1 text-xs text-stone-500">
                  <summary className="cursor-pointer">読み取った箇所</summary>
                  <p className="mt-1">「{x.evidence}」</p>
                </details>
                {missing.length > 0 && <p className="mt-1 text-xs text-orange-700">書類からは分からないため、登録後に入れてください：{missing.join("、")}。入れるまで「確認待ち」として扱い、税額は確定しません。</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {mine ? (
                    <span className="font-semibold text-emerald-700">✓ {dest}に登録しました</span>
                  ) : same ? (
                    <>
                      <span className="text-stone-700">登録済みの「{sameLabel}」と同じもののようです。</span>
                      <button type="button" onClick={() => register(x, i, same)} className="rounded-lg bg-sky-700 px-3 py-1.5 font-semibold text-white hover:bg-sky-800">
                        読み取った内容で更新
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDone((d) => ({ ...d, [i]: same }));
                          onRegistered?.();
                        }}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-50">
                        内容は同じ（資料がそろったことにする）
                      </button>
                      <button type="button" onClick={() => register(x, i)} className="px-2 py-1.5 text-xs text-stone-600 underline">
                        別のものとして追加
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => register(x, i)} className="rounded-lg bg-sky-700 px-3 py-1.5 font-semibold text-white hover:bg-sky-800">
                      確認して{dest}に登録
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {ex.res.notes.map((n) => (
            <p key={n} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {n}
            </p>
          ))}
          {Object.keys(done).length > 0 && (
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href="/case/assets" className="text-sky-800 underline">
                財産の一覧を見る ›
              </Link>
              <Link href="/case/debts" className="text-sky-800 underline">
                債務・葬式費用・贈与を見る ›
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
