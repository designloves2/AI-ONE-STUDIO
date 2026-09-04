# video-rtx-headless

Headless **RTX video upscale / deblur** — the RTX Video SDK path from AI-ONE-STUDIO's MiniMax H3
post-process graph (`RTXVideoSuperResolution` + `TJ_RTXDeblur`), extracted to a
**zero-dependency Node package**. RTX-only by design — no ESRGAN/model upscale, no RIFE
interpolation. Node 20+, NVIDIA RTX GPU + the RTX Video nodes installed in ComfyUI.

```
node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
```

Graph: `VHS_LoadVideo → [TJ_RTXDeblur] → [RTXVideoSuperResolution] → CreateVideo → SaveVideo`.

## `comfy.json`

```json
{
  "baseUrl": "https://comfy.example.com",
  "headers": { "CF-Access-Client-Id": "xxx.access", "CF-Access-Client-Secret": "xxx" },
  "timeoutMs": 1800000
}
```

## `job.json`

```json
{ "op": "upscale", "video": "/abs/clip.mp4", "scale": 2.0, "quality": "HIGH" }
```
```json
{ "op": "deblur",  "video": "/abs/clip.mp4", "quality": "HIGH" }
```
```json
{ "op": "both",    "video": "/abs/clip.mp4", "scale": 2.0, "quality": "HIGH" }
```

| field | notes |
|---|---|
| `op` | `upscale` \| `deblur` \| `both` |
| `video` | absolute path to the source clip — **required** (uploaded to ComfyUI `input/`) |
| `scale` | upscale multiplier (default `2.0`) — `upscale` / `both` only |
| `quality` | `LOW` \| `MEDIUM` \| `HIGH` \| `ULTRA` (default `HIGH`) — applies to the deblur strength and the upscale quality |
| `fps` | output frame rate (default `24`). Set it if the source isn't 24fps, otherwise the re-encode retimes. |
| `saveSubfolder` | output subfolder (default `one_video_rtx`) |

"영상 업스케일 해줘. 2.0배율, HIGH옵션" → `{ "op":"upscale", "scale":2.0, "quality":"HIGH", "video":"..." }`
"영상 디블러 해줘, HIGH옵션"          → `{ "op":"deblur", "quality":"HIGH", "video":"..." }`

## Output (stdout JSON)

```json
{ "ok": true, "promptId": "...", "outputs": [{ "type": "video", "filename": "clip_upscaled.mp4",
  "subfolder": "one_video_rtx", "url": "https://.../view?..." }],
  "localFiles": ["./result/clip_upscaled.mp4"], "op": "upscale", "scale": 2, "graphSubmitted": { } }
```

Failure: `{ "ok": false, "error": "...", "stage": "config|auth|upload|submit|generate|timeout|download|network" }`.
A missing RTX node surfaces as `stage:"submit"` with the ComfyUI validation message.
Exit `0` on success, `1` otherwise (`2` bad invocation).
