"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TextInput } from "@/components/ui";
import { lookupZip, nextAddress, normalizeZip, zipDigits, type ZipHit } from "@/lib/zip/lookup";

type Status = { kind: "none" } | { kind: "many"; hits: ZipHit[] } | { kind: "offer"; hit: ZipHit } | { kind: "missing" } | { kind: "error" };

/**
 * 郵便番号つきの住所の欄。7桁を入れると、都道府県・市区町村・町名を住所に入れ、
 * 続きの番地を入れられるように住所の欄へ移る。自分で入れた住所は勝手に書き換えない。
 * zip/onZip を渡せば郵便番号も保存し、渡さなければ住所を入れるための一時的な欄にする。
 */
export function AddressField({
  label,
  hint,
  address,
  onAddress,
  zip,
  onZip,
  placeholder,
  ariaLabel,
}: {
  label?: string;
  hint?: string;
  address: string;
  onAddress: (v: string) => void;
  zip?: string;
  onZip?: (v: string) => void;
  placeholder?: string;
  /** label を出さないときの住所の欄の名前 */
  ariaLabel?: string;
}) {
  const [ownZip, setOwnZip] = useState("");
  const zipValue = zip ?? ownZip;
  const [status, setStatus] = useState<Status>({ kind: "none" });
  const addressId = useId();
  const zipRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  // 待っている間に住所が変わっても、最新の住所に入れる
  const latest = useRef(address);
  const onAddressRef = useRef(onAddress);
  useEffect(() => {
    latest.current = address;
    // 待っている間に親が描き直しても、最新の描画の onAddress で入れる（古い入力の内容で上書きしない）
    onAddressRef.current = onAddress;
  }, [address, onAddress]);
  const lastFilled = useRef<string | null>(null);
  const asked = useRef("");

  /** force：自分で入れた住所でも書き換える。clicked：ボタンで選んだ（そのあと住所の欄へ移る） */
  const apply = (hit: ZipHit, force = false, clicked = false) => {
    const next = force ? hit.address : nextAddress(latest.current, hit.address, lastFilled.current);
    if (next == null) {
      setStatus({ kind: "offer", hit });
      return;
    }
    lastFilled.current = hit.address;
    if (next !== latest.current) onAddressRef.current(next);
    setStatus({ kind: "none" });
    // 郵便番号を打っていたなら、続けて番地を打てるように住所の欄の最後へ
    const typing = document.activeElement === zipRef.current;
    if (typing || force || clicked)
      setTimeout(() => {
        const el = addressRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }, 0);
  };

  const changeZip = async (raw: string) => {
    const v = normalizeZip(raw);
    if (onZip) onZip(v);
    else setOwnZip(v);
    const d = zipDigits(v);
    if (d.length !== 7) {
      asked.current = "";
      setStatus({ kind: "none" });
      return;
    }
    if (d === asked.current) return;
    asked.current = d;
    const hits = await lookupZip(d);
    if (asked.current !== d) return;
    if (hits == null) setStatus({ kind: "error" });
    else if (hits.length === 0) setStatus({ kind: "missing" });
    else if (hits.length === 1) apply(hits[0]);
    else setStatus({ kind: "many", hits });
  };

  return (
    <div className="block">
      {label && (
        <label htmlFor={addressId} className="mb-1 block text-sm font-medium text-stone-700">
          {label}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex w-36 shrink-0 items-center gap-1">
          <span aria-hidden className="text-stone-500">
            〒
          </span>
          <TextInput
            ref={zipRef}
            value={zipValue}
            onChange={(e) => changeZip(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            placeholder="100-0001"
            aria-label="郵便番号"
          />
        </span>
        <TextInput
          ref={addressRef}
          id={addressId}
          value={address}
          onChange={(e) => onAddress(e.target.value)}
          placeholder={placeholder}
          aria-label={label ? undefined : ariaLabel}
          className="min-w-0 flex-1 basis-60"
        />
      </div>
      <div aria-live="polite">
        {status.kind === "many" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-stone-600">町名：</span>
            {status.hits.map((h) => (
              <button
                key={h.address}
                type="button"
                onClick={() => apply(h, false, true)}
                className="rounded-full border border-stone-300 bg-white px-3 py-1 text-stone-800 hover:border-teal-600 hover:text-teal-800"
              >
                {h.name || h.town || h.city}
              </button>
            ))}
          </div>
        )}
        {status.kind === "offer" && (
          <button type="button" onClick={() => apply(status.hit, true)} className="mt-2 text-sm text-sky-800 underline">
            住所を「{status.hit.address}」にする
          </button>
        )}
        {status.kind === "missing" && <p className="mt-1 text-xs text-stone-500">この郵便番号からは住所を出せませんでした。住所を入れてください。</p>}
        {status.kind === "error" && <p className="mt-1 text-xs text-stone-500">住所を調べられませんでした。そのまま入れてください。</p>}
      </div>
      {hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}
