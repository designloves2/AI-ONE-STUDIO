// api.ts — MusicMaker 백엔드 호출. 원본 one_node_music.js의 jget/jpost/viewURL 헬퍼 이식.
// 모든 /music_one/* 라우트는 nodes.py에 등록된 백엔드가 그대로 서빙한다 (H3/Krea2와 동일).
// LLM(로컬/OpenRouter/Comfy TextGenerate)은 전부 POST /music_one/llm/run 에서 서버측 처리 —
// 웹은 API 키를 들 수 없으므로 브라우저측 LLM 클라이언트가 없다 (comfy 백엔드는 원본대로
// TextGenerate 그래프를 큐에 넣어 처리, api 키 불필요).
import { comfyApi } from "./comfyClient";
import { API } from "./core";

export { comfyApi };

export const jget = (p: string): Promise<any> =>
  comfyApi.fetchApi(API + p).then((r) => r.json());

export const jpost = (p: string, b: any): Promise<any> =>
  comfyApi
    .fetchApi(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
    .then((r) => r.json());

export const viewURL = (t: any): string =>
  `${comfyApi.base}/view?filename=${encodeURIComponent(t.filename)}&subfolder=${encodeURIComponent(
    t.subfolder || ""
  )}&type=output&t=${t.mtime || Date.now()}`;

/** absolute /view URL (covers etc.) */
export const viewAbs = (qs: string): string => `${comfyApi.base}/view?${qs}`;

// iOS Safari can't decode FLAC (or bare .opus) in <audio> — a played track just sits at 0:00.
// When the browser reports no native support for the file's container, stream the server's
// on-the-fly MP3 transcode (`/music_one/download`, ffmpeg + ID3, cached to .export/) instead.
const _audioProbe: HTMLAudioElement | null = typeof Audio !== "undefined" ? new Audio() : null;
export function playableAudioUrl(t: { filename: string; subfolder?: string }): string {
  const ext = (t.filename.split(".").pop() || "").toLowerCase();
  const mime =
    ext === "mp3" ? "audio/mpeg" :
    ext === "flac" ? "audio/flac" :
    ext === "opus" ? 'audio/ogg; codecs="opus"' :
    ext === "wav" ? "audio/wav" :
    ext === "m4a" || ext === "aac" ? "audio/mp4" :
    ext === "ogg" ? "audio/ogg" : "";
  const native = !mime || !_audioProbe || _audioProbe.canPlayType(mime) !== "";
  if (native) return viewURL(t);
  return `${comfyApi.base}${API}/download?filename=${encodeURIComponent(t.filename)}&subfolder=${encodeURIComponent(t.subfolder || "")}`;
}
