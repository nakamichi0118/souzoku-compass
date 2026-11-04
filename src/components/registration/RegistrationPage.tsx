"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Bubble, CompassAvatar } from "@/components/compass/CompassKun";
import { OfficeLookup } from "@/components/plan/OfficeLookup";
import { AppHeader } from "@/components/shell/AppShell";
import { Card, Field, Note, TextInput, YenInput } from "@/components/ui";
import { jpDate, nextOpenDay } from "@/domain/procedures/dates";
import { registrationDue } from "@/domain/procedures/rules";
import { areaOf } from "@/domain/procedures/offices";
import { buildRegistrations } from "@/domain/registration";
import type { Asset, RegistryInfo } from "@/domain/types";
import { useCase } from "@/lib/store";
import { saveBlob } from "@/lib/download";

/** そろえる書類（名前と、要るときだけ短い補足） */
const DOCS: [string, string?][] = [
  ["登記事項証明書（登記簿謄本）", "法務局・オンラインで取れます"],
  ["亡くなった方の出生から死亡までの戸籍謄本", "法定相続情報一覧図の写しでも可"],
  ["相続人全員の戸籍謄本"],
  ["亡くなった方の住民票の除票（または戸籍の附票）"],
  ["遺産分割協議書と相続人全員の印鑑証明書"],
  ["不動産を取得する人の住民票"],
  ["固定資産評価証明書（申請する年度のもの）"],
  ["収入印紙（登録免許税の額）", "郵便局・法務局で買えます"],
];

type RegAsset = Extract<Asset, { kind: "land" | "building" | "condo" }>;

function RegistryForm({ a, onChange }: { a: RegAsset; onChange: (r: RegistryInfo) => void }) {
  const r = a.registry ?? {};
  const set = (k: keyof RegistryInfo, v: string | number) => onChange({ ...r, [k]: v });
  const txt = (k: keyof RegistryInfo, label: string, ph: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <TextInput value={(r[k] as string) ?? ""} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={a.kind === "condo" ? "建物（専有部分）の固定資産評価額" : "固定資産評価額"} hint="評価証明書・課税明細書の「価格」欄">
        <YenInput value={r.assessedValue ?? (a.kind === "building" ? a.fixedAssetValue : a.kind === "condo" ? a.buildingFixedAssetValue : undefined)} onChange={(v) => set("assessedValue", v)} />
      </Field>
      {a.kind === "land" && txt("lotNumber", "地番", "例：2番3", "住所とは違うことがあります（登記事項証明書で確認）")}
      {a.kind !== "land" && txt("houseNumber", "家屋番号", "例：2番3")}
      {a.kind !== "land" && txt("buildingType", "種類", "例：居宅")}
      {a.kind !== "land" && txt("structure", "構造", "例：木造スレートぶき2階建")}
      {a.kind !== "land" && txt("floorArea", "床面積", "例：1階 72.45㎡　2階 58.32㎡")}
      {a.kind === "condo" && txt("buildingName", "一棟の建物の名称", "例：架空レジデンス")}
      {a.kind === "condo" && txt("siteLand", "敷地権の目的である土地", "例：〇〇市〇〇町1番　宅地　1,240.50㎡")}
      {a.kind === "condo" && txt("siteRight", "敷地権の種類と割合", "例：所有権　10000分の169")}
      {a.kind === "condo" && (
        <Field label="敷地権の評価額" hint="土地全体の固定資産評価額 × 敷地権の割合">
          <YenInput value={r.siteAssessedValue} onChange={(v) => set("siteAssessedValue", v)} />
        </Field>
      )}
    </div>
  );
}

