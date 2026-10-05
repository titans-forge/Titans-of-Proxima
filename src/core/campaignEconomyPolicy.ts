import {
  canSpend, chooseEvent, commissionShip, foundColony, foundingKit, landingAdvice,
  launchShip, placeBuilding, placementError, previewLaunch, queueResearch,
  repairBuilding, sellCargo,
} from "./actions";
import type { ActionResult, LaunchDraft } from "./actions";
import { buildingStatus } from "./buildingStatus";
import type { CampaignAction, CampaignPolicyMemory, IndustryKey, PolicyDecision } from "./campaignStudyPolicy";
import { BUILDINGS, CARGO_IDS, DIFF, SHIPS, TECH_BY_ID } from "./data";
import { hexDistance } from "./hex";
import { forecast } from "./sim";
import { emptyCargo } from "./state";
import type { BuildingId, GameState, Ship, TechId, Tile, WorldId } from "./types";

export const ECONOMY_POLICY_ID = "objective-economy-pilot-v1";
export const ECONOMY_POLICY_MAX_ACTIONS = 64;
export const ECONOMY_POLICY_LIMITATIONS = [
  "Development pilot, not optimal play, a balance assessment, or evidence of winnability; runner must impose a finite turn budget.",
  "At most 64 successful actions per sol, 16 events per call, four repairs per world per call, two founding launches, and difficulty fleet target plus two commissions per campaign.",
  "Uses current public forecasts and launch previews only; no future weather, RNG inspection, speculative turns, or seed-specific choices.",
  "Greedy deposit/adjacency placement and capped construction can run out of reachable ice, space, power, or funds; reserves are heuristics, not survival guarantees.",
  "Only Luna/Earth He-3 trade is scheduled. Contracts are declined; no supply drops, passenger shuttles, ship repair, or Mars export service is planned.",
  "Extra hulls are Earth-built couriers; damaged traders may be parked. Replacements and founding retries are limited, and income can be lost to incidents.",
  "Housing follows difficulty population targets and research follows a fixed utility/capstone order; growth and self-sufficiency can still stall or collapse.",
  "Factory observations remain checkpoint-compatible but are not prerequisites for trade, housing, or research; all four factories are not a pilot goal.",
] as const;

export interface EconomyPolicyMemory extends CampaignPolicyMemory {
  policyId: typeof ECONOMY_POLICY_ID;
  // Counters are optional for identity-tagged, industrySeen-only checkpoints.
  actionSol?: number;
  actionsThisSol?: number;
  foundingLaunches?: number;
  commissions?: number;
}

export function createEconomyPolicyMemory(): EconomyPolicyMemory {
  return { policyId: ECONOMY_POLICY_ID, industrySeen: [], actionSol: 0, actionsThisSol: 0, foundingLaunches: 0, commissions: 0 };
}

const WORLDS = ["luna", "mars"] as const;
const RESEARCH: readonly TechId[] = [
  "eclss", "sinter", "robots", "he3extract", "methalox", "hydro", "pv",
  "medical", "ecology", "arrays", "rendezvous", "dustmit", "shelters",
  "fission", "warning", "ntr", "drones",
];
const CASH_RESERVE = 160;

