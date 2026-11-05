"use client";

import { Camera, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DocCamera } from "@/components/docs/DocCamera";
import { DupNote, FileThumbs } from "@/components/docs/DocFiles";
import { guessDocId } from "@/domain/filing/submission";
import { splitDuplicates, useDocFiles, type Duplicate } from "@/lib/docFiles";
import { fmt } from "@/components/ui";
import {
  TARGET_LABEL,
  applyExtracted,
  destination,
  findSame,
  missingItems,
  refExists,
  useExtract,
  type Extracted,
  type ExtractedAsset,
  type Ref,
} from "@/lib/extract";
import type { Case } from "@/domain/types";
import { useCase } from "@/lib/store";
import { type Progress, ProgressBar } from "@/components/compass/ProgressBar";

/** 書類の読み取りにかかる目安（コンパスくんが画像を読む。ふつう十数秒） */
const READ_WAIT: Progress = { at: 0, until: 1, expectSec: 20 };

/** 見本の書類で試せる書類 */
const SAMPLE: Record<string, { url: string; name: string }> = {
  balanceCert: {
    url: "/demo/zandaka-sample.pdf",
    name: "残高証明書（見本）.pdf",
  },
};

/** 書類から読み取った値のうち、原本と見比べる主な項目 */
function fields(x: ExtractedAsset): [string, string][] {
  const yen = (n: number | null | undefined) =>
    n != null ? `${fmt(n)}円` : null;
  const rows: [string, string | null][] = [
    [
      "金融機関・会社",
      [x.institution, x.branch, x.accountType].filter(Boolean).join(" ") ||
        null,
    ],
    ["所在", x.location],
    [
      "地番・家屋番号",
      [x.lotNumber, x.houseNumber].filter(Boolean).join(" ") || null,
    ],
    ["面積", x.areaSqm ? `${x.areaSqm}㎡` : null],
    [
      x.kind === "debt"
        ? "債務の額"
        : x.kind === "funeral"
          ? "葬儀費用"
          : x.kind === "gift"
            ? "贈与の額"
            : "金額",
      yen(x.amount),
    ],
    ["既経過利息", yen(x.accruedInterest)],
    ["固定資産税評価額", yen(x.fixedAssetValue)],
    ["路線価", x.routePrice ? `${fmt(x.routePrice)}円/㎡` : null],
    ["株数", x.shares ? `${fmt(x.shares)}株` : null],
    [
      "4つの価格",
      x.prices
        ? [
            x.prices.close,
            x.prices.monthAvg,
            x.prices.prevMonthAvg,
            x.prices.prev2MonthAvg,
          ]
            .map((v) => (v ? fmt(v) : "—"))
            .join("・") + "円"
        : null,
    ],
    [
      "専有面積・敷地権",
      x.condo
        ? `${x.condo.exclusiveAreaSqm ?? "—"}㎡・${x.condo.landShareSqm ?? "—"}㎡`
        : null,
    ],
    [
      "築年数・階",
      x.condo
        ? `${x.condo.builtYears ?? "—"}年${x.condo.builtMonths ? `${x.condo.builtMonths}か月` : ""}・${x.condo.totalFloors ?? "—"}階建ての${x.condo.floor ?? "—"}階`
        : null,
    ],
    [
      x.kind === "insurance"
        ? "受取人"
        : x.kind === "gift"
          ? "受け取った人"
          : x.kind === "debt" || x.kind === "funeral"
            ? "負担した人"
            : "人",
      x.personName ?? null,
    ],
    ["納めた贈与税", x.kind === "gift" ? yen(x.giftTaxPaid) : null],
    ["日付", x.date],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

/**
 * 1件ごとに出る書類（口座・保険の契約・証券会社ごと）。1通読んだだけで「そろった」にせず、ほかにもあるかを聞く
 */
export const MORE_QUESTION: Record<string, string> = {
  balanceCert: "ほかの銀行・口座の残高証明書もありますか？",
  insurancePay: "ほかの保険の書類もありますか？",
  securitiesCert: "ほかの証券会社の書類もありますか？",
};

type Run = {
  key: number;
  file: string;
  res: Extracted | null;
  err: string | null;
  refs: Record<number, Ref>;
  updated: Record<number, string>;
};

/**
 * 書類のアップロード・撮影の箱（どの書類でも同じ見た目）。何枚でもまとめて選べて、撮影も続けて何枚でもできる。
 * read=true なら、コンパスくんが1枚ずつ読み取り、財産・債務・贈与に自動で登録する（読み終わった時点の入力に足す）。
 * read=false なら、税務署に出す書類一式に使えるよう保存するだけ（戸籍など）。
 * 保存した書類は箱の中に並べ、2回目からは「追加で〜」のボタンにして、前の書類に足されることが分かるようにする。
 * 書類は書類の種類ごとに保存する（save=false なら保存しない）。file を渡すと、その書類をすぐ読む（撮影して仕分けた書類など）
 */
export function Reader({
  docId,
  onRegistered,
  file,
  save = true,
  read: doRead = true,
  ask = true,
}: {
  docId?: string;
  onRegistered?: (all: boolean) => void;
  file?: File;
  save?: boolean;
  read?: boolean;
  ask?: boolean;
}) {
  const { data: c, update } = useCase();
  const ex = useExtract(() => ({
    decedentName: c.decedent.name,
    deathDate: c.decedent.deathDate,
  }));
  // 今回選んだ書類ごとの読み取り結果（次にまとめて選んだら入れ替わる。登録済みの財産はそのまま）
  const [runs, setRuns] = useState<Run[]>([]);
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(
    null,
  );
  const sample = doRead && docId ? SAMPLE[docId] : undefined;
  const latest = useRef(c);
  latest.current = c;
  // まとめて選んだ書類の登録を、まとめて取り消せるようにする
  const [undo, setUndo] = useState<{ before: Case; after: Case } | null>(null);
  const runKey = useRef(0);
  // 口座ごとの書類：読んだあとに「ほかにもある？」を聞く（more = 続けて読む案内を出している）
  const more = doRead && docId ? MORE_QUESTION[docId] : undefined;
  const [asking, setAsking] = useState<"ask" | "more" | null>(null);
  /** 読み取った候補を、確認の操作なしで財産・債務・贈与に登録する（同じものが登録済みなら、読み取った内容で更新） */
  const autoRegister = (res: Extracted, fileName: string) => {
    let cur = latest.current;
    const refs: Record<number, Ref> = {};
    const updated: Record<number, string> = {};
    res.assets.forEach((x, i) => {
      const same = findSame(x, cur);
      if (same && "id" in same)
        updated[i] =
          (same.type === "asset"
            ? cur.assets.find((a) => a.id === same.id)?.label
            : cur.debts.find((d) => d.id === same.id)?.label) ?? "";
      const r = applyExtracted(cur, x, same);
      const ref = r.ref;
      // どの財産の書類を読んだかを財産ごとに残す（同じ種類の書類でも、口座・土地ごとに「書類あり」を分ける）
      cur =
        ref.type === "asset"
          ? {
              ...r.next,
              assets: r.next.assets.map((a) =>
                a.id === ref.id ? { ...a, docFrom: fileName.slice(0, 200) } : a,
              ),
            }
          : r.next;
      refs[i] = ref;
    });
    const after = cur;
    latest.current = after;
    update(() => after);
    return { refs, updated, after };
  };
  const store = useDocFiles();
  const mine = docId && save ? store.of(docId) : [];
  const [cam, setCam] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = ex.busy || saving || progress !== null;
  /** 選んだ・撮影した書類を、1枚ずつ順に読む */
  const [dups, setDups] = useState<Duplicate[]>([]);
  const readAll = async (
    picked: File[],
    sampleName?: string,
    force = false,
  ) => {
    if (!picked.length) return;
    let files = picked;
    // 保存済みと同じ書類は、読み取りも保存もしないで知らせる（「別の書類なので追加する」で入れられる）
    if (save && !sampleName && !force) {
      setSaving(true);
      const split = await splitDuplicates(picked, store.files);
      setSaving(false);
      setDups(split.dups);
      files = split.fresh;
      if (!files.length) return;
    } else setDups([]);
    if (!doRead) {
      if (!docId || !save) return;
      setSaving(true);
      const added = await store.add(docId, files);
      setSaving(false);
      if (added.length) onRegistered?.(true);
      return;
    }
    const before = latest.current;
    setRuns([]);
    setUndo(null);
    setAsking(null);
    let registered = false;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setProgress({ at: i + 1, of: files.length });
      const { res, err } = await ex.read(f);
      const run: Run = {
        key: ++runKey.current,
        file: f.name,
        res,
        err,
        refs: {},
        updated: {},
      };
      if (res && res.assets.length) {
        const r = autoRegister(res, f.name);
        run.refs = r.refs;
        run.updated = r.updated;
        registered = true;
        setUndo({ before, after: r.after });
      }
      setRuns((rs) => [...rs, run]);
      if (save && !sampleName) {
        const id =
          docId ?? (res ? guessDocId(res.documentType) : null) ?? "otherDoc";
        await store.add(id, [f]);
      }
    }
    setProgress(null);
    if (!registered) return;
    if (!more) onRegistered?.(true);
    else if (ask) setAsking("ask");
  };
  // 渡された書類は1度だけ読む
  const given = useRef<File | null>(null);
  useEffect(() => {
    if (file && given.current !== file) {
      given.current = file;
      void readAll([file]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  const again = mine.length > 0;
  const anyDone = runs.some((r) => Object.keys(r.refs).length > 0);
  return (
    <div className="rounded-xl border-2 border-dashed border-teal-400 bg-teal-50/40 p-4">
      {mine.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs font-semibold text-stone-600">
            アップロード済み（{mine.length}枚）
          </p>
          <FileThumbs files={mine} onRemove={(f) => void store.remove(f.id)} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          {again ? (
            <Plus className="h-4 w-4" aria-hidden />
          ) : (
            <Upload className="h-4 w-4" aria-hidden />
          )}
          {again ? "追加でアップロード" : "写真・PDFをアップロード"}
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const list = [...(e.target.files ?? [])];
              e.target.value = "";
              void readAll(list);
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => setCam(true)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-teal-600 bg-white px-3 py-2 text-sm text-teal-800 hover:bg-teal-50 disabled:opacity-60"
        >
          <Camera className="h-4 w-4" aria-hidden />
          {again ? "追加で撮影" : "撮影する"}
        </button>
        {cam && (
          <DocCamera
            onClose={() => setCam(false)}
            onDone={(fs) => {
              setCam(false);
              void readAll(fs);
            }}
          />
        )}
        {sample && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void fetch(sample.url)
                .then((r) => r.blob())
                .then((b) =>
                  readAll(
                    [
                      new File([b], sample.name, {
                        type: b.type || "application/pdf",
                      }),
                    ],
                    sample.name,
                  ),
                );
            }}
            className="rounded-lg border border-teal-600 bg-white px-3 py-2 text-sm text-teal-800 hover:bg-teal-50"
          >
            見本の書類で試す
          </button>
        )}
        {sample && (
          <a
            href={sample.url}
            target="_blank"
            rel="noreferrer"
            className="inline-block py-2 text-xs text-teal-800 underline"
          >
            見本を開く
          </a>
        )}
      </div>
      {saving && <p className="mt-2 text-sm text-teal-900">保存しています…</p>}
      <DupNote
        dups={dups}
        onClose={() => setDups([])}
        onForce={() =>
          void readAll(
            dups.map((d) => d.file),
            undefined,
            true,
          )
        }
      />
      {store.err && <p className="mt-2 text-sm text-rose-700">{store.err}</p>}
      {doRead && progress && (
        <ProgressBar
          key={progress.at}
          kun
          message={`コンパスくんが読み取っています${progress.of > 1 ? `（${progress.at}/${progress.of}枚目）` : ""}\n書類の文字を読み、金額・口座・日付を探しています`}
          progress={READ_WAIT}
          className="mt-3 text-sm text-teal-900"
        />
      )}
      {doRead && (
        <p className="mt-2 text-xs text-stone-500">
          読み取った内容は自動で登録します。書類と見比べて、違っていたら直してください。
        </p>
      )}
      {runs.map((run) => (
        <RunResult key={run.key} run={run} c={c} many={runs.length > 1} />
      ))}
      {more && asking && anyDone && c === undo?.after && (
        <div className="mt-3 rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm">
          {asking === "ask" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 font-semibold text-stone-800">{more}</span>
              <button
                type="button"
                onClick={() => {
                  setAsking(null);
                  onRegistered?.(true);
                }}
                className="rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white hover:bg-teal-800"
              >
                これで全部
              </button>
              <button
                type="button"
                onClick={() => {
                  setAsking("more");
                  onRegistered?.(false);
                }}
                className="rounded-lg border border-teal-600 px-3 py-1.5 text-teal-800 hover:bg-teal-50"
              >
                ほかにもある
              </button>
            </div>
          ) : (
            <p className="text-stone-700">
              続けて、次の書類をアップロード・撮影してください。
            </p>
          )}
        </div>
      )}
      {anyDone && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {undo && c === undo.after && (
            <button
              type="button"
              onClick={() => {
                update(() => undo.before);
                latest.current = undo.before;
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
  );
}

/** 1枚の書類の読み取り結果 */
function RunResult({ run, c, many }: { run: Run; c: Case; many: boolean }) {
  if (run.err) {
    return (
      <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
        {many ? `${run.file}：` : ""}
        {run.err}
      </p>
    );
  }
  const res = run.res;
  if (!res) return null;
  const done = run.refs;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm font-semibold text-stone-700">
        読み取った書類：{res.documentType}（{run.file}）
      </p>
      {res.assets.length === 0 && (
        <p className="text-sm text-stone-600">
          財産・債務の情報は見つかりませんでした。
        </p>
      )}
      {res.assets.map((x, i) => {
        const mine = done[i] && refExists(c, done[i]) ? done[i] : undefined;
        const missing = missingItems(x, c.persons);
        const dest = destination(x.kind);
        return (
          <div
            key={i}
            className="rounded-lg border border-stone-200 bg-white p-3 text-sm"
          >
            <p className="flex flex-wrap items-center gap-2 font-bold text-stone-900">
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">
                {TARGET_LABEL[x.kind]}
              </span>
              {x.label}
            </p>
            <table className="mt-2 w-full text-left">
              <tbody>
                {fields(x).map(([k, v]) => (
                  <tr key={k} className="border-t border-stone-100">
                    <th className="w-32 py-1 pr-2 align-top text-xs font-medium text-stone-500">
                      {k}
                    </th>
                    <td className="py-1 font-semibold tabular-nums text-stone-900">
                      {v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details className="mt-1 text-xs text-stone-500">
              <summary className="cursor-pointer py-2">読み取った箇所</summary>
              <p className="mt-1">「{x.evidence}」</p>
            </details>
            {missing.length > 0 && (
              <p className="mt-1 text-xs text-orange-700">
                書類からは分からないため、登録後に入れてください：
                {missing.join("、")}
                。入れるまで「確認待ち」として扱い、税額は確定しません。
              </p>
            )}
            <p className="mt-2 font-semibold text-emerald-700">
              {mine
                ? `✓ ${dest}に${run.updated[i] ? `登録済みの「${run.updated[i]}」を更新しました` : "登録しました"}`
                : Object.keys(done).length
                  ? "登録を取り消しました"
                  : "登録しています…"}
            </p>
          </div>
        );
      })}
      {res.notes.map((n) => (
        <p
          key={n}
          className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {n}
        </p>
      ))}
    </div>
  );
}
