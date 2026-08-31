// videoPicker.ts — pick a rendered clip as a reference video (SPEC_MINIMAX_H3_PER_CLIP_
// OVERRIDE.md §12; ported from ui_video_picker_minimax.js).
//
// A reference video is almost always something this tool made a moment ago, so browsing the
// output folder beats hunting for the file on disk and re-uploading a copy of it. The chosen
// clip is copied into ComfyUI's input folder, because that's the only place the loader nodes
// can read from.
import { el } from "../../shared/ui";
import { C, BRAND } from "../../identity";
import { copyOutputToInput, listVideos } from "./api";

/**
 * Open the picker. `onPick(inputFilename)` receives the name of the copy in input/.
 *
 * Hover plays the clip muted — with a wall of near-identical takes, a still first frame isn't
 * enough to tell them apart.
 */
export function openVideoGalleryPicker(onPick: (inputFilename: string) => void) {
  const box = el("div", {
    class: "flex flex-col overflow-hidden",
    style: { background: "#0e0e0e", border: `1px solid ${C.border}`, borderRadius: "10px", width: "860px", maxWidth: "94%", height: "80vh", boxShadow: "0 16px 50px rgba(0,0,0,0.65)" },
  });
  const head = el("div", { class: "flex items-center gap-2 shrink-0", style: { padding: "10px 12px", borderBottom: `1px solid ${C.border}` } }, [
    el("div", { text: "🎞 Pick a reference video", class: "flex-1", style: { color: "#fff", fontSize: "13px", fontWeight: "700" } }),
  ]);
  // A fixed cell height, not aspect-ratio: a <video> whose metadata hasn't loaded yet has no
  // intrinsic size, so the ratio resolves to nothing and every cell collapses to a ~21px
  // sliver — which also means every clip fits one screen and the grid never scrolls.
  const grid = el("div", { class: "grid overflow-y-auto", style: { padding: "12px", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "10px", flex: "1 1 auto", minHeight: "0" } });
  const status = el("div", { text: "loading…", class: "shrink-0", style: { padding: "8px 12px", fontSize: "11px", color: C.muted, borderTop: `1px solid ${C.border}` } });
  box.append(head, grid, status);

  const ov = el("div", { class: "fixed inset-0 z-[100050] flex items-center justify-center", style: { background: "rgba(0,0,0,0.72)" } }, [box]);
  const close = () => ov.remove();
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
  const closeBtn = el("button", { type: "button", text: "✕ Close", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "4px 10px", borderRadius: "6px", background: "transparent", color: C.err, border: `1px solid ${C.border}` } });
  closeBtn.addEventListener("click", close);
  head.appendChild(closeBtn);
  document.body.appendChild(ov);

  (async () => {
    let items: { filename: string; subfolder?: string }[] = [];
    try {
      const d = await listVideos(undefined, { limit: 120 });
      items = d.videos || [];
    } catch (e: any) {
      status.textContent = `Could not read the gallery: ${e?.message || e}`;
      return;
    }
    if (!items.length) {
      status.textContent = "No rendered clips yet.";
      return;
    }
    status.textContent = `${items.length} clips · hover to preview`;

    items.forEach((it) => {
      const url = `/view?filename=${encodeURIComponent(it.filename)}&subfolder=${encodeURIComponent(it.subfolder || "")}&type=output`;
      const cell = el("div", { class: "flex flex-col overflow-hidden cursor-pointer", style: { border: `1px solid ${C.border}`, borderRadius: "8px", background: "#000", height: "134px" } });
      const vid = el("video", { muted: "", playsinline: "", preload: "metadata", class: "block shrink-0", style: { width: "100%", height: "108px", objectFit: "cover", background: "#000" } }) as HTMLVideoElement;
      vid.src = url;
      vid.muted = true;
      cell.addEventListener("mouseenter", () => { vid.currentTime = 0; vid.play().catch(() => {}); cell.style.borderColor = BRAND; });
      cell.addEventListener("mouseleave", () => { vid.pause(); vid.currentTime = 0; cell.style.borderColor = C.border; });
      cell.append(vid, el("div", { text: it.filename, title: it.filename, class: "overflow-hidden text-ellipsis whitespace-nowrap", style: { fontSize: "9.5px", color: C.muted, padding: "4px 5px" } }));

      cell.addEventListener("click", async () => {
        status.textContent = "copying to input…";
        try {
          const copied = await copyOutputToInput(it.filename, it.subfolder || "", "output");
          close();
          onPick(copied);
        } catch (e: any) {
          status.textContent = `Could not use that clip: ${e?.message || e}`;
        }
      });
      grid.appendChild(cell);
    });
  })();
}
