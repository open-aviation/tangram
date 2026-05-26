import type {
  Accessor,
  Color,
  DefaultProps,
  Layer,
  LayerDataSource,
  LayerProps
} from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { LineLayer, PathLayer, SolidPolygonLayer } from "@deck.gl/layers";

const DEFAULT_COLOR = [0, 0, 0, 255] as const;

interface TemporalSegmentDefaultsInput {
  timestamp?: number;
  visibleUntil?: number;
  color?: Color;
  sourceColor?: Color;
  targetColor?: Color;
}

function defaultTimestamp(value: unknown): number {
  const input =
    typeof value === "object" && value !== null
      ? (value as TemporalSegmentDefaultsInput)
      : undefined;
  return input?.timestamp ?? Number.POSITIVE_INFINITY;
}

function defaultVisibleUntil(value: unknown): number {
  const input =
    typeof value === "object" && value !== null
      ? (value as TemporalSegmentDefaultsInput)
      : undefined;
  return input?.visibleUntil ?? Number.POSITIVE_INFINITY;
}

function defaultSourceColor(value: unknown): Color {
  const input =
    typeof value === "object" && value !== null
      ? (value as TemporalSegmentDefaultsInput)
      : undefined;
  return input?.sourceColor ?? input?.color ?? DEFAULT_COLOR;
}

function defaultTargetColor(value: unknown): Color {
  const input =
    typeof value === "object" && value !== null
      ? (value as TemporalSegmentDefaultsInput)
      : undefined;
  return input?.targetColor ?? input?.color ?? DEFAULT_COLOR;
}

const temporalSegmentShader = {
  name: "temporalSegment",
  vs: `
layout(std140) uniform temporalSegmentUniforms {
  float currentTime;
} temporalSegment;

in float instanceTimestamps;
in float instanceVisibleUntils;
in vec4 instanceSourceColors;
in vec4 instanceTargetColors;

out float temporalSegmentVisible;
`,
  fs: `
layout(std140) uniform temporalSegmentUniforms {
  float currentTime;
} temporalSegment;

in float temporalSegmentVisible;
`,
  inject: {
    "vs:#main-end": `
      temporalSegmentVisible = float(
        instanceTimestamps <= temporalSegment.currentTime &&
        temporalSegment.currentTime <= instanceVisibleUntils
      );
      if (temporalSegmentVisible == 0.0) {
        gl_Position = vec4(0.0);
      }

      vec4 temporalSegmentSourceColor = vec4(
        instanceSourceColors.rgb,
        instanceSourceColors.a * layer.opacity
      );
      vec4 temporalSegmentTargetColor = vec4(
        instanceTargetColors.rgb,
        instanceTargetColors.a * layer.opacity
      );
      vColor = mix(temporalSegmentSourceColor, temporalSegmentTargetColor, positions.x);
    `,
    "fs:DECKGL_FILTER_COLOR": `
      if (temporalSegmentVisible == 0.0) discard;
    `
  },
  uniformTypes: {
    currentTime: "f32" as const
  }
};

export type TemporalSegmentLayerProps<DataT = unknown> = {
  data: LayerDataSource<DataT>;
  currentTime: number;
  getTimestamp?: Accessor<DataT, number>;
  getVisibleUntil?: Accessor<DataT, number>;
  getSourceColor?: Accessor<DataT, Color>;
  getTargetColor?: Accessor<DataT, Color>;
} & LayerProps;

const temporalSegmentLayerDefaultProps: DefaultProps<TemporalSegmentLayerProps> = {
  ...LineLayer.defaultProps,
  currentTime: { type: "number", value: 0 },
  getTimestamp: { type: "accessor", value: defaultTimestamp },
  getVisibleUntil: { type: "accessor", value: defaultVisibleUntil },
  getSourceColor: {
    type: "accessor",
    value: defaultSourceColor
  },
  getTargetColor: {
    type: "accessor",
    value: defaultTargetColor
  }
};

