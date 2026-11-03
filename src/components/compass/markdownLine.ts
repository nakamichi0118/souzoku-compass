/**
 * コンパスくんの回答（簡単なマークダウン）の1行が、見出し・箇条書き・番号付き・ふつうの文のどれかを見分ける。
 * 画面に出す部分（Markdown.tsx）から切り出し、テストできるようにしている。
 */
export type MarkdownLine =
  | { kind: "blank" }
  | { kind: "heading"; text: string }
  | { kind: "item"; ordered: boolean; text: string }
  | { kind: "text"; text: string };

export function classifyLine(raw: string): MarkdownLine {
  const line = raw.trim();
  if (!line) return { kind: "blank" };
  const h = line.match(/^#{1,4}\s+(.*)$/);
  if (h) return { kind: "heading", text: h[1] };
  const ul = line.match(/^[-*・]\s+(.*)$/);
  if (ul) return { kind: "item", ordered: false, text: ul[1] };
  // 「1.5倍」のような小数で始まる行は番号付きの箇条書きとみなさない（整数の部分が消えてしまうため）
  const ol = line.match(/^\d+[.)．](?!\d)\s*(.*)$/);
  if (ol) return { kind: "item", ordered: true, text: ol[1] };
  return { kind: "text", text: line };
}
