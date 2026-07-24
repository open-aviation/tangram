// A small on-map menu opened when clicking a drawn point or route, offering to
// remove it. Only one menu is open at a time; opening a new one closes the
// previous. Outside click and Escape close it.

export interface RemoveMenuOptions {
  container: HTMLElement;
  x: number;
  y: number;
  title: string;
  onRemove: () => void;
}

let stylesInjected = false;
function ensureMenuStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
.tn-remove-menu {
  font-family: "B612", ui-monospace, SFMono-Regular, Menlo, sans-serif;
  font-size: 12px;
  color: var(--t-fg, #222);
  background: var(--t-bg, #fff);
  border: 1px solid var(--t-border, #dee2e6);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  padding: 8px;
  min-width: 130px;
  width: max-content;
  max-width: 220px;
}
.tn-remove-menu .tn-rm-title {
  font-weight: 600;
  margin-bottom: 6px;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.tn-remove-menu .tn-rm-remove {
  width: 100%;
  border: 1px solid var(--t-error, #dc3545);
  background: var(--t-error, #dc3545);
  color: #fff;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}
.tn-remove-menu .tn-rm-remove:hover { opacity: 0.88; }
`;
  document.head.appendChild(style);
}

let activeCloser: (() => void) | null = null;

/** Close the currently open remove menu, if any. */
export function closeRemoveMenu(): void {
  if (activeCloser) {
    activeCloser();
    activeCloser = null;
  }
}

export function openRemoveMenu(opts: RemoveMenuOptions): void {
  closeRemoveMenu();
  ensureMenuStyles();

  const menu = document.createElement("div");
  menu.className = "tn-remove-menu";
  menu.style.position = "absolute";
  menu.style.zIndex = "410";
  menu.style.left = "-9999px";
  menu.style.top = "0";
  menu.innerHTML = `<div class="tn-rm-title">${escapeHtml(
    opts.title
  )}</div><button type="button" class="tn-rm-remove">Remove</button>`;
  opts.container.appendChild(menu);

  const removeBtn = menu.querySelector<HTMLButtonElement>(".tn-rm-remove");

  const onOutside = (event: MouseEvent) => {
    if (!menu.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  const close = () => {
    document.removeEventListener("click", onOutside, true);
    document.removeEventListener("keydown", onKey);
    menu.remove();
    if (activeCloser === close) activeCloser = null;
  };

  removeBtn?.addEventListener("click", event => {
    event.stopPropagation();
    opts.onRemove();
    close();
  });
  menu.addEventListener("click", event => event.stopPropagation());

  // The opening click has already dispatched; attach the outside listener on
  // the next tick so it does not immediately close the menu it just opened.
  setTimeout(() => {
    document.addEventListener("click", onOutside, true);
  }, 0);
  document.addEventListener("keydown", onKey);

  requestAnimationFrame(() => {
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const left = Math.min(opts.x + 8, opts.container.clientWidth - mw - 6);
    const top = Math.min(opts.y + 8, opts.container.clientHeight - mh - 6);
    menu.style.left = `${Math.max(6, left)}px`;
    menu.style.top = `${Math.max(6, top)}px`;
  });

  activeCloser = close;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
