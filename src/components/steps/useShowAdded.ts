"use client";

import { useEffect, useState } from "react";
import { scrollBelowHeader } from "@/components/ui/scroll";

/** 追加したカードを囲む要素の id（ページの中のほかの id と重ならないよう、前に付ける） */
export const addedAnchor = (id: string) => `added-${id}`;

/**
 * 追加したカードを、上に固定した見出しのすぐ下に出す（スマートフォンでは一覧のずっと下に足されて、押しても何も起きないように見えるため）。
 * 最初の入力欄に入力できるようにする（画面はこちらで送るので、入力欄からは送らない）。
 * 返す関数に、追加したものの id を渡す。カードが描かれるまで待つので、watch には一覧を渡す
 */
export function useShowAdded(watch: unknown): (id: string) => void {
  const [added, setAdded] = useState<string | null>(null);
  useEffect(() => {
    if (!added) return;
    const el = document.getElementById(addedAnchor(added));
    if (!el) return;
    scrollBelowHeader(el);
    el.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    setAdded(null);
  }, [added, watch]);
  return setAdded;
}
