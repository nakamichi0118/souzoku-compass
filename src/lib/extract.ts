"use client";

import { useState } from "react";
import type { Asset, Case } from "@/domain/types";

/** /api/extract が返す、書類から読み取った財産の候補 */
export interface ExtractedAsset {
  kind: "deposit" | "land" | "building" | "insurance" | "listedStock" | "other";
  label: string;
  institution?: string | null;
  branch?: string | null;
  accountType?: string | null;
  amount: number | null;
  accruedInterest: number | null;
  location: string | null;
  areaSqm: number | null;
  fixedAssetValue: number | null;
  date: string | null;
  evidence: string;
}
export interface Extracted {
  documentType: string;
  assets: ExtractedAsset[];
  notes: string[];
}

/**
 * 読み取った候補を、相続税申告の財産データの形にする。
 * 書類に書かれていない値（土地の倍率・保険金の受取人・株価）は推定せず未入力のまま残し、
 * 評価の段階で「未入力」として確定を止める。
 */
export function toAsset(x: ExtractedAsset): Asset {
  const id = crypto.randomUUID().slice(0, 8);
  if (x.kind === "land")
    return { id, kind: "land", label: x.label, location: x.location ?? "", areaSqm: x.areaSqm ?? 0, landUse: "宅地", method: { type: "multiplier", fixedAssetValue: x.fixedAssetValue ?? 0, multiplier: 0 } };
  if (x.kind === "building") return { id, kind: "building", label: x.label, location: x.location ?? "", fixedAssetValue: x.fixedAssetValue ?? 0 };
  if (x.kind === "insurance") return { id, kind: "insurance", label: x.label, amount: x.amount ?? 0, recipientId: "" };
  if (x.kind === "listedStock") return { id, kind: "listedStock", label: x.label, shares: 0, prices: { close: 0, monthAvg: 0, prevMonthAvg: 0, prev2MonthAvg: 0 } };
  return {
    id,
    kind: x.kind === "deposit" ? "deposit" : "other",
    label: x.label,
    amount: x.amount ?? 0,
    accruedInterest: x.accruedInterest ?? undefined,
    institution: x.institution ?? undefined,
    branch: x.branch ?? undefined,
    accountType: x.accountType ?? undefined,
  };
}

/** すでに登録されている財産と同じものか（金融機関・金額が一致） */
export function findSame(x: ExtractedAsset, c: Case): Asset | undefined {
  return c.assets.find((a) => {
    if (a.kind === "deposit" && x.kind === "deposit") {
      const sameBank = (!!x.institution && a.institution === x.institution) || a.label.includes(x.institution ?? x.label);
      return sameBank && a.amount === x.amount && (!x.accountType || !a.accountType || a.accountType === x.accountType);
    }
    if ((a.kind === "insurance" || a.kind === "other") && a.kind === x.kind) return a.label === x.label && a.amount === x.amount;
    return false;
  });
}

/** 書類のファイルを送って読み取る */
export function useExtract() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Extracted | null>(null);
  const [file, setFile] = useState<string | null>(null);
  async function read(f: File) {
    setBusy(true);
    setErr(null);
    setRes(null);
    setFile(f.name);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/extract", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "読み取りに失敗しました");
      setRes(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function readSample(url: string, name: string) {
    const b = await (await fetch(url)).blob();
    await read(new File([b], name, { type: b.type || "application/pdf" }));
  }
  return { busy, err, res, file, read, readSample, reset: () => setRes(null) };
}
