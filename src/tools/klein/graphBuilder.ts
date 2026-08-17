// graphBuilder.ts — Flux2 Klein 그래프 빌더.
// 원본 근거: web/klein/graph_builder_klein.js — Krea2/Z-Image와 달리 Klein은 그래프를 처음부터
// 만들지 않고, 백엔드가 서빙하는 사전 제작 워크플로우 JSON(`/flux_klein/workflow_*`)을 fetch한
// 뒤 알려진 노드 ID들만 값으로 patch한다. 그래서 이 파일은 노드를 조립하지 않고 원본과 동일한
// patch 로직만 그대로 옮긴다 — 노드 그래프 자체의 정확성은 백엔드 workflow json 파일이 보장한다.
import { comfyApi } from "./comfyClient";
import type { KleinState, LoraEntry } from "./core";
import { SUBFOLDER, getUseKV } from "./core";

function resolveModels(state: KleinState) {
  return {
    modelName: state.model || "",
    clipName: state.textEncoder || "",
    vaeName: state.vae || "",
  };
}

function patchModelLoader(prompt: Record<string, any>, nodeId: string, modelName: string) {
  if (!prompt[nodeId]) return;
  if (modelName.toLowerCase().endsWith(".gguf")) {
    prompt[nodeId].class_type = "UnetLoaderGGUF";
    delete prompt[nodeId].inputs.weight_dtype;
  } else {
    prompt[nodeId].class_type = "UNETLoader";
    if (!prompt[nodeId].inputs.weight_dtype) prompt[nodeId].inputs.weight_dtype = "default";
  }
  prompt[nodeId].inputs.unet_name = modelName;
}

function patchClipLoader(prompt: Record<string, any>, nodeId: string, clipName: string) {
  if (!prompt[nodeId]) return;
  prompt[nodeId].class_type = clipName.toLowerCase().endsWith(".gguf") ? "CLIPLoaderGGUF" : "CLIPLoader";
  prompt[nodeId].inputs.clip_name = clipName;
}

// T2I / Edit 공유 노드 ID (원본 워크플로우 JSON에 고정된 값)
const WF = {
  model: "FK:165",
  textEnc: "FK:155",
  vae: "FK:153",
  promptPos: "FK:166",
  promptNeg: "FK:156",
  sampling: "FK:169",
  latent: "FK:170",
  sampler: "FK:171",
  saveImage: "FK:86",
  loadImage1: "FK:91",
  loadImage2: "FK:88",
  scaleImg1: "FK:163",
  scaleImg2: "FK:163b",
  getSize: "FK:167",
  vaeEnc1: "FK:132",
  vaeEnc2: "FK:232",
  refPos1: "FK:133",
  refNeg1: "FK:131",
  refPos2: "FK:233",
  refNeg2: "FK:231",
};

async function loadWorkflow(name: string): Promise<Record<string, any>> {
  const r = await comfyApi.fetchApi(`/flux_klein/workflow_${name}`);
  if (!r.ok) throw new Error(`Cannot load ${name} workflow — HTTP ${r.status}. Try restarting ComfyUI.`);
  return r.json();
}

function buildPromptText(state: KleinState, mode: string): string {
  const base = mode in state.promptsByMode ? state.promptsByMode[mode] : state.prompt || "";
  const parts = [base];
  (state.loras || []).forEach((l) => {
    if (l.enabled !== false && l.name && l.name !== "none" && l.triggerWord) parts.push(l.triggerWord);
  });
  if (state.promptSuffix) parts.push(state.promptSuffix);
  return parts.filter(Boolean).join(", ");
}

function applyLoraChain(prompt: Record<string, any>, loras: LoraEntry[], chainSrc: string | [string, number], idPrefix: string): [string, number] {
  const toPrev = (p: string | [string, number]): [string, number] => (typeof p === "string" ? [p, 0] : p);
  let prev: string | [string, number] = chainSrc;
  (loras || []).forEach((ul, i) => {
    if (!ul.name || ul.name === "none" || ul.enabled === false || !(+(ul.strength || 0) > 0)) return;
    const id = `${idPrefix}UL${i + 1}`;
    prompt[id] = { class_type: "LoraLoaderModelOnly", inputs: { lora_name: ul.name, strength_model: +(ul.strength ?? 1), model: toPrev(prev) } };
    prev = [id, 0];
  });
  return toPrev(prev);
}

