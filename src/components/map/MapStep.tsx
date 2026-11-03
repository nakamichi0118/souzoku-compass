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
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { StepBar } from "@/components/StepBar";
import { AppHeader } from "@/components/shell/AppShell";
import { Button, Check, Field, Note, NumInput, Select, TextInput, fmt } from "@/components/ui";
import type { LandAsset } from "@/domain/types";
import { parseRouteNotation } from "@/domain/valuation/rosenka";
import { DISTRICTS, type District } from "@/domain/valuation/depth";
import { type Edge, type RoadInput, evaluateRoads } from "@/domain/valuation/roads";
import { type Lot, type Road, edgeDepth, edgeDirection, edgeOutside, fitLot, lotCorners, roadEdges } from "@/domain/geo/lot";
import { ConsultLink } from "@/components/compass/ConsultLink";
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
        <h1 className="text-xl font-bold text-stone-900">地図で土地の形と路線価を確認する</h1>
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
  const [found, setFound] = useState<FindResult | null>(null);
  const [finding, setFinding] = useState(false);
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(true);
  const router = useRouter();
  const saved = land?.method.type === "rosenka" ? land.method : undefined;
  const [roads, setRoads] = useState<Road[] | null>(null);
  const [showRoads, setShowRoads] = useState(true);
  const [lot, setLot] = useState<Lot | null>(saved?.lot ?? null);
  const [edgeOn, setEdgeOn] = useState<boolean[]>(edgesOf(saved?.roads));
  const [notes, setNotes] = useState<Record<number, string>>(notationsOf(saved?.roads));
  const [cands, setCands] = useState<Record<number, ReadResult["candidates"]>>({});
  const [district, setDistrict] = useState<District>(saved?.district ?? "普通住宅地区");

  // 土地を切り替えたら保存済みの位置合わせを読み直す
  useEffect(() => {
    setPairs(land?.rosenkaSheet?.points ?? []);
    setFrame(land?.rosenkaSheet?.frame ?? (land?.geo ? { center: [land.geo.lat, land.geo.lng], scale: DEFAULT_SCALE, rotation: 0 } : null));
    setSheetUrl(land?.rosenkaSheet?.url ?? "");
    setSheet(null);
    setSheetProperty(null);
    const m = land?.method.type === "rosenka" ? land.method : undefined;
    setLot(m?.lot ?? null);
    setEdgeOn(edgesOf(m?.roads));
    setNotes(notationsOf(m?.roads));
    setCands({});
    setDistrict(m?.district ?? "普通住宅地区");
    if (land?.geo) void loadRoads([land.geo.lat, land.geo.lng]);
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

  /** 地点の周りの道路の中心線（国土地理院）を読み込む */
  async function loadRoads(ll: [number, number]): Promise<Road[]> {
    try {
      const res = await fetch(`/api/geo/roads?lat=${ll[0]}&lng=${ll[1]}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setRoads(json.roads);
      return json.roads as Road[];
    } catch {
      setRoads([]);
      return [];
    }
  }

  /** 枠を動かした・大きさを変えたときに、道路に面している辺を判定し直す */
  function changeLot(next: Lot, rs = roads ?? []) {
    setLot(next);
    if (rs.length > 0) {
      const on = roadEdges(next, rs).map((e) => e.touches);
      setEdgeOn(on.some(Boolean) ? on : [true, false, false, false]);
    } else setEdgeOn((o) => (o.some(Boolean) ? o : [true, false, false, false]));
  }

  async function placeLot(ll: [number, number]) {
    const rs = await loadRoads(ll);
    const l = fitLot(ll, rs, land?.areaSqm);
    changeLot(l, rs);
    setCands({});
    api.current?.flyTo(l.center, 19);
  }

  async function setPropertyAt(ll: [number, number]) {
    void placeLot(ll);
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
    else if (mode === "idle") void setPropertyAt(ll);
    else if (mode === "mapPoint" && pendingImg) {
      setPairs((p) => [...p, { img: pendingImg, latlng: ll }]);
      setPendingImg(null);
      setMode("idle");
    }
  }

  const roadList: Edge[] = ([0, 1, 2, 3] as Edge[]).filter((e) => edgeOn[e]);
  const roadInputs: RoadInput[] = lot
    ? roadList.map((e) => ({ edge: e, price: parseRouteNotation(notes[e] ?? "")?.routePrice ?? 0, depth: edgeDepth(lot, e), notation: notes[e] || undefined }))
    : [];
  const evaluation = evaluateRoads(district, roadInputs);
  const canRead = !!sheet && !!lot && effectivePairs.length >= 2;

  /** 枠の各辺の外側（道路の上）の点を路線価図の上の点に直し、そこに付いた路線価をコンパスくんが読む */
  async function readRoads() {
    if (!sheet || !lot) return;
    await run("コンパスくんが路線価図を読んでいます", async () => {
      const results = await Promise.all(
        roadList.map(async (e) => {
          const at = api.current?.toSheet(edgeOutside(lot, e, 4));
          if (!at || at[0] < 0 || at[0] > 1 || at[1] < 0 || at[1] > 1) return [e, null] as const;
          const fd = new FormData();
          fd.append("image", await cropAround(sheet, at, 640, 480), "crop.png");
          fd.append("target", "road");
          const res = await fetch("/api/rosenka/read", { method: "POST", body: fd });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "読み取れませんでした。");
          return [e, json as ReadResult] as const;
        }),
      );
      const nextC: Record<number, ReadResult["candidates"]> = {};
      const nextN = { ...notes };
      for (const [e, r] of results) {
        if (!r) continue;
        nextC[e] = r.candidates;
        const first = r.candidates.find((c) => parseRouteNotation(c.notation));
        if (first && !nextN[e]) nextN[e] = first.notation;
      }
      setCands(nextC);
      setNotes(nextN);
      if (results.every(([, r]) => !r)) throw new Error("土地の位置が路線価図の外にあります。位置合わせで路線価図を土地に重ねてください。");
    });
  }

  function applyToLand() {
    if (!land || !lot || !evaluation) return;
    const prev = land.method.type === "rosenka" ? land.method : undefined;
    patchLand({
      areaSqm: land.areaSqm > 0 ? land.areaSqm : Math.round(lot.width * lot.depth * 100) / 100,
      method: {
        type: "rosenka",
        routePrice: evaluation.front.price,
        depthCorrection: evaluation.front.depthRate,
        otherCorrection: prev?.otherCorrection,
        district,
        roads: roadInputs.filter((r) => r.price > 0),
        lot,
      },
      rosenkaSheet: { url: sheetUrl || undefined, page: pdfData ? pageNo : undefined, points: pairs, frame: frame ?? undefined, notation: evaluation.front.notation },
    });
    router.push(`/case/assets?asset=${land.id}&applied=1`);
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
          lot={lot ? { corners: lotCorners(lot), roadEdges: edgeOn, labels: ([0, 1, 2, 3] as Edge[]).map((e) => `${edgeDirection(lot, e)}の辺：${edgeOn[e] ? "道路に面している" : "道路に面していない"}（クリックで切り替え）`) } : null}
          onLotMove={(c) => lot && changeLot({ ...lot, center: c })}
          onEdgeToggle={(e) => setEdgeOn((o) => o.map((x, i) => (i === e ? !x : x)))}
          roads={showRoads ? (roads ?? []).map((r) => r.line) : null}
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
              <p className="mb-2 text-xs text-stone-600">路線価図の道路が、地図の青い点線（国土地理院の道路の中心線）の上にくるように枠を動かし（緑の✥をドラッグ）、縮尺と向きを合わせます。</p>
              <div className="mb-2">
                <Check checked={showRoads} onChange={setShowRoads} label="道路の中心線（青い点線）を表示" />
              </div>
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

        {/* 右：土地の形・路線価・評価 */}
        <aside className={`absolute right-3 top-3 z-[1000] w-[min(24rem,calc(100%-1.5rem))] rounded-xl bg-white/97 shadow-xl ring-1 ring-stone-200 ${panel ? "bottom-3 overflow-y-auto" : ""}`}>
          <button type="button" onClick={() => setPanel((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left font-bold text-stone-800">
            土地の形と路線価
            <span className="text-sm font-normal text-stone-500">{panel ? "たたむ ▲" : "ひらく ▼"}</span>
          </button>
          {panel && (
            <div className="space-y-5 px-4 pb-4">
              {land && <p className="-mt-2 text-xs text-stone-500">{land.label || "（名称未入力）"}　{land.location}{land.areaSqm > 0 ? `　地積 ${land.areaSqm}㎡` : ""}</p>}
              {sheet && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-stone-50 p-2">
                  <Check checked={showOverlay} onChange={setShowOverlay} label="路線価図を重ねる" />
                  <label className="flex flex-1 items-center gap-2 text-sm text-stone-700">
                    透明度
                    <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1 accent-teal-700" />
                  </label>
                </div>
              )}

              <section className="space-y-2">
                <h3 className="font-bold text-stone-800">1. 土地の形を合わせる</h3>
                {!lot ? (
                  <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-950">地図で評価する土地をクリックすると、いちばん近い道路に向けて土地の枠を出します。</p>
                ) : (
                  <>
                    <p className="text-sm text-stone-600">この枠で合っていますか？ずれていれば、枠の真ん中の ✥ をドラッグし、間口・奥行・向きを合わせてください。</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="間口（正面の幅）">
                        <NumInput value={lot.width} onChange={(v) => v > 0 && changeLot({ ...lot, width: v })} unit="m" />
                      </Field>
                      <Field label="奥行">
                        <NumInput value={lot.depth} onChange={(v) => v > 0 && changeLot({ ...lot, depth: v })} unit="m" />
                      </Field>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-stone-700">
                      向き
                      <input type="range" min={0} max={359} step={1} value={Math.round(lot.rotation)} onChange={(e) => changeLot({ ...lot, rotation: Number(e.target.value) })} className="flex-1 accent-rose-700" />
                      <span className="w-14 text-right tabular-nums">{edgeDirection(lot, 0)}</span>
                    </label>
                    <p className="text-xs text-stone-500">
                      枠の広さ {fmt(Math.round(lot.width * lot.depth))}㎡
                      {land && land.areaSqm > 0 && Math.abs(lot.width * lot.depth - land.areaSqm) / land.areaSqm > 0.1 && `（登録の地積 ${land.areaSqm}㎡ と違います）`}
                    </p>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-stone-700">道路に面している辺（地図の辺をクリックしても切り替えられます）</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {([0, 1, 2, 3] as Edge[]).map((e) => (
                          <Check key={e} checked={!!edgeOn[e]} onChange={(v) => setEdgeOn((o) => o.map((x, i) => (i === e ? v : x)))} label={edgeDirection(lot, e)} />
                        ))}
                      </div>
                      {roads && roads.length === 0 && <p className="text-xs text-stone-500">道路の情報を取得できなかったため、面している辺を選んでください。</p>}
                    </div>
                  </>
                )}
              </section>

              {lot && roadList.length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-bold text-stone-800">2. 道路ごとの路線価</h3>
                  {canRead ? (
                    <Button onClick={readRoads} disabled={!!busy}>
                      路線価図から読み取る
                    </Button>
                  ) : (
                    <p className="rounded-lg bg-stone-50 p-2 text-xs text-stone-600">
                      {sheet ? "路線価図の位置が合っていません。上の「位置合わせ」で道路を重ねてください。" : "路線価図が見つかると、道路ごとの路線価を読み取れます。路線価図を見て入力することもできます。"}
                    </p>
                  )}
                  <ul className="space-y-2">
                    {roadList.map((e) => {
                      const p = parseRouteNotation(notes[e] ?? "");
                      const line = evaluation?.lines.find((l) => l.edge === e);
                      return (
                        <li key={e} className="rounded-lg border border-stone-200 p-2">
                          <div className="flex items-center gap-2">
                            <span className="w-20 shrink-0 text-sm font-semibold text-stone-700">
                              {edgeDirection(lot, e)}
                              {line && <span className="block text-[11px] font-normal text-rose-700">{{ front: "正面", side: "側方", back: "裏面" }[line.role]}</span>}
                            </span>
                            <TextInput value={notes[e] ?? ""} onChange={(ev) => setNotes((n) => ({ ...n, [e]: ev.target.value }))} placeholder="例：420D" />
                            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-stone-600">{p ? `${fmt(p.routePrice)}円/㎡` : "—"}</span>
                          </div>
                          {cands[e] && cands[e].length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {cands[e].map((c) => (
                                <button
                                  key={c.notation + c.where}
                                  type="button"
                                  title={c.where}
                                  onClick={() => setNotes((n) => ({ ...n, [e]: c.notation }))}
                                  className={`rounded-full border px-2 py-0.5 font-mono text-xs ${notes[e] === c.notation ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 hover:border-teal-500"}`}
                                >
                                  {c.notation}
                                </button>
                              ))}
                            </div>
                          )}
                          <p className="mt-1 text-[11px] text-stone-500">この道路から見た奥行 {edgeDepth(lot, e)}m</p>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-stone-500">読み取りはコンパスくんによる候補です。地図の上の路線価図と見比べてください。数字は千円単位です（420D → 420,000円）。</p>
                </section>
              )}

              {lot && roadList.length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-bold text-stone-800">3. 評価額</h3>
                  <Field label="地区区分" hint="路線価を囲む記号の形で決まります（記号がなければ普通住宅地区）">
                    <Select value={district} onChange={(v) => setDistrict(v as District)} options={DISTRICTS.map((d) => ({ value: d, label: d }))} />
                  </Field>
                  {evaluation ? (
                    <div className="space-y-1 rounded-lg bg-teal-50 p-3 text-sm text-teal-950">
                      {evaluation.steps.map((x) => (
                        <p key={x} className="text-xs">{x}</p>
                      ))}
                      <p className="pt-1 text-base font-bold">1㎡あたり {fmt(evaluation.perSqm)}円</p>
                      {land && land.areaSqm > 0 && <p className="font-semibold">× {land.areaSqm}㎡ ＝ {fmt(Math.floor(evaluation.perSqm * land.areaSqm))}円</p>}
                    </div>
                  ) : (
                    <p className="text-sm text-stone-500">路線価を入れると評価額を計算します。</p>
                  )}
                  <Note tone="info">
                    高めに評価しています（角地の加算率を使い、間口が狭い・形がいびつ・がけ地などの減額はしていません）。下げられるかは税理士に確認できます。
                    <span className="mt-2 block">
                      <ConsultLink topic="土地の評価" />
                    </span>
                  </Note>
                  <Button onClick={applyToLand} disabled={!evaluation || !land} className="w-full py-3">
                    この評価を反映して財産の入力へ戻る
                  </Button>
                </section>
              )}
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

/** 保存済みの道路から、面している辺の一覧を作る */
function edgesOf(roads?: RoadInput[]): boolean[] {
  const on = [false, false, false, false];
  for (const r of roads ?? []) on[r.edge] = true;
  return on;
}
function notationsOf(roads?: RoadInput[]): Record<number, string> {
  const n: Record<number, string> = {};
  for (const r of roads ?? []) n[r.edge] = r.notation ?? (r.price > 0 ? String(Math.round(r.price / 1000)) : "");
  return n;
}
