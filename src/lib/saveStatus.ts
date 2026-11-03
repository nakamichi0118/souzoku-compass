/** 保存に失敗したことを画面に知らせる（通信の失敗・容量不足など） */
export const SAVE_FAILED = "souzoku-compass:save-failed";

/**
 * 失敗の種類。
 * - network：通信が切れた・容量が足りないなど（次の書き込みで送り直す）
 * - auth：ログインの期限が切れていて、サーバーが受け付けない（送り直しても届かない）
 * - leaving：保存できなかったため、ログアウトやデモへの切り替えを取りやめた
 */
export type SaveFailure = "network" | "auth" | "leaving";

export function reportSaveFailure(kind: SaveFailure = "network") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<SaveFailure>(SAVE_FAILED, { detail: kind }));
}