function set(prompt: Record<string, any>, id: string, key: string, val: any) {
  if (prompt[id]) prompt[id].inputs[key] = val;
}

function patchSave(prompt: Record<string, any>, saveId: string, state: KleinState) {
  if (!prompt[saveId]) return;
  const folder = state.saveSubfolder || SUBFOLDER;
  if (state.outputMode === "preview") {
    prompt[saveId].class_type = "PreviewImage";
    delete prompt[saveId].inputs.filename_prefix;
  } else {
    prompt[saveId].inputs.filename_prefix = `${folder}/FK`;
  }
}

function patchT2IBase(prompt: Record<string, any>, state: KleinState, samplerNodeId: string) {
  const useKV = getUseKV(state);
  const isBase = (state.model || "").toLowerCase().includes("base");
  const { modelName, clipName, vaeName } = resolveModels(state);

  patchModelLoader(prompt, WF.model, modelName);
  patchClipLoader(prompt, WF.textEnc, clipName);
  set(prompt, WF.vae, "vae_name", vaeName);

  let modelSrc: string | [string, number] = WF.model;
  if (useKV) {
    prompt["FK:KV"] = { class_type: "FluxKVCache", inputs: { model: [WF.model, 0] }, _meta: { title: "Flux KV Cache" } };
    modelSrc = "FK:KV";
  }

  const finalRef = applyLoraChain(prompt, state.loras, modelSrc, "FK:");
  set(prompt, WF.sampling, "model", finalRef);

  const steps = state.steps || 4;
  const cfg = state.cfg !== undefined ? state.cfg : isBase ? 5 : 1;
  set(prompt, samplerNodeId, "steps", steps);
  set(prompt, samplerNodeId, "cfg", cfg);
  set(prompt, samplerNodeId, "sampler_name", state.sampler || "euler");
  set(prompt, samplerNodeId, "scheduler", state.scheduler || "simple");
  set(prompt, samplerNodeId, "seed", state.seed ?? 0);
}

// ── T2I ─────────────────────────────────────────────────────────────────
export async function buildT2IGraph(state: KleinState): Promise<Record<string, any>> {
  const prompt = await loadWorkflow("t2i");
  patchT2IBase(prompt, state, WF.sampler);
  set(prompt, WF.promptPos, "text", buildPromptText(state, "t2i"));
  set(prompt, WF.promptNeg, "text", state.negativePrompt || "");
  set(prompt, WF.latent, "width", state.width || 1024);
  set(prompt, WF.latent, "height", state.height || 1024);
  set(prompt, WF.sampler, "denoise", 1);
  patchSave(prompt, WF.saveImage, state);
  return prompt;
}

// ── I2I ─────────────────────────────────────────────────────────────────
export async function buildI2IGraph(state: KleinState): Promise<Record<string, any>> {
  if (!state.i2iImage) throw new Error("No source image uploaded.");
  const prompt = await loadWorkflow("i2i");
  const useKV = getUseKV(state);

  const { modelName, clipName, vaeName } = resolveModels(state);
  patchModelLoader(prompt, "FK:165", modelName);
  patchClipLoader(prompt, "FK:155", clipName);
  set(prompt, "FK:153", "vae_name", vaeName);
  set(prompt, "FK:166", "text", buildPromptText(state, "i2i"));
  set(prompt, "FKI2I:img", "image", state.i2iImage);

  if (state.i2iWidth && state.i2iHeight) {
    prompt["FKI2I:scale"] = { class_type: "ImageScale", inputs: { image: ["FKI2I:img", 0], width: state.i2iWidth, height: state.i2iHeight, upscale_method: "lanczos", crop: "disabled" } };
    set(prompt, "FKI2I:vae", "pixels", ["FKI2I:scale", 0]);
  }

  let i2iModelSrc: string | [string, number] = "FK:165";
  if (useKV) {
    prompt["FK:KV"] = { class_type: "FluxKVCache", inputs: { model: ["FK:165", 0] }, _meta: { title: "Flux KV Cache" } };
    i2iModelSrc = "FK:KV";
  }
  const loraRef = applyLoraChain(prompt, state.loras, i2iModelSrc, "FK:");
  set(prompt, "FK:169", "model", loraRef);

  const isBase = (state.model || "").toLowerCase().includes("base");
  set(prompt, "FK:171", "seed", state.seed ?? 0);
  set(prompt, "FK:171", "steps", state.steps || 4);
  set(prompt, "FK:171", "cfg", state.cfg !== undefined ? state.cfg : isBase ? 5 : 1);
  set(prompt, "FK:171", "denoise", state.i2iDenoise ?? 0.75);
  set(prompt, "FK:171", "sampler_name", state.sampler || "euler");
  set(prompt, "FK:171", "scheduler", state.scheduler || "simple");

  patchSave(prompt, "FK:86", state);
  return prompt;
}

