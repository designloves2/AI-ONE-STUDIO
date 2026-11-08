// viewScope.ts — timers and global listeners that belong to the tool screen currently shown.
// router.ts re-renders the whole screen on every hash change, so a view that starts a setInterval or adds a document / window
// listener itself must give it back when the screen is replaced; otherwise every visit adds another copy that keeps running
// (e.g. one more ComfyUI /queue poll every 4 s, also on the landing page). Register through these helpers and the router calls
// disposeView() before it draws the next screen.
const cleanups: Array<() => void> = [];

/** setInterval that stops when the current screen is replaced. */
export function viewInterval(fn: () => void, ms: number): number {
  const id = window.setInterval(fn, ms);
  cleanups.push(() => window.clearInterval(id));
  return id;
}

/** addEventListener on a global target (document / window) that is removed when the current screen is replaced. */
export function viewListener<K extends keyof DocumentEventMap>(target: Document, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: boolean | AddEventListenerOptions): void;
export function viewListener<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: boolean | AddEventListenerOptions): void;
export function viewListener(target: Document | Window, type: string, fn: (e: any) => void, opts?: boolean | AddEventListenerOptions): void {
  target.addEventListener(type, fn, opts);
  cleanups.push(() => target.removeEventListener(type, fn, opts));
}

/** Called by the router before it draws another screen. */
export function disposeView(): void {
  while (cleanups.length) {
    try { cleanups.pop()!(); } catch { /* a cleanup must never block the next screen */ }
  }
}
