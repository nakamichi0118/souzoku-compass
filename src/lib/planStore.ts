"use client";

import { useCallback, useEffect, useState } from "react";
import { demoInterview, type Interview } from "@/domain/procedures/interview";
import { buildTasks } from "@/domain/procedures/rules";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** デモの回答のままなら、今日より前が期限の手続きと主な書類は済んだ状態から始める */
const demoDone = () => [
  ...buildTasks(demoInterview()).tasks.filter((t) => t.date < todayISO() && t.id !== "registration").map((t) => t.id),
  "doc:deathCert",
  "doc:kosekiDecedent",
  "doc:kosekiHeirs",
  "doc:balanceCert",
];

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
    setDone(read<string[] | null>(DONE_KEY, null) ?? demoDone());
    setLoaded(true);
  }, []);

  const saveIv = useCallback((next: Interview) => {
    setIv((prev) => {
      // 別の相続（亡くなった日が変わった）になったら、済みの記録を消す
      if (prev.deathDate !== next.deathDate) {
        setDone([]);
        write(DONE_KEY, []);
      }
      return next;
    });
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

  const loadDemo = useCallback(() => {
    const d = demoInterview();
    const dd = demoDone();
    setIv(d);
    write(IV_KEY, d);
    setDone(dd);
    write(DONE_KEY, dd);
  }, []);

  return { iv, saveIv, done, toggle, resetDone, loadDemo, loaded };
}
