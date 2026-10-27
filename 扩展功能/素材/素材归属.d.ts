import type { Asset } from "@/stores/use-asset-store";
export type AssetScope = "product" | "unassigned";
export function assetInScope(asset: Asset, projectId?: string, scope?: AssetScope): boolean;
