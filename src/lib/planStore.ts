"use client";

import { useCallback, useEffect, useState } from "react";
import { demoInterview, type Interview } from "@/domain/procedures/interview";

const IV_KEY = "souzoku-compass:interview:v1";
const DONE_KEY = "souzoku-compass:done:v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 保存できない環境では画面を開いている間だけ保持 */
  }
}

/** 聞き取りの答えと、済んだ手続きの記録（この端末のブラウザにだけ保存） */
export function usePlan() {
  const [iv, setIv] = useState<Interview>(demoInterview);
  const [done, setDone] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setIv({ ...demoInterview(), ...read<Partial<Interview>>(IV_KEY, {}) });
    // デモの回答のままなら、葬儀と死亡届は済んだ状態から始める
    setDone(read<string[]>(DONE_KEY, ["funeral", "death-report", "shonanoka"]));
    setLoaded(true);
  }, []);

  const saveIv = useCallback((next: Interview) => {
    setIv(next);
    write(IV_KEY, next);
  }, []);
  const toggle = useCallback((id: string) => {
    setDone((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      write(DONE_KEY, next);
      return next;
    });
  }, []);
  const resetDone = useCallback(() => {
    setDone([]);
    write(DONE_KEY, []);
  }, []);

  return { iv, saveIv, done, toggle, resetDone, loaded };
}
