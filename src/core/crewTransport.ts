import { previewLaunch, type LaunchDraft } from "./actions";
import { BUILDINGS, CARGO_IDS, DIFF, SHIPS } from "./data";
import { completedModulesState } from "./operations";
import { planRoute } from "./routes";
import { forecast } from "./sim";
import type { Forecast, GameState, WorldId } from "./types";

export interface CrewCapacity {
  world: WorldId;
  population: number;
  target: number;
  housing: number;
  pendingHousing: number;
  reservedPassengers: number;
  additional: number;
  blocker: string | null;
}

export interface CrewTransferPlan {
  shipId: string;
  shipName: string;
  world: WorldId;
  passengers: number;
  draft: LaunchDraft;
  ready: boolean;
  blocker: string | null;
  cost: number;
  arrivalSol: number;
  risk: number;
}

export interface CrewArrivalAdvice {
  eligible: boolean;
  ready: boolean;
  blocker: string | null;
  passengers: number;
  populationAfter: number;
  housing: number;
}

function supportBlocker(f: Forecast, population: number): string | null {
  if (population > f.housing) return "Completed housing cannot accommodate these crew.";
  if (f.deaths || f.foodShortage || f.waterShortage || f.o2Shortage) return "Stores and life support cannot cover these crew.";
  if (f.energyGen + 0.001 < f.energyDraw || f.brownout) return "Add sustained power before bringing more crew.";
  if (f.net.food < -0.001 || f.net.water < -0.001 || f.net.oxygen < -0.001) return "Add sustained food, water and oxygen production before bringing more crew.";
  if (f.consumed.regolith > 0 && f.net.regolith < -0.001) return "Replenish regolith feedstock before relying on ISRU for more crew.";
  return null;
}

// Book arrivals conservatively: pending flights and docked passengers also need beds.
export function crewCapacity(game: GameState, world: WorldId, exceptShip?: string): CrewCapacity {
  const w = game.worlds[world];
  const completed = completedModulesState(game);
  const housing = forecast(completed, world).housing;
  const target = world === "luna" ? DIFF[game.difficulty].lunaPop : DIFF[game.difficulty].marsPop;
  const pendingHousing = w.tiles.reduce((sum, t) => sum + (t.building && t.building.progress > 0 && t.building.hp > 15 ? BUILDINGS[t.building.type].housing : 0), 0);
  const reservedPassengers = game.ships.reduce((sum, ship) => sum + (ship.id !== exceptShip && (ship.mission?.to === world && !ship.mission.founding || ship.loc === world && !ship.mission && game.founding?.shipId !== ship.id) ? Math.max(0, ship.crew - 1) : 0), 0);
  const basePopulation = w.pop + reservedPassengers;
  const result: CrewCapacity = { world, population: w.pop, target, housing, pendingHousing, reservedPassengers, additional: 0, blocker: null };
  if (!w.founded) return { ...result, blocker: "Found this outpost before scheduling crew transfers." };
  completed.worlds[world].pop = basePopulation;
  const base = forecast(completed, world);
  const blocker = supportBlocker(base, basePopulation);
  if (blocker) return { ...result, blocker };
  const room = Math.max(0, Math.min(housing, target) - basePopulation);
  if (!room) return { ...result, blocker: basePopulation >= target ? "The population goal is met or already covered by passengers." : "Build more housing before scheduling crew." };
  // Consumption and population power draw are monotonic in this forecast.
  let low = 0, high = room;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    completed.worlds[world].pop = basePopulation + middle;
    if (supportBlocker(forecast(completed, world), basePopulation + middle)) high = middle - 1;
    else low = middle;
  }
  return { ...result, additional: low, blocker: low ? null : "Housing is available, but sustained life support or power needs expansion." };
}

