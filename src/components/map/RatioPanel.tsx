"use client";

/**
 * 倍率地域の宅地の評価：国税庁の評価倍率表から、土地の町（丁目）・大字の行をコンパスくんが探し、
 * 表のページと一緒に見せて本人に確かめてもらう。評価額 ＝ 固定資産税評価額 × 倍率（決まった計算）。
 */
import { useEffect, useRef, useState } from "react";
import { ConsultLink } from "@/components/compass/ConsultLink";
import { type Progress, ProgressBar } from "@/components/compass/ProgressBar";
import { Button, Field, Note, NumInput, YenInput, fmt } from "@/components/ui";
import type { LandAsset } from "@/domain/types";
import { type Valuation, valueLand } from "@/domain/valuation";
import type { Sheet } from "./MapView";
import { fetchSheetPdf } from "./locate";
import type { RowBox } from "./ratioRow";
import { findRatioRow, renderPdfPage } from "./sheet";

export interface RatioRow {
  page: number;
  town: string;
  area: string;
  leaseRatio: string | null;
  residential: string;
  paddy: string | null;
  field: string | null;
  forest: string | null;
}
interface RatioResult {
  pref: string | null;
  city: string | null;
  town: string | null;
  pdfUrl: string | null;
  rows: RatioRow[];
  notes: string[];
  error?: string;
}
type MultiplierMethod = Extract<LandAsset["method"], { type: "multiplier" }>;
type RatioSource = NonNullable<MultiplierMethod["source"]>;

/** 評価倍率表を探している間の案内と、待ち時間の目安（表のPDFを丸ごと読むので、数十秒かかることがある） */
export const RATIO_WAIT = "評価倍率表から、この土地の地域の行を探しています";
const RATIO_PROGRESS: Progress = { at: 0, until: 1, expectSec: 30 };

