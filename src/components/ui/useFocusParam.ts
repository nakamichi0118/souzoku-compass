"use client";

import { useEffect } from "react";
import { focusMark } from "./scroll";

/**
 * 画面を開いたときのアドレスの ?focus=id（計算を止めている事項の「直す」リンクから来たとき）を読み、
 * その印（data-focus）の行へ送って目立たせる。読んだら ?focus は消す（再読み込みで何度も動かないように）
 */
export function useFocusParam(ready = true) {
  useEffect(() => {
    if (!ready) return;
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get("focus");
    if (!id) return;
    sp.delete("focus");
    const q = sp.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    void focusMark(id);
  }, [ready]);
}
