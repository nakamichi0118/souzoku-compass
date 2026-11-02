"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CompassAvatar } from "@/components/compass/CompassKun";
import { OFFICE_LABEL, cityOf, isTokyoWard, type OfficeKind } from "@/domain/procedures/offices";

interface Office {
  found: boolean;
  name: string;
  dept: string;
  address: string;
  phone: string;
  hours: string;
  url: string;
  note: string;
}

const KEY = "souzoku-compass:offices:v1";
const readCache = (): Record<string, Office> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};

/** 提出先の窓口：種類はルールで決まり、住所から具体的な窓口と連絡先をコンパスくんが調べる */
export function OfficeLookup({ kind, dept, address, forProperty }: { kind: OfficeKind; dept?: string; address: string; forProperty?: boolean }) {
  const actual: OfficeKind = forProperty && kind === "city" && isTokyoWard(address) ? "metroTax" : kind;
  const { pref, city } = cityOf(address);
  const key = `${actual}|${pref}${city}|${dept ?? ""}`;
  const [office, setOffice] = useState<Office | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setOffice(readCache()[key] ?? null);
  }, [key]);

  if (!city)
    return (
      <p className="text-sm text-stone-600">
        提出先：{OFFICE_LABEL[actual]}
        {dept ? `（${dept}）` : ""}。{" "}
        <Link href="/start" className="text-sky-800 underline">
          亡くなった方の住所
        </Link>
        を入れると、具体的な窓口と連絡先を表示します。
      </p>
    );

  async function lookup() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/offices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: actual, address, dept }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "調べられませんでした。");
      setOffice(j);
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...readCache(), [key]: j }));
      } catch {
        /* noop */
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 text-sm">
      <p className="font-semibold text-stone-800">
        提出先：{pref}
        {city}の{OFFICE_LABEL[actual]}
        {actual === "city" ? "" : "（管轄の窓口）"}
        {dept ? `／${dept}` : ""}
      </p>
      {office ? (
        <div className="mt-2 flex items-start gap-2">
          <CompassAvatar size={32} />
          <div className="min-w-0 space-y-0.5">
            <p className="font-bold text-stone-900">
              {office.name || "（名称を確認できませんでした）"}
              {office.dept && <span className="ml-1 font-normal text-stone-600">{office.dept}</span>}
            </p>
            {office.address && <p>📍 {office.address}</p>}
            {office.phone && (
              <p>
                📞{" "}
                <a href={`tel:${office.phone.replace(/[^\d+]/g, "")}`} className="text-sky-800 underline">
                  {office.phone}
                </a>
              </p>
            )}
            {office.hours && <p>🕘 {office.hours}</p>}
            {office.note && <p className="text-stone-600">{office.note}</p>}
            {office.url && (
              <a href={office.url} target="_blank" rel="noreferrer" className="break-all text-xs text-sky-800 underline">
                出典：{office.url}
              </a>
            )}
            <p className="text-xs text-stone-500">コンパスくんが公式サイトで調べた内容です。行く前に公式サイトか電話で確認してください。</p>
          </div>
        </div>
      ) : (
        <button type="button" onClick={lookup} disabled={busy} className="mt-2 inline-flex items-center gap-2 rounded-lg border border-sky-300 bg-white px-3 py-1.5 font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-60">
          <CompassAvatar size={22} />
          {busy ? "コンパスくんが公式サイトを調べています…（30秒ほど）" : "住所・電話番号をコンパスくんに調べてもらう"}
        </button>
      )}
      {err && <p className="mt-1 text-rose-700">{err}</p>}
    </div>
  );
}
