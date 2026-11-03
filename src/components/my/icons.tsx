import { House, Landmark, Paperclip, Receipt, TrendingUp, Umbrella, Users, type LucideIcon } from "lucide-react";
import type { DocCategory } from "@/domain/procedures/documents";

const CAT: Record<DocCategory, LucideIcon> = { "戸籍・住民票": Users, 預貯金: Landmark, 不動産: House, 保険: Umbrella, 株式: TrendingUp, "年金・税金": Receipt, その他: Paperclip };

export function CatIcon({ k, className = "h-6 w-6" }: { k: DocCategory; className?: string }) {
  const I = CAT[k];
  return <I className={`text-brand ${className}`} aria-hidden strokeWidth={1.75} />;
}
