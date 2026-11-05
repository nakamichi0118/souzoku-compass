"use client";

import Link from "next/link";
import { Note } from "@/components/ui";
import type { Case } from "@/domain/types";
import { fixTarget } from "@/lib/fixLink";

/**
 * 計算を止めている事項の一覧。1件ずつ、直す場所へのリンク（その行まで送って目立たせる）を添える。
 * 税理士への相談をすすめる事項には、相談の画面へのリンクも出す
 */
export function BlockerList({ data, blockers, tone = "stop" }: { data: Case; blockers: string[]; tone?: "stop" | "warn" }) {
  if (blockers.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="blockers">
      {blockers.map((b, i) => {
        const t = fixTarget(data, b);
        return (
          <Note key={`${i}:${b}`} tone={tone}>
            <p>{b}</p>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <Link href={t.href} className="font-semibold underline">
                {t.label} ›
              </Link>
              {t.consult && (
                <Link href="/consult" className="font-semibold underline">
                  税理士に相談する ›
                </Link>
              )}
            </p>
          </Note>
        );
      })}
    </div>
  );
}
