// graphBuilder.ts — QWEN IMAGE 2.1 그래프 빌더.
// 원본 근거: web/qwen21/graph_builder_qwen21.js — TextEncodeQwenImage21 하나가 clip/vae/prompt/
// negative_prompt/resolution + images.image_1..10을 받아 (positive, negative, latent)를 직접 만든다
// (2511의 FluxKontextImageScale+VAEEncode+TextEncodeQwenImageEditPlus+FluxKontextMultiReferenceLatentMethod
// 체인과 다르다). Model Sampling도 2511의 ModelSamplingAuraFlow+CFGNorm이 아니라 ModelSamplingFlux
// (max_shift/base_shift)이고, QwenImage21Cache(device="auto", dtype="default" 필수)와
// PathchSageAttentionKJ 토글이 있다.
import type { Q21State, LoraEntry } from "./core";
import { SUBFOLDER } from "./core";

const P = "Q21";

function saveNode(link: any, state: Q21State) {
  const folder = state.saveSubfolder || SUBFOLDER;
  if (state.outputMode === "preview") return { class_type: "PreviewImage", inputs: { images: link } };
  return { class_type: "SaveImage", inputs: { images: link, filename_prefix: `${folder}/Q21` } };
}

function buildPromptText(state: Q21State, mode: string): string {
  const base = mode in state.promptsByMode ? state.promptsByMode[mode] : state.prompt || "";
  const parts = [base];
  (state.loras || []).forEach((l: LoraEntry) => {
    if (l.enabled !== false && l.name && l.name !== "none" && l.triggerWord) parts.push(l.triggerWord);
  });
  if (state.promptSuffix) parts.push(state.promptSuffix);
  return parts.filter(Boolean).join(", ");
}

function buildBaseGraph(state: Q21State) {
  const model = state.model || "";
  const clip = state.textEncoder || "";
  const vae = state.vae || "";
  if (!model) throw new Error("No model selected. Configure in ⚙ Settings.");
  if (!clip) throw new Error("No text encoder selected. Configure in ⚙ Settings.");
  if (!vae) throw new Error("No VAE selected. Configure in ⚙ Settings.");

  const g: Record<string, any> = {};

  if (model.toLowerCase().endsWith(".gguf")) {
    g[`${P}:unet`] = { class_type: "UnetLoaderGGUF", inputs: { unet_name: model } };
  } else {
    g[`${P}:unet`] = { class_type: "UNETLoader", inputs: { unet_name: model, weight_dtype: "default" } };
  }
  // CLIP — Qwen3-VL 텍스트 인코더 (2.1 전용, 2511의 Qwen2.5-VL과 다름)
  g[`${P}:clip`] = { class_type: "CLIPLoader", inputs: { clip_name: clip, type: "qwen_image", device: "default" } };
  g[`${P}:vae`] = { class_type: "VAELoader", inputs: { vae_name: vae } };

  let modelOut: any = [`${P}:unet`, 0];

  (state.loras || []).forEach((lora: LoraEntry, i: number) => {
    if (!lora.name || lora.name === "none" || lora.enabled === false || !(+(lora.strength || 0) > 0)) return;
    const id = `${P}:lora${i}`;
    g[id] = { class_type: "LoraLoaderModelOnly", inputs: { model: modelOut, lora_name: lora.name, strength_model: +(lora.strength ?? 1) } };
    modelOut = [id, 0];
  });

  // ModelSamplingFlux — 2.1은 max_shift/base_shift를 쓴다 (2511의 AuraFlow+CFGNorm 조합이 아님)
  g[`${P}:modelSamp`] = {
    class_type: "ModelSamplingFlux",
    inputs: { model: modelOut, max_shift: state.maxShift ?? 0.69, base_shift: state.baseShift ?? 0.5, width: state.width || 1024, height: state.height || 1024 },
  };
  modelOut = [`${P}:modelSamp`, 0];

  // QwenImage21Cache — device/dtype은 실제 /object_info 확인 결과 필수 입력이라 노드 UI에는
  // 없어도 그래프에는 항상 하드코딩해서 넣는다 (원본 주석: 생략 시 "Required input is missing").
  if (state.useCache !== false) {
    g[`${P}:cache`] = { class_type: "QwenImage21Cache", inputs: { model: modelOut, device: "auto", dtype: "default" } };
    modelOut = [`${P}:cache`, 0];
  }

  if (state.useSageAttention) {
    g[`${P}:sage`] = { class_type: "PathchSageAttentionKJ", inputs: { model: modelOut, sage_attention: "auto" } };
    modelOut = [`${P}:sage`, 0];
  }

  return { g, modelLink: modelOut, clipLink: [`${P}:clip`, 0], vaeLink: [`${P}:vae`, 0] };
}

