// graphBuilder.ts — Moss Image 워크플로우 그래프 빌더.
// 원본 근거: ComfyUI-TJ_NODE_STUDIO_ONE/web/moss/graph_builder_moss.js (node f730ee9, ca925eb) — 노드 ID(MS:*)/class_type/inputs 1:1 이식.
//
// Graphs follow ComfyUI's MOSS-Image templates (image_moss_image_t2i / image_moss_image_t2i_bboxes):
// UNETLoader -> (LoRAs) -> (SkipLayerGuidanceDiTSimple) -> KSampler, CLIPLoader type "moss_image",
// EmptyFlux2LatentImage, VAEDecode. R2I turns the drawn boxes into the model's layout prompt.
import { SUBFOLDER, DEFAULT_STEPS, DEFAULT_CFG, DEFAULT_NEGATIVE, snap16, workSize, type MossState } from "./core";

/** Id of the SaveImage / PreviewImage node: the only node whose result counts (R2I's CreateBoundingBoxes has its own preview). */
export const OUTPUT_NODE = "MS:save";

type Link = [string, number];

function withLoraChain(g: Record<string, any>, prefix: string, modelLink: Link, loras: MossState["loras"]): Link {
  let out = modelLink;
  (loras || []).forEach((lora, i) => {
    if (!lora.name || lora.name === "none" || lora.enabled === false) return;
    const strength = parseFloat(String(lora.strength ?? 0.8));
    if (!(strength > 0)) return;
    const id = `${prefix}${i}`;
    g[id] = { class_type: "LoraLoaderModelOnly", inputs: { model: out, lora_name: lora.name, strength_model: strength } };
    out = [id, 0];
  });
  return out;
}

function promptFor(state: MossState, modeKey: string): string {
  return state.promptsByMode && modeKey in state.promptsByMode ? state.promptsByMode[modeKey] : state.prompt || "";
}

function saveNode(link: Link, state: MossState) {
  if (state?.outputMode === "preview") return { class_type: "PreviewImage", inputs: { images: link } };
  const folder = state?.saveSubfolder || SUBFOLDER;
  return { class_type: "SaveImage", inputs: { images: link, filename_prefix: `${folder}/Moss` } };
}

// Shared prelude: loaders, LoRAs, optional skip-layer guidance and the negative prompt. The positive prompt is added
// by each mode (R2I builds it from the layout nodes).
function baseGraph(state: MossState) {
  const modelName = state.model || "";
  const clipName = state.textEncoder || "";
  const vaeName = state.vae || "";
  if (!modelName) throw new Error("No diffusion model selected. Please set one in ⚙ Settings.");
  if (!clipName) throw new Error("No text encoder selected. Please set one in ⚙ Settings.");
  if (!vaeName) throw new Error("No VAE selected. Please set one in ⚙ Settings.");

  const g: Record<string, any> = {};
  g["MS:unet"] = modelName.toLowerCase().endsWith(".gguf")
    ? { class_type: "UnetLoaderGGUF", inputs: { unet_name: modelName } }
    : { class_type: "UNETLoader", inputs: { unet_name: modelName, weight_dtype: "default" } };
  g["MS:clip"] = { class_type: "CLIPLoader", inputs: { clip_name: clipName, type: "moss_image", device: "default" } };
  g["MS:vae"] = { class_type: "VAELoader", inputs: { vae_name: vaeName } };

  let modelOut = withLoraChain(g, "MS:lora", ["MS:unet", 0], state.loras || []);
  if (state.slgEnabled) {
    g["MS:slg"] = {
      class_type: "SkipLayerGuidanceDiTSimple",
      inputs: { model: modelOut, double_layers: "", single_layers: state.slgLayers ?? "22", start_percent: state.slgStart ?? 0, end_percent: state.slgEnd ?? 0.5 },
    };
    modelOut = ["MS:slg", 0];
  }

  g["MS:negative"] = { class_type: "CLIPTextEncode", inputs: { clip: ["MS:clip", 0], text: (state.negativePrompt || "").trim() || DEFAULT_NEGATIVE } };
  return { g, modelOut };
}

function positive(g: Record<string, any>, textOrLink: string | Link): Link {
  g["MS:positive"] = { class_type: "CLIPTextEncode", inputs: { clip: ["MS:clip", 0], text: textOrLink } };
  return ["MS:positive", 0];
}

function sample(g: Record<string, any>, state: MossState, o: { model: Link; positiveLink: Link; latent: Link; denoise?: number }) {
  g["MS:sampler"] = {
    class_type: "KSampler",
    inputs: {
      model: o.model, positive: o.positiveLink, negative: ["MS:negative", 0], latent_image: o.latent,
      seed: state.seed ?? 0, steps: state.steps ?? DEFAULT_STEPS, cfg: state.cfg ?? DEFAULT_CFG,
      sampler_name: state.sampler || "er_sde", scheduler: state.scheduler || "simple",
      denoise: o.denoise ?? 1,
    },
  };
  g["MS:decode"] = { class_type: "VAEDecode", inputs: { samples: ["MS:sampler", 0], vae: ["MS:vae", 0] } };
  g[OUTPUT_NODE] = saveNode(["MS:decode", 0], state);
  return g;
}

