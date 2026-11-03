"use client";

/** 土地の入力（評価方法・面している道路と路線価・土地の使い方）と、小規模宅地等の特例の確認 */
import { MapPin } from "lucide-react";
import Link from "next/link";
import { ConsultLink } from "@/components/compass/ConsultLink";
import { Choice } from "@/components/plan/inputs";
import { Button, Check, Field, Note, NumInput, OptionalNumInput, Select, TextInput, YenInput, fmt } from "@/components/ui";
import type { Asset, CondoAsset, LandAsset, LandUse, Person } from "@/domain/types";
import { DISTRICTS, type District } from "@/domain/valuation/depth";
import { LEASE_LETTERS, LEASE_RATIO_BY_LETTER, type LeaseLetter, leaseLetterOf } from "@/domain/valuation/lease";
import { type Edge, type RoadInput, evaluateRoads } from "@/domain/valuation/roads";
import { type Answer, SMALL_LAND_RULE, type SmallResidentialCheck, judgeSmallResidential, shouldApply, smallLandKind } from "@/domain/valuation/smallResidential";

const ANSWERS: { value: Answer; label: string }[] = [
  { value: "yes", label: "はい" },
  { value: "no", label: "いいえ" },
  { value: "unsure", label: "わからない" },
];

/** 0〜1 の割合を % の数にする（0.07 が 7.000000000000001 にならないよう丸める） */
const toPercent = (r: number) => Math.round(r * 1_000_000) / 10_000;

