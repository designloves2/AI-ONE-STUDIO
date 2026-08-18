// ui.ts — 원본 6개 도구가 공유하던 ui_common.js의 el()-기반 헬퍼를 그대로 이식.
// 정사각형 고정폭 대신 %/flex 기반이라 웹 레이아웃에서도 그대로 쓸 수 있다.
import { C, BRAND } from "../identity";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Record<string, any>,
  children?: (Node | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const k in props) {
      if (k === "style") Object.assign(node.style, props.style);
      else if (k === "text") node.textContent = props.text;
      else if (k === "html") node.innerHTML = props.html;
      else if (k.startsWith("on") && typeof props[k] === "function")
        node.addEventListener(k.slice(2), props[k]);
      else (node as any).setAttribute(k, props[k]);
    }
  }
  (children || []).forEach((c) => {
    if (c) node.appendChild(c);
  });
  return node;
}

export function clear(node: Node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function panel(children: (Node | null | undefined)[], extraStyle?: Partial<CSSStyleDeclaration>) {
  return el(
    "div",
    {
      style: Object.assign(
        { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "10px", marginBottom: "6px" },
        extraStyle || {}
      ),
    },
    children
  );
}

export function label(text: string) {
  return el("div", { text, style: { color: C.muted, fontSize: "11px", marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.04em" } });
}

export function button(text: string, onClick: ((e: Event) => void) | null, variant: "default" | "primary" | "danger" = "default") {
  const styles = {
    default: { background: C.bg2, color: C.text, border: `1px solid ${C.border}` },
    primary: { background: BRAND, color: "#ffffff", border: `1px solid ${BRAND}`, fontWeight: "600" },
    danger: { background: C.bg2, color: C.err, border: `1px solid ${C.border}` },
  } as const;
  const s = styles[variant];
  const b = el("button", {
    text,
    type: "button",
    style: Object.assign({ cursor: "pointer", borderRadius: "6px", padding: "7px 12px", fontSize: "12px", fontFamily: "inherit", transition: "filter 0.1s" }, s),
    onclick: onClick,
    onmouseenter: () => (b.style.filter = "brightness(1.15)"),
    onmouseleave: () => (b.style.filter = "none"),
  });
  return b;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function select(options: (SelectOption | string)[], value: string, onChange: (v: string) => void) {
  const s = el(
    "select",
    {
      style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit", outline: "none" },
      onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
    },
    options.map((opt) => {
      const v = typeof opt === "string" ? opt : opt.value;
      const txt = typeof opt === "string" ? opt : opt.label;
      const dis = typeof opt === "object" && opt.disabled;
      return el("option", { value: v, text: txt, ...(dis ? { disabled: "disabled" } : {}), ...(v === value ? { selected: "selected" } : {}) });
    })
  );
  return s;
}

export function numberField(value: number, onInput: (v: number) => void, step = 1) {
  const i = el("input", {
    type: "number",
    step,
    style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "6px", fontSize: "12px", fontFamily: "inherit", outline: "none" },
  });
  i.value = String(value);
  i.addEventListener("input", () => onInput(parseFloat(i.value) || 0));
  return i;
}

export function row(children: (Node | null | undefined)[], gap = "6px") {
  return el("div", { style: { display: "flex", gap, alignItems: "flex-start", flexWrap: "wrap" } }, children);
}

export function col(children: (Node | null | undefined)[], gap = "4px") {
  return el("div", { style: { display: "flex", flexDirection: "column", gap, flex: "1", minWidth: "0" } }, children);
}

export interface ModePillMeta {
  key: string;
  label: string;
  enabled?: boolean;
  reason?: string;
}

export function modeBar(modes: ModePillMeta[], activeKey: string, onSelect: (key: string) => void) {
  const wrap = el("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap" } });
  modes.forEach((m) => {
    const active = m.key === activeKey;
    const off = m.enabled === false;
    const btn = el("button", {
      text: m.label,
      type: "button",
      style: {
        cursor: off ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        fontSize: "12px",
        padding: "5px 12px",
        borderRadius: "20px",
        background: active ? BRAND : C.bg2,
        color: off ? C.muted : active ? "#ffffff" : C.text,
        border: `1px solid ${active ? BRAND : C.border}`,
        fontWeight: active ? "700" : "400",
        opacity: off ? "0.45" : "1",
      },
      onclick: () => {
        if (!off) onSelect(m.key);
      },
    });
    if (off && m.reason) btn.title = m.reason;
    wrap.appendChild(btn);
  });
  return wrap;
}

export interface SearchableSelectHandle {
  el: HTMLElement;
  setValue(v: string): void;
  setOptions(opts: string[]): void;
  value: string;
}

export function searchableSelect(initialOptions: string[], value: string, onChange: (v: string) => void): SearchableSelectHandle {
  let options = initialOptions;
  const wrap = el("div", { style: { position: "relative", width: "100%" } });
  const filterIn = el("input", {
    type: "text",
    placeholder: "검색…",
    style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px 6px 0 0", padding: "5px 8px", fontSize: "11px", fontFamily: "inherit", outline: "none" },
  });
  let currentValue = value;
  const s = el("select", {
    style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderTopWidth: "0", borderRadius: "0 0 6px 6px", padding: "5px", fontSize: "12px", fontFamily: "inherit", outline: "none" },
    onchange: (e: Event) => {
      currentValue = (e.target as HTMLSelectElement).value;
      s.title = currentValue;
      onChange(currentValue);
    },
  });
  function buildOptions(filter: string) {
    const q = filter.toLowerCase();
    s.replaceChildren(
      ...options.filter((o) => !q || o.toLowerCase().includes(q)).map((o) => el("option", { value: o, text: o, title: o, ...(o === currentValue ? { selected: "selected" } : {}) }))
    );
    if (options.includes(currentValue)) s.value = currentValue;
    else if (options.length) s.value = options[0];
    s.title = s.value || "";
  }
  buildOptions("");
  filterIn.addEventListener("input", () => {
    buildOptions(filterIn.value);
    if (options.includes(currentValue)) s.value = currentValue;
  });
  wrap.append(filterIn, s);
  return {
    el: wrap,
    setValue(v: string) {
      s.value = v;
      s.title = v || "";
    },
    setOptions(opts: string[]) {
      options = opts;
      buildOptions(filterIn.value);
    },
    get value() {
      return s.value;
    },
  };
}

export function iconBtn(icon: string, title: string, onClick: (e: Event) => void) {
  const b = el("button", {
    text: icon,
    type: "button",
    title,
    style: { cursor: "pointer", fontSize: "15px", width: "30px", height: "30px", borderRadius: "7px", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, padding: "0", lineHeight: "1" },
    onclick: onClick,
    onmouseenter: () => (b.style.background = C.bg3),
    onmouseleave: () => (b.style.background = C.bg2),
  });
  return b;
}

export function checkboxRow(text: string, checked: boolean, onChange: (v: boolean) => void, opts?: { disabled?: boolean; title?: string }) {
  const { disabled = false, title = "" } = opts || {};
  const chk = el("input", { type: "checkbox" });
  chk.checked = !!checked;
  chk.disabled = disabled;
  chk.addEventListener("change", () => onChange(chk.checked));
  const lbl = el(
    "label",
    { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: disabled ? C.muted : C.text, cursor: disabled ? "default" : "pointer" } },
    [chk, el("span", { text })]
  );
  if (title) lbl.title = title;
  return lbl;
}

