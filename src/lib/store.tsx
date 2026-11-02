"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { demoCase } from "@/data/demo";
import { calculate, type TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";

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

export function CaseProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Case>(demoCase);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setData(JSON.parse(raw));
    } catch {
      /* 保存領域が使えない環境ではデモ案件のまま */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* noop */
    }
  }, [data, loaded]);

  const update = useCallback((fn: (c: Case) => Case) => setData((c) => fn(structuredClone(c))), []);
  const replace = useCallback((c: Case) => setData(c), []);

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
