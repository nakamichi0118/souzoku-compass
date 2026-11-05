"use client";

/** 土地の入力（評価方法・面している道路と路線価・土地の使い方）と、小規模宅地等の特例の確認 */
import { MapPin } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { ConsultLink } from "@/components/compass/ConsultLink";
import { Choice } from "@/components/plan/inputs";
import { Button, Check, Field, Note, NumInput, OptionalNumInput, Select, TextInput, YenInput, fmt } from "@/components/ui";
import type { Asset, CondoAsset, LandAsset, LandUse, Person, SmallLandAcquirer, SmallLandKind, SmallLandRelief } from "@/domain/types";
import { DISTRICTS, type District } from "@/domain/valuation/depth";
import { type PendingReduction, pendingReductions, reductionAdvice } from "@/domain/valuation";
import { LEASE_LETTERS, LEASE_RATIO_BY_LETTER, type LeaseLetter, leaseLetterOf, ratio4 } from "@/domain/valuation/lease";
import { type Edge, type RoadInput, correctionRates, evaluateRoads } from "@/domain/valuation/roads";
import { type Answer, SMALL_LAND_RULE, type SmallResidentialCheck, judgeSmallResidential, shouldApply, smallLandKind } from "@/domain/valuation/smallResidential";
import { type DivisionInput, smallLandDivisionGap, wholeTaker } from "@/lib/smallLand";

const ANSWERS: { value: Answer; label: string }[] = [
  { value: "yes", label: "はい" },
  { value: "no", label: "いいえ" },
  { value: "unsure", label: "わからない" },
];

/** 0〜1 の割合を % の数にする（0.07 が 7.000000000000001 にならないよう丸める） */
const toPercent = (r: number) => Math.round(r * 1_000_000) / 10_000;

/**
 * 賃貸割合が 0より大きく1%以下か。% の欄に「全部貸していれば1」のつもりで 1 と入れると 1%（0.01）になるので、
 * 止めはせずに確かめてもらう（1% 以下の賃貸割合はふつうありえない）
 */
export const rentRatioLooksTooSmall = (r: number | undefined) => r != null && r > 0 && r <= 0.01;

/**
 * 賃貸割合（%）の入力。保存は 0〜1 の割合。未設定は100%（全部貸している）。
 * 一時的な空室は貸しているものとして数え（財産評価基本通達26(注)2）、廊下・階段などの共用部分は床面積に入れない（通達26(2)）
 */