// TextEncodeQwenImage21을 0~10장의 레퍼런스 이미지와 함께 배선. latentLink는 이미지가 1장 이상일
// 때만 의미 있는(노드가 직접 만든) latent다.
function addConditioning(
  g: Record<string, any>,
  clipLink: any,
  vaeLink: any,
  positiveText: string,
  negativeText: string,
  resolution: number,
  imageLinks: any[]
) {
  const inputs: Record<string, any> = { clip: clipLink, vae: vaeLink, prompt: positiveText || "", negative_prompt: negativeText || "", resolution: resolution || 1024 };
  (imageLinks || []).slice(0, 10).forEach((link, i) => {
    inputs[`images.image_${i + 1}`] = link;
  });
  g[`${P}:enc`] = { class_type: "TextEncodeQwenImage21", inputs };
  return { posLink: [`${P}:enc`, 0], negLink: [`${P}:enc`, 1], latentLink: [`${P}:enc`, 2] };
}

function addKSampler(g: Record<string, any>, modelLink: any, latentLink: any, state: Q21State, denoise: number, posLink: any, negLink: any) {
  g[`${P}:sampler`] = {
    class_type: "KSampler",
    inputs: {
      model: modelLink,
      positive: posLink,
      negative: negLink,
      latent_image: latentLink,
      seed: state.seed ?? 0,
      steps: state.steps ?? 20,
      cfg: state.cfg ?? 1.0,
      sampler_name: state.sampler || "euler",
      scheduler: state.scheduler || "simple",
      denoise,
    },
  };
}

function addDecodeAndSave(g: Record<string, any>, vaeLink: any, state: Q21State) {
  g[`${P}:decode`] = { class_type: "VAEDecode", inputs: { samples: [`${P}:sampler`, 0], vae: vaeLink } };
  g[`${P}:save`] = saveNode([`${P}:decode`, 0], state);
}

// ── T2I ─────────────────────────────────────────────────────────────────
export function buildT2IGraph(state: Q21State): Record<string, any> {
  const { g, modelLink, clipLink, vaeLink } = buildBaseGraph(state);
  const promptText = buildPromptText(state, "t2i");
  g[`${P}:latent`] = { class_type: "EmptyLatentImage", inputs: { width: state.width || 1024, height: state.height || 1024, batch_size: 1 } };
  const { posLink, negLink } = addConditioning(g, clipLink, vaeLink, promptText, state.negativePrompt || "", state.resolution || state.width || 1024, []);
  addKSampler(g, modelLink, [`${P}:latent`, 0], state, 1.0, posLink, negLink);
  addDecodeAndSave(g, vaeLink, state);
  return g;
}

// ── I2I (plain) ─────────────────────────────────────────────────────────
export function buildI2IGraph(state: Q21State): Record<string, any> {
  if (!state.i2iImage) throw new Error("No source image uploaded.");
  const { g, modelLink, clipLink, vaeLink } = buildBaseGraph(state);
  const promptText = buildPromptText(state, "i2i");
  g[`${P}:loadImg1`] = { class_type: "LoadImage", inputs: { image: state.i2iImage } };
  let imgLink: any = [`${P}:loadImg1`, 0];
  if (state.i2iWidth && state.i2iHeight) {
    g[`${P}:i2iScale`] = { class_type: "ImageScale", inputs: { image: imgLink, width: state.i2iWidth, height: state.i2iHeight, upscale_method: "lanczos", crop: "disabled" } };
    imgLink = [`${P}:i2iScale`, 0];
  }
  const { posLink, negLink, latentLink } = addConditioning(g, clipLink, vaeLink, promptText, state.negativePrompt || "", state.i2iWidth || state.width || 1024, [imgLink]);
  addKSampler(g, modelLink, latentLink, state, state.i2iDenoise ?? 0.75, posLink, negLink);
  addDecodeAndSave(g, vaeLink, state);
  return g;
}

