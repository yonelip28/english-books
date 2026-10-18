import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

// Static files that already live in the repo root (next to index.html) and must
// be served from the site root exactly as before. Whichever of them exist are
// copied into dist/ after the build.
const ROOT_STATIC_FILES = [
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "push-sw.js",
  "badge-96.png",
  "_headers",
  "_headers.txt",
  "_redirects",
];

function copyRootStaticFiles() {
  return {
    name: "copy-root-static-files",
    apply: "build",
    closeBundle() {
      mkdirSync("dist", { recursive: true });
      for (const f of ROOT_STATIC_FILES) if (existsSync(f)) copyFileSync(f, "dist/" + f);
    },
  };
}

export default defineConfig({
  // "classic" = React.createElement, exactly what the in-browser Babel setup produced.
  plugins: [react({ jsxRuntime: "classic" }), copyRootStaticFiles()],
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 8000, // one big app file; this is expected
  },
});
