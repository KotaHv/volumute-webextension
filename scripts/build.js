import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import archiver from 'archiver';
import process from 'process';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targets = process.argv[2] ? [process.argv[2]] : ['chrome', 'firefox'];

async function zipDir(srcDir, zipPath) {
  fs.rmSync(zipPath, { force: true });
  const out = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const done = new Promise((resolveZip, reject) => {
    out.on('close', resolveZip);
    archive.on('error', reject);
  });
  archive.pipe(out);
  archive.directory(srcDir, false);
  await archive.finalize();
  await done;
}

for (const target of targets) {
  if (target !== 'chrome' && target !== 'firefox') {
    console.error(`Unknown target: ${target}`);
    process.exit(1);
  }
  console.log(`\n=== Building ${target} ===`);
  const r = spawnSync('pnpm', ['vite', 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VOLUMUTE_TARGET: target },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);

  const zipPath = path.resolve(root, 'dist', `volumute-${target}.zip`);
  await zipDir(path.resolve(root, 'dist', target), zipPath);
  console.log(`Packaged -> ${zipPath}`);
}

console.log('\nDone -> dist/{chrome,firefox} + volumute-{chrome,firefox}.zip');
