// graphBuilder.ts — Anima 워크플로우 그래프 빌더.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/anima/graph_builder_anima.js — 노드 ID/class_type 1:1 이식.
// 공식 Anima 템플릿(image_anima_base_v1.json 등)을 직접 읽어 확정된 그래프. SPEC_ANIMA_ONE_STUDIO.md 참고.
import { SUBFOLDER, LLLITE_PATCH, BASE_STEPS, BASE_CFG, TURBO_STEPS, TURBO_CFG, type AnimaState, type AnimaMode } from "./core";

function buildPromptText(state: AnimaState, modeKey?: string) {
  const key = modeKey || state.mode || "t2i";
  return state.promptsByMode && key in state.promptsByMode ? state.promptsByMode[key] : state.prompt || "";
}

function saveNode(link: any, state: AnimaState) {
  if (state?.outputMode === "preview") return { class_type: "PreviewImage", inputs: { images: link } };
  const folder = state?.saveSubfolder || SUBFOLDER;
  return { class_type: "SaveImage", inputs: { images: link, filename_prefix: `${folder}/Anima` } };
}

// 공용 프렐류드: CLIP / VAE / UNet(+turbo LoRA) / positive+negative CLIPTextEncode.
// unetName으로 T2I가 Preview3 체크포인트를 끼워넣을 수 있다; 그 외 모드는 항상 Base 1.0.
function baseGraph(state: AnimaState, promptText: string, unetName?: string) {
  const modelName = unetName || state.model || "";
  const clipName = state.textEncoder || "";
  const vaeName = state.vae || "";
  if (!modelName) throw new Error("No diffusion model selected. Please set one in ⚙ Settings.");
  if (!clipName) throw new Error("No text encoder selected. Please set one in ⚙ Settings.");
  if (!vaeName) throw new Error("No VAE selected. Please set one in ⚙ Settings.");

  const g: Record<string, any> = {};
  g["AN:unet"] = { class_type: "UNETLoader", inputs: { unet_name: modelName, weight_dtype: "default" } };
  g["AN:clip"] = { class_type: "CLIPLoader", inputs: { clip_name: clipName, type: "stable_diffusion", device: "default" } };
  g["AN:vae"] = { class_type: "VAELoader", inputs: { vae_name: vaeName } };

  let modelOut: [string, number] = ["AN:unet", 0];
  const turboOn = !!state.turboMode;
  if (turboOn) {
    const loraName = state.turboLora || "";
    if (!loraName) throw new Error("Turbo mode is ON but no Turbo LoRA is selected. Set one in ⚙ Settings.");
    g["AN:turbo_lora"] = { class_type: "LoraLoaderModelOnly", inputs: { model: modelOut, lora_name: loraName, strength_model: 1 } };
    modelOut = ["AN:turbo_lora", 0];
  }

  g["AN:positive"] = { class_type: "CLIPTextEncode", inputs: { clip: ["AN:clip", 0], text: promptText || "" } };
  const negativeText = (state.negativePrompt || "").trim();
  g["AN:negative"] = negativeText
    ? { class_type: "CLIPTextEncode", inputs: { clip: ["AN:clip", 0], text: negativeText } }
    : { class_type: "ConditioningZeroOut", inputs: { conditioning: ["AN:positive", 0] } };

  const steps = turboOn ? TURBO_STEPS : state.steps ?? BASE_STEPS;
  const cfg = turboOn ? TURBO_CFG : state.cfg ?? BASE_CFG;

  return { g, modelOut, steps, cfg };
}

function ksampler(
  g: Record<string, any>,
  id: string,
  opts: { model: any; positive: any; negative: any; latent: any; seed: number; steps: number; cfg: number; sampler?: string; scheduler?: string; denoise?: number }
) {
  g[id] = {
    class_type: "KSampler",
    inputs: {
      model: opts.model, positive: opts.positive, negative: opts.negative, latent_image: opts.latent,
      seed: opts.seed ?? 0, steps: opts.steps ?? BASE_STEPS, cfg: opts.cfg ?? BASE_CFG,
      sampler_name: opts.sampler || "euler", scheduler: opts.scheduler || "simple",
      denoise: opts.denoise ?? 1,
    },
  };
  return [id, 0];
}

