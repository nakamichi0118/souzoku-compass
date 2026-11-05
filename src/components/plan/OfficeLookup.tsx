"use client";

import { kvGet, kvSet } from "@/lib/cloud";
import { Clock, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CompassAvatar } from "@/components/compass/CompassKun";
import { ProgressBar } from "@/components/compass/ProgressBar";
import { OFFICE_LABEL, areaOf, cityOf, isTokyoWard, type OfficeKind } from "@/domain/procedures/offices";

export interface Office {
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
/** 窓口を調べるのにかかる目安（公式サイトを調べるので 30 秒ほど） */
const LOOKUP_WAIT = { at: 0, until: 1, expectSec: 30 };
const readCache = (): Record<string, Office> => {
  try {
    return JSON.parse(kvGet(KEY) ?? "{}");
  } catch {
    return {};
  }
};

/** 窓口を調べる（このブラウザ・アカウントに覚えた結果があればそれを使う） */
export async function findOffice(kind: OfficeKind, address: string, dept?: string): Promise<Office> {
  const { pref, city } = cityOf(address);
  const k = `${kind}|${kind === "city" ? pref + city : areaOf(address)}|${dept ?? ""}`;
  const hit = readCache()[k];
  if (hit) return hit;
  const res = await fetch("/api/offices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, address, dept }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "調べられませんでした。");
  kvSet(KEY, JSON.stringify({ ...readCache(), [k]: j }));
  return j;
}

/** 提出先の窓口：種類はルールで決まり、住所から具体的な窓口と連絡先をコンパスくんが調べる */
export function OfficeLookup({ kind, dept, address, forProperty }: { kind: OfficeKind; dept?: string; address: string; forProperty?: boolean }) {
  const actual: OfficeKind = forProperty && kind === "city" && isTokyoWard(address) ? "metroTax" : kind;
  const { pref, city } = cityOf(address);
  const key = `${actual}|${actual === "city" ? pref + city : areaOf(address)}|${dept ?? ""}`;
  const [office, setOffice] = useState<Office | null>(null);
  // 調べている窓口・失敗した窓口を key で覚え、別の手続きに切り替えたあとに古い結果を表示しないようにする
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<{ key: string; text: string } | null>(null);
  const current = useRef(key);
  const busy = busyKey === key;

  useEffect(() => {
    current.current = key;
    setOffice(readCache()[key] ?? null);
  }, [key]);

  if (!city)
    return (
      <p className="text-sm text-stone-600">
        提出先：{OFFICE_LABEL[actual]}
        {dept ? `（${dept}）` : ""}。{" "}
        <Link href="/my/hearing" className="text-sky-800 underline">
          亡くなった方の住所
        </Link>
        を入れると、窓口を調べられます。
      </p>
    );

  async function lookup() {
    const k = key;
    setBusyKey(k);
    setErr(null);
    try {
      // 結果はその窓口の key で保存し、いま表示している窓口と同じときだけ画面に出す
      const j = await findOffice(actual, address, dept);
      if (current.current === k) setOffice(j);
    } catch (e) {
      setErr({ key: k, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusyKey((b) => (b === k ? null : b));
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
            {office.address && <p className="flex items-start gap-1"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />{office.address}</p>}
            {office.phone && (
              <p>
                <Phone className="mr-1 inline h-4 w-4 text-brand" aria-hidden />
                <a href={`tel:${office.phone.replace(/[^\d+]/g, "")}`} className="text-sky-800 underline">
                  {office.phone}
                </a>
              </p>
            )}
            {office.hours && <p className="flex items-start gap-1"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />{office.hours}</p>}
            {office.note && <p className="text-stone-600">{office.note}</p>}
            {office.url && (
              <a href={office.url} target="_blank" rel="noreferrer" className="break-all text-xs text-sky-800 underline">
                出典：{office.url}
              </a>
            )}
            <p className="text-xs text-stone-500">行く前に電話で確認してください。</p>
          </div>
        </div>
      ) : busy ? (
        // 調べている間は、ボタンの代わりに進み具合を出す（30秒ほどかかる）
        <ProgressBar message="コンパスくんが公式サイトを調べています" progress={LOOKUP_WAIT} className="mt-2 text-teal-900" />
      ) : (
        <button type="button" onClick={lookup} className="mt-2 inline-flex items-center gap-2 rounded-lg border border-sky-300 bg-white px-3 py-1.5 font-semibold text-sky-800 hover:bg-sky-50">
          <CompassAvatar size={22} />
          窓口の住所・電話を調べる
        </button>
      )}
      {err && err.key === key && <p className="mt-1 text-rose-700">{err.text}</p>}
    </div>
  );
}
