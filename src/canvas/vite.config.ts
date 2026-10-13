import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { parseChangelog } from "./lib/release";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
let sourceAtBuildStart: string;

export default defineConfig({
    plugins: [react(), {
        name: "guan-canvas-build-manifest",
        apply: "build",
        async buildStart() {
            const { canvasSourceFingerprint } = await import(new URL("../../scripts/lib/canvas-build.mjs", import.meta.url).href);
            sourceAtBuildStart = await canvasSourceFingerprint(projectRoot);
        },
        async closeBundle() {
            const { canvasSourceFingerprint, writeCanvasBuildManifest } = await import(new URL("../../scripts/lib/canvas-build.mjs", import.meta.url).href);
            if (await canvasSourceFingerprint(projectRoot) !== sourceAtBuildStart) throw new Error("Source changed during build; build again");
            await writeCanvasBuildManifest(projectRoot, fileURLToPath(new URL("./dist/", import.meta.url)));
        },
    }],
    css: {
        postcss: {
            plugins: [tailwindcss()],
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(version),
        __APP_RELEASES__: JSON.stringify(parseChangelog(readFileSync(new URL("../../docs/RELEASE-NOTES.md", import.meta.url), "utf8")).slice(0, 20)),
    },
    resolve: {
        alias: {
            "@": fileURLToPath(new URL(".", import.meta.url)),
        },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
});