/**
 * A playback-focused segment layer that keeps one GPU instance per semantic trajectory segment.
 *
 * `DataFilterExtension` filters already-tessellated geometry after a layer such as `PathLayer`
 * has expanded a logical path into cap/join mesh vertices. However it is less helpful for
 * historical playback where the visible trail tip must stay aligned with the marker.
 *
 * To avoid per-frame CPU filtering of large segment arrays, we expect pre-segmented, time-normalized
 * input and apply the temporal cutoff directly to one instanced line primitive per segment.
 */
export class TemporalSegmentLayer<DataT = unknown> extends LineLayer<
  DataT,
  Required<TemporalSegmentLayerProps<DataT>>
> {
  static defaultProps = temporalSegmentLayerDefaultProps;
  static layerName = "TemporalSegmentLayer";

  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      modules: [...(shaders.modules ?? []), temporalSegmentShader]
    };
  }

  initializeState() {
    super.initializeState();
    (this.state as { playbackCurrentTime?: number }).playbackCurrentTime =
      this.props.currentTime;

    this.getAttributeManager()?.addInstanced({
      instanceTimestamps: {
        size: 1,
        accessor: "getTimestamp",
        defaultValue: Number.POSITIVE_INFINITY
      },
      instanceVisibleUntils: {
        size: 1,
        accessor: "getVisibleUntil",
        defaultValue: Number.POSITIVE_INFINITY
      },
      instanceSourceColors: {
        size: this.props.colorFormat.length,
        type: "unorm8",
        accessor: "getSourceColor",
        defaultValue: DEFAULT_COLOR
      },
      instanceTargetColors: {
        size: this.props.colorFormat.length,
        type: "unorm8",
        accessor: "getTargetColor",
        defaultValue: DEFAULT_COLOR
      }
    });
  }

  setCurrentTime(currentTime: number): boolean {
    const state = this.state as { playbackCurrentTime?: number };
    if (state.playbackCurrentTime === currentTime) return false;

    state.playbackCurrentTime = currentTime;
    this.setNeedsRedraw();
    return true;
  }

  draw(options: Parameters<LineLayer["draw"]>[0]): void {
    const state = this.state as { playbackCurrentTime?: number };

    this.setShaderModuleProps({
      temporalSegment: {
        currentTime: state.playbackCurrentTime ?? this.props.currentTime
      }
    });

    super.draw(options);
  }
}

export type Position3D = [number, number, number];

export type DeckGLColor = [number, number, number, number];

export interface PathSegment<ColorT> {
  path: Position3D[];
  colors: ColorT[];
  dashed: boolean;
}

export interface TimedPathSegment<ColorT> extends PathSegment<ColorT> {
  timestamp: number | null;
  visibleUntil?: number | null;
}

export type SegmentLayerColor =
  | readonly [number, number, number]
  | readonly [number, number, number, number];

export interface TemporalLineSegment {
  sourcePosition: Position3D;
  targetPosition: Position3D;
  sourceColor: DeckGLColor;
  targetColor: DeckGLColor;
  timestamp: number;
  visibleUntil: number;
}

export interface PreparedTimedSegmentsForLayer<ColorT> {
  timeOrigin: number;
  solidSegments: TemporalLineSegment[];
  dashedSegments: TimedPathSegment<ColorT>[];
}

export interface TrajectoryPolygon<ColorT extends SegmentLayerColor> {
  polygon: Position3D[];
  color: ColorT;
}

export interface TimedTrajectoryPolygon<
  ColorT extends SegmentLayerColor
> extends TrajectoryPolygon<ColorT> {
  timestamp: number | null;
  visibleUntil?: number | null;
}

export interface PreparedTimedTrajectoryLayerData<
  PathColorT extends SegmentLayerColor,
  PolygonColorT extends SegmentLayerColor = PathColorT
> {
  segmentData: PreparedTimedSegmentsForLayer<PathColorT>;
  polygonData: TimedTrajectoryPolygon<PolygonColorT>[];
}