export function RentRatioField({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  return (
    <Field label="貸している割合" hint="一時的な空室も貸しているものとして数えます（廊下・階段は床面積に入れません）">
      <NumInput value={value == null ? 100 : toPercent(value)} onChange={(v) => onChange(v / 100)} unit="%" />
      {rentRatioLooksTooSmall(value) && <span className="mt-1 block text-xs text-amber-800">1%以下になっています。%で入れているか確かめてください</span>}
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
  // 一緒に受け継いだ人の答えも、前の種類のためのものなので引き継がない（人と面積は残す）
  return { smallResidential: { ...sr, check: undefined, applies: false, ...(sr.others ? { others: sr.others.map(withoutAnswers) } : {}) } };
}

/** 取得する人を変えたときに残す答え（土地と亡くなった方についての答え）。同居・続けるか・持ち続けるか・税理士への確認は引き継がない */
const keepForNewAcquirer = (c: SmallResidentialCheck): SmallResidentialCheck => ({
  ownHome: c.ownHome,
  special: c.special,
  business: c.business,
  familyHome: c.familyHome,
  recent: c.recent,
});

/** 土地についての答え（最初の人の欄で答え、一緒に取得する人にも使う）。ほかは人ごとの答え */
const LOT_KEYS: readonly (keyof SmallResidentialCheck)[] = ["ownHome", "special", "business", "familyHome", "recent"];

/** 一緒に受け継いだ人の答えを消す（人と面積は残す） */
const withoutAnswers = (o: SmallLandAcquirer): SmallLandAcquirer => ({ acquirerId: o.acquirerId, ...(o.selectedSqm != null ? { selectedSqm: o.selectedSqm } : {}) });

/** 2人目以降の取得者が自分で答えるもの（人ごとの答え）。ほかは土地についての答えで、最初の人の答えを使う */
const personAnswers = (c: SmallResidentialCheck = {}): SmallResidentialCheck =>
  Object.fromEntries(
    Object.entries({ livedTogether: c.livedTogether, keep: c.keep, continues: c.continues, confirmedByAdvisor: c.confirmedByAdvisor }).filter(([, v]) => v !== undefined),
  ) as SmallResidentialCheck;

/**
 * 2人目以降の取得者の判定に使う答え。土地についての答え（自宅か・事情・事業に使っていたか・家族が住んでいたか・3年以内か）は最初の人の答え、
 * 人ごとの答え（同居・続けるか・持ち続けるか・税理士への確認）はその人の答え（特例は取得した人ごとに判定する。措置法69条の4第3項）
 */
export const otherAcquirerCheck = (lot: SmallResidentialCheck = {}, own: SmallResidentialCheck = {}): SmallResidentialCheck => ({
  ...keepForNewAcquirer(lot),
  ...personAnswers(own),
});

/** 最初の取得者を変えたときの変更。前の人についての答えと面積は引き継がず、その人が「一緒に取得する人」にいれば外す */
export function firstAcquirerChange(sr: SmallLandRelief, acquirerId: string): Partial<SmallLandRelief> {
  const others = sr.others?.filter((o) => o.acquirerId !== acquirerId);
  return { acquirerId, check: keepForNewAcquirer(sr.check ?? {}), selectedSqm: undefined, others: others?.length ? others : undefined };
}

/**
 * 最初の人の答えを変えたときの、一緒に受け継いだ人の答え。自宅か・事業に使っていたか・家族が住んでいたかが変わると
 * 聞くことが変わるので答えを消し、事情・3年以内かが変わると判定が変わるので、税理士への確認だけ外す
 */
export function othersAfterLotAnswer(others: SmallLandAcquirer[] | undefined, key: keyof SmallResidentialCheck, before: SmallResidentialCheck, v: Answer): SmallLandAcquirer[] | undefined {
  if (!others?.length || before[key] === v) return others;
  if (key === "ownHome" || key === "business" || key === "familyHome") return others.map(withoutAnswers);
  if (key === "special" || key === "recent") return others.map((o) => (o.check?.confirmedByAdvisor ? { ...o, check: { ...o.check, confirmedByAdvisor: false } } : o));
  return others;
}

/**
 * 最初の人の欄で答えたときの変更。自宅の敷地か・事業に使っていたか・家族が住んでいたかを答え直したら、
 * 特例の種類や聞くことが変わるので、その先の答えは引き継がない（一緒に取得する人の答えも消す）。どの答えでも税理士への確認は外す
 */
export function answerFirstAcquirer(sr: SmallLandRelief, key: keyof SmallResidentialCheck, v: Answer): Pick<SmallLandRelief, "check" | "others"> {
  const check = sr.check ?? {};
  const base: SmallResidentialCheck =
    v === check[key]
      ? check
      : key === "ownHome"
        ? {}
        : key === "business"
          ? { ownHome: check.ownHome }
          : key === "familyHome"
            ? { ownHome: check.ownHome, business: check.business }
            : check;
  return { check: { ...base, [key]: v, confirmedByAdvisor: false }, others: othersAfterLotAnswer(sr.others, key, check, v) };
}

/** 一緒に取得する人を1人増やす（人はこれから選ぶ） */
export const addOtherAcquirer = (sr: SmallLandRelief): SmallLandRelief => ({ ...sr, others: [...(sr.others ?? []), { acquirerId: "" }] });

/** 一緒に取得する人を外す */
export function removeOtherAcquirer(sr: SmallLandRelief, i: number): SmallLandRelief {
  const others = (sr.others ?? []).filter((_, j) => j !== i);
  return { ...sr, others: others.length ? others : undefined };
}

/** 一緒に取得する人を選び直す。前の人の答えと面積は引き継がない */
export const setOtherAcquirerPerson = (sr: SmallLandRelief, i: number, acquirerId: string): SmallLandRelief => ({
  ...sr,
  others: (sr.others ?? []).map((o, j) => (j === i ? { acquirerId } : o)),
});

/**
 * 一緒に取得する人の答え。人ごとの答えはその人の check に入れ（税理士への確認は外す）、
 * 3年以内に始めたかなど土地についての答えは最初の人の check に入れる
 */
export function answerOtherAcquirer(sr: SmallLandRelief, i: number, key: keyof SmallResidentialCheck, v: Answer): SmallLandRelief {
  if (LOT_KEYS.includes(key)) {
    const lot = sr.check ?? {};
    return { ...sr, check: { ...lot, [key]: v }, others: othersAfterLotAnswer(sr.others, key, lot, v) };
  }
  return { ...sr, others: (sr.others ?? []).map((o, j) => (j === i ? { ...o, check: { ...personAnswers(o.check), [key]: v, confirmedByAdvisor: false } } : o)) };
}

/** 一緒に取得する人の、税理士への確認 */
export const confirmOtherAcquirer = (sr: SmallLandRelief, i: number, v: boolean): SmallLandRelief => ({
  ...sr,
  others: (sr.others ?? []).map((o, j) => (j === i ? { ...o, check: { ...personAnswers(o.check), confirmedByAdvisor: v } } : o)),
});

/** 特例を使う面積の上限（who が null なら最初の取得者、数なら一緒に取得する人の順番）。空欄（undefined）なら使える面積をすべて使う */
export function setSelectedSqm(sr: SmallLandRelief, who: number | null, v: number | undefined): SmallLandRelief {
  if (who == null) return { ...sr, selectedSqm: v };
  return { ...sr, others: (sr.others ?? []).map((o, j) => (j === who ? { ...o, selectedSqm: v } : o)) };
}

/**
 * 分け方で決めた、その人の分で特例の対象になる面積（㎡。付表1の③と同じ出し方）。分け方が入っていなければ undefined。
 * 持分に応ずる面積は0.01㎡未満を四捨五入し、空き部屋のある貸家などの貸付事業用は、そのうち貸している部分（0.01㎡未満切捨て）
 */
export function acquiredSqm(a: Extract<Asset, { kind: "land" | "condo" }>, division: DivisionInput | undefined, personId: string | undefined): number | undefined {
  if (!division || !personId) return undefined;
  const full = a.kind === "condo" ? (a.smallResidential?.landShareSqm ?? a.landShareSqm) : a.areaSqm;
  const s = division.allocations.find((x) => x.assetId === a.id)?.shares.find((x) => x.personId === personId);
  if (!s || !(full > 0) || !Number.isInteger(s.numerator) || !Number.isInteger(s.denominator) || !(s.numerator > 0) || !(s.denominator > 0)) return undefined;
  const area100 = Math.round(((full * s.numerator) / s.denominator) * 100);
  const rented = smallLandKind(a) === "rental" && (a.kind === "condo" || a.use === "rentedHouse" || a.use === "rentedLeasehold");
  const rent4 = rented ? ratio4(a.rentRatio ?? 1) : 10000;
  return (rent4 > 0 && rent4 < 10000 ? Math.floor((area100 * rent4) / 10000) : area100) / 100;
}

type Question = { key: keyof SmallResidentialCheck; q: string; hint?: string };

/** 確認の質問の文（最初の取得者と、一緒に取得する人とで同じ文を使う） */
const Q = {
  rentalContinues: (who: string): Question => ({ key: "continues", q: `${who}は、申告期限まで貸し続けますか？` }),
  keepUse: (what: string): Question => ({ key: "keep", q: `申告期限まで、${what}を持ち続けますか？` }),
  rentalRecent: { key: "recent", q: "亡くなる前3年以内に貸し始めましたか？" } as Question,
  livedTogether: (who: string): Question => ({ key: "livedTogether", q: `${who}は、亡くなる直前まで亡くなった方と同じ家に住んでいましたか？`, hint: "住民票が同じでも、実際に一緒に暮らしていなければ「いいえ」です。" }),
  keepHome: { key: "keep", q: "申告期限まで、この家に住み続け、土地を持ち続けますか？" } as Question,
  businessContinues: (who: string): Question => ({ key: "continues", q: `${who}は、申告期限までにその事業を引き継ぎ、続けますか？` }),
  businessRecent: { key: "recent", q: "亡くなる前3年以内に始めた事業ですか？" } as Question,
  // 生計を一にしていた親族が無料で住んでいた土地（措置法69条の4第3項2号）。place は「土地」か「部屋」
  familyHome: (place: string): Question => ({ key: "familyHome", q: `亡くなった方と同じ家計の家族（生計を一にしていた親族）が、無料で住んでいた${place}ですか？` }),
  // その親族本人が取得し、申告期限まで住み続け・持ち続けるか（3項2号ハ）
  familyKeep: (who: string): Question => ({ key: "keep", q: `${who}はその家族本人で、申告期限まで住み続け、持ち続けますか？` }),
};

/** 最初の取得者の答えで、3年以内に始めたかをすでに聞いているか（聞いていなければ、一緒に取得する人の欄で聞く） */
const firstAsksRecent = (kind: SmallLandKind, lot: SmallResidentialCheck) => kind !== "residence" && lot.continues === "yes" && lot.keep === "yes";

/**
 * 一緒に取得する人に聞くこと（人ごとの質問だけ）。土地についての質問は最初の人の欄で聞くので出さない。
 * ただし、事業用・貸付用で3年以内に始めたかを最初の人の欄で聞いていないときは、askRecent の人の欄で聞く（答えは最初の人の check に入る）
 */
export function otherAcquirerQuestions(
  kind: SmallLandKind,
  lot: SmallResidentialCheck,
  own: SmallResidentialCheck,
  person: Person | undefined,
  what: string,
  askRecent = true,
): Question[] {
  // 親族でない人は、答えによらず使えない（判定の文で知らせる）
  if (!person || person.relation === "other") return [];
  const who = person.name ? `${person.name}さん` : "取得する人";
  if (kind === "residence") {
    if (person.relation === "spouse") return [];
    // 家族が無料で住んでいた土地：その家族本人が住み続け・持ち続けるか
    if (lot.ownHome === "no") return lot.business === "no" && lot.familyHome === "yes" ? [Q.familyKeep(who)] : [];
    if (lot.ownHome !== "yes" || lot.special !== "no") return [];
    return [Q.livedTogether(who), ...(own.livedTogether === "yes" ? [Q.keepHome] : [])];
  }
  const out: Question[] = [kind === "rental" ? Q.rentalContinues(who) : Q.businessContinues(who)];
  if (own.continues === "yes") out.push(Q.keepUse(what));
  if (own.continues === "yes" && own.keep === "yes" && askRecent && !firstAsksRecent(kind, lot)) out.push(kind === "rental" ? Q.rentalRecent : Q.businessRecent);
  return out;
}

/** 一緒に取得する人の欄で、3年以内に始めたかを聞く人（最初の人の欄で聞いていれば -1。聞く人が何人いても、はじめの1人の欄だけで聞く） */
export function recentAskedAt(kind: SmallLandKind, lot: SmallResidentialCheck, others: SmallLandAcquirer[] | undefined): number {
  if (kind === "residence" || firstAsksRecent(kind, lot)) return -1;
  return (others ?? []).findIndex((o) => o.acquirerId && o.check?.continues === "yes" && o.check?.keep === "yes");
}

/** 土地についての答えで、誰が取得しても特例を使えないと決まっているか（自宅でも、事業用でも、家族が住んでいた土地でもない） */
const lotRuledOut = (kind: SmallLandKind, c: SmallResidentialCheck) => kind !== "rental" && c.ownHome === "no" && c.business === "no" && c.familyHome === "no";

function Ask({ q, hint, value, onChange, missing }: { q: string; hint?: string; value: Answer | undefined; onChange: (v: Answer) => void; missing?: boolean }) {
  // missing：答え始めたのに、まだ答えていない質問（特例の判定がここで止まっている）
  const miss = missing && value === undefined;
  return (
    <div className={`space-y-1 ${miss ? "-mx-2 rounded-md border-l-4 border-orange-400 bg-orange-50/70 px-2 py-1" : ""}`} data-missing={miss ? "" : undefined}>
      <p className="text-sm font-medium text-stone-800">
        {q}
        {miss && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 align-middle text-[11px] font-bold text-orange-800">未回答</span>}
      </p>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
      <Choice value={value} onChange={onChange} options={ANSWERS} />
    </div>
  );
}

export { type DivisionInput, smallLandDivisionGap, wholeTaker } from "@/lib/smallLand";

export function SmallResidential({
  living,
  a,
  patch,
  division,
}: {
  living: Person[];
  a: Extract<Asset, { kind: "land" | "condo" }>;
  patch: (p: Partial<Asset>) => void;
  /** 遺産の分け方（分け方のために特例を使わないときは、「減らして計算します」と出さない） */
  division?: DivisionInput;
}) {
  const sr = a.smallResidential ?? { applies: false };
  const check: SmallResidentialCheck = sr.check ?? {};
  const kind = smallLandKind(a);
  const rule = SMALL_LAND_RULE[kind];
  // 相続人が1人のときや、遺産の分け方でこの土地を1人が受け継ぐと決めたときは、その人が取得する人（答え始めると保存される。withSmallLandAcquirers）
  const taker = wholeTaker(division, a.id);
  const fixedTaker = taker && living.some((p) => p.id === taker) && (!sr.acquirerId || sr.acquirerId === taker) ? taker : undefined;
  const acquirerId = sr.acquirerId || fixedTaker;
  const acquirer = living.find((p) => p.id === acquirerId);
  // マンションの部屋では、説明の文を部屋の画面の入力（「家賃をもらって人に貸している」のチェック）に合わせる
  const opts = { assetKind: a.kind };
  const j = judgeSmallResidential(check, acquirer, kind, opts);
  // 特例を使うと判定したとき（税理士に確認して使えると分かったときも）は、分け方のために使えないかを確かめる
  const gap = shouldApply(j, check) ? smallLandDivisionGap(division, a.id, acquirerId) : null;
  const set = (next: Partial<SmallLandRelief>) => {
    const n: SmallLandRelief = { ...sr, ...(fixedTaker && !sr.acquirerId ? { acquirerId: fixedTaker } : {}), ...next };
    const c = n.check ?? {};
    // 自宅でなく事業に使っていた土地なら特定事業用、と答えで種類が変わるので、新しい答えで決め直して判定する
    const k = smallLandKind({ ...a, smallResidential: { ...n, check: c } });
    const jj = judgeSmallResidential(c, living.find((p) => p.id === n.acquirerId), k, opts);
    patch({ smallResidential: { ...n, check: c, applies: shouldApply(jj, c) } });
  };
  // 自宅の敷地か・事業に使っていたか・家族が住んでいたかを答え直したら、特例の種類や聞くことが変わるので、その先の答えは引き継がない
  const answer = (k: keyof SmallResidentialCheck, v: Answer) => set(answerFirstAcquirer(sr, k, v));
  // 答え始めたのに判定が決まらない（質問が残っている・取得する人を選んでいない）ときは、残っているところに印をつける
  const started = !!sr.acquirerId || Object.values(check).some((v) => v !== undefined && v !== false);
  const incomplete = started && j.result === "incomplete";
  const ask = ({ key, q, hint }: Question) => <Ask q={q} hint={hint} value={check[key] as Answer | undefined} onChange={(v) => answer(key, v)} missing={incomplete} />;
  const isSpouse = acquirer?.relation === "spouse";
  const what = a.kind === "condo" ? "この部屋" : "この土地";
  const place = a.kind === "condo" ? "部屋" : "土地";
  // 条件は満たしていても、分け方のために特例を使わないときは「使えます」を緑で見せない
  const tone = j.result === "ok" ? (gap ? "info" : "ok") : j.result === "consult" ? "warn" : j.result === "no" ? "info" : null;
  // 一緒に受け継いだ人・面積の一部の入力は、取得する人を選び、土地として特例を使える見込みがあるときだけ出す。
  // 最初の取得者が空になっても一緒に取得する人が残っていれば、その人の分は計算に入るので、見て外せるように出したままにする
  const more = (!!sr.acquirerId || !!sr.others?.some((o) => o.acquirerId)) && !lotRuledOut(kind, check);
  return (
    <div className="space-y-3 rounded-lg bg-stone-50 p-3 sm:col-span-2">
      <p className="font-bold text-stone-800">小規模宅地等の特例（評価が最大80%下がる）</p>
      <p className="text-xs text-stone-500">分からないときは特例を使わずに計算します。</p>
      {incomplete && <p className="text-sm font-semibold text-orange-800">あと少し：{j.reason}特例はまだ使っていません。</p>}
      <div data-missing={incomplete && !acquirer ? "" : undefined} className={incomplete && !acquirer ? "-mx-2 rounded-md border-l-4 border-orange-400 bg-orange-50/70 px-2 py-1" : ""}>
      {fixedTaker ? (
        <p className="text-sm text-stone-700">
          {what}を取得する人：<span className="font-semibold">{acquirer ? personLabel(acquirer) : ""}</span>
          <span className="ml-1 text-xs text-stone-500">{living.filter((p) => !p.renounced).length === 1 ? "（相続人が1人のため）" : "（遺産の分け方で決まっています）"}</span>
        </p>
      ) : (
      <Field label={`${what}を取得する人`}>
          <Select
            value={sr.acquirerId ?? ""}
            // 取得する人を変えたら、前の人についての答え（同居・続けるか・持ち続けるか）と税理士への確認は引き継がない
            onChange={(v) => v !== (sr.acquirerId ?? "") && set(firstAcquirerChange(sr, v))}
            options={[{ value: "", label: "選んでください" }, ...living.map((p) => ({ value: p.id, label: `${p.name || "（未入力）"}（${p.relationLabel ?? ""}）` }))]}
          />
        </Field>
      )}
      </div>
      {kind === "rental" ? (
        // 人に貸している土地・部屋（貸付事業用宅地等）：自宅かどうかは聞かない
        <>
          {ask(Q.rentalContinues("取得する人"))}
          {check.continues === "yes" && ask(Q.keepUse(what))}
          {check.continues === "yes" && check.keep === "yes" && ask(Q.rentalRecent)}
        </>
      ) : (
        <>
          {ask({ key: "ownHome", q: "亡くなった方が住んでいた自宅の敷地ですか？" })}
          {check.ownHome === "yes" &&
            ask({ key: "special", q: "老人ホームへの入居、二世帯住宅、建物の一部を貸していた などの事情はありますか？" })}
          {check.ownHome === "yes" && check.special === "no" && acquirer && !isSpouse && (
            <>
              {ask(Q.livedTogether(`${acquirer.name || "取得する人"}さん`))}
              {check.livedTogether === "yes" && ask(Q.keepHome)}
            </>
          )}
          {check.ownHome === "no" && ask({ key: "business", q: "亡くなった方が、お店や工場など自分の事業（人に貸す事業は除く）に使っていた土地ですか？" })}
          {check.ownHome === "no" && check.business === "no" && (
            // 生計を一にしていた親族が無料で住んでいた土地（特定居住用宅地等）：配偶者でなければ、その家族本人が住み続け・持ち続けるか
            <>
              {ask(Q.familyHome(place))}
              {check.familyHome === "yes" && acquirer && !isSpouse && ask(Q.familyKeep("取得する人"))}
            </>
          )}
          {kind === "business" && (
            // 特定事業用宅地等：事業を引き継いで続けるか → 持ち続けるか → 3年以内に始めた事業か
            <>
              {ask(Q.businessContinues("取得する人"))}
              {check.continues === "yes" && ask(Q.keepUse(what))}
              {check.continues === "yes" && check.keep === "yes" && ask(Q.businessRecent)}
            </>
          )}
        </>
      )}
      {tone && (
        <Note tone={tone}>
          {j.reason}
          {/* 事業用・貸付用は判定の文に限度面積と割合が入っているので、自宅のときだけ添える */}
          {j.result === "ok" && !gap && kind === "residence" && `${rule.limitSqm}㎡まで評価額を${rule.rate}%減らします。`}
        </Note>
      )}
      {gap && (
        <p className="text-xs font-medium text-amber-800">
          {gap === "undivided" ? "分け方が決まるまでは、特例を使わずに計算します。" : `${what}の分け方に、取得する人が入っていません。遺産の分け方を確かめてください。`}
        </p>
      )}
      {j.result === "consult" && (
        <div className="space-y-2">
          {!check.confirmedByAdvisor && <p className="text-sm text-stone-700">いまは特例を使わずに（高めに）計算しています。</p>}
          <div className="flex flex-wrap items-center gap-3">
            <ConsultLink topic="特例" />
            <Check checked={!!check.confirmedByAdvisor} onChange={(v) => set({ check: { ...check, confirmedByAdvisor: v } })} label="税理士に確認し、特例を使えることが分かった" />
          </div>
        </div>
      )}
      {more && (
        <>
          <OtherAcquirers living={living} a={a} sr={sr} kind={kind} what={what} division={division} set={set} />
          <PartialArea living={living} a={a} sr={sr} division={division} set={set} />
        </>
      )}
    </div>
  );
}

const detailsCls = "rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm";
const summaryCls = "cursor-pointer py-1 text-sm font-medium text-teal-800";
const personLabel = (p: Person) => `${p.name || "（未入力）"}（${p.relationLabel ?? ""}）`;

/**
 * 一つの土地を何人かで受け継ぎ（共有）、2人目以降の人も特例を使うとき。特例は受け継いだ人ごとに判定し、
 * その人の持分の分だけに使う（措置法69条の4第3項）。土地についての答えは最初の人の欄の答えを使い、ここでは人ごとのことだけ聞く
 */
function OtherAcquirers({
  living,
  a,
  sr,
  kind,
  what,
  division,
  set,
}: {
  living: Person[];
  a: Extract<Asset, { kind: "land" | "condo" }>;
  sr: SmallLandRelief;
  kind: SmallLandKind;
  what: string;
  division?: DivisionInput;
  set: (next: SmallLandRelief) => void;
}) {
  const others = sr.others ?? [];
  const lot = sr.check ?? {};
  const opts = { assetKind: a.kind };
  const taken = new Set([sr.acquirerId, ...others.map((o) => o.acquirerId)]);
  const canAdd = others.every((o) => o.acquirerId) && living.some((p) => !taken.has(p.id));
  // ほかに受け継ぐ人がいない（相続人が1人など）ときは、開いても何もできないので出さない
  if (others.length === 0 && !canAdd) return null;
  const recentAt = recentAskedAt(kind, lot, others.map((o) => (living.some((p) => p.id === o.acquirerId) ? o : { acquirerId: "" })));
  return (
    <details className={detailsCls}>
      <summary className={summaryCls}>
        何人かで受け継ぐとき{others.length > 0 ? `（${others.length}人）` : ""}
      </summary>
      <div className="mt-2 space-y-3">
        <p className="text-xs text-stone-500">使えるかは受け継いだ人ごとに決まり、その人が受け継いだ分だけに使えます。</p>
        {others.map((o, i) => {
          const person = living.find((p) => p.id === o.acquirerId);
          const own = o.check ?? {};
          const merged = otherAcquirerCheck(lot, own);
          const jj = judgeSmallResidential(merged, person, kind, opts);
          const gap = shouldApply(jj, merged) ? smallLandDivisionGap(division, a.id, o.acquirerId) : null;
          const tone = jj.result === "ok" ? (gap ? "info" : "ok") : jj.result === "consult" ? "warn" : jj.result === "no" ? "info" : null;
          const options = living.filter((p) => p.id === o.acquirerId || !taken.has(p.id)).map((p) => ({ value: p.id, label: personLabel(p) }));
          return (
            <div key={`${i}:${o.acquirerId}`} className="space-y-3 border-t border-stone-100 pt-3">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label="一緒に取得する人">
                    <Select value={o.acquirerId} onChange={(v) => v !== o.acquirerId && set(setOtherAcquirerPerson(sr, i, v))} options={[{ value: "", label: "選んでください" }, ...options]} />
                  </Field>
                </div>
                <button
                  type="button"
                  onClick={() => set(removeOtherAcquirer(sr, i))}
                  aria-label="この人を外す"
                  title="この人を外す"
                  className="mb-1 shrink-0 rounded-lg px-3 py-1.5 text-lg leading-none text-stone-500 hover:bg-red-50 hover:text-red-700"
                >
                  ×
                </button>
              </div>
              {otherAcquirerQuestions(kind, lot, own, person, what, i === recentAt).map((q) => (
                <Ask key={q.key} q={q.q} hint={q.hint} value={(q.key === "recent" ? lot.recent : own[q.key]) as Answer | undefined} onChange={(v) => set(answerOtherAcquirer(sr, i, q.key, v))} />
              ))}
              {person && tone && <Note tone={tone}>{jj.reason}</Note>}
              {gap && (
                <p className="text-xs font-medium text-amber-800">
                  {gap === "undivided" ? "分け方が決まるまでは、特例を使わずに計算します。" : `${what}の分け方に、この人が入っていません。遺産の分け方を確かめてください。`}
                </p>
              )}
              {person && jj.result === "consult" && (
                <Check checked={!!own.confirmedByAdvisor} onChange={(v) => set(confirmOtherAcquirer(sr, i, v))} label="税理士に確認し、特例を使えることが分かった" />
              )}
            </div>
          );
        })}
        {canAdd && (
          <button type="button" onClick={() => set(addOtherAcquirer(sr))} className="py-2 text-sm font-semibold text-teal-800 hover:underline">
            ＋ 取得する人を追加
          </button>
        )}
      </div>
    </details>
  );
}

/** 受け継いだ面積の一部だけに特例を使うとき（付表1の⑤「選択特例対象宅地等の面積」）。空欄なら使える面積をすべて使う */
function PartialArea({
  living,
  a,
  sr,
  division,
  set,
}: {
  living: Person[];
  a: Extract<Asset, { kind: "land" | "condo" }>;
  sr: SmallLandRelief;
  division?: DivisionInput;
  set: (next: SmallLandRelief) => void;
}) {
  const lot = sr.check ?? {};
  const kind = smallLandKind(a);
  // 特例を使える人の分だけ出す（使えない人の面積は計算に使わない）
  const rows = [
    { who: null as number | null, id: sr.acquirerId, value: sr.selectedSqm, check: lot },
    ...(sr.others ?? []).map((o, i) => ({ who: i as number | null, id: o.acquirerId, value: o.selectedSqm, check: otherAcquirerCheck(lot, o.check) })),
  ].filter((r) => {
    const person = living.find((p) => p.id === r.id);
    return !!person && shouldApply(judgeSmallResidential(r.check, person, kind, { assetKind: a.kind }), r.check);
  });
  if (rows.length === 0) return null;
  const many = rows.length > 1;
  const entered = rows.some((r) => r.value != null);
  return (
    <details className={detailsCls}>
      <summary className={summaryCls}>面積の一部だけに特例を使うとき{entered ? "（入力あり）" : ""}</summary>
      <div className="mt-2 space-y-3">
        <p className="text-xs text-stone-500">空欄なら、使える面積をすべて使います。</p>
        {rows.map((r) => {
          const p = living.find((x) => x.id === r.id)!;
          const got = acquiredSqm(a, division, r.id);
          return (
            <Field key={`${r.who ?? "first"}:${r.id}`} label={many ? `${p.name || "（未入力）"}さん：特例を使う面積（㎡）` : "特例を使う面積（㎡）"} hint={got != null ? `特例の対象になる面積は${fmt(got)}㎡です` : undefined}>
              <OptionalNumInput value={r.value} accept={(v) => v > 0} onChange={(v) => set(setSelectedSqm(sr, r.who, v))} />
            </Field>
          );
        })}
      </div>
    </details>
  );
}

type RosenkaMethod = Extract<LandAsset["method"], { type: "rosenka" }>;
const EDGE_LABEL = ["正面側", "右側", "奥側", "左側"];

/** 面している道路ごとの路線価・奥行・間口。2つ以上なら側方・二方路線影響加算（高めに評価） */
function RoadsEditor({ a, m, patch }: { a: LandAsset; m: RosenkaMethod; patch: (p: Partial<Asset>) => void }) {
  const district: District = m.district ?? "普通住宅地区";
  // 以前の入力（道路が1つ・奥行価格補正率を直接入力）は、正面の道路1つとして見せる
  const roads: RoadInput[] = m.roads?.length ? m.roads : [{ edge: 0, price: m.routePrice, depth: m.lot?.depth ?? 0 }];
  // 形がいびつな土地で修正した補正率（不整形地補正率）が1未満なら、間口が狭い・奥行が長い補正をしない（評価の計算と同じ）。
  // 1（減額なし）のときは、間口が狭い・奥行が長い補正はふつうどおりする（付表5（注）3）
  const irregular = a.condition === "irregular" && m.otherCorrection != null && m.otherCorrection > 0 && m.otherCorrection < 1;
  const save = (next: RoadInput[], d = district) => {
    const r = evaluateRoads(d, next);
    patch({ method: { ...m, district: d, roads: next, routePrice: r?.front.price ?? next[0]?.price ?? 0, depthCorrection: r?.front.depthRate ?? m.depthCorrection } });
  };
  const setRoad = (i: number, p: Partial<RoadInput>) => save(roads.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const used = new Set(roads.map((r) => r.edge));
  const free = ([0, 1, 2, 3] as Edge[]).filter((e) => !used.has(e));
  const ev = evaluateRoads(district, roads, { irregular });
  const role = (e: Edge) => ev?.lines.find((l) => l.edge === e)?.role;
  // 路線価か奥行が入っていない道路があると評価額は確定しない（その道路を外して低く計算しないため）
  const incomplete = !!m.roads?.length && m.roads.some((r) => !(r.price > 0) || !(r.depth > 0));
  // 補正率の欄を最初から開いておくか（開いた後に空欄にしても、入力中に閉じないよう最初の値だけで決める）
  const [correctionOpen] = useState(m.otherCorrection != null);
  return (
    <div className="space-y-3 sm:col-span-2">
      <Field label="地区区分" hint="路線価を囲む記号の形で決まります（記号なしは普通住宅地区）">
        <Select value={district} onChange={(v) => save(roads, v as District)} options={DISTRICTS.map((d) => ({ value: d, label: d }))} />
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-medium text-stone-700">面している道路と路線価</p>
        {roads.map((r, i) => (
          // スマートフォンでは、道路の位置と路線価を1行ずつにする（路線価の数字が欠けないように）。奥行と間口は横に並べる
          <div key={r.edge} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-stone-200 p-2 sm:grid-cols-[7rem_1fr_6rem_6rem_auto]">
            <div className="col-span-2 sm:col-span-1">
              <Field label="道路の位置">
                <Select
                  value={String(r.edge)}
                  onChange={(v) => setRoad(i, { edge: Number(v) as Edge })}
                  options={[r.edge, ...free].sort().map((e) => ({ value: String(e), label: EDGE_LABEL[e] }))}
                />
              </Field>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Field label={`路線価${role(r.edge) ? `（${{ front: "正面", side: "側方", back: "裏面" }[role(r.edge)!]}）` : ""}`}>
                <YenInput value={r.price} onChange={(v) => setRoad(i, { price: v })} unit="円/㎡" />
              </Field>
            </div>
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
        <p className="text-xs text-stone-500">路線価図の数字は千円単位（420D → 420,000円）</p>
      </div>
      {incomplete && <Note tone="warn">路線価か奥行が入っていない道路があります。すべての道路に入れるまで評価額は計算しません。面していない道路は「削除」してください。</Note>}
      {ev && !incomplete && (
        <div className="rounded-lg bg-teal-50 p-3 text-sm text-teal-950">
          <p className="font-semibold">1㎡あたり {fmt(ev.perSqm)}円</p>
          {ev.lines.length > 1 && <p className="text-xs">正面は、路線価×奥行価格補正率がいちばん高い道路です。</p>}
          {/* 計算に使った補正率（自分で直した率があれば、それも） */}
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
            {correctionRates(ev, m.otherCorrection).map(([k, v]) => (
              <Fragment key={k}>
                <dt>{k}</dt>
                <dd className="text-right font-semibold tabular-nums">{v}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
      <Note tone="info">
        {irregular
          ? "形がいびつな土地なので、間口が狭い・奥行が長い補正はせず、修正した補正率を使います。"
          : "間口を入れると、間口が狭い・奥行が長い分も減額します。"}
        がけ地などの減額はしていません（高めに出ることがあります）。
        <span className="mt-2 block">
          <ConsultLink topic="土地の評価" />
        </span>
      </Note>
      <details className="text-xs text-stone-600">
        <summary className="tips-summary cursor-pointer py-2 font-medium text-teal-800">Tips：計算していないことと補正率の入れ方</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>奥行は、その道路から土地の反対側までの距離、間口は、その道路に接している部分の長さです。</li>
          <li>間口が狭い・奥行が長い補正は、正面の道路の間口を入れたときだけします（財産評価基本通達20-4）。</li>
          <li>角地は、一方が行き止まりの道路の角（準角地）かどうかを区別せず、加算の大きい角地として計算します。</li>
          <li>横や裏の道路に一部しか接していない場合も、全部接しているものとして計算します。</li>
          <li>形がいびつな土地（不整形地）、がけ地、道路に接していない土地、都市計画道路の予定地などの減額はしていません。形がいびつな土地は、上の「この土地に当てはまること」で選んでください。</li>
          <li>補正率を自分で直すときは、下の「補正率を修正」を開いて入れると計算に使います。</li>
          <li>形がいびつな土地は、最後の不整形地補正率（間口が狭い・奥行が長い分も含めた率）を入れてください。このときは間口による補正はしません（二重に下げないため）。</li>
          <li>広い土地（地積規模の大きな宅地）にもあたるときは、その補正（規模格差補正率）も掛け合わせた率を入れてください。</li>
          <li>減額にならない（当てはまらない）と分かったときは 1 を入れてください。形による補正なしで計算します（間口が狭い・奥行が長い補正はふつうどおりします）。</li>
        </ul>
      </details>
      {/* 自分で直すときだけ使う欄なので畳む。入れてあれば（1を超える古い値も）開いておく */}
      <details className={detailsCls} open={correctionOpen}>
        <summary className={summaryCls}>補正率を修正</summary>
        <div className="mt-2">
          <Field label="補正率" hint="例：0.92。上の計算に、さらに掛けます（空欄なら上の計算どおり）">
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
        </div>
      </details>
      {a.method.type === "rosenka" && a.method.lot && <p className="text-xs text-stone-500">地図で合わせた枠：間口{a.method.lot.width}m × 奥行{a.method.lot.depth}m</p>}
    </div>
  );
}

/**
 * 土地の使い方。貸している使い方は、家賃・地代をもらっている（賃貸借）ときだけ。
 * 家族などに無料（固定資産税くらいの額だけ）で貸している使用貸借は、貸していることにならず自用地（使用貸借通達）
 */
export const USE_OPTIONS: { value: LandUse; label: string }[] = [
  { value: "self", label: "自分で使っている（自宅・空き地・駐車場など）" },
  { value: "rentedHouse", label: "家賃をもらってアパート・貸家を貸している" },
  { value: "leasedLand", label: "地代をもらって土地を貸し、借りた人が建物を建てている" },
  { value: "leasehold", label: "人の土地を借りて、自宅などの建物を建てている（借地権）" },
  { value: "rentedLeasehold", label: "人の土地を借りて建てたアパート・貸家を、家賃をもらって貸している" },
];

/** 賃貸割合を聞く土地の使い方（貸家建付地・貸家建付借地権） */
export const usesRentRatio = (use: LandUse) => use === "rentedHouse" || use === "rentedLeasehold";

/**
 * 土地の使い方を変えるときの変更。賃貸割合はアパート・貸家を貸しているときだけ残す。
 * 借地権割合は場所で決まるものなので残す。特例の種類が変わるなら、前の種類のための答えは引き継がない
 */
export function landUsePatch(a: LandAsset, v: LandUse): Partial<LandAsset> {
  const p: Partial<LandAsset> = { use: v === "self" ? undefined : v, rentRatio: usesRentRatio(v) ? a.rentRatio : undefined };
  return { ...p, ...resetSmallOnKindChange(a, p) };
}

/** 土地の使い方の選び方（くわしい説明は Tips に入れ、画面には短い案内だけ出す） */
function UseTips() {
  return (
    <details className="text-xs text-stone-600 sm:col-span-2">
      <summary className="tips-summary cursor-pointer py-2 font-medium text-teal-800">Tips：土地の使い方の選び方</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>家族などに無料で貸している土地は、貸していることになりません（固定資産税くらいの額を受け取るだけのときも同じです。使用貸借といいます）。「自分で使っている」を選んでください。</li>
        <li>地代を払わずに（固定資産税くらいの額だけ払って）人の土地を借りて建物を建てているときは、土地を借りている権利は0円なので、この土地は財産に入れません。建物は「家屋」として入れてください。</li>
        <li>地代をもらっていても、「土地の無償返還に関する届出書」を税務署に出している場合や、地代がふつうよりかなり高い場合は、評価が変わります。税理士にご相談ください。</li>
        <li>
          貸している割合は、貸している部屋の床面積 ÷ 貸せる部屋全部の床面積です。廊下・階段などのみんなで使う部分は入れません。入居者の入れ替えなどで一時的に空いている部屋（すぐに次の入居者を募集している部屋）は貸しているものとして数え、長く空いたままの部屋は除きます。
        </li>
      </ul>
    </details>
  );
}

const CONDITION_OPTIONS: { value: NonNullable<LandAsset["condition"]> | ""; label: string }[] = [
  { value: "", label: "特になし" },
  { value: "irregular", label: "形がいびつ（旗竿地・三角形・L字など）" },
  { value: "setback", label: "前の道路の幅が4m未満（建て替えのとき下がる部分がある）" },
  { value: "spouseResidence", label: "配偶者居住権を設定した" },
];

/**
 * 評価額を直接入力するときの欄の名前と案内。入れた額は自用地としての評価額として扱い、
 * 貸している・借りている土地はこのあと貸家建付地・貸宅地・借地権などの計算をする（二重に下げないよう、その前の額を入れてもらう）
 */
export function manualValueLabel(use: LandUse | undefined): { label: string; hint?: string } {
  if (!use || use === "self") return { label: "評価額" };
  return { label: "評価額（自分の土地を自分で使っているとした場合）", hint: "貸している・借りている分は、このあと自動で計算します。その分を引く前の額を入れてください" };
}

/** 借地権割合を決める路線価の記号（A〜G）。評価の計算と同じく、道路があれば正面の道路、なければ路線価図の表記から読む */
function roadLetter(a: LandAsset): LeaseLetter | undefined {
  const m = a.method;
  if (m.type !== "rosenka") return undefined;
  const notation = m.roads?.length ? evaluateRoads(m.district ?? "普通住宅地区", m.roads)?.front.notation : a.rosenkaSheet?.notation;
  return leaseLetterOf(notation);
}

/** 減額していない事情ごとの、相談をすすめる理由の言い方 */
const REDUCTION_REASON: Record<PendingReduction, (a: LandAsset) => string> = {
  setback: () => "前の道路の幅が4m未満の可能性があり",
  irregular: () => "形がいびつな土地で",
  largeLot: (a) => `${a.areaSqm.toLocaleString()}㎡の広い宅地で`,
};

/**
 * 形がいびつ・セットバック・広い宅地：止めずに減額しない評価額で計算し、税理士に相談するかは本人が選ぶ（相談をすすめる）。
 * 相談して補正率が分かれば「補正率を修正」で入れる（倍率方式・直接入力なら評価額を直接入力）
 */
export function ReductionChoice({ a, patch }: { a: LandAsset; patch: (p: Partial<Asset>) => void }) {
  const open = pendingReductions(a);
  if (!open.length) return null;
  const pick = (v: boolean) => patch({ reductionConsult: v } as Partial<Asset>);
  const btn = (on: boolean) =>
    `min-h-10 flex-1 rounded-lg border px-3 py-1.5 text-sm font-semibold ${on ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"}`;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm sm:col-span-2" data-reduction={open.join(" ")}>
      <p className="text-stone-800">{open.map((r) => REDUCTION_REASON[r](a)).join("、")}、税理士に相談すると評価額が下がる可能性があります（相談をおすすめします）。</p>
      <div className="mt-2 flex gap-2" role="group" aria-label="税理士に相談するか">
        <button type="button" aria-pressed={a.reductionConsult === true} onClick={() => pick(true)} className={btn(a.reductionConsult === true)}>
          相談する
        </button>
        <button type="button" aria-pressed={a.reductionConsult === false} onClick={() => pick(false)} className={btn(a.reductionConsult === false)}>
          相談しない
        </button>
      </div>
      {a.reductionConsult === true && (
        <div className="mt-2 space-y-2 text-xs text-stone-700">
          <p>{a.method.type === "rosenka" ? "補正率が分かったら、下の「補正率を修正」で入れてください。" : "評価額が分かったら、評価方法を「評価額を直接入力」にして入れてください。"}それまでは減額しない評価額で計算します。</p>
          <details>
            <summary className="tips-summary cursor-pointer py-1 font-medium text-teal-800">Tips：税理士に確認すること</summary>
            <p className="leading-relaxed">{reductionAdvice(a)}</p>
          </details>
          <ConsultLink topic="土地の評価" />
        </div>
      )}
      {a.reductionConsult === false && <p className="mt-2 text-xs text-stone-600">減額しない評価額で計算します（申告額が高めになることがあります）。</p>}
    </div>
  );
}

/** 土地の入力の区切り（2列の並びをまたいで、番号つきの見出しを出す） */
function Part({ n, title }: { n: number; title: string }) {
  return (
    <h3 className="mt-3 flex items-center gap-2 border-b border-stone-200 pb-1.5 text-sm font-bold text-stone-900 sm:col-span-2">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sky-800 text-[11px] text-white">{n}</span>
      {title}
    </h3>
  );
}

export function LandEditor({
  living,
  a,
  patch,
  division,
}: {
  living: Person[];
  a: LandAsset;
  patch: (p: Partial<Asset>) => void;
  /** 遺産の分け方（小規模宅地等の特例の案内に使う） */
  division?: DivisionInput;
}) {
  const m = a.method;
  const use = a.use ?? "self";
  const letter = roadLetter(a);
  const setUse = (v: LandUse) => patch(landUsePatch(a, v));
  return (
    <>
      <Part n={1} title="場所と使い方" />
      <Field label="所在地番">
        <TextInput value={a.location} onChange={(e) => patch({ location: e.target.value })} />
      </Field>
      <Field label="地積">
        <NumInput value={a.areaSqm} onChange={(v) => patch({ areaSqm: v })} unit="㎡" />
      </Field>
      <Field label="土地の使い方" hint="家族に無料で貸している土地も「自分で使っている」">
        <Select value={use} onChange={(v) => setUse(v as LandUse)} options={USE_OPTIONS} />
      </Field>
      {usesRentRatio(use) && <RentRatioField value={a.rentRatio} onChange={(v) => patch({ rentRatio: v })} />}
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
      <UseTips />
      <Part n={2} title="評価のしかた" />
      {(a.landUse === "宅地" || a.landUse === "雑種地") && (
        <Field label="この土地に当てはまること">
          <Select value={a.condition ?? ""} onChange={(v) => patch({ condition: (v || undefined) as LandAsset["condition"], reductionConsult: undefined })} options={CONDITION_OPTIONS} />
        </Field>
      )}
      <ReductionChoice a={a} patch={patch} />
      <Field label="評価方法" hint="分からなければ「地図で評価する」で決まります">
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
          地図で評価する
        </Link>
      </div>
      <Part n={3} title={m.type === "rosenka" ? "道路と路線価" : m.type === "multiplier" ? "固定資産税評価額と倍率" : "評価額"} />
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
            // 直接入力の額は自用地としての額。貸している・借りている土地は、このあと貸家建付地・借地権などの計算をするので、その前の額を入れてもらう
            <Field label={manualValueLabel(use).label} hint={manualValueLabel(use).hint}>
              <YenInput value={m.value} onChange={(v) => patch({ method: { ...m, value: v } })} />
            </Field>
          )}
          <div className="space-y-1 sm:col-span-2">
            <Check
              checked={!!m.publicPrivateRoad}
              onChange={(v) => patch({ method: { ...m, publicPrivateRoad: v || undefined } })}
              label="誰でも通り抜けできる私道なので、評価しない（0円）"
            />
            <p className="text-xs text-stone-500">行き止まりで近くの家の人だけが使う私道などは0円になりません。分からなければ税理士にご相談ください。</p>
          </div>
        </>
      )}
      <Part n={4} title="特例" />
      <SmallResidential living={living} a={a} patch={patch} division={division} />
    </>
  );
}
