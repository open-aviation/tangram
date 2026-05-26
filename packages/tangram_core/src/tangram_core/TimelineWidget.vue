<template>
  <div v-if="availableRange && !isLive" class="timeline-widget">
    <div class="timeline-controls">
      <IconButton
        :title="isPlaying ? 'Pause playback' : 'Play playback'"
        :aria-label="isPlaying ? 'Pause playback' : 'Play playback'"
        @click="togglePlayback"
      >
        <SvgIcon :path="isPlaying ? ICON_PATHS.pause : ICON_PATHS.play" />
      </IconButton>

      <div class="timeline-speed-stack">
        <div class="timeline-current-time-shell">
          <IconButton
            v-if="!isEditingTimestamp"
            class="timeline-current-time timeline-current-time-button"
            :icon-only="false"
            align="start"
            title="Double click to edit playback time"
            variant="plain"
            @dblclick.prevent="startEditingTimestamp"
          >
            {{ formatPlaybackTimestamp(currentTime) }}
          </IconButton>
          <input
            v-else
            ref="timestampInputRef"
            v-model="timestampDraft"
            class="timeline-current-time timeline-current-time-input"
            :class="{ 'is-invalid': hasTimestampDraftError }"
            type="text"
            spellcheck="false"
            @keydown.enter.prevent="commitTimestampEdit"
            @keydown.escape.prevent="cancelTimestampEdit"
            @blur="commitTimestampEdit"
          />
        </div>
        <div ref="speedControlRef" class="timeline-speed-row">
          <IconButton
            class="timeline-speed-button"
            :icon-only="false"
            align="start"
            variant="plain"
            title="Drag left or right to change speed, or click for presets"
            aria-label="Playback speed"
            @pointerdown="onSpeedPointerDown"
            @pointermove="onSpeedPointerMove"
            @pointerup="onSpeedPointerUp"
            @pointercancel="onSpeedPointerUp"
          >
            {{ formatSpeed(dragSpeedValue ?? playbackSpeed) }}
          </IconButton>

          <div v-if="isSpeedMenuOpen" class="timeline-speed-menu">
            <IconButton
              v-for="speed in playbackSpeeds"
              :key="speed"
              class="timeline-speed-option"
              :icon-only="false"
              align="start"
              :active="Math.abs(speed - playbackSpeed) < 0.0001"
              size="sm"
              @click="selectPlaybackSpeed(speed)"
            >
              {{ formatSpeed(speed) }}
            </IconButton>
          </div>
        </div>
      </div>
    </div>

    <div ref="canvasShell" class="timeline-track-shell">
      <canvas
        ref="canvasRef"
        class="timeline-canvas"
        tabindex="0"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @pointerleave="onPointerLeave"
        @wheel.prevent="onWheel"
        @keydown="onKeyDown"
        @contextmenu.prevent
      />
    </div>

    <div class="timeline-exit-slot">
      <IconButton
        title="Exit Playback Mode"
        aria-label="Exit Playback Mode"
        @click="exitPlaybackMode"
      >
        <SvgIcon :path="ICON_PATHS.close" />
      </IconButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { TangramApi, TimeRange } from "./api";
import IconButton from "./IconButton.vue";
import SvgIcon from "./SvgIcon.vue";
import { ICON_PATHS } from "./utils";

const injectedApi = inject<TangramApi>("tangramApi");
if (!injectedApi) {
  throw new Error("assert: tangram api not provided");
}
const api = injectedApi;

const DRAG_THRESHOLD_PX = 3;
const PLAYHEAD_BUFFER_RATIO = 0.2;
const playbackSpeeds = [0.25, 0.5, 1, 2, 4, 10, 60, 300, 600, 1800, 3600];
const MIN_PLAYBACK_SPEED = 0.05;
const MAX_PLAYBACK_SPEED = 3600;

const canvasRef = ref<HTMLCanvasElement | null>(null);
const canvasShell = ref<HTMLDivElement | null>(null);
const speedControlRef = ref<HTMLDivElement | null>(null);
const timestampInputRef = ref<HTMLInputElement | null>(null);
const isSpeedMenuOpen = ref(false);
const dragSpeedValue = ref<number | null>(null);
const isEditingTimestamp = ref(false);
const timestampDraft = ref("");
const hasTimestampDraftError = ref(false);

