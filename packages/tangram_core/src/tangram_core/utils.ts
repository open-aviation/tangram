import type { LazyImportFile, MapBounds, TimeRange } from "./api";

// adapted from: https://github.com/color-js/color.js/blob/main/src/spaces/oklch.js
type Vector3 = [number, number, number];

export type ColorSpec =
  | string
  | [number, number, number]
  | [number, number, number, number];

export type DeckGLColor = [number, number, number, number];

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function assertNever(value: never, message: string): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function resolveBearing(
  ...values: Array<number | null | undefined>
): number | undefined {
  return values.find(value => value !== null && value !== undefined);
}

export function computeGeographicBearing(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number
): number {
  const lat1 = (fromLatitude * Math.PI) / 180;
  const lat2 = (toLatitude * Math.PI) / 180;
  const lonDelta = ((toLongitude - fromLongitude) * Math.PI) / 180;

  const y = Math.sin(lonDelta) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lonDelta);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function interpolateBearing(start: number, end: number): number {
  const delta = ((end - start + 540) % 360) - 180;
  return (start + delta / 2 + 360) % 360;
}

export function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 10_000_000_000_000_000) return value / 1_000_000_000;
    if (value > 10_000_000_000_000) return value / 1_000_000;
    if (value > 10_000_000_000) return value / 1000;
    return value;
  }

  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return parseTimestamp(asNumber);
    const parsed = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
    return Number.isFinite(parsed) ? parsed / 1000 : null;
  }

  return null;
}

export interface ModifierKeys {
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const EMPTY_MODIFIER_KEYS: ModifierKeys = {
  ctrlKey: false,
  altKey: false,
  metaKey: false
};

export function getModifierKeys(event: unknown): ModifierKeys {
  if (typeof event !== "object" || event === null) return EMPTY_MODIFIER_KEYS;

  const eventObject = event as Record<string, unknown>;
  const srcEvent = eventObject["srcEvent"];
  const sourceEvent = eventObject["sourceEvent"];
  const source =
    typeof srcEvent === "object" && srcEvent !== null
      ? ((srcEvent as Record<string, unknown>)["originalEvent"] ?? srcEvent)
      : (sourceEvent ?? event);

  if (typeof source !== "object" || source === null) return EMPTY_MODIFIER_KEYS;

  const maybe = source as Partial<ModifierKeys>;
  return {
    ctrlKey: !!maybe.ctrlKey,
    altKey: !!maybe.altKey,
    metaKey: !!maybe.metaKey
  };
}

export function computeBoundsFromRecords<T>(
  records: ReadonlyArray<T>,
  getLongitude: (record: T) => number | null | undefined,
  getLatitude: (record: T) => number | null | undefined
): MapBounds | null {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const record of records) {
    const longitude = getLongitude(record);
    const latitude = getLatitude(record);
    if (longitude == null || latitude == null) continue;

    minLon = Math.min(minLon, longitude);
    minLat = Math.min(minLat, latitude);
    maxLon = Math.max(maxLon, longitude);
    maxLat = Math.max(maxLat, latitude);
  }

  return [minLon, minLat, maxLon, maxLat].every(Number.isFinite)
    ? { minLon, minLat, maxLon, maxLat }
    : null;
}

export function normalizeTimeRange(range: TimeRange): TimeRange {
  return range.start <= range.stop
    ? { start: range.start, stop: range.stop }
    : { start: range.stop, stop: range.start };
}

export function unionTimeRanges(
  ranges: ReadonlyArray<TimeRange | null | undefined>
): TimeRange | null {
  let start = Number.POSITIVE_INFINITY;
  let stop = Number.NEGATIVE_INFINITY;

  for (const range of ranges) {
    if (!range) continue;
    const normalized = normalizeTimeRange(range);
    start = Math.min(start, normalized.start);
    stop = Math.max(stop, normalized.stop);
  }

  return Number.isFinite(start) && Number.isFinite(stop) ? { start, stop } : null;
}

export function clampTimeToRange(time: number, range: TimeRange | null): number {
  if (!range) return time;
  return Math.min(Math.max(time, range.start), range.stop);
}

// NOTE: csv support was added in da9eba30e667941b5193d66133f51ad32b97d4ed by xoolive
// we might want to switch to papaparse for better handling of european decimals/TSVs etc

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