// ── I2I — Ref to Image (최대 10장, 자체 출력 크기) ─────────────────────────
export function buildRefToImageGraph(state: Q21State): Record<string, any> {
  const refs = (state.refImages || []).filter((r) => r?.filename).slice(0, 10);
  if (!refs.length) throw new Error("Add at least one reference image.");
  const { g, modelLink, clipLink, vaeLink } = buildBaseGraph(state);
  const promptText = buildPromptText(state, "ref2img");

  const imageLinks = refs.map((r, i) => {
    const id = `${P}:refImg${i}`;
    g[id] = { class_type: "LoadImage", inputs: { image: r.filename } };
    return [id, 0];
  });

  g[`${P}:latent`] = { class_type: "EmptyLatentImage", inputs: { width: state.refWidth || 1024, height: state.refHeight || 1024, batch_size: 1 } };
  const { posLink, negLink } = addConditioning(g, clipLink, vaeLink, promptText, state.negativePrompt || "", state.refWidth || 1024, imageLinks);
  addKSampler(g, modelLink, [`${P}:latent`, 0], state, state.refDenoise ?? 1.0, posLink, negLink);
  addDecodeAndSave(g, vaeLink, state);
  return g;
}

// ── EDIT (Image 1 + Images 2–10, 각 이미지별 드로잉 주석은 추가 레퍼런스로 취급) ────
export function buildEditGraph(state: Q21State): Record<string, any> {
  if (!state.editImage1) throw new Error("No Image 1 uploaded for Edit mode.");
  const { g, modelLink, clipLink, vaeLink } = buildBaseGraph(state);
  const promptText = buildPromptText(state, "edit");

  g[`${P}:loadImg1`] = { class_type: "LoadImage", inputs: { image: state.editImage1 } };
  const imageLinks: any[] = [[`${P}:loadImg1`, 0]];
  if (state.editAnnotImage) {
    g[`${P}:loadAnnot1`] = { class_type: "LoadImage", inputs: { image: state.editAnnotImage } };
    imageLinks.push([`${P}:loadAnnot1`, 0]);
  }

  if (state.editImage2) {
    g[`${P}:loadImg2`] = { class_type: "LoadImage", inputs: { image: state.editImage2 } };
    imageLinks.push([`${P}:loadImg2`, 0]);
  }

  (state.editRefImages || []).forEach((r, i) => {
    if (!r?.filename) return;
    const id = `${P}:editRef${i}`;
    g[id] = { class_type: "LoadImage", inputs: { image: r.filename } };
    imageLinks.push([id, 0]);
    const annot = state.editRefAnnotations?.[i];
    if (annot) {
      const aid = `${P}:editRefAnnot${i}`;
      g[aid] = { class_type: "LoadImage", inputs: { image: annot } };
      imageLinks.push([aid, 0]);
    }
  });

  const { posLink, negLink, latentLink } = addConditioning(g, clipLink, vaeLink, promptText, state.negativePrompt || "", state.width || 1024, imageLinks.slice(0, 10));
  addKSampler(g, modelLink, latentLink, state, 1.0, posLink, negLink);
  addDecodeAndSave(g, vaeLink, state);
  return g;
}

// ── INPAINT — 마스크 파일 없음: 원본 + 드로잉 주석을 2번째 레퍼런스로 사용 ─────────
export function buildInpaintGraph(state: Q21State): Record<string, any> {
  if (!state.inpaintImage) throw new Error("No source image for inpaint.");
  if (!state.inpaintAnnotImage) throw new Error("Draw on the image and commit the annotation first.");

  const { g, modelLink, clipLink, vaeLink } = buildBaseGraph(state);
  const promptText = buildPromptText(state, "inpaint");

  g[`${P}:loadImg1`] = { class_type: "LoadImage", inputs: { image: state.inpaintImage } };
  g[`${P}:loadAnnot`] = { class_type: "LoadImage", inputs: { image: state.inpaintAnnotImage } };

  const { posLink, negLink, latentLink } = addConditioning(g, clipLink, vaeLink, promptText, state.negativePrompt || "", state.width || 1024, [
    [`${P}:loadImg1`, 0],
    [`${P}:loadAnnot`, 0],
  ]);
  // SetLatentNoiseMask 없음 — 노드가 직접 만든 latent에서 완전 denoise, 전부 이미지 컨디셔닝.
  addKSampler(g, modelLink, latentLink, state, state.inpaintDenoise ?? 0.85, posLink, negLink);
  addDecodeAndSave(g, vaeLink, state);
  return g;
}

