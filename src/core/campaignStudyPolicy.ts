import {
  canSpend, chooseEvent, foundColony, foundingKit, landingAdvice, launchShip,
  placeBuilding, placementError, previewLaunch, queueResearch, repairBuilding,
} from "./actions";
import type { ActionResult } from "./actions";
import { buildingStatus } from "./buildingStatus";
import { TECH_BY_ID } from "./data";
import { forecast } from "./sim";
import { emptyCargo } from "./state";
import type { BuildingId, GameState, TechId, WorldId } from "./types";

export const CAMPAIGN_POLICY_ID = "survey-industry-baseline-v1";
export const CAMPAIGN_POLICY_LIMITATIONS = [
  "The existing Survey policy is held fixed across modes; this is not an optimal-play or winnability study.",
  "Only the gifted Halcyon is launched. No extra hulls, trade, contracts, or discretionary supply runs are planned.",
  "One habitat per world is delayed until all four factories have been observed operating; housing tops out at 32.",
  "Research stops after eight technologies. Charter needs three hulls and Luna population 40; Hardship needs four hulls, population 48/38, and ten technologies.",
  "Placement is greedy, life-support counts are capped, and the first good Mars site is used without recovery after a failed founding flight.",
  "Events prefer decline/seal/dodge/shelter, then the first enabled choice, including purchases and audit payments.",
  "A turn-limit stall means unresolved within the budget, not a proven deadlock or a core balance defect.",
] as const;

export const STUDY_WORLDS = ["luna", "mars"] as const;
export const STUDY_INDUSTRIES = ["robotics", "aresfab"] as const;
export type StudyIndustry = typeof STUDY_INDUSTRIES[number];
export type IndustryKey = `${WorldId}/${StudyIndustry}`;

export interface CampaignPolicyMemory {
  industrySeen: IndustryKey[];
}

export interface CampaignAction {
  sol: number;
  action: string;
}

export interface PolicyDecision {
  blocked: string | null;
  deferred: { action: string; reason: string }[];
}

export function createCampaignPolicyMemory(): CampaignPolicyMemory {
  return { industrySeen: [] };
}

const RESEARCH: readonly TechId[] = ["eclss", "sinter", "robots", "drones", "pv", "hydro", "medical", "ecology"];
const STARTER_BUILDINGS: readonly BuildingId[] = ["ice", "greenhouse", "regolith", "solar", "isru", "lab"];