export function openFullscreen(url: string, kind: "image" | "video" = "image") {
  let kh: ((e: KeyboardEvent) => void) | null = null;
  const ov = el("div", { style: { position: "fixed", inset: "0", background: "rgba(0,0,0,0.95)", zIndex: "99999", display: "flex", alignItems: "center", justifyContent: "center" } });
  const media =
    kind === "video"
      ? el("video", { src: url, controls: "", autoplay: "", style: { maxWidth: "95vw", maxHeight: "95vh", objectFit: "contain", borderRadius: "6px" } })
      : el("img", { src: url, style: { maxWidth: "95vw", maxHeight: "95vh", objectFit: "contain", borderRadius: "6px", userSelect: "none" } });
  const closeBtn = el("button", {
    text: "✕",
    type: "button",
    style: { position: "fixed", top: "16px", right: "16px", background: "rgba(40,40,40,0.9)", color: "#fff", border: "none", borderRadius: "50%", width: "40px", height: "40px", fontSize: "18px", cursor: "pointer", zIndex: "1" },
  });
  function close() {
    if (kh) document.removeEventListener("keydown", kh);
    document.body.removeChild(ov);
  }
  kh = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", kh);
  ov.addEventListener("click", (e) => {
    if (e.target === ov) close();
  });
  closeBtn.addEventListener("click", close);
  ov.append(media, closeBtn);
  document.body.appendChild(ov);
}

