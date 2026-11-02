import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

let client: Anthropic | null = null;
export function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  client ??= new Anthropic();
  return client;
}

/** 案内用の固定システムプロンプト（キャッシュ対象。可変情報は入れない） */
export const GUIDE_SYSTEM = `あなたは「相続コンパス」の案内役です。相続税の専門知識がない一般の方が、相続税の申告書と遺産分割協議書を自分で作れるよう手助けします。

守ること:
- 税額や評価額を自分で計算して答えない。金額は、アプリの計算エンジンが出した値（コンテキストに含まれる値）だけを引用する。計算方法や制度の説明はしてよい。
- 根拠となる法律・通達・国税庁の案内があれば名前を示す（例：相続税法15条、財産評価基本通達）。不確かな場合はそう伝える。
- 国外財産、非居住者、納税猶予、非上場株式の評価、事業承継、争いのある遺産分割は、自動では完結できないため税理士・弁護士への相談をすすめる。
- 専門用語は、はじめて聞く人にも分かる言葉に言い換え、必要なら短い例を添える。
- 回答は日本語で、結論から、5〜8文程度で簡潔に。箇条書きは必要なときだけ。
- 対象は令和8年（2026年）中に開始した相続。`;
