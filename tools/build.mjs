// Bouwt de publiceerbare versie in docs/ (GitHub Pages): één geminificeerde bundel.
// Gebruik: node tools/build.mjs <pad-naar-esbuild-module>
import fs from 'node:fs';
import path from 'node:path';
const esbuildPath = process.argv[2];
const esbuild = await import(esbuildPath);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'docs');
const v = Date.now().toString(36);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const threePlugin = {
  name: 'three-vendor',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: path.join(root, 'vendor/three.module.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: path.join(root, 'vendor/addons', a.path.slice('three/addons/'.length)) }));
  },
};
await esbuild.build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true, minify: true, format: 'esm', target: ['es2020', 'safari15'],
  outfile: path.join(out, 'game.js'), plugins: [threePlugin], legalComments: 'eof',
  define: { __BUILD__: JSON.stringify(v) },
});
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
html = html.replace('<script type="module" src="src/main.js"></script>', `<script type="module" src="game.js?v=${v}"></script>`);
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.cpSync(path.join(root, 'assets'), path.join(out, 'assets'), { recursive: true });
fs.copyFileSync(path.join(root, 'manifest.webmanifest'), path.join(out, 'manifest.webmanifest'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ v }));
const kb = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KB';
console.log('game.js', kb('game.js'), '· versie', v);
