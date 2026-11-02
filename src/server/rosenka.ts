/** 路線価図PDFの中継先チェック */
const ALLOWED_HOST = "www.rosenka.nta.go.jp";
export const MAX_SHEET_BYTES = 20 * 1024 * 1024;

export function checkSheetUrl(raw: string | null): URL | string {
  if (!raw) return "URLを指定してください。";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "URLの形式が正しくありません。";
  }
  if (u.protocol !== "https:" || u.hostname !== ALLOWED_HOST || u.port || u.username || u.password) {
    return "国税庁の路線価図（https://www.rosenka.nta.go.jp/ ）のURLを指定してください。";
  }
  if (!/\.(pdf|jpe?g|png|gif)$/i.test(u.pathname)) return "路線価図のPDFのURLを指定してください。";
  return u;
}

