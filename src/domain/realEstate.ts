/** 不動産（土地・建物・マンション）かどうかの判定。あちこちで同じ条件を書かないよう、ここにまとめる */
import type { Asset, BuildingAsset, CondoAsset, LandAsset } from "./types";

export type RealEstateAsset = LandAsset | BuildingAsset | CondoAsset;

export const REAL_ESTATE_KINDS = ["land", "building", "condo"] as const satisfies readonly Asset["kind"][];

export const isRealEstate = (a: Asset): a is RealEstateAsset => a.kind === "land" || a.kind === "building" || a.kind === "condo";

export const hasRealEstate = (assets: readonly Asset[]) => assets.some(isRealEstate);
