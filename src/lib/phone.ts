/**
 * 電話番号を申告書の3つの枠（市外局番・市内局番・加入者番号）に分ける。
 * ハイフンや空白で区切ってあればその区切りで、区切りがなければ桁数と先頭の番号から分ける。
 * 固定電話の市外局番は2〜5桁とまちまちなので、区切りがない10桁は 03・06 だけ 2-4-4、ほかは 3-3-4 とみなす（画面で直せる）
 */
export function phoneParts(v: string | undefined): [string, string, string] {
  const s = (v ?? "").normalize("NFKC").trim();
  if (!s) return ["", "", ""];
  // 画面の3つの枠から保存した形（途中の枠が空でもずらさない）
  const saved = s.match(/^(\d*)-(\d*)-(\d*)$/);
  if (saved) return [saved[1], saved[2], saved[3]];
  const parts = s.split(/[^\d]+/).filter(Boolean);
  if (parts.length >= 3) return [parts[0], parts[1], parts.slice(2).join("")];
  if (parts.length === 2) return [parts[0], parts[1], ""];
  return splitDigits(parts[0] ?? "");
}

function splitDigits(d: string): [string, string, string] {
  const at = (a: number, b: number): [string, string, string] => [d.slice(0, a), d.slice(a, a + b), d.slice(a + b)];
  if (d.length === 11 && /^0[2-9]0/.test(d)) return at(3, 4); // 携帯・IP電話など（090-1234-5678）
  if (d.length >= 10 && /^0(120|800|570)/.test(d)) return at(4, 3); // フリーダイヤル・ナビダイヤル
  if (d.length === 10 && /^0[36]/.test(d)) return at(2, 4); // 東京・大阪
  if (d.length === 10) return at(3, 3);
  return [d, "", ""];
}

/** 3つの欄を1つの文字列にして保存する（空の欄が後ろにあれば落とす） */
export function joinPhone(parts: string[]): string {
  const p = parts.map((x) => x.normalize("NFKC").replace(/[^\d]/g, ""));
  while (p.length && !p[p.length - 1]) p.pop();
  return p.join("-");
}
