"use client";

import { Check as CheckIcon, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, Check, Note, YenInput, fmt } from "@/components/ui";
import { ConsultRequest } from "@/components/compass/ConsultRequest";
import { CompassAvatar } from "@/components/compass/CompassKun";
import {
  type AddTemplate,
  type ReviewAnswer,
  type ReviewState,
  TOPICS,
  type Topic,
  type TopicId,
  WITHDRAWAL_ADD,
  cashFromWithdrawal,
  reviewSummary,
  topicStatus,
} from "@/domain/review/topics";
import type { Asset, Case } from "@/domain/types";
import { newId, useCase } from "@/lib/store";
import { blankAsset } from "./AssetsStep";

const GROUPS: { id: Topic["group"]; title: string }[] = [
  { id: "assets", title: "見落としやすい財産" },
  { id: "money", title: "お金の動き" },
  { id: "special", title: "自宅・国外のこと" },
];

const ANSWERS: { value: ReviewAnswer; label: string }[] = [
  { value: "yes", label: "ある" },
  { value: "no", label: "ない" },
  { value: "unsure", label: "分からない" },
];

const OUTCOME_LABEL = { add: "財産に追加します", gift: "贈与として入れます", none: "申告に入れるものはありません", consult: "税理士への相談をおすすめします" } as const;

/** ひな型から財産を作る（金額などは確認待ちにして、財産の画面で入れてもらう） */
export function assetFromTemplate(t: AddTemplate, amount?: number): Asset {
  const a = blankAsset(t.kind) as Asset & { amount?: number };
  const out = { ...a, id: newId(), label: t.label, ...(t.pending.length ? { pending: [...t.pending] } : {}) } as Asset;
  if (amount !== undefined && "amount" in out) (out as { amount: number }).amount = amount;
  return out;
}

const withReview = (c: Case, fn: (r: ReviewState) => ReviewState): Case => ({ ...c, review: fn({ ...(c.review ?? {}) }) });

export function ReviewStep() {
  const { data, update } = useCase();
  const review = data.review ?? {};
  const sum = reviewSummary(review);
  const set = (fn: (r: ReviewState) => ReviewState) => update((c) => withReview(c, fn));
  const consultReasons = sum.consult.flatMap((c) => c.reasons);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-white p-4 shadow-sm">
        <CompassAvatar size={44} />
        <div className="min-w-0 text-sm text-stone-800">
          <p className="font-semibold">申告の前に、入れ忘れがないか一緒に確かめましょう。</p>
          <p className="mt-0.5 text-stone-600">
            {sum.answered}/{sum.total} 問 回答
            {sum.confirmed ? (
              <span className="ml-2 font-semibold text-teal-700">確認OK</span>
            ) : (
              sum.open.length > 0 && <span className="ml-2 text-orange-700">残り {sum.open.length} 件</span>
            )}
          </p>
        </div>
      </div>

      {GROUPS.map((g) => (
        <Card key={g.id} title={g.title}>
          <ul className="divide-y divide-stone-100">
            {TOPICS.filter((t) => t.group === g.id).map((t) => (
              <TopicRow key={t.id} t={t} review={review} set={set} />
            ))}
          </ul>
        </Card>
      ))}

      {consultReasons.length > 0 && <ConsultRequest reasons={consultReasons} />}
      {sum.unsure.length > 0 && (
        <Note tone="warn">「分からない」と答えた項目は、未確認のまま残ります。分かった時点で答え直してください。未確認のまま申告書を作ると「下書き」と入ります。</Note>
      )}
      <details className="text-xs text-stone-600">
        <summary className="cursor-pointer py-2 font-medium text-teal-800">Tips：この確認について</summary>
        <p className="mt-1 leading-relaxed">
          税務調査では、財産の入れ漏れや、過去のお金の動きがよく確かめられます。ここでは決まった質問で入れ漏れを探し、判断が分かれるものは税理士への相談をおすすめします。コンパスくんが聞き取るのは「ある」と答えた一部の項目だけで、申告に入れるかどうかを最後に決めるのはご本人です。
        </p>
      </details>
    </div>
  );
}

