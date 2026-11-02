/**
 * 相続人と法定相続分の判定。
 *
 * 根拠:
 * - 民法887条（子・代襲・再代襲）、889条（直系尊属・兄弟姉妹、兄弟姉妹の代襲は1代限り）、
 *   890条（配偶者）、900条（法定相続分、半血兄弟は全血の1/2）、901条（代襲相続人の相続分＝株分け）、
 *   939条（放棄者は初めから相続人とならなかったものとみなす。代襲も生じない）
 * - 相続税法15条（基礎控除の法定相続人の数：放棄がなかったものとし、養子は実子がいれば1人・いなければ2人まで。
 *   15条3項の「実子とみなす養子」は制限なし）、16条（相続税の総額：同じ前提で計算した法定相続分）
 */
import { Fraction, ONE, ZERO, div, frac, mul, sub, sum } from "./fraction";
import type { Person } from "./types";

export type Mode = "civil" | "tax";
export type Rank = 0 | 1 | 2 | 3; // 0 = 配偶者のみ（血族相続人なし）

export interface ShareSlot {
  /** この枠に含まれる人（養子の人数制限で複数人を1枠とすることがある） */
  personIds: string[];
  share: Fraction;
  /** 第2表等の表示用 */
  label: string;
}

export interface HeirResult {
  mode: Mode;
  rank: Rank;
  spouseId?: string;
  slots: ShareSlot[];
  /** 法定相続人の数（tax モードでは相法15条の数） */
  count: number;
  /** 個人ごとの法定相続分（civil は相続人全員、tax は養子制限前の個人按分） */
  byPerson: Map<string, Fraction>;
  notes: string[];
}

interface Stock {
  root: Person;
  /** 枝の中の相続人と、その枝内での割合 */
  members: { person: Person; weight: Fraction }[];
  /** 生存している養子本人（相法15条の人数制限の対象） */
  limitedAdopted: boolean;
}

const isAlive = (p: Person) => !p.predeceased;

function excluded(p: Person, mode: Mode) {
  return mode === "civil" && !!p.renounced;
}

/** 被代襲者 p の枝を株分けで展開する。maxDepth は再代襲を何代まで認めるか */
function expandStock(p: Person, all: Person[], mode: Mode, maxDepth: number): { person: Person; weight: Fraction }[] {
  if (excluded(p, mode)) return [];
  if (isAlive(p)) return [{ person: p, weight: ONE }];
  if (maxDepth <= 0) return [];
  const subs = all.filter((s) => s.substituteOf === p.id);
  const branches = subs
    .map((s) => expandStock(s, all, mode, maxDepth - 1))
    .filter((b) => b.length > 0);
  if (branches.length === 0) return [];
  const each = frac(1, branches.length);
  return branches.flatMap((b) => b.map((m) => ({ person: m.person, weight: mul(m.weight, each) })));
}

function buildStocks(roots: Person[], all: Person[], mode: Mode, maxDepth: number): Stock[] {
  return roots
    .map((root) => ({
      root,
      members: expandStock(root, all, mode, maxDepth),
      limitedAdopted:
        root.relation === "adoptedChild" && isAlive(root) && !root.adoptedCountsAsBiological,
    }))
    .filter((s) => s.members.length > 0);
}

