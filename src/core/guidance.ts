import { buildingCost, placeBuilding, placementError } from "./actions";
import { BUILDINGS } from "./data";
import { indexTiles, neighborTiles } from "./mapgen";
import { forecast, suggestions } from "./sim";
import type { BuildingId, Forecast, GameState, Tile, WorldId } from "./types";

export interface ConstructionGuidance {
  building: BuildingId | null;
  site: { q: number; r: number } | null;
  reason: string;
  blocker: string | null;
}

const REASONS: Partial<Record<BuildingId, string>> = {
  ice: "Water supports the crew, crops, and oxygen production.",
  regolith: "Make metals and ISRU feedstock before spending the starter reserve.",
  greenhouse: "Replace the food the crew consumes each sol.",
  isru: "Turn water and regolith into oxygen and propellant.",
  solar: "Restore power headroom for the colony's working modules.",
  habitat: "Add crew berths before crowding drives morale down.",
  lab: "Increase the research rate for the queued project.",
};

function siteScore(tile: Tile, type: BuildingId, index: Map<string, Tile>, world: WorldId): number {
  if (type === "ice") return tile.ice + (tile.terrain === "polar" ? 35 : 0);
  if (type === "regolith") return tile.metal + tile.regolith;
  if (type === "solar") return world === "luna" ? (tile.terrain === "polar" ? 25 : 0) : (tile.terrain === "plain" || tile.terrain === "volcano" ? 25 : tile.terrain === "polar" ? -25 : 0);
  const neighbors = neighborTiles(index, tile.q, tile.r);
  if (type === "greenhouse") return neighbors.some(n => n.building?.type === "ice" || n.terrain === "polar" || n.ice >= 50) ? 30 : 0;
  if (type === "isru") return neighbors.some(n => n.building?.type === "ice") ? 30 : 0;
  if (type === "lab") return neighbors.some(n => n.building?.type === "command" || n.building?.type === "habitat") ? 30 : 0;
  return 0;
}

export function constructionGuidance(state: GameState, id: WorldId): ConstructionGuidance {
  const world = state.worlds[id];
  const none = { building: null, site: null, reason: "Life support has cover; expand toward the charter goals.", blocker: null };
  if (!world.founded || state.outcome) return none;
  // Pending modules count toward the plan, not toward today's production.
  const plan = structuredClone(state);
  for (const tile of plan.worlds[id].tiles) if (tile.building) tile.building.progress = 0;
  const candidates = suggestions(plan, id).filter(type => !world.tiles.some(t => t.building?.type === type && t.building.progress > 0));
  const next = candidates[0];
  if (!next) return { ...none, reason: world.tiles.some(t => t.building?.progress) ? "Let the queued modules finish; monitor life-support cover while they build." : none.reason };
  const index = indexTiles(world.tiles);
  const sites = world.tiles.filter(t => placementError(state, id, t.q, t.r, next) === null)
    .sort((a, b) => siteScore(b, next, index, id) - siteScore(a, next, index, id) || a.q - b.q || a.r - b.r);
  const site = sites[0];
  const reason = REASONS[next] ?? BUILDINGS[next].blurb;
  if (site) return { building: next, site: { q: site.q, r: site.r }, reason, blocker: null };
  const cost = buildingCost(state, next);
  const blocker = world.stock.metals < cost.metals ? `Need ${(cost.metals - world.stock.metals).toFixed(1)} more tonnes of metals; wait for production or order an Earth supply drop.`
    : world.stock.water < cost.water ? "Not enough water for construction; wait for mining or order a supply drop."
    : "No legal site within the current budget; expand adjacent to a module or arrange supplies.";
  return { building: next, site: null, reason, blocker };
}

export interface BuildingImpact {
  before: Forecast;
  after: Forecast;
  completionSols: number;
  metalsLeft: number;
  creditsLeft: number;
}

export function buildingImpact(state: GameState, id: WorldId, q: number, r: number, type: BuildingId): BuildingImpact | null {
  const projected = structuredClone(state);
  if (!placeBuilding(projected, id, q, r, type).ok) return null;
  projected.worlds[id].tiles.find(t => t.q === q && t.r === r)!.building!.progress = 0;
  return { before: forecast(state, id), after: forecast(projected, id), completionSols: BUILDINGS[type].turns,
    metalsLeft: projected.worlds[id].stock.metals, creditsLeft: projected.credits };
}
