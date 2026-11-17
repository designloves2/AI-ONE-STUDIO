// Fills src-tauri/bundle/ with what the desktop app carries: the Node runtime, the server and the built page.
//   node scripts/prepare-app.mjs        (run `npm run build` first)
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('src-tauri/bundle');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync('dist/index.html')) throw new Error('dist/ is missing: run npm run build first');
fs.copyFileSync(process.execPath, path.join(out, 'node.exe'));
fs.copyFileSync('serve.mjs', path.join(out, 'serve.mjs'));
fs.copyFileSync('comfy_paths.json', path.join(out, 'comfy_paths.json'));
fs.cpSync('server-lib', path.join(out, 'server-lib'), { recursive: true });
fs.cpSync('dist', path.join(out, 'dist'), { recursive: true });
fs.rmSync(path.join(out, 'dist', 'comfy_port.txt'), { force: true });   // this PC's ComfyUI port must not travel inside the installer
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ type: 'module' }));   // serve.mjs is an ES module
// the app version follows package.json (tauri.conf.json and Cargo.toml are kept in step)
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
for (const [f, re, rep] of [['src-tauri/tauri.conf.json', /"version": "[^"]+"/, `"version": "${version}"`], ['src-tauri/Cargo.toml', /^version = "[^"]+"/m, `version = "${version}"`]]) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(re, rep));
console.log('bundle ready:', out, version);
