import { reactive } from "vue";
import type { NavaidPoint } from "./datasets";
import type { Field15TokenCategory } from "./field15Tokens";
import type { RouteLeg } from "./geometry";

export class NavaidTooltipRow {
  private constructor(
    readonly primary: string,
    readonly secondary?: string
  ) {}

  static pair(primary: string, secondary: string): NavaidTooltipRow {
    return new NavaidTooltipRow(primary, secondary);
  }

  static line(text: string): NavaidTooltipRow {
    return new NavaidTooltipRow(text);
  }
}

export class NavaidTooltip {
  private constructor(
    readonly title: string,
    readonly type: string,
    readonly subtitle: string | undefined,
    readonly rows: NavaidTooltipRow[],
    readonly warnings: string[],
    readonly warningCategory: Field15TokenCategory | undefined
  ) {}

  static fromPoint(
    point: NavaidPoint,
    warnings: string[] = [],
    warningCategory?: Field15TokenCategory
  ): NavaidTooltip {
    return new NavaidTooltip(
      point.ident,
      point.kind.toUpperCase(),
      point.name !== point.ident ? point.name : undefined,
      [
        NavaidTooltipRow.pair(
          coordinateLabel(point.latitude, "N", "S"),
          coordinateLabel(point.longitude, "E", "W")
        )
      ],
      warnings,
      warningCategory
    );
  }

  static fromLeg(
    leg: RouteLeg,
    typeOverride?: string,
    warnings: string[] = [],
    warningCategory?: Field15TokenCategory
  ): NavaidTooltip {
    const segment = leg.feature.properties;
    const title = segment.connector || segment.name || "DCT";
    const sourceType = (segment.segment_type || "route").toUpperCase();
    const type =
      typeOverride ??
      (sourceType === "UNRESOLVED"
        ? title.toUpperCase() === "DCT"
          ? "Direct"
          : "ATS route"
        : sourceType === title.toUpperCase()
          ? sourceType === "DCT"
            ? "Direct"
            : "Route"
          : sourceType);
    return new NavaidTooltip(
      title,
      type,
      undefined,
      [
        NavaidTooltipRow.line(
          `${segment.start_name || "?"} ❯ ${segment.end_name || "?"}`
        ),
        NavaidTooltipRow.line(formatDistance(leg.distanceNm))
      ],
      warnings,
      warningCategory
    );
  }

  static fromWarnings(
    label: string,
    type: string,
    warnings: string[],
    warningCategory: Field15TokenCategory
  ): NavaidTooltip {
    return new NavaidTooltip(label, type, undefined, [], warnings, warningCategory);
  }
}

interface NavaidHighlightTarget {
  entryId: string;
  tokenIndices: number[];
  pointKeys: string[];
  segmentKeys: string[];
}

interface NavaidHoverState {
  target: NavaidHighlightTarget;
  tooltip: NavaidTooltip;
  x: number;
  y: number;
}

interface NavaidInteractionState {
  hover: NavaidHoverState | null;
}

/** Opaque claim used so stale cleanup cannot clear a newer hover. */
export type NavaidInteractionClaim = symbol;

function coordinateLabel(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(4)}°${value >= 0 ? positive : negative}`;
}

function formatDistance(distanceNm: number): string {
  const maximumFractionDigits = distanceNm < 10 ? 1 : 0;
  return `${distanceNm.toLocaleString("en-US", { maximumFractionDigits })} NM`;
}

export class NavaidInteraction {
  readonly state = reactive<NavaidInteractionState>({
    hover: null
  });

  private hoverClaim: NavaidInteractionClaim | null = null;

  claimHover(
    target: NavaidHighlightTarget,
    tooltip: NavaidTooltip,
    x: number,
    y: number
  ): NavaidInteractionClaim {
    const claim = Symbol();
    this.hoverClaim = claim;
    this.state.hover = { target, tooltip, x, y };
    return claim;
  }

  moveHover(claim: NavaidInteractionClaim, x: number, y: number): boolean {
    if (this.hoverClaim !== claim || !this.state.hover) return false;
    this.state.hover.x = x;
    this.state.hover.y = y;
    return true;
  }

  releaseHover(claim: NavaidInteractionClaim): void {
    if (this.hoverClaim === claim) this.clearHover();
  }

  clearHover(): void {
    this.hoverClaim = null;
    this.state.hover = null;
  }
}