// ── Edit (다중 레퍼런스) ────────────────────────────────────────────────
export async function buildEditGraph(state: KleinState): Promise<Record<string, any>> {
  if (!state.editImage1) throw new Error("No Image 1 uploaded for Edit mode.");
  const prompt = await loadWorkflow("edit");
  patchT2IBase(prompt, state, WF.sampler);
  set(prompt, WF.promptPos, "text", buildPromptText(state, "edit"));
  set(prompt, WF.promptNeg, "text", state.negativePrompt || "");
  set(prompt, WF.loadImage1, "image", state.editImage1);
  set(prompt, WF.sampler, "denoise", 1);
  patchSave(prompt, WF.saveImage, state);

  const src = state.editSizeSource || "img1";
  const img2 = state.editImage2 || state.editRefImages?.[0]?.filename || null;
  const hasImg2 = !!img2;

  if (src === "img1") {
    set(prompt, WF.vaeEnc1, "pixels", [WF.loadImage1, 0]);
  } else {
    // manual size
    if (prompt[WF.latent]) {
      prompt[WF.latent].inputs.width = state.width || 1024;
      prompt[WF.latent].inputs.height = state.height || 1024;
    }
    set(prompt, WF.vaeEnc1, "pixels", [WF.scaleImg1, 0]);
  }

  if (hasImg2) {
    set(prompt, WF.loadImage2, "image", img2);
    set(prompt, WF.sampler, "positive", [WF.refPos2, 0]);
    set(prompt, WF.sampler, "negative", [WF.refNeg2, 0]);
  } else {
    [WF.loadImage2, WF.scaleImg2, WF.vaeEnc2, WF.refPos2, WF.refNeg2].forEach((id) => delete prompt[id]);
    set(prompt, WF.sampler, "positive", [WF.refPos1, 0]);
    set(prompt, WF.sampler, "negative", [WF.refNeg1, 0]);
  }

  return prompt;
}

// ── Inpaint ─────────────────────────────────────────────────────────────
export async function buildInpaintGraph(state: KleinState): Promise<Record<string, any>> {
  if (!state.inpaintImage) throw new Error("No source image for inpaint.");
  if (!state.inpaintMaskImage) throw new Error("No mask image — upload or draw a mask.");
  const prompt = await loadWorkflow("inpaint");

  const WFI = { model: "FKI:194", kv: "FKI:216", textEnc: "FKI:195", vae: "FKI:196", promptPos: "FKI:6", loadImg: "FKI:198", loadMask: "FKI:199", sampler: "FKI:163", save: "FKI:203" };

  const useKV = getUseKV(state);
  const isBase = (state.model || "").toLowerCase().includes("base");
  const { modelName, clipName, vaeName } = resolveModels(state);
  patchModelLoader(prompt, WFI.model, modelName);
  patchClipLoader(prompt, WFI.textEnc, clipName);
  set(prompt, WFI.vae, "vae_name", vaeName);
  set(prompt, WFI.promptPos, "text", buildPromptText(state, "inpaint"));
  set(prompt, WFI.loadImg, "image", state.inpaintImage);
  set(prompt, WFI.loadMask, "image", state.inpaintMaskImage);

  const modelSrc = useKV ? WFI.kv : WFI.model;
  if (!useKV) delete prompt[WFI.kv];
  const loraRef = applyLoraChain(prompt, state.loras, modelSrc, "FKI:");
  const samplingId = Object.keys(prompt).find((k) => prompt[k].class_type === "ModelSamplingAuraFlow");
  if (samplingId) set(prompt, samplingId, "model", loraRef);
  else set(prompt, WFI.sampler, "model", loraRef);

  set(prompt, WFI.sampler, "seed", state.seed ?? 0);
  set(prompt, WFI.sampler, "steps", state.steps || 4);
  set(prompt, WFI.sampler, "cfg", state.cfg !== undefined ? state.cfg : isBase ? 5 : 1);
  set(prompt, WFI.sampler, "sampler_name", state.sampler || "euler");
  set(prompt, WFI.sampler, "scheduler", state.scheduler || "simple");
  set(prompt, WFI.sampler, "denoise", state.inpaintDenoise ?? 0.85);

  patchSave(prompt, WFI.save, state);
  return prompt;
}

