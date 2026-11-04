/** 相談のフォーム・やりとり・打ち合わせの案内の、入力の確認と保存 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PREFECTURES, isStaffEmail } from "@/data/consultFirm";
import type { PublicUser } from "@/server/auth/auth";
import { type ConsultRecord, getConsultDb } from "./store";

export const NewConsult = z.object({
  name: z.string().trim().min(1, "お名前を入れてください。").max(50, "お名前は50文字までです。"),
  prefecture: z.enum(PREFECTURES, { error: "都道府県を選んでください。" }),
  contact: z.string().trim().min(1, "連絡先（電話番号かメールアドレス）を入れてください。").max(100, "連絡先は100文字までです。"),
  content: z.string().trim().min(1, "相談内容を入れてください。").max(4000, "相談内容は4,000文字までです。"),
});

export const NewMessage = z.object({ text: z.string().trim().min(1, "メッセージを入れてください。").max(2000, "メッセージは2,000文字までです。") });

export const Meeting = z.object({
  url: z
    .string()
    .trim()
    .max(500)
    .refine((u) => u === "" || /^https:\/\/[^\s]+$/.test(u), "打ち合わせのURLは https:// で始まるものを入れてください。"),
  at: z.string().trim().max(40).optional(),
  note: z.string().trim().max(500).optional(),
});

export const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "入力が正しくありません。";

/** 利用者に見せる形（相手の内部の項目は出さない） */
export const view = (r: ConsultRecord, staff: boolean) => {
  const seen = staff ? r.firmSeenAt : r.userSeenAt;
  const other = staff ? "user" : "firm";
  const unread = r.messages.filter((m) => m.from === other && (!seen || m.at > seen)).length + (staff && !r.firmSeenAt ? 1 : 0);
  const { userId: _u, ...rest } = r;
  return { ...rest, unread };
};

export async function createConsult(user: PublicUser, input: z.infer<typeof NewConsult>) {
  const now = new Date().toISOString();
  const r: ConsultRecord = { id: randomUUID(), userId: user.id, userEmail: user.email, ...input, createdAt: now, updatedAt: now, userSeenAt: now, messages: [] };
  await (await getConsultDb()).create(r);
  return r;
}

/** 本人か事務所の人だけが読める */
export async function readable(user: PublicUser, id: string) {
  const r = await (await getConsultDb()).get(id);
  if (!r) return null;
  if (r.userId !== user.id && !isStaffEmail(user.email)) return null;
  return r;
}

export async function addMessage(user: PublicUser, id: string, text: string) {
  const r = await readable(user, id);
  if (!r) return null;
  const staff = isStaffEmail(user.email) && r.userId !== user.id;
  const now = new Date().toISOString();
  return (await getConsultDb()).update(id, (x) => ({
    ...x,
    messages: [...x.messages, { from: staff ? ("firm" as const) : ("user" as const), text, at: now }].slice(-300),
    updatedAt: now,
    ...(staff ? { firmSeenAt: now } : { userSeenAt: now }),
  }));
}

export async function markSeen(user: PublicUser, id: string) {
  const r = await readable(user, id);
  if (!r) return null;
  const staff = isStaffEmail(user.email) && r.userId !== user.id;
  const now = new Date().toISOString();
  return (await getConsultDb()).update(id, (x) => (staff ? { ...x, firmSeenAt: now } : { ...x, userSeenAt: now }));
}

export async function setMeeting(user: PublicUser, id: string, m: z.infer<typeof Meeting>) {
  if (!isStaffEmail(user.email)) return null;
  const now = new Date().toISOString();
  return (await getConsultDb()).update(id, (x) => ({
    ...x,
    meeting: m.url ? { url: m.url, at: m.at || undefined, note: m.note || undefined } : undefined,
    messages: m.url ? [...x.messages, { from: "firm" as const, text: `打ち合わせの案内を送りました${m.at ? `（${m.at}）` : ""}。`, at: now }] : x.messages,
    updatedAt: now,
    firmSeenAt: now,
  }));
}
