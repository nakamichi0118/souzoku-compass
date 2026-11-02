/** 端数処理（国税通則法118条・119条、相続税申告書の記載要領に基づく） */

/** 指定単位未満を切り捨てる。負数は0とする（課税価格等はマイナスにならない） */
export function floorTo(yen: number, unit: number): number {
  if (!Number.isFinite(yen)) throw new Error("not finite");
  if (yen <= 0) return 0;
  return Math.floor(yen / unit) * unit;
}

/** 課税標準（課税価格）は1,000円未満切捨て（通則法118条1項） */
export const floor1000 = (yen: number) => floorTo(yen, 1000);
/** 確定金額（納付税額）は100円未満切捨て（通則法119条1項） */
export const floor100 = (yen: number) => floorTo(yen, 100);
