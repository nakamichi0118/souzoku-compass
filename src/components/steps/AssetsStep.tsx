"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Check, Field, NumInput, Note, Select, TextInput, YenInput, fmt } from "@/components/ui";
import type { Asset, AssetKind, LandAsset, Person } from "@/domain/types";
import { DISTRICTS, type District } from "@/domain/valuation/depth";
import { type Edge, type RoadInput, evaluateRoads } from "@/domain/valuation/roads";
import { newId, useCase } from "@/lib/store";
import { usePlan } from "@/lib/planStore";
import { AssetIcon } from "@/components/my/icons";
import { Choice } from "@/components/plan/inputs";
import { ConsultLink } from "@/components/compass/ConsultLink";
import { type Answer, type SmallResidentialCheck, judgeSmallResidential, shouldApply } from "@/domain/valuation/smallResidential";
import type { Interview } from "@/domain/procedures/interview";

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
        totalFloors: 1,
        floor: 1,
        landShareSqm: 0,
        exclusiveAreaSqm: 1,
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
const DOC_OF: Partial<Record<AssetKind, string>> = { land: "hyokaCert", building: "hyokaCert", condo: "hyokaCert", deposit: "balanceCert", listedStock: "securitiesCert", insurance: "insurancePay" };
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
  const living = data.persons.filter((p) => !p.predeceased);
  const noHeirs = living.length === 0;

  // 地図の画面で「反映」して戻ってきたら、その土地を開いて知らせる
  const [applied, setApplied] = useState<string | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get("asset");
    if (!id) return;
    setOpenId(id);
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
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      setScrollTo(null);
    }
  }, [scrollTo, data.assets]);

  const add = (kind: AssetKind) => {
    const a = blankAsset(kind, living[0]?.id);
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
          まだ相続人が登録されていません。保険金の受取人や遺産の分け方で相続人を選ぶので、先に
          <Link href="/case/heirs" className="mx-1 font-semibold underline">
            相続人の登録
          </Link>
          をしておくとスムーズです。
        </Note>
      )}

      {fromHearing(iv, data.assets).length > 0 && (
        <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
          <p className="font-bold text-sky-950">聞き取りで答えた財産を登録しましょう</p>
          <p className="mt-0.5 text-xs text-stone-600">金額は聞き取りのときの目安です。書類を見て正確な金額を入れてください。</p>
          <ul className="mt-2 space-y-2">
            {fromHearing(iv, data.assets).map((h) => (
              <li key={h.label} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-40 font-semibold text-stone-800">{h.label}</span>
                <span className="text-stone-500">目安 {fmt(h.amount)}円</span>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {h.kinds.map((k) => (
                    <button key={k} type="button" onClick={() => add(k)} className="rounded-full border border-sky-300 bg-white px-3 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100">
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
        行をクリックすると、内容の入力・評価の計算過程が開きます。残高証明書などは
        <Link href="/my/docs" className="mx-1 text-sky-800 underline">
          資料集め
        </Link>
        からアップロードすると、読み取って登録できます。
      </p>

      {data.assets.length === 0 && <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-500">まだ財産がありません。下の「財産を追加」から登録してください。</p>}

      <ul className="space-y-2">
        {data.assets.map((a) => {
          const line = valueOf(a.id);
          const open = openId === a.id;
          const docId = DOC_OF[a.kind];
          const got = docId ? done.includes(`doc:${docId}`) : null;
          const missingRecipient = (a.kind === "insurance" || a.kind === "retirement") && !living.some((p) => p.id === a.recipientId);
          return (
            <li
              key={a.id}
              ref={(el) => {
                refs.current[a.id] = el;
              }}
              className={`scroll-mt-40 rounded-xl border bg-white ${open ? "border-sky-400 shadow-sm" : "border-stone-200"}`}
            >
              <button type="button" onClick={() => setOpenId(open ? null : a.id)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="flex w-28 shrink-0 items-center gap-1.5 rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                  <AssetIcon k={a.kind} className="h-4 w-4 shrink-0" />
                  <span className="truncate">{kindLabel(a.kind)}</span>
                </span>
                <span className={`min-w-0 flex-1 truncate font-semibold ${a.label ? "text-stone-900" : "text-stone-400"}`}>{a.label || "（名称未入力）"}</span>
                {missingRecipient && <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800">受取人が未設定</span>}
                {docId && (
                  <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold sm:inline ${got ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}`}>
                    {got ? "書類あり" : "書類まだ"}
                  </span>
                )}
                {(a.pending?.length || line?.valuation.needsConsultation) && <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800">確認待ち</span>}
                <span className="w-32 shrink-0 text-right font-bold tabular-nums text-teal-800">{line?.valuation.needsConsultation ? <span className="text-sm text-orange-700">入力待ち</span> : line ? `${fmt(line.valuation.value)}円` : "—"}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-stone-400 transition ${open ? "rotate-180" : ""}`} aria-hidden />
              </button>
              {open && (
                <div className="space-y-3 border-t border-stone-100 px-4 py-4">
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
                    <AssetEditor living={living} asset={a} patch={(p) => patch(a.id, p)} />
                  </div>
                  {line && line.valuation.steps.length > 0 && (
                    <details className="text-sm text-stone-600">
                      <summary className="cursor-pointer font-medium text-teal-800">評価の計算過程</summary>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {line.valuation.steps.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {line?.valuation.needsConsultation && <Note tone="stop">{line.valuation.needsConsultation}</Note>}
                  {a.foreign && <Note tone="stop">国外財産は自動で申告書を完成できません。税理士にご相談ください。</Note>}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Check checked={!!a.foreign} onChange={(v) => patch(a.id, { foreign: v })} label="国外にある財産" />
                    <div className="flex gap-2">
                      <Button variant="danger" onClick={() => remove(a.id)}>
                        削除
                      </Button>
                      <Button variant="secondary" onClick={() => setOpenId(null)}>
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

      {data.assets.length > 0 && (
        <Note tone="ok">
          登録した財産の評価額の合計（小規模宅地等の特例・非課税枠を適用する前）：<strong className="tabular-nums">{fmt(total)}円</strong>
        </Note>
      )}

      {/* 追加ボタンは画面の下に追従させる */}
      <div className="sticky bottom-3 z-20 flex justify-end">
        <div className="relative">
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
              {noHeirs && <p className="mt-1 px-2 text-[11px] text-orange-700">保険金・退職金の受取人は、相続人を登録してから選べます。</p>}
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

function AssetEditor({
  living,
  asset: a,
  patch,
}: {
  living: Person[];
  asset: Asset;
  patch: (p: Partial<Asset>) => void;
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
          {a.kind === "deposit" && (
            <Field label="既経過利息（税引後）" hint="定期預金などは、亡くなった日までの利息も財産です。銀行の残高証明書に記載されます。">
              <YenInput value={a.accruedInterest ?? 0} onChange={(v) => patch({ accruedInterest: v })} />
            </Field>
          )}
          {a.kind === "deposit" && (
            <>
              <Field label="金融機関名" hint="申告書（第11表の付表3）に記載します">
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
          <Field label="固定資産税評価額" hint="固定資産税の課税明細書に記載。家屋の評価額は固定資産税評価額×1.0です">
            <YenInput value={a.fixedAssetValue} onChange={(v) => patch({ fixedAssetValue: v })} />
          </Field>
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
            <Field key={k} label={l}>
              <YenInput value={a.prices[k]} onChange={(v) => patch({ prices: { ...a.prices, [k]: v } })} />
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
          <Field label="評価額（税理士等が算定したもの）" hint="非上場株式の評価は専門的なため、相続コンパスでは評価額の入力のみ受け付けます">
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
            <div className="flex gap-2">
              <NumInput value={a.builtYearsMonths.years} onChange={(v) => patch({ builtYearsMonths: { ...a.builtYearsMonths, years: v } })} unit="年" />
              <NumInput value={a.builtYearsMonths.months} onChange={(v) => patch({ builtYearsMonths: { ...a.builtYearsMonths, months: v } })} unit="月" />
            </div>
          </Field>
          <Field label="総階数（地階を除く）／所在階">
            <div className="flex gap-2">
              <NumInput value={a.totalFloors} onChange={(v) => patch({ totalFloors: v })} unit="階建" />
              <NumInput value={a.floor} onChange={(v) => patch({ floor: v })} unit="階" />
            </div>
          </Field>
          <Field label="敷地利用権の面積／専有部分の面積" hint="敷地利用権の面積＝敷地の面積×敷地権の割合（小数点以下第3位切上げ）">
            <div className="flex gap-2">
              <NumInput value={a.landShareSqm} onChange={(v) => patch({ landShareSqm: v })} unit="㎡" />
              <NumInput value={a.exclusiveAreaSqm} onChange={(v) => patch({ exclusiveAreaSqm: v })} unit="㎡" />
            </div>
          </Field>
          <SmallResidential living={living} a={a} patch={patch} />
        </>
      );
    case "land":
      return <LandEditor living={living} a={a} patch={patch} />;
  }
}

const ANSWERS: { value: Answer; label: string }[] = [
  { value: "yes", label: "はい" },
  { value: "no", label: "いいえ" },
  { value: "unsure", label: "わからない" },
];

function SmallResidential({ living, a, patch }: { living: Person[]; a: Extract<Asset, { kind: "land" | "condo" }>; patch: (p: Partial<Asset>) => void }) {
  const sr = a.smallResidential ?? { applies: false };
  const check: SmallResidentialCheck = sr.check ?? {};
  const acquirer = living.find((p) => p.id === sr.acquirerId);
  const j = judgeSmallResidential(check, acquirer);
  const set = (next: { acquirerId?: string; check?: SmallResidentialCheck }) => {
    const acq = next.acquirerId ?? sr.acquirerId;
    const c = next.check ?? check;
    const jj = judgeSmallResidential(c, living.find((p) => p.id === acq));
    patch({ smallResidential: { ...sr, acquirerId: acq, check: c, applies: shouldApply(jj, c) } });
  };
  const ask = (k: keyof SmallResidentialCheck, q: string, hint?: string) => (
    <div className="space-y-1">
      <p className="text-sm font-medium text-stone-800">{q}</p>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
      <Choice value={check[k] as Answer | undefined} onChange={(v) => set({ check: { ...check, [k]: v, confirmedByAdvisor: false } })} options={ANSWERS} />
    </div>
  );
  const isSpouse = acquirer?.relation === "spouse";
  const tone = j.result === "ok" ? "ok" : j.result === "consult" ? "warn" : j.result === "no" ? "info" : null;
  return (
    <div className="space-y-3 rounded-lg bg-stone-50 p-3 sm:col-span-2">
      <p className="font-bold text-stone-800">小規模宅地等の特例（自宅の敷地の評価が最大80%下がる）</p>
      <p className="text-xs text-stone-500">使えるかどうかを順に確認します。条件がはっきりしない場合は特例を使わずに計算し、税理士への相談をご案内します。</p>
      {ask("ownHome", "亡くなった方が住んでいた自宅の敷地ですか？")}
      {check.ownHome === "yes" &&
        ask("special", "老人ホームへの入居、二世帯住宅、建物の一部を貸していた などの事情はありますか？", "亡くなる前に老人ホームへ入っていた場合や、二世帯住宅の場合は、使える範囲の判断が変わります。")}
      {check.ownHome === "yes" && check.special === "no" && (
        <Field label="この土地を取得する人" hint="遺産の分け方で決めた人を選んでください。">
          <Select value={sr.acquirerId ?? ""} onChange={(v) => set({ acquirerId: v })} options={[{ value: "", label: "選んでください" }, ...living.map((p) => ({ value: p.id, label: `${p.name || "（未入力）"}（${p.relationLabel ?? ""}）` }))]} />
        </Field>
      )}
      {check.ownHome === "yes" && check.special === "no" && acquirer && !isSpouse && (
        <>
          {ask("livedTogether", `${acquirer.name || "取得する人"}さんは、亡くなる直前まで亡くなった方と同じ家に住んでいましたか？`, "住民票が同じでも、実際に一緒に暮らしていなければ「いいえ」です。")}
          {check.livedTogether === "yes" && ask("keep", "申告期限（亡くなった日から10か月）まで、この家に住み続け、土地を持ち続けますか？")}
        </>
      )}
      {tone && <Note tone={tone}>{j.reason}</Note>}
      {j.result === "ok" && <p className="text-xs text-stone-600">330㎡までの部分の評価額を80%減らして計算します（租税特別措置法69条の4）。</p>}
      {j.result === "consult" && (
        <div className="space-y-2">
          <p className="text-sm text-stone-700">いまは特例を使わずに（高めに）計算しています。</p>
          <div className="flex flex-wrap items-center gap-3">
            <ConsultLink topic="特例" />
            <Check checked={!!check.confirmedByAdvisor} onChange={(v) => set({ check: { ...check, confirmedByAdvisor: v } })} label="税理士に確認し、特例を使えることが分かった" />
          </div>
        </div>
      )}
    </div>
  );
}

type RosenkaMethod = Extract<LandAsset["method"], { type: "rosenka" }>;
const EDGE_LABEL = ["正面側", "右側", "奥側", "左側"];

/** 面している道路ごとの路線価と奥行。2つ以上なら側方・二方路線影響加算（高めに評価） */
function RoadsEditor({ a, m, patch }: { a: LandAsset; m: RosenkaMethod; patch: (p: Partial<Asset>) => void }) {
  const district: District = m.district ?? "普通住宅地区";
  // 以前の入力（道路が1つ・奥行価格補正率を直接入力）は、正面の道路1つとして見せる
  const roads: RoadInput[] = m.roads?.length ? m.roads : [{ edge: 0, price: m.routePrice, depth: m.lot?.depth ?? 0 }];
  const save = (next: RoadInput[], d = district) => {
    const r = evaluateRoads(d, next);
    patch({ method: { ...m, district: d, roads: next, routePrice: r?.front.price ?? next[0]?.price ?? 0, depthCorrection: r?.front.depthRate ?? m.depthCorrection } });
  };
  const setRoad = (i: number, p: Partial<RoadInput>) => save(roads.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const used = new Set(roads.map((r) => r.edge));
  const free = ([0, 1, 2, 3] as Edge[]).filter((e) => !used.has(e));
  const ev = evaluateRoads(district, roads);
  const role = (e: Edge) => ev?.lines.find((l) => l.edge === e)?.role;
  return (
    <div className="space-y-3 sm:col-span-2">
      <Field label="地区区分" hint="路線価図で路線価を囲む記号の形で決まります（記号がなければ普通住宅地区）">
        <Select value={district} onChange={(v) => save(roads, v as District)} options={DISTRICTS.map((d) => ({ value: d, label: d }))} />
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-medium text-stone-700">面している道路と路線価</p>
        {roads.map((r, i) => (
          <div key={r.edge} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-stone-200 p-2 sm:grid-cols-[8rem_1fr_7rem_auto]">
            <Field label="道路の位置">
              <Select
                value={String(r.edge)}
                onChange={(v) => setRoad(i, { edge: Number(v) as Edge })}
                options={[r.edge, ...free].sort().map((e) => ({ value: String(e), label: EDGE_LABEL[e] }))}
              />
            </Field>
            <Field label={`路線価${role(r.edge) ? `（${{ front: "正面", side: "側方", back: "裏面" }[role(r.edge)!]}）` : ""}`}>
              <YenInput value={r.price} onChange={(v) => setRoad(i, { price: v })} unit="円/㎡" />
            </Field>
            <Field label="奥行">
              <NumInput value={r.depth} onChange={(v) => setRoad(i, { depth: v })} unit="m" />
            </Field>
            {roads.length > 1 ? (
              <Button variant="danger" onClick={() => save(roads.filter((_, j) => j !== i))}>
                削除
              </Button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {free.length > 0 && (
          <Button variant="secondary" onClick={() => save([...roads, { edge: free[0], price: 0, depth: free[0] % 2 === 0 ? roads[0]?.depth ?? 0 : m.lot?.width ?? 0 }])}>
            ＋ 道路を追加（角地・二方路線など）
          </Button>
        )}
        <p className="text-xs text-stone-500">路線価図の数字は千円単位です（例：「420D」→ 420,000円）。奥行は、その道路から土地の反対側までの距離です。</p>
      </div>
      {ev && (
        <div className="rounded-lg bg-teal-50 p-3 text-sm text-teal-950">
          <p className="font-semibold">1㎡あたり {fmt(ev.perSqm)}円</p>
          {ev.lines.length > 1 && <p className="text-xs">正面は、路線価×奥行価格補正率がいちばん高い道路です（財産評価基本通達16）。</p>}
        </div>
      )}
      <Note tone="info">
        この評価は<strong>高めに</strong>出しています（角地の加算率を使い、間口が狭い・奥行が長い・形がいびつ・がけ地などの減額はしていません）。減額できるかは税理士に確認できます。
        <span className="mt-2 block">
          <ConsultLink topic="土地の評価" />
        </span>
      </Note>
      <Field label="税理士に確認した補正率（任意）" hint="不整形地・間口狭小などの補正率を税理士に確認した場合だけ入力。通常は1">
        <NumInput value={m.otherCorrection ?? 1} onChange={(v) => patch({ method: { ...m, otherCorrection: v } })} />
      </Field>
      {a.method.type === "rosenka" && a.method.lot && <p className="text-xs text-stone-500">地図で合わせた枠：間口{a.method.lot.width}m × 奥行{a.method.lot.depth}m</p>}
    </div>
  );
}

function LandEditor({
  living,
  a,
  patch,
}: {
  living: Person[];
  a: LandAsset;
  patch: (p: Partial<Asset>) => void;
}) {
  const m = a.method;
  return (
    <>
      <Field label="所在地番">
        <TextInput value={a.location} onChange={(e) => patch({ location: e.target.value })} />
      </Field>
      <Field label="地積">
        <NumInput value={a.areaSqm} onChange={(v) => patch({ areaSqm: v })} unit="㎡" />
      </Field>
      <Field label="評価方法" hint="路線価図に道路の価格が書かれていれば路線価方式、倍率地域なら倍率方式です">
        <Select
          value={m.type}
          onChange={(v) =>
            patch({
              method:
                v === "rosenka"
                  ? { type: "rosenka", routePrice: 0, depthCorrection: 1 }
                  : v === "multiplier"
                    ? { type: "multiplier", fixedAssetValue: 0, multiplier: 1.1 }
                    : { type: "manual", value: 0 },
            })
          }
          options={[
            { value: "rosenka", label: "路線価方式" },
            { value: "multiplier", label: "倍率方式" },
            { value: "manual", label: "評価額を直接入力" },
          ]}
        />
      </Field>
      <div className="flex items-end">
        <Link href={`/case/map?asset=${a.id}`} className="rounded-lg border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50">
          地図で土地の形と路線価を入れる
        </Link>
      </div>
      {m.type === "rosenka" && <RoadsEditor a={a} m={m} patch={patch} />}
      {m.type === "multiplier" && (
        <>
          <Field label="固定資産税評価額">
            <YenInput value={m.fixedAssetValue} onChange={(v) => patch({ method: { ...m, fixedAssetValue: v } })} />
          </Field>
          <Field label="倍率" hint="国税庁の評価倍率表で確認します">
            <NumInput value={m.multiplier} step="0.1" onChange={(v) => patch({ method: { ...m, multiplier: v } })} />
          </Field>
        </>
      )}
      {m.type === "manual" && (
        <Field label="評価額">
          <YenInput value={m.value} onChange={(v) => patch({ method: { ...m, value: v } })} />
        </Field>
      )}
      <SmallResidential living={living} a={a} patch={patch} />
    </>
  );
}

