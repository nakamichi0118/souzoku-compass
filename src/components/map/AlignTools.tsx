"use client";

/**
 * 重ね合わせを手で直す道具：路線価図1枚分の枠（縮尺・向き・位置）、基準点、図の読み込み直し。
 * 自動で合わなかったときや、少しずれているときに使う。
 */
import { useState } from "react";
import { Button, TextInput } from "@/components/ui";
import type { Frame } from "@/domain/geo/frame";
import type { GeoPair, Sheet } from "./MapView";
import { FINE_MAX, FINE_MIN, SCALES, fineBase } from "./wizard";

export const DEFAULT_SCALE = 1500;

export type PointMode = "idle" | "sheetPoint" | "mapPoint";

/** 角度を -180〜180° に */
const normDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export function FrameControls({ frame, setFrame, property }: { frame: Frame | null; setFrame: (f: (old: Frame | null) => Frame | null) => void; property?: [number, number] }) {
  // 微調整の基準の縮尺。動かしている間に基準が変わって縮尺が飛ばないよう、選んだ縮尺のまま覚えておく
  const [picked, setPicked] = useState<number | null>(null);
  const base = frame ? fineBase(picked, frame.scale) : DEFAULT_SCALE;
  // 向きも同じく、90°ごとの基準から ±45° をつまみで動かす（図が横向き・逆さのときは90°ずつ回す）
  const [rotPicked, setRotPicked] = useState<number | null>(null);
  const rot = frame?.rotation ?? 0;
  const rotBase = rotPicked !== null && Math.abs(rot - rotPicked) <= 45 ? rotPicked : Math.round(rot / 90) * 90;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-stone-700">
        縮尺
        <select
          className="rounded border border-stone-300 px-2 py-1 text-base"
          value={base}
          onChange={(e) => {
            const sc = Number(e.target.value);
            setPicked(sc);
            setFrame((f) => (f ? { ...f, scale: sc } : f));
          }}
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
          min={FINE_MIN}
          max={FINE_MAX}
          step={0.005}
          value={frame ? frame.scale / base : 1}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPicked(base);
            setFrame((f) => (f ? { ...f, scale: Math.round(base * v) } : f));
          }}
          disabled={!frame}
          className="flex-1 accent-teal-700"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-stone-700">
        向き
        <input
          type="range"
          min={rotBase - 45}
          max={rotBase + 45}
          step={0.25}
          value={rot}
          onChange={(e) => {
            setRotPicked(rotBase);
            setFrame((f) => (f ? { ...f, rotation: Number(e.target.value) } : f));
          }}
          disabled={!frame}
          className="flex-1 accent-teal-700"
        />
        <span className="w-14 text-right tabular-nums">{normDeg(rot).toFixed(1)}°</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {[-90, 90].map((d) => (
          <Button
            key={d}
            variant="ghost"
            disabled={!frame}
            onClick={() => {
              setRotPicked(rotBase + d);
              setFrame((f) => (f ? { ...f, rotation: f.rotation + d } : f));
            }}
          >
            {d < 0 ? "左に90°回す" : "右に90°回す"}
          </Button>
        ))}
      </div>
      {property && (
        <Button variant="ghost" onClick={() => setFrame((f) => ({ scale: DEFAULT_SCALE, rotation: 0, ...f, center: property }))}>
          枠を土地の位置に戻す
        </Button>
      )}
    </div>
  );
}

