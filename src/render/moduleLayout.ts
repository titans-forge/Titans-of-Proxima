import type { BuildingId, WorldId } from "../core/types";
import type { BuildingStatus } from "../core/buildingStatus";

export interface Rect { x: number; y: number; w: number; h: number }
export const MODULE_LABEL_FONT = '600 11px "Sora", "Avenir Next", "Segoe UI", sans-serif';
export const MODULE_STATUS_FONT = '500 10px "IBM Plex Mono", ui-monospace, monospace';
export const MODULE_NAMES: Record<BuildingId, string> = {
  command: "Command", habitat: "Habitat", solar: "Solar", fission: "Fission", fusion: "Fusion",
  ice: "Ice mine", isru: "ISRU", greenhouse: "Greenhouse", shipyard: "Shipyard", lab: "Lab",
  pad: "Starport", defense: "Defense", medical: "Medical", he3: "He-3", depot: "Depot",
  regolith: "Regolith", processor: "Processor", robotics: "Robotics", aresfab: "Chip foundry",
};

export function moduleSpriteRect(world: WorldId, type: BuildingId, aspect = 1, size = 58): Rect {
  const marsFab = world === "mars" && type === "aresfab";
  const limit = size * (marsFab ? 1.5 : 1.64);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const w = safeAspect >= 1 ? limit : limit * safeAspect;
  const h = safeAspect >= 1 ? limit / safeAspect : limit;
  // The new sprite's lowest foundation pixels sit at 87% of the transparent frame.
  return { x: -w / 2, y: marsFab ? 24 - h * 0.87 : -size * 0.9, w, h };
}

export function moduleShadow(world: WorldId, type: BuildingId): { y: number; rx: number; ry: number } {
  return world === "mars" && type === "aresfab" ? { y: 16, rx: 35, ry: 9 } : { y: 31, rx: 34, ry: 9 };
}

export function structuralOpacity(status: BuildingStatus, hp: number): number {
  if (status === "construction") return 0.76;
  return Math.max(0.75, Math.min(1, 0.75 + Math.max(0, hp) / 400));
}

export interface AnnotationRequest {
  id: string; x: number; top: number; bottom: number; left: number; right: number;
  width: number; height: number; priority: number;
}
export interface AnnotationPlacement { id: string; rect: Rect; leader: boolean }

export function overlaps(a: Rect, b: Rect, gap = 3): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

export function layoutModuleAnnotations(
  requests: AnnotationRequest[], viewport: Rect, roofs: { id: string; rect: Rect }[], exclusions: Rect[] = [],
): AnnotationPlacement[] {
  const placed: AnnotationPlacement[] = [];
  const visible = (r: Rect): boolean => r.x >= viewport.x && r.y >= viewport.y && r.x + r.w <= viewport.x + viewport.w && r.y + r.h <= viewport.y + viewport.h;
  for (const item of [...requests].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    if (item.right < viewport.x || item.left > viewport.x + viewport.w || item.bottom < viewport.y || item.top > viewport.y + viewport.h) continue;
    const candidates: Rect[] = [
      { x: item.x - item.width / 2, y: item.bottom + 5, w: item.width, h: item.height },
      { x: item.x - item.width / 2, y: item.top - item.height - 5, w: item.width, h: item.height },
      { x: item.right + 5, y: (item.top + item.bottom - item.height) / 2, w: item.width, h: item.height },
      { x: item.left - item.width - 5, y: (item.top + item.bottom - item.height) / 2, w: item.width, h: item.height },
    ];
    const clear = (r: Rect): boolean => visible(r) && !placed.some(p => overlaps(p.rect, r)) && !exclusions.some(e => overlaps(e, r));
    let chosen = candidates.find(r => clear(r) && !roofs.some(roof => roof.id !== item.id && overlaps(roof.rect, r, 1)));
    // Selected/hovered structures retain a backed callout when a dense colony has no empty gap.
    if (!chosen && item.priority > 0) chosen = candidates.find(clear);
    if (!chosen && item.priority > 0 && item.x >= viewport.x && item.x <= viewport.x + viewport.w && item.bottom >= viewport.y && item.top <= viewport.y + viewport.h && item.width <= viewport.w && item.height <= viewport.h) {
      const clamped = { ...candidates[0]!, x: Math.max(viewport.x, Math.min(viewport.x + viewport.w - item.width, candidates[0]!.x)), y: Math.max(viewport.y, Math.min(viewport.y + viewport.h - item.height, candidates[0]!.y)) };
      if (clear(clamped)) chosen = clamped;
    }
    if (chosen) placed.push({ id: item.id, rect: chosen, leader: chosen !== candidates[0] });
  }
  return placed;
}

export function warningMarkerRect(item: AnnotationRequest, viewport: Rect, exclusions: Rect[]): Rect | null {
  const size = 18;
  const candidates = [
    { x: item.right - size, y: item.top + 3, w: size, h: size },
    { x: item.left, y: item.top + 3, w: size, h: size },
    { x: item.x - size / 2, y: item.bottom - size, w: size, h: size },
  ];
  return candidates.find(r => r.x >= viewport.x && r.y >= viewport.y && r.x + r.w <= viewport.x + viewport.w && r.y + r.h <= viewport.y + viewport.h && !exclusions.some(e => overlaps(e, r, 1))) ?? null;
}
