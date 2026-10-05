import { boundsForTiles } from "./camera";

export function continuousTerrainRect(tiles: { q: number; r: number }[], hex: number, viewport: { w: number; h: number }, aspect: number) {
  const bounds = boundsForTiles(tiles, hex);
  // Cover every legal pan at minimum zoom with one camera-anchored image.
  const width = bounds.maxX - bounds.minX + viewport.w / 0.55;
  const height = bounds.maxY - bounds.minY + viewport.h / 0.55;
  const w = Math.max(width, height * aspect);
  const h = w / aspect;
  return { x: (bounds.minX + bounds.maxX - w) / 2, y: (bounds.minY + bounds.maxY - h) / 2, w, h };
}
