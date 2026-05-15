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

export type Position3D = [number, number, number];
export interface PathSegment<ColorT> {
  path: Position3D[];
  colors: ColorT[];
  dashed: boolean;
}

export function* generateSegments<T, ColorT>(
  data: Iterable<T>,
  opts: {
    getPosition: (d: T) => Position3D | null;
    getTimestamp: (d: T) => number | null;
    getColor: (d: T) => ColorT;
    gapColor: ColorT;
    maxGapSeconds: number;
  }
): Generator<PathSegment<ColorT>> {
  let segment: PathSegment<ColorT> = { path: [], colors: [], dashed: false };
  let lastT: number | null = null;
  let lastPos: Position3D | null = null;

  for (const d of data) {
    const pos = opts.getPosition(d);
    if (!pos) continue;

    const t = opts.getTimestamp(d);

    if (lastT !== null && t !== null && lastPos !== null) {
      if (Math.abs(t - lastT) > opts.maxGapSeconds) {
        if (segment.path.length > 1) {
          yield segment;
        }
        yield {
          path: [lastPos, pos],
          colors: [opts.gapColor, opts.gapColor],
          dashed: true
        };
        segment = { path: [], colors: [], dashed: false };
      }
    }

    segment.path.push(pos);
    segment.colors.push(opts.getColor(d));

    lastT = t;
    lastPos = pos;
  }

  if (segment.path.length > 1) {
    yield segment;
  }
}