export function RegistrationPage() {
  const { data, update, loaded } = useCase();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!loaded) return null;
  const props = data.assets.filter((a): a is RegAsset => a.kind === "land" || a.kind === "building" || a.kind === "condo");
  const apps = buildRegistrations(data);
  // やることリスト・カレンダーと同じ期限（2024年3月以前に亡くなった方は2027年3月31日まで）
  const deadline = data.decedent.deathDate ? jpDate(nextOpenDay(registrationDue(data.decedent.deathDate))) : "";
  const unallocated = props.filter((p) => !data.allocations.some((a) => a.assetId === p.id && a.shares.length));
  // 提出先の法務局：同じ地域（番地より前が同じ）の不動産は、窓口も同じなので1つの枠にまとめる
  const byArea = new Map<string, RegAsset[]>();
  for (const p of props.filter((x) => x.location.trim())) {
    const k = areaOf(p.location.trim());
    byArea.set(k, [...(byArea.get(k) ?? []), p]);
  }
  const offices = [...byArea.values()];

  async function download() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/registration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "作成に失敗しました。");
      saveBlob(await res.blob(), "登記申請書_相続.pdf");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50/70 to-stone-50">
      <AppHeader />
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-8">
        <Link href="/my" className="text-sm text-sky-800 underline">
          ← マイページ
        </Link>
        <h1 className="text-2xl font-bold text-sky-950">不動産の相続登記</h1>
        <div className="flex items-start gap-3">
          <CompassAvatar size={52} />
          <Bubble className="flex-1">
            不動産の名義を変える手続きです（義務）。期限は<strong>{deadline || "相続を知った日から3年"}</strong>。申請書と登録免許税をここで作れます。
          </Bubble>
        </div>

        {props.length === 0 && (
          <Note tone="info">
            まだ不動産がありません。
            <Link href="/case/assets" className="ml-2 font-semibold underline">
              財産を登録する ›
            </Link>
          </Note>
        )}
        {unallocated.length > 0 && (
          <Note tone="warn">
            取得する人が決まっていない不動産があります（{unallocated.map((p) => p.label).join("、")}）。
            <Link href="/case/division" className="underline">
              遺産の分け方
            </Link>
            で決めてください。
          </Note>
        )}

        {props.length > 0 && (
          <Card title="提出先の法務局">
            <p className="mb-3 text-sm text-stone-600">不動産のある場所の法務局に出します（亡くなった方の住所とは限りません。同じ市でも分かれることがあります）。</p>
            <div className="space-y-3">
              {offices.map((group) => (
                <div key={group[0].id} className="rounded-lg border border-stone-200 p-3">
                  <p className="mb-2 text-sm font-medium text-stone-700">{group.map((p) => p.label || p.location).join("・")}</p>
                  <OfficeLookup kind="legalAffairs" dept="不動産登記" address={group[0].location.trim()} />
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title="1. 登記簿の内容を入れる">
          <p className="mb-4 text-sm text-stone-600">登記事項証明書と固定資産評価証明書を見て入れます。</p>
          <div className="space-y-6">
            {props.map((a) => (
              <div key={a.id}>
                <p className="mb-2 font-bold text-stone-800">
                  {a.label}
                  <span className="ml-2 text-sm font-normal text-stone-500">{a.location}</span>
                </p>
                <RegistryForm
                  a={a}
                  onChange={(r) =>
                    update((c) => ({ ...c, assets: c.assets.map((x) => (x.id === a.id && (x.kind === "land" || x.kind === "building" || x.kind === "condo") ? { ...x, registry: r } : x)) }))
                  }
                />
              </div>
            ))}
          </div>
        </Card>

        <Card title="2. 申請書と登録免許税">
          <div className="space-y-4">
            {apps.map((app) => (
              <div key={app.key} className="rounded-xl border border-stone-200 p-4">
                <p className="font-bold text-stone-900">
                  取得する人：{app.applicants.map((a) => `${a.name}${a.share ? `（持分${a.share}）` : ""}`).join("、")}
                </p>
                <p className="text-sm text-stone-600">不動産：{app.properties.map((p) => p.label).join("、")}</p>
                <p className="text-sm text-stone-600">提出先：{app.area}の法務局</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-stone-50 p-3">
                    <p className="text-xs text-stone-500">課税価格（評価額の合計）</p>
                    <p className="text-xl font-bold tabular-nums">{app.taxBase.toLocaleString("ja-JP")}円</p>
                  </div>
                  <div className="rounded-lg bg-sky-50 p-3">
                    <p className="text-xs text-stone-500">登録免許税（課税価格×0.4%）</p>
                    <p className="text-xl font-bold tabular-nums text-sky-900">{app.tax.toLocaleString("ja-JP")}円</p>
                  </div>
                </div>
                {app.exemptLots.length > 0 && <p className="mt-2 text-sm text-emerald-800">評価額100万円以下の土地は登録免許税がかかりません（令和9年3月31日までの申請）：{app.exemptLots.join("、")}</p>}
                {app.missing.length > 0 && <Note tone="warn">まだ入っていない項目：{app.missing.join("、")}</Note>}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={download} disabled={busy || apps.length === 0} className="rounded-lg bg-sky-700 px-5 py-2.5 font-semibold text-white hover:bg-sky-800 disabled:bg-stone-300">
              {busy ? "作成中…" : "登記申請書（PDF）をダウンロード"}
            </button>
            <span className="text-xs text-stone-500">取得する人・市区町村ごとに1通ずつ作ります。申請日と法務局名は、出すときに書き入れます。</span>
          </div>
          {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
        </Card>

        <Card title="3. そろえる書類">
          <ul className="space-y-2 text-sm">
            {DOCS.map(([n, note]) => (
              <li key={n} className="flex gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                <span>
                  <strong>{n}</strong>
                  {note && <span className="text-stone-600">（{note}）</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="4. 法務局に出す">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-stone-700">
            <li>申請書に押印し、収入印紙を台紙に貼って一緒に綴じます。</li>
            <li>窓口・郵送（書留）・オンラインで出します。</li>
            <li>申請書の電話番号は、日中つながる番号にします（不備の連絡が来ます）。</li>
            <li>1〜2週間で完了し、「登記識別情報通知」（昔の権利証にあたるもの）を受け取ります。大切に保管します。</li>
          </ol>
          <p className="mt-3 text-sm text-stone-700">数次相続・共有物の一部・農地や山林・遺言による遺贈などは、司法書士への相談をおすすめします。</p>
          <details className="mt-1 text-xs text-stone-600">
            <summary className="cursor-pointer py-2 font-medium text-teal-800">根拠（法律）</summary>
            <p className="leading-relaxed">
              不動産登記法76条の2（相続登記の申請義務。2024年4月から）、登録免許税法別表第一（相続による所有権移転 1000分の4）、租税特別措置法84条の2の3（少額の土地の免税）。課税価格は1,000円未満、登録免許税は100円未満を切り捨てます。オンラインは「登記・供託オンライン申請システム」から出します。
            </p>
          </details>
        </Card>
      </main>
    </div>
  );
}
