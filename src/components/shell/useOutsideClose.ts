"use client";

import { useEffect } from "react";

/**
 * 開いている間、外側を押したら（または Esc で）閉じる。setOpen は useState の更新関数をそのまま渡す。
 * iPhone の Safari では、押せない場所を押したときに mousedown が届かないことがあるため pointerdown で見る
 */
export function useOutsideClose(open: boolean, ref: React.RefObject<HTMLElement | null>, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, setOpen]);
}
