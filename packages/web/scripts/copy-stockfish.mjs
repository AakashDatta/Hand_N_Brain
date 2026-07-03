/**
 * Stage the Stockfish WASM engine into public/ so the browser can load it as
 * a Web Worker. The engine ships in node_modules and is intentionally NOT
 * committed to the repo (it is a ~7MB binary, GPLv3-licensed); this script
 * runs on postinstall and before dev/build to keep public/engine/ in sync.
 *
 * We use the "lite single-threaded" flavor: small (~7MB), strong enough to
 * outplay any human, and it runs without cross-origin-isolation headers, so
 * the app works on any static host.
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Resolve through Node so this works regardless of npm workspace hoisting.
const require = createRequire(import.meta.url);
const sourceDir = join(dirname(require.resolve('stockfish/package.json')), 'bin');
const targetDir = join(packageRoot, 'public', 'engine');

// The .js worker script derives its sibling .wasm path from its own URL, so
// both files must keep this exact name and live in the same directory.
const files = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'];

mkdirSync(targetDir, { recursive: true });

for (const file of files) {
  const source = join(sourceDir, file);
  const target = join(targetDir, file);
  if (!existsSync(source)) {
    console.error(`copy-stockfish: missing ${source} — run npm install first.`);
    process.exit(1);
  }
  const upToDate =
    existsSync(target) && statSync(target).size === statSync(source).size;
  if (!upToDate) {
    copyFileSync(source, target);
    console.log(`copy-stockfish: staged ${file}`);
  }
}
