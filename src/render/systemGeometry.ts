import type { LocationId } from "../core/types";

export interface Point { x: number; y: number; }
export interface ChartGeom { cx: number; cy: number; w: number; h: number; }
export interface ChartNode extends Point { r: number; }
export type ChartNodes = Record<LocationId, ChartNode>;

export function systemNodes(g: ChartGeom): ChartNodes {
  const compact = g.w < 520;
  const short = g.h < 440;
  const scale = Math.min(1, g.w / 760, g.h / 530);
  return {
    earth: { x: g.cx - g.w * 0.27, y: g.cy + g.h * (short ? 0.04 : 0.16), r: Math.max(24, 62 * scale) },
    luna: { x: g.cx - g.w * (compact ? short ? 0.02 : 0.16 : 0.05), y: g.cy - g.h * (short ? 0.05 : 0.16), r: Math.max(17, 33 * scale) },
    mars: { x: g.cx + g.w * 0.28, y: g.cy + g.h * (short ? 0.08 : 0.13), r: Math.max(23, 49 * scale) },
  };
}

// Canonical controls keep the visible route and both flight directions aligned.
export function routeControl(nodes: ChartNodes, from: LocationId, to: LocationId, geom: ChartGeom): Point {
  const [a, b] = [from, to].sort() as [LocationId, LocationId];
  const A = nodes[a], B = nodes[b];
  const width = Math.abs(B.x - A.x);
  const lift = a === "earth" && b === "mars" ? Math.min(width * 0.25, geom.h * 0.18) : -Math.min(width * 0.07, geom.h * 0.12);
  return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 + lift };
}

export function dockMarker(node: ChartNode): Point {
  return { x: node.x + node.r + 10, y: node.y - 8 };
}

export function routePoint(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

export function hitSystemBody(mx: number, my: number, nodes: ChartNodes): LocationId | null {
  for (const id of ["luna", "earth", "mars"] as const) {
    const p = nodes[id];
    if ((mx - p.x) ** 2 + (my - p.y) ** 2 <= (p.r + 8) ** 2) return id;
  }
  return null;
}
