/** 保存に失敗したことを画面に知らせる（通信の失敗・容量不足など） */
export const SAVE_FAILED = "souzoku-compass:save-failed";
export function reportSaveFailure() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SAVE_FAILED));
}
