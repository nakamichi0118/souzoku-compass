"use client";

/**
 * 倍率地域の宅地の評価：国税庁の評価倍率表から、土地の町（丁目）・大字の行をコンパスくんが探し、
 * 表のページと一緒に見せて本人に確かめてもらう。評価額 ＝ 固定資産税評価額 × 倍率（決まった計算）。
 */
import { useEffect, useState } from "react";
import { ConsultLink } from "@/components/compass/ConsultLink";
import { Button, Field, Note, NumInput, YenInput, fmt } from "@/components/ui";
import type { LandAsset } from "@/domain/types";
import { valueLand } from "@/domain/valuation";
import type { Sheet } from "./MapView";
import { fetchSheetPdf } from "./locate";
import { renderPdfPage } from "./sheet";

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

/** 宅地の欄の「1.1」「1.10」などを倍率の数に。「路線」「比準」などは null */
export const ratioNumber = (s: string | null | undefined): number | null => {
  const t = (s ?? "").normalize("NFKC").trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

export function RatioPanel({
  step,
  setStep,
  land,
  property,
  cache,
  onApply,
  onUseRosenka,
}: {
  step: number;
  setStep: (s: number) => void;
  land: LandAsset;
  property: [number, number];
  cache: Map<string, ArrayBuffer>;
  onApply: (method: MultiplierMethod, areaSqm: number) => void;
  onUseRosenka: () => void;
}) {
  const saved = land.method.type === "multiplier" ? land.method : undefined;
  const [res, setRes] = useState<RatioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [page, setPage] = useState<Sheet | null>(null);
  const [zoom, setZoom] = useState(0.35);
  const [manual, setManual] = useState(false);
  const [multiplier, setMultiplier] = useState<number>(saved?.multiplier ?? 0);
  const [fav, setFav] = useState<number>(saved?.fixedAssetValue ?? 0);
  const [area, setArea] = useState<number>(land.areaSqm);
  const [ok, setOk] = useState(!!saved?.source);

  // 評価倍率表をコンパスくんに探してもらう
  useEffect(() => {
    let off = false;
    setBusy(true);
    setError(null);
    (async () => {
      try {
        const r = await fetch("/api/rosenka/ratio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lat: property[0], lng: property[1] }) });
        const j = (await r.json()) as RatioResult;
        if (!r.ok) throw new Error(j.error ?? "評価倍率表を探せませんでした。");
        if (off) return;
        setRes(j);
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

  const rowRate = ratioNumber(row?.residential);
  const isRoute = !!row && /路線/.test(row.residential);
  const where = `${res?.city ?? ""}${row?.town ?? res?.town ?? ""}${row?.area ? `（${row.area}）` : ""}`;

  if (step === 2)
    return (
      <div className="space-y-3">
        <h2 className="font-bold text-stone-800">2. 評価倍率表で倍率を確かめる</h2>
        {busy && <p className="rounded-lg bg-sky-50 p-2 text-sm text-sky-900">コンパスくんが国税庁の評価倍率表から、この土地の地域の行を探しています…</p>}
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
                <p className="text-xs text-teal-900">下の評価倍率表のページと見比べてください。適用地域（「全域」「○○線より北」など）が土地の場所に合っているかも確かめてください。</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      setMultiplier(rowRate);
                      setOk(true);
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
              <NumInput value={multiplier} step="0.1" onChange={setMultiplier} />
            </Field>
            <Button
              onClick={() => {
                setOk(false);
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
            <label className="flex items-center gap-2 text-sm text-stone-700">
              評価倍率表 {row?.page ? `（${row.page}ページ）` : ""} 拡大
              <input type="range" min={0.15} max={1} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="accent-teal-700" />
            </label>
            <div className="h-[340px] overflow-auto rounded-lg border border-stone-300 bg-stone-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={page.src} alt="評価倍率表" width={page.width * zoom} height={page.height * zoom} className="max-w-none" />
            </div>
            {res?.pdfUrl && (
              <a href={res.pdfUrl} target="_blank" rel="noreferrer" className="text-xs text-teal-800 underline">
                国税庁の評価倍率表（PDF）を開く
              </a>
            )}
          </div>
        )}
      </div>
    );

  // 3. 評価額
  const method: MultiplierMethod = {
    type: "multiplier",
    fixedAssetValue: fav,
    multiplier,
    source: ok && row && res ? { city: res.city ?? "", town: row.town, area: row.area || undefined, pdfUrl: res.pdfUrl ?? undefined, page: row.page } : undefined,
  };
  const v = valueLand({ ...land, areaSqm: area, method });
  return (
    <div className="space-y-3">
      <h2 className="font-bold text-stone-800">3. 固定資産税評価額を入れて評価する</h2>
      <p className="text-sm text-stone-600">
        倍率 <span className="font-bold">{multiplier}倍</span>
        {ok && where ? `（${where}・宅地）` : "（自分で入力）"}
      </p>
      <Field label="固定資産税評価額" hint="固定資産税の課税明細書（または評価証明書）の「評価額」。課税標準額ではありません">
        <YenInput value={fav} onChange={setFav} />
      </Field>
      <Field label="地積" hint="登記簿・課税明細書の面積">
        <NumInput value={area} onChange={setArea} unit="㎡" />
      </Field>
      {v.needsConsultation ? (
        <p className="text-sm text-stone-500">固定資産税評価額を入れると評価額を計算します。</p>
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
        倍率地域でも、間口が狭い・形がいびつ・がけ地などで評価を下げられる場合があります（ここでは下げていません）。下げられるかは税理士に確認できます。
        <span className="mt-2 block">
          <ConsultLink topic="土地の評価" />
        </span>
      </Note>
      <Button onClick={() => onApply(method, area)} disabled={!!v.needsConsultation} className="w-full py-3">
        この評価を反映して財産の入力へ戻る
      </Button>
    </div>
  );
}
