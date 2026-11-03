"use client";

/**
 * 待っている間に出す、細い進み具合のバーと短い案内。
 *
 * 進み具合は「いまの段階が全体のどこからどこまでか（at → until。0〜1）」と「その段階にかかる目安の秒数」で表す。
 * 段階の中では時間とともに少しずつ進め、段階が終わるまでは until に届かないようにする
 * （目安の秒数で段階の 3/4、その2倍で 15/16 …と、だんだんゆっくりになる）。
 * 目安の時間を過ぎたら「もう少しかかっています」と1行だけ添える。
 */
import { useEffect, useState } from "react";

export interface Progress {
  /** この段階が始まる位置（全体を 0〜1 として） */
  at: number;
  /** この段階が終わる位置（0〜1） */
  until: number;
  /** この段階にかかる目安の秒数（なければ段階の中では進めない） */
  expectSec?: number;
  /** この段階が始まった時刻（Date.now()）。なければバーを出した時刻から数える */
  since?: number;
}

/** 短い待ち（住所の検索・図の読み込みなど）に使う、時間で進むバー */
export const QUICK: Progress = { at: 0, until: 1, expectSec: 5 };

/** 段階の中でここまで（段階の幅に対する割合）しか進めない。段階が終わる前に until に届かないように */
const MAX_SHARE = 0.97;
/** 「もう少しかかっています」は、目安の時間を過ぎ、かつこの秒数を過ぎてから出す（短い待ちで出さないように） */
const MIN_SLOW_SEC = 8;

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** 段階が始まってから elapsedSec 秒たったときの、全体の進み具合（0〜1） */
export function progressValue(p: Progress, elapsedSec: number): number {
  const at = clamp01(p.at);
  const until = Math.max(at, clamp01(p.until));
  if (!p.expectSec || !(p.expectSec > 0) || !(elapsedSec > 0)) return at;
  const share = Math.min(MAX_SHARE, 1 - 4 ** (-elapsedSec / p.expectSec));
  return at + (until - at) * share;
}

/** 目安の時間を過ぎて、まだかかっているか */
export const isSlow = (p: Progress, elapsedSec: number): boolean => !!p.expectSec && p.expectSec > 0 && elapsedSec > Math.max(p.expectSec, MIN_SLOW_SEC);

/** 一部の仕事の進み具合（0〜1）を、全体のバーの from〜to の区間に当てはめる */
export const within = (p: Progress, from: number, to: number): Progress => ({ ...p, at: from + (to - from) * clamp01(p.at), until: from + (to - from) * clamp01(p.until) });

export function ProgressBar({
  message,
  progress,
  quiet = false,
  className = "",
}: {
  message: string;
  progress?: Progress | null;
  /** 同じ案内を画面のほかの場所にも出しているときは true（読み上げを1回にする） */
  quiet?: boolean;
  className?: string;
}) {
  const p = progress ?? QUICK;
  const [shown] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const timed = !!p.expectSec && p.expectSec > 0;
  // 時間で進める段階の間だけ、少しずつ描き直す（バーを消したら止める）
  useEffect(() => {
    if (!timed) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [timed]);
  const elapsed = Math.max(0, (now - (p.since ?? shown)) / 1000);
  const value = progressValue(p, elapsed);
  const text = message.replace(/…+$/, "");
  return (
    <div className={className} aria-hidden={quiet || undefined}>
      <p aria-live={quiet ? undefined : "polite"}>{text}…</p>
      <div
        role="progressbar"
        aria-label={text}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-teal-100"
      >
        <div className="h-full rounded-full bg-teal-600 transition-[width] duration-300 ease-linear motion-reduce:transition-none" style={{ width: `${Math.max(2, value * 100).toFixed(1)}%` }} />
      </div>
      {isSlow(p, elapsed) && <p className="mt-1 text-xs opacity-80">もう少しかかっています</p>}
    </div>
  );
}