/** A planning phase only. Every game mutation is delegated to a public action. */
export function playEconomyPolicy(
  game: GameState,
  memory: EconomyPolicyMemory,
  afterAction: (action: CampaignAction) => void = () => {},
): PolicyDecision {
  const decision: PolicyDecision = { blocked: null, deferred: [] };
  if (game.outcome) return decision;
  const diff = DIFF[game.difficulty];
  if (memory.actionSol !== game.turn) {
    memory.actionSol = game.turn;
    memory.actionsThisSol = 0;
  }
  const defer = (action: string, reason: string): void => { decision.deferred.push({ action, reason }); };
  const act = (action: string, perform: () => ActionResult, remember?: () => void): boolean => {
    if ((memory.actionsThisSol ?? 0) >= ECONOMY_POLICY_MAX_ACTIONS) {
      decision.blocked = "Economy policy action budget reached";
      return false;
    }
    const result = perform();
    if (!result.ok) throw new Error(`${ECONOMY_POLICY_ID} sol ${game.turn}: ${action}: ${result.reason}`);
    memory.actionsThisSol = (memory.actionsThisSol ?? 0) + 1;
    remember?.();
    afterAction({ sol: game.turn, action });
    return true;
  };

  for (let handled = 0; game.events.length > 0; handled++) {
    if (handled >= 16) return { ...decision, blocked: "Economy policy event budget reached" };
    const event = game.events[0]!;
    const preferences: Record<string, string[]> = {
      contract: ["decline"], solar: ["protocol", "shelter"], dust: ["mitigated", "seal"],
      meteor: ["dodge", "guns"], shortage: ["endure"], anomaly: ["safe"],
      fever: ["quarantine"], audit: [game.credits >= 120 + CASH_RESERVE ? "pay" : "refuse"],
      grant: ["host"], ice: ["mark"],
    };
    const choice = (preferences[event.kind] ?? []).map(id => event.choices.find(c => c.id === id && !c.disabled)).find(Boolean)
      ?? event.choices.find(c => !c.disabled);
    if (!choice) return { ...decision, blocked: `No enabled choice for ${event.kind}/${event.id}` };
    if (!act(`event ${event.kind}/${choice.id} ${event.id}`, () => chooseEvent(game, event.id, choice.id))) return decision;
  }

  if (game.founding) {
    const worldId = game.founding.world;
    const tiles = game.worlds[worldId].tiles;
    const sites = tiles.filter(t => landingAdvice(game, worldId, t.q, t.r) === "good");
    const score = (t: Tile): number => tiles.reduce((sum, n) => sum + (hexDistance(t, n) <= 2 ? n.ice : 0), 0);
    sites.sort((a, b) => score(b) - score(a));
    const site = sites[0];
    if (!site) return { ...decision, blocked: `Economy policy found no good landing site on ${worldId}` };
    if (!act(`found ${worldId} ${site.q},${site.r}`, () => foundColony(game, site.q, site.r))) return decision;
  }

  // Realize income before making any spending decisions. A sale is never inferred from a launch.
  for (const ship of game.ships) {
    if (ship.loc === "earth" && !ship.mission && CARGO_IDS.some(k => ship.cargo[k] > 0)) {
      if (!act(`sell ${ship.id}`, () => sellCargo(game, ship.id))) return decision;
    }
  }
  if (!game.tech.current) {
    const next = RESEARCH.find(id => !game.tech.unlocked.includes(id) && TECH_BY_ID[id].req.every(req => game.tech.unlocked.includes(req)));
    if (next && !act(`research ${next}`, () => queueResearch(game, next))) return decision;
  }

  const count = (id: WorldId, type: BuildingId): number => game.worlds[id].tiles.filter(t => t.building?.type === type).length;
  const pending = (id: WorldId, type: BuildingId): boolean => game.worlds[id].tiles.some(t => t.building?.type === type && t.building.progress > 1);
  const build = (id: WorldId, type: BuildingId, desired = 1): void => {
    const world = game.worlds[id];
    if (count(id, type) >= desired || pending(id, type) || decision.blocked) return;
    const def = BUILDINGS[type];
    if (def.tech && !game.tech.unlocked.includes(def.tech)) return;
    // Do not spend the last launch/repair money on discretionary modules.
    if (def.cost.credits > 0 && type !== "he3" && type !== "habitat" && game.credits - def.cost.credits < CASH_RESERVE) {
      defer(`build ${id}/${type}`, "Preserving cash for trade and repairs");
      return;
    }
    const reasons = new Set<string>();
    const sites = world.tiles.filter(t => {
      if (t.building) return false;
      const reason = placementError(game, id, t.q, t.r, type);
      if (reason) reasons.add(reason);
      return !reason;
    });
    const near = (t: Tile, pred: (n: Tile) => boolean): number => world.tiles.filter(n => hexDistance(t, n) === 1 && pred(n)).length;
    const score = (t: Tile): number => {
      if (type === "ice") return t.ice + (t.terrain === "polar" ? 35 : 0);
      if (type === "he3") return t.he3;
      // Keep deposits free for the supply chain as the footprint expands.
      let s = -t.ice * 2 - (id === "luna" ? t.he3 * 0.3 : 0);
      if (type === "regolith") s += t.metal * 2;
      if (type === "greenhouse") s += 180 * Number(near(t, n => n.building?.type === "ice" || n.terrain === "polar" || n.ice >= 50) > 0);
      if (type === "isru") s += 180 * Number(near(t, n => n.building?.type === "ice") > 0);
      if (type === "lab") s += 180 * Number(near(t, n => n.building?.type === "command" || n.building?.type === "habitat") > 0);
      if (type === "medical") s += 180 * near(t, n => n.building?.type === "habitat");
      if (type === "fission") s -= 250 * near(t, n => n.building?.type === "command" || n.building?.type === "habitat");
      return s;
    };
    sites.sort((a, b) => score(b) - score(a));
    const site = sites[0];
    if (!site) {
      defer(`build ${id}/${type}`, [...reasons].sort().join(" | ") || "No empty tiles");
      return;
    }
    act(`build ${id}/${type} ${site.q},${site.r}`, () => placeBuilding(game, id, site.q, site.r, type));
  };

  for (const id of WORLDS) {
    const world = game.worlds[id];
    if (!world.founded) continue;
    const target = id === "luna" ? diff.lunaPop : diff.marsPop;
    let repairs = 0;
    for (const tile of world.tiles) {
      const b = tile.building;
      if (!b || b.hp >= 80 || b.progress !== 0 || world.stock.metals < 16 || repairs >= 4) continue;
      if (canSpend(game, 10) && act(`repair ${id} ${tile.q},${tile.r}`, () => repairBuilding(game, id, tile.q, tile.r))) repairs++;
    }
    const power = (): void => {
      const f = forecast(game, id);
      const futureLoad = world.tiles.reduce((sum, t) => sum + (t.building && t.building.progress > 1 ? BUILDINGS[t.building.type].power : 0), 0);
      if (f.energyGen < f.energyDraw + futureLoad + 8) build(id, "solar", Math.min(18, count(id, "solar") + 1));
    };
    power();
    build(id, "ice");
    build(id, "regolith");
    build(id, "greenhouse");
    build(id, "isru");

    let f = forecast(game, id);
    if (f.produced.water < f.demand.water * 1.1 + 1) build(id, "ice", Math.min(Math.ceil(target / 6) + 2, count(id, "ice") + 1));
    if (f.net.regolith < 1 || f.net.metals < 3) build(id, "regolith", Math.min(4, count(id, "regolith") + 1));
    if (f.produced.food < f.demand.food * 1.15) build(id, "greenhouse", Math.min(Math.ceil(target / 12) + 1, count(id, "greenhouse") + 1));
    if (f.produced.oxygen < f.demand.oxygen * 1.15 && (f.net.water >= 0 || world.stock.water > 40)) {
      build(id, "isru", Math.min(Math.ceil(target / 8) + 1, count(id, "isru") + 1));
    }
    power();
    build(id, "lab");
    if (id === "luna") {
      build(id, "pad");
      build(id, "he3", game.stats.he3Sold > 0 ? 2 : 1);
    }

    f = forecast(game, id);
    const plannedHousing = world.tiles.reduce((sum, t) => sum + (t.building && t.building.hp > 15 ? BUILDINGS[t.building.type].housing : 0), 0);
    if (plannedHousing < target && world.pop + 5 >= plannedHousing) {
      build(id, "habitat", Math.ceil((target - BUILDINGS.command.housing) / BUILDINGS.habitat.housing));
    }
    if (game.stats.he3Sold > 0 && f.net.water >= 0 && f.net.food >= 0 && f.net.oxygen >= 0) {
      build(id, "medical");
      if (f.net.metals > 2) build(id, "robotics");
      if (id === "mars") build(id, "fission", 2);
    }
    const current = forecast(game, id);
    for (const tile of world.tiles) {
      const b = tile.building;
      if (!b || (b.type !== "robotics" && b.type !== "aresfab")) continue;
      const key: IndustryKey = `${id}/${b.type}`;
      if (buildingStatus(b, tile.q, tile.r, current).status === "operating" && !memory.industrySeen.includes(key)) memory.industrySeen.push(key);
    }
  }

  const launch = (ship: Ship, draft: LaunchDraft, founding = false): boolean => {
    const ready = previewLaunch(game, ship.id, draft);
    if (!ready.ok) {
      defer(`launch ${ship.id} ${ship.loc}/${draft.dest}`, ready.reason ?? "Launch unavailable");
      return false;
    }
    return act(`launch ${ship.id} ${ship.loc}/${draft.dest} ${JSON.stringify(draft)}`, () => launchShip(game, ship.id, draft), () => {
      if (founding) memory.foundingLaunches = (memory.foundingLaunches ?? 0) + 1;
    });
  };

  if (!game.worlds.mars.founded && !game.ships.some(s => s.mission?.founding)) {
    const ship = game.ships.find(s => s.cls === "colony" && s.loc === "earth" && !s.mission);
    if (ship && (memory.foundingLaunches ?? 0) < 2) {
      const route = previewLaunch(game, ship.id, { dest: "mars", cargo: emptyCargo(), fuel: ship.fuel, crew: 11 });
      const kit = foundingKit(route.burn, ship.fuel);
      const cargo = emptyCargo();
      for (const k of CARGO_IDS) cargo[k] = kit[k];
      const draft: LaunchDraft = { dest: "mars", cargo, fuel: kit.fuel, crew: kit.crew };
      const ready = previewLaunch(game, ship.id, draft);
      if (ready.ok && game.credits - ready.cost >= CASH_RESERVE) launch(ship, draft, true);
      else defer("founding launch", ready.reason ?? "Waiting for export income and founding cash reserve");
    }
  }

  for (const ship of game.ships) {
    if (ship.mission || ship.cls !== "courier") continue;
    if (ship.hull < 24) {
      defer(`trade ${ship.id}`, "Hull below 24; trader parked. Pilot has no ship-repair action");
      continue;
    }
    if (ship.loc === "luna") {
      const otherCargo = CARGO_IDS.reduce((sum, k) => sum + (k === "he3" ? 0 : ship.cargo[k]), 0);
      const he3 = Math.min(SHIPS[ship.cls].cargo - otherCargo, ship.cargo.he3 + Math.floor(game.worlds.luna.stock.he3));
      if (he3 < 8) continue;
      const draft: LaunchDraft = { dest: "earth", cargo: { ...ship.cargo, he3 }, fuel: ship.fuel, crew: ship.crew };
      const route = previewLaunch(game, ship.id, draft);
      // Carry the return leg's fuel from Luna where possible; preview checks the combined ground delta.
      draft.fuel = Math.max(ship.fuel, Math.min(SHIPS[ship.cls].fuel, route.burn * 2));
      if (!previewLaunch(game, ship.id, draft).ok) draft.fuel = Math.max(ship.fuel, route.burn);
      launch(ship, draft);
    } else if (ship.loc === "earth" && (count("luna", "he3") > 0 || game.worlds.luna.stock.he3 >= 8)) {
      const draft: LaunchDraft = { dest: "luna", cargo: emptyCargo(), fuel: ship.fuel, crew: ship.crew };
      const route = previewLaunch(game, ship.id, draft);
      draft.fuel = Math.max(ship.fuel, route.burn);
      launch(ship, draft);
    }
  }

  const hasFounder = game.ships.some(s => s.cls === "colony") || game.yard.some(s => s.cls === "colony");
  const replacementFounder = !game.worlds.mars.founded && game.turn >= 5 && !hasFounder && (memory.foundingLaunches ?? 0) < 2;
  const activeTrader = game.ships.some(s => s.cls === "courier" && s.hull >= 24) || game.yard.some(s => s.cls === "courier");
  const needHull = game.worlds.mars.founded && (game.ships.length + game.yard.length < diff.ships || !activeTrader);
  if ((replacementFounder || needHull) && (memory.commissions ?? 0) < diff.ships + 2) {
    const cls = replacementFounder ? "colony" : "courier";
    const price = Math.round(SHIPS[cls].credits * 1.05);
    if (game.credits - price >= CASH_RESERVE && canSpend(game, price)) {
      act(`commission earth/${cls}`, () => commissionShip(game, cls, "earth"), () => { memory.commissions = (memory.commissions ?? 0) + 1; });
    } else defer(`commission earth/${cls}`, `Need ${price + CASH_RESERVE} credits including cash reserve`);
  } else if ((replacementFounder || needHull) && (memory.commissions ?? 0) >= diff.ships + 2) {
    defer("commission", "Campaign commission budget reached");
  }
  return decision;
}
