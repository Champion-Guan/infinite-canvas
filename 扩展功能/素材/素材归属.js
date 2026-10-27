// Unassigned assets stay accessible without assigning them to an arbitrary product.
export function assetInScope(asset, projectId, scope = "product") {
    const shared = asset.metadata?.source === "prompt-library";
    const owner = asset.metadata?.projectId;
    if (scope === "unassigned") return !owner && !shared;
    // Standalone image/video workbenches have no product id and retain the legacy all-assets view.
    return !projectId || owner === projectId || shared;
}