function createTimedGapLayer<PathColorT extends SegmentLayerColor>(
  data: TimedPathSegment<PathColorT>[],
  options: {
    idPrefix: string;
    style: Required<TrajectoryLayerStyle>;
  }
): PathLayer<TimedPathSegment<PathColorT>> | null {
  if (data.length === 0) return null;

  return new PathLayer({
    id: `${options.idPrefix}-path-gaps`,
    data,
    pickable: options.style.pickable,
    widthScale: options.style.widthScale,
    widthMinPixels: options.style.widthMinPixels,
    getPath: (segment: TimedPathSegment<PathColorT>) => segment.path,
    getColor: (segment: TimedPathSegment<PathColorT>) => segment.colors,
    getWidth: () => options.style.dashedWidth,
    extensions: [new PathStyleExtension({ dash: true })],
    getDashArray: () => options.style.dashArray,
    dashJustified: true
  });
}

function createTimedPolygonLayer<PolygonColorT extends SegmentLayerColor>(
  data: TimedTrajectoryPolygon<PolygonColorT>[],
  options: {
    idPrefix: string;
    polygonIdSuffix?: string;
    style: Required<TrajectoryLayerStyle>;
  }
): SolidPolygonLayer<TimedTrajectoryPolygon<PolygonColorT>> | null {
  if (data.length === 0) return null;

  return new SolidPolygonLayer({
    id: `${options.idPrefix}-${options.polygonIdSuffix ?? "curtain"}`,
    data,
    pickable: options.style.pickable,
    stroked: false,
    filled: true,
    extruded: false,
    _full3d: true,
    getPolygon: (polygon: TimedTrajectoryPolygon<PolygonColorT>) => polygon.polygon,
    getFillColor: (polygon: TimedTrajectoryPolygon<PolygonColorT>) => polygon.color
  });
}

/**
 * Builds playback layers from precomputed timed trajectory data.
 *
 * Solid segments stay on the GPU via TemporalSegmentLayer, while dashed gaps
 * and optional polygons remain CPU-filtered because they are sparse. If those
 * collections become dense enough to matter, they should move to their own
 * playback-focused primitives instead of falling back to generic PathLayer or
 * SolidPolygonLayer rebuilds inside the 60fps loop.
 */
export class TimedTrajectoryLayerController<
  PathColorT extends SegmentLayerColor,
  PolygonColorT extends SegmentLayerColor = PathColorT
