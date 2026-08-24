// closeGuard.ts — 생성이 진행 중일 때 탭을 실수로 닫으면 브라우저 기본 확인창("나가시겠습니까?")을
// 띄운다. 체크박스가 켜져 있으면 이유를 가리지 않고 무조건 잡는다(코드 수정 중이면 체크를
// 잠깐 꺼두면 됨) — 예전엔 Vite HMR 리로드만 예외 처리했었는데, 실제 배포 서버(빌드본)에서는
// import.meta.hot이 없어 그 예외가 애초에 안 걸리는데도 사용자가 "수정 중이라 괜찮겠지"라고
// 착각해 탭이 그냥 닫혀버리는 사고가 있어서 제거함.
const ENABLED_KEY = "aos_close_guard_enabled";
let running = false;

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

/** 도구가 오래 걸리는 릴레이 생성을 시작/종료할 때 호출 — 여러 도구가 동시에 부를 수 있으니 참조 카운트. */
let refCount = 0;
export function setCloseGuardActive(active: boolean) {
  if (active) refCount++;
  else refCount = Math.max(0, refCount - 1);
  running = refCount > 0;
}

window.addEventListener("beforeunload", (e) => {
  if (!running || !isEnabled()) return;
  e.preventDefault();
  e.returnValue = "";
});
