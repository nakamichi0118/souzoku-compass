"use client";

/**
 * 国土地理院の地図（地理院タイル）に、位置合わせした路線価図・公図の画像を半透明で重ねる。
 * 画像の重ね合わせは、基準点から求めた変換行列を CSS の transform に設定して行う。
 * 評価する土地の形（多角形）も重ねて表示し、角の印をドラッグして形を直せる。
 */
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState } from "react";
import { type Affine, type ControlPair, solveTransform } from "@/domain/geo/georef";
import { fromTouch } from "./wizard";

type LL = [number, number];

export interface Sheet {
  src: string;
  width: number;
  height: number;
  /** 用紙の大きさ（PDFのページサイズから。画像の場合はなし） */
  paper?: { widthMm: number; heightMm: number };
}
export interface GeoPair {
  img: [number, number]; // 画像の幅・高さを1とした座標
  latlng: [number, number];
}

/** 地図に描く土地の形（多角形） */
export interface MapShape {
  /** 角の位置（順番に結ぶ。最後の角と最初の角も結ぶ） */
  points: [number, number][];
  /** true なら角・辺の中点・中心の印をドラッグして形を直せる */
  editable: boolean;
  /** i 番目の辺（i 番目の角 → 次の角）が道路に面しているか */
  edgeOn?: boolean[];
  /** 辺にマウスを乗せたときの説明 */
  labels?: string[];
}

/** 公図（字図）の重ね表示 */
export interface KozuOverlay {
  sheet: Sheet;
  pairs: GeoPair[];
  opacity: number;
  show: boolean;
}

interface Props {
  center: [number, number];
  property?: [number, number];
  /** 重ね表示に使う基準点（手動の基準点、なければ枠の四隅） */
  pairs: GeoPair[];
  /** 地図に番号付きで表示する手動の基準点 */
  pins: GeoPair[];
  /** 路線価図1枚分の枠（四隅） */
  frame?: [number, number][] | null;
  onFrameMove?: (center: [number, number]) => void;
  pendingImg?: [number, number] | null;
  /** 基準点を選んでいる図の名前（地図の上の案内に出す） */
  pendingLabel?: string;
  sheet?: Sheet | null;
  opacity: number;
  showOverlay: boolean;
  onMapClick?: (latlng: [number, number]) => void;
  /** 親から地図を操作するための関数を受け取る */
  onReady?: (api: MapApi) => void;
  /** 地図の大きさ（既定は高さ520px） */
  className?: string;
  /** 評価する土地の枠（四隅）と、各辺が道路に面しているか */
  lot?: { corners: [number, number][]; roadEdges: boolean[]; labels?: string[] } | null;
  onLotMove?: (center: [number, number]) => void;
  /** 枠の辺をクリックして「道路に面している」を切り替える */
  onEdgeToggle?: (edge: 0 | 1 | 2 | 3) => void;
  /** 道路の中心線（国土地理院） */
  roads?: [number, number][][] | null;
  /** 評価する土地の形（多角形） */
  shape?: MapShape | null;
  /** 形を直し終えたとき（ドラッグを離したとき）に、新しい角の並びを受け取る */
  onShapeChange?: (points: [number, number][]) => void;
  /** 形の辺をクリックしたとき。渡したときだけ辺がクリックできる */
  onShapeEdgeToggle?: (edge: number) => void;
  /** 公図（字図）の重ね表示（基準点2組以上で表示） */
  kozu?: KozuOverlay | null;
  /** 地図に番号付きで表示する公図の基準点 */
  kozuPins?: GeoPair[];
}

export interface MapApi {
  flyTo(latlng: [number, number], zoom?: number): void;
  /** 現在の地図表示での「画像（正規化座標）→ 地図」変換の逆を使い、地図上の点を画像上の正規化座標に直す */
  toSheet(latlng: [number, number]): [number, number] | null;
  /** toSheet と同じことを、公図について行う */
  toKozu(latlng: [number, number]): [number, number] | null;
  /** いまの地図の中心とズーム */
  getView(): { center: [number, number]; zoom: number };
  /** 点がすべて見えるように地図を動かす（right は右側に重なっている案内の幅） */
  fitPoints(points: [number, number][], opts?: { maxZoom?: number; right?: number }): void;
}

const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>';
/** 土地の形を描く層（道路の線・重ねた画像より上、印より下） */
const SHAPE_PANE = "shapePane";

