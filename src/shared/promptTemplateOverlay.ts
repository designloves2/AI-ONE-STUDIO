// promptTemplateOverlay.ts — the 📋 Prompt Templates window shared by every image tool
// (port of node web/klein/ui_prompt_templates.js createTemplateOverlay).
//   - Tag presets: categorized chips per mode. "✎ Edit tags" turns them editable (rename /
//     delete / add category, click a tag to edit it, × to delete, + Tag, + Category, ↺ Reset
//     to defaults). A mode the user never customised shows the tool's built-in defaults and
//     the first edit copies them into the user's own list (/shared/prompt_categories).
//   - MY TEMPLATES: the user's saved prompts for this tool's own pool (/shared/prompt_templates).
import { C, BRAND } from "../identity";
import { el, clear, button, label as uiLabel, row, confirmDialog, alertDialog, promptDialog } from "./ui";
import {
  getTemplates, saveTemplates, getCategories, saveCategories,
  type PromptTemplate, type PromptTagCategory, type TemplatePool,
} from "./promptTemplatesApi";

export type BuiltInTags = Record<string, PromptTagCategory[]>;

export function createTemplateOverlay(
  pool: TemplatePool,
  getMode: () => string,
  onApply: (prompt: string) => void,
  builtIn: BuiltInTags = {},
) {
  const ov = el("div", { style: { position: "fixed", inset: "0", zIndex: "10001", background: "rgba(0,0,0,0.85)", display: "none", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px", width: "min(700px, 92vw)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" } });

  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
  hdr.appendChild(el("div", { text: "📋 Prompt Templates", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }));
  const closeBtn = button("✕", () => (ov.style.display = "none"), "danger");
  hdr.appendChild(closeBtn);
  box.appendChild(hdr);
  ov.appendChild(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.style.display = "none"; });

  // ── Tag presets: categorized chips, editable per mode ─────────────────────
  const builtInEl = el("div", { style: { display: "flex", flexDirection: "column", gap: "10px" } });
  box.appendChild(builtInEl);

  let userCats: Record<string, PromptTagCategory[]> = {};
  let catsLoaded = false;
  let manage = false;
  const manageBtn = button("✎ Edit tags", () => {
    if (!catsLoaded) { void alertDialog("Tag presets could not be loaded, so they can't be edited right now. Close and reopen this panel to retry."); return; }
    manage = !manage;
    manageBtn.textContent = manage ? "✓ Done" : "✎ Edit tags";
    renderBuiltIn();
  });
  hdr.insertBefore(manageBtn, closeBtn);

  const curMode = () => getMode() || "t2i";
  const modeCats = (): PromptTagCategory[] => userCats[curMode()] || JSON.parse(JSON.stringify(builtIn[curMode()] || []));
  function commitCats(next: PromptTagCategory[]) {
    userCats[curMode()] = next;
    saveCategories(pool, curMode(), next).catch(() => {});
    renderBuiltIn();
  }
  async function askText(msg: string, def = ""): Promise<string | null> {
    const v = await promptDialog(msg, def);
    return v === null ? null : v.trim() || null;
  }
  async function editTag(ci: number, ii: number | null) {
    const cats = modeCats();
    const cur = ii === null ? null : cats[ci].items[ii];
    const labelText = await askText("Tag name:", cur ? cur.label : "");
    if (!labelText) return;
    const promptText = await askText("Prompt:", cur ? cur.prompt : "");
    if (!promptText) return;
    const item = { ...(cur || {}), label: labelText, prompt: promptText };
    if (cur) cats[ci].items[ii as number] = item; else cats[ci].items.push(item);
    commitCats(cats);
  }

  function renderBuiltIn() {
    clear(builtInEl);
    const cats = modeCats();
    cats.forEach((cat, ci) => {
      if (!cat.items.length && !manage) return;

      const head = el("div", { style: { display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", flexWrap: "wrap" } });
      head.appendChild(el("div", { text: cat.cat, style: { color: C.muted, fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", textTransform: "uppercase" } }));
      if (manage) {
        head.appendChild(button("✎", async () => {
          const n = await askText("Category name:", cat.cat);
          if (n) { const c = modeCats(); c[ci].cat = n; commitCats(c); }
        }));
        head.appendChild(button("+ Tag", () => { void editTag(ci, null); }));
        head.appendChild(button("✕", async () => {
          if (!(await confirmDialog(`Delete category "${cat.cat}" and its ${cat.items.length} tags?`, { danger: true }))) return;
          const c = modeCats(); c.splice(ci, 1); commitCats(c);
        }, "danger"));
      }
      builtInEl.appendChild(head);

      const grid = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px" } });
      cat.items.forEach((item, ii) => {
        const btnEl = el("button", { type: "button", text: item.label, style: { cursor: "pointer", fontFamily: "inherit", fontSize: "11px", padding: "4px 10px", borderRadius: "14px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, whiteSpace: "nowrap" } });
        btnEl.onmouseenter = () => { btnEl.style.background = C.bg3; btnEl.style.borderColor = BRAND; btnEl.style.color = "#ffffff"; };
        btnEl.onmouseleave = () => { btnEl.style.background = C.bg2; btnEl.style.borderColor = C.border; btnEl.style.color = C.text; };
        if (manage) {
          btnEl.title = "Click to edit";
          btnEl.onclick = () => { void editTag(ci, ii); };
          const wrap = el("span", { style: { display: "inline-flex", alignItems: "center", gap: "2px" } }, [btnEl]);
          const del = el("button", { type: "button", text: "×", title: "Delete this tag", style: { cursor: "pointer", fontFamily: "inherit", fontSize: "12px", lineHeight: "1", padding: "2px 6px", borderRadius: "10px", background: "transparent", color: C.err || "#e55", border: "none" } });
          del.onclick = () => { const c = modeCats(); c[ci].items.splice(ii, 1); commitCats(c); };
          wrap.appendChild(del);
          grid.appendChild(wrap);
        } else {
          btnEl.onclick = () => { onApply(item.prompt); ov.style.display = "none"; };
          grid.appendChild(btnEl);
        }
      });
      builtInEl.appendChild(grid);
    });

    if (manage) {
      const foot = el("div", { style: { display: "flex", gap: "6px", marginTop: "4px", flexWrap: "wrap" } });
      foot.appendChild(button("+ Category", async () => {
        const n = await askText("New category name:");
        if (n) { const c = modeCats(); c.push({ cat: n, items: [] }); commitCats(c); }
      }));
      if (userCats[curMode()]) {
        foot.appendChild(button("↺ Reset to defaults", async () => {
          if (!(await confirmDialog("Discard your changes to this mode's tags and restore the defaults?", { danger: true }))) return;
          delete userCats[curMode()];
          saveCategories(pool, curMode(), null).catch(() => {});
          renderBuiltIn();
        }));
      }
      builtInEl.appendChild(foot);
    }
  }

  box.appendChild(el("div", { style: { borderTop: `1px solid ${C.border}`, margin: "4px 0" } }));

  // ── Custom templates section ──────────────────────────────────────────────
  const customHeader = el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
  customHeader.appendChild(el("div", { text: "MY TEMPLATES", style: { color: C.muted, fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", flex: "1" } }));
  const addBtn = button("+ New", () => startEdit(null));
  customHeader.appendChild(addBtn);
  box.appendChild(customHeader);

  let customTemplates: PromptTemplate[] = [];
  const listEl = el("div", { style: { display: "flex", flexDirection: "column", gap: "5px" } });
  box.appendChild(listEl);

  function renderCustom() {
    clear(listEl);
    if (!customTemplates.length) {
      listEl.appendChild(el("div", { text: "No saved templates. Add one with + New.", style: { color: C.muted, fontSize: "11px", padding: "8px 0" } }));
      return;
    }
    customTemplates.forEach((t, i) => {
      const card = el("div", { style: { background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "7px 10px", display: "flex", alignItems: "flex-start", gap: "8px" } });
      const info = el("div", { style: { flex: "1", minWidth: "0" } });
      info.append(
        el("div", { text: t.name, style: { color: C.text, fontSize: "12px", fontWeight: "600", marginBottom: "2px" } }),
        el("div", { text: t.prompt.slice(0, 100) + (t.prompt.length > 100 ? "…" : ""), style: { color: C.muted, fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } })
      );
      const applyBtn = button("Apply", () => { onApply(t.prompt); ov.style.display = "none"; }, "primary");
      const editBtn = button("Edit", () => startEdit(i));
      const delBtn = button("✕", async () => { if (!(await confirmDialog(`Delete "${t.name}"?`))) return; customTemplates.splice(i, 1); saveCustom(); renderCustom(); }, "danger");
      card.append(info, applyBtn, editBtn, delBtn);
      listEl.appendChild(card);
    });
  }

  const editForm = el("div", { style: { display: "none", flexDirection: "column", gap: "6px", padding: "10px", background: C.bg0, borderRadius: "8px", border: `1px solid ${C.border}` } });
  const nameIn = el("input", { type: "text", placeholder: "Template name…", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit" } }) as HTMLInputElement;
  const promptTA2 = el("textarea", { placeholder: "Prompt…", style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "7px", fontSize: "12px", fontFamily: "inherit", resize: "vertical", minHeight: "70px" } }) as HTMLTextAreaElement;
  editForm.append(uiLabel("Name"), nameIn, uiLabel("Prompt"), promptTA2);
  let editIdx: number | null = null;
  const saveEditBtn = button("💾 Save", () => {
    const n = nameIn.value.trim(), p = promptTA2.value.trim();
    if (!n || !p) { void alertDialog("Enter both a name and a prompt."); return; }
    if (editIdx === null) customTemplates.push({ name: n, prompt: p });
    else customTemplates[editIdx] = { name: n, prompt: p };
    saveCustom(); editForm.style.display = "none"; renderCustom();
  }, "primary");
  const cancelEditBtn = button("Cancel", () => { editForm.style.display = "none"; });
  editForm.appendChild(row([saveEditBtn, cancelEditBtn]));
  box.appendChild(editForm);

  function startEdit(idx: number | null) {
    editIdx = idx;
    nameIn.value = idx !== null ? customTemplates[idx].name : "";
    promptTA2.value = idx !== null ? customTemplates[idx].prompt : "";
    editForm.style.display = "flex";
  }

  // Saving writes the whole list, so it must never run on a list that failed to load —
  // that would replace the stored templates with an empty one plus the new entry.
  let loaded = false;
  function saveCustom() {
    if (!loaded) return;
    saveTemplates(pool, customTemplates).catch(() => {});
  }

  let loading = false;
  return {
    el: ov,
    show() {
      ov.style.display = "flex";
      renderBuiltIn();
      if (!loaded && !loading) {
        loading = true;
        getTemplates(pool).then((templates) => {
          customTemplates = templates;
          loaded = true;
          renderCustom();
        }).catch(() => renderCustom()).finally(() => { loading = false; });
      }
      if (!catsLoaded) {
        getCategories(pool).then((cats) => {
          userCats = cats;
          catsLoaded = true;
          renderBuiltIn();
        }).catch(() => {});
      }
    },
    hide() { ov.style.display = "none"; },
  };
}
