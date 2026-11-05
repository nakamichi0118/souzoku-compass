"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { CompassAvatar } from "@/components/compass/CompassKun";
import { kvGet, kvSet, PREFIX } from "@/lib/cloud";

/** 「もう表示しない」を押したか、ガイドを最後まで見た */
export const GUIDE_KEY = `${PREFIX}guide-seen`;
/** 「操作ガイド」を押したときに送る合図（どの画面からでも、ガイドを最初から始める） */
export const OPEN_GUIDE = "souzoku-compass:open-guide";
/** いま何番目の案内を見ているか（画面を移っても続けるため、タブを閉じるまで覚える） */
const TOUR_KEY = `${PREFIX}tour-step`;
/** 「あとで」を押した（このタブを閉じるまで、ホームで案内を出さない） */
const LATER_KEY = `${PREFIX}guide-later`;
/** 案内の画面に移ろうとした回数（聞き取り前などで戻されるとき、行き来し続けないため） */
const PUSH_KEY = `${PREFIX}tour-push`;

/**
 * 操作ガイドの順番。実際の画面に移り、その画面の大事なところ（data-tour の印）を明るくして説明する。
 * 印が見つからないとき（スマホで隠れているなど）は、画面の真ん中に説明だけ出す
 */
export const TOUR: { href: string; target: string; title: string; text: string }[] = [
  { href: "/my", target: "home-next", title: "ホーム", text: "いちばん先にすることが、ここに出ます。「続きを進める」を押せば、その手続きが開きます。迷ったらホームに戻りましょう。" },
  { href: "/my/tasks", target: "tasks-list", title: "やることリスト", text: "必要な手続きを期限の近い順に並べています。済んだらチェック、関係なければ「不要」を押します。手続きを選ぶと、どこで何を出すかが出ます。" },
  { href: "/my/calendar", target: "calendar-view", title: "カレンダー", text: "期限を「月ごと」のカレンダーと「手続きごと」の一覧で見られます。ここで切り替えます。" },
  { href: "/my/docs", target: "docs-scan", title: "資料集め", text: "届いた書類はここで撮影するだけ。コンパスくんが種類ごとに仕分けて、残高証明書などは金額も読み取ります。" },
  { href: "/case/decedent", target: "steps", title: "財産と相続税", text: "上の①〜⑧を順に入れると、相続税がかかるかを判定し、申告書まで作れます。途中でやめても、続きから始められます。" },
  { href: "/my/papers", target: "papers", title: "書類・帳票", text: "できた申告書や遺産分割協議書は、ここからPDFで受け取ります。" },
  { href: "/my", target: "help", title: "困ったときは", text: "右上の「使い方」で、いま開いている画面の説明が出ます。コンパスくんにもいつでも質問できます。" },
];

const read = (k: string) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v == null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch {
    /* 保存できなくても、この画面の中では続けられる */
  }
};
const TOUR_EVENT = "souzoku-compass:tour";

/** ガイドを最初から始める（ヘルプ・使い方のボタンから） */
export function startTour() {
  write(PUSH_KEY, null);
  write(TOUR_KEY, "0");
  window.dispatchEvent(new Event(TOUR_EVENT));
}

/** ホームで最初に出す案内。「見てみる」でガイドを始め、「もう表示しない」でホームに来ても出さない */
export function FirstGuide() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const again = new URLSearchParams(window.location.search).get("guide") === "1";
    if (again) {
      window.history.replaceState(null, "", window.location.pathname);
      startTour();
      return;
    }
    if (!kvGet(GUIDE_KEY) && !read(LATER_KEY) && read(TOUR_KEY) == null) setOpen(true);
  }, []);
  if (!open) return null;
  const later = () => {
    write(LATER_KEY, "1");
    setOpen(false);
  };
  const never = () => {
    kvSet(GUIDE_KEY, "1");
    setOpen(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 p-3 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="guide-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <CompassAvatar size={48} />
          <div className="min-w-0">
            <h2 id="guide-title" className="text-lg font-bold text-sky-950">
              画面の使い方をご案内します
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-700">それぞれの画面に移りながら、どこで何ができるかを1分ほどで見ていきます。</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              startTour();
            }}
            className="min-h-11 flex-1 rounded-full bg-sky-700 px-4 py-2 text-sm font-bold text-white hover:bg-sky-800"
          >
            案内を見る
          </button>
          <button type="button" onClick={later} className="min-h-11 flex-1 rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50">
            あとで
          </button>
        </div>
        <button type="button" onClick={never} className="mt-3 w-full text-center text-xs text-stone-500 underline hover:text-stone-700">
          もう表示しない（ガイドは右上の「使い方」から見られます）
        </button>
      </div>
    </div>
  );
}

type Box = { top: number; left: number; width: number; height: number };

