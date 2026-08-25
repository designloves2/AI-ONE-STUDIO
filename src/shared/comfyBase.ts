// comfyBase.ts — ComfyUI 서버 주소를 "지금 이 페이지가 어떤 호스트로 열렸는지"에 따라
// 런타임에 고른다. 로컬 PC(127.0.0.1/localhost)로 열었을 때는 127.0.0.1의 포트로 직접
// 붙고, 그 외 호스트(터널 도메인 등 외부 접속)로 열었을 때만 VITE_COMFY_URL을 사용한다.
// 이렇게 하면 dev 서버를 재시작하거나 .env를 바꿔치기하지 않아도 로컬/외부 접속이 동시에
// 정상 동작한다 — VITE_COMFY_URL은 외부 접속 경로에만 영향을 준다.
//
// 로컬 포트는 기본 8188이지만, PC에 ComfyUI를 여러 개 설치해두고 서로 다른 포트로 띄우는
// 경우가 있어 오버라이드 방법을 두 가지 제공한다:
//   1. URL에 ?comfy_port=8189 를 붙여서 열면 그 값을 localStorage에 저장하고 즉시 사용
//      (.env 수정도, dev 서버 재시작도 필요 없음 — 브라우저 주소창에서 바로 테스트 가능)
//   2. localStorage에 저장된 값이 없으면 VITE_COMFY_PORT(.env)를, 그것도 없으면 8188을 씀
const LOCAL_PORT_KEY = "aos_comfy_local_port";
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
  return (import.meta as any).env?.VITE_COMFY_PORT || "8188";
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
