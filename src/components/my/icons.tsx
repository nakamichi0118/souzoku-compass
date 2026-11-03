import { Banknote, Briefcase, Building2, HandCoins, House, LandPlot, Landmark, Package, Paperclip, Receipt, Sofa, TrendingUp, Umbrella, Users, type LucideIcon } from "lucide-react";
import type { AssetKind } from "@/domain/types";
import type { DocCategory } from "@/domain/procedures/documents";

const CAT: Record<DocCategory, LucideIcon> = { "戸籍・住民票": Users, 預貯金: Landmark, 不動産: House, 保険: Umbrella, 株式: TrendingUp, "年金・税金": Receipt, その他: Paperclip };

export function CatIcon({ k, className = "h-6 w-6" }: { k: DocCategory; className?: string }) {
  const I = CAT[k];
  return <I className={`text-brand ${className}`} aria-hidden strokeWidth={1.75} />;
}

const ASSET: Record<AssetKind, LucideIcon> = {
  deposit: Landmark,
  cash: Banknote,
  land: LandPlot,
  building: House,
  condo: Building2,
  listedStock: TrendingUp,
  unlistedStock: Briefcase,
  insurance: Umbrella,
  retirement: HandCoins,
  household: Sofa,
  other: Package,
};

export function AssetIcon({ k, className = "h-5 w-5" }: { k: AssetKind; className?: string }) {
  const I = ASSET[k];
  return <I className={`text-brand ${className}`} aria-hidden strokeWidth={1.75} />;
}
