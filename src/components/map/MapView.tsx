"use client";

/**
 * 国土地理院の地図（地理院タイル）に、位置合わせした路線価図の画像を半透明で重ねる。
 * 画像の重ね合わせは、基準点から求めた変換行列を CSS の transform に設定して行う。
 */
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";
import { type Affine, type ControlPair, solveTransform } from "@/domain/geo/georef";

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
  sheet?: Sheet | null;
  opacity: number;
  showOverlay: boolean;
  onMapClick?: (latlng: [number, number]) => void;
  /** 親から地図を操作するための関数を受け取る */
  onReady?: (api: MapApi) => void;
}

export interface MapApi {
  flyTo(latlng: [number, number], zoom?: number): void;
  /** 現在の地図表示での「画像（正規化座標）→ 地図」変換の逆を使い、地図上の点を画像上の正規化座標に直す */
  toSheet(latlng: [number, number]): [number, number] | null;
}

const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>';

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

export default function MapView({ center, property, pairs, pins, frame, onFrameMove, pendingImg, sheet, opacity, showOverlay, onMapClick, onReady }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const layers = useRef<{ property?: Leaflet.CircleMarker; pairs?: Leaflet.LayerGroup; frame?: Leaflet.LayerGroup; img?: HTMLImageElement }>({});
  const frameMoveRef = useRef(onFrameMove);
  frameMoveRef.current = onFrameMove;
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const state = useRef({ sheet, pairs });
  state.current = { sheet, pairs };

  // 地図の初期化（1回だけ）
  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !el.current) return;
      LRef.current = L;
      const map = L.map(el.current, { zoomAnimation: false, zoomControl: true }).setView(center, 17);
      const std = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", { attribution: GSI_ATTR, maxZoom: 18 });
      const photo = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", { attribution: GSI_ATTR, maxZoom: 18 });
      std.addTo(map);
      L.control.layers({ 地図: std, 航空写真: photo }, {}, { position: "topright" }).addTo(map);
      map.on("click", (e: Leaflet.LeafletMouseEvent) => clickRef.current?.([e.latlng.lat, e.latlng.lng]));
      layers.current.pairs = L.layerGroup().addTo(map);
      layers.current.frame = L.layerGroup().addTo(map);
      mapRef.current = map;
      onReady?.({
        flyTo: (ll, z) => map.setView(ll, z ?? Math.max(map.getZoom(), 17)),
        toSheet: (ll) => {
          const { sheet: s, pairs: p } = state.current;
          if (!s) return null;
          const m = transformFor(map, s, p);
          if (!m) return null;
          const lp = map.latLngToLayerPoint(ll);
          const [a, b, c, d, e, f] = m;
          const det = a * d - b * c;
          const x = (d * (lp.x - e) - c * (lp.y - f)) / det;
          const y = (-b * (lp.x - e) + a * (lp.y - f)) / det;
          return [x / s.width, y / s.height];
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
  }, [property]);

  // 基準点
  useEffect(() => {
    const L = LRef.current;
    const g = layers.current.pairs;
    if (!L || !g) return;
    g.clearLayers();
    pins.forEach((p, i) =>
      L.marker(p.latlng, {
        icon: L.divIcon({ className: "", html: `<div class="gcp-pin">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(g),
    );
  }, [pins]);

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
  }, [frame]);

  // 路線価図の重ね表示
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    layers.current.img?.remove();
    layers.current.img = undefined;
    if (!sheet || !showOverlay || pairs.length < 2) return;
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
    map.getPanes().overlayPane.appendChild(img);
    layers.current.img = img;
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
  }, [sheet, pairs, showOverlay, opacity]);

  return (
    <div className="relative">
      <div ref={el} className="h-[520px] w-full rounded-xl border border-stone-300" aria-label="地図" />
      {pendingImg && (
        <p className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-amber-500 px-4 py-1 text-sm font-semibold text-white shadow">
          路線価図で選んだ点と同じ場所を、地図上でクリックしてください
        </p>
      )}
    </div>
  );
}
