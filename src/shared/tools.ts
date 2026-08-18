export type ToolId =
  | "klein"
  | "zimage"
  | "krea2"
  | "qwen2511"
  | "sdxl"
  | "anima"
  | "minimax_h3";

export type MediaKind = "image" | "video";

export type ToolGroup = "video" | "image" | "image_edit" | "beta";

export interface ToolMeta {
  id: ToolId;
  label: string;
  hash: string;
  kind: MediaKind;
  group: ToolGroup;
}

// 상단 메뉴 4개 카테고리: Video Generator → Image Generator → Image Edit Generator → Beta
export const TOOLS: ToolMeta[] = [
  { id: "minimax_h3", label: "MiniMax H3", hash: "#minimax_h3", kind: "video", group: "video" },
  { id: "krea2", label: "Krea2", hash: "#krea2", kind: "image", group: "image" },
  { id: "zimage", label: "Z-Image", hash: "#zimage", kind: "image", group: "image" },
  { id: "klein", label: "Flux2 Klein", hash: "#klein", kind: "image", group: "image_edit" },
  { id: "qwen2511", label: "Qwen Image 2511", hash: "#qwen2511", kind: "image", group: "image_edit" },
  { id: "sdxl", label: "SDXL", hash: "#sdxl", kind: "image", group: "beta" },
  { id: "anima", label: "Anima", hash: "#anima", kind: "image", group: "beta" },
];

export const GROUP_ORDER: ToolGroup[] = ["video", "image", "image_edit", "beta"];

export const GROUP_LABELS: Record<ToolGroup, string> = {
  video: "Video Generator",
  image: "Image Generator",
  image_edit: "Image Edit Generator",
  beta: "Beta",
};

export function toolFromHash(hash: string): ToolMeta | undefined {
  return TOOLS.find((t) => t.hash === hash);
}

export function toolsByGroup(group: ToolGroup): ToolMeta[] {
  return TOOLS.filter((t) => t.group === group);
}
