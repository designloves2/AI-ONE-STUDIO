// comfyBase.ts — ComfyUI 서버 주소를 "지금 이 페이지가 어떤 호스트로 열렸는지"에 따라
// 런타임에 고른다. 로컬 PC(127.0.0.1/localhost)로 열었을 때는 127.0.0.1의 포트로 직접
// 붙고, 그 외 호스트(터널 도메인 등 외부 접속)로 열었을 때만 VITE_COMFY_URL을 사용한다.
// 이렇게 하면 dev 서버를 재시작하거나 .env를 바꿔치기하지 않아도 로컬/외부 접속이 동시에
// 정상 동작한다 — VITE_COMFY_URL은 외부 접속 경로에만 영향을 준다.
//
// 로컬 포트는 기본 8188이지만, PC에 ComfyUI를 여러 개 설치해두고 서로 다른 포트로 띄우는
// 경우가 있어 오버라이드 방법을 세 가지 제공한다(우선순위 순):
//   1. URL에 ?comfy_port=8189 를 붙여서 열면 그 값을 localStorage에 저장하고 즉시 사용
//      (한 번 열면 계속 유지 — 브라우저 주소창에서 바로 테스트할 때 편함)
//   2. public/comfy_port.txt 파일에 포트 번호만 적어두면 그걸 읽는다 — 빌드/재시작 없이
//      파일만 고치고 새로고침하면 바로 반영된다(정적 파일이라 dev 서버가 그대로 서빙함).
//      다른 옵션 없이 그냥 "파일에 숫자 하나 적어두면 알아서 읽는" 가장 간단한 방법.
//   3. 그것도 없으면 VITE_COMFY_PORT(.env), 최종 기본값은 8188.
const LOCAL_PORT_KEY = "aos_comfy_local_port";
let filePortCache: string | null = null;
let filePortRead = false;
function readComfyPortFile(): string | null {
  if (filePortRead) return filePortCache;
  filePortRead = true;
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/comfy_port.txt", false); // 동기 — 이 모듈이 여러 파일에서 동기로 쓰여서 부득이함, 로컬 정적 파일 하나라 지연은 무시할 수준.
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300) {
      const val = xhr.responseText.trim();
      if (/^\d+$/.test(val)) filePortCache = val;
    }
  } catch {}
  return filePortCache;
}
function localComfyPort(): string {
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get("comfy_port");
    if (fromQuery) {
      localStorage.setItem(LOCAL_PORT_KEY, fromQuery);
      return fromQuery;
    }
    const saved = localStorage.getItem(LOCAL_PORT_KEY);
    if (saved) return saved;
  } catch {}
  return readComfyPortFile() || (import.meta as any).env?.VITE_COMFY_PORT || "8188";
}

export function getComfyBase(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isLocal = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "";
  if (isLocal) return `http://127.0.0.1:${localComfyPort()}`;

  const remote = (import.meta as any).env?.VITE_COMFY_URL;
  if (remote) return remote;

  // VITE_COMFY_URL이 안 잡혀 있으면 외부 접속에서 백엔드 호출이 전부 실패한다 — 콘솔에
  // 명확히 알려서 "왜 안 되지" 삽질을 줄인다. 설정 방법은 README.md 참고.
  console.warn(
    "[AI ONE STUDIO] VITE_COMFY_URL is not set. External (tunnel/mobile) access " +
      "can't reach the ComfyUI backend — create a .env file in the project root and " +
      "set VITE_COMFY_URL=https://your-comfyui-tunnel-domain, then restart the dev server. " +
      "(see .env.example; local 127.0.0.1 access is unaffected)"
  );
  return "http://127.0.0.1:8188";
}
