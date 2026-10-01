import { axialToPixel } from "../core/hex";
import type { Camera } from "./draw";

export interface Viewport { width: number; height: number; }
export interface MapBounds { minX: number; maxX: number; minY: number; maxY: number; }

export function boundsForTiles(tiles: { q: number; r: number }[], hex: number, padding = hex * 1.2): MapBounds {
  const points = tiles.map((t) => axialToPixel(t.q, t.r, hex));
  if (!points.length) return { minX: -padding, maxX: padding, minY: -padding, maxY: padding };
  return {
    minX: Math.min(...points.map((p) => p.x)) - padding,
    maxX: Math.max(...points.map((p) => p.x)) + padding,
    minY: Math.min(...points.map((p) => p.y)) - padding,
    maxY: Math.max(...points.map((p) => p.y)) + padding,
  };
}

/** Clamp the target and current camera so every edge tile remains reachable. */
export function clampCamera(cam: Camera & { tx?: number; ty?: number }, _viewport: Viewport, bounds: MapBounds, minZoom = 0.55, maxZoom = 2.5): void {
  cam.zoom = Math.max(minZoom, Math.min(maxZoom, cam.zoom));
  // Keep the viewport center inside the map. Every edge tile can still be
  // centered, but dragging cannot strand the entire colony offscreen.
  const xMin = -bounds.maxX * cam.zoom;
  const xMax = -bounds.minX * cam.zoom;
  const yMin = -bounds.maxY * cam.zoom;
  const yMax = -bounds.minY * cam.zoom;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  cam.x = clamp(cam.x, xMin, xMax);
  cam.y = clamp(cam.y, yMin, yMax);
  if (cam.tx !== undefined) cam.tx = clamp(cam.tx, xMin, xMax);
  if (cam.ty !== undefined) cam.ty = clamp(cam.ty, yMin, yMax);
}