export function transformFor(map: Leaflet.Map, sheet: Sheet, pairs: GeoPair[]): Affine | null {
  const cp: ControlPair[] = pairs.map((p) => {
    const lp = map.latLngToLayerPoint(p.latlng);
    return { src: [p.img[0] * sheet.width, p.img[1] * sheet.height], dst: [lp.x, lp.y] };
  });
  try {
    return solveTransform(cp);
  } catch {
    return null;
  }
}

/** 地図上の点を、重ねた画像の上の位置（幅・高さを1とした座標）に直す */
function toImage(map: Leaflet.Map, sheet: Sheet | null | undefined, pairs: GeoPair[], ll: LL): LL | null {
  if (!sheet) return null;
  const m = transformFor(map, sheet, pairs);
  if (!m) return null;
  const lp = map.latLngToLayerPoint(ll);
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  const x = (d * (lp.x - e) - c * (lp.y - f)) / det;
  const y = (-b * (lp.x - e) + a * (lp.y - f)) / det;
  return [x / sheet.width, y / sheet.height];
}

/** 位置合わせした画像を地図に重ねる。bottom なら他の重ね表示より下に置く。片付け用の関数を返す */
function overlayImage(map: Leaflet.Map, sheet: Sheet, pairs: GeoPair[], opacity: number, bottom = false) {
  const img = document.createElement("img");
  img.src = sheet.src;
  img.alt = "";
  Object.assign(img.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: `${sheet.width}px`,
    height: `${sheet.height}px`,
    maxWidth: "none",
    transformOrigin: "0 0",
    pointerEvents: "none",
    opacity: String(opacity),
    mixBlendMode: "multiply",
  });
  const pane = map.getPanes().overlayPane;
  if (bottom) pane.insertBefore(img, pane.firstChild);
  else pane.appendChild(img);
  const update = () => {
    const m = transformFor(map, sheet, pairs);
    img.style.display = m ? "" : "none";
    if (m) img.style.transform = `matrix(${m.join(",")})`;
  };
  update();
  map.on("zoomend viewreset moveend", update);
  return () => {
    map.off("zoomend viewreset moveend", update);
    img.remove();
  };
}

