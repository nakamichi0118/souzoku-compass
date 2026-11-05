"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CompassAvatar } from "@/components/compass/CompassKun";
import { kvGet, kvSet, PREFIX } from "@/lib/cloud";
import { placeCard, roundRect, type Box } from "./tourPlace";

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
export const TOUR: { href: string; target: string; title: string; text: string; nav?: string }[] = [
  { href: "/my", target: "home-next", title: "ホーム", nav: "ホーム", text: "いちばん先にすることが、ここに出ます。「続きを進める」を押せば、その手続きが開きます。迷ったらホームに戻りましょう。" },
  { href: "/my/tasks", target: "tasks-list", title: "やることリスト", nav: "やることリスト", text: "必要な手続きを期限の近い順に並べています。済んだらチェック、関係なければ「不要」を押します。手続きを選ぶと、どこで何を出すかが出ます。" },
  { href: "/my/calendar", target: "calendar-view", title: "カレンダー", nav: "カレンダー", text: "期限を「月ごと」のカレンダーと「手続きごと」の一覧で見られます。ここで切り替えます。" },
  { href: "/my/docs", target: "docs-scan", title: "資料集め", nav: "資料集め", text: "届いた書類はここで撮影するだけ。コンパスくんが種類ごとに仕分けて、残高証明書などは金額も読み取ります。" },
  { href: "/case/decedent", target: "steps", title: "財産と相続税", nav: "財産と相続税", text: "上の①〜⑧を順に入れると、相続税がかかるかを判定し、申告書まで作れます。途中でやめても、続きから始められます。" },
  { href: "/my/papers", target: "papers", title: "書類・帳票", nav: "書類・帳票", text: "できた申告書や遺産分割協議書は、ここからPDFで受け取ります。" },
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

/** 見えている印を探す（パソコン用とスマホ用で同じ印が2つあるときは、見えている方） */
const visible = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => e.offsetParent !== null) ?? null;
const rectOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};
const grow = (b: Box, p: number): Box => ({ top: b.top - p, left: b.left - p, width: b.width + p * 2, height: b.height + p * 2 });

/** ガイドの本体。どの画面にも置き、案内中なら、その番の画面に移って説明を重ねる */
export function GuideTour() {
  const path = usePathname();
  const router = useRouter();
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  /** 上のメニューの、この画面を開く項目（スマホでは右上の ☰） */
  const [nav, setNav] = useState<{ box: Box; menu: boolean } | null>(null);
  const [view, setView] = useState({ vw: 1200, vh: 800, top: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(240);

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

  // 印の場所と、上のメニューの項目の場所を測る（大きさが変わったら測り直す）
  const measure = useCallback(() => {
    setView({ vw: window.innerWidth, vh: window.innerHeight, top: document.querySelector("header")?.getBoundingClientRect().bottom ?? 0 });
    if (!s || !here) {
      setBox(null);
      setNav(null);
      return;
    }
    const el = visible(`[data-tour="${s.target}"]`);
    setBox(el ? rectOf(el) : null);
    const link = s.nav ? visible(`[data-tour-nav="${s.nav}"]`) : null;
    const menu = s.nav && !link ? visible(`[data-tour-nav="menu"]`) : null;
    const n = link ?? menu;
    setNav(n ? { box: rectOf(n), menu: !link } : null);
  }, [s, here]);
  useLayoutEffect(() => {
    if (!s || !here) return;
    let tries = 0;
    let timer = 0;
    const find = () => {
      const el = visible(`[data-tour="${s.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        const head = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
        // 縦に長い印は、頭がヘッダーのすぐ下に来るように（真ん中に寄せると、頭が隠れて札の置き場もなくなる）
        if (r.height > (window.innerHeight - head) * 0.45) window.scrollBy({ top: r.top - head - 16 });
        else el.scrollIntoView({ block: "center" });
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
  // 札の高さを測って、印にかぶらない場所を選び直す
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && h !== cardH) setCardH(h);
  }, [step, nav, view.vw, here, cardH]);

  if (step == null || !s || !here) return null;
  const last = step === TOUR.length - 1;
  const go = (n: number) => {
    setBox(null);
    setNav(null);
    write(TOUR_KEY, String(n));
    setStep(n);
  };
  const end = (seen: boolean) => {
    write(TOUR_KEY, null);
    if (seen) kvSet(GUIDE_KEY, "1");
    setStep(null);
  };

  const pad = 6;
  const cardW = Math.min(360, view.vw - 24);
  const target = box ? grow(box, pad) : null;
  const place = placeCard(target, view, { w: cardW, h: cardH });
  const navHole = nav ? grow(nav.box, 4) : null;
  const holes = [place.hole, navHole].filter((b): b is Box => !!b);

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* 印のところと、上のメニューの項目だけ明るく残し、まわりを暗くする */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        <path fillRule="evenodd" fill="rgba(28,25,23,0.55)" d={`M0 0H${view.vw}V${view.vh}H0Z ${holes.map((h) => roundRect(h, 12)).join(" ")}`} />
      </svg>
      {place.hole && (
        <div
          className="pointer-events-none absolute rounded-xl ring-4 ring-amber-300"
          style={{ top: place.hole.top, left: place.hole.left, width: place.hole.width, height: place.hole.height }}
        />
      )}
      {navHole && (
        <div
          data-testid="tour-nav"
          className="tour-nav-ring pointer-events-none absolute rounded-xl ring-4 ring-amber-400"
          style={{ top: navHole.top, left: navHole.left, width: navHole.width, height: navHole.height }}
        />
      )}
      <div ref={cardRef} className="absolute rounded-2xl bg-white p-4 shadow-2xl" style={{ left: place.left, top: place.top, width: cardW }}>
        <div className="flex items-start gap-3">
          <CompassAvatar size={40} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-stone-500">
              使い方ガイド {step + 1}/{TOUR.length}
            </p>
            <h2 id="tour-title" className="text-base font-bold text-sky-950">
              {s.title}
            </h2>
            {s.nav && nav && (
              <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                {nav.menu ? `右上の ☰ →「${s.nav}」で開きます` : `上のメニューの「${s.nav}」で開きます`}
              </p>
            )}
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