function emptyLatent(g: Record<string, any>, state: MossState): Link {
  const { w, h } = workSize(state);
  g["MS:latent"] = { class_type: "EmptyFlux2LatentImage", inputs: { width: w, height: h, batch_size: 1 } };
  return ["MS:latent", 0];
}

// ── T2I ──────────────────────────────────────────────────────────────────────
export function buildT2IGraph(state: MossState) {
  const { g, modelOut } = baseGraph(state);
  return sample(g, state, { model: modelOut, positiveLink: positive(g, promptFor(state, "t2i")), latent: emptyLatent(g, state) });
}

// ── I2I: the source goes through the VAE and is re-noised by `denoise` ───────────
export function buildI2IGraph(state: MossState) {
  if (!state.i2iImage) throw new Error("No source image uploaded for I2I.");
  const { g, modelOut } = baseGraph(state);
  g["MS:src"] = { class_type: "LoadImage", inputs: { image: state.i2iImage } };
  g["MS:fit"] = {
    class_type: "ImageScale",
    inputs: { image: ["MS:src", 0], upscale_method: "lanczos", width: snap16(state.i2iWidth || state.width || 1024), height: snap16(state.i2iHeight || state.height || 1024), crop: "center" },
  };
  g["MS:encode"] = { class_type: "VAEEncode", inputs: { pixels: ["MS:fit", 0], vae: ["MS:vae", 0] } };
  return sample(g, state, { model: modelOut, positiveLink: positive(g, promptFor(state, "i2i")), latent: ["MS:encode", 0], denoise: state.i2iDenoise ?? 0.6 });
}

// ── INPAINT: latent noise mask + DifferentialDiffusion (same route as Z-Image's inpaint) ──
export function buildInpaintGraph(state: MossState) {
  if (!state.inpaintImage) throw new Error("No source image uploaded for INPAINT.");
  if (!state.inpaintMask) throw new Error("No mask: paint the area to repaint.");
  const { g, modelOut } = baseGraph(state);
  const w = snap16(state.inpaintWidth || state.width || 1024), h = snap16(state.inpaintHeight || state.height || 1024);
  g["MS:diff"] = { class_type: "DifferentialDiffusion", inputs: { model: modelOut } };
  g["MS:src"] = { class_type: "LoadImage", inputs: { image: state.inpaintImage } };
  g["MS:msrc"] = { class_type: "LoadImage", inputs: { image: state.inpaintMask } };
  g["MS:fit"] = { class_type: "ImageScale", inputs: { image: ["MS:src", 0], upscale_method: "lanczos", width: w, height: h, crop: "center" } };
  g["MS:mfit"] = { class_type: "ImageScale", inputs: { image: ["MS:msrc", 0], upscale_method: "nearest-exact", width: w, height: h, crop: "center" } };
  g["MS:mask"] = { class_type: "ImageToMask", inputs: { image: ["MS:mfit", 0], channel: "red" } };
  g["MS:encode"] = { class_type: "VAEEncode", inputs: { pixels: ["MS:fit", 0], vae: ["MS:vae", 0] } };
  g["MS:nmask"] = { class_type: "SetLatentNoiseMask", inputs: { samples: ["MS:encode", 0], mask: ["MS:mask", 0] } };
  return sample(g, state, { model: ["MS:diff", 0], positiveLink: positive(g, promptFor(state, "inpaint")), latent: ["MS:nmask", 0], denoise: state.inpaintDenoise ?? 1 });
}

// ── R2I (bboxes): boxes + prompt -> MOSSImageLayoutPrompt -> CLIPTextEncode ──────
export function buildR2IGraph(state: MossState) {
  const boxes = (state.r2iBoxes || []).filter((b) => b && b.width > 0 && b.height > 0);
  if (!boxes.length) throw new Error("Draw at least one box in R2I mode.");
  const { g, modelOut } = baseGraph(state);
  const { w: width, h: height } = workSize(state);
  // a list of exactly two boxes would read as a [node, slot] link; ComfyUI unwraps __value__
  g["MS:boxes"] = { class_type: "CreateBoundingBoxes", inputs: { width, height, editor_state: { __value__: boxes } } };
  g["MS:layout"] = {
    class_type: "MOSSImageLayoutPrompt",
    inputs: { prompt: promptFor(state, "r2i"), element: ["MS:boxes", 2], width, height, character_boxes: state.r2iCharacters || "" },
  };
  return sample(g, state, { model: modelOut, positiveLink: positive(g, ["MS:layout", 0]), latent: emptyLatent(g, state) });
}
