"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Check, Field, NumInput, Note, Select, TextInput, YenInput, fmt } from "@/components/ui";
import type { Asset, AssetKind, Person } from "@/domain/types";
import { newId, useCase } from "@/lib/store";
import { usePlan } from "@/lib/planStore";
import { DOC_OF, assetHasDoc } from "@/lib/assetDocs";
import { AssetIcon } from "@/components/my/icons";
import { flashInto, revealBelowHeader } from "@/components/ui/scroll";
import { type DivisionInput, LandEditor, LeaseRatioSelect, RentRatioField, SmallResidential, resetSmallOnKindChange } from "./LandEditor";
import type { Interview } from "@/domain/procedures/interview";
import { RECEIVABLE_TYPES, type Receivable } from "@/domain/review/receivables";
import { ReceivableFields, VerdictLine } from "./ReceivableFields";

const KINDS: { kind: AssetKind; label: string }[] = [
  { kind: "deposit", label: "預貯金" },
  { kind: "cash", label: "現金" },
  { kind: "land", label: "土地" },
  { kind: "building", label: "家屋" },
  { kind: "condo", label: "分譲マンション" },
  { kind: "listedStock", label: "上場株式" },
  { kind: "unlistedStock", label: "非上場株式" },
  { kind: "insurance", label: "死亡保険金" },
  { kind: "retirement", label: "死亡退職金" },
  { kind: "household", label: "家庭用財産" },
  { kind: "other", label: "その他" },
];
export const kindLabel = (k: AssetKind) => KINDS.find((x) => x.kind === k)?.label ?? k;

export function blankAsset(kind: AssetKind, recipientId = ""): Asset {
  const base = { id: newId(), label: "" };
  switch (kind) {
    case "land":
      return { ...base, kind, location: "", areaSqm: 0, landUse: "宅地", method: { type: "rosenka", routePrice: 0, depthCorrection: 1 } };
    case "building":
      return { ...base, kind, location: "", fixedAssetValue: 0 };
    case "condo":
      return {
        ...base,
        kind,
        location: "",
        landValueBeforeCorrection: 0,
        buildingFixedAssetValue: 0,
        builtYearsMonths: { years: 0, months: 0 },
        // 0 は「未入力」。入れるまで評価額を確定しない（仮の値のまま計算されないようにする）
        totalFloors: 0,
        floor: 0,
        landShareSqm: 0,
        exclusiveAreaSqm: 0,
      };
    case "listedStock":
      return { ...base, kind, shares: 0, prices: { close: 0, monthAvg: 0, prevMonthAvg: 0, prev2MonthAvg: 0 } };
    case "unlistedStock":
      return { ...base, kind, shares: 0 };
    case "insurance":
    case "retirement":
      return { ...base, kind, amount: 0, recipientId };
    default:
      return { ...base, kind, amount: 0 } as Asset;
  }
}

/** 財産の種類ごとに、評価の根拠になる書類（資料集めのチェックと連動） */
export { DOC_OF, assetHasDoc } from "@/lib/assetDocs";

/** 財産の分類（上の集計と、一覧のまとまりの順） */
const GROUPS: { label: string; kinds: AssetKind[] }[] = [
  { label: "土地・建物", kinds: ["land", "building", "condo"] },
  { label: "預貯金・現金", kinds: ["deposit", "cash"] },
  { label: "株式", kinds: ["listedStock", "unlistedStock"] },
  { label: "保険金・退職金", kinds: ["insurance", "retirement"] },
  { label: "その他", kinds: ["household", "other"] },
];

const PLACEHOLDER: Record<AssetKind, string> = {
  deposit: "〇〇銀行 △△支店 普通預金",
  cash: "手元の現金",
  land: "自宅の土地（〇〇市〇〇町1番2）",
  building: "自宅の建物",
  condo: "〇〇マンション 305号室",
  listedStock: "〇〇株式会社 株式",
  unlistedStock: "〇〇株式会社（非上場）株式",
  insurance: "〇〇生命 死亡保険金",
  retirement: "〇〇株式会社 死亡退職金",
  household: "家具・家電など",
  other: "貸付金・自動車など",
};

