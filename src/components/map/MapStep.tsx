"use client";

/**
 * 地図で土地の場所を選び、国税庁の路線価図を地図に重ねて路線価を確認する画面。
 * 画面は地図が中心で、操作はすべて地図の上に重ねたパネルで行う。
 *
 * - 住所検索または地図のクリックで土地の位置を決めると、その場所の路線価図を国税庁サイトから探して重ねる
 * - 位置合わせ（枠・基準点）と路線価図の手動選択は、上のメニューの「位置合わせ」に隠す
 * - 地図の右のパネルで、土地の周辺の路線価を Claude が読み取り（候補）、本人が確認して入力する
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { StepBar } from "@/components/StepBar";
import { AppHeader } from "@/components/shell/AppShell";
import { Button, Check, Field, Note, Select, TextInput, YenInput, fmt } from "@/components/ui";
import type { LandAsset } from "@/domain/types";
import { parseRouteNotation } from "@/domain/valuation/rosenka";
import { DEFAULT_PAPER, type Frame, frameCorners, framePairs } from "@/domain/geo/frame";
import { useCase } from "@/lib/store";
import type { GeoPair, MapApi, Sheet } from "./MapView";
import type { FindResult } from "@/server/rosenkaIndex";
import { cropAround, loadImage, renderPdfPage } from "./sheet";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="h-[520px] animate-pulse rounded-xl bg-stone-100" /> });

const TOKYO_STATION: [number, number] = [35.681236, 139.767125];
/** 枠の縮尺の初期値。読み込んだ路線価図の道路と地図の道路が重なるように利用者が調整する */
const DEFAULT_SCALE = 2500;
const SCALES = [1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000];
/** 微調整中の縮尺から、選択肢のうち最も近いものを返す */
const nearestScale = (sc: number) => SCALES.reduce((a, b) => (Math.abs(b - sc) < Math.abs(a - sc) ? b : a));

type Mode = "idle" | "property" | "sheetPoint" | "mapPoint" | "sheetProperty";

interface ReadResult {
  candidates: { notation: string; where: string; distanceToMarker: string }[];
  districtSymbol: string | null;
  notes: string[];
}

export function MapStep() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50/70 to-stone-50">
      <AppHeader />
      <StepBar current="assets" />
      <main className="mx-auto max-w-[1600px] space-y-3 px-4 pb-8 pt-4">
        <h1 className="text-xl font-bold text-stone-900">地図で土地を選び、路線価を確認する</h1>
        <Suspense fallback={<p className="text-stone-500">読み込み中…</p>}>
          <MapWorkspace />
        </Suspense>
      </main>
    </div>
  );
}

