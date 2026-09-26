// promptTools.ts — QWEN IMAGE 2.1 프롬프트 프리셋(📋 Prompt Preset) 오버레이.
// 원본 근거: one_node_qwen21.js는 `import("./klein/ui_prompt_templates.js")`로 공용 템플릿
// 오버레이를 열고 pool="nl"(자연어 공용 풀)만 사용한다 — 2511 TS 포트의 promptTools.ts처럼 모드별
// BUILT_IN 카테고리를 하드코딩하지 않는다(그건 그 포트가 원본 이상으로 얹은 것). 이 파일은 실제
// 노드 동작(공용 nl 풀의 커스텀 템플릿 저장/적용만)을 그대로 따른다.
import { C, el, clear } from "./core";
import { button, label as uiLabel, row, confirmDialog } from "../../shared/ui";
import { getTemplates, saveTemplates } from "../../shared/promptTemplatesApi";

export function createTemplateOverlay(_getMode: () => string, onApply: (prompt: string) => void) {
  const ov = el("div", { style: { position: "fixed", inset: "0", zIndex: "10001", background: "rgba(0,0,0,0.85)", display: "none", alignItems: "center", justifyContent: "center" } });
  const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px", width: "min(700px, 92vw)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" } });

  const hdr = el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
  hdr.append(el("div", { text: "📋 Prompt Preset", style: { color: "#fff", fontSize: "14px", fontWeight: "700", flex: "1" } }), button("✕", () => (ov.style.display = "none"), "danger"));
  box.appendChild(hdr);
  ov.appendChild(box);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.style.display = "none"; });

  const customHeader = el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
  customHeader.append(el("div", { text: "MY TEMPLATES", style: { color: C.muted, fontSize: "10px", fontWeight: "700", letterSpacing: "0.08em", flex: "1" } }));
  const addBtn = button("+ New", () => startEdit(null));
  customHeader.appendChild(addBtn);
  box.appendChild(customHeader);

  let customTemplates: { name: string; prompt: string }[] = [];
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
    if (!n || !p) { alert("Enter both a name and a prompt."); return; }
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
  function saveCustom() { saveTemplates("nl", customTemplates).catch(() => {}); }

  let loaded = false;
  return {
    el: ov,
    show() {
      ov.style.display = "flex";
      if (!loaded) {
        loaded = true;
        getTemplates("nl").then((templates) => {
          customTemplates = templates;
          renderCustom();
        }).catch(() => renderCustom());
      } else {
        renderCustom();
      }
    },
    hide() { ov.style.display = "none"; },
  };
}
