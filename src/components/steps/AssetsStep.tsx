"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Check, Field, NumInput, Note, Select, TextInput, YenInput, fmt } from "@/components/ui";
import type { Asset, AssetKind, LandAsset, Person } from "@/domain/types";
import { DISTRICTS, type District, depthCorrection } from "@/domain/valuation/depth";
import { newId, useCase } from "@/lib/store";
import { usePlan } from "@/lib/planStore";
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
  const [district, setDistrict] = useState<Record<string, { d: District; depth: number }>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLLIElement | null>>({});
  const living = data.persons.filter((p) => !p.predeceased);
  const noHeirs = living.length === 0;

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
                <span className="w-24 shrink-0 rounded bg-stone-100 px-2 py-0.5 text-center text-xs font-medium text-stone-700">{kindLabel(a.kind)}</span>
                <span className={`min-w-0 flex-1 truncate font-semibold ${a.label ? "text-stone-900" : "text-stone-400"}`}>{a.label || "（名称未入力）"}</span>
                {missingRecipient && <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800">受取人が未設定</span>}
                {docId && (
                  <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold sm:inline ${got ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}`}>
                    {got ? "書類あり" : "書類まだ"}
                  </span>
                )}
                <span className="w-32 shrink-0 text-right font-bold tabular-nums text-teal-800">{line ? `${fmt(line.valuation.value)}円` : "—"}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-stone-400 transition ${open ? "rotate-180" : ""}`} aria-hidden />
              </button>
              {open && (
                <div className="space-y-3 border-t border-stone-100 px-4 py-4">
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
                    <AssetEditor living={living} asset={a} patch={(p) => patch(a.id, p)} district={district[a.id]} setDistrict={(v) => setDistrict((s) => ({ ...s, [a.id]: v }))} />
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
            <div className="absolute bottom-full right-0 mb-2 w-72 rounded-xl border border-stone-200 bg-white p-2 shadow-xl">
              <p className="px-2 pb-1 text-xs text-stone-500">追加する財産の種類</p>
              <div className="grid grid-cols-2 gap-1">
                {KINDS.map((k) => (
                  <button key={k.kind} type="button" onClick={() => add(k.kind)} className="rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sky-50">
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
  district: dist,
  setDistrict: setDist,
}: {
  living: Person[];
  asset: Asset;
  patch: (p: Partial<Asset>) => void;
  district?: { d: District; depth: number };
  setDistrict: (v: { d: District; depth: number }) => void;
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
      return <LandEditor living={living} a={a} patch={patch} dist={dist} setDist={setDist} />;
  }
}

function SmallResidential({ living, a, patch }: { living: Person[]; a: Extract<Asset, { kind: "land" | "condo" }>; patch: (p: Partial<Asset>) => void }) {
  const sr = a.smallResidential ?? { applies: false };
  return (
    <div className="space-y-2 rounded-lg bg-stone-50 p-3 sm:col-span-2">
      <Check
        checked={sr.applies}
        onChange={(v) => patch({ smallResidential: { ...sr, applies: v, acquirerId: sr.acquirerId ?? living[0]?.id } })}
        label="亡くなった方が住んでいた自宅の敷地で、小規模宅地等の特例（特定居住用宅地等）を使う"
      />
      {sr.applies && (
        <>
          <Field label="特例を受ける取得者" hint="配偶者は無条件で適用できます。同居していた親族などは申告期限まで住み続け・所有し続けることが必要です。">
            <Select value={sr.acquirerId ?? ""} onChange={(v) => patch({ smallResidential: { ...sr, acquirerId: v } })} options={living.map((p) => ({ value: p.id, label: p.name || "（未入力）" }))} />
          </Field>
          <p className="text-xs text-stone-500">330㎡までの部分の評価額が80%減額されます（租税特別措置法69条の4）。</p>
        </>
      )}
    </div>
  );
}

function LandEditor({
  living,
  a,
  patch,
  dist,
  setDist,
}: {
  living: Person[];
  a: LandAsset;
  patch: (p: Partial<Asset>) => void;
  dist?: { d: District; depth: number };
  setDist: (v: { d: District; depth: number }) => void;
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
          地図で場所を選び、路線価図を確認する
        </Link>
      </div>
      {m.type === "rosenka" && (
        <>
          <Field label="路線価（1㎡あたり）" hint="路線価図の数字は千円単位です（例：「420D」→ 420,000円）">
            <YenInput value={m.routePrice} onChange={(v) => patch({ method: { ...m, routePrice: v } })} unit="円/㎡" />
          </Field>
          <Field label="地区区分と奥行距離" hint="奥行価格補正率を自動で求めます（財産評価基本通達 付表1）">
            <div className="flex gap-2">
              <Select
                value={dist?.d ?? "普通住宅地区"}
                onChange={(v) => {
                  const next = { d: v as District, depth: dist?.depth ?? 15 };
                  setDist(next);
                  patch({ method: { ...m, depthCorrection: depthCorrection(next.d, next.depth) } });
                }}
                options={DISTRICTS.map((d) => ({ value: d, label: d }))}
              />
              <NumInput
                value={dist?.depth}
                onChange={(v) => {
                  const next = { d: dist?.d ?? ("普通住宅地区" as District), depth: v };
                  setDist(next);
                  if (v > 0) patch({ method: { ...m, depthCorrection: depthCorrection(next.d, v) } });
                }}
                unit="m"
              />
            </div>
          </Field>
          <Field label="奥行価格補正率">
            <NumInput value={m.depthCorrection} step="0.01" onChange={(v) => patch({ method: { ...m, depthCorrection: v } })} />
          </Field>
          <Field label="その他の補正率（任意）" hint="不整形地・間口狭小などの補正率をかける場合に入力。通常は1">
            <NumInput value={m.otherCorrection ?? 1} step="0.01" onChange={(v) => patch({ method: { ...m, otherCorrection: v } })} />
          </Field>
        </>
      )}
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

