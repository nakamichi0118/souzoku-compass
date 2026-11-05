"use client";

/**
 * 書類の撮影。カメラの映像から書類の四隅を探して枠を重ね、撮ったあとに四隅を指で直して、
 * 斜めに写った書類を長方形に切り出す。ライト（スマホのフラッシュ）が使える端末ではライトを点けられる。
 * カメラが使えない端末では、写真を選んでから同じように四隅を直す。
 */
import { Camera, Check, Flashlight, FlashlightOff, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_QUAD, detectQuad, toGray, warp, type Pt, type Quad } from "@/lib/scan";

const SMALL = 160;

/** 画像（canvas）を縮めて四隅を探す */
function findQuad(src: CanvasImageSource, w: number, h: number, work: HTMLCanvasElement): Quad | null {
  const sw = SMALL;
  const sh = Math.max(1, Math.round((h / w) * SMALL));
  work.width = sw;
  work.height = sh;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, sw, sh);
  const img = ctx.getImageData(0, 0, sw, sh);
  return detectQuad(toGray(img.data, sw, sh), sw, sh);
}

const poly = (q: Quad, w: number, h: number) => q.map((p) => `${p.x * w},${p.y * h}`).join(" ");

/** 枠のゆれを抑える（前の枠に少しずつ寄せる） */
const ease = (a: Quad | null, b: Quad | null): Quad | null => (!a || !b ? b : (a.map((p, i) => ({ x: p.x * 0.6 + b[i].x * 0.4, y: p.y * 0.6 + b[i].y * 0.4 })) as Quad));

