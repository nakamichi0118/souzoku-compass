import type { Case, SmallLandRelief } from "@/domain/types";

/** 小規模宅地等の特例の計算に使う、遺産の分け方の入力 */
export type DivisionInput = Pick<Case, "undivided" | "allocations">;

/**
 * 特例の条件を満たしていても、分け方の入力のために計算では特例を使わないとき、その理由（計算と同じ判定）。
 * 特例は、取得する人が分け方で受け継ぐと決まった部分だけに使える（租税特別措置法69条の4第4項）。
 * undivided：分け方がまだ決まっていない部分があり、取得する人の分が決まっていない。
 * notAcquirer：分け方が入っているのに、取得する人が入っていない。
 * 分け方をまだ入れていない（未分割でもない）ときは、これから入れるので null
 */
export function smallLandDivisionGap(division: DivisionInput | undefined, assetId: string, acquirerId: string | undefined): "undivided" | "notAcquirer" | null {
  if (!division || !acquirerId) return null;
  const shares = division.allocations.find((x) => x.assetId === assetId)?.shares ?? [];
  const valid = shares.filter((s) => Number.isInteger(s.numerator) && Number.isInteger(s.denominator) && s.numerator > 0 && s.denominator > 0);
  if (valid.some((s) => s.personId === acquirerId)) return null;
  // 決まった割合の合計が1に届かない（何も決まっていないときを含む）なら、残りは法定相続分で分けたもの（未分割）
  const decided = valid.reduce((t, s) => t + s.numerator / s.denominator, 0);
  if (division.undivided && decided < 1 - 1e-9) return "undivided";
  return shares.length > 0 ? "notAcquirer" : null;
}

/** 遺産の分け方で、その財産を1人が全部受け継ぐと決まっているとき、その人の id（決まっていない・何人かで分けるときは undefined） */
export function wholeTaker(division: DivisionInput | undefined, assetId: string): string | undefined {
  const shares = division?.allocations.find((x) => x.assetId === assetId)?.shares ?? [];
  const valid = shares.filter((s) => Number.isInteger(s.numerator) && Number.isInteger(s.denominator) && s.numerator > 0 && s.denominator > 0);
  if (valid.length !== 1 || valid[0].numerator !== valid[0].denominator) return undefined;
  return valid[0].personId;
}

/** 特例を一緒に使う2人目以降の人に、その人が入っているか */
export const inOthers = (sr: SmallLandRelief | undefined, id: string) => (Array.isArray(sr?.others) ? sr.others : []).some((o) => o?.acquirerId === id);

/**
 * 小規模宅地等の特例の欄に答え始めたのに「取得する人」が空のまま、その土地（部屋）を受け継ぐ人が1人に決まっているときは、その人を入れる。
 * 相続人が1人のとき（分け方の入力を省いて、その人が全部受け継ぐ）や、遺産の分け方でその土地を1人が受け継ぐと決めたとき。
 * 取得する人を選ばないと特例の判定が「途中」のままで、特例を使わずに計算されてしまうため。
 * すでに選んである人は変えない（分け方と違うときは、土地の画面と税額の画面で知らせる）
 */
export function withSmallLandAcquirers(c: Case): Case {
  const fill = new Map<string, string>();
  for (const a of c.assets) {
    if ((a.kind !== "land" && a.kind !== "condo") || !a.smallResidential || a.smallResidential.acquirerId) continue;
    const id = wholeTaker(c, a.id);
    // その人がすでに「一緒に取得する人」に入っているときは、その行の答え（同居・住み続けるか など）で計算されるので入れない
    // （1人目にも入れると同じ人が2回になり、答えのない1人目の行だけが判定される）
    if (id && c.persons.some((p) => p.id === id && !p.predeceased) && !inOthers(a.smallResidential, id)) fill.set(a.id, id);
  }
  if (fill.size === 0) return c;
  return {
    ...c,
    assets: c.assets.map((a) => {
      const id = fill.get(a.id);
      return id && (a.kind === "land" || a.kind === "condo") && a.smallResidential ? { ...a, smallResidential: { ...a.smallResidential, acquirerId: id } } : a;
    }),
  };
}
