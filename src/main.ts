import "./style.css";
import { createTopbar } from "./shared/topbar";
import { renderLanding } from "./landing/menu";
import { registerTool, startRouter } from "./router";
import { renderMinimaxH3 } from "./tools/minimax_h3/view";
import { renderKrea2 } from "./tools/krea2/view";

registerTool("minimax_h3", renderMinimaxH3);
registerTool("krea2", renderKrea2);

// 페이지 전체 높이를 모니터 해상도(뷰포트)에 정확히 맞춘다 — h-screen으로 고정하고,
// 넘치는 콘텐츠는 페이지 자체가 늘어나는 대신 content 영역 안에서만 스크롤되게 한다.
const app = document.querySelector<HTMLDivElement>("#app")!;
app.className = "flex flex-col h-screen overflow-hidden";

app.appendChild(createTopbar());

const content = document.createElement("main");
content.className = "flex-1 min-h-0 flex flex-col overflow-y-auto";
app.appendChild(content);

startRouter(content, renderLanding);
