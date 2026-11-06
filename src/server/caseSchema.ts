/**
 * 書類を作る API（相続税の申告書・遺産分割協議書・相続登記の申請書）に送られた相続の入力を確かめる。
 * 画面からは自分の入力しか送られないが、外から大きすぎるデータや壊れたデータを送られて
 * サーバーが止まらないよう、件数の上限と、相続人の id の重なり・代襲相続のつながりの矛盾を先に断る。
 * 中身の細かい形（金額や日付）は計算の側で確かめるため、ここでは見ない（知らない項目もそのまま通す）。
 */
import { z } from "zod";
import type { Case } from "@/domain/types";

export const CASE_LIMITS = {
  persons: 50,
  assets: 500,
  debts: 200,
  priorGifts: 200,
  compensation: 50,
  allocations: 500,
  shares: 50,
  bearers: 50,
  roads: 4,
  shape: 500,
  sheetPoints: 50,
  pending: 30,
  progress: 50,
  smallLandOthers: 10,
  sourceFiles: 30,
} as const;

/** 送られたデータ全体の大きさ（バイト）の上限。保存できるデータは90万文字までで、日本語は1文字3バイトのため、その3倍 */
export const MAX_CASE_BYTES = 2_700_000;

const SHAPE_ERROR = "入力データの形が正しくありません。画面を開き直してからお試しください。";
const DUPLICATE_PERSON = "同じ人が二重に登録されているようです。相続人の入力で、重なっている人を削除してから入れ直してください。";
const MISSING_PARENT = "代襲相続人（先に亡くなった方の子など）の親として選んだ人が、相続人の一覧にいません。相続人の入力を確かめてください。";
const PARENT_LOOP = "代襲相続人の親子のつながりが、ぐるりと元に戻っています。相続人の入力で、誰の代わりに相続する人かを選び直してください。";

const id = z.string().min(1).max(100);
const many = <T extends z.ZodType>(item: T, max: number, what: string) => z.array(item).max(max, `${what}は${max}件までです。`);

const person = z.looseObject({
  id,
  substituteOf: z.string().max(100).optional(),
});

const landMethod = z.looseObject({
  type: z.string().max(20),
  roads: many(z.looseObject({}), CASE_LIMITS.roads, "面している道路").optional(),
  shape: many(z.tuple([z.number(), z.number()]), CASE_LIMITS.shape, "土地の形の頂点").optional(),
  edgeOn: many(z.boolean(), CASE_LIMITS.shape, "土地の辺").optional(),
});

/** 小規模宅地等の特例を使う面積（㎡）。空き（null）は「使えるだけ使う」。0や負の数・数でない値の案内は計算の側で出す */
const SELECTED_SQM_ERROR = "小規模宅地等の特例を使う面積は、0以上の数（㎡）で入れてください。";
const selectedSqm = z.number({ error: SELECTED_SQM_ERROR }).min(0, SELECTED_SQM_ERROR).nullable().optional();

/** 小規模宅地等の特例（1つの土地を一緒に受け継いで特例を使う2人目以降の人と、特例を使う面積） */
const smallLandRelief = z.looseObject({
  selectedSqm,
  others: many(
    z.looseObject({ acquirerId: z.string().max(100), selectedSqm }),
    CASE_LIMITS.smallLandOthers,
    "1つの土地で小規模宅地等の特例を一緒に使う人",
  ).optional(),
});

const sourceFiles = many(z.string().max(120), CASE_LIMITS.sourceFiles, "元の資料").optional();

const asset = z.looseObject({
  id,
  sourceFiles,
  kind: z.string().max(40),
  pending: many(z.string().max(500), CASE_LIMITS.pending, "確認待ちの項目").optional(),
  method: landMethod.optional(),
  rosenkaSheet: z.looseObject({ points: many(z.looseObject({}), CASE_LIMITS.sheetPoints, "路線価図の基準点").optional() }).optional(),
  smallResidential: smallLandRelief.optional(),
});

const debt = z.looseObject({
  id,
  sourceFiles,
  bearers: many(z.looseObject({}), CASE_LIMITS.bearers, "1つの債務を負担する人").optional(),
});

const allocation = z.looseObject({
  assetId: z.string().max(100),
  shares: many(z.looseObject({}), CASE_LIMITS.shares, "1つの財産を取得する人"),
});

export const caseSchema = z
  .looseObject({
    decedent: z.looseObject({}),
    persons: many(person, CASE_LIMITS.persons, "相続人・財産を受け取る人"),
    assets: many(asset, CASE_LIMITS.assets, "財産"),
    debts: many(debt, CASE_LIMITS.debts, "債務・葬式費用"),
    allocations: many(allocation, CASE_LIMITS.allocations, "遺産分割の割合"),
    priorGifts: many(z.looseObject({}), CASE_LIMITS.priorGifts, "生前の贈与"),
    compensation: many(z.looseObject({}), CASE_LIMITS.compensation, "代償金").optional(),
    progress: z.looseObject({ completed: many(z.string().max(100), CASE_LIMITS.progress, "進み具合の記録").optional(), formsKey: z.string().max(100).optional() }).optional(),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    for (const p of c.persons) {
      if (ids.has(p.id)) {
        ctx.addIssue({ code: "custom", message: DUPLICATE_PERSON });
        return;
      }
      ids.add(p.id);
    }
    // 代わりに相続する相手（被代襲者）は、一覧にいる別の人でなければならない
    const parent = new Map<string, string>();
    for (const p of c.persons) {
      if (!p.substituteOf) continue;
      if (p.substituteOf === p.id || !ids.has(p.substituteOf)) {
        ctx.addIssue({ code: "custom", message: MISSING_PARENT });
        return;
      }
      parent.set(p.id, p.substituteOf);
    }
    // 親をたどって自分に戻る（A は B の代わり、B は A の代わり など）つながりを断る
    for (const p of c.persons) {
      let cur = parent.get(p.id);
      for (let steps = 0; cur; steps++) {
        if (cur === p.id || steps > c.persons.length) {
          ctx.addIssue({ code: "custom", message: PARENT_LOOP });
          return;
        }
        cur = parent.get(cur);
      }
    }
  });

/** 画面向けの日本語の説明だけを見せる（ライブラリの英語のメッセージは見せない） */
const JAPANESE = /[぀-ヿ一-鿿]/;

export type CaseCheck = { ok: true; data: Case } | { ok: false; error: string };

/** 送られた相続の入力を確かめる。問題がなければ、送られたものをそのまま Case として返す */
export function checkCase(input: unknown): CaseCheck {
  const r = caseSchema.safeParse(input);
  if (r.success) return { ok: true, data: input as Case };
  const issue = r.error.issues.find((i) => JAPANESE.test(i.message));
  return { ok: false, error: issue?.message ?? SHAPE_ERROR };
}
