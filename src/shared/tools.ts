export type ToolId =
  | "klein"
  | "zimage"
  | "krea2"
  | "qwen2511"
  | "sdxl"
  | "minimax_h3";

export type MediaKind = "image" | "video";

export type ToolGroup = "video" | "image";

export interface ToolMeta {
  id: ToolId;
  label: string;
  hash: string;
  kind: MediaKind;
  group: ToolGroup;
}

// 상단 메뉴 순서: Video generator(MiniMax H3) 먼저, 그 다음 Image generator
// (Krea2 → Z-Image → Flux2 Klein → Qwen Image 2511 → SDXL)
export const TOOLS: ToolMeta[] = [
  { id: "minimax_h3", label: "MiniMax H3", hash: "#minimax_h3", kind: "video", group: "video" },
  { id: "krea2", label: "Krea2", hash: "#krea2", kind: "image", group: "image" },
  { id: "zimage", label: "Z-Image", hash: "#zimage", kind: "image", group: "image" },
  { id: "klein", label: "Flux2 Klein", hash: "#klein", kind: "image", group: "image" },
  { id: "qwen2511", label: "Qwen Image 2511", hash: "#qwen2511", kind: "image", group: "image" },
  { id: "sdxl", label: "SDXL", hash: "#sdxl", kind: "image", group: "image" },
];

export const GROUP_LABELS: Record<ToolGroup, string> = {
  video: "Video generator",
  image: "Image generator",
};

export function toolFromHash(hash: string): ToolMeta | undefined {
  return TOOLS.find((t) => t.hash === hash);
}
