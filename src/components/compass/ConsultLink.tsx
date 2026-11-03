import { UserRound } from "lucide-react";
import Link from "next/link";

/** 判断が難しいところから、税理士への相談の案内ページへ */
export function ConsultLink({ topic, className = "" }: { topic?: string; className?: string }) {
  return (
    <Link
      href={`/consult${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-brand bg-white px-3 py-1.5 text-sm font-semibold text-brand hover:bg-brand-soft ${className}`}
    >
      <UserRound className="h-4 w-4" aria-hidden />
      税理士に相談する
    </Link>
  );
}
