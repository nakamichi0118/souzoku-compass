import type { DeemedAsset } from "./types";

export interface ReceiptShare {
  personId: string;
  amount: number;
}

/** 2人目以降として入っている行（人を選んでいない行も含む） */
export const otherRecipients = (a: DeemedAsset): ReceiptShare[] => (Array.isArray(a.otherRecipients) ? a.otherRecipients : []);

const yenOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * 死亡保険金・死亡退職金を、受け取った人ごとの金額に分ける。
 * 2人目以降は入れた金額、1人目（代表の受取人）は total から2人目以降の分を引いた残り。
 * 同じ人が何度か入っていればまとめ、金額が0の人は外す。人を選んでいない行は数えない
 */
export function receiptShares(a: DeemedAsset, total = a.amount): ReceiptShare[] {
  const out: ReceiptShare[] = [];
  const add = (personId: string, amount: number) => {
    if (!personId || amount <= 0) return;
    const e = out.find((s) => s.personId === personId);
    if (e) e.amount += amount;
    else out.push({ personId, amount });
  };
  const others = otherRecipients(a).filter((o) => o?.personId);
  const othersSum = others.reduce((s, o) => s + yenOf(o.amount), 0);
  add(a.recipientId, Math.max(0, yenOf(total) - othersSum));
  for (const o of others) add(o.personId, yenOf(o.amount));
  return out;
}

/** 2人目以降の金額の合計が受取金額を超えていれば、その超えた額（0なら問題なし） */
export function receiptOver(a: DeemedAsset): number {
  const othersSum = otherRecipients(a)
    .filter((o) => o?.personId)
    .reduce((s, o) => s + yenOf(o.amount), 0);
  return Math.max(0, othersSum - yenOf(a.amount));
}

/** この保険金・退職金を受け取る人（1人目と2人目以降）のID */
export const recipientIds = (a: DeemedAsset): string[] => [a.recipientId, ...otherRecipients(a).map((o) => o.personId)].filter(Boolean);
