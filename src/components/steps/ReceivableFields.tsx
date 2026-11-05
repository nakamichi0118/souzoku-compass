"use client";

import { Field, Select, TextInput } from "@/components/ui";
import { RECEIVABLE_TYPES, type Receivable, type ReceivableType, type ReceivableVerdict, judgeReceivable, receivableType } from "@/domain/review/receivables";

/** 判定の1行（相続財産か・入れないか・相談か・足りない入力） */
export function verdictText(v: ReceivableVerdict): { text: string; tone: "estate" | "skip" | "consult" | "need" } {
  switch (v.kind) {
    case "estate":
      return { text: "相続財産に入れます", tone: "estate" };
    case "notEstate":
      return { text: `入れません：${v.reason}`, tone: "skip" };
    case "inBalance":
      return { text: `入れません：${v.reason}`, tone: "skip" };
    case "consult":
      return { text: "税理士への相談をおすすめします", tone: "consult" };
    default:
      return { text: `「${v.need}」を入れてください`, tone: "need" };
  }
}

const TONE = { estate: "text-teal-800", skip: "text-stone-600", consult: "text-orange-800", need: "text-orange-800" } as const;

export function VerdictLine({ r, deathDate }: { r: Receivable; deathDate?: string }) {
  const v = verdictText(judgeReceivable(r, deathDate));
  return <p className={`text-sm font-semibold ${TONE[v.tone]}`}>{v.text}</p>;
}

/** 受け取るお金の種類・何の分か・宛名・受け取った日。判定に要るものだけを出す */
export function ReceivableFields({ r, onChange }: { r: Receivable; onChange: (r: Receivable) => void }) {
  const def = receivableType(r.type);
  const patch = (p: Partial<Receivable>) => onChange({ ...r, ...p });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="種類">
        <Select
          value={r.type}
          // 種類を変えたら、前の種類の「何の分か」「宛名」は残さない
          onChange={(v) => onChange({ type: v as ReceivableType, receivedOn: r.receivedOn })}
          options={RECEIVABLE_TYPES.map((d) => ({ value: d.type, label: d.label }))}
        />
      </Field>
      {def.basis && (
        <Field label={def.basis.label}>
          <TextInput type={def.basis.kind} value={r.basis ?? ""} onChange={(e) => patch({ basis: e.target.value || undefined })} />
        </Field>
      )}
      {def.holder && (
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium text-stone-700">{def.holder.label}</p>
          <div className="flex flex-wrap gap-1" role="group" aria-label={def.holder.label}>
            {(
              [
                ["decedent", "はい"],
                ["other", "いいえ"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => patch({ holder: v })}
                aria-pressed={r.holder === v}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${r.holder === v ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white text-stone-700"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <Field label="受け取った日（まだなら空のまま）">
        <TextInput type="date" value={r.receivedOn ?? ""} onChange={(e) => patch({ receivedOn: e.target.value || undefined })} />
      </Field>
    </div>
  );
}
