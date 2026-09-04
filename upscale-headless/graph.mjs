// graph.mjs — SeedVR2 image upscaler graph.
// Ported node-for-node from src/tools/krea2/graphBuilder.ts buildUpscaleGraph (identical node
// set in src/tools/zimage/graphBuilder.ts — only the save prefix differs). No diffusion model,
// no prompt: source image -> SeedVR2 DiT + VAE -> SaveImage.

const DEFAULTS = {
  resolution: 2048,
  maxResolution: 4096,
  batchSize: 1,
  blocksToSwap: 0,
  attentionMode: "sdpa", // sdpa | flash_attn_2 | flash_attn_3 | sageattn_2 | sageattn_3
  colorCorrection: "lab", // lab | wavelet | wavelet_adaptive | hsv | adain | none
  offloadDevice: "cpu", // cpu | none  (none = keep on GPU)
  inputNoiseScale: 0,
  latentNoiseScale: 0,
  seed: 42,
  saveSubfolder: "one_upscale",
};

export function buildUpscaleGraph(job) {
  const s = { ...DEFAULTS, ...job };
  if (!s.image) throw tag(new Error("job needs `image` (an absolute path to the source)."), "config");
  if (!s.ditModel || s.ditModel === "none") throw tag(new Error("job needs `ditModel` (a SeedVR2 DiT model filename)."), "config");
  if (!s.vaeModel || s.vaeModel === "none") throw tag(new Error("job needs `vaeModel` (a SeedVR2 VAE model filename)."), "config");

  const ditOffload = s.offloadDevice && s.offloadDevice !== "none" ? s.offloadDevice : "cpu";
  const folder = s.saveSubfolder || DEFAULTS.saveSubfolder;

  const graph = {
    "UP:dit": {
      class_type: "SeedVR2LoadDiTModel",
      inputs: {
        model: s.ditModel,
        device: "cuda:0",
        blocks_to_swap: s.blocksToSwap ?? 0,
        swap_io_components: false,
        offload_device: ditOffload,
        cache_model: ditOffload !== "none",
        attention_mode: s.attentionMode || "sdpa",
      },
    },
    "UP:vae": {
      class_type: "SeedVR2LoadVAEModel",
      inputs: {
        model: s.vaeModel,
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
    },
    "UP:load": { class_type: "LoadImage", inputs: { image: s.image } },
    "UP:run": {
      class_type: "SeedVR2VideoUpscaler",
      inputs: {
        image: ["UP:load", 0],
        dit: ["UP:dit", 0],
        vae: ["UP:vae", 0],
        seed: (s.seed ?? 42) % 4294967295,
        resolution: s.resolution ?? 2048,
        max_resolution: s.maxResolution ?? 4096,
        batch_size: s.batchSize ?? 1,
        uniform_batch_size: false,
        color_correction: s.colorCorrection || "lab",
        temporal_overlap: 0,
        prepend_frames: 0,
        input_noise_scale: s.inputNoiseScale ?? 0,
        latent_noise_scale: s.latentNoiseScale ?? 0,
        offload_device: ditOffload,
        enable_debug: false,
      },
    },
    "UP:save": { class_type: "SaveImage", inputs: { images: ["UP:run", 0], filename_prefix: `${folder}/UP` } },
  };

  return {
    graph,
    meta: {
      saveNode: "UP:save",
      ditModel: s.ditModel,
      vaeModel: s.vaeModel,
      resolution: s.resolution,
      maxResolution: s.maxResolution,
      seed: graph["UP:run"].inputs.seed,
    },
  };
}

function tag(err, stage) { err.stage = stage; return err; }
