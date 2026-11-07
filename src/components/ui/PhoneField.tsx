"use client";

import { useRef } from "react";
import { joinPhone, phoneParts } from "@/lib/phone";

const box = "w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 py-2 text-center text-base tabular-nums focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 sm:text-sm";
const MAX = [5, 4, 4];
const NAMES = ["市外局番", "市内局番", "加入者番号"];

/**
 * 電話番号を申告書と同じ3つの枠で入れる。1つ目の枠に番号をまとめて入れたり貼り付けたりしたときは、
 * 桁数から3つに分ける。枠がいっぱいになったら次の枠へ移る
 */
export function PhoneField({ value, onChange, label = "電話番号" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const parts = phoneParts(value);
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const set = (i: number, raw: string) => {
    const t = raw.normalize("NFKC");
    // 区切りつき・枠より長い番号を入れた・貼り付けたときは、それまでの枠と合わせて3つに分け直す
    if (/[^\d]/.test(t.trim()) || t.length > MAX[i]) {
      const before = parts.slice(0, i);
      const whole = /[^\d]/.test(t.trim()) ? [...before, t].join("-") : before.join("") + t;
      onChange(joinPhone(phoneParts(whole)));
      return;
    }
    const next = [...parts];
    next[i] = t;
    onChange(joinPhone(next));
    if (t.length === MAX[i] && i < 2) refs[i + 1].current?.focus();
  };
  return (
    <div className="block text-sm">
      <span className="mb-1 block font-medium text-stone-700">{label}</span>
      <div className="flex items-center gap-1.5">
        {parts.map((v, i) => (
          <span key={i} className="contents">
            {i > 0 && (
              <span aria-hidden className="text-stone-400">
                －
              </span>
            )}
            <input ref={refs[i]} className={box} inputMode="tel" autoComplete={i === 0 ? "tel" : "off"} aria-label={`${label}（${NAMES[i]}）`} value={v} placeholder={["090", "0000", "0000"][i]} onChange={(e) => set(i, e.target.value)} />
          </span>
        ))}
      </div>
    </div>
  );
}