// ── Outpaint ────────────────────────────────────────────────────────────
export async function buildOutpaintGraph(state: KleinState): Promise<Record<string, any>> {
  if (!state.outpaintImage) throw new Error("No source image for outpaint.");
  const total = (state.outpaintUp || 0) + (state.outpaintDown || 0) + (state.outpaintLeft || 0) + (state.outpaintRight || 0);
  if (total <= 0) throw new Error("Set at least one expansion value > 0 px.");

  const prompt = await loadWorkflow("edit");
  patchT2IBase(prompt, state, WF.sampler);

  const padR = state.outpaintPadR ?? 0;
  const padG = state.outpaintPadG ?? 0;
  const padB = state.outpaintPadB ?? 0;
  const padColor = `rgb(${padR}, ${padG}, ${padB})`;
  const sysPrompt = `Extend the composition of this image. Replace all black or ${padColor} areas with a logical continuation of the background and foreground. Ensure the transition is invisible and the new elements perfectly match the perspective and color palette of the original image. Scene description: `;
  set(prompt, WF.promptPos, "text", sysPrompt + buildPromptText(state, "outpaint"));
  set(prompt, WF.promptNeg, "text", state.negativePrompt || "");
  set(prompt, WF.loadImage1, "image", state.outpaintImage);
  prompt["FKO:pad"] = {
    class_type: "ImagePadKJ",
    inputs: {
      image: [WF.loadImage1, 0],
      left: Math.max(0, state.outpaintLeft || 0),
      top: Math.max(0, state.outpaintUp || 0),
      right: Math.max(0, state.outpaintRight || 0),
      bottom: Math.max(0, state.outpaintDown || 0),
      extra_padding: 0,
      pad_mode: "color",
      color: `${padR}, ${padG}, ${padB}`,
    },
  };
  set(prompt, WF.scaleImg1, "image", ["FKO:pad", 0]);
  set(prompt, WF.getSize, "image", [WF.scaleImg1, 0]);

  [WF.loadImage2, WF.scaleImg2, WF.vaeEnc2, WF.refPos2, WF.refNeg2].forEach((id) => delete prompt[id]);
  set(prompt, WF.sampler, "positive", [WF.refPos1, 0]);
  set(prompt, WF.sampler, "negative", [WF.refNeg1, 0]);

  set(prompt, WF.sampler, "denoise", 1.0);
  patchSave(prompt, WF.saveImage, state);
  return prompt;
}

// ── Faceswap ────────────────────────────────────────────────────────────
export async function buildFaceswapGraph(state: KleinState): Promise<Record<string, any>> {
  if (!state.faceswapTarget) throw new Error("No target image for faceswap.");
  if (!state.faceswapSource) throw new Error("No source face image.");
  const prompt = await loadWorkflow("faceswap");

  const WFF = { model: "FKF:225", lora: "FKF:226", textEnc: "FKF:223", vae: "FKF:235", target: "FKF:234", source: "FKF:236", sampling: "FKF:239", sampler: "FKF:228", save: "FKF:232" };

  const useKV = getUseKV(state);
  const isBase = (state.model || "").toLowerCase().includes("base");
  const bfsLora = state.bfsLora && state.bfsLora.name && state.bfsLora.name !== "none" && state.bfsLora.enabled !== false ? state.bfsLora : null;

  const { modelName, clipName, vaeName } = resolveModels(state);
  patchModelLoader(prompt, WFF.model, modelName);
  patchClipLoader(prompt, WFF.textEnc, clipName);
  set(prompt, WFF.vae, "vae_name", vaeName);
  set(prompt, WFF.target, "image", state.faceswapTarget);
  set(prompt, WFF.source, "image", state.faceswapSource);

  let baseModelSrc = WFF.model;
  if (useKV) {
    prompt["FK:KV"] = { class_type: "FluxKVCache", inputs: { model: [WFF.model, 0] }, _meta: { title: "Flux KV Cache" } };
    baseModelSrc = "FK:KV";
  }

  if (bfsLora) {
    set(prompt, WFF.lora, "lora_name", bfsLora.name);
    set(prompt, WFF.lora, "strength_model", bfsLora.strength ?? 1);
    if (prompt[WFF.lora]) prompt[WFF.lora].inputs.model = [baseModelSrc, 0];
    set(prompt, WFF.sampling, "model", [WFF.lora, 0]);
  } else {
    delete prompt[WFF.lora];
    set(prompt, WFF.sampling, "model", [baseModelSrc, 0]);
  }

  const effectivePrompt = buildPromptText(state, "faceswap");
  if (effectivePrompt.trim()) set(prompt, "FKF:227", "text", effectivePrompt);

  set(prompt, WFF.sampler, "seed", state.seed ?? 0);
  set(prompt, WFF.sampler, "steps", state.steps || 4);
  set(prompt, WFF.sampler, "cfg", state.cfg !== undefined ? state.cfg : isBase ? 5 : 1);
  set(prompt, WFF.sampler, "sampler_name", state.sampler || "euler");
  set(prompt, WFF.sampler, "scheduler", state.scheduler || "simple");
  set(prompt, WFF.sampler, "denoise", state.faceswapDenoise ?? 1.0);

  patchSave(prompt, WFF.save, state);
  return prompt;
}

