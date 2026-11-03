/** 作ったファイル（PDF・カレンダー・バックアップなど）を、この端末に保存させる */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // すぐに消すと保存が始まらないブラウザがあるので、少し待ってから消す
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
