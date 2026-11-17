// Publishes the desktop installer of the current version to its GitHub release and writes latest.json (what the app's updater reads).
//   1. npm run app:build   (with TAURI_SIGNING_PRIVATE_KEY / _PASSWORD set; see docs/DESKTOP_APP.md)
//   2. the release vX.Y.Z must exist (gh release create ...)
//   3. node scripts/release-app.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const dir = path.resolve('src-tauri/target/release/bundle/nsis');
const setup = fs.readdirSync(dir).find((f) => f.endsWith(`${version}_x64-setup.exe`));
if (!setup) throw new Error(`no ${version} installer in ${dir}: run npm run app:build`);
const sig = fs.readFileSync(path.join(dir, `${setup}.sig`), 'utf8').trim();

// a name without spaces (GitHub rewrites spaces in asset names)
const name = `AI-ONE-STUDIO_${version}_x64-setup.exe`;
const out = path.resolve('src-tauri/target/release/upload'); fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(dir, setup), path.join(out, name));
const repo = 'designloves2/AI-ONE-STUDIO';
const latest = {
  version,
  notes: `AI ONE STUDIO ${version}`,
  pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature: sig, url: `https://github.com/${repo}/releases/download/v${version}/${name}` } },
};
fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify(latest, null, 2));
execFileSync('gh', ['release', 'upload', `v${version}`, path.join(out, name), path.join(out, 'latest.json'), '--clobber', '--repo', repo], { stdio: 'inherit' });
console.log(`uploaded ${name} + latest.json to v${version}`);
