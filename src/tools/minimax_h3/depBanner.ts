// depBanner.ts — "backend node packs are missing" notice for MiniMax H3.
//
// Mirrors the node pack's dependency banner (v1.20.3). Guidance only: there is
// no in-app installer. The web app is served over a public tunnel, so a backend
// route that runs a git-clone + pip-install script is out of scope. The
// supported path is documented in the README "Setup" section — run the setup
// script from a terminal, then restart ComfyUI.
//
// The node's /minimax_h3_one/node_availability route reports install_dir plus
// the script filenames so this notice can name the exact file to run.
import { C } from "../../identity";
import { el, clear } from "../../shared/ui";
import type { NodeAvailability } from "./api";

function scriptPaths(av: NodeAvailability) {
  const dir = av.install_dir || "the ComfyUI-TJ_NODE_STUDIO_ONE folder";
  return [
    { label: "Windows", path: `${dir}\\${av.install_script_win || "install_requirements.bat"}` },
    { label: "macOS / Linux", path: `${dir}/${av.install_script_nix || "install_requirements.sh"}` },
  ];
}

async function copyText(s: string) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    const t = el("textarea");
    t.value = s;
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy"); } catch {}
    t.remove();
  }
}

/** The "which script to run" block — one row per platform with a Copy button.
 *  Returns null when nothing is missing. Used in the Settings pack-status panel
 *  and inside the view banner. */
export function buildDepFix(av: NodeAvailability): HTMLElement | null {
  const mc = av.missing_core || [];
  const mo = av.missing_optional || [];
  if (!mc.length && !mo.length) return null;

  const wrap = el("div", { style: { display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px" } });
  wrap.appendChild(el("div", {
    html: "ComfyUI-Manager installs this pack's Python requirements but <b>not</b> the other node packs. "
      + "Run the setup script for your platform from a terminal, then restart ComfyUI:",
    style: { fontSize: "10px", lineHeight: "1.6", color: C.muted },
  }));
  for (const { label, path } of scriptPaths(av)) {
    const rowEl = el("div", { style: { display: "flex", alignItems: "stretch", gap: "5px", marginTop: "3px" } });
    rowEl.appendChild(el("span", { text: label, style: {
      flexShrink: "0", alignSelf: "center", fontSize: "10px", color: C.muted, width: "78px",
    } }));
    rowEl.appendChild(el("code", { text: path, style: {
      flex: "1", fontFamily: "ui-monospace, Consolas, monospace", fontSize: "10.5px",
      background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "6px",
      padding: "5px 8px", color: C.text, userSelect: "text", whiteSpace: "pre-wrap", wordBreak: "break-all",
    } }));
    const copyBtn = el("button", { type: "button", text: "Copy path", title: `Copy the ${label} script path`, style: {
      flexShrink: "0", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", fontWeight: "700",
      border: `1px solid ${C.border}`, borderRadius: "6px", background: C.bg2, color: C.text, padding: "0 9px",
    } });
    copyBtn.addEventListener("click", async () => {
      await copyText(path);
      copyBtn.textContent = "Copied";
      setTimeout(() => { copyBtn.textContent = "Copy path"; }, 1500);
    });
    rowEl.appendChild(copyBtn);
    wrap.appendChild(rowEl);
  }
  return wrap;
}

/** Persistent, dismissible strip for the top of the MiniMax H3 view. Re-render
 *  on every availability refresh; hides itself when nothing is missing or the
 *  user dismissed it for this page load. */
export function renderDepBanner(host: HTMLElement, av: NodeAvailability | undefined, dismissedRef: { v: boolean }) {
  const mc = av?.missing_core || [];
  const mo = av?.missing_optional || [];
  if (!av || dismissedRef.v || (!mc.length && !mo.length)) {
    host.style.display = "none";
    return;
  }
  const isCore = mc.length > 0;
  clear(host);
  host.style.display = "flex";
  host.style.flexDirection = "column";
  host.style.gap = "4px";
  host.style.padding = "8px 12px";
  host.style.fontSize = "11px";
  host.style.lineHeight = "1.5";
  host.style.background = isCore ? "rgba(255,90,90,0.12)" : "rgba(255,179,71,0.12)";
  host.style.borderBottom = `1px solid ${isCore ? "#ff5a5a" : C.warn}`;
  host.style.color = isCore ? "#ff8a8a" : C.warn;

  const head = el("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
  head.appendChild(el("span", {
    text: isCore
      ? `⚠ Required node packs missing — MiniMax H3 cannot render (${mc.length}).`
      : `⚠ ${mo.length} optional node pack${mo.length > 1 ? "s" : ""} not installed — the matching features stay off.`,
    style: { flex: "1", fontWeight: "700" },
  }));
  const x = el("span", { text: "✕", title: "Dismiss until reload", style: { cursor: "pointer", padding: "0 4px" } });
  x.addEventListener("click", () => { dismissedRef.v = true; host.style.display = "none"; });
  head.appendChild(x);
  host.appendChild(head);

  if (isCore) host.appendChild(el("div", { text: mc.join(", "), style: { opacity: "0.9", wordBreak: "break-word" } }));

  const fix = buildDepFix(av);
  if (fix) host.appendChild(fix);
  host.appendChild(el("div", {
    text: "More detail: Settings ⚙ → Third-party pack status.",
    style: { color: C.muted, fontSize: "10px", marginTop: "3px" },
  }));
}
