// Draws a persistent point on the map for a selected navaid or fix — no
// persistent text label, but a hover tooltip (the shared "nice box") shows its
// metadata, and clicking the point opens a remove menu.
//
// Many points may be on the map at once; each gets a unique `itemId` so its
// deck.gl layer ids never collide.

import { ScatterplotLayer } from "@deck.gl/layers";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import type { NavPointInfo } from "./tooltip";
import {
  mountPointTooltip,
  showPointTooltip,
  hidePointTooltip
} from "./tooltip";
import { openRemoveMenu } from "./removeMenu";

export type { NavPointInfo };

type RGB = [number, number, number];
const POINT_COLOR: RGB = [255, 140, 0];

export function drawPoint(
  api: TangramApi,
  pluginId: string,
  itemId: string,
  info: NavPointInfo,
  onRemove: () => void
): Disposable {
  const map = api.map.getMapInstance();
  const container = map.getContainer();
  const tooltip = mountPointTooltip(container);

  const coordinates: [number, number] = [info.lon, info.lat];
  const title = info.name || info.ident;

  const pointLayer = new ScatterplotLayer<NavPointInfo>({
    id: `tangram-navaid-point-${itemId}`,
    data: [info],
    visible: true,
    pickable: true,
    radiusMinPixels: 5,
    radiusMaxPixels: 10,
    getRadius: 7,
    getFillColor: POINT_COLOR,
    getPosition: () => coordinates,
    onHover: ({ x, y, object }) => {
      if (object) {
        showPointTooltip(tooltip, info, x, y, container);
        map.getCanvas().style.cursor = "pointer";
      } else {
        hidePointTooltip(tooltip);
        map.getCanvas().style.cursor = "";
      }
    },
    onClick: ({ x, y }) => {
      openRemoveMenu({
        container,
        x,
        y,
        title,
        onRemove
      });
    }
  });

  const disposable = api.map.addLayer(pointLayer, {
    pluginId,
    slot: "highlights"
  });

  return {
    dispose: () => {
      disposable.dispose();
      tooltip.remove();
      map.getCanvas().style.cursor = "";
    }
  };
}
