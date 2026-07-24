// Shared on-map hover tooltip for navigation points — the "nice box" shown when
// hovering a navaid/fix or a Field 15 route waypoint. A single host element is
// mounted per layer; positioning is driven by deck.gl onHover screen coords.

export interface NavPointInfo {
  ident: string;
  name?: string;
  kind: string | null | undefined;
  lat: number;
  lon: number;
  elevationFt?: number | null;
}

let stylesInjected = false;
function ensureTooltipStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
.tn-point-tooltip {
  font-family: "B612", ui-monospace, SFMono-Regular, Menlo, sans-serif;
  font-size: 12px;
  color: var(--t-fg, #222);
  background: var(--t-bg, #fff);
  border: 1px solid var(--t-border, #dee2e6);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  padding: 6px 8px;
  pointer-events: none;
  max-width: 240px;
}
.tn-point-tooltip .tn-tip-title { font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.tn-point-tooltip .tn-tip-name { color: var(--t-muted, #68717d); }
.tn-point-tooltip .tn-tip-coords { font-size: 11px; color: var(--t-muted, #68717d); margin-top: 2px; }
.tn-point-tooltip .tn-tip-meta { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
.tn-point-tooltip .tn-tip-chip {
  background: var(--t-accent1, #0d6efd); color: var(--t-accent1-fg, #fff);
  border-radius: 4px; padding: 0 5px; font-size: 11px;
}
.tn-point-tooltip .tn-tip-chip.fix {
  background: var(--t-accent2, #ffc107); color: var(--t-accent2-fg, #212529);
}
.tn-point-tooltip .tn-tip-elev { font-size: 11px; color: var(--t-muted, #68717d); }
`;
  document.head.appendChild(style);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function coordText(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

function isFixKind(kind: string | null | undefined): boolean {
  return String(kind ?? "").toLowerCase() === "fix";
}

function kindLabel(kind: string | null | undefined): string {
  const k = String(kind ?? "").trim();
  if (!k) return "POINT";
  if (k.toLowerCase() === "fix") return "FIX";
  return k.toUpperCase();
}

function tooltipHtml(info: NavPointInfo): string {
  const rows = [
    `<div class="tn-tip-title">${escapeHtml(info.ident)}</div>`,
    info.name && info.name !== info.ident
      ? `<div class="tn-tip-name">${escapeHtml(info.name)}</div>`
      : "",
    `<div class="tn-tip-coords">${coordText(info.lat, info.lon)}</div>`,
    `<div class="tn-tip-meta"><span class="tn-tip-chip${
      isFixKind(info.kind) ? " fix" : ""
    }">${kindLabel(info.kind)}</span>${
      info.elevationFt != null && Number.isFinite(info.elevationFt)
        ? `<span class="tn-tip-elev">${Math.round(info.elevationFt)} ft</span>`
        : ""
    }</div>`
  ];
  return `<div class="tn-point-tooltip-inner">${rows
    .filter(Boolean)
    .join("")}</div>`;
}

/** Mount a hidden tooltip host element inside the map container. */
export function mountPointTooltip(container: HTMLElement): HTMLDivElement {
  ensureTooltipStyles();
  const el = document.createElement("div");
  el.className = "tn-point-tooltip";
  el.style.position = "absolute";
  el.style.zIndex = "400";
  el.style.left = "-9999px";
  el.style.top = "0";
  el.style.display = "none";
  container.appendChild(el);
  return el;
}

/** Render + position the tooltip near a screen point. */
export function showPointTooltip(
  el: HTMLDivElement,
  info: NavPointInfo,
  x: number,
  y: number,
  container: HTMLElement
): void {
  el.innerHTML = tooltipHtml(info);
  el.style.display = "block";
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  const left = Math.min(x + 14, container.clientWidth - tw - 6);
  const top = Math.min(y + 14, container.clientHeight - th - 6);
  el.style.left = `${Math.max(6, left)}px`;
  el.style.top = `${Math.max(6, top)}px`;
}

export function hidePointTooltip(el: HTMLDivElement): void {
  el.style.display = "none";
}
