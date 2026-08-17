// identity.ts — TJ ONE STUDIO 팩 공통 브랜드 컬러/팔레트
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE의 6개 core_*.js (값 전부 동일, BRAND/LIME으로 이름만 다름)

export const BRAND = "#7612DA"; // TJ 퍼플 — 버튼/액센트/포커스 테두리

export const C = {
  bg0: "#0b0b0b", // 페이지 배경 (가장 어두움)
  bg1: "#111111", // 카드/패널 배경
  bg2: "#181818", // 인풋/버튼 기본 배경
  bg3: "#222222", // 선택된 상태 배경
  border: "#2a2a2a",
  borderH: "#3c3c3c", // hover 시 테두리
  text: "#dedede",
  muted: "#565656",
  dim: "#2e2e2e",
  warn: "#ffb347",
  err: "#ff6767",
  ok: "#5fd38d",
} as const;