export function DocCamera({ onDone, onClose, multi = true }: { onDone: (files: File[]) => void; onClose: () => void; multi?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const work = useRef<HTMLCanvasElement | null>(null);
  const still = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [live, setLive] = useState<Quad | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [noCamera, setNoCamera] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null); // null = 使えない
  const [shot, setShot] = useState<{ url: string; w: number; h: number } | null>(null);
  const [quad, setQuad] = useState<Quad>(DEFAULT_QUAD);
  const [pages, setPages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  // カメラを開く（撮ったあとの調整中は止めておく）
  useEffect(() => {
    if (shot) return;
    let off = false;
    let timer = 0;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setNoCamera(true);
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
        if (off) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        const track = s.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setTorch(caps.torch ? false : null);
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        work.current ??= document.createElement("canvas");
        let prev: Quad | null = null;
        const tick = () => {
          const v = video.current;
          if (off || !v) return;
          if (v.videoWidth) {
            prev = ease(prev, findQuad(v, v.videoWidth, v.videoHeight, work.current!));
            setLive(prev);
            const vw = v.videoWidth;
            const vh = v.videoHeight;
            setDims((d) => (d && d.w === vw && d.h === vh ? d : { w: vw, h: vh }));
          }
          timer = window.setTimeout(tick, 160);
        };
        tick();
      } catch {
        if (!off) setNoCamera(true);
      }
    })();
    return () => {
      off = true;
      clearTimeout(timer);
      stop();
    };
  }, [shot, stop]);

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  const keep = (c: HTMLCanvasElement, q: Quad | null) => {
    still.current = c;
    setQuad(q ?? DEFAULT_QUAD);
    setShot({ url: c.toDataURL("image/jpeg", 0.8), w: c.width, h: c.height });
  };

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    keep(c, live);
  };

  const pick = async (f: File) => {
    const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
    const s = Math.min(1, 2600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    work.current ??= document.createElement("canvas");
    keep(c, findQuad(c, c.width, c.height, work.current));
  };

  const crop = async () => {
    const c = still.current;
    if (!c || !shot) return;
    setBusy(true);
    try {
      const ctx = c.getContext("2d")!;
      const src = ctx.getImageData(0, 0, c.width, c.height);
      const out = warp(src, quad.map((p) => ({ x: p.x * c.width, y: p.y * c.height })));
      const o = document.createElement("canvas");
      if (out) {
        o.width = out.width;
        o.height = out.height;
        o.getContext("2d")!.putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height), 0, 0);
      }
      const blob = await new Promise<Blob | null>((r) => (out ? o : c).toBlob(r, "image/jpeg", 0.88));
      if (!blob) return;
      const file = new File([blob], `書類_${new Date().toISOString().slice(0, 10)}_${pages.length + 1}.jpg`, { type: "image/jpeg" });
      const next = [...pages, file];
      setPages(next);
      setShot(null);
      if (!multi) {
        stop();
        onDone(next);
      }
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    stop();
    onDone(pages);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white" role="dialog" aria-label="書類を撮影">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <p className="text-sm font-semibold">{shot ? "角を動かして書類に合わせてください" : "書類を枠に入れて撮影"}</p>
        <button
          type="button"
          onClick={() => {
            stop();
            onClose();
          }}
          aria-label="閉じる"
          className="-m-2 p-2"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {shot ? (
          <Adjust shot={shot} quad={quad} onChange={setQuad} />
        ) : noCamera ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="text-sm">カメラを使えませんでした。写真を撮るか選んでください。</p>
              <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-4 py-2 font-semibold text-stone-900">
                <Camera className="h-5 w-5" aria-hidden />
                写真を撮る・選ぶ
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void pick(f);
                  }}
                />
              </label>
            </div>
          </div>
        ) : (
          <div className="relative h-full w-full">
            <video ref={video} playsInline muted className="h-full w-full object-contain" />
            {live && dims ? (
              <svg viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full">
                <polygon points={poly(live, dims.w, dims.h)} fill="rgba(46,155,106,0.25)" stroke="#34d399" strokeWidth={Math.max(4, dims.w / 200)} strokeLinejoin="round" />
              </svg>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {shot ? (
          <>
            <button type="button" onClick={() => setShot(null)} className="inline-flex items-center gap-1 rounded-lg border border-white/40 px-4 py-2 text-sm">
              <RotateCcw className="h-4 w-4" aria-hidden />
              撮り直す
            </button>
            <button type="button" onClick={() => void crop()} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-white disabled:opacity-60">
              <Check className="h-5 w-5" aria-hidden />
              {busy ? "切り取り中…" : "この範囲で使う"}
            </button>
          </>
        ) : (
          <>
            <div className="w-24">
              {torch !== null && (
                <button type="button" onClick={() => void toggleTorch()} aria-pressed={torch} className="inline-flex items-center gap-1 rounded-lg border border-white/40 px-3 py-2 text-sm">
                  {torch ? <Flashlight className="h-4 w-4" aria-hidden /> : <FlashlightOff className="h-4 w-4" aria-hidden />}
                  ライト
                </button>
              )}
            </div>
            {!noCamera && (
              <button type="button" onClick={capture} aria-label="撮影" className="grid h-16 w-16 place-items-center rounded-full border-4 border-white">
                <span className="h-12 w-12 rounded-full bg-white" />
              </button>
            )}
            <div className="w-24 text-right">
              {pages.length > 0 && (
                <button type="button" onClick={finish} className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold">
                  完了（{pages.length}枚）
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 撮った写真に四隅のつまみを重ね、指やマウスで動かせるようにする */
function Adjust({ shot, quad, onChange }: { shot: { url: string; w: number; h: number }; quad: Quad; onChange: (q: Quad) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: React.PointerEvent): Pt | null => {
    const el = svg.current;
    if (!el) return null;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = el.getScreenCTM();
    if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    return { x: Math.min(1, Math.max(0, p.x / shot.w)), y: Math.min(1, Math.max(0, p.y / shot.h)) };
  };
  const r = Math.max(shot.w, shot.h) / 28;
  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${shot.w} ${shot.h}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full touch-none select-none"
      onPointerMove={(e) => {
        if (drag === null) return;
        const p = at(e);
        if (p) onChange(quad.map((q, i) => (i === drag ? p : q)) as Quad);
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
    >
      <image href={shot.url} x={0} y={0} width={shot.w} height={shot.h} />
      <polygon points={poly(quad, shot.w, shot.h)} fill="rgba(46,155,106,0.2)" stroke="#34d399" strokeWidth={r / 5} strokeLinejoin="round" />
      {quad.map((p, i) => (
        <circle
          key={i}
          cx={p.x * shot.w}
          cy={p.y * shot.h}
          r={r}
          fill="rgba(255,255,255,0.35)"
          stroke="#fff"
          strokeWidth={r / 6}
          aria-label={["左上", "右上", "右下", "左下"][i] + "の角"}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setDrag(i);
          }}
        />
      ))}
    </svg>
  );
}
