/**
 * コンパスくんの回答の簡単なマークダウン（見出し・段落・箇条書き・番号付き・太字・リンク）を表示する。
 * HTML としては解釈せず、React の要素として組み立てる。
 */
import { Fragment } from "react";

function inline(text: string, key: string) {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${key}-${i++}`} className="font-bold text-sky-950">{m[1]}</strong>);
    else if (m[2])
      out.push(
        <a key={`${key}-${i++}`} href={m[3]} target="_blank" rel="noreferrer" className="text-sky-800 underline">
          {m[2]}
        </a>,
      );
    else out.push(<code key={`${key}-${i++}`} className="rounded bg-stone-100 px-1">{m[4]}</code>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(""), `p${blocks.length}`)}</p>);
    para = [];
    if (list) {
      const L = list.ordered ? "ol" : "ul";
      blocks.push(
        <L key={`l${blocks.length}`} className={`${list.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>
          {list.items.map((it, j) => (
            <li key={j}>{inline(it, `l${blocks.length}-${j}`)}</li>
          ))}
        </L>,
      );
    }
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const h = line.match(/^#{1,4}\s+(.*)$/);
    const ul = line.match(/^[-*・]\s+(.*)$/);
    const ol = line.match(/^\d+[.)．]\s*(.*)$/);
    if (!line) flush();
    else if (h) {
      flush();
      blocks.push(
        <p key={`h${blocks.length}`} className="font-bold text-sky-950">
          {inline(h[1], `h${blocks.length}`)}
        </p>,
      );
    } else if (ul || ol) {
      if (para.length) {
        const p = para;
        para = [];
        blocks.push(<p key={`p${blocks.length}`}>{inline(p.join(""), `p${blocks.length}`)}</p>);
      }
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return <div className="space-y-2 leading-relaxed">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