export function determineHeirs(persons: Person[], mode: Mode): HeirResult {
  const notes: string[] = [];
  const spouse = persons.find((p) => p.relation === "spouse" && isAlive(p) && !excluded(p, mode));

  // 第1順位：子（代襲・再代襲あり）
  const childRoots = persons.filter(
    (p) => (p.relation === "child" || p.relation === "adoptedChild") && !p.substituteOf,
  );
  const childStocks = buildStocks(childRoots, persons, mode, 10);

  // 第2順位：直系尊属（親等の近い者）
  const parents = persons.filter((p) => p.relation === "parent" && isAlive(p) && !excluded(p, mode));
  const grandparents = persons.filter(
    (p) => p.relation === "grandparent" && isAlive(p) && !excluded(p, mode),
  );
  // 第3順位：兄弟姉妹（代襲は甥姪まで）
  const siblingRoots = persons.filter((p) => p.relation === "sibling" && !p.substituteOf);
  const siblingStocks = buildStocks(siblingRoots, persons, mode, 1);

  let rank: Rank = 0;
  let bloodShare = ZERO;
  let spouseShare = ONE;
  const slots: ShareSlot[] = [];
  const byPerson = new Map<string, Fraction>();

  const bloodTotal = (s: Fraction) => (spouse ? s : ONE);

  if (childStocks.length > 0) {
    rank = 1;
    bloodShare = bloodTotal(frac(1, 2));
    spouseShare = frac(1, 2);
    let stocks = childStocks;
    let pooled: Stock[] = [];
    if (mode === "tax") {
      const bio = childStocks.filter((s) => !s.limitedAdopted);
      const adopted = childStocks.filter((s) => s.limitedAdopted);
      const limit = bio.length > 0 ? 1 : 2;
      if (adopted.length > limit) {
        notes.push(
          `養子が${adopted.length}人いますが、相続税法15条により法定相続人の数に算入できるのは${limit}人までです。`,
        );
        stocks = bio;
        pooled = adopted;
      }
    }
    const pooledSlots = pooled.length > 0 ? (stocks.length > 0 ? 1 : 2) : 0;
    const slotCount = stocks.length + pooledSlots;
    const perStock = div(bloodShare, frac(slotCount));
    for (const st of stocks) {
      for (const m of st.members) {
        const share = mul(perStock, m.weight);
        byPerson.set(m.person.id, share);
        slots.push({ personIds: [m.person.id], share, label: m.person.name });
      }
    }
    if (pooledSlots > 0) {
      const ids = pooled.map((s) => s.root.id);
      const pooledTotal = mul(perStock, frac(pooledSlots));
      for (let i = 0; i < pooledSlots; i++) {
        slots.push({
          personIds: ids,
          share: perStock,
          label: `養子（${ids.length}人中${pooledSlots}人を算入）`,
        });
      }
      for (const id of ids) byPerson.set(id, div(pooledTotal, frac(ids.length)));
    }
  } else if (parents.length > 0 || grandparents.length > 0) {
    rank = 2;
    const asc = parents.length > 0 ? parents : grandparents;
    bloodShare = bloodTotal(frac(1, 3));
    spouseShare = frac(2, 3);
    const each = div(bloodShare, frac(asc.length));
    for (const p of asc) {
      byPerson.set(p.id, each);
      slots.push({ personIds: [p.id], share: each, label: p.name });
    }
  } else if (siblingStocks.length > 0) {
    rank = 3;
    bloodShare = bloodTotal(frac(1, 4));
    spouseShare = frac(3, 4);
    // 半血兄弟姉妹は全血の1/2（民法900条4号ただし書）
    const units = siblingStocks.map((s) => (s.root.halfBlood ? frac(1) : frac(2)));
    const totalUnits = sum(units);
    siblingStocks.forEach((st, i) => {
      const stockShare = mul(bloodShare, div(units[i], totalUnits));
      for (const m of st.members) {
        const share = mul(stockShare, m.weight);
        byPerson.set(m.person.id, share);
        slots.push({ personIds: [m.person.id], share, label: m.person.name });
      }
    });
  }

  if (spouse) {
    const share = rank === 0 ? ONE : spouseShare;
    byPerson.set(spouse.id, share);
    slots.unshift({ personIds: [spouse.id], share, label: spouse.name });
  }

  const total = sum(slots.map((s) => s.share));
  if (slots.length > 0 && sub(total, ONE).n !== 0n) {
    throw new Error(`法定相続分の合計が1になりません: ${total.n}/${total.d}`);
  }

  return {
    mode,
    rank,
    spouseId: spouse?.id,
    slots,
    count: slots.length,
    byPerson,
    notes,
  };
}

/**
 * 相続税額の2割加算の対象か（相続税法18条）。
 * 一親等の血族（代襲相続人となった孫等を含む）と配偶者以外が対象。
 * 孫養子は一親等の血族だが、代襲相続人でない限り加算対象（18条2項）。
 */
export function isSurchargeTarget(p: Person): boolean {
  if (p.relation === "spouse" || p.relation === "parent") return false;
  if (p.relation === "child") return false;
  if (p.relation === "adoptedChild") return !!p.grandchildAdopted && !p.substituteOf;
  if ((p.relation === "grandchild" || p.relation === "greatGrandchild") && p.substituteOf) {
    return false;
  }
  return true;
}

/** 民法上の相続人（相続放棄者を除く）。生命保険金等の非課税枠の適用者判定に使う */
export function civilHeirIds(persons: Person[]): Set<string> {
  return new Set(determineHeirs(persons, "civil").slots.flatMap((s) => s.personIds));
}
