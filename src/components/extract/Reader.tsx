"use client";

import { Camera, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DocCamera } from "@/components/docs/DocCamera";
import { guessDocId } from "@/domain/filing/submission";
import { useDocFiles } from "@/lib/docFiles";
import { fmt } from "@/components/ui";
import { TARGET_LABEL, applyExtracted, destination, findSame, missingItems, refExists, useExtract, type Extracted, type ExtractedAsset, type Ref } from "@/lib/extract";
import type { Case } from "@/domain/types";
import { useCase } from "@/lib/store";
import { type Progress, ProgressBar } from "@/components/compass/ProgressBar";

/** 書類の読み取りにかかる目安（コンパスくんが画像を読む。ふつう十数秒） */
const READ_WAIT: Progress = { at: 0, until: 1, expectSec: 20 };

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

/**
 * アップロードした書類をコンパスくんが読み取り、確認してから財産・債務・贈与に登録する。
 * 読んだ書類は、税務署に出す書類一式に使えるよう、この端末に書類の種類ごとに保存する（save=false なら保存しない）。
 * file を渡すと、その書類をすぐ読む（撮影して仕分けた書類など）
 */
export function Reader({ docId, onRegistered, file, save = true }: { docId?: string; onRegistered?: () => void; file?: File; save?: boolean }) {
  const { data: c, update } = useCase();
  const ex = useExtract(() => ({ decedentName: c.decedent.name, deathDate: c.decedent.deathDate }));
  // 書類ごとに、登録した項目を候補の番号で覚える（別の書類を読んだら消える）
  const [done, setDone] = useState<Record<number, Ref>>({});
  const [readId, setReadId] = useState(0);
  useEffect(() => setDone({}), [readId]);
  const sample = docId ? SAMPLE[docId] : undefined;
  // 読み取りには時間がかかるので、登録は読み終わった時点の入力に足す
  const latest = useRef(c);
  latest.current = c;
  const [undo, setUndo] = useState<{ before: Case; after: Case } | null>(null);
  const [updated, setUpdated] = useState<Record<number, string>>({});
  /** 読み取った候補を、確認の操作なしで財産・債務・贈与に登録する（同じものが登録済みなら、読み取った内容で更新） */
  const autoRegister = (res: Extracted | null, fileName: string) => {
    if (!res || res.assets.length === 0) return;
    const before = latest.current;
    let cur = before;
    const refs: Record<number, Ref> = {};
    const upd: Record<number, string> = {};
    res.assets.forEach((x, i) => {
      const same = findSame(x, cur);
      if (same && "id" in same) upd[i] = (same.type === "asset" ? cur.assets.find((a) => a.id === same.id)?.label : cur.debts.find((d) => d.id === same.id)?.label) ?? "";
      const r = applyExtracted(cur, x, same);
      const ref = r.ref;
      // どの財産の書類を読んだかを財産ごとに残す（同じ種類の書類でも、口座・土地ごとに「書類あり」を分ける）
      cur = ref.type === "asset" ? { ...r.next, assets: r.next.assets.map((a) => (a.id === ref.id ? { ...a, docFrom: fileName.slice(0, 200) } : a)) } : r.next;
      refs[i] = ref;
    });
    const after = cur;
    update(() => after);
    setDone(refs);
    setUpdated(upd);
    setUndo({ before, after });
    onRegistered?.();
  };
  const store = useDocFiles();
  const [cam, setCam] = useState(false);
  const read = (f: File) => {
    setReadId((n) => n + 1);
    void ex.read(f).then((res) => {
      autoRegister(res, f.name);
      if (!save) return;
      const id = docId ?? (res ? guessDocId(res.documentType) : null) ?? "otherDoc";
      void store.add(id, [f]);
    });
  };
  // 渡された書類は1度だけ読む
  const given = useRef<File | null>(null);
  useEffect(() => {
    if (file && given.current !== file) {
      given.current = file;
      read(file);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  return (
    <div className="rounded-xl border-2 border-dashed border-teal-400 bg-teal-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
          <Upload className="h-4 w-4" aria-hidden />
          写真・PDFをアップロード
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
        <button type="button" onClick={() => setCam(true)} disabled={ex.busy} className="inline-flex items-center gap-2 rounded-lg border border-teal-600 bg-white px-3 py-2 text-sm text-teal-800 hover:bg-teal-50">
          <Camera className="h-4 w-4" aria-hidden />
          撮影する
        </button>
        {cam && (
          <DocCamera
            multi={false}
            onClose={() => setCam(false)}
            onDone={(fs) => {
              setCam(false);
              if (fs[0]) read(fs[0]);
            }}
          />
        )}
        {sample && (
          <button
            type="button"
            disabled={ex.busy}
            onClick={() => {
              setReadId((n) => n + 1);
              void ex.readSample(sample.url, sample.name).then((res) => autoRegister(res, sample.name));
            }}
            className="rounded-lg border border-teal-600 bg-white px-3 py-2 text-sm text-teal-800 hover:bg-teal-50"
          >
            見本の書類で試す
          </button>
        )}
        {sample && (
          <a href={sample.url} target="_blank" rel="noreferrer" className="inline-block py-2 text-xs text-teal-800 underline">
            見本を開く
          </a>
        )}
      </div>
      {ex.busy && <ProgressBar kun message={"コンパスくんが読み取っています\n書類の文字を読み、金額・口座・日付を探しています"} progress={READ_WAIT} className="mt-3 text-sm text-teal-900" />}
      <p className="mt-2 text-xs text-stone-500">読み取った内容は自動で登録します。書類と見比べて、違っていたら直してください。</p>
      {ex.err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{ex.err}</p>}
      {ex.res && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold text-stone-700">
            読み取った書類：{ex.res.documentType}
            {ex.file ? `（${ex.file}）` : ""}
          </p>
          {ex.res.assets.length === 0 && <p className="text-sm text-stone-600">財産・債務の情報は見つかりませんでした。</p>}
          {ex.res.assets.map((x, i) => {
            const mine = done[i] && refExists(c, done[i]) ? done[i] : undefined;
            const missing = missingItems(x, c.persons);
            const dest = destination(x.kind);
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
                  <summary className="cursor-pointer py-2">読み取った箇所</summary>
                  <p className="mt-1">「{x.evidence}」</p>
                </details>
                {missing.length > 0 && <p className="mt-1 text-xs text-orange-700">書類からは分からないため、登録後に入れてください：{missing.join("、")}。入れるまで「確認待ち」として扱い、税額は確定しません。</p>}
                <p className="mt-2 font-semibold text-emerald-700">
                  {mine ? `✓ ${dest}に${updated[i] ? `登録済みの「${updated[i]}」を更新しました` : "登録しました"}` : Object.keys(done).length ? "登録を取り消しました" : "登録しています…"}
                </p>
              </div>
            );
          })}
          {ex.res.notes.map((n) => (
            <p key={n} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {n}
            </p>
          ))}
          {Object.keys(done).length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {undo && c === undo.after && (
                <button
                  type="button"
                  onClick={() => {
                    update(() => undo.before);
                    setUndo(null);
                  }}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-50"
                >
                  登録を取り消す
                </button>
              )}
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