export function parseCsvRows(
  text: string,
  maxRows?: number
): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    return [];
  }

  const header = splitCsvLine(lines[0]);
  const end = maxRows ? Math.min(lines.length, maxRows + 1) : lines.length;

  return lines
    .slice(1, end)
    .map(line =>
      Object.fromEntries(
        splitCsvLine(line).map((value, index) => [
          header[index] ?? `field_${index}`,
          value
        ])
      )
    );
}

export async function parseJsonlRows(
  file: Pick<LazyImportFile, "rawFile" | "getText">,
  maxRows?: number,
  tolerateErrors = false
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];

  const parseLine = (line: string): boolean => {
    if (!line.trim()) return true;

    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed)) {
        rows.push(parsed);
      }
    } catch (error) {
      if (tolerateErrors) {
        return false;
      }

      throw error;
    }

    return !(maxRows && rows.length >= maxRows);
  };

  const stream = file.rawFile.stream?.();
  if (stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          buffer = buffer.slice(newlineIndex + 1);

          if (!parseLine(line)) {
            await reader.cancel();
            return rows;
          }

          newlineIndex = buffer.indexOf("\n");
        }

        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }

    if (buffer && !parseLine(buffer.replace(/\r$/, ""))) {
      return rows;
    }

    return rows;
  }

  for (const line of (await file.getText()).split(/\r?\n/)) {
    if (!parseLine(line)) {
      return rows;
    }
  }

  return rows;
}

const multiplyMatrices = (A: number[], B: Vector3): Vector3 => {
  return [
    A[0] * B[0] + A[1] * B[1] + A[2] * B[2],
    A[3] * B[0] + A[4] * B[1] + A[5] * B[2],
    A[6] * B[0] + A[7] * B[1] + A[8] * B[2]
  ];
};

const oklch2oklab = ([l, c, h]: Vector3): Vector3 => [
  l,
  isNaN(h) ? 0 : c * Math.cos((h * Math.PI) / 180),
  isNaN(h) ? 0 : c * Math.sin((h * Math.PI) / 180)
];

const srgbLinear2rgb = (rgb: Vector3): Vector3 =>
  rgb.map(c =>
    Math.abs(c) > 0.0031308
      ? (c < 0 ? -1 : 1) * (1.055 * Math.pow(Math.abs(c), 1 / 2.4) - 0.055)
      : 12.92 * c
  ) as Vector3;

const oklab2xyz = (lab: Vector3): Vector3 => {
  const LMSg = multiplyMatrices(
    [
      1, 0.3963377773761749, 0.2158037573099136, 1, -0.1055613458156586,
      -0.0638541728258133, 1, -0.0894841775298119, -1.2914855480194092
    ],
    lab
  );
  const LMS = LMSg.map(val => val ** 3) as Vector3;
  return multiplyMatrices(
    [
      1.2268798758459243, -0.5578149944602171, 0.2813910456659647, -0.0405757452148008,
      1.112286803280317, -0.0717110580655164, -0.0763729366746601, -0.4214933324022432,
      1.5869240198367816
    ],
    LMS
  );
};

const xyz2rgbLinear = (xyz: Vector3): Vector3 => {
  return multiplyMatrices(
    [
      3.2409699419045226, -1.537383177570094, -0.4986107602930034, -0.9692436362808796,
      1.8759675015077202, 0.04155505740717559, 0.05563007969699366,
      -0.20397695888897652, 1.0569715142428786
    ],
    xyz
  );
};

export const oklch2rgb = (lch: Vector3): Vector3 =>
  srgbLinear2rgb(xyz2rgbLinear(oklab2xyz(oklch2oklab(lch))));

export function oklchToDeckGLColor(
  l: number,
  c: number,
  h: number,
  a: number = 255
): DeckGLColor {
  const rgb = oklch2rgb([l, c, h]);
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] * 255))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * 255))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * 255))),
    a
  ];
}

function parseOklchString(value: string): DeckGLColor | null {
  const match = value.match(
    /^oklch\(\s*([\d.]+)(%)?\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/i
  );

  if (!match) {
    return null;
  }

  const lightness = match[2] ? Number(match[1]) / 100 : Number(match[1]);

  const alpha = match[5]?.endsWith("%")
    ? (Number(match[5].slice(0, -1)) / 100) * 255
    : Number(match[5] ?? 1) * 255;

  return oklchToDeckGLColor(
    lightness,
    Number(match[3]),
    Number(match[4]),
    Math.round(Math.min(255, Math.max(0, alpha)))
  );
}

export function parseColorSpec(color: ColorSpec): DeckGLColor | null {
  if (Array.isArray(color)) {
    return color.length === 3
      ? ([...color, 255] as DeckGLColor)
      : (color as DeckGLColor);
  }

  if (typeof color === "string" && color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 6) {
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
        255
      ];
    }
  }

  if (typeof color === "string" && color.toLowerCase().startsWith("oklch(")) {
    return parseOklchString(color);
  }

  return null;
}