// ── OUTPAINT — ImagePadKJ 캔버스 확장 (2511과 동일한 접근) ─────────────────────
export function buildOutpaintGraph(state: Q21State): Record<string, any> {
  if (!state.inpaintImage) throw new Error("No source image for outpaint.");
  const total = (state.outpaintUp || 0) + (state.outpaintDown || 0) + (state.outpaintLeft || 0) + (state.outpaintRight || 0);
  if (total <= 0) throw new Error("Set at least one expansion value (Up/Down/Left/Right).");

  const { g, modelLink, clipLink, vaeLink } = buildBaseGraph(state);

  const padR = state.outpaintPadR ?? 0;
  const padG = state.outpaintPadG ?? 0;
  const padB = state.outpaintPadB ?? 0;
  const padColor = `rgb(${padR}, ${padG}, ${padB})`;
  const sysPrompt = `Extend the composition of this image. Replace all black or ${padColor} areas with a logical continuation of the background and foreground. Ensure the transition is invisible and the new elements perfectly match the perspective and color palette of the original image. Scene description: `;
  const promptText = sysPrompt + buildPromptText(state, "outpaint");

  g[`${P}:loadImg1`] = { class_type: "LoadImage", inputs: { image: state.inpaintImage } };
  g[`${P}:padImg`] = {
    class_type: "ImagePadKJ",
    inputs: {
      image: [`${P}:loadImg1`, 0],
      left: Math.max(0, state.outpaintLeft || 0),
      top: Math.max(0, state.outpaintUp || 0),
      right: Math.max(0, state.outpaintRight || 0),
      bottom: Math.max(0, state.outpaintDown || 0),
      extra_padding: 0,
      pad_mode: "color",
      color: `${padR}, ${padG}, ${padB}`,
    },
  };

  const { posLink, negLink, latentLink } = addConditioning(g, clipLink, vaeLink, promptText, state.negativePrompt || "", state.width || 1024, [[`${P}:padImg`, 0]]);
  addKSampler(g, modelLink, latentLink, state, 1.0, posLink, negLink);
  addDecodeAndSave(g, vaeLink, state);
  return g;
}

// ── UPSCALE (SeedVR2) — 모델 계열 독립, 2511과 동일 노드 세트 ────────────────
export function buildUpscaleGraph(state: Q21State): Record<string, any> {
  if (!state.upscaleImage) throw new Error("No source image uploaded for upscale.");
  if (!state.upscaleDitModel || state.upscaleDitModel === "none") throw new Error("Select a SeedVR2 DiT model.");
  if (!state.upscaleVaeModel || state.upscaleVaeModel === "none") throw new Error("Select a SeedVR2 VAE model.");

  const ditOffload = state.upscaleOffloadDevice && state.upscaleOffloadDevice !== "none" ? state.upscaleOffloadDevice : "cpu";
  const folder = state.saveSubfolder || SUBFOLDER;

  return {
    "UP:dit": { class_type: "SeedVR2LoadDiTModel", inputs: { model: state.upscaleDitModel, device: "cuda:0", blocks_to_swap: state.upscaleBlocksToSwap ?? 0, swap_io_components: false, offload_device: ditOffload, cache_model: ditOffload !== "none", attention_mode: state.upscaleAttentionMode || "sdpa" } },
    "UP:vae": { class_type: "SeedVR2LoadVAEModel", inputs: { model: state.upscaleVaeModel, device: "cuda:0", encode_tiled: true, encode_tile_size: 1024, encode_tile_overlap: 128, decode_tiled: true, decode_tile_size: 1024, decode_tile_overlap: 128, tile_debug: "false", offload_device: ditOffload, cache_model: false } },
    "UP:load": { class_type: "LoadImage", inputs: { image: state.upscaleImage } },
    "UP:run": { class_type: "SeedVR2VideoUpscaler", inputs: { image: ["UP:load", 0], dit: ["UP:dit", 0], vae: ["UP:vae", 0], seed: (state.seed ?? 42) % 4294967295, resolution: state.upscaleResolution ?? 2048, max_resolution: state.upscaleMaxResolution ?? 4096, batch_size: state.upscaleBatchSize ?? 1, uniform_batch_size: false, color_correction: state.upscaleColorCorrection || "lab", temporal_overlap: 0, prepend_frames: 0, input_noise_scale: state.upscaleInputNoiseScale ?? 0, latent_noise_scale: state.upscaleLatentNoiseScale ?? 0, offload_device: ditOffload, enable_debug: false } },
    "UP:save": { class_type: "SaveImage", inputs: { images: ["UP:run", 0], filename_prefix: `${folder}/Q21_up` } },
  };
}

export function buildGraph(state: Q21State): Record<string, any> {
  if (state.mode === "i2i") return state.i2iSubMode === "ref2img" ? buildRefToImageGraph(state) : buildI2IGraph(state);
  if (state.mode === "edit") return buildEditGraph(state);
  if (state.mode === "inpaint") return state.paintSubMode === "outpaint" ? buildOutpaintGraph(state) : buildInpaintGraph(state);
  if (state.mode === "upscale") return buildUpscaleGraph(state);
  return buildT2IGraph(state);
}
