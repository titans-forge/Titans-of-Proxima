import { hexNeighbors, hexRange, tileKey } from "./hex";
import { hash01 } from "./rng";
import type { Terrain, Tile, WorldId } from "./types";

function clampN(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function generateMap(world: WorldId, radius: number, seed: number): Tile[] {
  const tiles: Tile[] = [];
  for (const { q, r } of hexRange(radius)) {
    const h = hash01(q, r, seed);
    const h2 = hash01(q, r, seed ^ 0x9e3779b9);
    const polar = Math.abs(r) >= radius - 1;
    let terrain: Terrain;
    if (world === "luna") {
      if (polar) terrain = "polar";
      else if (h < 0.2) terrain = "crater";
      else if (h < 0.52) terrain = "mare";
      else if (h < 0.78) terrain = "highland";
      else terrain = "rille";
    } else if (polar) {
      terrain = "polar";
    } else if (Math.abs(q) <= 1 && Math.abs(r) <= 2) {
      terrain = "canyon";
    } else if (Math.abs(q - 3) + Math.abs(r + 1) <= 1) {
      terrain = "volcano";
    } else if (h < 0.16) {
      terrain = "crater";
    } else if (h < 0.34) {
      terrain = "dust";
    } else {
      terrain = "plain";
    }

    let ice = 0;
    let metal = 0;
    let he3 = 0;
    let regolith = 40 + h2 * 35;
    if (terrain === "polar") {
      ice = 72 + h * 28;
      metal = 8 + h2 * 18;
      he3 = 4 + h * 8;
      regolith = 28 + h2 * 20;
    } else if (terrain === "crater") {
      ice = 18 + h * 36;
      metal = 34 + h2 * 40;
      he3 = 12 + h * 20;
      regolith = 45 + h2 * 25;
    } else if (terrain === "mare") {
      ice = h * 14;
      metal = 18 + h2 * 22;
      he3 = 48 + h * 42;
      regolith = 55 + h2 * 30;
    } else if (terrain === "highland") {
      ice = h * 10;
      metal = 52 + h2 * 40;
      he3 = 10 + h * 16;
      regolith = 40 + h2 * 25;
    } else if (terrain === "rille") {
      ice = 6 + h * 16;
      metal = 22 + h2 * 24;
      he3 = 16 + h * 18;
      regolith = 60 + h2 * 28;
    } else if (terrain === "canyon") {
      ice = 10 + h * 22;
      metal = 28 + h2 * 30;
      he3 = 6;
      regolith = 50 + h2 * 30;
    } else if (terrain === "volcano") {
      ice = h * 8;
      metal = 60 + h2 * 35;
      he3 = 8;
      regolith = 48 + h2 * 20;
    } else if (terrain === "dust") {
      ice = 4 + h * 12;
      metal = 20 + h2 * 24;
      he3 = 5;
      regolith = 58 + h2 * 30;
    } else {
      ice = 8 + h * 20;
      metal = 24 + h2 * 36;
      he3 = 6;
      regolith = 46 + h2 * 28;
    }

    tiles.push({
      q,
      r,
      terrain,
      ice: Math.round(clampN(ice, 0, 100)),
      metal: Math.round(clampN(metal, 0, 100)),
      he3: Math.round(clampN(he3, 0, 100)),
      regolith: Math.round(clampN(regolith, 0, 100)),
      variant: h2,
      building: null,
    });
  }
  return tiles;
}

export function indexTiles(tiles: Tile[]): Map<string, Tile> {
  const map = new Map<string, Tile>();
  for (const t of tiles) map.set(tileKey(t.q, t.r), t);
  return map;
}

export function neighborTiles(index: Map<string, Tile>, q: number, r: number): Tile[] {
  const out: Tile[] = [];
  for (const n of hexNeighbors(q, r)) {
    const t = index.get(tileKey(n.q, n.r));
    if (t) out.push(t);
  }
  return out;
}

/** A non-polar tile beside ice, with room for solar, pad, and a mine. */
export function pickLunaStart(tiles: Tile[]): Tile {
  const index = indexTiles(tiles);
  let best: Tile | null = null;
  let bestScore = -1e9;
  for (const t of tiles) {
    if (t.terrain === "polar" || t.ice >= 45) continue;
    const neigh = neighborTiles(index, t.q, t.r);
    const iceN = neigh.filter((n) => n.terrain === "polar" || n.ice >= 40);
    const open = neigh.filter((n) => n.terrain !== "polar" && n.ice < 40);
    if (iceN.length < 1 || open.length < 2) continue;
    const score = iceN.length * 30 + open.length * 4 - (Math.abs(t.q) + Math.abs(t.r)) + (t.terrain === "mare" ? 6 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best ?? tiles.find((t) => t.q === 0 && t.r === 0) ?? tiles[0]!;
}