const availableRange = computed(() => api.time.availableRange.value);
const viewRange = computed(
  () => api.time.viewRange.value ?? api.time.availableRange.value
);
const displayRange = computed<TimeRange>(
  () => viewRange.value ?? availableRange.value!
);
const currentTime = computed(() => api.time.currentTime.value);
const isLive = computed(() => api.time.isLive.value);
const isPlaying = computed(() => api.time.isPlaying.value);
const playbackSpeed = computed(() => api.time.playbackSpeed.value);

interface PointerSession {
  id: number;
  mode: "scrub" | "pan";
  startX: number;
  currentX: number;
}

interface SpeedPointerSession {
  id: number;
  startX: number;
  startSpeed: number;
  dragged: boolean;
}

const pointerSession = ref<PointerSession | null>(null);
const speedPointerSession = ref<SpeedPointerSession | null>(null);

const handleSpeedMenuPointerDown = (event: PointerEvent) => {
  if (!speedControlRef.value?.contains(event.target as Node | null)) {
    isSpeedMenuOpen.value = false;
  }
};

let resizeObserver: ResizeObserver | null = null;
let scrubAutoPanFrameId: number | null = null;
let scrubAutoPanLastTs = 0;

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

type Rgb = { r: number; g: number; b: number };

function parseCssColor(value: string): Rgb | null {
  const normalized = value.trim();
  const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const raw = hex[1];
    const full =
      raw.length === 3
        ? raw
            .split("")
            .map(part => `${part}${part}`)
            .join("")
        : raw;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16)
    };
  }

  const rgb = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;

  const [r, g, b] = rgb[1]
    .split(",")
    .slice(0, 3)
    .map(part => Number.parseFloat(part.trim()));
  if (![r, g, b].every(channel => Number.isFinite(channel))) return null;

  return { r, g, b };
}

function mixRgb(base: Rgb, target: Rgb, weight: number): string {
  const mix = (from: number, to: number) =>
    Math.round(from * weight + to * (1 - weight));
  return `rgb(${mix(base.r, target.r)}, ${mix(base.g, target.g)}, ${mix(base.b, target.b)})`;
}

