"use client";

/**
 * 地図で土地を評価する画面。土地の評価はむずかしいので、順番に1つずつ進める。
 *
 * 路線価地域：1. 土地の場所 → 2. 土地の形（多角形で囲む。公図も重ねられる）→ 3. 路線価図（コンパスくんが1枚に絞って重ねる）
 *            → 4. 接している道路と路線価（コンパスくんが読み、本人が確かめる）→ 評価
 * 倍率地域：  1. 土地の場所 → 2. 評価倍率表（コンパスくんが行を探し、表と一緒に確かめる）→ 3. 固定資産税評価額 × 倍率
 *
 * コンパスくん（Claude）は図や表を読む手伝いだけをする。正面路線の判定や評価額は決まった計算で出す。
 */
import { Check as CheckIcon, MapPin, Shapes, Map as MapIcon, Route as RouteIcon, Table2, Calculator } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { StepBar } from "@/components/StepBar";
import { ConsultLink } from "@/components/compass/ConsultLink";
import { AppHeader } from "@/components/shell/AppShell";
import { Button, Check, Field, Note, NumInput, Select, TextInput, fmt } from "@/components/ui";
import { type Frame, DEFAULT_PAPER, frameCorners, framePairs } from "@/domain/geo/frame";
import { type LatLng, type Road, fitLot, lotCorners } from "@/domain/geo/lot";
import { depthFor, directionLabel, edgeClasses, edgeTouches, frontagesOf, polygonAreaSqm, rectangle } from "@/domain/geo/polygon";
import type { LandAsset } from "@/domain/types";
import { DISTRICTS, type District } from "@/domain/valuation/depth";
import { leaseLetterOf } from "@/domain/valuation/lease";
import { type RoadInput, evaluateRoads } from "@/domain/valuation/roads";
import { parseRouteNotation } from "@/domain/valuation/rosenka";
import { useCase } from "@/lib/store";
import type { FindResult, SheetLayoutItem } from "@/server/rosenkaIndex";
import { FrameControls, type PointMode, PointControls, SheetSource, SheetViewer } from "./AlignTools";
import { type Candidate, type LocateResult, fetchSheetPdf, locateSheet } from "./locate";
import type { GeoPair, MapApi, Sheet } from "./MapView";
import { RatioPanel } from "./RatioPanel";
import { cropAround, loadImage, renderPdfPage } from "./sheet";
import { EMPTY_NOTES, type ReadCandidate, type RoadNotes, candidatesFor, frontageContext, keyOf, mergeReadings, needsRead, noteFor, notesFromSaved, readingContext, savedRoute, typeNote } from "./wizard";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="h-[520px] animate-pulse rounded-xl bg-stone-100" /> });

const TOKYO_STATION: LatLng = [35.681236, 139.767125];

type Route = "rosenka" | "ratio";
interface ReadResult {
  candidates: ReadCandidate[];
  districtSymbol: string | null;
  notes: string[];
}

export function MapStep() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50/70 to-stone-50">
      <AppHeader />
      <StepBar current="assets" />
      <main className="mx-auto max-w-[1600px] space-y-3 px-4 pb-8 pt-4">
        <h1 className="text-xl font-bold text-stone-900">地図で土地を評価する</h1>
        <Suspense fallback={<p className="text-stone-500">読み込み中…</p>}>
          <LandWizard />
        </Suspense>
      </main>
    </div>
  );
}

/** 路線価図の地区区分の記号の説明（コンパスくんの読み取り）から地区区分を選ぶ */
function districtFrom(symbol: string | null): District | null {
  if (!symbol) return null;
  const s = symbol.normalize("NFKC");
  if (/記号なし|無印/.test(s)) return "普通住宅地区";
  for (const [word, d] of [
    ["ビル街", "ビル街地区"],
    ["高度商業", "高度商業地区"],
    ["繁華街", "繁華街地区"],
    ["普通商業", "普通商業・併用住宅地区"],
    ["併用住宅", "普通商業・併用住宅地区"],
    ["中小工場", "中小工場地区"],
    ["大工場", "大工場地区"],
    ["普通住宅", "普通住宅地区"],
  ] as const)
    if (s.includes(word)) return d;
  return null;
}

