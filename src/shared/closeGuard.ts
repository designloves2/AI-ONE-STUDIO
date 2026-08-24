// closeGuard.ts — 탭을 실수로 닫으면 브라우저 기본 확인창("나가시겠습니까?")을 띄운다.
// 체크박스가 켜져 있으면 생성 진행 여부와 상관없이 무조건 잡는다(코드 수정 중이면 체크를
// 잠깐 꺼두면 됨) — 예전엔 Vite HMR 리로드만 예외 처리했었는데, 실제 배포 서버(빌드본)에서는
// import.meta.hot이 없어 그 예외가 애초에 안 걸리는데도 사용자가 "수정 중이라 괜찮겠지"라고
// 착각해 탭이 그냥 닫혀버리는 사고가 있어서 제거함.
const ENABLED_KEY = "aos_close_guard_enabled";

function isEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "0"; // 기본값 ON
  } catch {
    return true;
  }
}

export function isCloseGuardEnabled(): boolean {
  return isEnabled();
}

export function setCloseGuardEnabled(v: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
  } catch {}
}

window.addEventListener("beforeunload", (e) => {
  if (!isEnabled()) return;
  // returnValue를 빈 문자열로 두면 일부 크롬 버전이 preventDefault()를 호출했어도
  // "falsy면 확인창 생략"으로 판단해 그냥 닫아버리는 경우가 있어, 실제 텍스트를 채운다
  // (커스텀 텍스트는 브라우저가 무시하고 자체 문구를 보여주지만, truthy 값 자체가 필요함).
  e.preventDefault();
  e.returnValue = "Generation is still running. Leave this page?";
  return e.returnValue;
});
