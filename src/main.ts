import "./style.css";
import { createTopbar } from "./shared/topbar";
import { renderLanding } from "./landing/menu";
import { registerTool, startRouter } from "./router";
import { renderMinimaxH3 } from "./tools/minimax_h3/view";
import { renderKrea2 } from "./tools/krea2/view";
import { renderZImage } from "./tools/zimage/view";
import { renderKlein } from "./tools/klein/view";
import { renderQwen2511 } from "./tools/qwen2511/view";
import { renderQwen21 } from "./tools/qwen21/view";
import { renderSDXL } from "./tools/sdxl/view";
import { renderAnima } from "./tools/anima/view";
import { renderMusic } from "./tools/music/view";
import { renderItda } from "./tools/itda/view";

registerTool("minimax_h3", renderMinimaxH3);
registerTool("music", renderMusic);
registerTool("itda", renderItda);
registerTool("krea2", renderKrea2);
registerTool("zimage", renderZImage);
registerTool("klein", renderKlein);
registerTool("qwen2511", renderQwen2511);
registerTool("qwen21", renderQwen21);
registerTool("sdxl", renderSDXL);
registerTool("anima", renderAnima);

// 페이지 전체 높이를 모니터 해상도(뷰포트)에 정확히 맞춘다 — h-screen으로 고정하고,
// 넘치는 콘텐츠는 페이지 자체가 늘어나는 대신 content 영역 안에서만 스크롤되게 한다.
const app = document.querySelector<HTMLDivElement>("#app")!;
app.className = "flex flex-col h-screen overflow-hidden";

app.appendChild(createTopbar());

const content = document.createElement("main");
content.className = "flex-1 min-h-0 flex flex-col overflow-y-auto";
app.appendChild(content);

startRouter(content, renderLanding);

// 모바일 가로모드 차단 — 터치 기기이면서 실제 화면이 휴대폰 크기(짧은 변 <=767px)일 때만
// 세로모드로 돌리라는 전체 화면 안내를 띄운다. 데스크톱 창을 옆으로 늘리는 것과는 무관.
function isMobileLandscapeBlocked(): boolean {
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const isLandscape = window.innerWidth > window.innerHeight;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return isCoarsePointer && isLandscape && shortSide <= 767;
}
const orientationGuard = document.createElement("div");
orientationGuard.className = "aos-orientation-guard";
orientationGuard.innerHTML =
  `<div class="icon">📱</div>` +
  `<div style="font-size:16px;font-weight:700;">세로 모드로 회전해주세요</div>` +
  `<div style="font-size:12px;max-width:320px;line-height:1.6;">이 앱은 모바일 가로 모드를 지원하지 않습니다. 기기를 세로로 돌려주세요.</div>`;
document.body.appendChild(orientationGuard);
function updateOrientationGuard() {
  orientationGuard.classList.toggle("show", isMobileLandscapeBlocked());
}
window.addEventListener("resize", updateOrientationGuard);
window.addEventListener("orientationchange", updateOrientationGuard);
updateOrientationGuard();