function LandWizard() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, update, loaded } = useCase();
  const lands = data.assets.filter((a): a is LandAsset => a.kind === "land");
  const [assetId, setAssetId] = useState<string>(params.get("asset") ?? "");
  useEffect(() => {
    if (loaded && !lands.some((l) => l.id === assetId) && lands[0]) setAssetId(lands[0].id);
  }, [loaded, lands, assetId]);
  const land = lands.find((l) => l.id === assetId);
  const patchLand = (p: Partial<LandAsset>) => update((c) => ({ ...c, assets: c.assets.map((a) => (a.id === assetId && a.kind === "land" ? { ...a, ...p } : a)) }));

  const api = useRef<MapApi | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pdfCache = useRef(new Map<string, ArrayBuffer>());
  const [step, setStep] = useState(1);
  const [route, setRoute] = useState<Route | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 1. 場所
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ title: string; lat: number; lng: number }[]>([]);
  const [found, setFound] = useState<FindResult | null>(null);
  const [finding, setFinding] = useState(false);
  const [town, setTown] = useState<string | null>(null);
  const [roads, setRoads] = useState<Road[] | null>(null);
  const [showRoads, setShowRoads] = useState(true);
  // 2. 形
  const [shape, setShape] = useState<LatLng[] | null>(null);
  const [kozu, setKozu] = useState<{ sheet: Sheet; pairs: GeoPair[]; opacity: number; show: boolean } | null>(null);
  const [kozuMode, setKozuMode] = useState<PointMode>("idle");
  const [kozuPending, setKozuPending] = useState<[number, number] | null>(null);
  // 3. 路線価図
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [sheetNo, setSheetNo] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [pairs, setPairs] = useState<GeoPair[]>([]);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [opacity, setOpacity] = useState(0.6);
  const [showOverlay, setShowOverlay] = useState(true);
  const [located, setLocated] = useState<LocateResult | null>(null);
  const [alignOpen, setAlignOpen] = useState(false);
  const [pointMode, setPointMode] = useState<PointMode>("idle");
  const [pending, setPending] = useState<[number, number] | null>(null);
  // 4. 道路と路線価
  const [edgeOn, setEdgeOn] = useState<boolean[]>([]);
  const [roadIdx, setRoadIdx] = useState<number[]>([]);
  /** 道路ごとの路線価の欄（読んだときの条件・本人が入れたものも覚える） */
  const [readings, setReadings] = useState<RoadNotes>(EMPTY_NOTES);
  const [roadsAnswer, setRoadsAnswer] = useState<"yes" | "no" | null>(null);
  const [district, setDistrict] = useState<District>("普通住宅地区");
  const [districtTouched, setDistrictTouched] = useState(false);
  const touchedRef = useRef(districtTouched);
  touchedRef.current = districtTouched;
  const [area, setArea] = useState(0);
  // 倍率地域：倍率が決まったか（決まるまで 3. には進めない）
  const [ratioReady, setRatioReady] = useState(false);
  /** 土地や場所を変えるたびに増やす。前の土地・場所への問い合わせの答えが後から届いても使わない */
  const gen = useRef(0);
  /** 開き直した土地の形と、本人が選んだ「道路に接している辺」（形を直すまでそのまま使う） */
  const keepEdges = useRef<{ shape: LatLng[]; on: boolean[] } | null>(null);
  /** 開き直した土地の、確かめて保存した道路ごとの路線価（道路の情報がそろったら欄に戻す） */
  const seed = useRef<{ shape: LatLng[]; roads: RoadInput[]; ctx: string } | null>(null);

  const geoLat = land?.geo?.lat;
  const geoLng = land?.geo?.lng;
  const property = useMemo<LatLng | undefined>(() => (geoLat !== undefined && geoLng !== undefined ? [geoLat, geoLng] : undefined), [geoLat, geoLng]);
  const paper = sheet?.paper ?? DEFAULT_PAPER;
  const effectivePairs = useMemo(() => (pairs.length >= 2 ? pairs : frame ? framePairs(frame, paper) : []), [pairs, frame, paper]);
  const center = useMemo(() => property ?? TOKYO_STATION, [assetId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheetId = sheetUrl || sheet?.src || "";
  /** 路線価を読む条件（場所・路線価図・ページ・重ね方）。変わったら、前に読んだ路線価は使わずに読み直す */
  const ctx = useMemo(() => readingContext({ property, sheetId, page: pageNo, pairs, frame }), [property, sheetId, pageNo, pairs, frame]);

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

  // 土地を切り替えたら、保存してある内容から始め直す
  useEffect(() => {
    if (!land) return;
    const g = ++gen.current;
    const m = land.method.type === "rosenka" ? land.method : undefined;
    const saved = land.rosenkaSheet;
    const geo: LatLng | undefined = land.geo ? [land.geo.lat, land.geo.lng] : undefined;
    const restored = m?.shape ?? (m?.lot ? lotCorners(m.lot) : null);
    setShape(restored);
    // 評価を終えた土地を開き直したときは、本人が選んだ辺と確かめた路線価をそのまま使う（読み直さない）
    keepEdges.current = m?.shape && m.edgeOn?.length === m.shape.length ? { shape: m.shape, on: m.edgeOn } : null;
    seed.current =
      restored && m?.roads?.length
        ? { shape: restored, roads: m.roads, ctx: readingContext({ property: geo, sheetId: saved?.url ?? "", page: saved?.page ?? 1, pairs: saved?.points ?? [], frame: saved?.frame ?? null }) }
        : null;
    setFrame(saved?.frame ?? null);
    setPairs(saved?.points ?? []);
    setSheetUrl(saved?.url ?? "");
    setPageNo(saved?.page ?? 1);
    setPdfData(null);
    setSheet(null);
    setSheetNo(null);
    setLocated(null);
    setFound(null);
    setTown(null);
    setRoads(null);
    setFinding(false);
    setDistrict(m?.district ?? "普通住宅地区");
    setDistrictTouched(!!m?.district);
    setArea(land.areaSqm);
    setReadings(EMPTY_NOTES);
    setRoadsAnswer(null);
    setKozu(null);
    setKozuMode("idle");
    setKozuPending(null);
    setPointMode("idle");
    setPending(null);
    setAlignOpen(false);
    setError(null);
    // 書類から読んだだけの仮の方法などで、路線価地域か倍率地域かが決まっていなければ、場所から調べて決める
    const decided = savedRoute(land.method);
    setRoute(decided);
    setRatioReady(land.method.type === "multiplier" && land.method.multiplier > 0);
    setStep(1);
    if (geo) {
      api.current?.flyTo(geo, 18);
      void loadRoads(geo, g).then((rs) => {
        // 場所だけ保存してあるときは、最初の形（道路に正面を向けた四角形）から始める
        if (!rs || restored) return;
        const lot = fitLot(geo, rs, land.areaSqm);
        setShape((cur) => cur ?? rectangle(lot.center, lot.width, lot.depth, lot.rotation));
      });
      void findAt(geo, decided === null, g);
    } else void showAround(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, loaded]);

  /** 1. 入力済みの住所（土地の所在 → 亡くなった方の住所）の周辺を最初に表示する */
  async function showAround(g: number) {
    const q = [land?.location, data.decedent.address].map((x) => x?.trim()).find((x) => x && x.length >= 4);
    if (!q) return;
    try {
      const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      const hit = json.results?.[0];
      if (hit && g === gen.current) {
        api.current?.flyTo([hit.lat, hit.lng], 18);
        setNotice(`「${q}」の周辺を表示しています。評価する土地をクリックしてください。`);
      }
    } catch {
      /* 見つからなければ地図を動かして選ぶ */
    }
  }

  async function search() {
    await run("住所を検索しています", async () => {
      const res = await fetch(`/api/geo/search?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setHits(json.results);
      if (json.results.length === 0) throw new Error("見つかりませんでした。町名までで検索してみてください。");
      api.current?.flyTo([json.results[0].lat, json.results[0].lng], 18);
    });
  }

  /** 道路の中心線を取ってくる。答えが届く前に土地や場所が変わったら null（何も変えない） */
  async function loadRoads(ll: LatLng, g: number): Promise<Road[] | null> {
    let rs: Road[] = [];
    try {
      const res = await fetch(`/api/geo/roads?lat=${ll[0]}&lng=${ll[1]}&radius=400`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      rs = json.roads as Road[];
    } catch {
      rs = [];
    }
    if (g !== gen.current) return null;
    setRoads(rs);
    return rs;
  }

  /** その場所の路線価図の候補（なければ倍率地域の可能性） */
  async function findAt(ll: LatLng, decide: boolean, g: number) {
    setFinding(true);
    try {
      const res = await fetch(`/api/rosenka/find?lat=${ll[0]}&lng=${ll[1]}`);
      const json = (await res.json()) as FindResult & { error?: string };
      if (g !== gen.current) return;
      if (!res.ok) throw new Error(json.error);
      setFound(json);
      if (json.town) setTown(json.town);
      if (decide) setRoute(json.sheets.length > 0 ? "rosenka" : "ratio");
    } catch (e) {
      if (g !== gen.current) return;
      setFound(null);
      if (decide) setRoute("rosenka");
      setError(`路線価図を自動で探せませんでした。${e instanceof Error && e.message ? `（${e.message}）` : ""}`);
    } finally {
      if (g === gen.current) setFinding(false);
    }
  }

  async function setPropertyAt(ll: LatLng) {
    const g = ++gen.current;
    const m = land?.method;
    // 場所を選び直したら、前の場所の路線価図と土地の形は使わない（評価をし直すまで、前の評価額はそのまま）
    patchLand({
      geo: { lat: ll[0], lng: ll[1] },
      rosenkaSheet: undefined,
      ...(m?.type === "rosenka" && (m.shape || m.lot || m.edgeOn) ? { method: { ...m, shape: undefined, lot: undefined, edgeOn: undefined } } : {}),
    });
    keepEdges.current = null;
    seed.current = null;
    setNotice(null);
    setError(null);
    setShape(null);
    setSheet(null);
    setSheetNo(null);
    setSheetUrl("");
    setPdfData(null);
    setPageNo(1);
    setFrame(null);
    setPairs([]);
    setLocated(null);
    setAlignOpen(false);
    setFound(null);
    setRoute(null);
    setTown(null);
    // 前の場所で読んだ路線価・地区区分は使わない
    setReadings(EMPTY_NOTES);
    setRoadsAnswer(null);
    setDistrict("普通住宅地区");
    setDistrictTouched(false);
    void findAt(ll, true, g);
    const rs = await loadRoads(ll, g);
    if (!rs) return; // 答えが届く前に、別の場所が選ばれた
    // 2. の最初の形：いちばん近い道路に正面を向けた四角形
    const lot = fitLot(ll, rs, land?.areaSqm);
    setShape(rectangle(lot.center, lot.width, lot.depth, lot.rotation));
  }

  // 手順を進めたら、見る範囲に地図を合わせる（2・4は土地の形、3は路線価図が見える広さ）
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const aside = asideRef.current;
    const overlaid = !!aside && getComputedStyle(aside).position === "absolute";
    const right = overlaid ? aside.offsetWidth + 12 : 0;
    // スマートフォンでは案内が地図の下にあるので、手順を進めたら地図が見える位置に戻す
    if (!overlaid && step > 1) wrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if ((step === 2 || step === 4) && shape && route === "rosenka") a.fitPoints(shape, { maxZoom: 20, right });
    else if (step === 3 && property) a.flyTo(property, 17);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, route]);

  // 形・道路が変わったら、道路に接している辺を判定し直す（開き直した形は、本人が選んだ辺をそのまま使う）
  useEffect(() => {
    if (!shape) return;
    const t = edgeTouches(shape, roads ?? []);
    const kept = keepEdges.current?.shape === shape ? keepEdges.current.on : null;
    const on = kept ? [...kept] : t.map((x) => x.touches);
    if (!kept && !on.some(Boolean) && on.length > 0) on[0] = true; // 道路の情報がないときは最初の辺を正面に
    const idx = t.map((x) => x.roadIndex);
    setEdgeOn(on);
    setRoadIdx(idx);
    setRoadsAnswer(null);
    // 開き直した土地：道路の情報がそろったら、確かめて保存した路線価を道路ごとに欄へ戻す
    const s = seed.current;
    if (s && s.shape !== shape) seed.current = null;
    else if (s && roads) {
      seed.current = null;
      const fr = frontagesOf(shape, on, idx);
      setReadings(notesFromSaved(s.roads, fr, edgeClasses(fr), (f) => frontageContext(s.ctx, f)));
    }
  }, [shape, roads]);

  // 路線価図や重ね方・場所が変わったら、「接しています」の答えを聞き直す
  useEffect(() => setRoadsAnswer(null), [ctx]);

  const shapeArea = shape ? polygonAreaSqm(shape) : 0;
  const areaForDepth = area > 0 ? area : shapeArea;
  const frontages = useMemo(() => (shape ? frontagesOf(shape, edgeOn, roadIdx) : []), [shape, edgeOn, roadIdx]);
  const classes = useMemo(() => edgeClasses(frontages), [frontages]);
  const roadInputs: RoadInput[] = frontages.flatMap((f, i) => {
    const e = classes[i];
    if (e === null || e === undefined) return [];
    const n = noteFor(readings, keyOf(f), frontageContext(ctx, f));
    // 間口は土地の形から測った長さ（m、小数2桁）。間口狭小・奥行長大の補正に使う
    const frontage = Math.round(f.frontage * 100) / 100;
    return [{ edge: e, price: parseRouteNotation(n)?.routePrice ?? 0, depth: depthFor(f, areaForDepth), notation: n || undefined, ...(frontage > 0 ? { frontage } : {}) }];
  });
  const evaluation = evaluateRoads(district, roadInputs);
  const duplicated = classes.some((c) => c === null);
  /** 計算に入れるすべての道路に路線価と奥行がある */
  const roadsComplete = roadInputs.length > 0 && roadInputs.every((r) => r.price > 0 && r.depth > 0);

  // ---------------------------------------------------------------- 3. 路線価図

  /** 図を表示する。描いている間に土地や場所が変わったら表示せず null */
  async function showSheet(buf: ArrayBuffer, page: number, g: number) {
    const s = await renderPdfPage(buf, page);
    return putSheet(s, g);
  }
  function putSheet<S extends Sheet>(s: S, g: number): S | null {
    if (g !== gen.current) {
      URL.revokeObjectURL(s.src);
      return null;
    }
    setSheet((old) => {
      if (old) URL.revokeObjectURL(old.src);
      return s;
    });
    return s;
  }

  /** 候補の中から土地が載っている図をコンパスくんに選んでもらい、重ねる */
  async function identify(list: Candidate[]) {
    if (!property || list.length === 0) return;
    const g = gen.current;
    setLocated(null);
    setAlignOpen(false);
    await run("路線価図を探しています", async () => {
      const r = await locateSheet({ property, candidates: list, town, cache: pdfCache.current, roads: roads ?? [], onStep: (m) => g === gen.current && setBusy(m) });
      if (g !== gen.current) return;
      setLocated(r);
      const c = list.find((x) => x.no === r.no) ?? (list.length === 1 ? list[0] : undefined);
      if (!c) return;
      const buf = await fetchSheetPdf(c.pdfUrl, pdfCache.current);
      if (g !== gen.current || !(await showSheet(buf, 1, g))) return;
      setPdfData(buf);
      setPageNo(1);
      setSheetUrl(c.pdfUrl);
      setSheetNo(c.no);
      setPairs([]);
      if (r.frame) setFrame(r.frame);
      else {
        setFrame({ center: property, scale: 1500, rotation: 0 });
        setAlignOpen(true);
      }
    });
  }

  async function loadFromUrl(url: string, keepAlignment = false) {
    const g = gen.current;
    await run("路線価図を読み込んでいます", async () => {
      const buf = await fetchSheetPdf(url, pdfCache.current);
      if (g !== gen.current || !(await showSheet(buf, keepAlignment ? pageNo : 1, g))) return;
      setSheetUrl(url);
      setSheetNo(found?.sheets.find((x) => x.pdfUrl === url)?.no ?? null);
      setPdfData(buf);
      if (!keepAlignment) {
        setPairs([]);
        setPageNo(1);
      }
      if (!keepAlignment || !frame) setFrame((f) => f ?? (property ? { center: property, scale: 1500, rotation: 0 } : null));
    });
  }

  async function loadFromFile(file: File) {
    const g = gen.current;
    await run("路線価図を読み込んでいます", async () => {
      let buf: ArrayBuffer | null = null;
      if (file.type === "application/pdf") {
        buf = await file.arrayBuffer();
        if (!(await showSheet(buf, 1, g))) return;
      } else if (!putSheet(await loadImage(file), g)) return;
      setSheetUrl("");
      setSheetNo(null);
      setPairs([]);
      setPdfData(buf);
      setPageNo(1);
      setFrame((f) => f ?? (property ? { center: property, scale: 1500, rotation: 0 } : null));
      setAlignOpen(true);
    });
  }

  async function loadDemo() {
    const g = gen.current;
    await run("サンプルを読み込んでいます", async () => {
      const buf = await (await fetch("/demo/rosenka-sample.pdf")).arrayBuffer();
      if (g !== gen.current || !(await showSheet(buf, 1, g))) return;
      setSheetUrl("");
      setSheetNo(null);
      setPdfData(buf);
      setPageNo(1);
      setPairs([]);
      setFrame((f) => f ?? (property ? { center: property, scale: 1500, rotation: 0 } : null));
      setAlignOpen(true);
    });
  }

  // 3. に入ったら：保存した図があれば読み込み、なければコンパスくんに探してもらう
  useEffect(() => {
    if (step !== 3 || route !== "rosenka" || sheet || busy) return;
    if (land?.rosenkaSheet?.url) void loadFromUrl(land.rosenkaSheet.url, true);
    else if (found?.sheets.length) void identify(found.sheets.map((s) => ({ no: s.no, pdfUrl: s.pdfUrl })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, route, found]);

  // ---------------------------------------------------------------- 4. 接している道路の路線価を読む

  /**
   * 接している道路の路線価をコンパスくんに読んでもらう。ふだんは、いまの条件でまだ読んでいない道路だけを読む。
   * force（本人が読み直しを頼んだ）なら、すべての道路を読み直し、欄も読み取った路線価にする。
   */
  async function readPrices(force = false) {
    if (!sheet) return;
    const g = gen.current;
    const list = frontages.map((f) => ({ f, key: keyOf(f), ctx: frontageContext(ctx, f) })).filter((x) => force || needsRead(readings, x.key, x.ctx));
    if (list.length === 0) return;
    await run("コンパスくんが路線価図を読んでいます", async () => {
      const results = await Promise.all(
        list.map(async ({ f, key, ctx: c }) => {
          const at = api.current?.toSheet(f.outside);
          if (!at || at[0] < 0 || at[0] > 1 || at[1] < 0 || at[1] > 1) return null;
          const fd = new FormData();
          fd.append("image", await cropAround(sheet, at, 640, 480), "crop.png");
          fd.append("target", "road");
          const res = await fetch("/api/rosenka/read", { method: "POST", body: fd });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "読み取れませんでした。");
          const r = json as ReadResult;
          return { key, ctx: c, candidates: r.candidates, symbol: r.districtSymbol };
        }),
      );
      // 読んでいる間に土地や場所が変わったら、この結果は使わない
      if (g !== gen.current) return;
      // 図の外だった道路は読んだことにしない（重なりを直したら、また読む）
      const got = results.filter((r): r is NonNullable<typeof r> => r !== null);
      setReadings((n) => mergeReadings(n, got, force));
      const d = districtFrom(got.find((r) => r.symbol)?.symbol ?? null);
      if (d && !touchedRef.current) setDistrict(d);
      if (got.length === 0) throw new Error("土地が路線価図の外にあります。3. に戻って、路線価図の重なりを確かめてください。");
    });
  }

  const readKey = frontages.map((f) => `${keyOf(f)}@${frontageContext(ctx, f)}`).join("|");
  useEffect(() => {
    if (step === 4 && route === "rosenka" && sheet && !busy) void readPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, readKey, sheet]);

  // ---------------------------------------------------------------- 反映

  function applyRosenka() {
    if (!land || !shape || !evaluation) return;
    const prev = land.method.type === "rosenka" ? land.method : undefined;
    const areaSqm = area > 0 ? area : Math.round(shapeArea * 100) / 100;
    // 地積が入っていないときは、「地積」の確認待ちを消さない
    const rest = land.pending?.filter((x) => !/路線価|奥行|倍率/.test(x) && !(/地積/.test(x) && areaSqm > 0));
    patchLand({
      pending: rest?.length ? rest : undefined,
      areaSqm,
      // 正面の道路の記号（A〜G）で借地権割合が決まるときは、前に選んだ借地権割合は使わない（記号のほうを使う）
      ...(leaseLetterOf(evaluation.front.notation) ? { leaseRatio: undefined } : {}),
      method: {
        type: "rosenka",
        routePrice: evaluation.front.price,
        depthCorrection: evaluation.front.depthRate,
        otherCorrection: prev?.otherCorrection,
        district,
        roads: roadInputs,
        shape,
        edgeOn: edgeOn.length === shape.length ? edgeOn : undefined,
      },
      rosenkaSheet: { url: sheetUrl || undefined, page: pdfData ? pageNo : undefined, points: pairs, frame: frame ?? undefined, notation: evaluation.front.notation },
    });
    router.push(`/case/assets?asset=${land.id}&applied=1`);
  }

  // ---------------------------------------------------------------- 地図のクリック

  function onMapClick(ll: LatLng) {
    if (step === 1) void setPropertyAt(ll);
    else if (step === 2 && kozuMode === "mapPoint" && kozuPending && kozu) {
      setKozu({ ...kozu, pairs: [...kozu.pairs, { img: kozuPending, latlng: ll }] });
      setKozuPending(null);
      setKozuMode("idle");
    } else if (step === 3 && pointMode === "mapPoint" && pending) {
      setPairs((p) => [...p, { img: pending, latlng: ll }]);
      setPending(null);
      setPointMode("idle");
    }
  }

  if (!loaded) return <p className="text-stone-500">読み込み中…</p>;
  if (!land)
    return (
      <Note tone="info">
        土地がまだ登録されていません。<Link href="/case/assets" className="underline">財産の入力</Link>で「土地」を追加してから開いてください。
      </Note>
    );

  const steps = route === "ratio" ? [{ t: "土地の場所", I: MapPin }, { t: "評価倍率表", I: Table2 }, { t: "評価額", I: Calculator }] : [{ t: "土地の場所", I: MapPin }, { t: "土地の形", I: Shapes }, { t: "路線価図", I: MapIcon }, { t: "道路と路線価", I: RouteIcon }];
  // 倍率地域の 3. は、倍率が決まってから（2. の間は表で確かめた・入れた倍率、1. では保存してある倍率）
  const savedRatio = land.method.type === "multiplier" && land.method.multiplier > 0;
  const canGo = (n: number) =>
    n === 1 ||
    (!!property && !!route && (route === "ratio" ? n === 2 || (n === 3 && (step >= 2 ? ratioReady : savedRatio)) : n === 2 ? !!shape : n === 3 ? !!shape : !!sheet && !!shape));
  const overlayOn = route === "rosenka" && step >= 3 && showOverlay;
  const wide = route === "ratio" && step >= 2;

  return (
    <div className="space-y-3">
      {/* 上：土地の選択・ステップ */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white p-2 shadow-sm">
        {/* 読み込み・読み取りの途中は、土地を切り替えられないようにする */}
        <fieldset className="w-full min-w-0 sm:w-56" disabled={!!busy || finding}>
          <Select value={assetId} onChange={setAssetId} options={lands.map((l) => ({ value: l.id, label: `${l.label || "（名称未入力）"}　${l.location}` }))} />
        </fieldset>
        <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-1" aria-label="手順">
          {steps.map((s, i) => {
            const n = i + 1;
            const on = step === n;
            const done = step > n;
            return (
              <li key={s.t} className="flex items-center gap-1">
                {i > 0 && <span className="text-stone-300">—</span>}
                <button
                  type="button"
                  disabled={!canGo(n)}
                  onClick={() => setStep(n)}
                  aria-current={on ? "step" : undefined}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-sm ${on ? "bg-teal-700 font-semibold text-white" : done ? "bg-teal-50 text-teal-900" : "text-stone-500"} disabled:opacity-50`}
                >
                  {done ? <CheckIcon className="h-4 w-4" aria-hidden /> : <s.I className="h-4 w-4" aria-hidden />}
                  {n}.<span className={on ? "" : "hidden sm:inline"}> {s.t}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <Link href="/case/assets" className="rounded-lg px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50">
          ← 財産の入力へ
        </Link>
      </div>

      <div ref={wrapRef} className="relative isolate scroll-mt-20">
        <MapView
          className="h-[60vh] min-h-[360px] w-full rounded-xl border border-stone-300 lg:h-[calc(100vh-12rem)] lg:min-h-[560px]"
          center={center}
          property={property}
          pairs={effectivePairs}
          pins={step === 3 ? pairs : []}
          frame={step === 3 && alignOpen && frame ? frameCorners(frame, paper) : null}
          onFrameMove={(c) => setFrame((f) => (f ? { ...f, center: c } : f))}
          pendingImg={step === 3 && pointMode === "mapPoint" ? pending : step === 2 && kozuMode === "mapPoint" ? kozuPending : null}
          pendingLabel={step === 2 ? "公図" : "路線価図"}
          sheet={sheet}
          opacity={opacity}
          showOverlay={overlayOn}
          onMapClick={onMapClick}
          onReady={(a) => (api.current = a)}
          roads={showRoads && route !== "ratio" ? (roads ?? []).map((r) => r.line) : null}
          shape={
            route === "rosenka" && step >= 2 && shape
              ? { points: shape, editable: step === 2, edgeOn: step === 4 ? edgeOn : undefined, labels: step === 4 ? edgeOn.map((on) => `${on ? "道路に接している" : "道路に接していない"}辺（クリックで切り替え）`) : undefined }
              : null
          }
          onShapeChange={setShape}
          onShapeEdgeToggle={step === 4 ? (i) => setEdgeOn((o) => o.map((x, j) => (j === i ? !x : x))) : undefined}
          kozu={kozu && route === "rosenka" && step <= 2 ? kozu : null}
          kozuPins={step === 2 && kozu ? kozu.pairs : []}
        />

        {/* 地図の上：案内・状態 */}
        <div className={`pointer-events-none absolute left-1/2 top-3 z-[1000] w-[min(36rem,80%)] -translate-x-1/2 space-y-2 ${wide ? "lg:left-[calc((100%-41rem)/2)] lg:w-[min(30rem,40%)]" : "lg:left-[calc((100%-26rem)/2)]"}`}>
          {step === 1 && !property && <p className="rounded-lg bg-amber-50/95 px-3 py-2 text-center text-sm font-semibold text-amber-950 shadow">{notice ?? "地図で、評価する土地をクリックしてください。"}</p>}
          {(busy || finding) && <p className="rounded-lg bg-white/95 px-3 py-2 text-center text-sm text-teal-900 shadow">{busy ?? "この場所の路線価図を探しています"}…</p>}
          {error && <p className="pointer-events-auto rounded-lg bg-rose-50/95 px-3 py-2 text-sm text-rose-900 shadow">{error}</p>}
        </div>

        {/* 右：いまの手順 */}
        <aside
          ref={asideRef}
          className={`mt-3 rounded-xl bg-white p-4 shadow-xl ring-1 ring-stone-200 lg:absolute lg:bottom-3 lg:right-3 lg:top-3 lg:z-[1000] lg:mt-0 lg:overflow-y-auto lg:bg-white/97 ${wide ? "lg:w-[min(40rem,calc(100%-1.5rem))]" : "lg:w-[25rem]"}`}
        >
          <p className="mb-3 text-xs text-stone-500">
            {land.label || "（名称未入力）"}　{land.location}
            {land.areaSqm > 0 ? `　地積 ${land.areaSqm}㎡` : ""}
          </p>

          {step === 1 && (
            <div className="space-y-3">
              <h2 className="font-bold text-stone-800">1. 土地の場所を選んでください</h2>
              <p className="text-sm text-stone-600">地図で評価する土地をクリックします。住所で探すこともできます。</p>
              <div className="relative flex gap-2">
                <TextInput value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder={land.location || "例：福岡市博多区博多駅前4丁目"} />
                <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={search} disabled={!query.trim()}>
                  検索
                </Button>
                {hits.length > 1 && (
                  <ul className="absolute left-0 top-full z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-stone-200 bg-white text-sm shadow-lg">
                    {hits.map((h) => (
                      <li key={`${h.lat},${h.lng},${h.title}`}>
                        <button
                          type="button"
                          className="w-full px-3 py-1.5 text-left hover:bg-teal-50"
                          onClick={() => {
                            api.current?.flyTo([h.lat, h.lng], 18);
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
              {property && (
                <div className="space-y-2 rounded-lg bg-stone-50 p-3 text-sm">
                  <p className="font-semibold text-stone-800">選んだ場所{town ? `：${town}` : ""}</p>
                  {finding && <p className="text-stone-600">この場所の路線価図を探しています…</p>}
                  {!finding && route === "rosenka" && (
                    <p className="text-stone-700">
                      {found?.sheets.length ? `路線価図のある地域です（候補の図 ${found.sheets.map((s) => s.no).join("・")}）。` : "路線価図で評価します。"}
                    </p>
                  )}
                  {!finding && route === "ratio" && <p className="text-stone-700">{found?.message ?? "路線価図がない地域です。"}国税庁の評価倍率表で評価します（倍率地域）。</p>}
                  {!finding && route && (
                    <button type="button" className="text-xs text-teal-800 underline" onClick={() => setRoute(route === "rosenka" ? "ratio" : "rosenka")}>
                      {route === "rosenka" ? "倍率地域として評価する" : "路線価図で評価する"}
                    </button>
                  )}
                  <p className="text-xs text-stone-500">違う場所なら、地図をクリックし直してください。</p>
                </div>
              )}
              <Button className="w-full py-3" disabled={!property || !route || finding} onClick={() => setStep(2)}>
                {route === "ratio" ? "次へ：評価倍率表を確かめる" : "次へ：土地の形を囲む"}
              </Button>
            </div>
          )}

          {route === "rosenka" && step === 2 && (
            <div className="space-y-3">
              <h2 className="font-bold text-stone-800">2. 土地の形を囲んでください</h2>
              <p className="text-sm text-stone-600">赤い枠を土地の形に合わせます。角の丸をドラッグして動かし、辺の真ん中の「＋」で角を増やせます。角をダブルクリックすると消せます。真ん中の ✥ で全体を動かせます。</p>
              <p className="rounded-lg bg-stone-50 p-2 text-sm text-stone-700">
                囲んだ広さ 約 {fmt(Math.round(shapeArea))}㎡
                {land.areaSqm > 0 && `（登記の地積 ${land.areaSqm}㎡）`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (!property) return;
                    const lot = fitLot(property, roads ?? [], land.areaSqm);
                    setShape(rectangle(lot.center, lot.width, lot.depth, lot.rotation));
                  }}
                >
                  四角形に戻す
                </Button>
                <Check checked={showRoads} onChange={setShowRoads} label="道路の中心線（青い点線）" />
              </div>
              <details className="rounded-lg border border-stone-200 p-3" open={!!kozu}>
                <summary className="cursor-pointer text-sm font-semibold text-stone-800">公図・字図を重ねる（任意）</summary>
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-stone-600">法務局の公図や市町村の字図（PDF・画像）を重ねると、土地の形を正確に囲めます。公図と地図で同じ場所（道路の角など）を2か所以上選ぶと重なります。</p>
                  <label className="inline-block cursor-pointer rounded-lg border border-dashed border-stone-400 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">
                    {kozu ? "別の公図にする" : "公図・字図のファイルを選ぶ"}
                    <input
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        void run("公図を読み込んでいます", async () => {
                          const s = f.type === "application/pdf" ? await renderPdfPage(await f.arrayBuffer(), 1) : await loadImage(f);
                          setKozu({ sheet: s, pairs: [], opacity: 0.6, show: true });
                          setKozuMode("sheetPoint");
                        });
                      }}
                    />
                  </label>
                  {kozu && (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <Check checked={kozu.show} onChange={(v) => setKozu({ ...kozu, show: v })} label="重ねて表示" />
                        <label className="flex flex-1 items-center gap-2 text-sm text-stone-700">
                          透明度
                          <input type="range" min={0.1} max={1} step={0.05} value={kozu.opacity} onChange={(e) => setKozu({ ...kozu, opacity: Number(e.target.value) })} className="flex-1 accent-violet-700" />
                        </label>
                      </div>
                      <PointControls
                        sheet={kozu.sheet}
                        pairs={kozu.pairs}
                        setPairs={(p) => setKozu({ ...kozu, pairs: p })}
                        mode={kozuMode}
                        setMode={setKozuMode}
                        pending={kozuPending}
                        onSheetClick={(pt) => {
                          if (kozuMode !== "sheetPoint") return;
                          setKozuPending(pt);
                          setKozuMode("mapPoint");
                        }}
                        what="公図"
                      />
                    </>
                  )}
                </div>
              </details>
              <Button className="w-full py-3" disabled={!shape} onClick={() => setStep(3)}>
                次へ：路線価図を重ねる
              </Button>
            </div>
          )}

          {route === "rosenka" && step === 3 && (
            <div className="space-y-3">
              <h2 className="font-bold text-stone-800">3. 路線価図を重ねます</h2>
              {!sheet && !busy && (
                <div className="space-y-2">
                  {found?.sheets.length ? (
                    <Button onClick={() => identify(found.sheets.map((s) => ({ no: s.no, pdfUrl: s.pdfUrl })))}>コンパスくんに路線価図を探してもらう</Button>
                  ) : (
                    <Note tone="warn">この場所の路線価図を自動で見つけられませんでした。下の「図を読み込み直す」から国税庁の路線価図を開いてください。</Note>
                  )}
                </div>
              )}
              {sheet && (
                <>
                  {located?.no && located.no === sheetNo ? (
                    <div className="space-y-1 rounded-lg bg-teal-50 p-3 text-sm text-teal-950">
                      <p>
                        コンパスくんが図番号 <span className="font-mono font-bold">{located.no}</span> を選びました
                        {located.confidence === "low" ? "（自信は低めです）" : ""}。{located.reason}
                      </p>
                      {!located.frame && <p className="text-xs">重ねる位置までは分からなかったので、下の「手で合わせる」で合わせてください。</p>}
                    </div>
                  ) : located && !located.no ? (
                    <Note tone="warn">コンパスくんにもどの図か分かりませんでした。{located.reason} 下の図番号から選んでください。</Note>
                  ) : null}
                  <p className="text-sm font-semibold text-stone-800">地図の道路と、路線価図の道路が重なっていますか？</p>
                  <div className="flex flex-wrap items-center gap-3 rounded-lg bg-stone-50 p-2">
                    <Check checked={showOverlay} onChange={setShowOverlay} label="路線価図を重ねる" />
                    <label className="flex flex-1 items-center gap-2 text-sm text-stone-700">
                      透明度
                      <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="flex-1 accent-teal-700" />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setStep(4)}>はい、重なっています</Button>
                    <Button variant="secondary" onClick={() => setAlignOpen((v) => !v)}>
                      {alignOpen ? "手で合わせるのをやめる" : "少しずれている（手で合わせる）"}
                    </Button>
                  </div>
                </>
              )}
              <SheetLayout found={found} current={sheetNo} disabled={!!busy} onPick={(c) => identify([c])} />
              {alignOpen && sheet && (
                <div className="space-y-3 rounded-lg border border-stone-200 p-3">
                  <h3 className="text-sm font-bold text-stone-800">手で合わせる</h3>
                  <p className="text-xs text-stone-600">路線価図の道路が、地図の青い点線（道路の中心線）に重なるように、緑の枠の ✥ をドラッグし、縮尺と向きを合わせます。</p>
                  <FrameControls frame={frame} setFrame={setFrame} property={property} />
                  <PointControls
                    sheet={sheet}
                    pairs={pairs}
                    setPairs={setPairs}
                    mode={pointMode}
                    setMode={setPointMode}
                    pending={pending}
                    onSheetClick={(pt) => {
                      if (pointMode !== "sheetPoint") return;
                      setPending(pt);
                      setPointMode("mapPoint");
                    }}
                  />
                </div>
              )}
              <details className="rounded-lg border border-stone-200 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-stone-800">図を読み込み直す</summary>
                <div className="mt-2">
                  <SheetSource
                    sheetUrl={sheetUrl}
                    busy={!!busy}
                    onLoadUrl={(u) => loadFromUrl(u)}
                    onLoadFile={loadFromFile}
                    onDemo={loadDemo}
                    town={town}
                    indexUrl={found?.indexUrl}
                  />
                </div>
              </details>
              {!alignOpen && sheet && <SheetViewer sheet={sheet} pairs={[]} pending={null} clickable={false} onClick={() => undefined} alt="路線価図" height={220} />}
            </div>
          )}

          {route === "rosenka" && step === 4 && shape && (
            <div className="space-y-4">
              <h2 className="font-bold text-stone-800">4. 接している道路と路線価</h2>
              {frontages.length === 0 ? (
                <Note tone="warn">道路に接している辺がありません。地図の赤い枠の辺をクリックして、道路に接している辺を選んでください。</Note>
              ) : (
                <>
                  <p className="text-sm text-stone-700">コンパスくんが確認しました。この土地は、次の道路に接していますか？</p>
                  <ul className="space-y-2">
                    {frontages.map((f, i) => {
                      const k = keyOf(f);
                      const kc = frontageContext(ctx, f);
                      const note = noteFor(readings, k, kc);
                      const cs = candidatesFor(readings, k, kc);
                      const p = parseRouteNotation(note);
                      const line = evaluation?.lines.find((l) => l.edge === classes[i]);
                      return (
                        <li key={k} className="rounded-lg border border-stone-200 p-2">
                          <div className="flex items-center gap-2">
                            <span className="w-24 shrink-0 text-sm font-semibold text-stone-700">
                              {directionLabel(f.bearing)}の道路
                              {line && <span className="block text-[11px] font-normal text-rose-700">{{ front: "正面路線", side: "側方路線", back: "裏面路線" }[line.role]}</span>}
                            </span>
                            <TextInput
                              value={note}
                              disabled={!!busy}
                              onChange={(ev) => {
                                const v = ev.target.value;
                                setReadings((n) => typeNote(n, k, v));
                              }}
                              placeholder="例：420D"
                              aria-label={`${directionLabel(f.bearing)}の道路の路線価`}
                            />
                            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-stone-600">{p ? `${fmt(p.routePrice)}円/㎡` : "—"}</span>
                          </div>
                          {/* 候補が複数あるとき、または欄の路線価と読み取りが違うときは、候補から選べるようにする */}
                          {cs && (cs.length > 1 || (cs.length === 1 && cs[0].notation !== note)) && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {cs.map((c) => (
                                <button
                                  key={c.notation + c.where}
                                  type="button"
                                  title={c.where}
                                  disabled={!!busy}
                                  onClick={() => setReadings((n) => typeNote(n, k, c.notation))}
                                  className={`rounded-full border px-2 py-0.5 font-mono text-xs ${note === c.notation ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 hover:border-teal-500"} disabled:opacity-60`}
                                >
                                  {c.notation}
                                </button>
                              ))}
                            </div>
                          )}
                          <p className="mt-1 text-[11px] text-stone-500">
                            間口 {f.frontage}m・奥行 {depthFor(f, areaForDepth)}m
                            {classes[i] === null && "（同じ向きの道路がほかにもあるため、計算には入れていません）"}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                  {roadsAnswer !== "yes" && (
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setRoadsAnswer("yes")} disabled={!roadsComplete}>
                        はい、接しています
                      </Button>
                      <Button variant="secondary" onClick={() => setRoadsAnswer("no")}>
                        いいえ、直す
                      </Button>
                    </div>
                  )}
                  {!roadsComplete && <p className="text-xs text-amber-800">路線価が空の道路があります。路線価図を見て「420D」のように入れてください。</p>}
                  {roadsAnswer === "no" && (
                    <Note tone="info">
                      地図の赤い枠の辺をクリックすると、「道路に接している（太い赤線）」「接していない」を切り替えられます。路線価は上の欄で直すか、読み取り直してください。
                      <span className="mt-2 flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => readPrices(true)} disabled={!!busy}>
                          路線価を読み取り直す
                        </Button>
                        <Button onClick={() => setRoadsAnswer("yes")} disabled={!roadsComplete}>
                          直したので次へ
                        </Button>
                      </span>
                    </Note>
                  )}
                  {duplicated && <Note tone="warn">同じ向きに接する道路が2つあります。このような土地は評価の仕方が変わるため、税理士にご相談ください。</Note>}
                </>
              )}

              {roadsAnswer === "yes" && evaluation && (
                <section className="space-y-3">
                  <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-950">
                    正面路線は <span className="font-bold">{directionLabel(frontages[classes.indexOf(evaluation.front.edge)]?.bearing ?? 0)}の道路（{evaluation.front.notation ?? fmt(evaluation.front.price)}）</span>
                    です。路線価 × 奥行価格補正率 がいちばん高い道路を正面にします。
                  </p>
                  <Field label="地積（登記簿・課税明細書の面積）" hint={`地図で囲んだ広さは約 ${fmt(Math.round(shapeArea))}㎡ です。評価には登記簿の地積を使います。`}>
                    <NumInput value={area} onChange={setArea} unit="㎡" />
                  </Field>
                  <Field label="地区区分" hint="路線価を囲む記号の形で決まります（記号がなければ普通住宅地区）">
                    <Select
                      value={district}
                      onChange={(v) => {
                        setDistrict(v as District);
                        setDistrictTouched(true);
                      }}
                      options={DISTRICTS.map((d) => ({ value: d, label: d }))}
                    />
                  </Field>
                  <div className="space-y-1 rounded-lg bg-teal-50 p-3 text-sm text-teal-950">
                    {evaluation.steps.map((x, i) => (
                      <p key={`${i}:${x}`} className="text-xs">
                        {x}
                      </p>
                    ))}
                    <p className="pt-1 text-base font-bold">1㎡あたり {fmt(evaluation.perSqm)}円</p>
                    {area > 0 && (
                      <p className="font-semibold">
                        × {area}㎡ ＝ {fmt(Math.floor((evaluation.perSqm * Math.round(area * 100)) / 100))}円
                      </p>
                    )}
                  </div>
                  <Note tone="info">
                    間口が狭い・奥行が長い土地の補正はしています。角地の加算率を使い、形がいびつ・がけ地などの減額はしていないため、高めに出ることがあります。下げられるかは税理士に確認できます。
                    <span className="mt-2 block">
                      <ConsultLink topic="土地の評価" />
                    </span>
                  </Note>
                  <Button onClick={applyRosenka} disabled={!(area > 0) || !roadsComplete} className="w-full py-3">
                    評価完了：財産の入力へ戻る
                  </Button>
                </section>
              )}
            </div>
          )}

          {route === "ratio" && step >= 2 && property && (
            <RatioPanel
              step={step}
              setStep={setStep}
              land={land}
              property={property}
              cache={pdfCache.current}
              ratioUrl={found?.ratioUrl}
              onReady={setRatioReady}
              onUseRosenka={() => {
                setRoute("rosenka");
                setStep(2);
              }}
              onApply={(method, areaSqm, lease) => {
                // 地積が入っていないときは、「地積」の確認待ちを消さない
                const rest = land.pending?.filter((x) => !/路線価|奥行|倍率|固定資産税評価額/.test(x) && !(/地積/.test(x) && areaSqm > 0));
                // 評価倍率表の行を確かめたときは、その行の借地権割合を使う（読めない行なら空にして、土地の画面で選んでもらう）
                patchLand({ method, areaSqm, pending: rest?.length ? rest : undefined, ...(lease ? { leaseRatio: lease.ratio } : {}) });
                router.push(`/case/assets?asset=${land.id}&applied=1`);
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

/** 候補の路線価図を、となり合う位置関係のとおりに並べて選べるようにする */
function SheetLayout({ found, current, disabled, onPick }: { found: FindResult | null; current: string | null; disabled: boolean; onPick: (c: Candidate) => void }) {
  if (!found || found.sheets.length === 0) return null;
  const layout: SheetLayoutItem[] = found.layout?.length ? found.layout : found.sheets.map((s, i) => ({ no: s.no, col: i, row: 0, candidate: true, pdfUrl: s.pdfUrl }));
  const cols = layout.map((l) => l.col);
  const rows = layout.map((l) => l.row);
  const c0 = Math.min(...cols);
  const r0 = Math.min(...rows);
  const nc = Math.max(...cols) - c0 + 1;
  return (
    <div className="space-y-1">
      <p className="text-xs text-stone-600">
        {found.town ? `「${found.town}」` : "この場所"}が載っている路線価図（濃い枠）と、そのとなりの図です。上が北です。違う図ならクリックして選び直せます。{layout.some((l) => l.separate) && "点線で囲んだ図は、ほかの図とつながっていない候補です。"}
      </p>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${nc}, minmax(0, 3.5rem))` }}>
        {layout.map((l) => (
          <button
            key={l.no}
            type="button"
            disabled={disabled}
            onClick={() => onPick({ no: l.no, pdfUrl: l.pdfUrl })}
            style={{ gridColumn: l.col - c0 + 1, gridRow: l.row - r0 + 1 }}
            className={`rounded border px-1 py-2 font-mono text-[11px] ${l.no === current ? "border-teal-700 bg-teal-700 text-white" : l.candidate ? "border-teal-600 bg-white font-bold text-teal-900" : "border-stone-200 bg-stone-50 text-stone-500"} ${l.separate ? "border-dashed" : ""} hover:border-teal-500 disabled:opacity-60`}
          >
            {l.no}
          </button>
        ))}
      </div>
    </div>
  );
}