// ── T2I ──────────────────────────────────────────────────────────────────────
export function buildT2IGraph(state: AnimaState) {
  const useVariant = state.useBaseVariant === "preview3";
  const unetName = useVariant ? state.previewModel || "" : state.model || "";
  if (useVariant && !unetName) throw new Error("No Preview3 model selected. Set one in ⚙ Settings.");

  const { g, modelOut, steps, cfg } = baseGraph(state, buildPromptText(state, "t2i"), unetName);

  g["AN:latent"] = { class_type: "EmptyLatentImage", inputs: { width: state.width || 1024, height: state.height || 1024, batch_size: 1 } };

  const samplerOut = ksampler(g, "AN:sampler", {
    model: modelOut, positive: ["AN:positive", 0], negative: ["AN:negative", 0],
    latent: ["AN:latent", 0], seed: state.seed ?? 0, steps, cfg,
    sampler: state.sampler, scheduler: state.scheduler, denoise: 1,
  });

  g["AN:decode"] = { class_type: "VAEDecode", inputs: { samples: samplerOut, vae: ["AN:vae", 0] } };
  g["AN:save"] = saveNode(["AN:decode", 0], state);
  return g;
}

// ── 공용 LLLite 컨트롤 모드 빌더 ───────────────────────────────────────────────
function buildLLLiteGraph(
  state: AnimaState,
  mode: Exclude<AnimaMode, "t2i">,
  opts: { image: string; mask: string | null; strength: number; start: number; end: number; promptKey: string }
) {
  const { image, mask, strength, start, end, promptKey } = opts;
  if (!image) throw new Error("No source image uploaded for this mode.");

  const { g, modelOut, steps, cfg } = baseGraph(state, buildPromptText(state, promptKey));

  g["AN:src"] = { class_type: "LoadImage", inputs: { image } };
  let maskLink: [string, number];
  if (mask) {
    g["AN:mask_src"] = { class_type: "LoadImage", inputs: { image: mask } };
    g["AN:mask"] = { class_type: "ImageToMask", inputs: { image: ["AN:mask_src", 0], channel: "red" } };
    maskLink = ["AN:mask", 0];
  } else {
    // 마스크가 없으면 AnimaLLLiteApply가 유효한 MASK 입력을 받도록 전체 커버리지 마스크를 만든다.
    g["AN:mask"] = { class_type: "SolidMask", inputs: { value: 1.0, width: state.width || 1024, height: state.height || 1024 } };
    maskLink = ["AN:mask", 0];
  }

  let controlImgLink: [string, number] = ["AN:src", 0];
  if (mode === "depthcontrol") {
    g["AN:depth_pre"] = {
      class_type: "DepthAnythingV2Preprocessor",
      inputs: { image: ["AN:src", 0], ckpt_name: state.depthCkpt || "depth_anything_v2_vitl.pth", resolution: state.preprocResolution ?? 512 },
    };
    controlImgLink = ["AN:depth_pre", 0];
  }

  g["AN:patch"] = { class_type: "ModelPatchLoader", inputs: { name: LLLITE_PATCH[mode] } };
  g["AN:lllite"] = {
    class_type: "AnimaLLLiteApply",
    inputs: {
      model: modelOut, model_patch: ["AN:patch", 0], image: controlImgLink, mask: maskLink,
      strength: strength ?? 1.0, start_percent: start ?? 0.0, end_percent: end ?? 1.0,
    },
  };

  g["AN:latent"] = { class_type: "EmptyLatentImage", inputs: { width: state.width || 1024, height: state.height || 1024, batch_size: 1 } };

  const samplerOut = ksampler(g, "AN:sampler", {
    model: ["AN:lllite", 0], positive: ["AN:positive", 0], negative: ["AN:negative", 0],
    latent: ["AN:latent", 0], seed: state.seed ?? 0, steps, cfg,
    sampler: state.sampler, scheduler: state.scheduler, denoise: 1,
  });

  g["AN:decode"] = { class_type: "VAEDecode", inputs: { samples: samplerOut, vae: ["AN:vae", 0] } };
  g["AN:save"] = saveNode(["AN:decode", 0], state);
  return g;
}

// ── Inpainting ───────────────────────────────────────────────────────────────
export function buildInpaintGraph(state: AnimaState) {
  if (!state.inpaintMask) throw new Error("No mask uploaded for Inpainting. Paint/upload a mask first.");
  return buildLLLiteGraph(state, "inpaint", {
    image: state.inpaintImage, mask: state.inpaintMask,
    strength: state.inpaintStrength, start: state.inpaintStart, end: state.inpaintEnd,
    promptKey: "inpaint",
  });
}

// ── Any Control to Image ──────────────────────────────────────────────────────
export function buildAnyControlGraph(state: AnimaState) {
  return buildLLLiteGraph(state, "anycontrol", {
    image: state.anyControlImage, mask: state.anyControlMask,
    strength: state.anyControlStrength, start: state.anyControlStart, end: state.anyControlEnd,
    promptKey: "anycontrol",
  });
}

// ── Depth Control to Image ────────────────────────────────────────────────────
export function buildDepthControlGraph(state: AnimaState) {
  return buildLLLiteGraph(state, "depthcontrol", {
    image: state.depthControlImage, mask: null,
    strength: state.depthControlStrength, start: state.depthControlStart, end: state.depthControlEnd,
    promptKey: "depthcontrol",
  });
}