/** 賃貸割合（%）の入力。保存は 0〜1 の割合。未設定は100%（全部貸している） */
export function RentRatioField({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  return (
    <Field label="貸している割合" hint="空き部屋があるときは 貸している床面積 ÷ 全体の床面積">
      <NumInput value={value == null ? 100 : toPercent(value)} onChange={(v) => onChange(v / 100)} unit="%" />
    </Field>
  );
}

const LEASE_OPTIONS = LEASE_LETTERS.map((l) => ({ value: String(LEASE_RATIO_BY_LETTER[l]), label: `${toPercent(LEASE_RATIO_BY_LETTER[l])}%（${l}）` }));

/**
 * 借地権割合の選択（90%（A）〜30%（G））。空欄は「選んでください」、auto があれば「記号から決める」。
 * 以前の入力などで表にない割合が入っていれば、その値も選択肢に残す
 */
export function LeaseRatioSelect({ value, onChange, hint, auto }: { value: number | undefined; onChange: (v: number | undefined) => void; hint: string; auto?: string }) {
  const cur = value != null && value > 0 ? String(value) : "";
  const options = [{ value: "", label: auto ?? "選んでください" }, ...LEASE_OPTIONS];
  if (cur && !options.some((o) => o.value === cur)) options.push({ value: cur, label: `${toPercent(Number(cur))}%` });
  return (
    <Field label="借地権割合" hint={hint}>
      <Select value={cur} onChange={(v) => onChange(v ? Number(v) : undefined)} options={options} />
    </Field>
  );
}

/**
 * 土地の使い方・貸しているかを変えて小規模宅地等の特例の種類が変わるときは、前の種類のための答えを引き継がない
 * （取得する人は残す）。変わらなければ何もしない
 */
export function resetSmallOnKindChange(a: LandAsset, p: Partial<LandAsset>): Partial<LandAsset>;
export function resetSmallOnKindChange(a: CondoAsset, p: Partial<CondoAsset>): Partial<CondoAsset>;
export function resetSmallOnKindChange(a: LandAsset | CondoAsset, p: Partial<LandAsset> | Partial<CondoAsset>): Partial<LandAsset> | Partial<CondoAsset> {
  const sr = a.smallResidential;
  if (!sr?.check) return {};
  const after = smallLandKind({ ...a, ...p } as LandAsset | CondoAsset);
  if (smallLandKind(a) === after) return {};
  return { smallResidential: { ...sr, check: undefined, applies: false } };
}

/** 取得する人を変えたときに残す答え（土地と亡くなった方についての答え）。同居・続けるか・持ち続けるか・税理士への確認は引き継がない */
const keepForNewAcquirer = (c: SmallResidentialCheck): SmallResidentialCheck => ({ ownHome: c.ownHome, special: c.special, business: c.business, recent: c.recent });

export function SmallResidential({ living, a, patch }: { living: Person[]; a: Extract<Asset, { kind: "land" | "condo" }>; patch: (p: Partial<Asset>) => void }) {
  const sr = a.smallResidential ?? { applies: false };
  const check: SmallResidentialCheck = sr.check ?? {};
  const kind = smallLandKind(a);
  const rule = SMALL_LAND_RULE[kind];
  const acquirer = living.find((p) => p.id === sr.acquirerId);
  const j = judgeSmallResidential(check, acquirer, kind);
  const set = (next: { acquirerId?: string; check?: SmallResidentialCheck }) => {
    const acq = next.acquirerId ?? sr.acquirerId;
    const c = next.check ?? check;
    // 自宅でなく事業に使っていた土地なら特定事業用、と答えで種類が変わるので、新しい答えで決め直して判定する
    const k = smallLandKind({ ...a, smallResidential: { ...sr, check: c } });
    const jj = judgeSmallResidential(c, living.find((p) => p.id === acq), k);
    patch({ smallResidential: { ...sr, acquirerId: acq, check: c, applies: shouldApply(jj, c) } });
  };
  const answer = (k: keyof SmallResidentialCheck, v: Answer) => {
    // 自宅の敷地か・事業に使っていたかを答え直したら、特例の種類や聞くことが変わるので、その先の答えは引き継がない
    const base: SmallResidentialCheck = k === "ownHome" && v !== check.ownHome ? {} : k === "business" && v !== check.business ? { ownHome: check.ownHome } : check;
    set({ check: { ...base, [k]: v, confirmedByAdvisor: false } });
  };
  const ask = (k: keyof SmallResidentialCheck, q: string, hint?: string) => (
    <div className="space-y-1">
      <p className="text-sm font-medium text-stone-800">{q}</p>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
      <Choice value={check[k] as Answer | undefined} onChange={(v) => answer(k, v)} options={ANSWERS} />
    </div>
  );
  const isSpouse = acquirer?.relation === "spouse";
  const what = a.kind === "condo" ? "この部屋" : "この土地";
  const tone = j.result === "ok" ? "ok" : j.result === "consult" ? "warn" : j.result === "no" ? "info" : null;
  return (
    <div className="space-y-3 rounded-lg bg-stone-50 p-3 sm:col-span-2">
      <p className="font-bold text-stone-800">小規模宅地等の特例（評価が最大80%下がる）</p>
      <p className="text-xs text-stone-500">使えるかどうかを順に確認します。条件がはっきりしない場合は特例を使わずに計算し、税理士への相談をご案内します。</p>
      <Field label={`${what}を取得する人`} hint="遺産の分け方で決めた人を選んでください。">
        <Select
          value={sr.acquirerId ?? ""}
          // 取得する人を変えたら、前の人についての答え（同居・続けるか・持ち続けるか）と税理士への確認は引き継がない
          onChange={(v) => v !== (sr.acquirerId ?? "") && set({ acquirerId: v, check: keepForNewAcquirer(check) })}
          options={[{ value: "", label: "選んでください" }, ...living.map((p) => ({ value: p.id, label: `${p.name || "（未入力）"}（${p.relationLabel ?? ""}）` }))]}
        />
      </Field>
      {kind === "rental" ? (
        // 人に貸している土地・部屋（貸付事業用宅地等）：自宅かどうかは聞かない
        <>
          {ask("continues", "取得する人は、申告期限まで貸し続けますか？", "申告期限は、亡くなった日から10か月です。")}
          {check.continues === "yes" && ask("keep", `申告期限まで、${what}を持ち続けますか？`)}
          {check.continues === "yes" && check.keep === "yes" && ask("recent", "亡くなる前3年以内に貸し始めましたか？")}
        </>
      ) : (
        <>
          {ask("ownHome", "亡くなった方が住んでいた自宅の敷地ですか？")}
          {check.ownHome === "yes" &&
            ask("special", "老人ホームへの入居、二世帯住宅、建物の一部を貸していた などの事情はありますか？", "亡くなる前に老人ホームへ入っていた場合や、二世帯住宅の場合は、使える範囲の判断が変わります。")}
          {check.ownHome === "yes" && check.special === "no" && acquirer && !isSpouse && (
            <>
              {ask("livedTogether", `${acquirer.name || "取得する人"}さんは、亡くなる直前まで亡くなった方と同じ家に住んでいましたか？`, "住民票が同じでも、実際に一緒に暮らしていなければ「いいえ」です。")}
              {check.livedTogether === "yes" && ask("keep", "申告期限（亡くなった日から10か月）まで、この家に住み続け、土地を持ち続けますか？")}
            </>
          )}
          {check.ownHome === "no" && ask("business", "亡くなった方が、お店や工場など自分の事業（人に貸す事業は除く）に使っていた土地ですか？")}
          {kind === "business" && (
            // 特定事業用宅地等：事業を引き継いで続けるか → 持ち続けるか → 3年以内に始めた事業か
            <>
              {ask("continues", "取得する人は、申告期限（亡くなった日から10か月）までにその事業を引き継ぎ、続けますか？")}
              {check.continues === "yes" && ask("keep", `申告期限まで、${what}を持ち続けますか？`)}
              {check.continues === "yes" && check.keep === "yes" && ask("recent", "亡くなる前3年以内に始めた事業ですか？")}
            </>
          )}
        </>
      )}
      {tone && <Note tone={tone}>{j.reason}</Note>}
      {j.result === "ok" && (
        <p className="text-xs text-stone-600">
          {rule.limitSqm}㎡までの部分の評価額を{rule.rate}%減らして計算します（{rule.name}・租税特別措置法69条の4）。
        </p>
      )}
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

/** 面している道路ごとの路線価・奥行・間口。2つ以上なら側方・二方路線影響加算（高めに評価） */
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
          <div key={r.edge} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-stone-200 p-2 sm:grid-cols-[7rem_1fr_6rem_6rem_auto]">
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
            <Field label="間口">
              <OptionalNumInput value={r.frontage} accept={(v) => v > 0} onChange={(v) => setRoad(i, { frontage: v })} unit="m" />
            </Field>
            {roads.length > 1 && (
              <Button variant="danger" onClick={() => save(roads.filter((_, j) => j !== i))}>
                削除
              </Button>
            )}
          </div>
        ))}
        {free.length > 0 && (
          <Button variant="secondary" onClick={() => save([...roads, { edge: free[0], price: 0, depth: free[0] % 2 === 0 ? roads[0]?.depth ?? 0 : m.lot?.width ?? 0 }])}>
            ＋ 道路を追加（角地・二方路線など）
          </Button>
        )}
        <p className="text-xs text-stone-500">
          路線価図の数字は千円単位です（例：「420D」→ 420,000円）。奥行は、その道路から土地の反対側までの距離、間口は、その道路に接している部分の長さです。
        </p>
      </div>
      {incomplete && <Note tone="warn">路線価か奥行が入っていない道路があります。すべての道路に入れるまで評価額は計算しません。面していない道路は「削除」してください。</Note>}
      {ev && !incomplete && (
        <div className="rounded-lg bg-teal-50 p-3 text-sm text-teal-950">
          <p className="font-semibold">1㎡あたり {fmt(ev.perSqm)}円</p>
          {ev.lines.length > 1 && <p className="text-xs">正面は、路線価×奥行価格補正率がいちばん高い道路です（財産評価基本通達16）。</p>}
        </div>
      )}
      <Note tone="info">
        間口を入れると、間口が狭い・奥行が長い土地の補正（減額）もします。がけ地などの減額はしていないため、高めに出ることがあります。
        <span className="mt-2 block">
          <ConsultLink topic="土地の評価" />
        </span>
      </Note>
      <details className="text-xs text-stone-600">
        <summary className="cursor-pointer font-medium text-teal-800">Tips：この評価で計算していないこと</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>間口が狭い・奥行が長い補正は、正面の道路の間口を入れたときだけします（財産評価基本通達20-4）。</li>
          <li>角地は、一方が行き止まりの道路の角（準角地）かどうかを区別せず、加算の大きい角地として計算します。</li>
          <li>横や裏の道路に一部しか接していない場合も、全部接しているものとして計算します。</li>
          <li>形がいびつな土地（不整形地）、がけ地、道路に接していない土地、都市計画道路の予定地などの減額はしていません。形がいびつな土地は、下の「この土地に当てはまること」で選んでください。</li>
          <li>税理士に補正率を確認した場合は、下の欄に入れると計算に使います。</li>
        </ul>
      </details>
      <Field
        label="税理士に確認した補正率（任意）"
        hint="不整形地・がけ地などの補正率を税理士に確認した場合だけ、0より大きく1以下の数（例：0.92）を入力。空欄なら補正なしで計算します。間口が狭い・奥行が長い分は間口を入れると自動で補正するので、この補正率にその分が含まれているときは間口を空欄にしてください（二重に下げないため）"
      >
        <OptionalNumInput
          value={m.otherCorrection}
          accept={(v) => v > 0 && v <= 1}
          onChange={(v) => patch({ method: { ...m, otherCorrection: v } })}
          invalidMessage={
            // 以前の入力で1を超える値が保存されていると、評価額を計算できず税額も出せない。打ち直した値は保存しないので補正なしで計算する
            m.otherCorrection != null && m.otherCorrection > 1
              ? "補正率は0より大きく1以下の数です。以前に入れた値が1を超えているため、このままでは評価額と相続税を計算できません。正しい補正率に直すか、空欄にしてください。"
              : "補正率は0より大きく1以下の数です。いまはこの値を使わず、補正なしで計算しています。"
          }
        />
      </Field>
      {a.method.type === "rosenka" && a.method.lot && <p className="text-xs text-stone-500">地図で合わせた枠：間口{a.method.lot.width}m × 奥行{a.method.lot.depth}m</p>}
    </div>
  );
}

