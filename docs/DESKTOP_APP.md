# Desktop app (Tauri) - how AI ONE STUDIO is wrapped

The web app is not changed. A small Tauri (Rust) shell starts the same `serve.mjs` that `start.bat` runs (Node, hidden window, fixed
port **8778**) and opens it in a window. Closing the app stops the server. Built after Canvers' `docs/DESKTOP_APP.md`
(`C:\AI\AI-One-Studio-Canvers\docs\DESKTOP_APP.md`), adapted for this repo.

| File | Job |
|---|---|
| `serve.mjs` | Production server: serves `dist/`, forwards ComfyUI routes (list in `comfy_paths.json`, shared with `vite.config.ts`) and `/ws`, https/wss and service-token headers |
| `comfy_paths.json` | The ComfyUI route prefixes. Add a new route here, not in two places |
| `server-lib/connection.mjs` | Where the backend is: probe, saved choice, setup page (`/aos/connect`) |
| `src-tauri/src/lib.rs` | Starts the server, opens the window, single instance, "Connection" menu, update check |
| `src-tauri/tauri.conf.json` | App name, identifier `cloud.tjtj.aionestudio`, NSIS per-user install, updater key + endpoint |
| `src-tauri/shell/index.html` | "Starting..." screen shown until the server answers |
| `scripts/prepare-app.mjs` | Fills `src-tauri/bundle/` (node.exe, serve.mjs, comfy_paths.json, server-lib, dist) and syncs the version |
| `scripts/release-app.mjs` | Uploads the installer + `latest.json` to the GitHub release |

## Run it
- `npm start` (or `start.bat`): server only, browser at http://127.0.0.1:8778 (dev server stays `npm run dev`, 8774).
- `npm run app:dev`: build + try the desktop window without installing.
- `npm run app:build`: installer at `src-tauri/target/release/bundle/nsis/AI ONE STUDIO_<version>_x64-setup.exe` (+ `.sig`).
  Needs the signing key in the environment first:
  ```
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content C:\Users\<name>\.tauri\ai-one-studio.key -Raw
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Get-Content C:\Users\<name>\.tauri\ai-one-studio.pass -Raw
  ```

- Build needs Rust (MSVC), Node, WebView2 and the Windows SDK's `rc.exe` folder on PATH
  (`C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64`); without it `tauri build` stops with "RC.EXE not found".
- **Portable zip** (`AI-ONE-STUDIO_<version>_portable.zip`): `ai-one-studio.exe` from `src-tauri/target/release/` plus the
  contents of `src-tauri/bundle/` (node.exe, serve.mjs, comfy_paths.json, server-lib, dist, package.json) in one folder.
  Unzip anywhere and run the exe; no install. It still keeps `connection.json` and the window's saved settings under
  `%APPDATA%\cloud.tjtj.aionestudio`, and needs WebView2.

## Local or remote backend
First start of the desktop app shows `/aos/connect` ("Where is ComfyUI?"):
- **This PC (local)** - the built-in server forwards to ComfyUI on 127.0.0.1:8188 (or `COMFY_URL`).
- **Somewhere else (remote)** - type a domain, tunnel address or IP:port. It first asks `GET /aos/target`: an answer means another
  AI ONE STUDIO server, so the window just opens that address (sign in inside the window if it has a login). Otherwise it asks
  `GET /system_stats`: a ComfyUI answer means the built-in server forwards to it (https/wss, optional Cloudflare service token
  `CF-Access-Client-Id/Secret`). A login wall without a token opens the address in the window so the user can sign in.
- The choice is saved in `%APPDATA%\cloud.tjtj.aionestudio\connection.json` (`{mode: local|proxy|remote, address, id, secret}`).
  Menu **Connection -> Connection settings...** opens the page again.
- The probe/save routes only answer from localhost, so a tunnelled visitor cannot redirect the proxy.
- Env used by the shell: `PORT`, `AOS_APP=1` (turns on the first-run redirect), `AOS_CONFIG` (path of connection.json).

## Where things are stored
The app has no server-side storage of its own. Settings, presets and the gallery live in the page's `localStorage`, which belongs
to the address: **http://127.0.0.1:8778 inside the app window is a different store from http://127.0.0.1:8774 in the browser**, so
existing browser data is not there at first. Keep the port fixed at 8778 or the saved data is orphaned.

## Updates and releases
- On every start the app reads `https://github.com/designloves2/AI-ONE-STUDIO/releases/latest/download/latest.json` and offers newer versions.
- Per release: bump version -> `npm run app:build` (signing env) -> normal release (`gh release create vX.Y.Z` / tag push) ->
  `node scripts/release-app.mjs` uploads the installer and `latest.json`. A "latest" release without `latest.json` makes the update check fail silently.
- The signing key lives in `C:\Users\<name>\.tauri\ai-one-studio.key` (+ `.pass`). **Never commit them. Back them up:** if lost,
  installed apps can no longer be updated. Only the public key is in `tauri.conf.json`.

## Pitfalls
- `\\?\` prefix on resource paths is stripped in `lib.rs` (`plain()`), Node scripts do not accept it.
- PowerShell `Set-Content -Encoding utf8` adds a BOM and breaks JSON - write files without BOM.
- Install is per user (no admin). No code-signing certificate yet, so SmartScreen may show "More info -> Run anyway".
- The shell menu/dialog text follows the Windows language (Korean or English).
