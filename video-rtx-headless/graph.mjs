// graph.mjs — RTX video upscale / deblur graph.
// Ported node-for-node from src/tools/minimax_h3/graphBuilder.ts buildUpscaleGraph, keeping only
// the RTX path (RTXVideoSuperResolution + TJ_RTXDeblur — both NVIDIA RTX Video SDK nodes). No
// ESRGAN/model upscale, no RIFE interpolation — RTX only, on purpose.
//
//   VHS_LoadVideo -> [TJ_RTXDeblur] -> [RTXVideoSuperResolution] -> CreateVideo -> SaveVideo

const QUALITIES = ["LOW", "MEDIUM", "HIGH", "ULTRA"];
const DEFAULT_FPS = 24; // studio clips are 24fps; override per job if the source differs

function normQuality(q, fallback = "HIGH") {
  const u = String(q || "").toUpperCase();
  return QUALITIES.includes(u) ? u : fallback;
}

/**
 * @param {string} video   filename already in ComfyUI's input/ (from uploadImage)
 * @param {object} job      { op:"upscale"|"deblur"|"both", scale?, quality?, fps?, saveSubfolder? }
 */
export function buildVideoRtxGraph(video, job = {}) {
  const op = job.op || (job.scale ? "upscale" : "deblur");
  const doDeblur = op === "deblur" || op === "both";
  const doUpscale = op === "upscale" || op === "both";
  if (!doDeblur && !doUpscale) throw tag(new Error(`unknown op "${op}" — use "upscale", "deblur" or "both".`), "config");

  const fps = Number(job.fps) > 0 ? Number(job.fps) : DEFAULT_FPS;
  const folder = (job.saveSubfolder || "one_video_rtx").replace(/\\/g, "/");
  const stem = baseName(video).replace(/\.[^.]+$/, "");

  const g = {};
  g.load = {
    class_type: "VHS_LoadVideo",
    inputs: { video, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1 },
  };
  let images = ["load", 0];

  const deblurQ = doDeblur ? normQuality(job.quality, "HIGH") : null;
  if (doDeblur) {
    g.deblur = { class_type: "TJ_RTXDeblur", inputs: { images, strength: deblurQ } };
    images = ["deblur", 0];
  }

  let scale = null;
  let upscaleQ = null;
  if (doUpscale) {
    scale = Number(job.scale) > 0 ? Number(job.scale) : 2.0;
    upscaleQ = normQuality(job.quality, "HIGH");
    g.rtx = {
      class_type: "RTXVideoSuperResolution",
      inputs: { images, resize_type: "scale by multiplier", "resize_type.scale": scale, quality: upscaleQ },
    };
    images = ["rtx", 0];
  }

  const suffix = op === "deblur" ? "_deblur" : op === "both" ? "_deblur_upscaled" : "_upscaled";
  g.video = { class_type: "CreateVideo", inputs: { images, fps, audio: ["load", 2] } };
  g.save = { class_type: "SaveVideo", inputs: { video: ["video", 0], filename_prefix: `${folder}/${stem}${suffix}`, format: "auto", codec: "auto" } };

  return { graph: g, meta: { saveNode: "save", op, deblurQuality: deblurQ, upscaleQuality: upscaleQ, scale, fps } };
}

function baseName(p) {
  const s = String(p).replace(/\\/g, "/");
  return s.slice(s.lastIndexOf("/") + 1);
}
function tag(err, stage) { err.stage = stage; return err; }