function MapWorkspace() {
  const params = useSearchParams();
  const { data, update, loaded } = useCase();
  const lands = data.assets.filter((a): a is LandAsset => a.kind === "land");
  const [assetId, setAssetId] = useState<string>(params.get("asset") ?? "");
  useEffect(() => {
    if (loaded && !lands.some((l) => l.id === assetId) && lands[0]) setAssetId(lands[0].id);
  }, [loaded, lands, assetId]);
  const land = lands.find((l) => l.id === assetId);

  const patchLand = (p: Partial<LandAsset>) =>
    update((c) => ({ ...c, assets: c.assets.map((a) => (a.id === assetId && a.kind === "land" ? { ...a, ...p } : a)) }));

  const api = useRef<MapApi | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [pages, setPages] = useState(1);
  const [pageNo, setPageNo] = useState(land?.rosenkaSheet?.page ?? 1);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [sheetUrl, setSheetUrl] = useState(land?.rosenkaSheet?.url ?? "");
  const [pairs, setPairs] = useState<GeoPair[]>(land?.rosenkaSheet?.points ?? []);
  const [frame, setFrame] = useState<Frame | null>(land?.rosenkaSheet?.frame ?? null);
  const [pendingImg, setPendingImg] = useState<[number, number] | null>(null);
  const [sheetProperty, setSheetProperty] = useState<[number, number] | null>(null);
  const [opacity, setOpacity] = useState(0.6);
  const [showOverlay, setShowOverlay] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ title: string; lat: number; lng: number }[]>([]);
  const [town, setTown] = useState<string | null>(null);
  const [reading, setReading] = useState<ReadResult | null>(null);
  const [found, setFound] = useState<FindResult | null>(null);
  const [finding, setFinding] = useState(false);
  const [notation, setNotation] = useState(land?.rosenkaSheet?.notation ?? "");
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(true);

  // 土地を切り替えたら保存済みの位置合わせを読み直す
  useEffect(() => {
    setPairs(land?.rosenkaSheet?.points ?? []);
    setFrame(land?.rosenkaSheet?.frame ?? (land?.geo ? { center: [land.geo.lat, land.geo.lng], scale: DEFAULT_SCALE, rotation: 0 } : null));
    setSheetUrl(land?.rosenkaSheet?.url ?? "");
    setNotation(land?.rosenkaSheet?.notation ?? "");
    setSheet(null);
    setReading(null);
    setSheetProperty(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  const property: [number, number] | undefined = land?.geo ? [land.geo.lat, land.geo.lng] : undefined;
  const paper = sheet?.paper ?? DEFAULT_PAPER;
  const corners = useMemo(() => (frame ? frameCorners(frame, paper) : null), [frame, paper]);
  // 重ね表示：基準点が2点以上あればそれを、なければ枠の四隅を使う
  const effectivePairs = useMemo(() => (pairs.length >= 2 ? pairs : frame ? framePairs(frame, paper) : []), [pairs, frame, paper]);
  const center = useMemo(() => property ?? TOKYO_STATION, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run<T>(label: string, f: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    try {
      return await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function search() {
    await run("住所を検索しています", async () => {
      const res = await fetch(`/api/geo/search?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setHits(json.results);
      if (json.results.length === 0) throw new Error("見つかりませんでした。町名までで検索してみてください。");
      if (json.results[0]) api.current?.flyTo([json.results[0].lat, json.results[0].lng], 17);
    });
  }

  /** クリックした場所の路線価図を国税庁サイトから探し、見つかれば読み込む */
  async function findAt(ll: [number, number]) {
    setFinding(true);
    try {
      const res = await fetch(`/api/rosenka/find?lat=${ll[0]}&lng=${ll[1]}`);
      const json = (await res.json()) as FindResult & { error?: string };
      if (!res.ok) throw new Error(json.error);
      setFound(json);
      if (json.town) setTown(json.town);
      const first = json.sheets[0];
      if (first && !json.sheets.some((x) => x.pdfUrl === sheetUrl)) await loadFromUrl(first.pdfUrl);
    } catch (e) {
      setFound(null);
      setError(`路線価図を自動で探せませんでした。下の手順で国税庁サイトから開いてください。${e instanceof Error && e.message ? `（${e.message}）` : ""}`);
    } finally {
      setFinding(false);
    }
  }

  async function setPropertyAt(ll: [number, number]) {
    patchLand({ geo: { lat: ll[0], lng: ll[1] } });
    if (!frame) setFrame({ center: ll, scale: DEFAULT_SCALE, rotation: 0 });
    setMode("idle");
    setTown(null);
    void findAt(ll);
    try {
      const res = await fetch(`/api/geo/reverse?lat=${ll[0]}&lon=${ll[1]}`);
      const json = await res.json();
      if (json.town) setTown(json.town);
    } catch {
      /* 町丁目名は参考表示のみ */
    }
  }

  async function showPdf(buf: ArrayBuffer, page: number) {
    const s = await renderPdfPage(buf, page);
    setPages(s.pages);
    setSheet((old) => {
      if (old) URL.revokeObjectURL(old.src);
      return s;
    });
  }

  async function loadFromUrl(url = sheetUrl) {
    await run("路線価図を読み込んでいます", async () => {
      if (url !== sheetUrl) {
        setSheetUrl(url);
        setPairs([]); // 基準点は図ごとのものなので、別の図に替えたら消す
        setPageNo(1);
      }
      const res = await fetch(`/api/rosenka/sheet?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "読み込めませんでした。");
      const buf = await res.arrayBuffer();
      if (res.headers.get("content-type")?.includes("pdf")) {
        setPdfData(buf);
        await showPdf(buf, url !== sheetUrl ? 1 : pageNo);
      } else {
        setPdfData(null);
        setSheet(await loadImage(new Blob([buf])));
      }
    });
  }

  async function loadFromFile(file: File) {
    await run("路線価図を読み込んでいます", async () => {
      setSheetUrl("");
      if (file.type === "application/pdf") {
        const buf = await file.arrayBuffer();
        setPdfData(buf);
        await showPdf(buf, 1);
        setPageNo(1);
      } else {
        setPdfData(null);
        setPages(1);
        setSheet(await loadImage(file));
      }
    });
  }

  function onSheetClick(pt: [number, number]) {
    if (mode === "sheetPoint") {
      setPendingImg(pt);
      setMode("mapPoint");
    } else if (mode === "sheetProperty") {
      setSheetProperty(pt);
      setMode("idle");
    }
  }

  function onMapClick(ll: [number, number]) {
    if (mode === "property" || (mode === "idle" && !property)) void setPropertyAt(ll);
    else if (mode === "idle") {
      setFrame((f) => ({ scale: DEFAULT_SCALE, rotation: 0, ...f, center: ll }));
      void findAt(ll);
    }
    else if (mode === "mapPoint" && pendingImg) {
      setPairs((p) => [...p, { img: pendingImg, latlng: ll }]);
      setPendingImg(null);
      setMode("idle");
    }
  }

  /** 路線価図上の土地の位置：位置合わせ済みなら地図の位置から計算、未済なら路線価図上でクリックした点 */
  const sheetPointOfProperty = (): [number, number] | null => {
    if (property && effectivePairs.length >= 2) return api.current?.toSheet(property) ?? null;
    return sheetProperty;
  };

  async function readWithClaude() {
    const at = sheetPointOfProperty();
    if (!sheet || !at) {
      setError("路線価図上の土地の位置が分かりません。位置合わせをするか、路線価図で土地の位置をクリックしてください。");
      return;
    }
    setSheetProperty(at);
    await run("コンパスくんが路線価図を読んでいます", async () => {
      const fd = new FormData();
      fd.append("image", await cropAround(sheet, at), "crop.png");
      const res = await fetch("/api/rosenka/read", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "読み取れませんでした。");
      setReading(json);
    });
  }

  const parsed = parseRouteNotation(notation);

  function applyToLand() {
    if (!land || !parsed) return;
    const m = land.method.type === "rosenka" ? land.method : { type: "rosenka" as const, depthCorrection: 1 };
    patchLand({
      method: { ...m, type: "rosenka", routePrice: parsed.routePrice },
      rosenkaSheet: { url: sheetUrl || undefined, page: pdfData ? pageNo : undefined, points: pairs, frame: frame ?? undefined, notation },
    });
  }

  if (!loaded) return <p className="text-stone-500">読み込み中…</p>;
  if (lands.length === 0)
    return (
      <Note tone="info">
        土地がまだ登録されていません。<Link href="/case/assets" className="underline">財産の入力</Link>で「土地」を追加してから開いてください。
      </Note>
    );

  const hint: Record<Mode, string | null> = {
    idle: null,
    property: "地図上で、評価する土地をクリックしてください。",
    sheetPoint: "路線価図で、地図でも見つけやすい場所（交差点の角、橋のたもと、駅など）をクリックしてください。",
    mapPoint: "地図上で、いま路線価図で選んだ場所と同じ地点をクリックしてください。",
    sheetProperty: "路線価図で、評価する土地の位置をクリックしてください。",
  };

  const sheetPicker = (
    <div className="space-y-3">
      {finding && <p className="text-sm text-teal-800">この場所の路線価図を国税庁サイトで探しています…</p>}
      {found && found.sheets.length === 0 && (
        <p className="text-sm text-stone-600">
          {found.message}
          {found.indexUrl && (
            <a href={found.indexUrl} target="_blank" rel="noreferrer" className="ml-1 text-teal-800 underline">
              町丁名索引を開く
            </a>
          )}
        </p>
      )}
      <div className="flex gap-2">
        <TextInput value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="路線価図PDFのURL" />
        <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => loadFromUrl()} disabled={!sheetUrl.trim() || !!busy}>
          読込
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-dashed border-stone-400 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">
          PDF・画像ファイル
          <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && loadFromFile(e.target.files[0])} />
        </label>
        <Button
          variant="ghost"
          onClick={() =>
            run("サンプルを読み込んでいます", async () => {
              setSheetUrl("");
              const buf = await (await fetch("/demo/rosenka-sample.pdf")).arrayBuffer();
              setPdfData(buf);
              setPageNo(1);
              await showPdf(buf, 1);
            })
          }
        >
          デモ用の架空の路線価図
        </Button>
        {pdfData && pages > 1 && (
          <label className="flex items-center gap-2 text-sm">
            ページ
            <select
              className="rounded border border-stone-300 px-2 py-1"
              value={pageNo}
              onChange={(e) => {
                const p = Number(e.target.value);
                setPageNo(p);
                void run("ページを表示しています", () => showPdf(pdfData, p));
              }}
            >
              {Array.from({ length: pages }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="text-xs text-stone-500">
        自動で見つからないときは、
        <a href="https://www.rosenka.nta.go.jp/" target="_blank" rel="noreferrer" className="text-teal-800 underline">
          国税庁「路線価図・評価倍率表」
        </a>
        で令和8年分 → 都道府県 → 路線価図 → 市区町村 → {town ? `「${town}」` : "町丁名"} の図を開き、PDFのURLを貼り付けてください。
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* 上のメニュー：土地・住所検索・路線価図・位置合わせ */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white p-2 shadow-sm">
        <div className="w-56">
          <Select value={assetId} onChange={setAssetId} options={lands.map((l) => ({ value: l.id, label: `${l.label || "（名称未入力）"}　${l.location}` }))} />
        </div>
        <div className="relative flex min-w-[16rem] flex-1 gap-2">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder={land?.location || "住所で探す（例：福岡市博多区博多駅前4丁目）"} />
          <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={search} disabled={!query.trim()}>
            検索
          </Button>
          {hits.length > 1 && (
            <ul className="absolute left-0 top-full z-[1100] mt-1 max-h-48 w-full overflow-auto rounded-lg border border-stone-200 bg-white text-sm shadow-lg">
              {hits.map((h) => (
                <li key={`${h.lat},${h.lng},${h.title}`}>
                  <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left hover:bg-teal-50"
                    onClick={() => {
                      api.current?.flyTo([h.lat, h.lng], 17);
                      setHits([]);
                    }}
                  >
                    {h.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button variant={mode === "property" ? "primary" : "secondary"} onClick={() => setMode(mode === "property" ? "idle" : "property")}>
          {property ? "土地の位置を選び直す" : "土地の位置を選ぶ"}
        </Button>
        {found && found.sheets.length > 0 && (
          <div className="flex items-center gap-1 text-sm">
            <span className="text-stone-500">路線価図</span>
            {found.sheets.map((x) => (
              <button
                key={x.no}
                type="button"
                onClick={() => loadFromUrl(x.pdfUrl)}
                className={`rounded-md border px-2 py-0.5 font-mono ${x.pdfUrl === sheetUrl ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white hover:border-teal-500"}`}
              >
                {x.no}
              </button>
            ))}
          </div>
        )}
        <Button variant={menu ? "primary" : "ghost"} onClick={() => setMenu((v) => !v)}>
          位置合わせ {menu ? "▲" : "▼"}
        </Button>
        <Link href="/case/assets" className="rounded-lg px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50">
          ← 財産の入力へ
        </Link>
      </div>

      <div className="relative">
        <MapView
          className="h-[calc(100vh-12rem)] min-h-[520px] w-full rounded-xl border border-stone-300"
          center={center}
          property={property}
          pairs={effectivePairs}
          pins={pairs}
          frame={menu ? corners : null}
          onFrameMove={(c) => setFrame((f) => (f ? { ...f, center: c } : f))}
          pendingImg={mode === "mapPoint" ? pendingImg : null}
          sheet={sheet}
          opacity={opacity}
          showOverlay={showOverlay}
          onMapClick={onMapClick}
          onReady={(a) => (api.current = a)}
        />

        {/* 地図の上：案内・状態 */}
        <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] w-[min(36rem,90%)] -translate-x-1/2 space-y-2">
          {(hint[mode] || (!property && mode === "idle" ? "地図で、評価する土地をクリックしてください。" : null)) && (
            <p className="rounded-lg bg-amber-50/95 px-3 py-2 text-center text-sm font-semibold text-amber-950 shadow">{hint[mode] ?? "地図で、評価する土地をクリックしてください。"}</p>
          )}
          {(busy || finding) && <p className="rounded-lg bg-white/95 px-3 py-2 text-center text-sm text-teal-900 shadow">{busy ?? "この場所の路線価図を探しています"}…</p>}
          {error && <p className="pointer-events-auto rounded-lg bg-rose-50/95 px-3 py-2 text-sm text-rose-900 shadow">{error}</p>}
        </div>

        {/* 左：位置合わせメニュー */}
        {menu && (
          <aside className="absolute bottom-3 left-14 top-3 z-[1000] w-[min(26rem,calc(100%-5rem))] space-y-4 overflow-y-auto rounded-xl bg-white/97 p-4 shadow-xl ring-1 ring-stone-200">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-stone-800">位置合わせ</h2>
              <button type="button" onClick={() => setMenu(false)} className="text-sm text-stone-500 hover:text-stone-800">
                閉じる ✕
              </button>
            </div>
            <section>
              <h3 className="mb-1 text-sm font-bold text-stone-700">路線価図1枚分の枠</h3>
              <p className="mb-2 text-xs text-stone-600">道路が重なるように枠を動かし（✥をドラッグ）、縮尺と向きを合わせます。</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  縮尺
                  <select
                    className="rounded border border-stone-300 px-2 py-1"
                    value={frame ? nearestScale(frame.scale) : DEFAULT_SCALE}
                    onChange={(e) => setFrame((f) => (f ? { ...f, scale: Number(e.target.value) } : f))}
                    disabled={!frame}
                  >
                    {SCALES.map((sc) => (
                      <option key={sc} value={sc}>
                        1/{sc.toLocaleString("ja-JP")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  微調整
                  <input
                    type="range"
                    min={0.8}
                    max={1.25}
                    step={0.01}
                    value={frame ? frame.scale / nearestScale(frame.scale) : 1}
                    onChange={(e) => setFrame((f) => (f ? { ...f, scale: Math.round(nearestScale(f.scale) * Number(e.target.value)) } : f))}
                    disabled={!frame}
                    className="flex-1 accent-teal-700"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  向き
                  <input
                    type="range"
                    min={-45}
                    max={45}
                    step={0.5}
                    value={frame?.rotation ?? 0}
                    onChange={(e) => setFrame((f) => (f ? { ...f, rotation: Number(e.target.value) } : f))}
                    disabled={!frame}
                    className="flex-1 accent-teal-700"
                  />
                  <span className="w-12 tabular-nums">{(frame?.rotation ?? 0).toFixed(1)}°</span>
                </label>
                <Button variant="ghost" onClick={() => property && setFrame((f) => ({ scale: DEFAULT_SCALE, rotation: 0, ...f, center: property }))} disabled={!property}>
                  枠を土地の位置に戻す
                </Button>
              </div>
            </section>
            <section>
              <h3 className="mb-1 text-sm font-bold text-stone-700">基準点でさらに正確に</h3>
              <p className="mb-2 text-xs text-stone-600">下の路線価図と地図で同じ場所（交差点の角など）を順に選びます。2か所以上で枠の代わりに基準点で重ねます。</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setMode("sheetPoint")} disabled={!sheet}>
                  基準点を追加（{pairs.length + 1}点目）
                </Button>
                <Button variant="ghost" onClick={() => setPairs((p) => p.slice(0, -1))} disabled={pairs.length === 0}>
                  1つ戻す
                </Button>
                <Button variant="ghost" onClick={() => setPairs([])} disabled={pairs.length === 0}>
                  すべて消す
                </Button>
              </div>
              {sheet && <SheetViewer sheet={sheet} pairs={pairs} pending={pendingImg} property={sheetProperty} clickable={mode === "sheetPoint" || mode === "sheetProperty"} onClick={onSheetClick} />}
            </section>
            <section>
              <h3 className="mb-2 text-sm font-bold text-stone-700">路線価図を手動で選ぶ</h3>
              {sheetPicker}
            </section>
          </aside>
        )}

        {/* 右：路線価の確認と入力 */}
        <aside className={`absolute right-3 top-3 z-[1000] w-[min(22rem,calc(100%-1.5rem))] rounded-xl bg-white/97 shadow-xl ring-1 ring-stone-200 ${panel ? "bottom-3 overflow-y-auto" : ""}`}>
          <button type="button" onClick={() => setPanel((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left font-bold text-stone-800">
            路線価を入力する
            <span className="text-sm font-normal text-stone-500">{panel ? "たたむ ▲" : "ひらく ▼"}</span>
          </button>
          {panel && (
            <div className="space-y-4 px-4 pb-4">
              {land && <p className="-mt-2 text-xs text-stone-500">{land.label || "（名称未入力）"}　{land.location}</p>}
              {sheet ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-stone-50 p-2">
                  <Check checked={showOverlay} onChange={setShowOverlay} label="路線価図を重ねる" />
                  <label className="flex flex-1 items-center gap-2 text-sm text-stone-700">
                    透明度
                    <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1 accent-teal-700" />
                  </label>
                </div>
              ) : (
                <p className="rounded-lg bg-stone-50 p-2 text-sm text-stone-600">
                  {property ? "路線価図がまだ重なっていません。上のメニューの「位置合わせ」から路線価図を選べます。" : "地図で土地をクリックすると、その場所の路線価図を探して重ねます。"}
                </p>
              )}
              <div className="space-y-2">
                <Button onClick={readWithClaude} disabled={!sheet || !!busy}>
                  土地の周りの路線価を読み取る
                </Button>
                {sheet && (!property || effectivePairs.length < 2) && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setMenu(true);
                      setMode("sheetProperty");
                    }}
                  >
                    路線価図で土地の位置を指定
                  </Button>
                )}
              </div>
              {reading && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-stone-700">読み取り候補（地図の上の路線価図と見比べてください）</p>
                  <ul className="space-y-1">
                    {reading.candidates.map((c) => (
                      <li key={c.notation + c.where}>
                        <button
                          type="button"
                          onClick={() => setNotation(c.notation)}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm hover:border-teal-500 hover:bg-teal-50 ${notation === c.notation ? "border-teal-600 bg-teal-50" : "border-stone-200"}`}
                        >
                          <span className="mr-2 font-mono text-base font-bold text-teal-900">{c.notation}</span>
                          {c.where}（土地と{c.distanceToMarker}）
                        </button>
                      </li>
                    ))}
                  </ul>
                  {reading.districtSymbol && <p className="text-sm text-stone-600">地区区分の記号：{reading.districtSymbol}</p>}
                  {reading.notes.map((n) => (
                    <p key={n} className="text-xs text-stone-500">
                      ※ {n}
                    </p>
                  ))}
                </div>
              )}
              <Field label="路線価の表記" hint="道路に書かれた表記（例：420D）">
                <TextInput value={notation} onChange={(e) => setNotation(e.target.value)} placeholder="420D" />
              </Field>
              <Field label="1㎡当たりの路線価">
                <YenInput value={parsed?.routePrice} onChange={(v) => setNotation(v ? String(Math.round(v / 1000)) + (parsed?.letter ?? "") : "")} />
              </Field>
              {parsed?.leaseholdRatio !== undefined && (
                <p className="text-xs text-stone-600">
                  記号「{parsed.letter}」は借地権割合 {Math.round(parsed.leaseholdRatio * 100)}% を表します。
                </p>
              )}
              <Button onClick={applyToLand} disabled={!parsed || !land}>
                この路線価を土地に反映
              </Button>
              {land?.method.type === "rosenka" && land.method.routePrice > 0 && (
                <Note tone="ok">
                  「{land.label}」の路線価は {fmt(land.method.routePrice)}円/㎡ です。奥行価格補正などは
                  <Link href="/case/assets" className="underline">財産の入力</Link>で確認してください。
                </Note>
              )}
              <p className="text-xs text-stone-500">読み取りはコンパスくんによる候補です。必ず路線価図と見比べてから反映してください。角地・二方路線・不整形地などは補正が必要な場合があります。</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function SheetViewer({
  sheet,
  pairs,
  pending,
  property,
  clickable,
  onClick,
}: {
  sheet: Sheet;
  pairs: GeoPair[];
  pending: [number, number] | null;
  property: [number, number] | null;
  clickable: boolean;
  onClick: (pt: [number, number]) => void;
}) {
  const [zoom, setZoom] = useState(0.35);
  const w = sheet.width * zoom;
  const h = sheet.height * zoom;
  const dot = (pt: [number, number], cls: string, label: string) => (
    <div key={`${cls}-${label}`} className={`pointer-events-none absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-xs font-bold text-white shadow ${cls}`} style={{ left: pt[0] * w, top: pt[1] * h }}>
      {label}
    </div>
  );
  return (
    <div className="mt-4">
      <label className="mb-2 flex items-center gap-2 text-sm text-stone-700">
        拡大
        <input type="range" min={0.15} max={1.2} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="accent-teal-700" />
      </label>
      <div className="h-[320px] overflow-auto rounded-lg border border-stone-300 bg-stone-100">
        <div className={`relative ${clickable ? "cursor-crosshair" : ""}`} style={{ width: w, height: h }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sheet.src}
            alt="路線価図"
            width={w}
            height={h}
            draggable={false}
            className="max-w-none select-none"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onClick([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]);
            }}
          />
          {pairs.map((p, i) => dot(p.img, "bg-amber-600", String(i + 1)))}
          {pending && dot(pending, "bg-amber-400 animate-pulse", String(pairs.length + 1))}
          {property && dot(property, "bg-rose-600", "土")}
        </div>
      </div>
    </div>
  );
}