> {
  private readonly style: Required<TrajectoryLayerStyle>;
  private readonly solidLayer: TemporalSegmentLayer<TemporalLineSegment> | null;
  private visibleGaps: TimedPathSegment<PathColorT>[];
  private visiblePolygons: TimedTrajectoryPolygon<PolygonColorT>[];
  private gapLayer: PathLayer<TimedPathSegment<PathColorT>> | null;
  private polygonLayer: SolidPolygonLayer<TimedTrajectoryPolygon<PolygonColorT>> | null;
  private currentLayers: Layer[] = [];

  constructor(
    private readonly data: PreparedTimedTrajectoryLayerData<PathColorT, PolygonColorT>,
    private readonly options: {
      currentTime: number;
      idPrefix: string;
      style?: TrajectoryLayerStyle;
      polygonIdSuffix?: string;
    }
  ) {
    this.style = resolveTrajectoryLayerStyle(options.style);
    this.visibleGaps = filterTimedItemsAtTime(
      data.segmentData.dashedSegments,
      options.currentTime
    );
    this.visiblePolygons = filterTimedItemsAtTime(
      data.polygonData,
      options.currentTime
    );
    this.solidLayer =
      data.segmentData.solidSegments.length > 0
        ? new TemporalSegmentLayer({
            id: `${options.idPrefix}-path`,
            data: data.segmentData.solidSegments,
            currentTime: options.currentTime - data.segmentData.timeOrigin,
            pickable: this.style.pickable,
            widthScale: this.style.widthScale,
            widthMinPixels: this.style.widthMinPixels,
            getSourcePosition: segment => segment.sourcePosition,
            getTargetPosition: segment => segment.targetPosition,
            getVisibleUntil: segment => segment.visibleUntil,
            getSourceColor: segment => segment.sourceColor,
            getTargetColor: segment => segment.targetColor,
            getWidth: () => this.style.solidWidth
          })
        : null;
    this.gapLayer = createTimedGapLayer(this.visibleGaps, {
      idPrefix: this.options.idPrefix,
      style: this.style
    });
    this.polygonLayer = createTimedPolygonLayer(this.visiblePolygons, {
      idPrefix: this.options.idPrefix,
      polygonIdSuffix: this.options.polygonIdSuffix,
      style: this.style
    });
    this.rebuildLayerList();
  }

  get layers(): Layer[] {
    return this.currentLayers;
  }

  setCurrentTime(currentTime: number): {
    layersChanged: boolean;
    needsRepaint: boolean;
  } {
    const solidLayerChanged =
      this.solidLayer?.setCurrentTime(currentTime - this.data.segmentData.timeOrigin) ??
      false;

    const nextVisibleGaps = filterTimedItemsAtTime(
      this.data.segmentData.dashedSegments,
      currentTime
    );
    const nextVisiblePolygons = filterTimedItemsAtTime(
      this.data.polygonData,
      currentTime
    );
    let gapsChanged = this.visibleGaps.length !== nextVisibleGaps.length;
    if (!gapsChanged) {
      for (let index = 0; index < this.visibleGaps.length; index += 1) {
        if (this.visibleGaps[index] !== nextVisibleGaps[index]) {
          gapsChanged = true;
          break;
        }
      }
    }

    let polygonsChanged = this.visiblePolygons.length !== nextVisiblePolygons.length;
    if (!polygonsChanged) {
      for (let index = 0; index < this.visiblePolygons.length; index += 1) {
        if (this.visiblePolygons[index] !== nextVisiblePolygons[index]) {
          polygonsChanged = true;
          break;
        }
      }
    }

    if (!gapsChanged && !polygonsChanged) {
      return {
        layersChanged: false,
        needsRepaint: solidLayerChanged
      };
    }

    if (gapsChanged) {
      this.visibleGaps = nextVisibleGaps;
      this.gapLayer = createTimedGapLayer(this.visibleGaps, {
        idPrefix: this.options.idPrefix,
        style: this.style
      });
    }

    if (polygonsChanged) {
      this.visiblePolygons = nextVisiblePolygons;
      this.polygonLayer = createTimedPolygonLayer(this.visiblePolygons, {
        idPrefix: this.options.idPrefix,
        polygonIdSuffix: this.options.polygonIdSuffix,
        style: this.style
      });
    }

    this.rebuildLayerList();
    return {
      layersChanged: true,
      needsRepaint: true
    };
  }

  private rebuildLayerList(): void {
    const layers: Layer[] = [];

    if (this.solidLayer) {
      layers.push(this.solidLayer);
    }
    if (this.gapLayer) {
      layers.push(this.gapLayer);
    }
    if (this.polygonLayer) {
      layers.push(this.polygonLayer);
    }

    this.currentLayers = layers;
  }
}

export interface TrajectoryLayerStyle {
  pickable?: boolean;
  widthScale?: number;
  widthMinPixels?: number;
  solidWidth?: number;
  dashedWidth?: number;
  dashArray?: readonly [number, number];
}

const DEFAULT_TRAJECTORY_LAYER_STYLE: Required<TrajectoryLayerStyle> = {
  pickable: false,
  widthScale: 1,
  widthMinPixels: 2,
  solidWidth: 2,
  dashedWidth: 1,
  dashArray: [5, 5]
};

function resolveTrajectoryLayerStyle(
  style: TrajectoryLayerStyle | undefined
): Required<TrajectoryLayerStyle> {
  return {
    ...DEFAULT_TRAJECTORY_LAYER_STYLE,
    ...style,
    dashArray: style?.dashArray ?? DEFAULT_TRAJECTORY_LAYER_STYLE.dashArray
  };
}

function toDeckGLColor(color: SegmentLayerColor): DeckGLColor {
  return [color[0], color[1], color[2], color[3] ?? 255];
}