// confirmDialog/promptDialog — 프리뷰 브라우저 환경에서 window.confirm()/prompt() 같은
// 네이티브 다이얼로그가 차단되어 조용히 false/null을 반환하는 문제(Reset 버튼 등이 "안 먹는"
// 원인)를 피하기 위한 자체 오버레이 구현. 반드시 이 둘을 사용하고 네이티브 confirm/prompt는 쓰지 않는다.
export function confirmDialog(message: string, opts?: { okText?: string; cancelText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const ov = el("div", { style: { position: "fixed", inset: "0", background: "rgba(0,0,0,0.6)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center" } });
    const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "18px", width: "min(380px, 88vw)", boxShadow: "0 10px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: "14px" } });
    box.appendChild(el("div", { text: message, style: { color: C.text, fontSize: "13px", lineHeight: "1.5", whiteSpace: "pre-wrap" } }));
    const btnRow = el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px" } });
    function finish(v: boolean) {
      document.removeEventListener("keydown", onKey);
      document.body.removeChild(ov);
      resolve(v);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
      if (e.key === "Enter") finish(true);
    };
    const cancelBtn = button(opts?.cancelText || "취소", () => finish(false));
    const okBtn = button(opts?.okText || "확인", () => finish(true), opts?.danger ? "danger" : "primary");
    btnRow.append(cancelBtn, okBtn);
    box.appendChild(btnRow);
    ov.appendChild(box);
    ov.addEventListener("click", (e) => { if (e.target === ov) finish(false); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(ov);
    okBtn.focus();
  });
}

export function promptDialog(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const ov = el("div", { style: { position: "fixed", inset: "0", background: "rgba(0,0,0,0.6)", zIndex: "100000", display: "flex", alignItems: "center", justifyContent: "center" } });
    const box = el("div", { style: { background: C.bg1, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "18px", width: "min(380px, 88vw)", boxShadow: "0 10px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: "14px" } });
    box.appendChild(el("div", { text: message, style: { color: C.text, fontSize: "13px", lineHeight: "1.5", whiteSpace: "pre-wrap" } }));
    const input = el("input", { type: "text", value: defaultValue, style: { width: "100%", boxSizing: "border-box", background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "8px", fontSize: "13px", fontFamily: "inherit", outline: "none" } }) as HTMLInputElement;
    box.appendChild(input);
    const btnRow = el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px" } });
    function finish(v: string | null) {
      document.removeEventListener("keydown", onKey);
      document.body.removeChild(ov);
      resolve(v);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(null);
      if (e.key === "Enter") finish(input.value);
    };
    const cancelBtn = button("취소", () => finish(null));
    const okBtn = button("확인", () => finish(input.value), "primary");
    btnRow.append(cancelBtn, okBtn);
    box.appendChild(btnRow);
    ov.appendChild(box);
    ov.addEventListener("click", (e) => { if (e.target === ov) finish(null); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(ov);
    input.focus();
    input.select();
  });
}

// applyMobileCollapsibleLayout — 767px 이하(휴대폰)에서만 leftPanel(설정)과
// rightPanel(프롬프트/생성 결과)을 세로로 쌓고 각각 접었다 펼 수 있게 만든다.
// PC/태블릿에서는 아무 영향 없음(CSS 미디어 쿼리로만 동작 — style.css 참고).
// leftBottomBar(시드/Generate 버튼)는 접히지 않고 leftPanel 맨 아래에 항상 남는다.
function collapsibleHeader(title: string, contentEl: HTMLElement, defaultOpen: boolean) {
  contentEl.classList.add("aos-collapse-content");
  if (!defaultOpen) contentEl.classList.add("aos-collapsed");
  const chevron = el("span", { text: defaultOpen ? "▾" : "▸" });
  const header = el(
    "button",
    {
      type: "button",
      class: "aos-collapse-header",
      style: { width: "100%", boxSizing: "border-box", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "8px", color: C.text, fontSize: "12px", fontWeight: "700", cursor: "pointer", marginBottom: "6px" },
    },
    [el("span", { text: title }), chevron]
  );
  header.addEventListener("click", () => {
    const collapsed = contentEl.classList.toggle("aos-collapsed");
    chevron.textContent = collapsed ? "▸" : "▾";
  });
  return header;
}

export function applyMobileCollapsibleLayout(body: HTMLElement, leftPanel: HTMLElement, leftScroll: HTMLElement, rightPanel: HTMLElement) {
  body.classList.add("aos-body");
  leftPanel.classList.add("aos-left-panel");
  rightPanel.classList.add("aos-right-panel");

  const rightContent = el("div", { style: { display: "flex", flexDirection: "column", gap: "8px", flex: "1", minHeight: "0" } });
  Array.from(rightPanel.children).forEach((child) => rightContent.appendChild(child));
  rightPanel.append(collapsibleHeader("프롬프트 / 생성 결과", rightContent, true), rightContent);

  leftPanel.insertBefore(collapsibleHeader("설정", leftScroll, true), leftScroll);
}