export function crewTransferPlan(game: GameState, shipId: string, world: WorldId): CrewTransferPlan | null {
  const ship = game.ships.find(s => s.id === shipId);
  if (!ship || ship.loc !== "earth" || ship.mission) return null;
  const capacity = crewCapacity(game, world);
  const crew = Math.max(ship.crew, Math.min(SHIPS[ship.cls].crew, capacity.additional + 1));
  const route = planRoute(game, "earth", world, ship.cls);
  const draft: LaunchDraft = { dest: world, cargo: { ...ship.cargo }, fuel: Math.max(ship.fuel, route.burn), crew };
  const preview = previewLaunch(game, shipId, draft);
  const passengers = Math.max(0, crew - 1);
  const reserveFounder = ship.cls === "colony" && !game.worlds.mars.founded && !game.ships.some(s => s.mission?.to === "mars" && s.mission.founding);
  const blocker = game.outcome ? "The charter is closed." : game.events.length || game.founding ? "Resolve the current event or first landing before scheduling crew." : reserveFounder ? "Reserve this colony ship for Mars founding." : CARGO_IDS.some(k => ship.cargo[k] > 0) ? "Review or sell the loaded cargo before assigning a passenger run." : ship.hull < SHIPS[ship.cls].hull / 2 ? "Repair this damaged hull before assigning passengers." : capacity.blocker ?? (passengers > capacity.additional ? "The passengers already aboard exceed current support capacity." : !passengers ? "No additional crew are needed." : !preview.ok ? preview.reason ?? "Departure unavailable." : null);
  return { shipId, shipName: ship.name, world, passengers, draft, ready: !blocker, blocker, cost: preview.cost, arrivalSol: game.turn + route.turns, risk: route.risk };
}

// Recheck the actual manifest, including manually edited or previously prepared drafts.
export function crewDepartureBlocker(game: GameState, shipId: string, draft: LaunchDraft): string | null {
  const ship = game.ships.find(s => s.id === shipId);
  if (!ship || draft.dest === "earth" || draft.crew <= 1 || !game.worlds[draft.dest].founded) return null;
  const capacity = crewCapacity(game, draft.dest, shipId);
  if (capacity.blocker) return capacity.blocker;
  return draft.crew - 1 > capacity.additional ? "This manifest exceeds the destination's unreserved crew plan. Reduce passengers or review the risk." : null;
}

export function crewArrivalAdvice(game: GameState, shipId: string): CrewArrivalAdvice {
  const ship = game.ships.find(s => s.id === shipId);
  const passengers = Math.max(0, (ship?.crew ?? 1) - 1);
  const empty: CrewArrivalAdvice = { eligible: false, ready: false, blocker: "Crew disembark at a founded outpost.", passengers, populationAfter: 0, housing: 0 };
  if (!ship || ship.loc === "earth" || ship.loc === "transit" || ship.mission) return empty;
  const w = game.worlds[ship.loc];
  if (!w.founded || game.founding?.shipId === ship.id) return { ...empty, blocker: "Complete the first landing before disembarking." };
  const completed = completedModulesState(game);
  const populationAfter = w.pop + passengers;
  completed.worlds[ship.loc].pop = populationAfter;
  const f = forecast(completed, ship.loc);
  const blocker = game.outcome ? "The charter is closed." : game.events.length ? "Resolve the current event before disembarking." : !passengers ? "The skeleton crew stays aboard." : supportBlocker(f, populationAfter);
  return { eligible: !game.outcome && !game.events.length && passengers > 0, ready: !blocker, blocker, passengers, populationAfter, housing: f.housing };
}

export function crewReturnPlan(game: GameState, shipId: string): { ready: boolean; blocker: string | null; draft: LaunchDraft } | null {
  const ship = game.ships.find(s => s.id === shipId);
  if (!ship || ship.loc === "earth" || ship.loc === "transit" || ship.mission) return null;
  const route = planRoute(game, ship.loc, "earth", ship.cls);
  const draft: LaunchDraft = { dest: "earth", cargo: { ...ship.cargo }, fuel: Math.max(ship.fuel, route.burn), crew: ship.crew };
  const preview = previewLaunch(game, shipId, draft);
  const needed = (["luna", "mars"] as const).some(world => crewCapacity(game, world).additional > 0);
  const blocker = game.outcome || game.events.length || game.founding ? "Resolve the current event or first landing; closed charters cannot depart." : ship.crew !== 1 ? "Disembark the passengers before returning for new crew." : CARGO_IDS.some(k => ship.cargo[k] > 0) ? "Unload cargo before assigning a crew pickup." : ship.hull < SHIPS[ship.cls].hull / 2 ? "Repair this hull before returning for passengers." : !needed ? "No outpost currently has unreserved crew capacity." : !preview.ok ? preview.reason ?? "Return unavailable." : null;
  return { ready: !blocker, blocker, draft };
}