export function segmentTrajectoryRecords<T>(
  records: ReadonlyArray<T>,
  options: {
    getId: (record: T) => string | null | undefined;
    getTimestamp: (record: T) => number | null;
    maxGapSeconds: number;
    fallbackId?: string;
  }
): T[][] {
  const buckets = new Map<string, T[]>();

  for (const record of records) {
    const key = options.getId(record) || options.fallbackId || "trajectory";
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }

  const groups: T[][] = [];
  for (const bucket of buckets.values()) {
    const sorted = [...bucket].sort(
      (left, right) =>
        (options.getTimestamp(left) ?? 0) - (options.getTimestamp(right) ?? 0)
    );

    let segment: T[] = [];
    for (const record of sorted) {
      const previous = segment.length > 0 ? segment[segment.length - 1] : undefined;
      const previousTimestamp = previous ? options.getTimestamp(previous) : null;
      const currentTimestamp = options.getTimestamp(record);
      const gapSeconds =
        previousTimestamp !== null && currentTimestamp !== null
          ? currentTimestamp - previousTimestamp
          : 0;

      if (segment.length > 0 && gapSeconds > options.maxGapSeconds) {
        groups.push(segment);
        segment = [];
      }

      segment.push(record);
    }

    if (segment.length > 0) {
      groups.push(segment);
    }
  }

  return groups;
}

export function latestTrajectoryPoints<T>(
  segments: ReadonlyArray<ReadonlyArray<T>>
): T[] {
  return segments
    .map(segment => segment[segment.length - 1])
    .filter((record): record is T => record !== undefined);
}

export function findTrajectorySampleAtTime<T>(
  points: readonly T[],
  time: number,
  getTimestamp: (point: T) => number | null
): T | null {
  const index = findTrajectorySampleIndexAtTime(points, time, getTimestamp);
  return index === null ? null : points[index];
}

export function findTrajectorySampleIndexAtTime<T>(
  points: readonly T[],
  time: number,
  getTimestamp: (point: T) => number | null
): number | null {
  if (points.length === 0) return null;

  const firstTimestamp = getTimestamp(points[0]);
  const lastTimestamp = getTimestamp(points[points.length - 1]);
  if (firstTimestamp === null || lastTimestamp === null) return null;
  if (time < firstTimestamp || time > lastTimestamp) return null;

  let low = 0;
  let high = points.length - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const midTimestamp = getTimestamp(points[mid]);
    if (midTimestamp === null) return null;

    if (midTimestamp < time) {
      low = mid + 1;
    } else if (midTimestamp > time) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return high >= 0 ? high : null;
}

export function trajectoryPointsBeforeTime<T>(
  points: readonly T[],
  time: number,
  getTimestamp: (point: T) => number | null
): T[] {
  if (points.length === 0) return [];

  const firstTimestamp = getTimestamp(points[0]);
  if (firstTimestamp === null || time <= firstTimestamp) return [];

  const lastTimestamp = getTimestamp(points[points.length - 1]);
  if (lastTimestamp !== null && time > lastTimestamp) {
    return [...points];
  }

  let low = 0;
  let high = points.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    const midTimestamp = getTimestamp(points[mid]);
    if (midTimestamp === null) return [];

    if (midTimestamp < time) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return points.slice(0, low);
}

export function prepareTimedSegmentsForLayer<ColorT extends SegmentLayerColor>(
  segments: Iterable<TimedPathSegment<ColorT>>
): PreparedTimedSegmentsForLayer<ColorT> {
  const solidSegments: TemporalLineSegment[] = [];
  const dashedSegments: TimedPathSegment<ColorT>[] = [];
  let timeOrigin = Number.POSITIVE_INFINITY;

  for (const segment of segments) {
    if (segment.dashed) {
      dashedSegments.push(segment);
      continue;
    }

    if (
      segment.timestamp === null ||
      segment.path.length < 2 ||
      segment.colors.length < 2
    ) {
      continue;
    }

    timeOrigin = Math.min(timeOrigin, segment.timestamp);
    solidSegments.push({
      sourcePosition: segment.path[0],
      targetPosition: segment.path[1],
      sourceColor: toDeckGLColor(segment.colors[0]),
      targetColor: toDeckGLColor(segment.colors[1]),
      timestamp: segment.timestamp,
      visibleUntil: segment.visibleUntil ?? Number.POSITIVE_INFINITY
    });
  }

  const normalizedTimeOrigin = Number.isFinite(timeOrigin) ? timeOrigin : 0;

  return {
    timeOrigin: normalizedTimeOrigin,
    solidSegments: solidSegments.map(segment => ({
      ...segment,
      timestamp: segment.timestamp - normalizedTimeOrigin,
      visibleUntil: segment.visibleUntil - normalizedTimeOrigin
    })),
    dashedSegments
  };
}

