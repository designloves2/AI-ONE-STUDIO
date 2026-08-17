// comfyBase.ts — ComfyUI 서버 주소를 "지금 이 페이지가 어떤 호스트로 열렸는지"에 따라
// 런타임에 고른다. 로컬 PC(127.0.0.1/localhost)로 열었을 때는 항상 127.0.0.1:8188로 직접
// 붙고, 그 외 호스트(터널 도메인 등 외부 접속)로 열었을 때만 VITE_COMFY_URL을 사용한다.
// 이렇게 하면 dev 서버를 재시작하거나 .env를 바꿔치기하지 않아도 로컬/외부 접속이 동시에
// 정상 동작한다 — VITE_COMFY_URL은 외부 접속 경로에만 영향을 준다.
export function getComfyBase(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isLocal = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "";
  if (isLocal) return "http://127.0.0.1:8188";

  const remote = (import.meta as any).env?.VITE_COMFY_URL;
  if (remote) return remote;

  // VITE_COMFY_URL이 안 잡혀 있으면 외부 접속에서 백엔드 호출이 전부 실패한다 — 콘솔에
  // 명확히 알려서 "왜 안 되지" 삽질을 줄인다. 설정 방법은 README.md 참고.
  console.warn(
    "[AI ONE STUDIO] VITE_COMFY_URL이 설정되지 않았습니다. 외부(터널/모바일) 접속에서는 " +
      "ComfyUI 백엔드에 연결할 수 없습니다 — 프로젝트 루트에 .env 파일을 만들고 " +
      "VITE_COMFY_URL=https://your-comfyui-tunnel-domain 을 설정한 뒤 dev 서버를 재시작하세요. " +
      "(.env.example 참고, 로컬 127.0.0.1 접속에는 영향 없음)"
  );
  return "http://127.0.0.1:8188";
}