/** ガイドの本体。どの画面にも置き、案内中なら、その番の画面に移って説明を重ねる */
export function GuideTour() {
  const path = usePathname();
  const router = useRouter();
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    const sync = () => {
      const v = read(TOUR_KEY);
      setStep(v == null ? null : Math.min(Math.max(0, Number(v) || 0), TOUR.length - 1));
    };
    sync();
    const open = () => startTour();
    window.addEventListener(TOUR_EVENT, sync);
    window.addEventListener(OPEN_GUIDE, open);
    return () => {
      window.removeEventListener(TOUR_EVENT, sync);
      window.removeEventListener(OPEN_GUIDE, open);
    };
  }, []);

  const s = step == null ? null : TOUR[step];
  const here = !!s && path === s.href;
  // その番の画面にいなければ移る（聞き取りがまだで別の画面に戻されるときなどは、何度も移ろうとせずにやめる）
  // 何度移ろうとしたかは、画面が作り直されても数え続ける（ヘッダーごとガイドも作り直されるため）
  useEffect(() => {
    if (!s) return;
    if (here) {
      write(PUSH_KEY, null);
      return;
    }
    const n = Number(read(PUSH_KEY) ?? 0);
    if (n >= 3) {
      write(PUSH_KEY, null);
      write(TOUR_KEY, null);
      setStep(null);
      return;
    }
    write(PUSH_KEY, String(n + 1));
    router.push(s.href);
  }, [s, here, router]);

  // 印の場所を測る（画面ができあがるのを少し待つ。大きさが変わったら測り直す）
  const measure = useCallback(() => {
    if (!s || !here) return setBox(null);
    const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${s.target}"]`)).find((e) => e.offsetParent !== null);
    if (!el) return setBox(null);
    const r = el.getBoundingClientRect();
    setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [s, here]);
  useLayoutEffect(() => {
    if (!s || !here) return;
    let tries = 0;
    let timer = 0;
    const find = () => {
      const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${s.target}"]`)).find((e) => e.offsetParent !== null);
      if (el) {
        el.scrollIntoView({ block: "center" });
        measure();
      } else if (tries++ < 20) timer = window.setTimeout(find, 150);
      else measure();
    };
    find();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [s, here, measure]);

  if (step == null || !s || !here) return null;
  const last = step === TOUR.length - 1;
  const go = (n: number) => {
    setBox(null);
    write(TOUR_KEY, String(n));
    setStep(n);
  };
  const end = (seen: boolean) => {
    write(TOUR_KEY, null);
    if (seen) kvSet(GUIDE_KEY, "1");
    setStep(null);
  };

  const pad = 6;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  // 説明の札は、印の下に入ればその下、入らなければ上、どちらも無理なら画面の下に出す
  const cardW = Math.min(360, vw - 24);
  const below = box && box.top + box.height + pad + 230 < vh;
  const above = box && box.top - pad - 230 > 0;
  const cardStyle: React.CSSProperties = box
    ? {
        left: Math.min(Math.max(12, box.left), vw - cardW - 12),
        width: cardW,
        ...(below ? { top: box.top + box.height + pad + 10 } : above ? { bottom: vh - box.top + pad + 10 } : { bottom: 12 }),
      }
    : { left: (vw - cardW) / 2, width: cardW, top: Math.max(12, vh / 2 - 120) };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {box ? (
        // 印のところだけ明るく残し、まわりを暗くする
        <div
          className="pointer-events-none absolute rounded-xl ring-4 ring-amber-300 transition-all duration-200"
          style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2, boxShadow: "0 0 0 9999px rgba(28,25,23,0.55)" }}
        />
      ) : (
        <div className="absolute inset-0 bg-stone-900/55" />
      )}
      <div className="absolute rounded-2xl bg-white p-4 shadow-2xl" style={cardStyle}>
        <div className="flex items-start gap-3">
          <CompassAvatar size={40} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-stone-500">
              使い方ガイド {step + 1}/{TOUR.length}
            </p>
            <h2 id="tour-title" className="text-base font-bold text-sky-950">
              {s.title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-700">{s.text}</p>
          </div>
        </div>
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
          {TOUR.map((g, k) => (
            <span key={`${g.title}${k}`} className={`h-1.5 w-4 rounded-full ${k === step ? "bg-sky-700" : "bg-stone-200"}`} />
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1)} className="min-h-10 flex-1 rounded-full border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-50">
              戻る
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? end(true) : go(step + 1))}
            className="min-h-10 flex-1 rounded-full bg-sky-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-sky-800"
          >
            {last ? "はじめる" : "次へ"}
          </button>
        </div>
        <button type="button" onClick={() => end(true)} className="mt-2 w-full text-center text-xs text-stone-500 underline hover:text-stone-700">
          ガイドをやめる（もう表示しない）
        </button>
      </div>
    </div>
  );
}
