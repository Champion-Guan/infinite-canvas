export const APP_VERSION = __APP_VERSION__ || "dev";

/** Human-facing version label. Keep the raw SemVer for update comparisons. */
export function formatDisplayVersion(version: string | null | undefined) {
    if (!version) return "v—";
    return version === "dev" ? "vdev" : `v${version.replace(/^v/, "")}`;
}

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";