/** 聞き取りで「ある」と答えたのに、まだ登録していない財産 */
function fromHearing(iv: Interview, assets: Asset[]): { label: string; kinds: AssetKind[]; amount: number }[] {
  const has = (k: AssetKind[]) => assets.some((a) => k.includes(a.kind));
  const out: { label: string; kinds: AssetKind[]; amount: number }[] = [];
  if (iv.homeValue > 0 && !has(["land", "building", "condo"])) out.push({ label: "自宅", kinds: ["land", "building", "condo"], amount: iv.homeValue });
  if (iv.otherRealEstate > 0 && assets.filter((a) => ["land", "building", "condo"].includes(a.kind)).length < (iv.homeValue > 0 ? 2 : 1))
    out.push({ label: "自宅以外の土地・建物", kinds: ["land", "building", "condo"], amount: iv.otherRealEstate });
  if (iv.deposits > 0 && !has(["deposit", "cash"])) out.push({ label: "預貯金・現金", kinds: ["deposit", "cash"], amount: iv.deposits });
  if (iv.securities > 0 && !has(["listedStock", "unlistedStock"])) out.push({ label: "株式・投資信託", kinds: ["listedStock", "unlistedStock"], amount: iv.securities });
  if (iv.insurance > 0 && !has(["insurance"])) out.push({ label: "生命保険金", kinds: ["insurance"], amount: iv.insurance });
  if (iv.otherAssets > 0 && !has(["household", "other"])) out.push({ label: "その他の財産", kinds: ["other", "household"], amount: iv.otherAssets });
  return out;
}