export function filterTimedItemsAtTime<
  T extends { timestamp: number | null; visibleUntil?: number | null }
>(items: readonly T[], time: number): T[] {
  const visible: T[] = [];

  for (const item of items) {
    if (
      item.timestamp !== null &&
      item.timestamp <= time &&
      (item.visibleUntil === null ||
        item.visibleUntil === undefined ||
        time <= item.visibleUntil)
    ) {
      visible.push(item);
    }
  }

  return visible;
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
  let lastTimestamp: number | null = null;
  let lastPosition: Position3D | null = null;

  for (const item of data) {
    const position = opts.getPosition(item);
    if (!position) continue;

    const timestamp = opts.getTimestamp(item);

    if (lastTimestamp !== null && timestamp !== null && lastPosition !== null) {
      if (Math.abs(timestamp - lastTimestamp) > opts.maxGapSeconds) {
        if (segment.path.length > 1) {
          yield segment;
        }

        yield {
          path: [lastPosition, position],
          colors: [opts.gapColor, opts.gapColor],
          dashed: true
        };

        segment = { path: [], colors: [], dashed: false };
      }
    }

    segment.path.push(position);
    segment.colors.push(opts.getColor(item));

    lastTimestamp = timestamp;
    lastPosition = position;
  }

  if (segment.path.length > 1) {
    yield segment;
  }
}

export function generateTimedSegments<T, ColorT>(
  data: Iterable<T>,
  opts: {
    getPosition: (d: T) => Position3D | null;
    getTimestamp: (d: T) => number | null;
    getColor: (d: T) => ColorT;
    gapColor: ColorT;
    maxGapSeconds: number;
  }
): TimedPathSegment<ColorT>[] {
  const segments: TimedPathSegment<ColorT>[] = [];
  let lastTimestamp: number | null = null;
  let lastPosition: Position3D | null = null;
  let lastColor: ColorT | null = null;

  for (const item of data) {
    const position = opts.getPosition(item);
    if (!position) continue;

    const timestamp = opts.getTimestamp(item);
    const color = opts.getColor(item);

    if (lastTimestamp !== null && timestamp !== null && lastPosition !== null) {
      if (Math.abs(timestamp - lastTimestamp) > opts.maxGapSeconds) {
        segments.push({
          path: [lastPosition, position],
          colors: [opts.gapColor, opts.gapColor],
          dashed: true,
          timestamp
        });
      } else if (lastColor !== null) {
        segments.push({
          path: [lastPosition, position],
          colors: [lastColor, color],
          dashed: false,
          timestamp
        });
      }
    }

    lastTimestamp = timestamp;
    lastPosition = position;
    lastColor = color;
  }

  for (const segment of segments) {
    segment.visibleUntil = lastTimestamp;
  }

  return segments;
}

export function buildTrajectoryCurtainPolygons<ColorT extends SegmentLayerColor>(
  segments: Iterable<PathSegment<ColorT>>
): TrajectoryPolygon<ColorT>[] {
  const polygons: TrajectoryPolygon<ColorT>[] = [];

  for (const segment of segments) {
    if (segment.dashed || segment.path.length < 2) {
      continue;
    }

    for (let index = 1; index < segment.path.length; index += 1) {
      const [lon1, lat1, z1] = segment.path[index - 1];
      const [lon2, lat2, z2] = segment.path[index];
      const color = segment.colors[index] ?? segment.colors[index - 1];
      if (!color) continue;

      polygons.push({
        polygon: [
          [lon1, lat1, 0],
          [lon2, lat2, 0],
          [lon2, lat2, z2],
          [lon1, lat1, z1]
        ],
        color
      });
    }
  }

  return polygons;
}

