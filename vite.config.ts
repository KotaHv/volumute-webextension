import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import webExtension, { readJsonFile } from "vite-plugin-web-extension";

const target = process.env.VOLUMUTE_TARGET ?? "chrome";
const isRelease = process.env.VOLUMUTE_RELEASE === "1";

function makeStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const stamp = isRelease ? "" : makeStamp();
if (stamp) console.log(`[VoluMute] build stamp: ${stamp}`);

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
  define: {
    __BUILD_STAMP__: JSON.stringify(stamp),
  },
  build: {
    outDir: `dist/${target}`,
    emptyOutDir: true,
    modulePreload: false,
  },
});
