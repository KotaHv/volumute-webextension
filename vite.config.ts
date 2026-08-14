import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import webExtension, { readJsonFile } from "vite-plugin-web-extension";

const target = process.env.VOLUMUTE_TARGET ?? "chrome";

function generateManifest(): Record<string, unknown> {
  const manifest = readJsonFile("src/manifest.json");
  const pkg = readJsonFile("package.json");
  return {
    ...manifest,
    version: pkg.version,
  };
}

export default defineConfig({
  plugins: [
    svelte(),
    webExtension({
      manifest: generateManifest,
      browser: target,
    }),
  ],
  build: {
    outDir: `dist/${target}`,
    emptyOutDir: true,
    modulePreload: false,
  },
});