function relativeLuminance(color: Rgb): number {
  const convert = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };

  const r = convert(color.r);
  const g = convert(color.g);
  const b = convert(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function resolveTrackStrokeColor(
  foreground: string,
  background: string
): { color: string; lineWidth: number } {
  const fg = parseCssColor(foreground);
  const bg = parseCssColor(background);
  if (!fg || !bg) {
    return { color: foreground, lineWidth: 1 };
  }

  const isDarkTheme = relativeLuminance(bg) < 0.4;
  if (isDarkTheme) {
    return {
      color: mixRgb(fg, bg, 0.58),
      lineWidth: 1
    };
  }

  return {
    color: mixRgb(fg, { r: 0, g: 0, b: 0 }, 0.82),
    lineWidth: 1.15
  };
}

function formatPlaybackTimestamp(value: number): string {
  return new Date(value * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parsePlaybackTimestamp(value: string): number | null {
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

function formatSpeed(speed: number): string {
  if (speed >= 100) return `${Math.round(speed)}x`;
  if (speed >= 10) return `${speed.toFixed(1)}x`;
  if (speed >= 1) return `${speed.toFixed(2).replace(/\.00$/, "")}x`;
  return `${speed.toFixed(2)}x`;
}

function tickStep(spanSeconds: number): number {
  const steps = [
    0.001,
    0.002,
    0.005,
    0.01,
    0.02,
    0.05,
    0.1,
    0.2,
    0.5,
    1,
    2,
    5,
    10,
    15,
    30,
    60,
    120,
    300,
    600,
    900,
    1800,
    3600,
    7200,
    3 * 3600,
    6 * 3600,
    12 * 3600,
    24 * 3600,
    2 * 24 * 3600,
    7 * 24 * 3600,
    30 * 24 * 3600
  ];
  const target = spanSeconds / 10;
  return steps.find(step => step >= target) ?? steps[steps.length - 1];
}

function normalizePlaybackSpeed(speed: number): number {
  const clamped = clamp(speed, MIN_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED);
  if (clamped >= 100) return Math.round(clamped);
  if (clamped >= 10) return Number(clamped.toFixed(1));
  return Number(clamped.toFixed(2));
}

function formatTickLabel(
  value: number,
  spanSeconds: number,
  stepSeconds: number
): string {
  const date = new Date(value * 1000);
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  const hours = pad2(date.getUTCHours());
  const minutes = pad2(date.getUTCMinutes());
  const seconds = pad2(date.getUTCSeconds());

  if (stepSeconds < 1) {
    return `${hours}:${minutes}:${seconds}`;
  }

  if (stepSeconds < 60) {
    return `${hours}:${minutes}:${seconds}`;
  }

  if (stepSeconds < 24 * 3600) {
    if (spanSeconds <= 24 * 3600) {
      return `${hours}:${minutes}`;
    }
    return `${month}-${day} ${hours}:${minutes}`;
  }

  if (stepSeconds < 30 * 24 * 3600) {
    return `${date.getUTCFullYear()}-${month}-${day}`;
  }

  return `${date.getUTCFullYear()}-${month}`;
}

function getCanvasMetrics() {
  const canvas = canvasRef.value;
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  const leftPad = 12;
  const width = Math.max(rect.width - leftPad - 12, 1);
  // we want "center of mass" of the elements to coincide with the center of the canvas
  // so we shift up a bit
  const lineY = rect.height / 2 - 6;
  const tickBottomY = lineY + 8;
  const labelY = tickBottomY + 3;

  return {
    rect,
    leftPad,
    width,
    lineY,
    tickBottomY,
    labelY
  };
}

function timeToX(time: number): number {
  const metrics = getCanvasMetrics();
  const range = displayRange.value;
  if (!metrics || !range) return 0;
  const span = Math.max(range.stop - range.start, 1);
  const ratio = (time - range.start) / span;
  return metrics.leftPad + clamp(ratio, 0, 1) * metrics.width;
}

function xToTime(clientX: number): number {
  const metrics = getCanvasMetrics();
  const range = displayRange.value;
  if (!metrics || !range) return currentTime.value;
  const localX = clamp(clientX - metrics.rect.left - metrics.leftPad, 0, metrics.width);
  const ratio = localX / metrics.width;
  return range.start + (range.stop - range.start) * ratio;
}

function updateCanvasSize() {
  const canvas = canvasRef.value;
  const shell = canvasShell.value;
  if (!canvas || !shell) return;

  const rect = shell.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(Math.floor(rect.width), 1);
  const height = Math.max(Math.floor(rect.height), 1);

  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function updateCursor() {
  const canvas = canvasRef.value;
  if (!canvas) return;

  if (pointerSession.value?.mode === "pan") {
    canvas.style.cursor = "grabbing";
    return;
  }

  canvas.style.cursor = "ew-resize";
}

function getClampedViewStart(
  start: number,
  span: number,
  available: TimeRange
): number {
  const maxStart = Math.max(available.stop - span, available.start);
  return clamp(start, available.start, maxStart);
}

function keepTimeInBufferedView(time: number) {
  const view = viewRange.value;
  const available = availableRange.value;
  if (!view || !available) return;

  const span = Math.max(view.stop - view.start, 1);
  const leftBuffer = view.start + span * PLAYHEAD_BUFFER_RATIO;
  const rightBuffer = view.stop - span * PLAYHEAD_BUFFER_RATIO;

  if (time < leftBuffer) {
    const nextStart = getClampedViewStart(
      time - span * PLAYHEAD_BUFFER_RATIO,
      span,
      available
    );
    if (Math.abs(nextStart - view.start) > 1e-9) {
      api.time.setViewRange({ start: nextStart, stop: nextStart + span });
    }
    return;
  }

  if (time > rightBuffer) {
    const nextStart = getClampedViewStart(
      time - span * (1 - PLAYHEAD_BUFFER_RATIO),
      span,
      available
    );
    if (Math.abs(nextStart - view.start) > 1e-9) {
      api.time.setViewRange({ start: nextStart, stop: nextStart + span });
    }
  }
}

function getScrubOverflowPixels(session: PointerSession): number {
  const metrics = getCanvasMetrics();
  if (!metrics) return 0;

  if (session.currentX < metrics.rect.left) {
    return session.currentX - metrics.rect.left;
  }

  if (session.currentX > metrics.rect.right) {
    return session.currentX - metrics.rect.right;
  }

  return 0;
}

function stopScrubAutoPan() {
  if (scrubAutoPanFrameId !== null) {
    cancelAnimationFrame(scrubAutoPanFrameId);
    scrubAutoPanFrameId = null;
  }
  scrubAutoPanLastTs = 0;
}

function runScrubAutoPan(timestamp: number) {
  const session = pointerSession.value;
  const metrics = getCanvasMetrics();
  const range = displayRange.value;

  if (!session || session.mode !== "scrub" || !metrics || !range) {
    stopScrubAutoPan();
    return;
  }

  const dt = scrubAutoPanLastTs === 0 ? 0 : (timestamp - scrubAutoPanLastTs) / 1000;
  scrubAutoPanLastTs = timestamp;

  const overflowPixels = getScrubOverflowPixels(session);
  if (overflowPixels !== 0 && dt > 0) {
    const secondsPerPixel = (range.stop - range.start) / metrics.width;
    const deltaSeconds = overflowPixels * secondsPerPixel * dt;
    api.time.panView(deltaSeconds);
    api.time.setCurrentTime(xToTime(session.currentX));
  }

  scrubAutoPanFrameId = requestAnimationFrame(runScrubAutoPan);
}

function ensureScrubAutoPan() {
  if (scrubAutoPanFrameId !== null) return;
  scrubAutoPanFrameId = requestAnimationFrame(runScrubAutoPan);
}

function draw() {
  const canvas = canvasRef.value;
  const metrics = getCanvasMetrics();
  const range = displayRange.value;
  if (!canvas || !metrics || !range) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue("--t-accent1").trim() || "#38bdf8";
  const background = styles.getPropertyValue("--t-bg").trim() || "#ffffff";
  const foreground = styles.getPropertyValue("--t-fg").trim() || "#0f172a";
  const muted = styles.getPropertyValue("--t-muted").trim() || foreground;
  const trackStroke = resolveTrackStrokeColor(foreground, background);

  context.clearRect(0, 0, metrics.rect.width, metrics.rect.height);

  context.strokeStyle = trackStroke.color;
  context.lineWidth = trackStroke.lineWidth;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(metrics.leftPad, metrics.lineY);
  context.lineTo(metrics.leftPad + metrics.width, metrics.lineY);
  context.stroke();
  context.lineCap = "butt";

  const step = tickStep(Math.max(range.stop - range.start, 1));
  const firstTickIndex = Math.ceil(range.start / step);
  const lastTickIndex = Math.floor(range.stop / step);
  let lastLabelRight = -Infinity;
  context.strokeStyle = trackStroke.color;
  context.lineWidth = trackStroke.lineWidth;
  context.font = '10px "B612", sans-serif';
  context.textBaseline = "top";
  for (let tickIndex = firstTickIndex; tickIndex <= lastTickIndex; tickIndex += 1) {
    const tick = tickIndex * step;
    const x = timeToX(tick);
    context.beginPath();
    context.moveTo(x, metrics.lineY);
    context.lineTo(x, metrics.tickBottomY);
    context.stroke();

    const label = formatTickLabel(tick, range.stop - range.start, step);
    const width = context.measureText(label).width;
    const left = x - width / 2;
    if (left <= lastLabelRight + 14) continue;

    context.fillStyle = muted;
    context.fillText(label, left, metrics.labelY);
    lastLabelRight = left + width;
  }

  const playheadX = timeToX(currentTime.value);
  context.strokeStyle = accent;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(playheadX, 0);
  context.lineTo(playheadX, metrics.rect.height);
  context.stroke();
}

function refresh() {
  if (!availableRange.value || isLive.value) return;
  updateCanvasSize();
  updateCursor();
  draw();
}

function goLive() {
  isSpeedMenuOpen.value = false;
  api.time.goLive();
}

function exitPlaybackMode() {
  goLive();
}

async function startEditingTimestamp() {
  api.time.pause();
  isSpeedMenuOpen.value = false;
  timestampDraft.value = formatPlaybackTimestamp(currentTime.value);
  hasTimestampDraftError.value = false;
  isEditingTimestamp.value = true;

  await nextTick();
  timestampInputRef.value?.focus();
  timestampInputRef.value?.select();
}

function commitTimestampEdit() {
  const parsed = parsePlaybackTimestamp(timestampDraft.value);
  if (parsed === null) {
    hasTimestampDraftError.value = true;
    return;
  }

  api.time.setCurrentTime(parsed);
  hasTimestampDraftError.value = false;
  isEditingTimestamp.value = false;
}

function cancelTimestampEdit() {
  hasTimestampDraftError.value = false;
  isEditingTimestamp.value = false;
  timestampDraft.value = "";
}

function togglePlayback() {
  api.time.togglePlayback();
}

function onSpeedPointerDown(event: PointerEvent) {
  const target = event.currentTarget as HTMLButtonElement | null;
  if (!target) return;

  isSpeedMenuOpen.value = false;
  speedPointerSession.value = {
    id: event.pointerId,
    startX: event.clientX,
    startSpeed: playbackSpeed.value,
    dragged: false
  };
  target.setPointerCapture(event.pointerId);
}

function onSpeedPointerMove(event: PointerEvent) {
  const session = speedPointerSession.value;
  if (!session) return;

  const dx = event.clientX - session.startX;
  if (Math.abs(dx) >= DRAG_THRESHOLD_PX) {
    session.dragged = true;
  }

  const factor = Math.pow(2, dx / 80);
  const nextSpeed = normalizePlaybackSpeed(session.startSpeed * factor);
  dragSpeedValue.value = nextSpeed;
  api.time.setPlaybackSpeed(nextSpeed);
}

function onSpeedPointerUp(event: PointerEvent) {
  const target = event.currentTarget as HTMLButtonElement | null;
  const session = speedPointerSession.value;
  if (!target || !session) return;

  if (target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId);
  }

  if (!session.dragged) {
    isSpeedMenuOpen.value = !isSpeedMenuOpen.value;
  }

  dragSpeedValue.value = null;
  speedPointerSession.value = null;
}

function selectPlaybackSpeed(speed: number) {
  api.time.setPlaybackSpeed(speed);
  isSpeedMenuOpen.value = false;
}

function onPointerDown(event: PointerEvent) {
  const canvas = canvasRef.value;
  if (!canvas || !availableRange.value) return;

  canvas.focus();

  if (event.button === 2) {
    pointerSession.value = {
      id: event.pointerId,
      mode: "pan",
      startX: event.clientX,
      currentX: event.clientX
    };
  } else if (event.button === 0) {
    api.time.setCurrentTime(xToTime(event.clientX));
    pointerSession.value = {
      id: event.pointerId,
      mode: "scrub",
      startX: event.clientX,
      currentX: event.clientX
    };
    ensureScrubAutoPan();
  } else {
    return;
  }

  canvas.setPointerCapture(event.pointerId);
  updateCursor();
}

function onPointerMove(event: PointerEvent) {
  const session = pointerSession.value;
  if (!session) {
    updateCursor();
    return;
  }

  session.currentX = event.clientX;

  if (session.mode === "pan") {
    const metrics = getCanvasMetrics();
    const range = displayRange.value;
    if (!metrics || !range) return;

    const span = range.stop - range.start;
    const deltaSeconds = ((session.startX - event.clientX) / metrics.width) * span;
    api.time.panView(deltaSeconds);
    session.startX = event.clientX;
  } else {
    api.time.setCurrentTime(xToTime(event.clientX));
    ensureScrubAutoPan();
  }

  updateCursor();
}

function onPointerUp(event: PointerEvent) {
  const canvas = canvasRef.value;
  if (!pointerSession.value || !canvas) return;

  pointerSession.value = null;
  stopScrubAutoPan();
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  updateCursor();
}

function onPointerLeave() {
  if (!pointerSession.value) {
    updateCursor();
  }
}

function onWheel(event: WheelEvent) {
  if (isLive.value || !availableRange.value) return;
  const factor = event.deltaY > 0 ? 1.15 : 0.85;
  api.time.zoomView(factor, xToTime(event.clientX));
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === " ") {
    event.preventDefault();
    togglePlayback();
    return;
  }

  if (event.key === "Escape") {
    isSpeedMenuOpen.value = false;
  }
}

watch([displayRange, currentTime, isPlaying, isLive], refresh, { deep: true });

watch([currentTime, isPlaying], ([time, playing]) => {
  if (!playing || isLive.value) return;
  keepTimeInBufferedView(time);
});

onMounted(() => {
  refresh();
  if (canvasShell.value) {
    resizeObserver = new ResizeObserver(() => refresh());
    resizeObserver.observe(canvasShell.value);
  }

  window.addEventListener("pointerdown", handleSpeedMenuPointerDown);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", handleSpeedMenuPointerDown);
  stopScrubAutoPan();
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style>
.timeline-widget {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas: "controls track exit";
  align-items: center;
  column-gap: 0;
  row-gap: 0.5rem;
  width: 100%;
  max-width: min(940px, 100%);
  min-width: 0;
  padding: 0;
  margin: 0;
}

.timeline-controls {
  grid-area: controls;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-right: 0.5rem;
}

.timeline-speed-stack {
  --timeline-stack-row-height: 13px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  margin-left: auto;
  align-items: flex-start;
}

.timeline-current-time {
  font:
    400 13px/1 "B612",
    sans-serif;
  color: var(--t-fg);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.timeline-current-time-shell {
  width: 15ch;
  min-width: 15ch;
  height: var(--timeline-stack-row-height);
  display: flex;
  align-items: center;
}

.timeline-current-time-button {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 0;
  text-align: left;
  cursor: text;
}

.timeline-current-time-input {
  width: 100%;
  height: 100%;
  min-width: 0;
  border: 1px solid var(--t-border);
  outline: none;
  background: transparent;
  box-sizing: border-box;
  padding: 0;
  margin: 0;
}

.timeline-current-time-input.is-invalid {
  border-color: var(--t-error);
}

.timeline-speed-row {
  display: flex;
  align-items: center;
  position: relative;
  height: var(--timeline-stack-row-height);
}

.timeline-speed-button {
  color: var(--t-fg);
  height: 100%;
  min-height: 0;
  padding: 0;
  cursor: e-resize;
  font:
    400 13px/1 "B612",
    sans-serif;
  font-variant-numeric: tabular-nums;
}

.timeline-speed-menu {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  display: grid;
  min-width: 4rem;
  background: color-mix(in srgb, var(--t-surface) 94%, var(--t-bg) 6%);
  border: 1px solid var(--t-border);
  border-radius: 10px;
  padding: 0.2rem;
  box-shadow: 0 10px 24px rgb(0 0 0 / 0.18);
  z-index: 20;
}

.timeline-speed-option {
  color: var(--t-fg);
  font:
    400 13px/1.2 "B612",
    sans-serif;
}

.timeline-speed-option.ui-button-active,
.timeline-speed-option:hover {
  background: color-mix(in srgb, var(--t-accent1) 18%, transparent);
}

.timeline-track-shell {
  grid-area: track;
  position: relative;
  min-width: 0;
  width: 100%;
  height: 44px;
}

.timeline-exit-slot {
  grid-area: exit;
}

.timeline-canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
  cursor: ew-resize;
}

.timeline-canvas:focus,
.timeline-canvas:focus-visible {
  outline: none;
  box-shadow: none;
}

@media (max-width: 1180px) {
  .timeline-widget {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "track track"
      "controls exit";
  }

  .timeline-controls {
    grid-area: controls;
    justify-content: flex-start;
  }

  .timeline-track-shell {
    grid-area: track;
  }
}

@media (max-width: 760px) {
  .timeline-controls {
    flex-wrap: wrap;
  }
}
</style>
