// Builds the loadable extension into dist/ from the sources in extension/.
//
//   node build.mjs            one-off dev build (inline source maps)
//   node build.mjs --watch    rebuild on change
//   node build.mjs --release  no source maps, minified
//   node build.mjs --zip      also package dist/ for a GitHub release
//
// Why a bundler at all: a MAIN-world content script is loaded as a *classic*
// script, so it cannot use `import`, and it has no chrome.* so it cannot use
// the dynamic-import(chrome.runtime.getURL(...)) workaround either. Bundling
// is the only way to share code with it. See ARCHITECTURE.md.

import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const release = args.has('--release');

const OUT = 'dist';
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));

// Output names are referenced by manifest.json, so they must stay stable —
// never add content hashing here.
const ENTRIES = [
  // Classic content scripts: iife, because the browser does not load these as
  // modules. Any `import` surviving into these files is a runtime error.
  { in: 'extension/src/inject/main-world.js', out: 'main-world', format: 'iife' },
  { in: 'extension/src/content/content.js', out: 'content', format: 'iife' },
  // manifest declares "type": "module" for the worker, and options.html loads
  // options.js with type="module" — a format mismatch here fails silently.
  { in: 'extension/src/background/service-worker.js', out: 'service-worker', format: 'esm' },
  { in: 'extension/options.js', out: 'options', format: 'esm' },
];

const shared = {
  bundle: true,
  target: 'chrome120',
  platform: 'browser',
  // External .js.map files are commonly 404'd from chrome-extension:// URLs,
  // so keep maps inline during development and drop them for release.
  sourcemap: release ? false : 'inline',
  minify: release,
  logLevel: 'info',
};

function copyStatic() {
  mkdirSync(OUT, { recursive: true });
  for (const file of ['manifest.json', 'options.html']) {
    cpSync(`extension/${file}`, `${OUT}/${file}`);
  }
}

async function build() {
  rmSync(OUT, { recursive: true, force: true });
  copyStatic();
  await Promise.all(ENTRIES.map((e) => esbuild.build({
    ...shared,
    entryPoints: [e.in],
    outfile: `${OUT}/${e.out}.js`,
    format: e.format,
  })));
}

if (watch) {
  copyStatic();
  const contexts = await Promise.all(ENTRIES.map((e) => esbuild.context({
    ...shared,
    entryPoints: [e.in],
    outfile: `${OUT}/${e.out}.js`,
    format: e.format,
  })));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log(`watching — load ${OUT}/ as an unpacked extension, reload after each rebuild`);
} else {
  await build();
  console.log(`built ${OUT}/ (v${manifest.version}${release ? ', release' : ', dev'})`);
  if (args.has('--zip')) {
    const name = `leetlens-${manifest.version}.zip`;
    rmSync(name, { force: true });
    execFileSync('zip', ['-qr', `../${name}`, '.'], { cwd: OUT });
    console.log(`packaged ${name}`);
  }
}
