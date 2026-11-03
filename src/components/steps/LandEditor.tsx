"use client";

/** 土地の入力（評価方法・面している道路と路線価）と、小規模宅地等の特例の確認 */
import { MapPin } from "lucide-react";
import Link from "next/link";
import { ConsultLink } from "@/components/compass/ConsultLink";
import { Choice } from "@/components/plan/inputs";
import { Button, Check, Field, Note, NumInput, OptionalNumInput, Select, TextInput, YenInput, fmt } from "@/components/ui";
import type { Asset, LandAsset, Person } from "@/domain/types";
import { DISTRICTS, type District } from "@/domain/valuation/depth";
import { type Edge, type RoadInput, evaluateRoads } from "@/domain/valuation/roads";
import { type Answer, type SmallResidentialCheck, judgeSmallResidential, shouldApply } from "@/domain/valuation/smallResidential";

const ANSWERS: { value: Answer; label: string }[] = [
  { value: "yes", label: "はい" },
  { value: "no", label: "いいえ" },
  { value: "unsure", label: "わからない" },
];

export function SmallResidential({ living, a, patch }: { living: Person[]; a: Extract<Asset, { kind: "land" | "condo" }>; patch: (p: Partial<Asset>) => void }) {
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
          <Select
            value={sr.acquirerId ?? ""}
            // 取得する人を変えたら、前の人についての答え（同居・住み続けるか）と税理士への確認は引き継がない
            onChange={(v) => v !== (sr.acquirerId ?? "") && set({ acquirerId: v, check: { ownHome: check.ownHome, special: check.special } })}
            options={[{ value: "", label: "選んでください" }, ...living.map((p) => ({ value: p.id, label: `${p.name || "（未入力）"}（${p.relationLabel ?? ""}）` }))]}
          />
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
  // 路線価か奥行が入っていない道路があると評価額は確定しない（その道路を外して低く計算しないため）
  const incomplete = !!m.roads?.length && m.roads.some((r) => !(r.price > 0) || !(r.depth > 0));
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
      {incomplete && <Note tone="warn">路線価か奥行が入っていない道路があります。すべての道路に入れるまで評価額は計算しません。面していない道路は「削除」してください。</Note>}
      {ev && !incomplete && (
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
      <Field label="税理士に確認した補正率（任意）" hint="不整形地・間口狭小などの補正率を税理士に確認した場合だけ、0より大きく1以下の数（例：0.92）を入力。空欄なら補正なしで計算します">
        <OptionalNumInput
          value={m.otherCorrection}
          accept={(v) => v > 0 && v <= 1}
          onChange={(v) => patch({ method: { ...m, otherCorrection: v } })}
          invalidMessage="補正率は1以下の数です。いまはこの値を使わず、補正なしで計算しています。"
        />
      </Field>
      {a.method.type === "rosenka" && a.method.lot && <p className="text-xs text-stone-500">地図で合わせた枠：間口{a.method.lot.width}m × 奥行{a.method.lot.depth}m</p>}
    </div>
  );
}

export function LandEditor({
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
        <Link href={`/case/map?asset=${a.id}`} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
          <MapPin className="h-4 w-4" aria-hidden />
          地図で土地を評価する（路線価・倍率）
        </Link>
      </div>
      {m.type === "rosenka" && <RoadsEditor a={a} m={m} patch={patch} />}
      {m.type === "multiplier" && (
        <>
          <Field label="固定資産税評価額">
            <YenInput value={m.fixedAssetValue} onChange={(v) => patch({ method: { ...m, fixedAssetValue: v } })} />
          </Field>
          {m.source && (
            <p className="text-xs text-teal-900 sm:col-span-2">
              評価倍率表で確認済み：{m.source.city}
              {m.source.town}
              {m.source.area ? `（${m.source.area}）` : ""}の宅地
            </p>
          )}
          <Field label="倍率" hint="国税庁の評価倍率表で確認します">
            <NumInput value={m.multiplier} step="0.1" onChange={(v) => patch({ method: { ...m, multiplier: v, source: v === m.multiplier ? m.source : undefined } })} />
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