/** 番号付きの基準点を描く */
function drawPins(L: typeof Leaflet, g: Leaflet.LayerGroup, pins: GeoPair[], cls: string) {
  g.clearLayers();
  pins.forEach((p, i) =>
    L.marker(p.latlng, {
      icon: L.divIcon({ className: "", html: `<div class="${cls}">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(g),
  );
}

const centroid = (q: LL[]): LL => [q.reduce((a, p) => a + p[0], 0) / q.length, q.reduce((a, p) => a + p[1], 0) / q.length];
const midpoint = (a: LL, b: LL): LL => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const toLL = (ll: Leaflet.LatLng): LL => [ll.lat, ll.lng];

export default function MapView({ center, property, pairs, pins, frame, onFrameMove, pendingImg, pendingLabel = "路線価図", sheet, opacity, showOverlay, onMapClick, onReady, className, lot, onLotMove, onEdgeToggle, roads, shape, onShapeChange, onShapeEdgeToggle, kozu, kozuPins }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const layers = useRef<{ property?: Leaflet.CircleMarker; pairs?: Leaflet.LayerGroup; kozuPins?: Leaflet.LayerGroup; frame?: Leaflet.LayerGroup; lot?: Leaflet.LayerGroup; roads?: Leaflet.LayerGroup; shape?: Leaflet.LayerGroup }>({});
  const lotMoveRef = useRef(onLotMove);
  lotMoveRef.current = onLotMove;
  const edgeRef = useRef(onEdgeToggle);
  edgeRef.current = onEdgeToggle;
  const frameMoveRef = useRef(onFrameMove);
  frameMoveRef.current = onFrameMove;
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const shapeRef = useRef(shape);
  shapeRef.current = shape;
  const shapeChangeRef = useRef(onShapeChange);
  shapeChangeRef.current = onShapeChange;
  const shapeEdgeRef = useRef(onShapeEdgeToggle);
  shapeEdgeRef.current = onShapeEdgeToggle;
  const [ready, setReady] = useState(false);
  /** 最後に角の印をドラッグした時刻（ドラッグの直後の長押しで角を消さないため） */
  const draggedAt = useRef(0);
  const state = useRef({ sheet, pairs, kozu });
  state.current = { sheet, pairs, kozu };

  // 地図の初期化（1回だけ）
  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !el.current) return;
      LRef.current = L;
      const map = L.map(el.current, { zoomAnimation: false, zoomControl: true, maxZoom: 20 }).setView(center, 17);
      const std = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", { attribution: GSI_ATTR, maxNativeZoom: 18, maxZoom: 20 });
      const photo = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", { attribution: GSI_ATTR, maxNativeZoom: 18, maxZoom: 20 });
      std.addTo(map);
      // パソコンでは右側に案内が重なるので、地図・航空写真の切り替えと出典の表示は左側に置く
      L.control.layers({ 地図: std, 航空写真: photo }, {}, { position: "topleft" }).addTo(map);
      map.attributionControl.setPosition("bottomleft");
      map.on("click", (e: Leaflet.LeafletMouseEvent) => clickRef.current?.([e.latlng.lat, e.latlng.lng]));
      // 土地の形の層。層そのものはクリックを通し、辺の線だけが受け取る（下の層の線もクリックできるように）
      const shapePane = map.createPane(SHAPE_PANE);
      shapePane.style.zIndex = "450";
      shapePane.style.pointerEvents = "none";
      layers.current.pairs = L.layerGroup().addTo(map);
      layers.current.kozuPins = L.layerGroup().addTo(map);
      layers.current.frame = L.layerGroup().addTo(map);
      layers.current.roads = L.layerGroup().addTo(map);
      layers.current.lot = L.layerGroup().addTo(map);
      layers.current.shape = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
      onReady?.({
        flyTo: (ll, z) => map.setView(ll, z ?? Math.max(map.getZoom(), 17)),
        toSheet: (ll) => toImage(map, state.current.sheet, state.current.pairs, ll),
        toKozu: (ll) => {
          const k = state.current.kozu;
          return k ? toImage(map, k.sheet, k.pairs, ll) : null;
        },
        getView: () => ({ center: toLL(map.getCenter()), zoom: map.getZoom() }),
        fitPoints: (pts, o) => {
          if (pts.length === 0) return;
          map.fitBounds(L.latLngBounds(pts), { maxZoom: o?.maxZoom ?? 20, paddingTopLeft: [40, 70], paddingBottomRight: [40 + (o?.right ?? 0), 40] });
        },
      });
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 土地の位置
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    layers.current.property?.remove();
    layers.current.property = property
      ? L.circleMarker(property, { radius: 9, color: "#be123c", weight: 3, fillOpacity: 0.25 }).bindTooltip("評価する土地").addTo(map)
      : undefined;
  }, [property, ready]);

  // 基準点（路線価図・公図）
  useEffect(() => {
    const L = LRef.current;
    const g = layers.current.pairs;
    if (L && g) drawPins(L, g, pins, "gcp-pin");
  }, [pins, ready]);
  useEffect(() => {
    const L = LRef.current;
    const g = layers.current.kozuPins;
    if (L && g) drawPins(L, g, kozuPins ?? [], "gcp-pin kozu-pin");
  }, [kozuPins, ready]);

  // 路線価図1枚分の枠（中心の印をドラッグして移動できる）
  useEffect(() => {
    const L = LRef.current;
    const g = layers.current.frame;
    if (!L || !g) return;
    g.clearLayers();
    if (!frame) return;
    L.polygon(frame, { color: "#0f766e", weight: 2, dashArray: "6 4", fillOpacity: 0.04, interactive: false }).addTo(g);
    const c: [number, number] = [frame.reduce((a, p) => a + p[0], 0) / 4, frame.reduce((a, p) => a + p[1], 0) / 4];
    const handle = L.marker(c, {
      draggable: true,
      icon: L.divIcon({ className: "", html: '<div class="frame-handle" title="ドラッグして枠を移動">✥</div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).addTo(g);
    handle.on("dragend", () => {
      const ll = handle.getLatLng();
      frameMoveRef.current?.([ll.lat, ll.lng]);
    });
  }, [frame, ready]);

  // 道路の中心線
  useEffect(() => {
    const L = LRef.current;
    const g = layers.current.roads;
    if (!L || !g) return;
    g.clearLayers();
    for (const r of roads ?? []) L.polyline(r, { color: "#2563eb", weight: 2, opacity: 0.7, dashArray: "2 4", interactive: false }).addTo(g);
  }, [roads, ready]);

  // 評価する土地の枠：道路に面している辺は太い赤線。辺をクリックで切り替え、中心の印をドラッグして移動
  useEffect(() => {
    const L = LRef.current;
    const g = layers.current.lot;
    if (!L || !g) return;
    g.clearLayers();
    if (!lot) return;
    L.polygon(lot.corners, { color: "#be123c", weight: 1, fillColor: "#fb7185", fillOpacity: 0.18, interactive: false }).addTo(g);
    lot.corners.forEach((a, i) => {
      const b = lot.corners[(i + 1) % 4];
      const on = lot.roadEdges[i];
      const line = L.polyline([a, b], { color: on ? "#be123c" : "#78716c", weight: on ? 6 : 3, dashArray: on ? undefined : "4 4", opacity: 0.95 }).addTo(g);
      // クリックしやすいよう、見えない太い線を重ねる
      const hit = L.polyline([a, b], { color: "#000", weight: 18, opacity: 0 }).addTo(g);
      const label = lot.labels?.[i];
      if (label) hit.bindTooltip(label, { sticky: true });
      const toggle = (e: Leaflet.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        edgeRef.current?.(i as 0 | 1 | 2 | 3);
      };
      hit.on("click", toggle);
      line.on("click", toggle);
    });
    const c: [number, number] = [lot.corners.reduce((a, p) => a + p[0], 0) / 4, lot.corners.reduce((a, p) => a + p[1], 0) / 4];
    const handle = L.marker(c, {
      draggable: true,
      icon: L.divIcon({ className: "", html: '<div class="frame-handle lot-handle" title="ドラッグして土地の枠を移動">✥</div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
    }).addTo(g);
    handle.on("dragend", () => {
      const ll = handle.getLatLng();
      lotMoveRef.current?.([ll.lat, ll.lng]);
    });
  }, [lot, ready]);

  // 土地の形（多角形）：道路に面している辺は太い赤線。
  // 直せるときは、角の印をドラッグ（ダブルクリック・右クリックで角を消す。指の長押しでは消さない）、辺の中ほどの「＋」で角を増やす、中心の印で形ごと動かす。
  // ドラッグ中は見た目だけを動かし、離したときに親へ新しい形を知らせる。
  const shapeKey = shape ? JSON.stringify(shape) : "";
  const canToggle = !!onShapeEdgeToggle;
  useEffect(() => {
    const L = LRef.current;
    const g = layers.current.shape;
    const s = shapeRef.current;
    if (!L || !g) return;
    g.clearLayers();
    if (!s || s.points.length === 0) return;
    const pts: LL[] = s.points.map((p) => [p[0], p[1]]);
    const n = pts.length;
    const edgeCount = n >= 3 ? n : n - 1;
    const next = (i: number) => (i + 1) % n;
    const pane = SHAPE_PANE;
    const change = (q: LL[]) => shapeChangeRef.current?.(q);
    // 印のクリックで地図のクリック（土地を選ぶなど）が起きないようにする
    const swallow = (e: Leaflet.LeafletMouseEvent) => L.DomEvent.stopPropagation(e);
    const icon = (cls: string, size: number, title: string, text = "") =>
      L.divIcon({ className: "", html: `<div class="${cls}" title="${title}">${text}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

    const poly = L.polygon(pts, { pane, color: "#be123c", weight: 1, fillColor: "#fb7185", fillOpacity: 0.18, interactive: false }).addTo(g);
    const edges: { line: Leaflet.Polyline; hit?: Leaflet.Polyline }[] = Array.from({ length: edgeCount }, (_, i) => {
      const ab = [pts[i], pts[next(i)]];
      const on = !!s.edgeOn?.[i];
      const line = L.polyline(ab, { pane, color: on ? "#be123c" : "#78716c", weight: on ? 6 : 2, dashArray: on ? undefined : "4 4", opacity: 0.95, interactive: false }).addTo(g);
      if (!canToggle) return { line };
      // クリックしやすいよう、見えない太い線を重ねる
      const hit = L.polyline(ab, { pane, color: "#000", weight: 18, opacity: 0 }).addTo(g);
      const label = s.labels?.[i];
      if (label) hit.bindTooltip(label, { sticky: true });
      hit.on("click", (e: Leaflet.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        shapeEdgeRef.current?.(i);
      });
      return { line, hit };
    });
    if (!s.editable) return;

    const verts: Leaflet.Marker[] = [];
    const mids: Leaflet.Marker[] = [];
    let mover: Leaflet.Marker | undefined;
    // ドラッグ中の見た目だけを形 q に合わせる（except はドラッグしている印）
    const place = (q: LL[], except?: Leaflet.Marker) => {
      poly.setLatLngs(q);
      edges.forEach(({ line, hit }, i) => {
        const ab = [q[i], q[next(i)]];
        line.setLatLngs(ab);
        hit?.setLatLngs(ab);
      });
      verts.forEach((v, i) => v !== except && v.setLatLng(q[i]));
      mids.forEach((h, i) => h.setLatLng(midpoint(q[i], q[next(i)])));
      if (mover && mover !== except) mover.setLatLng(centroid(q));
    };

    // 角の印
    pts.forEach((p, i) => {
      const title = n > 3 ? "ドラッグして角を動かす（ダブルクリック・右クリックで角を消す）" : "ドラッグして角を動かす";
      const v = L.marker(p, { draggable: true, zIndexOffset: 1000, icon: icon("shape-vertex", 26, title) }).addTo(g);
      const moved = () => pts.map((q, j) => (j === i ? toLL(v.getLatLng()) : q));
      const remove = () => {
        if (n > 3) change(pts.filter((_, j) => j !== i));
      };
      v.on("click", swallow);
      v.on("dragstart", () => (draggedAt.current = Date.now()));
      v.on("drag", () => {
        draggedAt.current = Date.now();
        place(moved(), v);
      });
      v.on("dragend", () => {
        draggedAt.current = Date.now();
        change(moved());
      });
      // ダブルクリック（スマートフォンではダブルタップ）で角を消す
      v.on("dblclick", (e: Leaflet.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        remove();
      });
      // 右クリックでも消す。指の長押しやゆっくりしたドラッグ（その間やすぐ後）に出る右クリックの代わりの操作では消さない
      v.on("contextmenu", (e: Leaflet.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        const dragging = (v.dragging as (Leaflet.Handler & { moved?: () => boolean }) | undefined)?.moved?.();
        if (fromTouch(e.originalEvent) || dragging || Date.now() - draggedAt.current < 800) return;
        remove();
      });
      verts.push(v);
    });

    // 辺の中ほどの「＋」：クリックかドラッグで、そこに角を増やす
    for (let i = 0; i < edgeCount; i++) {
      const a = pts[i];
      const b = pts[next(i)];
      const withPoint = (c: LL) => [...pts.slice(0, i + 1), c, ...pts.slice(i + 1)];
      const h = L.marker(midpoint(a, b), { draggable: true, zIndexOffset: 500, icon: icon("shape-mid", 24, "クリックかドラッグで角を増やす") }).addTo(g);
      h.on("click", (e: Leaflet.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        change(withPoint(midpoint(a, b)));
      });
      h.on("drag", () => {
        const c = toLL(h.getLatLng());
        poly.setLatLngs(withPoint(c));
        edges[i].line.setLatLngs([a, c, b]);
      });
      h.on("dragend", () => change(withPoint(toLL(h.getLatLng()))));
      mids.push(h);
    }

    // 中心の印：形を保ったまま全体を動かす（狭い範囲なので緯度・経度のずれをそのまま足す）
    if (n >= 2) {
      const c0 = centroid(pts);
      const m = L.marker(c0, { draggable: true, zIndexOffset: 800, icon: icon("frame-handle lot-handle shape-move", 28, "ドラッグして土地の形ごと動かす", "✥") }).addTo(g);
      const moved = () => {
        const c = toLL(m.getLatLng());
        return pts.map(([lat, lng]): LL => [lat + c[0] - c0[0], lng + c[1] - c0[1]]);
      };
      m.on("click", swallow);
      m.on("drag", () => place(moved(), m));
      m.on("dragend", () => change(moved()));
      mover = m;
    }
  }, [shapeKey, canToggle, ready]);

  // 公図の重ね表示（路線価図より下に置く）
  const kozuSheet = kozu?.sheet;
  const kozuPairs = kozu ? JSON.stringify(kozu.pairs) : "[]";
  const kozuOn = !!kozu?.show;
  const kozuOpacity = kozu?.opacity ?? 1;
  useEffect(() => {
    const map = mapRef.current;
    const p = JSON.parse(kozuPairs) as GeoPair[];
    if (!map || !kozuSheet || !kozuOn || p.length < 2) return;
    return overlayImage(map, kozuSheet, p, kozuOpacity, true);
  }, [kozuSheet, kozuPairs, kozuOn, kozuOpacity, ready]);

  // 路線価図の重ね表示
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sheet || !showOverlay || pairs.length < 2) return;
    return overlayImage(map, sheet, pairs, opacity);
  }, [sheet, pairs, showOverlay, opacity, ready]);

  return (
    <div className="relative">
      <div ref={el} className={className ?? "h-[520px] w-full rounded-xl border border-stone-300"} aria-label="地図" />
      {pendingImg && (
        <p className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-amber-500 px-4 py-1 text-sm font-semibold text-white shadow">
          {pendingLabel}で選んだ点と同じ場所を、地図上でクリックしてください
        </p>
      )}
    </div>
  );
}
