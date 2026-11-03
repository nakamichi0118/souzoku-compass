/** 保存に失敗したことを画面に知らせる（通信の失敗・容量不足など） */
export const SAVE_FAILED = "souzoku-compass:save-failed";
/** 送れなかった入力を、あとから送り終えたことを画面に知らせる */
export const SAVE_RECOVERED = "souzoku-compass:save-recovered";

/**
 * 失敗の種類。
 * - network：通信が切れた・容量が足りないなど（次の書き込みで送り直す）
 * - auth：ログインの期限が切れていて、サーバーが受け付けない（同じ人がもう一度ログインしたら送る）
 * - leaving：保存できなかったため、ログアウトやデモへの切り替えを取りやめた
 * - switched：別のタブで別の人がログインした・デモに切り替えた（このタブの入力はもう保存しない）
 */
export type SaveFailure = "network" | "auth" | "leaving" | "switched";

export function reportSaveFailure(kind: SaveFailure = "network") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<SaveFailure>(SAVE_FAILED, { detail: kind }));
}

export function reportSaveRecovered() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SAVE_RECOVERED));
}