/** 基準点：図の上と地図の上で同じ場所を順にクリックして組にする */
export function PointControls({
  sheet,
  pairs,
  setPairs,
  mode,
  setMode,
  pending,
  onSheetClick,
  what = "路線価図",
}: {
  sheet: Sheet | null;
  pairs: GeoPair[];
  setPairs: (p: GeoPair[]) => void;
  mode: PointMode;
  setMode: (m: PointMode) => void;
  pending: [number, number] | null;
  onSheetClick: (pt: [number, number]) => void;
  what?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-stone-600">
        {what}→地図の順に、同じ場所（交差点の角など）をクリック。離れた2か所以上で正確になります。
        {what === "路線価図" && pairs.length > 0 && "地図の番号の印はドラッグで直せます（図も一緒に動きます）。"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setMode(mode === "idle" ? "sheetPoint" : "idle")} disabled={!sheet} variant={mode === "idle" ? "secondary" : "primary"}>
          {mode === "idle" ? `基準点を追加（${pairs.length + 1}点目）` : "追加をやめる"}
        </Button>
        <Button variant="ghost" onClick={() => setPairs(pairs.slice(0, -1))} disabled={pairs.length === 0}>
          1つ戻す
        </Button>
        <Button variant="ghost" onClick={() => setPairs([])} disabled={pairs.length === 0}>
          すべて消す
        </Button>
      </div>
      {mode === "sheetPoint" && <p className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-950">下の{what}で、地図でも見つけやすい場所をクリックしてください。</p>}
      {mode === "mapPoint" && <p className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-950">地図で、いま選んだ場所と同じ地点をクリックしてください。</p>}
      {sheet && <SheetViewer sheet={sheet} pairs={pairs} pending={pending} clickable={mode === "sheetPoint"} onClick={onSheetClick} alt={what} />}
    </div>
  );
}

/** 図の読み込み直し：図番号・URL・ファイル */
export function SheetSource({
  sheetUrl,
  busy,
  onLoadUrl,
  onLoadFile,
  onDemo,
  town,
  indexUrl,
}: {
  sheetUrl: string;
  busy: boolean;
  onLoadUrl: (url: string) => void;
  onLoadFile: (f: File) => void;
  onDemo?: () => void;
  town?: string | null;
  indexUrl?: string;
}) {
  const [url, setUrl] = useState(sheetUrl);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="路線価図PDFのURL" />
        <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => onLoadUrl(url)} disabled={!url.trim() || busy}>
          読込
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-dashed border-stone-400 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">
          PDF・画像ファイル
          <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && onLoadFile(e.target.files[0])} />
        </label>
        {onDemo && (
          <Button variant="ghost" onClick={onDemo}>
            デモ用の架空の路線価図
          </Button>
        )}
      </div>
      <p className="text-xs text-stone-500">
        自動で見つからないときは、
        <a href={indexUrl ?? "https://www.rosenka.nta.go.jp/"} target="_blank" rel="noreferrer" className="text-teal-800 underline">
          国税庁「路線価図・評価倍率表」
        </a>
        で{town ? `「${town}」` : "町丁名"}の図を開き、PDFのURLを貼り付けてください。
      </p>
    </div>
  );
}

export function SheetViewer({
  sheet,
  pairs,
  pending,
  clickable,
  onClick,
  alt,
  height = 300,
}: {
  sheet: Sheet;
  pairs: GeoPair[];
  pending: [number, number] | null;
  clickable: boolean;
  onClick: (pt: [number, number]) => void;
  alt: string;
  height?: number;
}) {
  const [zoom, setZoom] = useState(0.3);
  const w = sheet.width * zoom;
  const h = sheet.height * zoom;
  const dot = (pt: [number, number], cls: string, label: string) => (
    <div key={`${cls}-${label}`} className={`pointer-events-none absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white text-xs font-bold text-white shadow ${cls}`} style={{ left: pt[0] * w, top: pt[1] * h }}>
      {label}
    </div>
  );
  return (
    <div>
      <label className="mb-1 flex items-center gap-2 text-sm text-stone-700">
        拡大
        <input type="range" min={0.1} max={1.2} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="accent-teal-700" />
      </label>
      <div className="overflow-auto rounded-lg border border-stone-300 bg-stone-100" style={{ height }}>
        <div className={`relative ${clickable ? "cursor-crosshair" : ""}`} style={{ width: w, height: h }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sheet.src}
            alt={alt}
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
        </div>
      </div>
    </div>
  );
}