function TopicRow({ t, review, set }: { t: Topic; review: ReviewState; set: (fn: (r: ReviewState) => ReviewState) => void }) {
  const { update } = useCase();
  const answer = review.answers?.[t.id];
  const st = topicStatus(t, review);
  const choose = (v: ReviewAnswer) => set((r) => ({ ...r, answers: { ...r.answers, [t.id]: v } }));
  const markAdded = (key: string) => (r: ReviewState) => ({ ...r, added: [...new Set([...(r.added ?? []), key])] });
  const addAsset = (key: string, a: Asset) => {
    update((c) => withReview({ ...c, assets: [...c.assets, a] }, markAdded(key)));
  };
  const consulted = (review.consulted ?? []).includes(t.id);

  return (
    <li className="py-3" data-q={t.id}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="min-w-0 text-sm text-stone-800">
          {st.kind === "clear" && <CheckIcon className="mr-1 inline h-4 w-4 text-teal-600" aria-label="確認済み" />}
          {t.question}
        </p>
        <div className="flex shrink-0 gap-1" role="group" aria-label={t.question}>
          {ANSWERS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => choose(a.value)}
              aria-pressed={answer === a.value}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${answer === a.value ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      {t.tip && (
        <details className="mt-1 text-xs text-stone-600">
          <summary className="cursor-pointer py-1 text-teal-800">Tips</summary>
          <p className="leading-relaxed">{t.tip}</p>
        </details>
      )}

      {answer === "yes" && (
        <div className="mt-2 space-y-2 rounded-lg bg-stone-50 p-3 text-sm">
          {t.sub && <SubChoices t={t} review={review} set={set} />}
          {t.talk && <Talk t={t} review={review} set={set} />}
          {t.withdrawal && (
            <Withdrawal
              review={review}
              set={set}
              done={(review.added ?? []).includes(t.id)}
              onAdd={(amount) => addAsset(t.id, assetFromTemplate(WITHDRAWAL_ADD, amount))}
            />
          )}
          {st.kind === "add" &&
            st.items.map((it) => (
              <div key={it.key} className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => addAsset(it.key, assetFromTemplate(it.template))}>
                  ＋「{it.template.label}」を財産に追加
                </Button>
                {it.template.pending.length > 0 && <span className="text-xs text-stone-500">{it.template.pending.join("・")}は財産の画面で入れます</span>}
              </div>
            ))}
          {st.kind === "gift" && (
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/case/debts" className="font-semibold text-teal-800 underline">
                「債務・葬式費用」で3年以内の贈与を入れる ›
              </Link>
              <Button variant="secondary" onClick={() => set(markAdded(t.id))}>
                入れました
              </Button>
            </div>
          )}
          {(st.kind === "consult" || consulted) && (
            <Check
              checked={consulted}
              onChange={(v) => set((r) => ({ ...r, consulted: v ? [...new Set([...(r.consulted ?? []), t.id])] : (r.consulted ?? []).filter((x) => x !== t.id) }))}
              label="税理士に相談して確かめた"
            />
          )}
          {st.kind === "clear" && (review.added ?? []).some((k) => k === t.id || k.startsWith(`${t.id}:`)) && (
            <Link href="/case/assets" className="text-xs font-semibold text-teal-800 underline">
              追加した財産を確かめる（確認待ちの項目を入れてください） ›
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

function SubChoices({ t, review, set }: { t: Topic; review: ReviewState; set: (fn: (r: ReviewState) => ReviewState) => void }) {
  const sub = t.sub!;
  const picked = review.sub?.[t.id] ?? [];
  const toggle = (id: string) =>
    set((r) => {
      const cur = r.sub?.[t.id] ?? [];
      const next = sub.multiple ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id];
      return { ...r, sub: { ...r.sub, [t.id]: next } };
    });
  return (
    <div>
      <p className="font-semibold text-stone-700">{sub.question}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {sub.choices.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => toggle(c.id)}
            aria-pressed={picked.includes(c.id)}
            className={`rounded-lg border px-3 py-1.5 font-semibold ${picked.includes(c.id) ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white text-stone-700"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Withdrawal({ review, set, done, onAdd }: { review: ReviewState; set: (fn: (r: ReviewState) => ReviewState) => void; done: boolean; onAdd: (amount: number) => void }) {
  const w = review.withdrawal ?? {};
  const cash = cashFromWithdrawal(w);
  const patch = (p: Partial<NonNullable<ReviewState["withdrawal"]>>) => set((r) => ({ ...r, withdrawal: { ...r.withdrawal, ...p } }));
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-stone-600">引き出した額の合計</span>
          <YenInput value={w.amount} onChange={(v) => patch({ amount: v })} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-stone-600">そのうち使い道が分かっている額（葬儀・入院費など）</span>
          <YenInput value={w.used} onChange={(v) => patch({ used: v })} />
        </label>
      </div>
      <p>
        手もとの現金として入れる額：<span className="font-bold tabular-nums">{fmt(cash)}円</span>
      </p>
      {done ? (
        <p className="text-xs text-teal-800">財産に追加しました。金額を変えたときは、財産の画面で直してください。</p>
      ) : (
        <Button variant="secondary" onClick={() => onAdd(cash)} disabled={!(Number(w.amount) > 0)}>
          ＋ 現金として財産に追加
        </Button>
      )}
    </div>
  );
}

function Talk({ t, review, set }: { t: Topic; review: ReviewState; set: (fn: (r: ReviewState) => ReviewState) => void }) {
  const chat = review.chat?.[t.id] ?? [];
  const result = review.talk?.[t.id];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = t.id as TopicId;

  const send = async () => {
    const msg = text.trim();
    if (!msg || busy) return;
    const next = [...chat, { role: "user" as const, text: msg.slice(0, 1500) }];
    setText("");
    setErr(null);
    setBusy(true);
    set((r) => ({ ...r, chat: { ...r.chat, [id]: next } }));
    try {
      const res = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: id, messages: next.slice(-24) }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "コンパスくんに聞けませんでした。");
      set((r) => ({
        ...r,
        chat: { ...r.chat, [id]: [...next, { role: "assistant", text: String(j.reply ?? "") }] },
        ...(j.done && j.outcome ? { talk: { ...r.talk, [id]: { outcome: j.outcome, summary: String(j.summary ?? ""), at: new Date().toISOString() } } } : {}),
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => set((r) => ({ ...r, chat: { ...r.chat, [id]: [] }, talk: { ...r.talk, [id]: undefined }, added: (r.added ?? []).filter((k) => k !== id) }));
  const skip = () => set((r) => ({ ...r, talk: { ...r.talk, [id]: { outcome: "consult", summary: "", at: new Date().toISOString() } } }));

  return (
    <div className="space-y-2">
      {chat.length === 0 && !result && <p className="text-stone-700">コンパスくんが少しだけ詳しく聞きます。分かる範囲で、ふだんの言葉で書いてください。</p>}
      {chat.length > 0 && (
        <ul className="space-y-1.5">
          {chat.map((m, i) => (
            <li key={i} className={m.role === "user" ? "ml-8 rounded-lg bg-white p-2 text-stone-800" : "mr-8 rounded-lg bg-sky-100 p-2 text-stone-800"}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
      {result ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-stone-800">結論：{OUTCOME_LABEL[result.outcome]}</span>
          <button type="button" onClick={reset} className="text-xs text-teal-800 underline">
            聞き直す
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
              }}
              maxLength={1500}
              placeholder={chat.length ? "返事を書く" : "例：長男の名義の定期預金を、父が管理していました"}
              className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-base sm:text-sm"
            />
            <Button onClick={send} disabled={busy || !text.trim()} aria-label="送る">
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          {busy && <p className="text-xs text-stone-500">コンパスくんが考えています…</p>}
          {err && <p className="text-xs text-red-700">{err}</p>}
          <button type="button" onClick={skip} className="text-xs text-stone-600 underline">
            話さずに税理士への相談に回す
          </button>
        </>
      )}
    </div>
  );
}