export function buildTimedTrajectoryCurtainPolygons<ColorT extends SegmentLayerColor>(
  segments: Iterable<TimedPathSegment<ColorT>>
): TimedTrajectoryPolygon<ColorT>[] {
  const polygons: TimedTrajectoryPolygon<ColorT>[] = [];

  for (const segment of segments) {
    if (segment.dashed || segment.path.length < 2) {
      continue;
    }

    const [start, end] = segment.path;
    const color = segment.colors[1] ?? segment.colors[0];
    if (!color) continue;

    const [lon1, lat1, z1] = start;
    const [lon2, lat2, z2] = end;

    polygons.push({
      polygon: [
        [lon1, lat1, 0],
        [lon2, lat2, 0],
        [lon2, lat2, z2],
        [lon1, lat1, z1]
      ],
      color,
      timestamp: segment.timestamp,
      visibleUntil: segment.visibleUntil
    });
  }

  return polygons;
}

/**
 * Precomputes the stable timed buffers once so playback only updates the GPU
 * cutoff uniform and filters the smaller CPU-side gap and polygon collections.
 *
 * Callers are expected to pass time-sorted trajectory segments and then keep
 * the returned arrays stable during playback. This lets the dense solid
 * segments stay in one contiguous buffer instead of rebuilding geometry on
 * every animation frame.
 */
export function prepareTimedTrajectoryLayerData<PathColorT extends SegmentLayerColor>(
  segments: Iterable<TimedPathSegment<PathColorT>>,
  options: {
    includeCurtains?: boolean;
  } = {}
): PreparedTimedTrajectoryLayerData<PathColorT> {
  const collectedSegments = Array.from(segments);

  return {
    segmentData: prepareTimedSegmentsForLayer(collectedSegments),
    polygonData: options.includeCurtains
      ? buildTimedTrajectoryCurtainPolygons(collectedSegments)
      : []
  };
}

export function buildTrajectoryLayers<
  PathColorT extends SegmentLayerColor,
  PolygonColorT extends SegmentLayerColor = PathColorT
>(
  segments: Iterable<PathSegment<PathColorT>>,
  options: {
    idPrefix: string;
    style?: TrajectoryLayerStyle;
    polygons?: Iterable<TrajectoryPolygon<PolygonColorT>>;
    polygonIdSuffix?: string;
  }
): Layer[] {
  const layers: Layer[] = [];
  const style = resolveTrajectoryLayerStyle(options.style);
  const pathData = Array.from(segments);

  if (pathData.length > 0) {
    layers.push(
      new PathLayer({
        id: `${options.idPrefix}-path`,
        data: pathData,
        pickable: style.pickable,
        widthScale: style.widthScale,
        widthMinPixels: style.widthMinPixels,
        getPath: (segment: PathSegment<PathColorT>) => segment.path,
        getColor: (segment: PathSegment<PathColorT>) => segment.colors,
        getWidth: (segment: PathSegment<PathColorT>) =>
          segment.dashed ? style.dashedWidth : style.solidWidth,
        extensions: [new PathStyleExtension({ dash: true })],
        getDashArray: (segment: PathSegment<PathColorT>) =>
          segment.dashed ? style.dashArray : [0, 0],
        dashJustified: true
      })
    );
  }

  const polygonData = options.polygons ? Array.from(options.polygons) : [];
  if (polygonData.length > 0) {
    layers.push(
      new SolidPolygonLayer({
        id: `${options.idPrefix}-${options.polygonIdSuffix ?? "curtain"}`,
        data: polygonData,
        pickable: style.pickable,
        stroked: false,
        filled: true,
        extruded: false,
        _full3d: true,
        getPolygon: (polygon: TrajectoryPolygon<PolygonColorT>) => polygon.polygon,
        getFillColor: (polygon: TrajectoryPolygon<PolygonColorT>) => polygon.color
      })
    );
  }

  return layers;
}