/** One planning phase, factored from campaign.test.ts without mode/seed-specific tuning. */
export function playCampaignPolicy(
  game: GameState,
  memory: CampaignPolicyMemory,
  afterAction: (action: CampaignAction) => void = () => {},
): PolicyDecision {
  const decision: PolicyDecision = { blocked: null, deferred: [] };
  if (game.outcome) return decision;
  let actionCount = 0;
  const act = (action: string, perform: () => ActionResult): void => {
    if (++actionCount > 256) throw new Error(`Policy action budget exceeded at sol ${game.turn}`);
    const result = perform();
    if (!result.ok) {
      throw new Error(`${game.difficulty}/${game.seed} sol ${game.turn}: ${action}: ${result.reason}`);
    }
    afterAction({ sol: game.turn, action });
  };
  const defer = (action: string, reason: string): void => { decision.deferred.push({ action, reason }); };

  for (let handled = 0; game.events.length > 0; handled++) {
    if (handled >= 16) return { ...decision, blocked: "Policy event budget reached" };
    const event = game.events[0]!;
    const preferred = event.kind === "contract" ? "decline" : event.kind === "dust" ? "seal" : event.kind === "meteor" ? "dodge" : "shelter";
    const choice = event.choices.find(c => c.id === preferred && !c.disabled) ?? event.choices.find(c => !c.disabled);
    if (!choice) return { ...decision, blocked: `No enabled choice for ${event.kind}/${event.id}` };
    act(`event ${event.kind}/${choice.id}`, () => chooseEvent(game, event.id, choice.id));
  }

  if (game.founding) {
    const worldId = game.founding.world;
    const site = game.worlds[worldId].tiles.find(t => landingAdvice(game, worldId, t.q, t.r) === "good");
    if (!site) return { ...decision, blocked: `Policy found no good landing site on ${worldId}` };
    act(`found ${worldId} ${site.q},${site.r}`, () => foundColony(game, site.q, site.r));
  }
  if (!game.tech.current) {
    const next = RESEARCH.find(id => !game.tech.unlocked.includes(id) && TECH_BY_ID[id].req.every(req => game.tech.unlocked.includes(req)));
    if (next) act(`research ${next}`, () => queueResearch(game, next));
  }

  const build = (worldId: WorldId, type: BuildingId, count = 1): void => {
    const world = game.worlds[worldId];
    if (world.tiles.filter(t => t.building?.type === type).length >= count) return;
    const reasons = new Set<string>();
    const sites = world.tiles.filter(t => {
      if (t.building) return false;
      const reason = placementError(game, worldId, t.q, t.r, type);
      if (reason) reasons.add(reason);
      return !reason;
    });
    // Stable ties preserve the map's existing tile order, as in the original policy.
    sites.sort((a, b) => type === "ice" ? b.ice - a.ice : type === "regolith" ? b.metal - a.metal : a.ice - b.ice);
    const site = sites[0];
    if (!site) {
      defer(`build ${worldId}/${type}`, [...reasons].sort().join(" | ") || "No empty tiles");
      return;
    }
    act(`build ${worldId}/${type} ${site.q},${site.r}`, () => placeBuilding(game, worldId, site.q, site.r, type));
  };

  for (const id of STUDY_WORLDS) {
    const world = game.worlds[id];
    if (!world.founded) continue;
    for (const tile of world.tiles) {
      if (!tile.building || tile.building.hp >= 80 || tile.building.progress !== 0 || world.stock.metals <= 20) continue;
      // The original policy ignored rejected repairs. Preflight the same action instead.
      if (canSpend(game, 10)) act(`repair ${id} ${tile.q},${tile.r}`, () => repairBuilding(game, id, tile.q, tile.r));
      else defer(`repair ${id}`, "Credit line refused.");
    }
    for (const type of STARTER_BUILDINGS) build(id, type);
    const f = forecast(game, id);
    if (f.energyGen < f.energyDraw + 12) build(id, "solar", world.tiles.filter(t => t.building?.type === "solar").length + 1);
    if (f.net.water < 0) build(id, "ice", game.turn > 23 ? 3 : 2);
    if (f.net.oxygen < 0) build(id, "isru", 2);
    if (f.net.food < 0) build(id, "greenhouse", 2);
    if (game.tech.unlocked.includes("robots")) build(id, "robotics");
    if (game.tech.unlocked.includes("drones")) build(id, "aresfab");
    if (memory.industrySeen.length === 4) build(id, "habitat");
    const current = forecast(game, id);
    for (const tile of world.tiles) {
      const b = tile.building;
      if (!b || (b.type !== "robotics" && b.type !== "aresfab")) continue;
      const key: IndustryKey = `${id}/${b.type}`;
      if (buildingStatus(b, tile.q, tile.r, current).status === "operating" && !memory.industrySeen.includes(key)) memory.industrySeen.push(key);
    }
  }

  const ship = game.ships.find(s => s.name === "PAS Halcyon");
  if (ship && !ship.mission && ship.loc === "earth" && !game.worlds.mars.founded) {
    const preview = previewLaunch(game, ship.id, { dest: "mars", cargo: emptyCargo(), fuel: ship.fuel, crew: 11 });
    const kit = foundingKit(preview.burn, ship.fuel);
    const draft = { dest: "mars" as const, cargo: kit, fuel: kit.fuel, crew: kit.crew };
    const ready = previewLaunch(game, ship.id, draft);
    if (ready.ok) act(`launch ${ship.id} earth/mars`, () => launchShip(game, ship.id, draft));
    else defer("launch Halcyon", ready.reason ?? "Launch unavailable");
  }
  return decision;
}
