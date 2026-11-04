/**
 * 小規模宅地等の特例：限度面積をどの人の分にどれだけ使うか（措置法69条の4第1項。付表1の同意欄で、取得した人全員の同意で選べる）。
 * 贈与税額控除のように、その人の算出税額までしか引けない控除があると、1人に330㎡を寄せるより何人かに分けた方が
 * 家族全体の相続税が少ないことがある。calculate は割り当て順を比べたあと、候補のあいだで面積を移して探す（種類が違う候補のあいだも）。
 * 期待値はテストごとのコメントの手計算。亡くなった日は 2026-03-15（令和7年の贈与は相続開始前3年以内なので加算する）。
 */
import { describe, expect, it } from "vitest";
import { calculate, type TaxResult } from "../tax/engine";
import type { Asset, Case, LandAsset, Person, PriorGift } from "../types";
import type { SmallResidentialCheck } from "../valuation/smallResidential";

const decedent = { name: "相続 太郎", birthDate: "1940-01-01", deathDate: "2026-03-15", address: "東京都千代田区" };
const c1: Person = { id: "c1", name: "長男", relation: "child", birthDate: "1966-01-01" };
const c2: Person = { id: "c2", name: "長女", relation: "child", birthDate: "1966-01-01" };
/** 自宅の敷地（事情なし）で、取得する人は同居していて住み続け・持ち続ける */
const HOME_LIVING: SmallResidentialCheck = { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" };
const LIVING: SmallResidentialCheck = { livedTogether: "yes", keep: "yes" };

const net = (r: TaxResult) => r.totalPayable - r.totalRefund;
/** 特例を使った面積（㎡）を、土地と人の組ごとに */
const selections = (r: TaxResult) =>
  r.assets.flatMap((l) => [l.small, ...(l.smallExtra ?? [])].flatMap((d) => (d ? [{ assetId: l.asset.id, acquirerId: d.acquirerId, area: d.selectedArea }] : [])));
/** 0.01㎡単位で足す（小数の誤差を避ける） */
const sumArea = (r: TaxResult) => selections(r).reduce((a, s) => a + Math.round(s.area * 100), 0) / 100;

/** 自宅の敷地。primary が1人目（土地についての答えもこの人）、other が2人目 */
const homeLot = (areaSqm: number, value: number, primary: string, other?: string, caps: { primary?: number; other?: number } = {}): LandAsset => ({
  id: "自宅",
  kind: "land",
  label: "自宅",
  location: "x",
  areaSqm,
  landUse: "宅地",
  method: { type: "manual", value },
  smallResidential: {
    applies: true,
    acquirerId: primary,
    check: HOME_LIVING,
    ...(caps.primary !== undefined ? { selectedSqm: caps.primary } : {}),
    ...(other ? { others: [{ acquirerId: other, check: LIVING, ...(caps.other !== undefined ? { selectedSqm: caps.other } : {}) }] } : {}),
  },
});
/** 長男だけが受け継ぐ 1㎡・100円の宅地（特例の候補を増やすため） */
const tiny = (k: number): LandAsset => ({
  id: `小${k}`,
  kind: "land",
  label: `小${k}`,
  location: "x",
  areaSqm: 1,
  landUse: "宅地",
  method: { type: "manual", value: 100 },
  smallResidential: { applies: true, acquirerId: "c1", check: HOME_LIVING },
});
const share = (assetId: string, ...s: [string, number, number][]) => ({ assetId, shares: s.map(([personId, numerator, denominator]) => ({ personId, numerator, denominator })) });
const mk = (persons: Person[], assets: Asset[], allocations: Case["allocations"], priorGifts: PriorGift[] = []): Case => ({
  id: "t",
  title: "t",
  decedent,
  persons,
  assets,
  allocations,
  debts: [],
  priorGifts,
});
/** 令和7年1月15日の暦年贈与 1,000万円（贈与税 177万円） */
const gift = (personId: string): PriorGift => ({ personId, date: "2025-01-15", amount: 10_000_000, giftTaxPaid: 1_770_000 });
const halves = share("自宅", ["c1", 1, 2], ["c2", 1, 2]);

describe("贈与税額控除を引ききれないときは、限度面積を2人に分ける（指摘1）", () => {
  // 自宅 660㎡ 9,000万円を長男・長女が1/2ずつ（③330㎡・④4,500万円ずつ）。2人とも贈与 1,000万円（贈与税177万円）を加算する。
  // 長男に330㎡：課税価格 長男 4,500万 − 3,600万 ＋ 1,000万 ＝ 1,900万、長女 5,500万、合計 7,400万 − 基礎控除 4,200万 ＝ 3,200万
  //   → 1,600万ずつ × 15% − 50万 ＝ 190万ずつ、総額 380万。長男 380万 × 1,900/7,400 ≒ 97.6万 < 177万 → 0円（残りは引けない）、
  //   長女 380万 × 5,500/7,400 − 177万 ≒ 105.4万 → 合計 1,054,300円（これまでの結果）
  // 165㎡ずつ：課税価格 3,700万ずつ → 算出税額 190万ずつ − 177万 ＝ 13万ずつ → 合計 260,000円。
  // 各人の課税価格の1,000円未満の切捨てで、分け方によってはさらに数百円下がる
  const r = calculate(mk([c1, c2], [homeLot(660, 90_000_000, "c1", "c2")], [halves], [gift("c1"), gift("c2")]));

  it("家族全体の相続税は 260,000円以下になり、限度面積330㎡を2人に分けて使う", () => {
    expect(r.blockers).toEqual([]);
    expect(r.totalPayable).toBeLessThanOrEqual(260_000);
    expect(sumArea(r)).toBe(330);
    const sel = selections(r);
    expect(sel.map((s) => s.acquirerId).sort()).toEqual(["c1", "c2"]);
    expect(sel.every((s) => s.area > 0 && s.area < 330)).toBe(true);
  });

  it("案内は「いちばん少ない」と言い切らず、計算で探した割り当てと、合意で選べることを伝える", () => {
    const w = r.warnings.find((x) => x.includes("330㎡まで"))!;
    expect(w).toContain("家族全体で納める相続税が少なくなる割り当てを計算で探し");
    expect(w).not.toContain("いちばん少なく");
    expect(w).not.toContain("は残り");
    expect(w).toMatch(/「自宅」（長男さんの分）に[\d.]+㎡、「自宅」（長女さんの分）に[\d.]+㎡を割り当てています/);
    expect(w).toContain("受け継ぐ人全員の合意で選べる");
    expect(w).toContain("税理士にご相談ください");
  });

  it("贈与がなければ、分けても変わるのは端数の切捨ての分だけで、これまでの 1,199,900円より高くならない", () => {
    // 長男に330㎡：課税価格 900万 ＋ 4,500万 ＝ 5,400万 − 4,200万 ＝ 1,200万 → 600万ずつ × 10% ＝ 総額120万 → 合計 1,199,900円
    // （各人の100円未満の切捨て）。分けると、2人の課税価格の1,000円未満の切捨てで合計が1,000円下がり（5,399.9万）、
    // 法定相続分の600万が599.9万になって総額が200円下がることがある（どちらも法令どおりの切捨てなので、低い方を選んでよい）
    const plain = calculate(mk([c1, c2], [homeLot(660, 90_000_000, "c1", "c2")], [halves]));
    expect(plain.blockers).toEqual([]);
    expect(plain.totalPayable).toBeLessThanOrEqual(1_199_900);
    expect(Math.abs(plain.totalPayable - 1_200_000)).toBeLessThanOrEqual(1_000);
    expect(sumArea(plain)).toBe(330);
  });
});

describe("特例の候補が8つ以上でも、入力した順で税額が変わらない（指摘2）", () => {
  // 自宅（上と同じ。長男・長女 1/2 ずつ）と、長男だけが受け継ぐ 1㎡・100円の宅地6つで、候補は8つ（すべての順は試さない）。
  // 贈与は長男だけ（1,000万円・贈与税177万円）。課税価格の合計はどちらに330㎡を使っても 6,400万＋600円 → 総額 230万。
  // 長男に330㎡：長男 1,900万 → 68.3万 < 177万 → 0円、長女 4,500万 → 161.7万 → 合計 1,617,100円
  // 長女に330㎡：長男 5,500万 → 197.7万 − 177万 ＝ 20.6万、長女 900万 → 32.3万 → 合計 529,900円
  const tinies = [1, 2, 3, 4, 5, 6].map(tiny);
  const allocations = [halves, ...tinies.map((t) => share(t.id, ["c1", 1, 1]))];
  const c1First = mk([c1, c2], [homeLot(660, 90_000_000, "c1", "c2"), ...tinies], allocations, [gift("c1")]);
  const c2First = mk([c1, c2], [homeLot(660, 90_000_000, "c2", "c1"), ...tinies], allocations, [gift("c1")]);
  const a = calculate(c1First);
  const b = calculate(c2First);

  it("どちらを1人目に入れても同じ税額で、529,900円以下", () => {
    expect(a.blockers).toEqual([]);
    expect(b.blockers).toEqual([]);
    expect(selections(a).length + selections(b).length).toBeGreaterThan(0);
    expect(a.totalPayable).toBe(b.totalPayable);
    expect(a.totalPayable).toBeLessThanOrEqual(529_900);
    expect(sumArea(a)).toBe(330);
    expect(sumArea(b)).toBe(330);
  });

  it("候補が8つあっても計算は0.2秒以内", () => {
    calculate(c1First); // 1回目は準備の時間を含むので測らない
    const t0 = performance.now();
    calculate(c1First);
    calculate(c2First);
    expect((performance.now() - t0) / 2).toBeLessThan(200);
  });
});

/* ---------- 2人で1つの自宅を受け継ぐ、決まった乱数の30件 ---------- */

/** 決まった種から同じ並びを出す乱数（mulberry32） */
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RandomCase {
  name: string;
  persons: Person[];
  areaSqm: number;
  value: number;
  /** 長男・長女の持分 */
  n1: number;
  n2: number;
  d: number;
  deposit: { amount: number; to: "c1" | "c2" | "both" };
  gifts: PriorGift[];
}

function randomCases(count: number): RandomCase[] {
  const r = rng(20261104);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const person = (id: "c1" | "c2", name: string): Person => {
    const kind = pick(["adult", "adult", "minor", "disabled"] as const);
    // 未成年者控除：(18 − 年齢) × 10万円、障害者控除：(85 − 年齢) × 10万円（引ききれない分は扶養義務者から引く）
    if (kind === "minor") return { id, name, relation: "child", birthDate: `20${int(10, 15)}-06-01` };
    if (kind === "disabled") return { id, name, relation: "child", birthDate: `19${int(60, 99)}-06-01`, disability: "general" };
    return { id, name, relation: "child", birthDate: "1966-01-01" };
  };
  return Array.from({ length: count }, (_, k) => {
    const [n1, d] = pick([
      [1, 2],
      [1, 3],
      [2, 3],
      [1, 4],
      [3, 4],
      [2, 5],
    ]);
    // 面積は持分の分母の倍数（持分の面積が整数の㎡になる）。合計が330㎡を超えるので、限度面積の割り当てを選ぶ
    const areaSqm = d * int(Math.ceil(360 / d), Math.ceil(900 / d));
    const x: RandomCase = {
      name: `${k + 1}件目`,
      persons: [person("c1", "長男"), person("c2", "長女")],
      areaSqm,
      value: int(20, 200) * 1_000_000,
      n1,
      n2: d - n1,
      d,
      deposit: { amount: int(0, 100) * 1_000_000, to: pick(["c1", "c2", "both"] as const) },
      gifts: [],
    };
    const gift = (personId: string, amount: number, giftTaxPaid: number): PriorGift => ({ personId, date: `2025-0${int(1, 9)}-15`, amount, giftTaxPaid });
    if (k % 2 === 0) {
      // 半分の件は指摘1の形：2人とも贈与を受け、贈与税額を「長男に寄せたとき」と「長女に寄せたとき」のその人の算出税額のあいだにする
      // （どちらか1人に寄せると、もう1人が贈与税額控除を引ききれない）。贈与税額は控除の上限を試すための値で、贈与額から計算した額ではない
      x.gifts = [gift("c1", int(5, 30) * 1_000_000, 0), gift("c2", int(5, 30) * 1_000_000, 0)];
      const a1 = (areaSqm * n1) / d;
      const a2 = (areaSqm * x.n2) / d;
      const ends = [Math.min(330, a1), 330 - Math.min(330, a2)].map((s1) => calculate(randomCase(x, { c1: s1, c2: 330 - s1 })));
      x.gifts = x.gifts.map((g) => {
        const [lo, hi] = ends.map((e) => e.persons.find((p) => p.person.id === g.personId)!.computed).sort((p, q) => p - q);
        return { ...g, giftTaxPaid: Math.floor((lo + ((hi - lo) * int(20, 80)) / 100) / 100) * 100 };
      });
    } else {
      // 残りは、贈与がない・1人だけ・2人とも、贈与税は贈与額の0〜35%
      for (const id of ["c1", "c2"]) if (r() < 0.6) {
        const amount = int(2, 30) * 1_000_000;
        x.gifts.push(gift(id, amount, Math.floor((amount * int(0, 35)) / 100 / 100) * 100));
      }
    }
    return x;
  });
}

/** 乱数の件を相続の入力にする。caps を渡すと、長男・長女が特例を使う面積（㎡）をその値にする（0なら使わない） */
function randomCase(x: RandomCase, caps?: { c1: number; c2: number }): Case {
  const users = caps ? (["c1", "c2"] as const).filter((id) => caps[id] > 0) : (["c1", "c2"] as const);
  const lot = homeLot(x.areaSqm, x.value, users[0], users[1], caps ? { primary: caps[users[0]], other: users[1] ? caps[users[1]] : undefined } : {});
  const deposit: Asset = { id: "預金", kind: "deposit", label: "預金", amount: x.deposit.amount };
  const depShares: [string, number, number][] = x.deposit.to === "both" ? [["c1", 1, 2], ["c2", 1, 2]] : [[x.deposit.to, 1, 1]];
  return mk(x.persons, x.deposit.amount > 0 ? [lot, deposit] : [lot], [share("自宅", ["c1", x.n1, x.d], ["c2", x.n2, x.d]), ...(x.deposit.amount > 0 ? [share("預金", ...depShares)] : [])], x.gifts);
}

describe("2人で1つの自宅を受け継ぐ30件：1㎡刻みで全部の分け方を試した最小値と比べる", () => {
  const cases = randomCases(30);

  it.each(cases)("$name：1㎡刻みの最小値＋1,000円以下で、割り当て順だけで選んだこれまでの結果より高くない", (x) => {
    const r = calculate(randomCase(x));
    expect(r.blockers).toEqual([]);
    expect(sumArea(r)).toBe(330);
    const a1 = (x.areaSqm * x.n1) / x.d;
    const a2 = (x.areaSqm * x.n2) / x.d;
    // 長男に s1㎡・長女に 330 − s1 ㎡を選んだときの、家族全体の相続税（面積の合計がちょうど330㎡なので、そのとおりに使う）
    const at = (s1: number) => {
      const forced = calculate(randomCase(x, { c1: s1, c2: 330 - s1 }));
      expect(forced.blockers).toEqual([]);
      expect(sumArea(forced)).toBe(330);
      return net(forced);
    };
    let brute = Infinity;
    for (let s1 = Math.max(0, 330 - a2); s1 <= Math.min(330, a1); s1++) brute = Math.min(brute, at(s1));
    // これまで（割り当て順だけ）：長男を先に使えるだけ、または長女を先に使えるだけ、の少ない方
    const old = Math.min(at(Math.min(330, a1)), at(330 - Math.min(330, a2)));
    expect(net(r)).toBeLessThanOrEqual(old);
    expect(net(r)).toBeLessThanOrEqual(brute + 1_000);
  });

  it("30件には、分けた方が1万円以上少なくなる件（指摘1の形）が含まれている", () => {
    const gains = cases.map((x) => {
      const a1 = (x.areaSqm * x.n1) / x.d;
      const a2 = (x.areaSqm * x.n2) / x.d;
      const old = Math.min(...[Math.min(330, a1), 330 - Math.min(330, a2)].map((s1) => net(calculate(randomCase(x, { c1: s1, c2: 330 - s1 })))));
      return old - net(calculate(randomCase(x)));
    });
    expect(gains.filter((g) => g >= 10_000).length).toBeGreaterThanOrEqual(5);
  });
});

/* ---------- 入力した順によらない（家族・財産・分け方の行・一緒に使う人の順） ---------- */

const RENT_CHECK: SmallResidentialCheck = { continues: "yes", keep: "yes", recent: "no" };
const BUSINESS_CHECK: SmallResidentialCheck = { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" };

/**
 * 入力の順を変えた相続。k ごとに、家族・財産・分け方の財産の順・分け方の行・特例を使う人（1人目を含む）・贈与の順を回す。
 * 奇数の k は、回したあとで逆の順にもする
 */
function reorder(c: Case, k: number): Case {
  const turn = <T,>(xs: T[], by: number): T[] => {
    const out = xs.map((_, i) => xs[(i + by) % xs.length]);
    return k % 2 ? out.reverse() : out;
  };
  const assets = turn(c.assets, k).map((a) => {
    if ((a.kind !== "land" && a.kind !== "condo") || !a.smallResidential?.acquirerId) return a;
    const sr = a.smallResidential;
    const users = turn([{ acquirerId: sr.acquirerId!, check: sr.check, selectedSqm: sr.selectedSqm }, ...(sr.others ?? [])], k + 1);
    const [first, ...rest] = users;
    return {
      ...a,
      smallResidential: {
        applies: sr.applies,
        acquirerId: first.acquirerId,
        check: first.check,
        ...(first.selectedSqm !== undefined ? { selectedSqm: first.selectedSqm } : {}),
        ...(rest.length ? { others: rest } : {}),
      },
    };
  });
  return {
    ...c,
    persons: turn(c.persons, k),
    assets,
    allocations: turn(c.allocations, k + 2).map((al) => ({ ...al, shares: turn(al.shares, k + 1) })),
    priorGifts: turn(c.priorGifts, k),
  };
}
const ORDERS = [0, 1, 2, 3, 4, 5, 6, 7];

/** 貸家の敷地（貸家建付地。借地権割合0.6）を、users の人が持分 shares で受け継ぎ、全員が貸付事業用で特例を使う */
const rentLot = (id: string, areaSqm: number, value: number, users: string[]): LandAsset => ({
  id,
  kind: "land",
  label: `土地${id}`,
  location: "東京都千代田区",
  areaSqm,
  landUse: "宅地",
  method: { type: "manual", value },
  use: "rentedHouse",
  leaseRatio: 0.6,
  smallResidential: { applies: true, acquirerId: users[0], check: RENT_CHECK, others: users.slice(1).map((acquirerId) => ({ acquirerId, check: RENT_CHECK })) },
});

describe("候補が8つの貸付事業用（検証で入力した順により142,196,600円と145,631,900円に分かれた件）", () => {
  // 配偶者・子3人（1人は特別障害者）・孫養子（2割加算・未成年）。貸家の敷地3つを2〜3人の共有で受け継ぎ、全員が特例を使う（候補8つ）。
  // 全員が令和7年に贈与を受けていて（贈与税額控除）、亡くなった方は2年前の相続で相続税を納めている（相次相続控除）。
  // 土地2（3分の1ずつ）の価額 300,452,000円×0.82 は3で割り切れず、端数の2円は分け方の1行目の人に寄る
  const persons: Person[] = [
    { id: "sp", name: "配偶者", relation: "spouse", birthDate: "1945-01-01" },
    { id: "ch0", name: "子0", relation: "child", birthDate: "1970-05-01" },
    { id: "ch1", name: "子1", relation: "child", birthDate: "1982-06-01", disability: "special" },
    { id: "ch2", name: "子2", relation: "child", birthDate: "1970-05-01" },
    { id: "gc", name: "孫", relation: "adoptedChild", grandchildAdopted: true, birthDate: "2012-03-01" },
  ];
  const c: Case = {
    ...mk(
      persons,
      [
        rentLot("lot0", 138, 149_683_000, ["ch2", "sp"]),
        rentLot("lot1", 218, 219_111_000, ["ch0", "sp", "gc"]),
        rentLot("lot2", 584, 300_452_000, ["ch1", "gc", "ch0"]),
        { id: "dep0", kind: "deposit", label: "預金0", amount: 80_000_000 },
        { id: "dep1", kind: "deposit", label: "預金1", amount: 93_000_000 },
        { id: "dep2", kind: "deposit", label: "預金2", amount: 55_000_000 },
      ],
      [
        share("lot0", ["ch2", 1, 2], ["sp", 1, 2]),
        share("lot1", ["ch0", 1, 3], ["sp", 1, 3], ["gc", 1, 3]),
        share("lot2", ["ch1", 1, 3], ["gc", 1, 3], ["ch0", 1, 3]),
        share("dep0", ["ch1", 1, 1]),
        share("dep1", ["ch0", 1, 1]),
        share("dep2", ["sp", 1, 1]),
      ],
      [
        { personId: "sp", date: "2025-04-15", amount: 25_000_000, giftTaxPaid: 250_000 },
        { personId: "ch0", date: "2025-09-15", amount: 22_000_000, giftTaxPaid: 7_480_000 },
        { personId: "ch1", date: "2025-01-15", amount: 18_000_000, giftTaxPaid: 1_080_000 },
        { personId: "ch2", date: "2025-08-15", amount: 28_000_000, giftTaxPaid: 5_880_000 },
        { personId: "gc", date: "2025-05-15", amount: 22_000_000, giftTaxPaid: 8_580_000 },
      ],
    ),
    decedent: { ...decedent, priorInheritanceTax: true, priorInheritance: { date: "2024-04-01", prevTax: 8_000_000, prevAcquired: 96_000_000 } },
  };
  const results = ORDERS.map((k) => calculate(reorder(c, k)));

  it("どの順で入れても家族全体の相続税は同じで、142,196,600円以下（これまでは151,424,200円）", () => {
    for (const r of results) {
      expect(r.blockers).toEqual([]);
      expect(net(r)).toBe(net(results[0]));
      expect(r.totalPayable).toBe(results[0].totalPayable);
    }
    expect(net(results[0])).toBeLessThanOrEqual(142_196_600);
    // 限度面積200㎡（貸付事業用だけ）を使い切る
    expect(sumArea(results[0])).toBe(200);
  });

  it("土地2の分け方の行の順・一緒に使う人の順だけを変えても同じ", () => {
    const rows = calculate({ ...c, allocations: c.allocations.map((a) => (a.assetId === "lot2" ? { ...a, shares: [a.shares[2], a.shares[0], a.shares[1]] } : a)) });
    const lot2 = c.assets.find((a) => a.id === "lot2") as LandAsset;
    const others = calculate({
      ...c,
      assets: c.assets.map((a) => (a.id === "lot2" ? { ...lot2, smallResidential: { ...lot2.smallResidential!, others: [...lot2.smallResidential!.others!].reverse() } } : a)),
    });
    expect(net(rows)).toBe(net(results[0]));
    expect(net(others)).toBe(net(results[0]));
  });
});

describe("特定居住用と貸付事業用の候補が7つ（検証で分け方の行の順により20,523,500円と20,383,800円に分かれた件）", () => {
  // 配偶者・子3人（1人は特別障害者、1人は未成年）。自宅2つ（1つは3人の共有）と、3人の共有の貸家の敷地（子1は20.5㎡まで）
  const persons: Person[] = [
    { id: "sp", name: "配偶者", relation: "spouse", birthDate: "1945-01-01" },
    { id: "ch0", name: "子0", relation: "child", birthDate: "1970-05-01" },
    { id: "ch1", name: "子1", relation: "child", birthDate: "1982-06-01", disability: "special" },
    { id: "ch2", name: "子2", relation: "child", birthDate: "2010-06-01" },
  ];
  const home = (id: string, areaSqm: number, value: number, users: string[]): LandAsset => ({
    ...homeLot(areaSqm, value, users[0]),
    id,
    label: `土地${id}`,
    smallResidential: { applies: true, acquirerId: users[0], check: HOME_LIVING, ...(users.length > 1 ? { others: users.slice(1).map((acquirerId) => ({ acquirerId, check: HOME_LIVING })) } : {}) },
  });
  const lot1 = rentLot("lot1", 333, 271_655_000, ["sp", "ch0", "ch1"]);
  lot1.smallResidential!.others![1].selectedSqm = 20.5;
  const c = mk(
    persons,
    [home("lot0", 473, 115_514_000, ["sp"]), lot1, home("lot2", 485, 76_574_000, ["ch1", "sp", "ch2"])],
    [share("lot0", ["sp", 5, 5]), share("lot1", ["sp", 2, 6], ["ch0", 1, 6], ["ch1", 3, 6]), share("lot2", ["ch1", 1, 5], ["sp", 2, 5], ["ch2", 2, 5])],
    [
      { personId: "sp", date: "2025-07-15", amount: 5_000_000, giftTaxPaid: 1_900_000 },
      { personId: "ch0", date: "2025-06-15", amount: 18_000_000, giftTaxPaid: 6_300_000 },
      { personId: "ch1", date: "2025-02-15", amount: 6_000_000, giftTaxPaid: 1_380_000 },
    ],
  );
  const results = ORDERS.map((k) => calculate(reorder(c, k)));

  it("どの順で入れても家族全体の相続税は同じで、20,383,800円以下（これまでは20,532,800円）", () => {
    for (const r of results) {
      expect(r.blockers).toEqual([]);
      expect(net(r)).toBe(net(results[0]));
      expect(r.totalPayable).toBe(results[0].totalPayable);
    }
    expect(net(results[0])).toBeLessThanOrEqual(20_383_800);
  });

  it("貸家の敷地の分け方の行を 子1・配偶者・子0 の順にしても同じ", () => {
    const r = calculate({ ...c, allocations: c.allocations.map((a) => (a.assetId === "lot1" ? { ...a, shares: [a.shares[2], a.shares[0], a.shares[1]] } : a)) });
    expect(net(r)).toBe(net(results[0]));
  });
});

/* ---------- 候補が7〜12個の、決まった乱数の100件：入力した順を変えても同じ ---------- */

/**
 * 乱数の相続。土地の価額は持分の分母（1〜6）で割り切れる額にする（貸家の敷地も 0.82 倍して割り切れる）。
 * 割り切れないと、端数の1円を分け方の1行目の人に寄せるので、行の順で人ごとの価額が1円変わり、
 * 課税価格の1,000円未満の切捨てで税額が数百円変わることがある（法令どおりの端数で、探し方の違いではない）
 */
function evenCase(seed: number): Case {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const persons: Person[] = [];
  if (r() < 0.7) persons.push({ id: "sp", name: "配偶者", relation: "spouse", birthDate: "1945-01-01" });
  const n = int(2, 3);
  for (let k = 0; k < n; k++) {
    const kind = pick(["adult", "adult", "minor", "disabled"] as const);
    persons.push({
      id: `ch${k}`,
      name: `子${k}`,
      relation: "child",
      birthDate: kind === "minor" ? `20${int(10, 15)}-04-01` : `19${int(60, 85)}-0${int(1, 9)}-01`,
      ...(kind === "disabled" ? { disability: pick(["general", "special"] as const) } : {}),
    });
  }
  if (r() < 0.3) persons.push({ id: "gc", name: "孫", relation: "adoptedChild", grandchildAdopted: true, birthDate: "2008-03-01" });
  const ids = persons.map((p) => p.id);
  const assets: Asset[] = [];
  const allocations: Case["allocations"] = [];
  for (let l = 0; l < int(3, 5); l++) {
    const kind = pick(["residence", "residence", "business", "rental"] as const);
    const pool = [...ids];
    const users = Array.from({ length: Math.min(ids.length, int(1, 3)) }, () => pool.splice(Math.floor(r() * pool.length), 1)[0]);
    const d = Math.max(users.length, pick([1, 2, 3, 4, 5, 6]));
    const nums = users.map(() => 1);
    for (let rest = d - users.length; rest > 0; rest--) nums[Math.floor(r() * nums.length)]++;
    const check = kind === "residence" ? HOME_LIVING : kind === "business" ? BUSINESS_CHECK : RENT_CHECK;
    const cap = () => (r() < 0.15 ? { selectedSqm: int(10, 250) } : {});
    assets.push({
      id: `lot${l}`,
      kind: "land",
      label: `土地${l}`,
      location: "東京都千代田区",
      areaSqm: int(40, 600),
      landUse: "宅地",
      method: { type: "manual", value: int(5, 60) * 6_000_000 },
      ...(kind === "rental" ? { use: "rentedHouse" as const, leaseRatio: 0.6 } : {}),
      smallResidential: { applies: true, acquirerId: users[0], check, ...cap(), others: users.slice(1).map((acquirerId) => ({ acquirerId, check, ...cap() })) },
    });
    allocations.push(share(`lot${l}`, ...users.map((id, k): [string, number, number] => [id, nums[k], d])));
  }
  // 人ごとに違う額の預金（課税価格がちょうど同じ人ができにくいように）
  ids.forEach((id, k) => {
    assets.push({ id: `dep${k}`, kind: "deposit", label: `預金${k}`, amount: int(0, 120) * 1_000_000 + (k + 1) * 7_000 });
    allocations.push(share(`dep${k}`, [id, 1, 1]));
  });
  const gifts: PriorGift[] = ids.flatMap((id) => {
    if (r() > 0.5) return [];
    const amount = int(1, 40) * 1_000_000;
    return [{ personId: id, date: `2025-0${int(1, 9)}-15`, amount, giftTaxPaid: Math.floor((amount * int(0, 45)) / 100 / 100) * 100 }];
  });
  const c = mk(persons, assets, allocations, gifts);
  return r() < 0.2 ? { ...c, decedent: { ...decedent, priorInheritanceTax: true, priorInheritance: { date: "2021-04-01", prevTax: int(1, 30) * 1_000_000, prevAcquired: int(60, 300) * 1_000_000 } } } : c;
}
/** 特例の候補（土地と人の組）の数 */
const slotCount = (c: Case) => c.assets.reduce((a, x) => a + (x.kind === "land" && x.smallResidential ? 1 + (x.smallResidential.others?.length ?? 0) : 0), 0);

describe("候補が7〜12個の100件：家族・財産・分け方の行・一緒に使う人の順を変えても、家族全体の相続税は1円も変わらない", () => {
  const cases: Case[] = [];
  for (let seed = 1; cases.length < 100; seed++) {
    const c = evenCase(seed * 7 + 20261104);
    if (slotCount(c) >= 7 && slotCount(c) <= 12) cases.push({ ...c, id: `${cases.length + 1}件目` });
  }

  it("100件のほとんどで限度面積を超えていて、割り当てを探している", () => {
    const searched = cases.filter((c) => calculate(c).warnings.some((w) => w.includes("を割り当てています")));
    expect(searched.length).toBeGreaterThanOrEqual(95);
  });

  it.each(cases)("$id", (c) => {
    const base = calculate(c);
    expect(base.blockers).toEqual([]);
    for (const k of [1, 2]) {
      const r = calculate(reorder(c, k));
      expect(net(r)).toBe(net(base));
      expect(r.totalPayable).toBe(base.totalPayable);
      expect(r.persons.map((p) => `${p.person.id}:${p.payable}`).sort()).toEqual(base.persons.map((p) => `${p.person.id}:${p.payable}`).sort());
    }
  });
});

describe("候補が12個で、ほかの財産が150件あっても計算は1秒以内（探す回数は候補の数で決まり、時間では決めない）", () => {
  it("1秒以内（手元では80ミリ秒ほど）", () => {
    let c: Case | undefined;
    for (let seed = 1; !c; seed++) {
      const x = evenCase(seed * 13 + 99);
      if (slotCount(x) === 12) c = x;
    }
    const big: Case = {
      ...c,
      assets: [...c.assets, ...Array.from({ length: 150 }, (_, k): Asset => ({ id: `x${k}`, kind: "deposit", label: `預金x${k}`, amount: 1_000_000 + k }))],
      allocations: [...c.allocations, ...Array.from({ length: 150 }, (_, k) => share(`x${k}`, [c.persons[k % c.persons.length].id, 1, 1]))],
    };
    calculate(big); // 1回目は準備の時間を含むので測らない
    const t0 = performance.now();
    const r = calculate(big);
    expect(performance.now() - t0).toBeLessThan(1_000);
    expect(r.blockers).toEqual([]);
  });
});

/* ---------- 生計を一にしていた家族が住んでいた土地があるときの、限度面積の案内 ---------- */

describe("同じ家計の家族が住んでいた土地（特定居住用）を選ぶときの限度面積の案内", () => {
  /** 亡くなった方と生計を一にしていた長男が無料で住んでいた土地（自宅でも事業用でもない）。長男が受け継いで住み続ける */
  const familyLot = (areaSqm: number): LandAsset => ({
    ...homeLot(areaSqm, 60_000_000, "c1"),
    id: "家族の家",
    label: "家族の家",
    smallResidential: { applies: true, acquirerId: "c1", check: { ownHome: "no", business: "no", familyHome: "yes", keep: "yes", confirmedByAdvisor: true } },
  });
  const shop: LandAsset = {
    ...homeLot(450, 90_000_000, "c2"),
    id: "店",
    label: "店",
    smallResidential: { applies: true, acquirerId: "c2", check: BUSINESS_CHECK },
  };
  const flat = rentLot("貸家", 300, 60_000_000, ["c2"]);
  const run = (assets: LandAsset[]) =>
    calculate(
      mk(
        [c1, c2],
        assets,
        assets.map((a) => share(a.id, [a.smallResidential!.acquirerId!, 1, 1])),
      ),
    );

  it("事業用と一緒のとき：「自宅や、同じ家計の家族が住んでいた土地は合計330㎡まで」", () => {
    const r = run([familyLot(400), shop]);
    expect(r.blockers).toEqual([]);
    const w = r.warnings.find((x) => x.includes("330㎡まで"))!;
    expect(w).toContain("小規模宅地等の特例は、自宅や、同じ家計の家族が住んでいた土地は合計330㎡まで、亡くなった方が事業に使っていた土地は合計400㎡までです。");
    expect(w).not.toContain("自宅の敷地");
    expect(w).toMatch(/「家族の家」に[\d.]+㎡/);
  });

  it("貸付事業用と一緒のとき：「自宅や、同じ家計の家族が住んでいた土地は330㎡を200㎡」", () => {
    const r = run([familyLot(400), flat]);
    expect(r.blockers).toEqual([]);
    const w = r.warnings.find((x) => x.includes("200㎡まで"))!;
    expect(w).toContain("人に貸していた土地も選ぶときは、自宅や、同じ家計の家族が住んでいた土地は330㎡を200㎡、事業に使っていた土地は400㎡を200㎡として数え");
    expect(w).not.toContain("自宅の敷地");
  });

  it("自宅の敷地だけなら、これまでどおり「自宅の敷地」", () => {
    const own: LandAsset = { ...homeLot(400, 60_000_000, "c1"), id: "自宅", label: "自宅" };
    const r = run([own, shop]);
    const w = r.warnings.find((x) => x.includes("330㎡まで"))!;
    expect(w).toContain("小規模宅地等の特例は、自宅の敷地は合計330㎡まで、亡くなった方が事業に使っていた土地は合計400㎡までです。");
    expect(w).not.toContain("同じ家計");
  });
});

/* ---------- 種類の違う候補の組合せ・候補が多いとき・入力の順と人のID（2回目の検証の指摘） ---------- */

const spouse: Person = { id: "sp", name: "妻", relation: "spouse", birthDate: "1945-01-01" };
/** 貸家の敷地（貸家建付地。借地権割合0.6）を1人で受け継ぎ、貸付事業用で特例を使う */
const aptLot = (id: string, areaSqm: number, value: number, acquirerId: string, selectedSqm?: number): LandAsset => ({
  ...rentLot(id, areaSqm, value, [acquirerId]),
  smallResidential: { applies: true, acquirerId, check: RENT_CHECK, ...(selectedSqm !== undefined ? { selectedSqm } : {}) },
});
/** 自宅の敷地を1人で受け継ぎ、特定居住用で特例を使う */
const ownHome = (id: string, areaSqm: number, value: number, acquirerId: string, selectedSqm?: number): LandAsset => ({
  ...homeLot(areaSqm, value, acquirerId, undefined, selectedSqm !== undefined ? { primary: selectedSqm } : {}),
  id,
  label: id,
});
/** 妻が自宅（330㎡）、長男がアパートの敷地（200㎡）を受け継ぐ。caps は特例を使う面積（入れなければ使えるだけ） */
const homeAndApt = (homeV: number, aptV: number, caps: { home?: number; apt?: number } = {}): Case =>
  mk(
    [spouse, c1],
    [ownHome("自宅", 330, homeV, "sp", caps.home), aptLot("アパート", 200, aptV, "c1", caps.apt)],
    [share("自宅", ["sp", 1, 1]), share("アパート", ["c1", 1, 1])],
  );
/** 種類ごとの選択面積（0.01㎡単位） */
const usedBy = (r: TaxResult) => {
  const kindOf = (l: TaxResult["assets"][number]) => [l.small, ...(l.smallExtra ?? [])].filter((d) => !!d).map((d) => ({ kind: d!.kind, area100: Math.round(d!.selectedArea * 100) }));
  const u = { residence: 0, business: 0, rental: 0 };
  for (const l of r.assets) for (const d of kindOf(l)) u[d.kind] += d.area100;
  return u;
};
/** 限度面積（措置法69条の4第2項）の内か */
const withinLimit = (r: TaxResult) => {
  const u = usedBy(r);
  return u.rental > 0 ? 40 * u.residence + 33 * u.business + 66 * u.rental <= 1_320_000 : u.residence <= 33_000 && u.business <= 40_000;
};

describe("自宅とアパートの候補が2つ（種類が違う）：自宅の一部とアパートの大部分を組み合わせた割り当ても探す", () => {
  // 妻が自宅 330㎡ 2億円、長男がアパートの敷地 200㎡ 2億円（貸家建付地）。アパート200㎡だけ（これまで）は 26,822,600円。
  // 自宅 82.5㎡ ＋ アパート 150㎡（82.5×200/330 ＋ 150 ＝ 200㎡）を選ぶと 21,163,800円
  it("家族全体の相続税は 21,163,800円以下で、自宅とアパートの両方に使い、限度面積の内", () => {
    const r = calculate(homeAndApt(200_000_000, 200_000_000));
    expect(r.blockers).toEqual([]);
    expect(net(r)).toBeLessThanOrEqual(21_163_800);
    expect(net(calculate(homeAndApt(200_000_000, 200_000_000, { home: 82.5, apt: 150 })))).toBe(21_163_800);
    const u = usedBy(r);
    expect(u.residence).toBeGreaterThan(0);
    expect(u.rental).toBeGreaterThan(0);
    expect(withinLimit(r)).toBe(true);
  });

  // 価額の組合せ12通り。アパートを y㎡（1㎡刻み）、自宅を限度面積の残りで使えるだけ（0.01㎡未満切捨て）にした最小値と比べる
  const combos = [100, 200, 300].flatMap((h) => [50, 100, 200, 400].map((a) => [h * 1_000_000, a * 1_000_000] as const));
  it.each(combos)("自宅 %i円・アパート %i円：1㎡刻みの最小値＋1,000円以下", (homeV, aptV) => {
    const r = calculate(homeAndApt(homeV, aptV));
    expect(r.blockers).toEqual([]);
    expect(withinLimit(r)).toBe(true);
    let brute = Infinity;
    for (let y = 0; y <= 200; y++) {
      const home100 = Math.min(33_000, Math.floor((1_320_000 - 66 * y * 100) / 40));
      const forced =
        y === 0
          ? mk([spouse, c1], [ownHome("自宅", 330, homeV, "sp"), { ...aptLot("アパート", 200, aptV, "c1"), smallResidential: undefined }], [share("自宅", ["sp", 1, 1]), share("アパート", ["c1", 1, 1])])
          : home100 <= 0
            ? mk([spouse, c1], [{ ...ownHome("自宅", 330, homeV, "sp"), smallResidential: undefined }, aptLot("アパート", 200, aptV, "c1", y)], [share("自宅", ["sp", 1, 1]), share("アパート", ["c1", 1, 1])])
            : homeAndApt(homeV, aptV, { home: home100 / 100, apt: y });
      const f = calculate(forced);
      expect(f.blockers).toEqual([]);
      brute = Math.min(brute, net(f));
    }
    expect(net(r)).toBeLessThanOrEqual(brute + 1_000);
  });
});

describe("配偶者と兄の候補が3つ（検証の件：配偶者の自宅だけを選ぶと 37,695,000円）", () => {
  const caseH: Case = {
    id: "c200148",
    title: "t",
    decedent: { name: "被相続人", birthDate: "1940-01-01", deathDate: "2026-03-15", address: "x" },
    persons: [
      { id: "sp", name: "配偶者", relation: "spouse", birthDate: "1946-02-03" },
      { id: "sb0", name: "兄0", relation: "sibling", birthDate: "1950-01-01" },
    ],
    assets: [
      { id: "lot0", kind: "land", label: "土地0", location: "x", areaSqm: 297, landUse: "宅地", method: { type: "manual", value: 254_290_654 }, use: "rentedHouse", leaseRatio: 0.6, smallResidential: { applies: true, acquirerId: "sp", check: { continues: "yes", keep: "yes", recent: "no" }, others: [{ acquirerId: "sb0", check: { continues: "yes", keep: "yes", recent: "no" } }] } },
      { id: "lot1", kind: "land", label: "土地1", location: "x", areaSqm: 373.5, landUse: "宅地", method: { type: "manual", value: 328_710_721 }, smallResidential: { applies: true, acquirerId: "sp", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } } },
      { id: "dep0", kind: "deposit", label: "預金0", amount: 56_000_099 },
    ],
    allocations: [
      { assetId: "lot0", shares: [{ personId: "sp", numerator: 4, denominator: 7 }, { personId: "sb0", numerator: 3, denominator: 7 }] },
      { assetId: "lot1", shares: [{ personId: "sp", numerator: 7, denominator: 7 }] },
      { assetId: "dep0", shares: [{ personId: "sb0", numerator: 1, denominator: 2 }, { personId: "sp", numerator: 1, denominator: 2 }] },
    ],
    debts: [
      { id: "d0", kind: "debt", label: "借入", amount: 6_000_746, bearers: [{ personId: "sb0", amount: 3_000_373 }, { personId: "sp", amount: 3_000_373 }] },
      { id: "f0", kind: "funeral", label: "葬式", amount: 1_500_000, bearers: [{ personId: "sp", amount: 1_500_000 }] },
    ],
    priorGifts: [
      { personId: "sp", date: "2025-03-15", amount: 19_000_000, giftTaxPaid: 1_520_000 },
    ],
  };

  it("兄のアパートの持分と配偶者の自宅を組み合わせて、33,675,000円以下（兄 48㎡・配偶者 250.8㎡を選んだときの額）", () => {
    const r = calculate(caseH);
    expect(r.blockers).toEqual([]);
    expect(net(r)).toBeLessThanOrEqual(33_675_000);
    expect(withinLimit(r)).toBe(true);
  });
});

/** 妻・長男・長女が自宅（330㎡）・店（400㎡）・アパートの敷地（200㎡）を owners の人で等分して受け継ぐ。claimApt が false ならアパートには特例を使わない */
const familyLots = (owners: string[][], claimApt = true): Case => {
  const lot = (id: string, areaSqm: number, value: number, check: SmallResidentialCheck, own: string[], extra: Partial<LandAsset> = {}): LandAsset => ({
    id,
    kind: "land",
    label: id,
    location: "x",
    areaSqm,
    landUse: "宅地",
    method: { type: "manual", value },
    ...extra,
    smallResidential: { applies: true, acquirerId: own[0], check, ...(own.length > 1 ? { others: own.slice(1).map((acquirerId) => ({ acquirerId, check })) } : {}) },
  });
  const assets: LandAsset[] = [
    lot("自宅", 330, 150_000_000, HOME_LIVING, owners[0]),
    lot("店", 400, 200_000_000, BUSINESS_CHECK, owners[1]),
    lot("アパート", 200, 400_000_000, RENT_CHECK, owners[2], { use: "rentedHouse", leaseRatio: 0.6 }),
  ];
  if (!claimApt) delete assets[2].smallResidential;
  return mk(
    [spouse, c1, c2],
    assets,
    assets.map((a, k) => share(a.id, ...owners[k].map((p): [string, number, number] => [p, 1, owners[k].length]))),
  );
};
const ALL3 = ["sp", "c1", "c2"];

describe("候補が8つ以上でも、貸付事業用を使わない割り当て（特定居住用330㎡と特定事業用400㎡を別々に使う）も比べる", () => {
  it("3人で3つの土地を等分（候補9つ）：アパートに使わないときの額（60,999,200円）以下", () => {
    const r = calculate(familyLots([ALL3, ALL3, ALL3]));
    const noApt = calculate(familyLots([ALL3, ALL3, ALL3], false));
    expect(net(noApt)).toBe(60_999_200);
    expect(net(r)).toBeLessThanOrEqual(net(noApt));
    expect(withinLimit(r)).toBe(true);
  });

  it("同じ家計の家族が住んでいた土地を候補に足して8つになっても、その土地に特例を使わないときより高くならない", () => {
    // 自宅は3人、店とアパートは妻と長男（候補7つ）。長女が住んでいた 60㎡・2,000万円の土地（生計を一にしていた親族の居住用）を足すと候補8つ
    const seven = familyLots([ALL3, ["sp", "c1"], ["sp", "c1"]]);
    const flat: LandAsset = {
      id: "長女の家",
      kind: "land",
      label: "長女の家",
      location: "x",
      areaSqm: 60,
      landUse: "宅地",
      method: { type: "manual", value: 20_000_000 },
      smallResidential: { applies: true, acquirerId: "c2", check: { ownHome: "no", business: "no", familyHome: "yes", keep: "yes", confirmedByAdvisor: true } },
    };
    const eight = { ...seven, assets: [...seven.assets, flat], allocations: [...seven.allocations, share("長女の家", ["c2", 1, 1])] };
    const notClaimed = { ...eight, assets: [...seven.assets, { ...flat, smallResidential: undefined }] };
    const r = calculate(eight);
    expect(r.blockers).toEqual([]);
    // これまでの計算（この土地を候補にしない）は 52,784,600円（自宅330㎡・店400㎡）
    expect(net(calculate(notClaimed))).toBeLessThanOrEqual(52_784_600);
    expect(net(r)).toBeLessThanOrEqual(net(calculate(notClaimed)));
  });
});

describe("1つの土地の持分で分けた1円未満の端数：分け方の行の順によらない", () => {
  const caseD: Case = {
    id: "c9348",
    title: "t",
    decedent: { name: "被相続人", birthDate: "1940-01-01", deathDate: "2026-03-15", address: "x" },
    persons: [
      { id: "sb0", name: "兄0", relation: "sibling", birthDate: "1950-01-01" },
      { id: "sb1", name: "兄1", relation: "sibling", birthDate: "1950-01-01" },
      { id: "sb2", name: "兄2", relation: "sibling", birthDate: "1950-01-01" },
    ],
    assets: [
      { id: "lot0", kind: "land", label: "土地0", location: "x", areaSqm: 117, landUse: "宅地", method: { type: "manual", value: 57_632_546 }, smallResidential: { applies: true, acquirerId: "sb2", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } } },
      { id: "lot1", kind: "land", label: "土地1", location: "x", areaSqm: 385, landUse: "宅地", method: { type: "manual", value: 240_999_498 }, smallResidential: { applies: true, acquirerId: "sb1", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, others: [{ acquirerId: "sb2", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }, { acquirerId: "sb0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }] } },
      { id: "lot2", kind: "land", label: "土地2", location: "x", areaSqm: 148, landUse: "宅地", method: { type: "manual", value: 310_656_187 }, use: "leasedLand", leaseRatio: 0.6, smallResidential: { applies: true, acquirerId: "sb2", check: { continues: "yes", keep: "yes", recent: "no" } } },
      { id: "lot3", kind: "land", label: "土地3", location: "x", areaSqm: 232, landUse: "宅地", method: { type: "manual", value: 297_428_254 }, smallResidential: { applies: true, acquirerId: "sb2", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, others: [{ acquirerId: "sb1", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }] } },
    ],
    allocations: [
      { assetId: "lot0", shares: [{ personId: "sb2", numerator: 2, denominator: 6 }, { personId: "sb1", numerator: 2, denominator: 6 }, { personId: "sb0", numerator: 2, denominator: 6 }] },
      { assetId: "lot1", shares: [{ personId: "sb1", numerator: 2, denominator: 7 }, { personId: "sb2", numerator: 2, denominator: 7 }, { personId: "sb0", numerator: 3, denominator: 7 }] },
      { assetId: "lot2", shares: [{ personId: "sb2", numerator: 1, denominator: 3 }, { personId: "sb1", numerator: 1, denominator: 3 }, { personId: "sb0", numerator: 1, denominator: 3 }] },
      { assetId: "lot3", shares: [{ personId: "sb2", numerator: 1, denominator: 2 }, { personId: "sb1", numerator: 1, denominator: 2 }] },
    ],
    debts: [],
    priorGifts: [
      { personId: "sb2", date: "2025-09-15", amount: 18_000_000, giftTaxPaid: 2_880_000 },
    ],
  };
  const rows = (order: string[]): Case => ({
    ...caseD,
    allocations: caseD.allocations.map((a) => (a.assetId === "lot1" ? { ...a, shares: [...a.shares].sort((p, q) => order.indexOf(p.personId) - order.indexOf(q.personId)) } : a)),
  });

  it("土地1の行を 兄1・兄2・兄0 の順でも 兄0・兄1・兄2 の順でも、同じ割り当て・同じ税額で、129,504,800円以下", () => {
    const a = calculate(rows(["sb1", "sb2", "sb0"]));
    const b = calculate(rows(["sb0", "sb1", "sb2"]));
    expect(a.blockers).toEqual([]);
    expect(net(a)).toBe(net(b));
    expect(selections(a).sort((x, y) => (x.assetId + x.acquirerId < y.assetId + y.acquirerId ? -1 : 1))).toEqual(
      selections(b).sort((x, y) => (x.assetId + x.acquirerId < y.assetId + y.acquirerId ? -1 : 1)),
    );
    expect(net(a)).toBeLessThanOrEqual(129_504_800);
    // 端数は持分がいちばん大きい人（同じなら人のIDの順で先の人）に寄せるので、各人の取得価額も同じ
    const amounts = (r: TaxResult) => r.assets.find((l) => l.asset.id === "lot1")!.byPerson.map((x) => `${x.personId}:${x.amount}`).sort();
    expect(amounts(a)).toEqual(amounts(b));
  });
});

describe("家族の一覧の順だけを変えても同じ（扶養義務者から引く控除の1円の端数を、一覧の順で配らない）", () => {
  const caseE: Case = {
    id: "c80104",
    title: "t",
    decedent: { name: "被相続人", birthDate: "1940-01-01", deathDate: "2026-03-15", address: "x" },
    persons: [
      { id: "sp", name: "配偶者", relation: "spouse", birthDate: "1946-02-03" },
      { id: "ch0", name: "子0", relation: "child", birthDate: "2015-04-07" },
      { id: "ch1", name: "子1", relation: "child", birthDate: "1983-03-18", disability: "special" },
      { id: "ch2", name: "子2", relation: "child", birthDate: "2013-01-09" },
      { id: "ch3", name: "子3", relation: "child", birthDate: "1983-05-12" },
    ],
    assets: [
      { id: "lot0", kind: "land", label: "土地0", location: "x", areaSqm: 93, landUse: "宅地", method: { type: "manual", value: 25_247_064 }, use: "leasedLand", leaseRatio: 0.6, smallResidential: { applies: true, acquirerId: "ch3", check: { continues: "yes", keep: "yes", recent: "no" } } },
      { id: "lot1", kind: "land", label: "土地1", location: "x", areaSqm: 29, landUse: "宅地", method: { type: "manual", value: 203_418_998 }, smallResidential: { applies: true, acquirerId: "ch2", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" } } },
      { id: "lot2", kind: "condo", label: "マンション2", location: "x", landValueBeforeCorrection: 43_939_592, buildingFixedAssetValue: 20_000_000, builtYearsMonths: { years: 6, months: 10 }, totalFloors: 14, floor: 2, landShareSqm: 120.37, exclusiveAreaSqm: 120, rented: true, leaseRatio: 0.6, rentRatio: 0.8, smallResidential: { applies: true, acquirerId: "ch1", check: { continues: "yes", keep: "yes", recent: "no" }, others: [{ acquirerId: "sp", check: { continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 120.34 }, { acquirerId: "ch0", check: { continues: "yes", keep: "yes", recent: "no" } }] } },
      { id: "lot3", kind: "land", label: "土地3", location: "x", areaSqm: 364.88, landUse: "宅地", method: { type: "manual", value: 153_835_299 }, use: "leasedLand", leaseRatio: 0.6, smallResidential: { applies: true, acquirerId: "ch0", check: { continues: "yes", keep: "yes", recent: "no" } } },
    ],
    allocations: [
      { assetId: "lot0", shares: [{ personId: "ch3", numerator: 5, denominator: 5 }] },
      { assetId: "lot1", shares: [{ personId: "ch2", numerator: 7, denominator: 7 }] },
      { assetId: "lot2", shares: [{ personId: "ch1", numerator: 1, denominator: 4 }, { personId: "sp", numerator: 1, denominator: 4 }, { personId: "ch0", numerator: 1, denominator: 4 }, { personId: "ch3", numerator: 1, denominator: 4 }] },
      { assetId: "lot3", shares: [{ personId: "ch0", numerator: 12, denominator: 12 }] },
    ],
    debts: [],
    priorGifts: [
      { personId: "ch0", date: "2025-01-15", amount: 25_000_000, giftTaxPaid: 5_500_000 },
      { personId: "ch1", date: "2025-07-15", amount: 20_000_000, giftTaxPaid: 2_200_000 },
      { personId: "ch2", date: "2025-04-15", amount: 2_000_000, giftTaxPaid: 320_000 },
    ],
  };
  const turns = (xs: Person[]) => xs.map((_, k) => [...xs.slice(k), ...xs.slice(0, k)]);
  const orders = [...turns(caseE.persons), ...turns([...caseE.persons].reverse())];

  it("家族の一覧を10通りに並べ替えても、家族全体の相続税は同じで、2,957,200円以下", () => {
    const base = net(calculate(caseE));
    expect(base).toBeLessThanOrEqual(2_957_200);
    for (const persons of orders) expect(net(calculate({ ...caseE, persons }))).toBe(base);
  });
});

describe("人のIDだけを付け替えても同じ（持分は割り切れる・入力の順も同じ）", () => {
  const caseF: Case = {
    id: "c90428",
    title: "t",
    decedent: { name: "被相続人", birthDate: "1940-01-01", deathDate: "2026-03-15", address: "x" },
    persons: [
      { id: "ch0", name: "子0", relation: "child", birthDate: "1977-07-18", disability: "general" },
      { id: "ch1", name: "子1", relation: "child", birthDate: "1961-06-13", disability: "special" },
      { id: "ch2", name: "子2", relation: "child", birthDate: "1997-08-10" },
      { id: "ch3", name: "子3", relation: "child", birthDate: "2013-06-07" },
      { id: "dc", name: "亡子", relation: "child", predeceased: true, deathDate: "2010-01-01", hasChildren: true, birthDate: "1965-01-01" },
      { id: "sg0", name: "代孫0", relation: "grandchild", substituteOf: "dc", birthDate: "2012-05-05" },
      { id: "sg1", name: "代孫1", relation: "grandchild", substituteOf: "dc", birthDate: "1992-05-05" },
    ],
    assets: [
      { id: "lot0", kind: "land", label: "土地0", location: "x", areaSqm: 392, landUse: "宅地", method: { type: "manual", value: 347_004_000 }, smallResidential: { applies: true, acquirerId: "sg0", check: { ownHome: "no", business: "no", familyHome: "yes", keep: "yes", confirmedByAdvisor: true }, selectedSqm: 241, others: [{ acquirerId: "ch1", check: { ownHome: "no", business: "no", familyHome: "yes", keep: "yes", confirmedByAdvisor: true } }, { acquirerId: "ch3", check: { ownHome: "no", business: "no", familyHome: "yes", keep: "yes", confirmedByAdvisor: true } }] } },
      { id: "lot1", kind: "land", label: "土地1", location: "x", areaSqm: 173, landUse: "宅地", method: { type: "manual", value: 367_416_000 }, use: "rentedHouse", leaseRatio: 0.6, rentRatio: 0.9, smallResidential: { applies: true, acquirerId: "sg1", check: { continues: "yes", keep: "yes", recent: "no" } } },
    ],
    allocations: [
      { assetId: "lot0", shares: [{ personId: "sg0", numerator: 3, denominator: 12 }, { personId: "ch1", numerator: 6, denominator: 12 }, { personId: "ch3", numerator: 3, denominator: 12 }] },
      { assetId: "lot1", shares: [{ personId: "sg1", numerator: 4, denominator: 4 }] },
    ],
    debts: [],
    priorGifts: [],
  };
  const ids: Record<string, string> = { ch0: "7e29f4d9", ch1: "aff1708f", ch2: "943a71ff", ch3: "85c67860", dc: "cb60b234", sg0: "1766bf01", sg1: "4ff6d6a8" };
  const renamed = JSON.parse(Object.entries(ids).reduce((s, [a, b]) => s.split(`"${a}"`).join(`"${b}"`), JSON.stringify(caseF))) as Case;

  it("62,155,800円以下で、IDを付け替えても同じ", () => {
    const r = calculate(caseF);
    expect(r.blockers).toEqual([]);
    expect(net(r)).toBeLessThanOrEqual(62_155_800);
    expect(net(calculate(renamed))).toBe(net(r));
  });
});

describe("1つの土地を5人で受け継いだとき（境目にかかる人が多い）も、これまでの計算より高くならない", () => {
  const caseG: Case = {
    id: "c150605",
    title: "t",
    decedent: { name: "被相続人", birthDate: "1940-01-01", deathDate: "2026-03-15", address: "x", settlementGift: true, priorInheritanceTax: true, priorInheritance: { date: "2024-04-01", prevTax: 28_000_000, prevAcquired: 206_000_000 } },
    persons: [
      { id: "ch0", name: "子0", relation: "child", birthDate: "1973-05-12" },
      { id: "ch1", name: "子1", relation: "child", birthDate: "1979-09-18" },
      { id: "ch2", name: "子2", relation: "child", birthDate: "2011-05-07" },
      { id: "ch3", name: "子3", relation: "child", birthDate: "1967-04-17" },
      { id: "dc", name: "亡子", relation: "child", predeceased: true, deathDate: "2010-01-01", hasChildren: true, birthDate: "1965-01-01" },
      { id: "sg0", name: "代孫0", relation: "grandchild", substituteOf: "dc", birthDate: "2012-05-05" },
      { id: "sg1", name: "代孫1", relation: "grandchild", substituteOf: "dc", birthDate: "1992-05-05" },
    ],
    assets: [
      { id: "lot0", kind: "land", label: "土地0", location: "x", areaSqm: 596, landUse: "宅地", method: { type: "manual", value: 283_354_755 }, smallResidential: { applies: true, acquirerId: "ch3", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, others: [{ acquirerId: "sg0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }] } },
      { id: "lot1", kind: "land", label: "土地1", location: "x", areaSqm: 582.04, landUse: "宅地", method: { type: "manual", value: 374_286_189 }, smallResidential: { applies: true, acquirerId: "ch1", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, others: [{ acquirerId: "ch0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }, { acquirerId: "sg1", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }, { acquirerId: "ch3", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 48.68 }, { acquirerId: "sg0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }] } },
      { id: "lot2", kind: "condo", label: "マンション2", location: "x", landValueBeforeCorrection: 261_011_562, buildingFixedAssetValue: 6_000_000, builtYearsMonths: { years: 21, months: 2 }, totalFloors: 13, floor: 2, landShareSqm: 78.34, exclusiveAreaSqm: 87, smallResidential: { applies: true, acquirerId: "ch0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, others: [{ acquirerId: "sg0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }, { acquirerId: "ch3", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }, { acquirerId: "ch2", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 165 }] } },
      { id: "dep0", kind: "deposit", label: "預金0", amount: 108_000_272 },
      { id: "dep1", kind: "deposit", label: "預金1", amount: 15_000_333 },
      { id: "dep2", kind: "deposit", label: "預金2", amount: 24_000_007 },
    ],
    allocations: [
      { assetId: "lot0", shares: [{ personId: "ch3", numerator: 2, denominator: 4 }, { personId: "sg0", numerator: 2, denominator: 4 }] },
      { assetId: "lot1", shares: [{ personId: "ch1", numerator: 4, denominator: 12 }, { personId: "ch0", numerator: 3, denominator: 12 }, { personId: "sg1", numerator: 1, denominator: 12 }, { personId: "ch3", numerator: 1, denominator: 12 }, { personId: "sg0", numerator: 3, denominator: 12 }] },
      { assetId: "lot2", shares: [{ personId: "ch0", numerator: 1, denominator: 6 }, { personId: "sg0", numerator: 1, denominator: 6 }, { personId: "ch3", numerator: 1, denominator: 6 }, { personId: "ch2", numerator: 2, denominator: 6 }, { personId: "ch1", numerator: 1, denominator: 6 }] },
      { assetId: "dep0", shares: [{ personId: "ch1", numerator: 1, denominator: 1 }] },
      { assetId: "dep1", shares: [{ personId: "ch3", numerator: 1, denominator: 1 }] },
      { assetId: "dep2", shares: [{ personId: "ch0", numerator: 1, denominator: 2 }, { personId: "ch2", numerator: 1, denominator: 2 }] },
    ],
    debts: [],
    priorGifts: [
      { personId: "ch0", date: "2024-09-10", amount: 44_000_000, giftTaxPaid: 6_000_900, settlement: true },
      { personId: "ch3", date: "2025-09-10", amount: 46_000_000, giftTaxPaid: 7_000_500, settlement: true },
      { personId: "sg0", date: "2025-04-15", amount: 20_000_000, giftTaxPaid: 6_400_000 },
    ],
  };

  it("177,734,800円（これまでの計算の額）以下", () => {
    const r = calculate(caseG);
    expect(r.blockers).toEqual([]);
    expect(net(r)).toBeLessThanOrEqual(177_734_800);
    expect(withinLimit(r)).toBe(true);
  });
});

describe("候補が多い・家族が多い・ほかの財産が多いときも、計算は1秒以内（探す回数には上限がある）", () => {
  const people = (n: number): Person[] => Array.from({ length: n }, (_, k) => ({ id: `p${k}`, name: `子${k}`, relation: "child", birthDate: "1970-01-01" }));
  const deposits = (persons: Person[], n: number) => ({
    assets: Array.from({ length: n }, (_, k): Asset => ({ id: `x${k}`, kind: "deposit", label: `預金x${k}`, amount: 1_000_000 + k })),
    allocations: Array.from({ length: n }, (_, k) => share(`x${k}`, [persons[k % persons.length].id, 1, 1])),
  });
  const timed = (c: Case) => {
    calculate(c); // 1回目は準備の時間を含むので測らない
    const t0 = performance.now();
    const r = calculate(c);
    return { r, ms: performance.now() - t0 };
  };

  it("15人が3つの土地を持分を変えて受け継ぎ（候補45個）、ほかの財産が150件：1秒以内", () => {
    const persons = people(15);
    const kinds = ["rental", "residence", "rental"] as const;
    const lots = kinds.map((kind, i): LandAsset => {
      const check = kind === "rental" ? RENT_CHECK : HOME_LIVING;
      return {
        id: `土地${i}`,
        kind: "land",
        label: `土地${i}`,
        location: "x",
        areaSqm: 200 + i * 41.7,
        landUse: "宅地",
        method: { type: "manual", value: 150_000_000 + i * 31_234_567 },
        ...(kind === "rental" ? { use: "rentedHouse" as const, leaseRatio: 0.6 } : {}),
        smallResidential: { applies: true, acquirerId: persons[0].id, check, others: persons.slice(1).map((p) => ({ acquirerId: p.id, check: kind === "rental" ? check : LIVING })) },
      };
    });
    const dep = deposits(persons, 150);
    const gifts = persons.filter((_, k) => k % 3 === 1).map((p, k): PriorGift => ({ personId: p.id, date: "2025-01-15", amount: 10_000_000 + k * 1_000_000, giftTaxPaid: 1_500_000 + k * 100_000 }));
    const { r, ms } = timed(
      mk(persons, [...lots, ...dep.assets], [...lots.map((l) => share(l.id, ...persons.map((p, k): [string, number, number] => [p.id, k + 1, 120]))), ...dep.allocations], gifts),
    );
    expect(r.blockers).toEqual([]);
    expect(withinLimit(r)).toBe(true);
    expect(ms).toBeLessThan(1_000);
  });

  it("21人が60の土地を5人ずつで受け継ぎ（候補300個）、ほかの財産が150件・全員に贈与があっても、1秒以内（手元では80ミリ秒ほど）", () => {
    // 候補 ×（家族の数 ＋ 財産の数）がとても大きいので、計算する回数を減らして探す（SR_WORK）。それでも限度面積の内に収める
    const persons: Person[] = [{ id: "sp", name: "妻", relation: "spouse", birthDate: "1945-01-01" }, ...people(20)];
    const kinds = ["rental", "business", "residence"] as const;
    /** 土地 l を受け継ぐ5人（1/5ずつ） */
    const owners = (l: number) => Array.from({ length: 5 }, (_, k) => persons[(l + k) % persons.length].id);
    const lots = Array.from({ length: 60 }, (_, l): LandAsset => {
      const kind = kinds[l % 3];
      const check = kind === "rental" ? RENT_CHECK : kind === "business" ? BUSINESS_CHECK : HOME_LIVING;
      return {
        id: `土地${l}`,
        kind: "land",
        label: `土地${l}`,
        location: "x",
        areaSqm: 50 + (l % 37) * 7.13,
        landUse: "宅地",
        method: { type: "manual", value: 20_000_000 + l * 1_234_567 },
        ...(kind === "rental" ? { use: "rentedHouse" as const, leaseRatio: 0.6 } : {}),
        smallResidential: { applies: true, acquirerId: owners(l)[0], check, others: owners(l).slice(1).map((acquirerId) => ({ acquirerId, check })) },
      };
    });
    const dep = deposits(persons, 150);
    const gifts = persons.map((p, i): PriorGift => ({ personId: p.id, date: "2025-04-01", amount: 5_000_000 * (i + 1), giftTaxPaid: 500_000 * (i + 1) }));
    const { r, ms } = timed(mk(persons, [...lots, ...dep.assets], [...lots.map((x, l) => share(x.id, ...owners(l).map((id): [string, number, number] => [id, 1, 5]))), ...dep.allocations], gifts));
    expect(r.blockers).toEqual([]);
    expect(withinLimit(r)).toBe(true);
    expect(ms).toBeLessThan(1_000);
  });

  it("1人が同じような貸家の敷地を100か所受け継いでも（どう移しても減額が変わらない）、1秒以内", () => {
    const lots = Array.from({ length: 100 }, (_, k) => rentLot(`貸${k}`, 15, 30_000_000, ["c1"]));
    const { r, ms } = timed(mk([c1], lots, lots.map((l) => share(l.id, ["c1", 1, 1]))));
    expect(r.blockers).toEqual([]);
    expect(usedBy(r).rental).toBe(20_000);
    expect(ms).toBeLessThan(1_000);
  });
});

describe("人のIDを付け替えても同じ（1つの土地を一緒に受け継いだ人どうしが、続柄や贈与の違う人のとき）", () => {
  // 土地1（特定事業用）を配偶者・子0・孫養子（2割加算・贈与あり）の3人で受け継ぐ。3人の1㎡あたりの減額は同じで、
  // これまでは人のIDの順で並べていたため、IDを付け替えただけで 115,410,400円と 113,885,000円に分かれた（HEAD は 133,072,000円）
  const caseMid: Case = {
    id: "g300037",
    title: "t",
    decedent: { name: "被相続人", birthDate: "1940-01-01", deathDate: "2026-03-15", address: "東京都千代田区" },
    persons: [
      { id: "sp", name: "配偶者", relation: "spouse", birthDate: "1945-01-01" },
      { id: "ch0", name: "子0", relation: "child", birthDate: "1970-05-01" },
      { id: "ch1", name: "子1", relation: "child", birthDate: "1970-05-01" },
      { id: "gc", name: "孫", relation: "adoptedChild", grandchildAdopted: true, birthDate: "1995-03-01" },
    ],
    assets: [
      { id: "lot0", kind: "land", label: "土地0", location: "東京都千代田区", areaSqm: 55.36, landUse: "宅地", method: { type: "manual", value: 179_420_000 }, use: "rentedHouse", leaseRatio: 0.6, smallResidential: { applies: true, acquirerId: "sp", check: { continues: "yes", keep: "yes", recent: "no" }, others: [{ acquirerId: "ch1", check: { continues: "yes", keep: "yes", recent: "no" } }] } },
      { id: "lot1", kind: "land", label: "土地1", location: "東京都千代田区", areaSqm: 597, landUse: "宅地", method: { type: "manual", value: 205_550_002 }, smallResidential: { applies: true, acquirerId: "sp", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, others: [{ acquirerId: "ch0", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" } }, { acquirerId: "gc", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" } }] } },
      { id: "lot2", kind: "land", label: "土地2", location: "東京都千代田区", areaSqm: 651.9, landUse: "宅地", method: { type: "manual", value: 45_130_003 }, smallResidential: { applies: true, acquirerId: "sp", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, others: [{ acquirerId: "ch0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }] } },
      { id: "lot3", kind: "land", label: "土地3", location: "東京都千代田区", areaSqm: 463.03, landUse: "宅地", method: { type: "manual", value: 133_366_007 }, use: "rentedHouse", leaseRatio: 0.6, smallResidential: { applies: true, acquirerId: "sp", check: { continues: "yes", keep: "yes", recent: "no" }, others: [{ acquirerId: "ch1", check: { continues: "yes", keep: "yes", recent: "no" } }, { acquirerId: "ch0", check: { continues: "yes", keep: "yes", recent: "no" } }] } },
      { id: "dep0", kind: "deposit", label: "預金0", amount: 142_000_000 },
      { id: "dep1", kind: "deposit", label: "預金1", amount: 94_000_000 },
    ],
    allocations: [
      { assetId: "lot0", shares: [{ personId: "sp", numerator: 1, denominator: 2 }, { personId: "ch1", numerator: 1, denominator: 2 }] },
      { assetId: "lot1", shares: [{ personId: "sp", numerator: 1, denominator: 3 }, { personId: "ch0", numerator: 1, denominator: 3 }, { personId: "gc", numerator: 1, denominator: 3 }] },
      { assetId: "lot2", shares: [{ personId: "sp", numerator: 1, denominator: 2 }, { personId: "ch0", numerator: 1, denominator: 2 }] },
      { assetId: "lot3", shares: [{ personId: "sp", numerator: 1, denominator: 6 }, { personId: "ch1", numerator: 3, denominator: 6 }, { personId: "ch0", numerator: 2, denominator: 6 }] },
      { assetId: "dep0", shares: [{ personId: "ch0", numerator: 1, denominator: 1 }] },
      { assetId: "dep1", shares: [{ personId: "ch1", numerator: 1, denominator: 1 }] },
    ],
    debts: [],
    priorGifts: [
      { personId: "sp", date: "2025-03-15", amount: 10_000_000, giftTaxPaid: 3_500_000 },
      { personId: "ch0", date: "2025-04-15", amount: 22_000_000, giftTaxPaid: 9_020_000 },
      { personId: "ch1", date: "2025-05-15", amount: 21_000_000, giftTaxPaid: 7_140_000 },
      { personId: "gc", date: "2025-07-15", amount: 13_000_000, giftTaxPaid: 5_590_000 },
    ],
  };

  const ids: Record<string, string> = { sp: "dc373b64", ch0: "103f90ae", ch1: "1db6d9d3", gc: "0a0ac835" };
  const renamed = JSON.parse(Object.entries(ids).reduce((s, [a, b]) => s.split(`"${a}"`).join(`"${b}"`), JSON.stringify(caseMid))) as Case;

  it("どちらのIDでも同じ税額で、113,885,000円以下", () => {
    const a = calculate(caseMid);
    const b = calculate(renamed);
    expect(a.blockers).toEqual([]);
    expect(net(a)).toBeLessThanOrEqual(113_885_000);
    expect(net(b)).toBe(net(a));
    expect(withinLimit(a)).toBe(true);
  });
});

describe("候補が9つで、貸付事業用を使わない割り当てがいちばんよく見えるときも、貸付事業用を使う割り当てから探す", () => {
  // 貸付事業用を使わない始めの割り当て（特定事業用400㎡＋特定居住用149.76㎡）から面積を移すだけでは、貸付事業用を使う割り当てに
  // 行き着けなかった（256,805,500円）。貸付事業用を使う側でいちばんよい始めの割り当てからも探すと、マンション1の子0の分 29.2㎡、
  // 土地0 の配偶者 49.72㎡・子0 215㎡、土地3 の子0 31.04㎡・マンション5 の配偶者 32.38㎡（40×6,342＋33×26,472＋66×2,920 ≦ 1,320,000）で 256,554,500円
  const caseV: Case = {
    id: "c830056",
    title: "t",
    decedent: { name: "被相続人", birthDate: "1940-01-01", deathDate: "2026-03-15", address: "x" },
    persons: [
      { id: "sp", name: "配偶者", relation: "spouse", birthDate: "1946-02-03" },
      { id: "ch0", name: "子0", relation: "child", birthDate: "1970-07-19" },
    ],
    assets: [
      { id: "lot0", kind: "land", label: "土地0", location: "x", areaSqm: 301, landUse: "宅地", method: { type: "manual", value: 337_642_427 }, smallResidential: { applies: true, acquirerId: "sp", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, others: [{ acquirerId: "ch0", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" } }] } },
      { id: "lot1", kind: "condo", label: "マンション1", location: "x", landValueBeforeCorrection: 81_531_913, buildingFixedAssetValue: 22_000_000, builtYearsMonths: { years: 27, months: 4 }, totalFloors: 17, floor: 2, landShareSqm: 58.39, exclusiveAreaSqm: 55, rented: true, leaseRatio: 0.6, smallResidential: { applies: true, acquirerId: "sp", check: { continues: "yes", keep: "yes", recent: "no" }, others: [{ acquirerId: "ch0", check: { continues: "yes", keep: "yes", recent: "no" } }] } },
      { id: "lot2", kind: "land", label: "土地2", location: "x", areaSqm: 491.1, landUse: "宅地", method: { type: "manual", value: 364_060_172 }, use: "leasedLand", leaseRatio: 0.6, smallResidential: { applies: true, acquirerId: "sp", check: { continues: "yes", keep: "yes", recent: "no" } } },
      { id: "lot3", kind: "land", label: "土地3", location: "x", areaSqm: 431.71, landUse: "宅地", method: { type: "manual", value: 207_323_793 }, smallResidential: { applies: true, acquirerId: "sp", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, others: [{ acquirerId: "ch0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 31.04 }] } },
      { id: "lot4", kind: "land", label: "土地4", location: "x", areaSqm: 527, landUse: "宅地", method: { type: "manual", value: 58_982_812 }, smallResidential: { applies: true, acquirerId: "ch0", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" } } },
      { id: "lot5", kind: "condo", label: "マンション5", location: "x", landValueBeforeCorrection: 276_325_239, buildingFixedAssetValue: 8_000_000, builtYearsMonths: { years: 10, months: 9 }, totalFloors: 19, floor: 2, landShareSqm: 53.96, exclusiveAreaSqm: 75, smallResidential: { applies: true, acquirerId: "sp", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 75 } },
      { id: "dep0", kind: "deposit", label: "預金0", amount: 87_000_160 },
      { id: "dep1", kind: "deposit", label: "預金1", amount: 140_000_499 },
      { id: "dep2", kind: "deposit", label: "預金2", amount: 188_000_615 },
      { id: "ins", kind: "insurance", label: "保険", amount: 16_000_000, recipientId: "ch0" },
    ],
    allocations: [
      { assetId: "lot0", shares: [{ personId: "sp", numerator: 2, denominator: 7 }, { personId: "ch0", numerator: 5, denominator: 7 }] },
      { assetId: "lot1", shares: [{ personId: "sp", numerator: 1, denominator: 2 }, { personId: "ch0", numerator: 1, denominator: 2 }] },
      { assetId: "lot2", shares: [{ personId: "sp", numerator: 1, denominator: 1 }] },
      { assetId: "lot3", shares: [{ personId: "sp", numerator: 1, denominator: 5 }, { personId: "ch0", numerator: 4, denominator: 5 }] },
      { assetId: "lot4", shares: [{ personId: "ch0", numerator: 1, denominator: 2 }, { personId: "sp", numerator: 1, denominator: 2 }] },
      { assetId: "lot5", shares: [{ personId: "sp", numerator: 6, denominator: 10 }, { personId: "ch0", numerator: 4, denominator: 10 }] },
      { assetId: "dep0", shares: [{ personId: "ch0", numerator: 1, denominator: 2 }, { personId: "sp", numerator: 1, denominator: 2 }] },
      { assetId: "dep1", shares: [{ personId: "sp", numerator: 1, denominator: 1 }] },
      { assetId: "dep2", shares: [{ personId: "ch0", numerator: 1, denominator: 1 }] },
    ],
    debts: [
      { id: "d0", kind: "debt", label: "借入", amount: 16_000_205, bearers: [{ personId: "ch0", amount: 16_000_205 }] },
    ],
    priorGifts: [],
  };


  it("256,554,500円以下で、限度面積の内", () => {
    const r = calculate(caseV);
    expect(r.blockers).toEqual([]);
    expect(net(r)).toBeLessThanOrEqual(256_554_500);
    expect(withinLimit(r)).toBe(true);
  });
});

describe("一部が未分割の土地があるとき、家族・財産・分け方の行・一緒に使う人の順を変えても同じ", () => {
  // 土地5は 4/10・4/10・1/10 だけ決まっていて、残り1/10は未分割（法定相続分で分ける）。1円未満の端数をいちばん大きい割合の
  // 人の分に寄せるとき、同じ割合の人どうしでは分け方の行の順で先の人に寄せていたため、行の順だけで 119,778,200円と 119,779,800円に分かれた
  const caseU0: Case = {
    id: "g350033",
    title: "t",
    decedent: { name: "被相続人", birthDate: "1940-01-01", deathDate: "2026-03-15", address: "東京都千代田区" },
    persons: [
      { id: "sp", name: "配偶者", relation: "spouse", birthDate: "1945-01-01" },
      { id: "ch0", name: "子0", relation: "child", birthDate: "1971-06-01", disability: "general" },
      { id: "ch1", name: "子1", relation: "child", birthDate: "1977-06-01", disability: "general" },
      { id: "ch2", name: "子2", relation: "child", birthDate: "1970-05-01" },
      { id: "ch3", name: "子3", relation: "child", birthDate: "1970-05-01" },
      { id: "ch4", name: "子4", relation: "child", birthDate: "1970-05-01" },
      { id: "gc", name: "孫", relation: "adoptedChild", grandchildAdopted: true, birthDate: "1995-03-01" },
    ],
    assets: [
      { id: "lot0", kind: "land", label: "土地0", location: "東京都千代田区", areaSqm: 649.52, landUse: "宅地", method: { type: "manual", value: 57_316_006 }, use: "rentedHouse", leaseRatio: 0.6, rentRatio: 0.5, smallResidential: { applies: true, acquirerId: "gc", check: { continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 76, others: [{ acquirerId: "ch3", check: { continues: "yes", keep: "yes", recent: "no" } }] } },
      { id: "lot1", kind: "land", label: "土地1", location: "東京都千代田区", areaSqm: 234, landUse: "宅地", method: { type: "manual", value: 6_402_003 }, smallResidential: { applies: true, acquirerId: "ch0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, others: [{ acquirerId: "sp", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }, { acquirerId: "ch1", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 249 }, { acquirerId: "ch4", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 38.37 }, { acquirerId: "gc", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }] } },
      { id: "lot2", kind: "land", label: "土地2", location: "東京都千代田区", areaSqm: 531, landUse: "宅地", method: { type: "manual", value: 196_791_003 }, smallResidential: { applies: true, acquirerId: "ch4", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 95, others: [{ acquirerId: "ch0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 101.37 }] } },
      { id: "lot3", kind: "land", label: "土地3", location: "東京都千代田区", areaSqm: 484, landUse: "宅地", method: { type: "manual", value: 80_208_008 }, use: "rentedHouse", leaseRatio: 0.6, rentRatio: 1, smallResidential: { applies: true, acquirerId: "gc", check: { continues: "yes", keep: "yes", recent: "no" }, others: [{ acquirerId: "ch2", check: { continues: "yes", keep: "yes", recent: "no" } }, { acquirerId: "ch3", check: { continues: "yes", keep: "yes", recent: "no" } }, { acquirerId: "ch0", check: { continues: "yes", keep: "yes", recent: "no" } }, { acquirerId: "sp", check: { continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 115.37 }] } },
      { id: "lot4", kind: "land", label: "土地4", location: "東京都千代田区", areaSqm: 206.47, landUse: "宅地", method: { type: "manual", value: 265_828_007 }, smallResidential: { applies: true, acquirerId: "ch3", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 235.37, others: [{ acquirerId: "sp", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" } }, { acquirerId: "gc", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 3 }, { acquirerId: "ch2", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 109 }, { acquirerId: "ch1", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 194 }] } },
      { id: "lot5", kind: "land", label: "土地5", location: "東京都千代田区", areaSqm: 554, landUse: "宅地", method: { type: "manual", value: 60_641_002 }, smallResidential: { applies: true, acquirerId: "ch0", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 180, others: [{ acquirerId: "ch1", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" } }, { acquirerId: "gc", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 106 }] } },
      { id: "dep0", kind: "deposit", label: "預金0", amount: 134_000_000 },
    ],
    allocations: [
      { assetId: "lot0", shares: [{ personId: "gc", numerator: 5, denominator: 7 }, { personId: "ch3", numerator: 2, denominator: 7 }] },
      { assetId: "lot1", shares: [{ personId: "ch0", numerator: 1, denominator: 5 }, { personId: "sp", numerator: 1, denominator: 5 }, { personId: "ch1", numerator: 1, denominator: 5 }, { personId: "ch4", numerator: 1, denominator: 5 }, { personId: "gc", numerator: 1, denominator: 5 }] },
      { assetId: "lot2", shares: [{ personId: "ch4", numerator: 4, denominator: 5 }, { personId: "ch0", numerator: 1, denominator: 5 }] },
      { assetId: "lot3", shares: [{ personId: "gc", numerator: 1, denominator: 7 }, { personId: "ch2", numerator: 1, denominator: 7 }, { personId: "ch3", numerator: 2, denominator: 7 }, { personId: "ch0", numerator: 1, denominator: 7 }, { personId: "sp", numerator: 2, denominator: 7 }] },
      { assetId: "lot4", shares: [{ personId: "ch3", numerator: 1, denominator: 9 }, { personId: "sp", numerator: 1, denominator: 9 }, { personId: "gc", numerator: 3, denominator: 9 }, { personId: "ch2", numerator: 3, denominator: 9 }, { personId: "ch1", numerator: 1, denominator: 9 }] },
      { assetId: "lot5", shares: [{ personId: "ch0", numerator: 4, denominator: 10 }, { personId: "ch1", numerator: 4, denominator: 10 }, { personId: "gc", numerator: 1, denominator: 10 }] },
      { assetId: "dep0", shares: [{ personId: "ch1", numerator: 1, denominator: 1 }] },
    ],
    debts: [],
    priorGifts: [
      { personId: "sp", date: "2025-08-15", amount: 38_000_000, giftTaxPaid: 13_680_000 },
      { personId: "ch1", date: "2025-07-15", amount: 19_000_000, giftTaxPaid: 1_520_000 },
      { personId: "ch3", date: "2025-05-15", amount: 23_000_000, giftTaxPaid: 5_290_000 },
      { personId: "ch4", date: "2025-01-15", amount: 1_000_000, giftTaxPaid: 410_000 },
    ],
    undivided: true,
  };

  const caseU2: Case = {
    id: "g350033",
    title: "t",
    decedent: { name: "被相続人", birthDate: "1940-01-01", deathDate: "2026-03-15", address: "東京都千代田区" },
    persons: [
      { id: "ch1", name: "子1", relation: "child", birthDate: "1977-06-01", disability: "general" },
      { id: "ch4", name: "子4", relation: "child", birthDate: "1970-05-01" },
      { id: "gc", name: "孫", relation: "adoptedChild", grandchildAdopted: true, birthDate: "1995-03-01" },
      { id: "sp", name: "配偶者", relation: "spouse", birthDate: "1945-01-01" },
      { id: "ch2", name: "子2", relation: "child", birthDate: "1970-05-01" },
      { id: "ch3", name: "子3", relation: "child", birthDate: "1970-05-01" },
      { id: "ch0", name: "子0", relation: "child", birthDate: "1971-06-01", disability: "general" },
    ],
    assets: [
      { id: "dep0", kind: "deposit", label: "預金0", amount: 134_000_000 },
      { id: "lot4", kind: "land", label: "土地4", location: "東京都千代田区", areaSqm: 206.47, landUse: "宅地", method: { type: "manual", value: 265_828_007 }, smallResidential: { applies: true, acquirerId: "ch1", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 194, others: [{ acquirerId: "gc", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 3 }, { acquirerId: "ch3", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 235.37 }, { acquirerId: "sp", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" } }, { acquirerId: "ch2", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 109 }] } },
      { id: "lot3", kind: "land", label: "土地3", location: "東京都千代田区", areaSqm: 484, landUse: "宅地", method: { type: "manual", value: 80_208_008 }, use: "rentedHouse", leaseRatio: 0.6, rentRatio: 1, smallResidential: { applies: true, acquirerId: "ch0", check: { continues: "yes", keep: "yes", recent: "no" }, others: [{ acquirerId: "sp", check: { continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 115.37 }, { acquirerId: "ch3", check: { continues: "yes", keep: "yes", recent: "no" } }, { acquirerId: "gc", check: { continues: "yes", keep: "yes", recent: "no" } }, { acquirerId: "ch2", check: { continues: "yes", keep: "yes", recent: "no" } }] } },
      { id: "lot5", kind: "land", label: "土地5", location: "東京都千代田区", areaSqm: 554, landUse: "宅地", method: { type: "manual", value: 60_641_002 }, smallResidential: { applies: true, acquirerId: "ch1", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, others: [{ acquirerId: "ch0", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 180 }, { acquirerId: "gc", check: { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 106 }] } },
      { id: "lot1", kind: "land", label: "土地1", location: "東京都千代田区", areaSqm: 234, landUse: "宅地", method: { type: "manual", value: 6_402_003 }, smallResidential: { applies: true, acquirerId: "sp", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, others: [{ acquirerId: "ch1", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 249 }, { acquirerId: "gc", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }, { acquirerId: "ch4", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 38.37 }, { acquirerId: "ch0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" } }] } },
      { id: "lot2", kind: "land", label: "土地2", location: "東京都千代田区", areaSqm: 531, landUse: "宅地", method: { type: "manual", value: 196_791_003 }, smallResidential: { applies: true, acquirerId: "ch0", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 101.37, others: [{ acquirerId: "ch4", check: { ownHome: "yes", special: "no", livedTogether: "yes", keep: "yes" }, selectedSqm: 95 }] } },
      { id: "lot0", kind: "land", label: "土地0", location: "東京都千代田区", areaSqm: 649.52, landUse: "宅地", method: { type: "manual", value: 57_316_006 }, use: "rentedHouse", leaseRatio: 0.6, rentRatio: 0.5, smallResidential: { applies: true, acquirerId: "ch3", check: { continues: "yes", keep: "yes", recent: "no" }, others: [{ acquirerId: "gc", check: { continues: "yes", keep: "yes", recent: "no" }, selectedSqm: 76 }] } },
    ],
    allocations: [
      { assetId: "lot2", shares: [{ personId: "ch0", numerator: 1, denominator: 5 }, { personId: "ch4", numerator: 4, denominator: 5 }] },
      { assetId: "lot3", shares: [{ personId: "ch0", numerator: 1, denominator: 7 }, { personId: "sp", numerator: 2, denominator: 7 }, { personId: "ch2", numerator: 1, denominator: 7 }, { personId: "gc", numerator: 1, denominator: 7 }, { personId: "ch3", numerator: 2, denominator: 7 }] },
      { assetId: "lot1", shares: [{ personId: "ch0", numerator: 1, denominator: 5 }, { personId: "sp", numerator: 1, denominator: 5 }, { personId: "ch1", numerator: 1, denominator: 5 }, { personId: "gc", numerator: 1, denominator: 5 }, { personId: "ch4", numerator: 1, denominator: 5 }] },
      { assetId: "lot0", shares: [{ personId: "gc", numerator: 5, denominator: 7 }, { personId: "ch3", numerator: 2, denominator: 7 }] },
      { assetId: "lot5", shares: [{ personId: "ch1", numerator: 4, denominator: 10 }, { personId: "gc", numerator: 1, denominator: 10 }, { personId: "ch0", numerator: 4, denominator: 10 }] },
      { assetId: "lot4", shares: [{ personId: "ch3", numerator: 1, denominator: 9 }, { personId: "ch2", numerator: 3, denominator: 9 }, { personId: "sp", numerator: 1, denominator: 9 }, { personId: "ch1", numerator: 1, denominator: 9 }, { personId: "gc", numerator: 3, denominator: 9 }] },
      { assetId: "dep0", shares: [{ personId: "ch1", numerator: 1, denominator: 1 }] },
    ],
    debts: [],
    priorGifts: [
      { personId: "sp", date: "2025-08-15", amount: 38_000_000, giftTaxPaid: 13_680_000 },
      { personId: "ch4", date: "2025-01-15", amount: 1_000_000, giftTaxPaid: 410_000 },
      { personId: "ch3", date: "2025-05-15", amount: 23_000_000, giftTaxPaid: 5_290_000 },
      { personId: "ch1", date: "2025-07-15", amount: 19_000_000, giftTaxPaid: 1_520_000 },
    ],
    undivided: true,
  };


  it("2つの順で同じ税額で、119,778,200円以下", () => {
    const a = calculate(caseU0);
    const b = calculate(caseU2);
    expect(a.blockers).toEqual([]);
    expect(net(a)).toBeLessThanOrEqual(119_778_200);
    expect(net(b)).toBe(net(a));
    // 土地5の取得者ごとの価額も同じ（端数の1円を寄せる人が、行の順で変わらない）
    const lot5 = (r: TaxResult) => Object.fromEntries(r.assets.find((l) => l.asset.id === "lot5")!.byPerson.map((x) => [x.personId, x.amount]));
    expect(lot5(b)).toEqual(lot5(a));
  });
});
