import type { BuildingId, WorldId } from "../core/types";

export interface AtlasSource { image: HTMLImageElement; sx: number; sy: number; sw: number; sh: number }
const cache = new Map<string, HTMLImageElement>();
const BASE = import.meta.env.BASE_URL;
function load(path: string): HTMLImageElement {
  let img = cache.get(path);
  if (!img) { img = new Image(); img.src = path; cache.set(path, img); }
  return img;
}

export function terrainImage(world: WorldId): HTMLImageElement {
  return load(`${BASE}assets/${world === "mars" ? "mars-terrain.png" : "lunar-terrain.png"}`);
}

const MAIN: Record<WorldId, Partial<Record<BuildingId, number>>> = {
  mars: { command: 0, solar: 1, fission: 2, ice: 3, habitat: 4, isru: 5, regolith: 6, depot: 7 },
  luna: { habitat: 0, solar: 1, fission: 2, isru: 3, medical: 4, processor: 5, lab: 6, ice: 7 },
};
const EXPANSION: Record<WorldId, Partial<Record<BuildingId, number>>> = {
  mars: { defense: 0, greenhouse: 1, medical: 2 },
  luna: { defense: 0, greenhouse: 1, pad: 2 },
};
export interface SpriteSpec { file: string; index: number; cols: number; rows: number }
function spriteSpec(world: WorldId, type: BuildingId): SpriteSpec {
  // Shared art is deliberate; the structure name remains the gameplay authority.
  const industry: Partial<Record<BuildingId, number>> = { pad: 0, robotics: 1, aresfab: 2, depot: 3 };
  if (industry[type] !== undefined) return { file: "proxima-industry-v1.png", index: industry[type]!, cols: 2, rows: 2 };
  const science: Partial<Record<BuildingId, number>> = { lab: 0, medical: 1, he3: 2, processor: 3 };
  if (science[type] !== undefined) return { file: "proxima-science-v1.png", index: science[type]!, cols: 2, rows: 2 };
  const specialist: Partial<Record<BuildingId, number>> = { pad: 0, shipyard: 1, fusion: 2, defense: 3 };
  if (specialist[type] !== undefined) return { file: "proxima-specialists-v1.png", index: specialist[type]!, cols: 2, rows: 2 };
  if (type === "command") return { file: "building-atlas.png", index: 0, cols: 4, rows: 2 };
  if (type === "lab") return { file: "colony-building-atlas.png", index: 6, cols: 4, rows: 2 };
  const main = MAIN[world][type];
  if (main !== undefined) return { file: world === "mars" ? "building-atlas.png" : "colony-building-atlas.png", index: main, cols: 4, rows: 2 };
  const expansion = EXPANSION[world][type];
  if (expansion !== undefined) return { file: world === "mars" ? "building-atlas-expansion.png" : "colony-building-atlas-expansion.png", index: expansion, cols: 3, rows: 1 };
  const shared: Partial<Record<BuildingId, number>> = { fusion: 2, regolith: 6, depot: 7, shipyard: 6, pad: 0, he3: 3, processor: 5 };
  return { file: "building-atlas.png", index: shared[type] ?? 0, cols: 4, rows: 2 };
}

function atlasFrame(image: HTMLImageElement, index: number, cols: number, rows: number): AtlasSource {
  const sw = image.naturalWidth > 0 ? image.naturalWidth / cols : 443;
  const sh = image.naturalHeight > 0 ? image.naturalHeight / rows : 443;
  return { image, sx: (index % cols) * sw, sy: Math.floor(index / cols) * sh, sw, sh };
}

export function buildingSpriteStyle(world: WorldId, type: BuildingId): string {
  const {file, index, cols, rows} = spriteSpec(world, type);
  const path = `${BASE}assets/${file}`;
  return `background-image:url("${path}");background-size:${cols * 100}% ${rows * 100}%;background-position:${cols === 1 ? 0 : (index % cols) * (100 / (cols - 1))}% ${rows === 1 ? 0 : Math.floor(index / cols) * (100 / (rows - 1))}%`;
}

export function buildingImage(world: WorldId, type: BuildingId): AtlasSource | null {
  const {file, index, cols, rows} = spriteSpec(world, type);
  return atlasFrame(load(`${BASE}assets/${file}`), index, cols, rows);
}
