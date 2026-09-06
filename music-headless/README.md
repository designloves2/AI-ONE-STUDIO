# music-headless

Headless MusicMaker generator — **MiniMax Music 3** and **Ace-Step 1.5**, server-side.
Reproduces what the studio's MusicMaker node does internally: build the ComfyUI API graph
→ `POST /prompt` → poll `/history` → download `/view`. Zero deps, Node 20+, no build step.

```
node index.mjs --config comfy.json --job job.json [--dry-run] [--out ./result]
```

or `import { generate } from "./index.mjs"` → `await generate(job, comfyConfig, { dryRun, outDir, onPoll })`.

- **stdout** = one JSON object. `ok:true` → `outputs[]` (type `"audio"`) + `localFiles[]` (with `--out`) + `meta`.
  `ok:false` → `error` + `stage`.
- exit `0` ok, `1` failure, `2` bad invocation.

## `comfy.json`

Same file the other AI-ONE-STUDIO headless packages use:

```json
{
  "baseUrl": "https://comfy.tjtj.cloud",
  "headers": {
    "CF-Access-Client-Id": "<token-id>.access",
    "CF-Access-Client-Secret": "<token-secret>"
  },
  "timeoutMs": 2400000
}
```

Music renders are long — a 3-minute Ace-Step 3-stage render can take tens of minutes on a
16 GB card. Set `timeoutMs` generously (default 30 min). Omit `headers` for `http://127.0.0.1:8188`.

## `job.json`

**The caption and lyrics are finished text.** There is no LLM step here (same split as
`krea2-headless` — prompt authoring stays with the Hermes prompt skill). Album-cover
generation is out of scope.

```json
{
  "engine": "acestep",
  "caption": "warm K-ballad, piano and strings, female vocal, emotional build",
  "lyrics": "[Verse]\nthe streetlight flickers off\n...\n[Chorus]\n...",
  "duration": 210,
  "title": "Leaving at Dawn",
  "bpm": 72, "keyscale": "D minor", "timesignature": "4", "language": "ko",
  "vocalGender": "female",
  "seed": null
}
```

Instrumental:

```json
{ "engine": "acestep", "caption": "lofi hip-hop, mellow, rainy night", "instrumental": true, "duration": 120 }
```

### Fields

| field | applies | notes |
|---|---|---|
| `engine` | both | `acestep` (default) or `minimax` |
| `caption` | both | **required** — finished style text |
| `lyrics` | both | finished lyrics with `[Verse]`/`[Chorus]` tags; omit for instrumental |
| `instrumental` | both | `true` forces lyrics empty |
| `duration` | both | seconds, 15–300. A `3:00` / `3분` inside the caption wins over this. |
| `bpm` `keyscale` `timesignature` | both | Ace-Step reads them as structured inputs; MiniMax gets them folded into the caption text |
| `language` | acestep | `TextEncodeAceStepAudio1.5.language` |
| `vocalGender` `vocalStyle` `voiceTone` | both | `"auto"` = leave to the model; anything else is folded into the caption |
| `steps` `cfg` `cfgScale` `topK` `sampler` `scheduler` `tiledDecode` | minimax | KSampler + `MiniMaxMusic3TextEncode.cfg_scale` |
| `cfgScaleAce` `temperature` `topP` `minP` `topKAce` `genAudioCodes` | acestep | `TextEncodeAceStepAudio1.5` params |
| `aceShift` `aceSamplerName` `aceScheduler` | acestep | AuraFlow shift + `KSamplerSelect` + `BasicScheduler` |
| `aceStages` | acestep | `[{steps,cfg,on?}]`. Stage 1 always runs; stages 2 & 3 opt-in and **sequential** (3 needs 2 `on`). Default `[{30,1},{20,1},{15,1}]` all on. |
| `loras` | both | `[{name,strength,enabled}]`, up to 3, `LoraLoaderModelOnly` chain |
| `format` `audioQuality` | both | `flac` (no quality) / `mp3` (`V0`\|`128k`\|`320k`) / `opus` (`64k`…`320k`) — `SaveAudioAdvanced`, dotted key `format.quality` |
| `saveSubfolder` `filenamePrefix` | both | default `one_music` / `MMM`\|`ACE` |
| `dit` `clip` `dav` / `aceUnet` `aceClip1` `aceClip2` `aceVae` | model override | **omit normally** — taken from `GET /music_one/config` (whatever the studio owner picked in Settings) |

## Output

```json
{
  "ok": true,
  "promptId": "…",
  "outputs": [
    { "type": "audio", "filename": "ACE_00042_.flac", "subfolder": "one_music",
      "url": "https://comfy.tjtj.cloud/view?filename=ACE_00042_.flac&subfolder=one_music&type=output" }
  ],
  "localFiles": ["/tmp/out/ACE_00042_.flac"],
  "seed": 12345,
  "meta": { }
}
```

`stage` on failure: `config | auth | submit | generate | interrupted | timeout | download | network`.

## Not in scope

Single output per call. No queue/batch, no playlist, no cover art, no LLM (caption/lyric
authoring), no meta write-back to `/music_one/save_meta` (the studio does that; a headless
caller keeps its own record). The tagged-MP3 export (`/music_one/download`) is separate too —
this returns the raw `SaveAudioAdvanced` file.
