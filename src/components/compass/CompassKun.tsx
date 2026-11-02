/* eslint-disable @next/next/no-img-element */
/** 案内役キャラクター「コンパスくん」（中身は Claude） */
export function CompassKun({ className = "" }: { className?: string }) {
  return <img src="/brand/compass-kun-main.png" alt="コンパスくん" className={className} width={240} height={273} />;
}

export function CompassAvatar({ size = 40 }: { size?: number }) {
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