const USE_OPTIONS: { value: LandUse; label: string }[] = [
  { value: "self", label: "自分で使っている（自宅・空き地・駐車場など）" },
  { value: "rentedHouse", label: "アパート・貸家を建てて貸している" },
  { value: "leasedLand", label: "土地を貸して、借りた人が建物を建てている" },
  { value: "leasehold", label: "人の土地を借りて建物を建てている（借地権）" },
];

const CONDITION_OPTIONS: { value: NonNullable<LandAsset["condition"]> | ""; label: string }[] = [
  { value: "", label: "特になし" },
  { value: "irregular", label: "形がいびつ（旗竿地・三角形・L字など）" },
  { value: "setback", label: "前の道路の幅が4m未満（建て替えのとき下がる部分がある）" },
  { value: "spouseResidence", label: "配偶者居住権を設定した" },
];

/** 借地権割合を決める路線価の記号（A〜G）。評価の計算と同じく、道路があれば正面の道路、なければ路線価図の表記から読む */
function roadLetter(a: LandAsset): LeaseLetter | undefined {
  const m = a.method;
  if (m.type !== "rosenka") return undefined;
  const notation = m.roads?.length ? evaluateRoads(m.district ?? "普通住宅地区", m.roads)?.front.notation : a.rosenkaSheet?.notation;
  return leaseLetterOf(notation);
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
  const use = a.use ?? "self";
  const letter = roadLetter(a);
  const setUse = (v: LandUse) => {
    // 賃貸割合はアパート・貸家のときだけ使う。借地権割合は場所で決まるものなので残す
    const p: Partial<LandAsset> = { use: v === "self" ? undefined : v, rentRatio: v === "rentedHouse" ? a.rentRatio : undefined };
    patch({ ...p, ...resetSmallOnKindChange(a, p) });
  };
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
        <>
          {!m.publicPrivateRoad && (
            <Field label="評価額">
              <YenInput value={m.value} onChange={(v) => patch({ method: { ...m, value: v } })} />
            </Field>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Check
              checked={!!m.publicPrivateRoad}
              onChange={(v) => patch({ method: { ...m, publicPrivateRoad: v || undefined } })}
              label="誰でも通り抜けできる私道なので、評価しない（0円）"
            />
            <p className="text-xs text-stone-500">
              道路として誰でも通り抜けに使っている私道は、相続税では評価しません（財産評価基本通達24）。行き止まりで近くの家の人だけが使う私道などは0円になりません。分からないときは税理士にご相談ください。
            </p>
          </div>
        </>
      )}
      <Field label="土地の使い方">
        <Select value={use} onChange={(v) => setUse(v as LandUse)} options={USE_OPTIONS} />
      </Field>
      {use === "rentedHouse" && <RentRatioField value={a.rentRatio} onChange={(v) => patch({ rentRatio: v })} />}
      {use !== "self" &&
        (letter && a.leaseRatio == null ? (
          // 正面の道路の路線価の記号から決まるので、聞かずに見せるだけにする
          <p className="self-end pb-2 text-sm text-stone-700">
            借地権割合 <strong>{toPercent(LEASE_RATIO_BY_LETTER[letter])}%</strong>（路線価の記号 {letter}）
          </p>
        ) : (
          <LeaseRatioSelect
            value={a.leaseRatio}
            onChange={(v) => patch({ leaseRatio: v })}
            auto={letter ? `路線価の記号から（${toPercent(LEASE_RATIO_BY_LETTER[letter])}%・${letter}）` : undefined}
            hint={
              m.type === "multiplier"
                ? "評価倍率表の「借地権割合」の欄の数字です"
                : m.type === "rosenka"
                  ? "路線価図で、路線価の数字のあとの記号です（例：420D の D）"
                  : "路線価図の路線価の数字のあとの記号（例：420D の D）か、評価倍率表の「借地権割合」の欄で分かります"
            }
          />
        ))}
      {(a.landUse === "宅地" || a.landUse === "雑種地") && (
        <Field label="この土地に当てはまること" hint="当てはまるものがあると評価が変わるため、相続コンパスでは計算せず、税理士への相談をご案内します">
          <Select value={a.condition ?? ""} onChange={(v) => patch({ condition: (v || undefined) as LandAsset["condition"] })} options={CONDITION_OPTIONS} />
        </Field>
      )}
      <SmallResidential living={living} a={a} patch={patch} />
    </>
  );
}
