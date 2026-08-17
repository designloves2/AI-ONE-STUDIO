// minimaxSend.ts — 이미지 갤러리에서 선택한 이미지를 MiniMax H3의 FL2VA/REF2VA 첨부로 보내는
// 공용 헬퍼. 각 이미지 도구는 자신의 copy_to_input으로 output 이미지를 ComfyUI 전역 input
// 폴더에 복사해 유니크한 파일명을 얻고, 그 파일명들을 MiniMax의 localStorage 상태에 직접
// 병합한 뒤 #minimax_h3로 라우팅한다 (MiniMax view.ts가 로드 시 loadState()로 그대로 반영).
const MINIMAX_LS_KEY = "minimax_h3_one_state_v1";

export interface SendableImage {
  filename: string;
  subfolder: string;
}

export type MinimaxSendTarget = "firstlast" | "reference";

export async function sendImagesToMinimax(
  images: SendableImage[],
  copyOutputToInput: (filename: string, subfolder: string, type?: string) => Promise<string>,
  target: MinimaxSendTarget
): Promise<void> {
  if (!images.length) return;
  const copied: string[] = [];
  for (const img of images) {
    try {
      copied.push(await copyOutputToInput(img.filename, img.subfolder || "", "output"));
    } catch {}
  }
  if (!copied.length) return;

  let saved: any = {};
  try {
    saved = JSON.parse(localStorage.getItem(MINIMAX_LS_KEY) || "{}");
  } catch {}

  if (target === "firstlast") {
    saved.generationMode = "firstlast";
    saved.firstFrameImage = copied[0];
    if (copied.length > 1) saved.lastFrameImage = copied[1];
  } else {
    saved.generationMode = "reference";
    saved.refTypes = { ...(saved.refTypes || {}), images: true };
    saved.refImages = copied.slice(0, 9);
  }

  localStorage.setItem(MINIMAX_LS_KEY, JSON.stringify(saved));
  location.hash = "#minimax_h3";
}