export function AssetsStep() {
  const { data, update, result } = useCase();
  const { done, iv } = usePlan();
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLLIElement | null>>({});
  const fromLink = useRef(false);
  // 開いた・閉じた行。上の行が閉じて縮むと、押した行が画面のずっと上へ行くので、見える位置に戻す
  const toggled = useRef<string | null>(null);
  const toggle = (id: string, next: string | null) => {
    toggled.current = id;
    setOpenId(next);
  };
  const living = data.persons.filter((p) => !p.predeceased);
  const noHeirs = living.length === 0;

  // 地図の画面で「反映」して戻ってきたら、その土地を開いて知らせる
  const [applied, setApplied] = useState<string | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get("asset");
    if (!id) return;
    setOpenId(id);
    fromLink.current = true;
    setScrollTo(id);
    if (sp.get("applied")) {
      setApplied(id);
      window.history.replaceState(null, "", window.location.pathname);
      const t = setTimeout(() => setApplied(null), 6000);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    if (!scrollTo) return;
    const el = refs.current[scrollTo];
    if (el) {
      // 「直す」リンクや地図から来たときは、枠で目立たせる
      if (fromLink.current) flashInto(el);
      else el.scrollIntoView({ behavior: "smooth", block: "start" });
      fromLink.current = false;
      el.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      setScrollTo(null);
    }
  }, [scrollTo, data.assets]);

  useEffect(() => {
    const el = toggled.current ? refs.current[toggled.current] : null;
    toggled.current = null;
    if (el) revealBelowHeader(el);
  }, [openId]);

  const add = (kind: AssetKind) => {
    // 保険金・退職金の受取人は空のまま始め、本人に選んでもらう（最初の人に勝手に割り当てない）
    const a = blankAsset(kind);
    update((c) => ({ ...c, assets: [...c.assets, a] }));
    setOpenId(a.id);
    setScrollTo(a.id);
    setMenu(false);
  };
  const patch = <T extends Asset>(id: string, p: Partial<T>) =>
    update((c) => ({ ...c, assets: c.assets.map((a) => (a.id === id ? ({ ...a, ...p } as Asset) : a)) }));
  const remove = (id: string) =>
    update((c) => ({ ...c, assets: c.assets.filter((a) => a.id !== id), allocations: c.allocations.filter((a) => a.assetId !== id) }));

  const valueOf = (id: string) => result?.assets.find((l) => l.asset.id === id);
  // 評価の根拠になる書類が、資料集めでまだそろっていない財産の数
  const hasDoc = (a: Asset) => assetHasDoc(a, data.assets, done);
  const missingDocs = data.assets.filter((a) => DOC_OF[a.kind] && !hasDoc(a)).length;
  const total = result?.assets.reduce((a, l) => a + l.valuation.value, 0) ?? 0;

  return (
    <div className="space-y-4 pb-4">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {GROUPS.map((g) => {
          const items = data.assets.filter((a) => g.kinds.includes(a.kind));
          const sum = items.reduce((s, a) => s + (valueOf(a.id)?.valuation.value ?? 0), 0);
          return (
            <li key={g.label} className="rounded-xl border border-stone-200 bg-white px-3 py-2">
              <p className="text-xs font-semibold text-stone-500">{g.label}</p>
              <p className="font-bold tabular-nums text-stone-900">{items.length ? `${fmt(sum)}円` : "—"}</p>
              <p className="text-[11px] text-stone-500">{items.length}件</p>
            </li>
          );
        })}
      </ul>

      {noHeirs && (
        <Note tone="warn">
          先に
          <Link href="/case/heirs" className="mx-1 font-semibold underline">
            相続人
          </Link>
          を登録してください（保険金の受取人や分け方で選ぶため）。
        </Note>
      )}

      {fromHearing(iv, data.assets).length > 0 && (
        <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
          <p className="font-bold text-sky-950">聞き取りで答えた財産（未登録）</p>
          <p className="mt-0.5 text-xs text-stone-600">書類で正しい額を入れてください。</p>
          <ul className="mt-2 space-y-2">
            {fromHearing(iv, data.assets).map((h) => (
              <li key={h.label} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-40 font-semibold text-stone-800">{h.label}</span>
                <span className="text-stone-500">目安 {fmt(h.amount)}円</span>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {h.kinds.map((k) => (
                    <button key={k} type="button" onClick={() => add(k)} className="rounded-full border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100">
                      ＋ {kindLabel(k)}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-sm text-stone-600">
        残高証明書は
        <Link href="/my/docs" className="mx-1 text-sky-800 underline">
          資料集め
        </Link>
        から読み取って登録できます。
        {/* 書類の印は行ごとに出さず、まだの件数をここに1回だけ出す（パソコンのみ。そろった行には「書類あり」） */}
        {missingDocs > 0 && <span className="ml-1 hidden sm:inline">（書類まだ {missingDocs}件）</span>}
      </p>

      {/* 空のときは1行だけ。すぐ下に「財産を追加」のボタンがある */}
      {data.assets.length === 0 && <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">まだ財産がありません。</p>}

      {/* 種類ごとにまとめて並べる（上の集計と同じ順）。種類の見出しで区切り、色は使わない */}
      <div className="space-y-5">
        {GROUPS.map((g) => {
          const xs = data.assets.filter((a) => g.kinds.includes(a.kind));
          if (xs.length === 0) return null;
          return (
            <section key={g.label} aria-label={g.label}>
              <h3 className="mb-2 flex items-baseline gap-2 border-b border-stone-200 pb-1 text-sm font-bold text-stone-700">
                {g.label}
                <span className="text-xs font-normal text-stone-500">{xs.length}件</span>
              </h3>
      <ul className="space-y-2">
        {xs.map((a) => {
          const line = valueOf(a.id);
          const open = openId === a.id;
          const docId = DOC_OF[a.kind];
          const got = docId ? hasDoc(a) : null;
          const missingRecipient = (a.kind === "insurance" || a.kind === "retirement") && !living.some((p) => p.id === a.recipientId);
          return (
            <li
              key={a.id}
              ref={(el) => {
                refs.current[a.id] = el;
              }}
              className={`scroll-mt-40 rounded-xl border bg-white ${open ? "border-sky-400 shadow-md" : "border-stone-200"}`}
              data-focus={`asset-${a.id}`}
            >
              <button type="button" onClick={() => toggle(a.id, open ? null : a.id)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left sm:gap-3">
                {/* スマートフォンでは種類を絵だけにして、名称に1行を使う */}
                <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-stone-100 px-2 py-1 text-xs font-medium text-stone-700 sm:w-28">
                  <AssetIcon k={a.kind} className="h-4 w-4 shrink-0" />
                  <span className="sr-only sm:hidden">{kindLabel(a.kind)}</span>
                  <span className="hidden truncate sm:inline">{kindLabel(a.kind)}</span>
                </span>
                {/* スマートフォンでは、印（確認待ちなど）と評価額を名称の下に回して横にはみ出さないようにする */}
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`min-w-0 grow basis-full truncate font-semibold sm:basis-0 ${a.label ? "text-stone-900" : "text-stone-400"}`}>{a.label || "（名称未入力）"}</span>
                  {missingRecipient && <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800">受取人が未設定</span>}
                  {got && <span className="hidden shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-500 sm:inline">書類あり</span>}
                  {(a.pending?.length || line?.valuation.needsConsultation) && <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800">確認待ち</span>}
                  <span className="ml-auto shrink-0 text-right font-bold tabular-nums text-teal-800 sm:w-32">{line?.valuation.needsConsultation ? <span className="text-sm text-orange-700">入力待ち</span> : line ? `${fmt(line.valuation.value)}円` : "—"}</span>
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-stone-400 transition ${open ? "rotate-180" : ""}`} aria-hidden />
              </button>
              {open && (
                <div className="space-y-3 border-t border-stone-100 px-4 py-4">
                  {docId && (
                    <Check
                      checked={!!a.docFrom}
                      onChange={(v) => update((c) => ({ ...c, assets: c.assets.map((x) => (x.id === a.id ? { ...x, docFrom: v ? x.docFrom || "手元にあり" : undefined } : x)) }))}
                      label={a.docFrom && a.docFrom !== "手元にあり" ? `この財産の書類あり（${a.docFrom} から読み取り）` : "この財産の書類（残高証明書・評価証明書など）が手元にある"}
                    />
                  )}
                  {a.pending && a.pending.length > 0 && (
                    <Note tone="warn">
                      <p className="font-semibold">書類から読み取って登録しました。次の項目を確かめて入れてください。</p>
                      <ul className="mt-1 list-disc pl-5">
                        {a.pending.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                      <button type="button" onClick={() => patch(a.id, { pending: undefined })} className="mt-2 rounded-lg border border-amber-400 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                        入れて確かめました
                      </button>
                    </Note>
                  )}
                  {/* 評価額を出せない理由は、長い入力欄の下ではなく、開いてすぐ見える上に出す */}
                  {line?.valuation.needsConsultation && (
                    <div data-missing>
                      <Note tone="stop">{line.valuation.needsConsultation}</Note>
                    </div>
                  )}
                  {applied === a.id && <Note tone="ok">地図で入れた土地の形と路線価を反映しました。評価額は {line ? `${fmt(line.valuation.value)}円` : "計算中"} です。</Note>}
                  {missingRecipient && noHeirs && (
                    <Note tone="warn">
                      受取人を選ぶには、先に相続人を登録してください。
                      <Link href="/case/heirs" className="ml-1 font-semibold underline">
                        相続人の登録へ
                      </Link>
                    </Note>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="名称">
                      <TextInput value={a.label} onChange={(e) => patch(a.id, { label: e.target.value })} placeholder={PLACEHOLDER[a.kind]} />
                    </Field>
                    <AssetEditor living={living} asset={a} patch={(p) => patch(a.id, p)} division={data} />
                  </div>
                  {line && line.valuation.steps.length > 0 && (
                    <details className="text-sm text-stone-600">
                      <summary className="cursor-pointer font-medium text-teal-800">評価の計算過程</summary>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {line.valuation.steps.map((s, i) => (
                          <li key={`${i}:${s}`}>{s}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {a.foreign && <Note tone="stop">国外財産は自動で申告書を完成できません。税理士にご相談ください。</Note>}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Check checked={!!a.foreign} onChange={(v) => patch(a.id, { foreign: v })} label="国外にある財産" />
                    <div className="flex gap-2">
                      <Button variant="danger" onClick={() => remove(a.id)}>
                        削除
                      </Button>
                      <Button variant="secondary" onClick={() => toggle(a.id, null)}>
                        閉じる
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
            </section>
          );
        })}
      </div>

      {data.assets.length > 0 && (
        <Note tone="ok">
          財産の合計（特例・非課税枠を引く前）：<strong className="tabular-nums">{fmt(total)}円</strong>
        </Note>
      )}

      {/* 追加ボタンは画面の下に追従させる（ボタンとメニューのほかは、下の行を押せるよう素通しにする） */}
      <div className="pointer-events-none sticky bottom-3 z-20 flex justify-end">
        <div className="pointer-events-auto relative">
          {menu && (
            <div className="absolute bottom-full right-0 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-stone-200 bg-white p-3 shadow-xl">
              <p className="px-1 pb-2 text-xs font-semibold text-stone-500">追加する財産の種類</p>
              <div className="grid grid-cols-3 gap-2">
                {KINDS.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => add(k.kind)}
                    className="flex flex-col items-center gap-1 rounded-xl border border-stone-100 bg-stone-50/60 px-1 py-2.5 text-center text-xs font-semibold text-stone-700 hover:border-brand hover:bg-brand-soft"
                  >
                    <AssetIcon k={k.kind} className="h-6 w-6" />
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button type="button" onClick={() => setMenu((m) => !m)} className="flex items-center gap-1.5 rounded-full bg-sky-700 px-5 py-3 font-bold text-white shadow-lg hover:bg-sky-800">
            <Plus className="h-5 w-5" aria-hidden />
            財産を追加
          </button>
        </div>
      </div>
    </div>
  );
}

/** 家賃をもらわずに貸しているもの（使用貸借）は「貸している」にあたらないことの短い案内（くわしくは土地の Tips） */
const FREE_LENDING_HINT = "家族に無料（固定資産税くらいを受け取るだけも同じ）で貸しているなら、チェックしません。";

export function AssetEditor({
  living,
  asset: a,
  patch,
  division,
}: {
  living: Person[];
  asset: Asset;
  patch: (p: Partial<Asset>) => void;
  /** 遺産の分け方（小規模宅地等の特例の案内に使う） */
  division?: DivisionInput;
}) {
  switch (a.kind) {
    case "deposit":
    case "cash":
    case "household":
    case "other":
      return (
        <>
          <Field label={a.kind === "deposit" ? "亡くなった日の残高" : "金額"}>
            <YenInput value={a.amount} onChange={(v) => patch({ amount: v })} />
          </Field>
          {a.kind === "other" && <ReceivableOnAsset value={a.receivable} onChange={(r) => patch({ receivable: r } as Partial<Asset>)} />}
          {a.kind === "deposit" && (
            <Field label="亡くなった日までの利息（税引後）" hint="残高証明書に書いてあります">
              <YenInput value={a.accruedInterest ?? 0} onChange={(v) => patch({ accruedInterest: v })} />
            </Field>
          )}
          {a.kind === "deposit" && (
            <>
              <Field label="金融機関名">
                <TextInput value={a.institution ?? ""} onChange={(e) => patch({ institution: e.target.value })} placeholder="みほん銀行" />
              </Field>
              <Field label="支店名">
                <TextInput value={a.branch ?? ""} onChange={(e) => patch({ branch: e.target.value })} placeholder="架空支店" />
              </Field>
              <Field label="口座の種類">
                <TextInput value={a.accountType ?? ""} onChange={(e) => patch({ accountType: e.target.value })} placeholder="普通預金" />
              </Field>
            </>
          )}
        </>
      );
    case "insurance":
    case "retirement":
      return (
        <>
          <Field label="受取金額">
            <YenInput value={a.amount} onChange={(v) => patch({ amount: v })} />
          </Field>
          <Field label="受取人">
            <Select value={a.recipientId} onChange={(v) => patch({ recipientId: v })} options={[{ value: "", label: living.length ? "選んでください" : "（相続人が未登録）" }, ...living.map((p) => ({ value: p.id, label: `${p.name || "氏名未入力"}（${p.relationLabel ?? p.relation}）` }))]} />
          </Field>
        </>
      );
    case "building":
      return (
        <>
          <Field label="所在・家屋番号">
            <TextInput value={a.location} onChange={(e) => patch({ location: e.target.value })} />
          </Field>
          <Field label="固定資産税評価額" hint="課税明細書の「評価額」の欄です">
            <YenInput value={a.fixedAssetValue} onChange={(v) => patch({ fixedAssetValue: v })} />
          </Field>
          <div className="space-y-1 sm:col-span-2">
            {/* 家賃をもらって貸している家屋（貸家）は、借りている人の権利の分だけ低く評価する。無料で貸している（使用貸借）なら自用家屋。やめたら賃貸割合は残さない */}
            <Check checked={!!a.rented} onChange={(v) => patch({ rented: v || undefined, rentRatio: v ? a.rentRatio : undefined })} label="家賃をもらって人に貸している" />
            <p className="text-xs text-stone-500">{FREE_LENDING_HINT}</p>
          </div>
          {a.rented && <RentRatioField value={a.rentRatio} onChange={(v) => patch({ rentRatio: v })} />}
        </>
      );
    case "listedStock":
      return (
        <>
          <Field label="株数">
            <NumInput value={a.shares} onChange={(v) => patch({ shares: v })} unit="株" />
          </Field>
          {(
            [
              ["close", "亡くなった日の終値"],
              ["monthAvg", "亡くなった月の終値平均"],
              ["prevMonthAvg", "前月の終値平均"],
              ["prev2MonthAvg", "前々月の終値平均"],
            ] as const
          ).map(([k, l]) => (
            <Field key={k} label={l} hint={k === "close" ? "小数もそのまま入れます（例：1523.5）" : undefined}>
              <NumInput value={a.prices[k]} onChange={(v) => patch({ prices: { ...a.prices, [k]: v } })} unit="円" />
            </Field>
          ))}
        </>
      );
    case "unlistedStock":
      return (
        <>
          <Field label="株数">
            <NumInput value={a.shares} onChange={(v) => patch({ shares: v })} unit="株" />
          </Field>
          <Field label="評価額（税理士が計算した額）" hint="相続コンパスでは計算できません">
            <YenInput value={a.value} onChange={(v) => patch({ value: v || undefined })} />
          </Field>
        </>
      );
    case "condo":
      return (
        <>
          <Field label="所在">
            <TextInput value={a.location} onChange={(e) => patch({ location: e.target.value })} />
          </Field>
          <Field label="敷地利用権の自用地評価額（補正前）" hint="路線価×敷地全体の面積×敷地権の割合">
            <YenInput value={a.landValueBeforeCorrection} onChange={(v) => patch({ landValueBeforeCorrection: v })} />
          </Field>
          <Field label="区分所有建物の固定資産税評価額">
            <YenInput value={a.buildingFixedAssetValue} onChange={(v) => patch({ buildingFixedAssetValue: v })} />
          </Field>
          <Field label="築年数（年・月）">
            <div className="grid grid-cols-2 gap-2">
              <NumInput value={a.builtYearsMonths.years} onChange={(v) => patch({ builtYearsMonths: { ...a.builtYearsMonths, years: v } })} unit="年" />
              <NumInput value={a.builtYearsMonths.months} onChange={(v) => patch({ builtYearsMonths: { ...a.builtYearsMonths, months: v } })} unit="月" />
            </div>
          </Field>
          <Field label="総階数（地階を除く）／所在階">
            <div className="grid grid-cols-2 gap-2">
              <NumInput value={a.totalFloors} onChange={(v) => patch({ totalFloors: v })} unit="階建" />
              <NumInput value={a.floor} onChange={(v) => patch({ floor: v })} unit="階" />
            </div>
          </Field>
          <Field label="敷地利用権の面積／専有部分の面積" hint="敷地の面積×敷地権の割合（小数点以下第3位切上げ）">
            <div className="grid grid-cols-2 gap-2">
              <NumInput value={a.landShareSqm} onChange={(v) => patch({ landShareSqm: v })} unit="㎡" />
              <NumInput value={a.exclusiveAreaSqm} onChange={(v) => patch({ exclusiveAreaSqm: v })} unit="㎡" />
            </div>
          </Field>
          <div className="space-y-1 sm:col-span-2">
            <Check
              checked={!!a.fewUnitsFamily}
              onChange={(v) => patch({ fewUnitsFamily: v || undefined })}
              label="住まい用の部屋が3室以下で、全部を亡くなった方か親族が住まいに使っている（二世帯住宅など）"
            />
            <p className="text-xs text-stone-500">分からなければ税理士に確認してください。</p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Check
              checked={!!a.rented}
              onChange={(v) => {
                // 貸しているかで特例の種類（貸付事業用）が変わるので、前の種類のための答えは引き継がない
                const p = { rented: v || undefined, rentRatio: v ? a.rentRatio : undefined };
                patch({ ...p, ...resetSmallOnKindChange(a, p) });
              }}
              label="家賃をもらって人に貸している"
            />
            <p className="text-xs text-stone-500">{FREE_LENDING_HINT}</p>
          </div>
          {a.rented && (
            <>
              <RentRatioField value={a.rentRatio} onChange={(v) => patch({ rentRatio: v })} />
              <LeaseRatioSelect value={a.leaseRatio} onChange={(v) => patch({ leaseRatio: v })} hint="マンションの敷地の路線価の記号です（例：420D の D）。倍率地域は評価倍率表の「借地権割合」の欄" />
            </>
          )}
          <SmallResidential living={living} a={a} patch={patch} division={division} />
        </>
      );
    case "land":
      return <LandEditor living={living} a={a} patch={patch} division={division} />;
  }
}

/** その他の財産：亡くなったあとに受け取るお金なら、種類と日付で相続財産かを判定する */
function ReceivableOnAsset({ value, onChange }: { value?: Receivable; onChange: (r: Receivable | undefined) => void }) {
  const { data } = useCase();
  return (
    <div className="space-y-2 sm:col-span-2">
      <Field label="亡くなったあとに受け取るお金ですか">
        <Select
          value={value?.type ?? ""}
          onChange={(v) => onChange(v ? { type: v as Receivable["type"], receivedOn: value?.receivedOn } : undefined)}
          options={[{ value: "", label: "ちがう" }, ...RECEIVABLE_TYPES.map((d) => ({ value: d.type, label: d.label }))]}
        />
      </Field>
      {value && (
        <>
          <ReceivableFields r={value} onChange={onChange} />
          <VerdictLine r={value} deathDate={data.decedent.deathDate} />
        </>
      )}
    </div>
  );
}