export function colorSpecToHex(color: ColorSpec): string | null {
  const parsed = parseColorSpec(color);
  if (!parsed) {
    return null;
  }

  const [red, green, blue] = parsed;

  return `#${[red, green, blue]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

// TODO: maybe its better to support proper theming on the backend
// and the colours look
export const DEFAULT_CATEGORICAL_COLORS = [
  "oklch(54.87% 0.222 260.33)", // uchu blue 5
  "oklch(58.63% 0.231 19.6)", // uchu red 5
  "oklch(75.23% 0.209 144.64)", // uchu green 5
  "oklch(74.61% 0.171 51.56)", // uchu orange 5
  "oklch(49.39% 0.215 298.31)", // uchu purple 5
  "oklch(82.23% 0.112 355.33)", // uchu pink 5
  "oklch(89% 0.146 91.5)", // uchu yellow 5
  "oklch(56.82% 0.004 247.89)" // uchu gray 9
];

// NOTE: we should probably remove this, i prefer id-based colours but eh
export function categoricalColor(
  value: string,
  palette: readonly string[] = DEFAULT_CATEGORICAL_COLORS
): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return palette[hash % palette.length];
}

export const formatTime = (ts: string) => {
  const d = new Date(ts + "Z");
  return (
    d.toLocaleString("en-GB", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }) + "Z"
  );
};

export const formatDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
};

export const MATERIAL_ICON_VIEW_BOX = "0 -960 960 960";

// use https://fonts.google.com/icons?icon.style=Rounded&icon.size=24&icon.color=%23e3e3e3 and copy svg
export const ICON_PATHS = {
  autorenew:
    "M480-160q-133 0-226.5-93.5T160-480q0-28 20-47t47-19q28 0 46.5 19t19.5 47q0 78 54.5 132.5T480-293q78 0 132.5-54.5T667-480q0-78-54.5-132.5T480-667h-18l36 36q20 20 20 47t-20 47q-20 20-47 20t-47-20L257-683q-10-10-15-23t-5-28q0-15 5-28t15-23l147-147q20-20 47-20t47 20q20 20 20 47t-20 47l-36 36h18q133 0 226.5 93.5T800-480q0 133-93.5 226.5T480-160Z",
  collapseAll:
    "M480-264 324-108q-11 11-28 11t-28-11q-11-11-11-28t11-28l155-155q23-23 57-23t57 23l155 155q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-264Zm0-432 156-156q11-11 28-11t28 11q11 11 11 28t-11 28L537-641q-23 23-57 23t-57-23L268-796q-11-11-11-28t11-28q11-11 28-11t28 11l156 156Z",
  expandAll:
    "m480-194 155-155q12-12 28-12t28 12q12 12 12 28.5T691-292L537-137q-23 23-57 23t-57-23L268-292q-12-12-11.5-28.5T269-349q12-12 28.5-12t28.5 12l154 155Zm0-572L326-612q-12 12-28 11.5T270-612q-12-12-12.5-28.5T269-669l154-154q23-23 57-23t57 23l154 154q12 12 11.5 28.5T690-612q-12 11-28 11.5T634-612L480-766Z",
  chevronDown:
    "M579-480 285-774q-15-15-14.5-35.5T286-845q15-15 35.5-15t35.5 15l307 308q12 12 18 27t6 30q0 15-6 30t-18 27L356-115q-15 15-35 14.5T286-116q-15-15-15-35.5t15-35.5l293-293Z",
  chevronRight:
    "M579-480 285-774q-15-15-14.5-35.5T286-845q15-15 35.5-15t35.5 15l307 308q12 12 18 27t6 30q0 15-6 30t-18 27L356-115q-15 15-35 14.5T286-116q-15-15-15-35.5t15-35.5l293-293Z",
  delete:
    "M280-120q-33 0-56.5-23.5T200-200v-520q-17 0-28.5-11.5T160-760q0-17 11.5-28.5T200-800h160q0-17 11.5-28.5T400-840h160q17 0 28.5 11.5T600-800h160q17 0 28.5 11.5T800-760q0 17-11.5 28.5T760-720v520q0 33-23.5 56.5T680-120H280Zm148.5-171.5Q440-303 440-320v-280q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v280q0 17 11.5 28.5T400-280q17 0 28.5-11.5Zm160 0Q600-303 600-320v-280q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v280q0 17 11.5 28.5T560-280q17 0 28.5-11.5Z",
  play: "M320-273v-414q0-17 12-28.5t28-11.5q5 0 10.5 1.5T381-721l326 207q9 6 13.5 15t4.5 19q0 10-4.5 19T707-446L381-239q-5 3-10.5 4.5T360-233q-16 0-28-11.5T320-273Z",
  pause:
    "M640-200q-33 0-56.5-23.5T560-280v-400q0-33 23.5-56.5T640-760q33 0 56.5 23.5T720-680v400q0 33-23.5 56.5T640-200Zm-320 0q-33 0-56.5-23.5T240-280v-400q0-33 23.5-56.5T320-760q33 0 56.5 23.5T400-680v400q0 33-23.5 56.5T320-200Z",
  close:
    "M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11-11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z",
  edit: "M160-120q-17 0-28.5-11.5T120-160v-97q0-16 6-30.5t17-25.5l505-504q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L313-143q-11 11-25.5 17t-30.5 6h-97Zm544-528 56-56-56-56-56 56 56 56Z",
  settings:
    "M433-80q-27 0-46.5-18T363-142l-9-66q-13-5-24.5-12T307-235l-62 26q-25 11-50 2t-39-32l-47-82q-14-23-8-49t27-43l53-40q-1-7-1-13.5v-27q0-6.5 1-13.5l-53-40q-21-17-27-43t8-49l47-82q14-23 39-32t50 2l62 26q11-8 23-15t24-12l9-66q4-26 23.5-44t46.5-18h94q27 0 46.5 18t23.5 44l9 66q13 5 24.5 12t22.5 15l62-26q25-11 50-2t39 32l47 82q14 23 8 49t-27 43l-53 40q1 7 1 13.5v27q0 6.5-2 13.5l53 40q21 17 27 43t-8 49l-48 82q-14 23-39 32t-50-2l-60-26q-11 8-23 15t-24 12l-9 66q-4 26-23.5 44T527-80h-94Zm49-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z",
  visibility:
    "M607.5-372.5Q660-425 660-500t-52.5-127.5Q555-680 480-680t-127.5 52.5Q300-575 300-500t52.5 127.5Q405-320 480-320t127.5-52.5Zm-204-51Q372-455 372-500t31.5-76.5Q435-608 480-608t76.5 31.5Q588-545 588-500t-31.5 76.5Q525-392 480-392t-76.5-31.5ZM235.5-272Q125-344 61-462q-5-9-7.5-18.5T51-500q0-10 2.5-19.5T61-538q64-118 174.5-190T480-800q134 0 244.5 72T899-538q5 9 7.5 18.5T909-500q0 10-2.5 19.5T899-462q-64 118-174.5 190T480-200q-134 0-244.5-72ZM480-500Zm207.5 160.5Q782-399 832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280q113 0 207.5-59.5Z",
  visibilityOff:
    "M607-627q29 29 42.5 66t9.5 76q0 15-11 25.5T622-449q-15 0-25.5-10.5T586-485q5-26-3-50t-25-41q-17-17-41-26t-51-4q-15 0-25.5-11T430-643q0-15 10.5-25.5T466-679q38-4 75 9.5t66 42.5Zm-127-93q-19 0-37 1.5t-36 5.5q-17 3-30.5-5T358-742q-5-16 3.5-31t24.5-18q23-5 46.5-7t47.5-2q137 0 250.5 72T904-534q4 8 6 16.5t2 17.5q0 9-1.5 17.5T905-466q-18 40-44.5 75T802-327q-12 11-28 9t-26-16q-10-14-8.5-30.5T753-392q24-23 44-50t35-58q-50-101-144.5-160.5T480-720Zm0 520q-134 0-245-72.5T60-463q-5-8-7.5-17.5T50-500q0-10 2-19t7-18q20-40 46.5-76.5T166-680l-83-84q-11-12-10.5-28.5T84-820q11-11 28-11t28 11l680 680q11 11 11.5 27.5T820-84q-11 11-28 11t-28-11L624-222q-35 11-71 16.5t-73 5.5ZM222-624q-29 26-53 57t-41 67q50 101 144.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z"
} as const;