// ── SeedVR2 Upscale — Krea2/Z-Image와 동일한 노드 세트 ──────────────────
export function buildUpscaleGraph(state: KleinState): Record<string, any> {
  if (!state.upscaleImage) throw new Error("Upload a source image.");
  if (!state.upscaleDitModel || state.upscaleDitModel === "none") throw new Error("Select a DiT model.");
  if (!state.upscaleVaeModel || state.upscaleVaeModel === "none") throw new Error("Select a VAE model.");
  const g: Record<string, any> = {};
  const ditOffload = state.upscaleOffloadDevice && state.upscaleOffloadDevice !== "none" ? state.upscaleOffloadDevice : "cpu";

  g["UP:dit"] = {
    class_type: "SeedVR2LoadDiTModel",
    inputs: {
      model: state.upscaleDitModel,
      device: "cuda:0",
      blocks_to_swap: state.upscaleBlocksToSwap ?? 0,
      swap_io_components: false,
      offload_device: ditOffload,
      cache_model: ditOffload !== "none",
      attention_mode: state.upscaleAttentionMode || "sdpa",
    },
  };
  g["UP:vae"] = {
    class_type: "SeedVR2LoadVAEModel",
    inputs: {
      model: state.upscaleVaeModel,
      device: "cuda:0",
      encode_tiled: true,
      encode_tile_size: 1024,
      encode_tile_overlap: 128,
      decode_tiled: true,
      decode_tile_size: 1024,
      decode_tile_overlap: 128,
      tile_debug: "false",
      offload_device: ditOffload,
      cache_model: false,
    },
  };
  g["UP:load"] = { class_type: "LoadImage", inputs: { image: state.upscaleImage } };
  g["UP:run"] = {
    class_type: "SeedVR2VideoUpscaler",
    inputs: {
      image: ["UP:load", 0],
      dit: ["UP:dit", 0],
      vae: ["UP:vae", 0],
      seed: (state.seed ?? 42) % 4294967295,
      resolution: state.upscaleResolution ?? 2048,
      max_resolution: state.upscaleMaxResolution ?? 4096,
      batch_size: state.upscaleBatchSize ?? 1,
      uniform_batch_size: false,
      color_correction: state.upscaleColorCorrection || "lab",
      temporal_overlap: 0,
      prepend_frames: 0,
      input_noise_scale: state.upscaleInputNoiseScale ?? 0,
      latent_noise_scale: state.upscaleLatentNoiseScale ?? 0,
      offload_device: ditOffload,
      enable_debug: false,
    },
  };
  g["UP:save"] =
    state.outputMode === "preview"
      ? { class_type: "PreviewImage", inputs: { images: ["UP:run", 0] } }
      : { class_type: "SaveImage", inputs: { images: ["UP:run", 0], filename_prefix: `${state.saveSubfolder || SUBFOLDER}/FK` } };
  return g;
}

export async function buildGraph(state: KleinState): Promise<Record<string, any>> {
  if (state.mode === "i2i") return buildI2IGraph(state);
  if (state.mode === "edit") return buildEditGraph(state);
  if (state.mode === "inpaint") return state.paintSubMode === "outpaint" ? buildOutpaintGraph(state) : buildInpaintGraph(state);
  if (state.mode === "faceswap") return buildFaceswapGraph(state);
  if (state.mode === "upscale") return buildUpscaleGraph(state);
  return buildT2IGraph(state);
}
