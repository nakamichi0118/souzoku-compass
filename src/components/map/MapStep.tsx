"use client";

/**
 * 地図で土地の場所を選び、国税庁の路線価図を地図に重ねて路線価を確認する画面。
 *
 * 1. 住所検索または地図のクリックで、評価する土地の位置を決める
 * 2. 国税庁サイトの路線価図（PDF）を読み込む（URL指定またはファイル）
 * 3. 路線価図と地図で同じ交差点などを2〜3か所選び、位置を合わせて半透明で重ねる
 * 4. 土地の周辺の路線価を Claude が読み取り（候補）、本人が確認して入力する
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { StepBar } from "@/components/StepBar";
import { Button, Card, Check, Field, Note, Select, TextInput, YenInput, fmt } from "@/components/ui";
import type { LandAsset } from "@/domain/types";
import { parseRouteNotation } from "@/domain/valuation/rosenka";
import { useCase } from "@/lib/store";
import type { GeoPair, MapApi, Sheet } from "./MapView";
import { cropAround, loadImage, renderPdfPage } from "./sheet";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="h-[520px] animate-pulse rounded-xl bg-stone-100" /> });

const TOKYO_STATION: [number, number] = [35.681236, 139.767125];

type Mode = "idle" | "property" | "sheetPoint" | "mapPoint" | "sheetProperty";

interface ReadResult {
  candidates: { notation: string; where: string; distanceToMarker: string }[];
  districtSymbol: string | null;
  notes: string[];
}

export function MapStep() {
  return (
    <>
      <StepBar current="assets" />
      <main className="mx-auto max-w-6xl space-y-5 px-4 pb-24 pt-20">
        <div>
          <p className="text-sm font-semibold text-teal-700">ステップ 3 / 7 ・ 財産</p>
          <h1 className="text-2xl font-bold text-stone-900">地図で土地を選び、路線価図を重ねる</h1>
        </div>
        <Suspense fallback={<p className="text-stone-500">読み込み中…</p>}>
          <MapWorkspace />
        </Suspense>
      </main>
    </>
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
  const [notation, setNotation] = useState(land?.rosenkaSheet?.notation ?? "");

  // 土地を切り替えたら保存済みの位置合わせを読み直す
  useEffect(() => {
    setPairs(land?.rosenkaSheet?.points ?? []);
    setSheetUrl(land?.rosenkaSheet?.url ?? "");
    setNotation(land?.rosenkaSheet?.notation ?? "");
    setSheet(null);
    setReading(null);
    setSheetProperty(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  const property: [number, number] | undefined = land?.geo ? [land.geo.lat, land.geo.lng] : undefined;
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

  async function setPropertyAt(ll: [number, number]) {
    patchLand({ geo: { lat: ll[0], lng: ll[1] } });
    setMode("idle");
    setTown(null);
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

  async function loadFromUrl() {
    await run("路線価図を読み込んでいます", async () => {
      const res = await fetch(`/api/rosenka/sheet?url=${encodeURIComponent(sheetUrl)}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "読み込めませんでした。");
      const buf = await res.arrayBuffer();
      if (res.headers.get("content-type")?.includes("pdf")) {
        setPdfData(buf);
        await showPdf(buf, pageNo);
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
    if (mode === "property") void setPropertyAt(ll);
    else if (mode === "mapPoint" && pendingImg) {
      setPairs((p) => [...p, { img: pendingImg, latlng: ll }]);
      setPendingImg(null);
      setMode("idle");
    }
  }

  /** 路線価図上の土地の位置：位置合わせ済みなら地図の位置から計算、未済なら路線価図上でクリックした点 */
  const sheetPointOfProperty = (): [number, number] | null => {
    if (property && pairs.length >= 2) return api.current?.toSheet(property) ?? null;
    return sheetProperty;
  };

  async function readWithClaude() {
    const at = sheetPointOfProperty();
    if (!sheet || !at) {
      setError("路線価図上の土地の位置が分かりません。位置合わせをするか、路線価図で土地の位置をクリックしてください。");
      return;
    }
    setSheetProperty(at);
    await run("Claude が路線価図を読んでいます", async () => {
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
      rosenkaSheet: { url: sheetUrl || undefined, page: pdfData ? pageNo : undefined, points: pairs, notation },
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

  return (
    <div className="space-y-5">
      <Card title="評価する土地">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="土地">
            <Select value={assetId} onChange={setAssetId} options={lands.map((l) => ({ value: l.id, label: `${l.label || "（名称未入力）"}　${l.location}` }))} />
          </Field>
          <Link href="/case/assets" className="rounded-lg px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50">
            ← 財産の入力に戻る
          </Link>
        </div>
      </Card>

      {hint[mode] && <Note tone="warn">{hint[mode]}</Note>}
      {error && <Note tone="stop">{error}</Note>}
      {busy && <Note tone="info">{busy}…</Note>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="① 地図で土地の場所を選ぶ">
          <div className="mb-3 flex gap-2">
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder={land?.location || "住所を入力（例：千代田区霞が関3丁目）"} />
            <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={search} disabled={!query.trim()}>
              検索
            </Button>
          </div>
          {hits.length > 1 && (
            <ul className="mb-3 max-h-28 overflow-auto rounded border border-stone-200 text-sm">
              {hits.map((h) => (
                <li key={`${h.lat},${h.lng},${h.title}`}>
                  <button type="button" className="w-full px-3 py-1 text-left hover:bg-teal-50" onClick={() => api.current?.flyTo([h.lat, h.lng], 17)}>
                    {h.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <MapView
            center={center}
            property={property}
            pairs={pairs}
            pendingImg={mode === "mapPoint" ? pendingImg : null}
            sheet={sheet}
            opacity={opacity}
            showOverlay={showOverlay}
            onMapClick={onMapClick}
            onReady={(a) => (api.current = a)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant={mode === "property" ? "primary" : "secondary"} onClick={() => setMode(mode === "property" ? "idle" : "property")}>
              {property ? "土地の位置を選び直す" : "地図で土地の位置を選ぶ"}
            </Button>
            {property && (
              <span className="text-sm text-stone-600">
                選択済み（{property[0].toFixed(5)}, {property[1].toFixed(5)}）{town && `・${town}付近`}
              </span>
            )}
          </div>
          {pairs.length >= 2 && sheet && (
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <Check checked={showOverlay} onChange={setShowOverlay} label="路線価図を重ねる" />
              <label className="flex items-center gap-2 text-sm text-stone-700">
                透明度
                <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="accent-teal-700" />
              </label>
            </div>
          )}
        </Card>

        <Card title="② 国税庁の路線価図を読み込む">
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-stone-700">
            <li>
              <a href="https://www.rosenka.nta.go.jp/" target="_blank" rel="noreferrer" className="font-semibold text-teal-800 underline">
                国税庁「路線価図・評価倍率表」
              </a>
              で「令和8年分」→ 都道府県 → 路線価図 → 市区町村 → {town ? `「${town}」` : "町丁名"} の図番号を開きます。
            </li>
            <li>表示されたPDFのURLを貼り付けるか、PDFを保存してファイルを選んでください。</li>
          </ol>
          <div className="flex gap-2">
            <TextInput value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://www.rosenka.nta.go.jp/main_r08/…/prices/pdf/….pdf" />
            <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={loadFromUrl} disabled={!sheetUrl.trim() || !!busy}>
              読込
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="cursor-pointer rounded-lg border border-dashed border-stone-400 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50">
              PDF・画像ファイルを選ぶ
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
              デモ用の架空の路線価図を使う
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
          {sheet ? (
            <SheetViewer sheet={sheet} pairs={pairs} pending={pendingImg} property={sheetProperty} clickable={mode === "sheetPoint" || mode === "sheetProperty"} onClick={onSheetClick} />
          ) : (
            <p className="mt-4 rounded-lg bg-stone-50 p-6 text-center text-sm text-stone-500">路線価図を読み込むと、ここに表示されます。</p>
          )}
        </Card>
      </div>

      <Card title="③ 路線価図と地図の位置を合わせる">
        <p className="mb-3 text-sm text-stone-700">
          路線価図と地図で同じ場所（交差点の角など）を順に選びます。2か所で重ねて表示でき、離れた3か所以上にするとより正確に合います。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setMode("sheetPoint")} disabled={!sheet}>
            基準点を追加（{pairs.length + 1}点目）
          </Button>
          <Button variant="ghost" onClick={() => setPairs((p) => p.slice(0, -1))} disabled={pairs.length === 0}>
            最後の基準点を取り消す
          </Button>
          <Button variant="ghost" onClick={() => setPairs([])} disabled={pairs.length === 0}>
            すべて消す
          </Button>
          <span className="text-sm text-stone-600">基準点 {pairs.length} 点</span>
        </div>
        {!sheet && pairs.length > 0 && <p className="mt-2 text-sm text-stone-500">保存済みの基準点があります。同じ路線価図を読み込むと重ねて表示します。</p>}
      </Card>

      <Card title="④ 路線価を確認して入力する">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={readWithClaude} disabled={!sheet || !!busy}>
            土地の周りの路線価を Claude に読み取ってもらう
          </Button>
          {(!property || pairs.length < 2) && (
            <Button variant="secondary" onClick={() => setMode("sheetProperty")} disabled={!sheet}>
              路線価図で土地の位置を指定
            </Button>
          )}
        </div>
        {reading && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold text-stone-700">読み取り候補（路線価図と見比べて確認してください）</p>
            <ul className="space-y-1">
              {reading.candidates.map((c) => (
                <li key={c.notation + c.where}>
                  <button type="button" onClick={() => setNotation(c.notation)} className="w-full rounded-lg border border-stone-200 px-3 py-2 text-left text-sm hover:border-teal-500 hover:bg-teal-50">
                    <span className="mr-3 font-mono text-base font-bold text-teal-900">{c.notation}</span>
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
        <div className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end">
          <Field label="路線価の表記" hint="路線価図の道路に書かれた表記（例：420D）">
            <TextInput value={notation} onChange={(e) => setNotation(e.target.value)} placeholder="420D" />
          </Field>
          <Field label="1㎡当たりの路線価">
            <YenInput value={parsed?.routePrice} onChange={(v) => setNotation(v ? String(Math.round(v / 1000)) + (parsed?.letter ?? "") : "")} />
          </Field>
          <Button onClick={applyToLand} disabled={!parsed || !land}>
            この路線価を土地に反映
          </Button>
        </div>
        {parsed?.leaseholdRatio !== undefined && (
          <p className="mt-2 text-sm text-stone-600">
            記号「{parsed.letter}」は借地権割合 {Math.round(parsed.leaseholdRatio * 100)}% を表します（土地を貸している場合などに使います）。
          </p>
        )}
        {land?.method.type === "rosenka" && land.method.routePrice > 0 && (
          <Note tone="ok">
            「{land.label}」の路線価は {fmt(land.method.routePrice)}円/㎡ です。奥行価格補正などは
            <Link href="/case/assets" className="underline">財産の入力</Link>で確認してください。
          </Note>
        )}
        <p className="mt-3 text-xs text-stone-500">
          路線価の読み取りは Claude による候補です。必ず路線価図と見比べてから反映してください。角地・二方路線・不整形地などは補正が必要になる場合があります。
        </p>
      </Card>
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
      <div className="h-[460px] overflow-auto rounded-lg border border-stone-300 bg-stone-100">
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
