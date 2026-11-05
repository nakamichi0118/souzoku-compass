"use client";

import { isUnsaved, kvGet, kvSet, localIsMine, useSession } from "./cloud";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { demoCase } from "@/data/demo";
import { calculate, type TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { withSoleHeir } from "./progress";
import { withSmallLandAcquirers } from "./smallLand";

const KEY = "souzoku-compass:case:v1";

export const blankCase = (): Case => ({
  id: crypto.randomUUID(),
  title: "新しい相続",
  decedent: { name: "", birthDate: "", deathDate: "2026-01-01", address: "" },
  persons: [],
  assets: [],
  debts: [],
  allocations: [],
  priorGifts: [],
  filing: { taxOffice: "" },
});

interface Ctx {
  data: Case;
  update: (fn: (c: Case) => Case) => void;
  replace: (c: Case) => void;
  result: TaxResult | null;
  error: string | null;
  loaded: boolean;
}
const CaseContext = createContext<Ctx | null>(null);

/** 保存・計算の前にそろえること：相続人が1人なら分け方を省く、特例の取得する人が決まっていれば入れる */
const normalize = (c: Case) => withSmallLandAcquirers(withSoleHeir(c));

export function CaseProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Case>(demoCase);
  const [loaded, setLoaded] = useState(false);
  const { ready, mode } = useSession();

  useEffect(() => {
    if (!ready) return;
    try {
      const raw = kvGet(KEY);
      // 記録がないとき：デモは架空の家族、ログインした人は白紙から
      setData(raw ? normalize(JSON.parse(raw)) : mode === "demo" ? demoCase : blankCase());
    } catch {
      setData(blankCase());
    }
    setLoaded(true);
  }, [ready, mode]);

  // 別のタブで書き換えられたら読み直す（古い画面のまま入力して、別のタブの入力を上書きしないため）。
  // このタブにまだ送っていない入力があるときは、そちらを優先する。別のタブで別の人がログインしたあとの値は取り込まない
  const fromOtherTab = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY || e.newValue === null || isUnsaved(KEY) || !localIsMine()) return;
      try {
        const next = JSON.parse(e.newValue) as Case;
        fromOtherTab.current = e.newValue;
        setData(next);
      } catch {
        // 壊れた値は読み込まない
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loaded]);

  // 読み込んだ直後の1回は書き戻さない（変わっていないものを送らない）
  const first = useRef(true);
  useEffect(() => {
    if (!loaded) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const raw = JSON.stringify(data);
    // 別のタブから読み直しただけなら書き戻さない（そのタブがもう保存している）
    if (raw === fromOtherTab.current) {
      fromOtherTab.current = null;
      return;
    }
    fromOtherTab.current = null;
    kvSet(KEY, raw);
  }, [data, loaded]);

  const update = useCallback((fn: (c: Case) => Case) => setData((c) => normalize(fn(structuredClone(c)))), []);
  const replace = useCallback((c: Case) => setData(normalize(c)), []);

  const { result, error } = useMemo(() => {
    try {
      if (!data.decedent.deathDate) return { result: null, error: null };
      return { result: calculate(data), error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [data]);

  return (
    <CaseContext.Provider value={{ data, update, replace, result, error, loaded }}>{children}</CaseContext.Provider>
  );
}

export function useCase() {
  const ctx = useContext(CaseContext);
  if (!ctx) throw new Error("CaseProvider is missing");
  return ctx;
}

export const newId = () => crypto.randomUUID().slice(0, 8);
