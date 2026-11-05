/* eslint-disable @next/next/no-img-element */
/** 案内役キャラクター「コンパスくん」（中身は Claude） */
export function CompassKun({ className = "" }: { className?: string }) {
  return <img src="/brand/compass-kun-main.png" alt="コンパスくん" className={className} width={220} height={280} />;
}

/** thinking：待っている間、首をかしげながら小さく揺れる（動きを減らす設定では動かさない） */
/**
 * コンパスくんの顔。thinking のときは動くコンパスくん（8コマ）にする。
 * true / "typing" = パソコンで作業中（読み込み・探す・読み取りなど）、"blink" = まばたきしながら考え中（回答を書いているとき）
 */
export function CompassAvatar({ size = 40, thinking = false }: { size?: number; thinking?: boolean | "typing" | "blink" }) {
  if (thinking) {
    const kind = thinking === "blink" ? "blink" : "typing";
    return (
      <span
        role="img"
        aria-label="コンパスくん（作業中）"
        className={`kun-sprite kun-${kind} shrink-0`}
        style={{ width: size, height: size, backgroundImage: `url(/brand/kun-${kind}.webp)` }}
      />
    );
  }
  return (
    <img
      src="/brand/mascot-chat-reference.png"
      alt="コンパスくん"
      width={size}
      height={size}
      className="shrink-0 rounded-full border-2 border-white bg-sky-50 object-cover object-top shadow-sm"
      style={{ width: size, height: size }}
    />
  );
}

export function LogoMark({ size = 32 }: { size?: number }) {
  return <img src="/brand/compass-logo-mark.png" alt="" width={size} height={size} style={{ width: size, height: size }} className="shrink-0" />;
}

/** コンパスくんの吹き出し */
export function Bubble({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm leading-relaxed text-stone-800 shadow-sm ${className}`}>
      <span className="absolute -left-2 top-4 h-4 w-4 rotate-45 border-b border-l border-sky-100 bg-white" aria-hidden />
      <div className="relative">{children}</div>
    </div>
  );
}
