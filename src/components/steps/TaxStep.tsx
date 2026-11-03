"use client";

import Link from "next/link";
import { Button, Card, Note, fmt } from "@/components/ui";
import { useAsk } from "@/components/compass/AskCompass";
import { toString as fracText } from "@/domain/fraction";
import { RATE_TABLE, rateFor } from "@/domain/tax/engine";
import { Markdown } from "@/components/compass/Markdown";
import { jpDate, monthsDeadline, nextOpenDay } from "@/domain/procedures/dates";
import { relationLabel } from "@/forms/filing";
import { useCase } from "@/lib/store";
import { summarizeForAssistant } from "@/lib/summary";

function Row({ label, value, sub, strong }: { label: React.ReactNode; value: number | string; sub?: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-stone-100 py-2">
      <div>
        <p className={strong ? "font-bold" : ""}>{label}</p>
        {sub && <p className="text-xs text-stone-500">{sub}</p>}
      </div>
      <p className={`shrink-0 tabular-nums ${strong ? "text-lg font-bold text-teal-800" : ""}`}>{typeof value === "number" ? `${fmt(value)}円` : value}</p>
    </div>
  );
}

const EXPLAIN_QUESTION = "この計算結果を、相続税に詳しくない家族にも分かるように説明してください。なぜこの税額になるのか、配偶者の税額軽減などの効果も含めて。";