/** 宅地の欄の「1.1」「1.10」などを倍率の数に。「路線」「比準」などは null */
export const ratioNumber = (s: string | null | undefined): number | null => {
  const t = (s ?? "").normalize("NFKC").trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** 借地権割合の欄の「60」「60%」「６０％」を割合（0.6）に。整数の%で 1〜99 でなければ undefined */
export const tableLeaseRatio = (s: string | null | undefined): number | undefined => {
  const t = (s ?? "").normalize("NFKC").replace(/\s/g, "").replace(/%$/, "");
  if (!/^\d{1,2}$/.test(t)) return undefined;
  const n = Number(t);
  return n > 0 ? n / 100 : undefined;
};

/**
 * 「3. 固定資産税評価額を入れて評価する」の評価と、反映できるか。
 * 評価倍率表の行を確かめて借地権割合が読めたときは、その借地権割合で評価する（反映するとその割合が土地に入るため）。
 * 反映は倍率・地積・固定資産税評価額がそろえばできる。広い宅地や事情がある土地などで税理士への相談が必要でも、
 * 倍率・地積・借地権割合は保存しておけるように止めない（相談の案内は画面に出す）
 */
export function ratioStep3(
  land: LandAsset,
  input: { fav: number; multiplier: number; area: number; confirmed?: RatioSource; confirmedLease?: { ratio?: number } },
): { method: MultiplierMethod; valuation: Valuation; canApply: boolean } {
  const { fav, multiplier, area, confirmed, confirmedLease } = input;
  const method: MultiplierMethod = { type: "multiplier", fixedAssetValue: fav, multiplier, source: confirmed };
  const leaseRatio = confirmed && confirmedLease?.ratio != null ? confirmedLease.ratio : land.leaseRatio;
  const valuation = valueLand({ ...land, areaSqm: area, method, leaseRatio });
  return { method, valuation, canApply: multiplier > 0 && area > 0 && fav > 0 };
}

export function RatioPanel({
  step,
  setStep,
  land,
  property,
  cache,
  ratioUrl,
  onApply,
  onUseRosenka,
  onReady,
  onWait,
}: {
  step: number;
  setStep: (s: number) => void;
  land: LandAsset;
  property: [number, number];
  cache: Map<string, ArrayBuffer>;
  /** この市区町村の評価倍率表の PDF（場所から調べたもの。行を探せなかったときの案内に使う） */
  ratioUrl?: string | null;
  /** lease：評価倍率表の行を確かめたときだけ、その行の借地権割合（読めなければ ratio は undefined） */
  onApply: (method: MultiplierMethod, areaSqm: number, lease?: { ratio?: number }) => void;
  onUseRosenka: () => void;
  /** 倍率が決まったか（確かめたか、自分で入れたか）を知らせる。決まるまで 3. には進めない */
  onReady?: (ready: boolean) => void;
  /** 評価倍率表を探している間の案内と進み具合を知らせる（地図の上にも出す）。終わったら null */
  onWait?: (w: { message: string; progress: Progress } | null) => void;
}) {
  const saved = land.method.type === "multiplier" ? land.method : undefined;
  const [res, setRes] = useState<RatioResult | null>(null);
  // 開いたらすぐ探し始めるので、最初から「探しています」にする
  const [busy, setBusy] = useState(true);
  /** 探し始めた時刻（バーの進み具合をここから数える） */
  const [since, setSince] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  /** 探せなかったときに、サーバーが教えてくれた評価倍率表の PDF */
  const [errorPdfUrl, setErrorPdfUrl] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [page, setPage] = useState<Sheet | null>(null);
  const [zoom, setZoom] = useState(0.35);
  const [manual, setManual] = useState(false);
  const [multiplier, setMultiplier] = useState<number>(saved?.multiplier ?? 0);
  const [fav, setFav] = useState<number>(saved?.fixedAssetValue ?? 0);
  const [area, setArea] = useState<number>(land.areaSqm);
  /** 本人が「はい」と確かめた行（あとで別の行を選んでも、確かめた行の倍率と出典を使う） */
  const [confirmed, setConfirmed] = useState<RatioSource | undefined>(saved?.source);
  /** 確かめた行の借地権割合（この画面で行を確かめたときだけ。開き直したときや自分で倍率を入れたときは土地の値を変えない） */
  const [confirmedLease, setConfirmedLease] = useState<{ ratio?: number } | undefined>(undefined);

  useEffect(() => {
    onReady?.(multiplier > 0);
  }, [multiplier]); // eslint-disable-line react-hooks/exhaustive-deps

  const progress: Progress = { ...RATIO_PROGRESS, since };
  // 探している間は、地図の上にも同じ案内を出す（終わったら・画面を離れたら消す）
  useEffect(() => {
    if (!busy) return void onWait?.(null);
    onWait?.({ message: RATIO_WAIT, progress });
    return () => onWait?.(null);
  }, [busy, since]); // eslint-disable-line react-hooks/exhaustive-deps

  // 評価倍率表をコンパスくんに探してもらう
  useEffect(() => {
    let off = false;
    setBusy(true);
    setSince(Date.now());
    setError(null);
    setErrorPdfUrl(null);
    setRes(null);
    (async () => {
      try {
        const r = await fetch("/api/rosenka/ratio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat: property[0], lng: property[1] }) });
        const j = (await r.json().catch(() => ({}))) as Partial<RatioResult>;
        if (off) return;
        if (!r.ok || !j.rows) {
          setErrorPdfUrl(j.pdfUrl ?? null);
          throw new Error(j.error ?? "評価倍率表を探せませんでした。");
        }
        setRes(j as RatioResult);
        const first = j.rows.findIndex((x) => ratioNumber(x.residential) !== null);
        setPick(first >= 0 ? first : 0);
      } catch (e) {
        if (!off) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!off) setBusy(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [property[0], property[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = res?.rows[pick];
  // 選んだ行が載っているページを表示する
  useEffect(() => {
    if (!res?.pdfUrl || !row) return;
    let off = false;
    (async () => {
      try {
        const buf = await fetchSheetPdf(res.pdfUrl!, cache);
        const s = await renderPdfPage(buf, row.page || 1, 2200);
        if (off) return URL.revokeObjectURL(s.src);
        setPage((old) => {
          if (old) URL.revokeObjectURL(old.src);
          return s;
        });
      } catch {
        /* ページが出せなくても、表の行の確認はできる */
      }
    })();
    return () => {
      off = true;
    };
  }, [res?.pdfUrl, row?.page, cache]); // eslint-disable-line react-hooks/exhaustive-deps

  // 選んだ行が、ページのどこに書かれているか（ページの文字から探す。見つからなければ枠は出さない）
  const [box, setBox] = useState<{ key: string; box: RowBox | null } | null>(null);
  const boxKey = row ? `${res?.pdfUrl}|${row.page}|${row.town}|${row.area}|${row.residential}` : "";
  useEffect(() => {
    if (!res?.pdfUrl || !row) return;
    let off = false;
    (async () => {
      try {
        const buf = await fetchSheetPdf(res.pdfUrl!, cache);
        const b = await findRatioRow(buf, row.page || 1, row);
        if (!off) setBox({ key: boxKey, box: b });
      } catch {
        if (!off) setBox({ key: boxKey, box: null });
      }
    })();
    return () => {
      off = true;
    };
  }, [boxKey, cache]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownBox = box?.key === boxKey ? box.box : null;
  // 枠が見えるよう、プレビューの中を枠の位置まで送る（倍率を変えたときも）
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !page || !shownBox) return;
    const h = page.height * zoom;
    const w = page.width * zoom;
    el.scrollTop = Math.max(0, ((shownBox.top + shownBox.bottom) / 2) * h - el.clientHeight / 2);
    el.scrollLeft = Math.max(0, shownBox.left * w - 12);
  }, [shownBox, page, zoom]);

  const rowRate = ratioNumber(row?.residential);
  const isRoute = !!row && /路線/.test(row.residential);
  const where = `${res?.city ?? ""}${row?.town ?? res?.town ?? ""}${row?.area ? `（${row.area}）` : ""}`;
  const pdfUrl = res?.pdfUrl ?? errorPdfUrl ?? ratioUrl ?? null;

  if (step === 2)
    return (
      <div className="space-y-3">
        <h2 className="font-bold text-stone-800">2. 評価倍率表で倍率を確かめる</h2>
        {busy && <ProgressBar message={RATIO_WAIT} progress={progress} className="rounded-lg bg-sky-50 p-2 text-sm text-sky-900" />}
        {error && (
          <Note tone="warn">
            {error} 評価倍率表を見て、倍率を自分で入れることもできます。
          </Note>
        )}
        {res && res.rows.length === 0 && <Note tone="warn">評価倍率表に「{res.town ?? "この地域"}」の行が見つかりませんでした。表を見て倍率を入れてください。</Note>}
        {res && res.rows.length > 0 && (
          <div className="space-y-2">
            <div className="overflow-x-auto rounded-lg border border-stone-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-50 text-stone-600">
                  <tr>
                    <th className="px-2 py-1" />
                    <th className="px-2 py-1">町（丁目）・大字</th>
                    <th className="px-2 py-1">適用地域</th>
                    <th className="px-2 py-1">宅地</th>
                    <th className="px-2 py-1">借地権割合</th>
                  </tr>
                </thead>
                <tbody>
                  {res.rows.map((r, i) => (
                    <tr key={`${r.page}-${r.town}-${r.area}-${i}`} className={`cursor-pointer border-t border-stone-100 ${i === pick ? "bg-teal-50" : "hover:bg-stone-50"}`} onClick={() => setPick(i)}>
                      <td className="px-2 py-1">
                        <input type="radio" checked={i === pick} onChange={() => setPick(i)} aria-label={`${r.town} ${r.area}`} className="accent-teal-700" />
                      </td>
                      <td className="px-2 py-1">{r.town}</td>
                      <td className="px-2 py-1">{r.area || "—"}</td>
                      <td className="px-2 py-1 font-semibold">{r.residential}</td>
                      <td className="px-2 py-1">{r.leaseRatio ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isRoute ? (
              <Note tone="info">
                この地域の宅地は「路線」（路線価地域）です。路線価図で評価します。
                <span className="mt-2 block">
                  <Button onClick={onUseRosenka}>路線価図で評価する</Button>
                </span>
              </Note>
            ) : rowRate !== null ? (
              <div className="space-y-2 rounded-lg bg-teal-50 p-3 text-sm text-teal-950">
                <p>
                  <span className="font-bold">{where}</span> の宅地は、<span className="font-bold">固定資産税評価額 × {rowRate}倍</span> で評価します。間違いないですか？
                </p>
                <p className="text-xs text-teal-900">下の表と見比べ、適用地域（「全域」「○○線より北」など）が土地の場所に合うか確かめてください。</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      if (!row) return;
                      setMultiplier(rowRate);
                      setConfirmed({ city: res.city ?? "", town: row.town, area: row.area || undefined, pdfUrl: res.pdfUrl ?? undefined, page: row.page });
                      setConfirmedLease({ ratio: tableLeaseRatio(row.leaseRatio) });
                      setManual(false);
                      setStep(3);
                    }}
                  >
                    はい、この倍率で評価する
                  </Button>
                  <Button variant="ghost" onClick={() => setManual(true)}>
                    違う（自分で入れる）
                  </Button>
                </div>
              </div>
            ) : (
              <Note tone="warn">選んだ行の宅地の欄が「{row?.residential}」のため、倍率を自動で使えません。表を見て倍率を入れるか、税理士にご相談ください。</Note>
            )}
            {res.notes.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-stone-600">
                {res.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {(manual || error || (res && (res.rows.length === 0 || (rowRate === null && !isRoute)))) && (
          <div className="space-y-2 rounded-lg border border-stone-200 p-3">
            <Field label="倍率（評価倍率表の宅地の欄）" hint="例：1.1">
              <NumInput
                value={multiplier}
                step="0.1"
                onChange={(v) => {
                  setMultiplier(v);
                  setConfirmed(undefined);
                  setConfirmedLease(undefined);
                }}
              />
            </Field>
            <Button
              onClick={() => {
                setConfirmed(undefined);
                setConfirmedLease(undefined);
                setStep(3);
              }}
              disabled={!(multiplier > 0)}
            >
              この倍率で次へ
            </Button>
          </div>
        )}
        {page && (
          <div className="space-y-1">
            <label className="flex flex-wrap items-center gap-2 text-sm text-stone-700">
              評価倍率表 {row?.page ? `（${row.page}ページ）` : ""} 拡大
              <input type="range" min={0.15} max={1} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="accent-teal-700" />
              {shownBox && <span className="text-xs text-orange-800">オレンジの枠：選んだ行</span>}
            </label>
            <div ref={previewRef} className="h-[340px] overflow-auto rounded-lg border border-stone-300 bg-stone-100">
              <div className="relative" style={{ width: page.width * zoom, height: page.height * zoom }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={page.src} alt="評価倍率表" width={page.width * zoom} height={page.height * zoom} className="max-w-none" />
                {shownBox && (
                  <span
                    aria-hidden
                    data-ratio-row
                    className="pointer-events-none absolute rounded-sm bg-amber-300/30 ring-2 ring-orange-500"
                    style={{ left: `${shownBox.left * 100}%`, top: `${shownBox.top * 100}%`, width: `${(shownBox.right - shownBox.left) * 100}%`, height: `${(shownBox.bottom - shownBox.top) * 100}%` }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
        {pdfUrl && (
          <a href={pdfUrl} target="_blank" rel="noreferrer" className="block text-xs text-teal-800 underline">
            国税庁の評価倍率表（PDF）を開く
          </a>
        )}
      </div>
    );

  // 3. 評価額
  const { method, valuation: v, canApply } = ratioStep3(land, { fav, multiplier, area, confirmed, confirmedLease });
  const confirmedWhere = confirmed ? `${confirmed.city}${confirmed.town}${confirmed.area ? `（${confirmed.area}）` : ""}` : "";
  const hasRate = multiplier > 0;
  const hasArea = area > 0;
  return (
    <div className="space-y-3">
      <h2 className="font-bold text-stone-800">3. 固定資産税評価額を入れて評価する</h2>
      {hasRate ? (
        <p className="text-sm text-stone-600">
          倍率 <span className="font-bold">{multiplier}倍</span>
          {confirmedWhere ? `（${confirmedWhere}・宅地）` : "（自分で入力）"}
        </p>
      ) : (
        <Note tone="warn">倍率がまだ入っていません。「2. 評価倍率表」に戻って、倍率を確かめてください。</Note>
      )}
      <Field label="固定資産税評価額" hint="固定資産税の課税明細書（または評価証明書）の「評価額」。課税標準額ではありません">
        <YenInput value={fav} onChange={setFav} />
      </Field>
      <Field label="地積" hint="登記簿・課税明細書の面積">
        <NumInput value={area} onChange={setArea} unit="㎡" />
      </Field>
      {!hasRate ? null : !(fav > 0) ? (
        <p className="text-sm text-stone-500">固定資産税評価額を入れると評価額を計算します。</p>
      ) : v.needsConsultation ? (
        // 広い宅地・事情がある土地・借地権割合が分からないなど。倍率と地積は反映しておける
        <Note tone="warn">{v.needsConsultation}</Note>
      ) : (
        <div className="rounded-lg bg-teal-50 p-3 text-sm text-teal-950">
          {v.steps.map((x, i) => (
            <p key={`${i}:${x}`} className="text-xs">
              {x}
            </p>
          ))}
          <p className="pt-1 text-base font-bold">評価額 {fmt(v.value)}円</p>
        </div>
      )}
      <Note tone="info">
        形がいびつ・がけ地などの減額はしていません（下げられるかは税理士へ）。
        <span className="mt-2 block">
          <ConsultLink topic="土地の評価" />
        </span>
      </Note>
      {!hasArea && <p className="text-xs text-amber-800">地積を入れてください（登記簿や課税明細書に書いてある面積）。</p>}
      <Button onClick={() => onApply(method, area, confirmed ? confirmedLease : undefined)} disabled={!canApply} className="w-full py-3">
        この評価を反映して財産の入力へ戻る
      </Button>
    </div>
  );
}