export function TaxStep() {
  const { data, result, error } = useCase();
  // 説明の依頼は相談欄と同じ仕組みを使う（通信に失敗したときも、その旨を表示する）
  const explainer = useAsk("tax", () => summarizeForAssistant(data, result));
  if (error) return <Note tone="stop">計算できませんでした：{error}</Note>;
  if (!result) return <Note tone="info">亡くなった日を入力すると計算できます。</Note>;
  const r = result;
  const { answer: explain, busy } = explainer;

  const man = (n: number) => (n >= 10_000 ? `約${(Math.round(n / 1_000) / 10).toLocaleString("ja-JP")}万円` : `${fmt(n)}円`);
  const payers = r.persons.filter((p) => p.taxable > 0 || p.payable > 0);
  const maxBar = Math.max(1, ...payers.map((p) => p.computed + p.surcharge));
  const basicPart = Math.min(r.basicDeduction, r.totalTaxable);
  const deadline = data.decedent.deathDate ? nextOpenDay(monthsDeadline(data.decedent.deathDate, 10)) : null;

  // 確認待ちの財産や、取得する人が決まっていない財産があるうちは、税額は暫定
  const pendingAssets = data.assets.filter((a) => a.pending?.length || r.assets.find((l) => l.asset.id === a.id)?.valuation.needsConsultation);
  const undivided = data.assets.filter((a) => a.kind !== "insurance" && a.kind !== "retirement" && !data.allocations.some((x) => x.assetId === a.id && x.shares.some((s) => s.numerator > 0)));
  const provisional = pendingAssets.length > 0 || undivided.length > 0 || r.blockers.length > 0;

  return (
    <div className="space-y-5">
      {provisional && (
        <Note tone="warn">
          <p className="font-semibold">まだ確定していない入力があるため、下の税額は暫定です。</p>
          <ul className="mt-1 list-disc pl-5">
            {pendingAssets.length > 0 && (
              <li>
                確認待ちの財産：{pendingAssets.map((a) => a.label || "（名称未入力）").join("、")}
                <Link href={`/case/assets?asset=${pendingAssets[0].id}`} className="ml-2 font-semibold underline">
                  財産を確かめる ›
                </Link>
              </li>
            )}
            {undivided.length > 0 && (
              <li>
                取得する人が決まっていない財産：{undivided.map((a) => a.label || "（名称未入力）").join("、")}
                <Link href="/case/division" className="ml-2 font-semibold underline">
                  分け方を決める ›
                </Link>
              </li>
            )}
          </ul>
        </Note>
      )}
      {r.blockers.map((b, i) => (
        <Note key={`${i}:${b}`} tone="stop">
          {b}
        </Note>
      ))}

      {/* いちばん大事なこと：家族全体で、誰がいくら納めるか */}
      <section className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-teal-900">家族全体で納める相続税{provisional && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">暫定</span>}</p>
        <p className="mt-1 text-4xl font-bold tabular-nums text-teal-900">
          {fmt(r.totalPayable)}
          <span className="ml-1 text-xl">円</span>
        </p>
        <p className="mt-2 text-sm text-stone-700">
          {!r.needsFiling ? "相続税はかからず、申告も原則いりません。" : r.totalPayable === 0 ? "特例を使うので納める税金は0円ですが、申告は必要です。" : "それぞれが自分の分を、申告期限までに納めます。"}
          {r.needsFiling && deadline && <span className="ml-1 font-semibold">申告・納税の期限：{jpDate(deadline)}</span>}
        </p>

        {payers.length > 0 && r.totalTax > 0 && (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {payers.map((p) => {
              const before = p.computed + p.surcharge;
              const minus = before - p.afterCredits;
              return (
                <li key={p.person.id} className="rounded-xl border border-stone-200 bg-white p-4">
                  <p className="text-sm text-stone-600">
                    {p.person.name}
                    <span className="ml-1 text-xs text-stone-400">{relationLabel(p.person)}</span>
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-stone-900">
                    {fmt(p.payable)}
                    <span className="ml-0.5 text-sm">円</span>
                  </p>
                  {/* 割り当てられた税額のうち、控除で減った分と納める分 */}
                  <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-stone-100" style={{ width: `${Math.max(8, (before / maxBar) * 100)}%` }} aria-hidden>
                    <div className="h-full bg-teal-600" style={{ width: `${before ? (p.afterCredits / before) * 100 : 0}%` }} />
                    <div className="h-full bg-emerald-200" style={{ width: `${before ? (minus / before) * 100 : 0}%` }} />
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-stone-500">
                    受け取った財産 {man(p.taxable)}・税額の割り当て {fmt(before)}円
                    {minus > 0 && (
                      <>
                        <br />
                        {[
                          p.spouseCredit && `配偶者の税額軽減 −${fmt(p.spouseCredit)}円`,
                          p.minorCredit && `未成年者控除 −${fmt(p.minorCredit)}円`,
                          p.disabilityCredit && `障害者控除 −${fmt(p.disabilityCredit)}円`,
                          p.giftTaxCredit && `贈与税額控除 −${fmt(p.giftTaxCredit)}円`,
                        ]
                          .filter(Boolean)
                          .join("・")}
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {payers.length > 0 && r.totalTax > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-4 text-xs text-stone-600">
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-teal-600 align-middle" />納める額</span>
            <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-200 align-middle" />軽減・控除で減った額</span>
          </p>
        )}
      </section>

      {/* どうしてこの金額になるのか：3段階の図 */}
      <Card title="どうしてこの金額になるの？">
        <ol className="space-y-5">
          <li>
            <p className="text-sm font-bold text-stone-800">1. 財産の合計から、基礎控除を差し引きます</p>
            <div className="mt-2 flex h-9 overflow-hidden rounded-lg text-xs font-semibold text-white">
              <div className="grid place-items-center bg-stone-400 px-2" style={{ width: `${r.totalTaxable ? (basicPart / r.totalTaxable) * 100 : 100}%` }}>
                基礎控除 {man(r.basicDeduction)}
              </div>
              {r.taxableEstate > 0 && (
                <div className="grid min-w-[6rem] place-items-center bg-orange-500 px-2" style={{ width: `${(r.taxableEstate / r.totalTaxable) * 100}%` }}>
                  税金の対象 {man(r.taxableEstate)}
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-stone-500">
              財産の合計（課税価格の合計）{man(r.totalTaxable)}。基礎控除は 3,000万円＋600万円×法定相続人{r.legalHeirCount}人 です。
            </p>
          </li>
          {r.taxableEstate > 0 && (
            <li>
              <p className="text-sm font-bold text-stone-800">2. 法律で決まった割合で分けたとして、家族全体の税額を出します</p>
              <p className="mt-1 text-sm text-stone-700">
                相続税の総額：<span className="font-bold tabular-nums">{fmt(r.totalTax)}円</span>
              </p>
              <p className="text-xs text-stone-500">実際の分け方に関係なく、法定相続分で分けたとして税率をかけた合計です（相続税法16条）。</p>
            </li>
          )}
          {r.totalTax > 0 && (
            <li>
              <p className="text-sm font-bold text-stone-800">3. 実際に受け取った割合で、総額を一人ひとりに割り当てます</p>
              <div className="mt-2 flex h-9 overflow-hidden rounded-lg text-xs font-semibold text-white">
                {payers.map((p, i) => (
                  <div
                    key={p.person.id}
                    className={`grid min-w-0 place-items-center truncate px-1 ${["bg-teal-600", "bg-sky-600", "bg-amber-500", "bg-violet-500", "bg-rose-500", "bg-lime-600"][i % 6]}`}
                    style={{ width: `${p.ratio * 100}%` }}
                    title={`${p.person.name} ${p.ratioText}`}
                  >
                    {p.ratio > 0.12 ? p.person.name : ""}
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-stone-500">そこから、配偶者の税額軽減や未成年者控除などを差し引いた額が、それぞれの納める税額です。</p>
            </li>
          )}
        </ol>
      </Card>

      <details className="group rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-lg font-bold text-stone-800">詳しい計算（申告書の第1表・第2表）</summary>
        <div className="mt-4 space-y-6">
          <section>
            <h3 className="mb-2 font-bold text-stone-700">相続税の総額（第2表）</h3>
            <Row label="課税価格の合計額" value={r.totalTaxable} sub="各人の課税価格（1,000円未満切捨て）の合計" />
            <Row label={`遺産に係る基礎控除額（法定相続人 ${r.legalHeirCount}人）`} value={-r.basicDeduction} sub="3,000万円＋600万円×法定相続人の数（相続税法15条）" />
            <Row label="課税遺産総額" value={r.taxableEstate} strong />
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {r.slots.map((s, i) => {
                const rate = rateFor(s.amount);
                return (
                  <li key={i} className="rounded-lg bg-stone-50 p-3 text-sm">
                    <p className="font-semibold">
                      {s.label}
                      <span className="ml-2 text-xs font-normal text-stone-500">法定相続分 {fracText(s.share)}</span>
                    </p>
                    <p className="mt-1 flex justify-between tabular-nums"><span className="text-stone-500">取得金額</span>{fmt(s.amount)}円</p>
                    <p className="flex justify-between tabular-nums"><span className="text-stone-500">税率・控除額</span>{s.amount > 0 ? `${rate.rate}% − ${fmt(rate.deduction)}円` : "—"}</p>
                    <p className="flex justify-between font-semibold tabular-nums"><span className="text-stone-500">税額</span>{fmt(s.tax)}円</p>
                  </li>
                );
              })}
            </ul>
            <Row label="相続税の総額（100円未満切捨て）" value={r.totalTax} strong />
            <details className="mt-2 text-xs text-stone-600">
              <summary className="cursor-pointer text-teal-800">速算表（相続税法16条）</summary>
              <ul className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
                {RATE_TABLE.map((t) => (
                  <li key={t.rate}>
                    {t.upTo === Infinity ? "6億円超" : `${fmt(t.upTo / 10000)}万円以下`}：{t.rate}%・控除{fmt(t.deduction / 10000)}万円
                  </li>
                ))}
              </ul>
            </details>
          </section>

          <section>
            <h3 className="mb-2 font-bold text-stone-700">各人の納付税額（第1表）</h3>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {r.persons.map((p) => (
                <li key={p.person.id} className="rounded-lg border border-stone-200 p-3 text-sm">
                  <p className="mb-1 font-bold">{p.person.name}</p>
                  <dl className="tabular-nums">
                    {(
                      [
                        ["取得財産の価額", p.acquired],
                        ["債務及び葬式費用", p.debts],
                        ["3年以内の贈与財産", p.gifts],
                        ["課税価格", p.taxable],
                        ["按分割合", p.ratioText],
                        ["算出税額", p.computed],
                        ["2割加算", p.surcharge],
                        ["贈与税額控除", -p.giftTaxCredit],
                        ["配偶者の税額軽減", -p.spouseCredit],
                        ["未成年者控除", -p.minorCredit],
                        ["障害者控除", -p.disabilityCredit],
                      ] as [string, number | string][]
                    )
                      .filter(([, v]) => v !== 0 && v !== "")
                      .map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2 border-b border-stone-100 py-1">
                          <dt className="text-stone-500">{k}</dt>
                          <dd>{typeof v === "number" ? `${fmt(v)}円` : v}</dd>
                        </div>
                      ))}
                    <div className="flex justify-between gap-2 pt-1 font-bold text-teal-800">
                      <dt>納付すべき税額</dt>
                      <dd>{fmt(p.payable)}円</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </details>

      {r.spouse && (
        <Card title="配偶者の税額軽減（第5表）">
          <Row label="課税価格の合計額" value={r.spouse.totalTaxable} />
          <Row label="配偶者の法定相続分相当額" value={r.spouse.legalShareAmount} sub="1億6千万円に満たない場合は1億6千万円" />
          <Row label="配偶者の課税価格" value={r.spouse.spouseTaxable} />
          <Row label="軽減の基となる金額" value={r.spouse.creditBase} sub="相続税の総額 × 上の2つのいずれか少ない方 ÷ 課税価格の合計額" />
          <Row label="配偶者の税額軽減額" value={r.spouse.credit} strong />
        </Card>
      )}

      <Card title="コンパスくんの説明" actions={<Button onClick={() => explainer.ask(EXPLAIN_QUESTION)} disabled={busy}>{busy ? "作成中…" : "この結果を説明してもらう"}</Button>}>
        {busy ? (
          <p className="text-sm text-stone-500">説明を作っています…</p>
        ) : explain ? (
          <div className="text-sm text-stone-800"><Markdown text={explain} /></div>
        ) : (
          <p className="text-sm text-stone-500">「この結果を説明してもらう」を押すと、コンパスくんが計算結果をやさしく説明します。</p>
        )}
      </Card>

      {r.warnings.map((w, i) => (
        <Note key={`${i}:${w}`} tone="warn">
          {w}
        </Note>
      ))}
    </div>
  );
}
