import {
  BUILDINGS,
  BUY_PRICE,
  CARGO_IDS,
  DIFF,
  FOUNDING_MIN,
  HIRE_COST,
  SELL_PRICE,
  SHIP_NAMES,
  SHIPS,
  TECH_BY_ID,
} from "./data";
import { applyChoice } from "./events";
import { fmt } from "./format";
import { indexTiles, neighborTiles } from "./mapgen";
import { hasTech, planRoute } from "./routes";
import { storageCap } from "./sim";
import { emptyCargo, pushLog, uid } from "./state";
import type {
  BuildingId,
  CargoId,
  GameState,
  LocationId,
  Ship,
  ShipClass,
  Tile,
  WorldId,
} from "./types";

export interface ActionResult {
  ok: boolean;
  reason?: string;
  sfx?: "build" | "error" | "launch" | "research" | "click" | "event";
  fx?: { world: WorldId; q: number; r: number }[];
  focus?: { world: WorldId; q: number; r: number };
}

export interface LaunchDraft {
  dest: LocationId;
  cargo: Record<CargoId, number>;
  fuel: number;
  crew: number;
}

// Cargo propellant and tank fuel draw from the same ground store atomically.
export function launchResourceDelta(ship: Ship, draft: LaunchDraft): Record<CargoId, number> {
  const delta = emptyCargo();
  for (const k of CARGO_IDS) delta[k] = (draft.cargo[k] ?? 0) - ship.cargo[k];
  delta.propellant += draft.fuel - ship.fuel;
  return delta;
}

export function canSpend(state: GameState, amount: number): boolean {
  return state.credits - amount >= DIFF[state.difficulty].overdraft;
}

export function buyPrice(state: GameState, id: CargoId): number {
  if (id === "he3" || BUY_PRICE[id] <= 0) return Number.POSITIVE_INFINITY;
  return BUY_PRICE[id] * state.priceMul * DIFF[state.difficulty].price;
}

export function sellPrice(_state: GameState, id: CargoId): number {
  return SELL_PRICE[id];
}

export function hirePrice(state: GameState): number {
  return HIRE_COST * DIFF[state.difficulty].hire;
}

export function buildingCost(state: GameState, id: BuildingId): { metals: number; credits: number; water: number } {
  const def = BUILDINGS[id];
  const metals = hasTech(state, "sinter") ? Math.ceil(def.cost.metals * 0.8) : def.cost.metals;
  return { metals, credits: def.cost.credits, water: def.cost.water };
}

function fail(reason: string): ActionResult {
  return { ok: false, reason, sfx: "error" };
}

function findTile(state: GameState, worldId: WorldId, q: number, r: number): Tile | null {
  return state.worlds[worldId].tiles.find((t) => t.q === q && t.r === r) ?? null;
}

export function placementError(state: GameState, worldId: WorldId, q: number, r: number, type: BuildingId): string | null {
  if (state.outcome) return "The charter is closed.";
  const world = state.worlds[worldId];
  if (!world.founded) return "No outpost on this world.";
  const tile = findTile(state, worldId, q, r);
  if (!tile) return "Off the map.";
  if (tile.building) return "Tile occupied.";
  if (type === "command") return "The command module is already down.";
  const def = BUILDINGS[type];
  if (def.tech && !hasTech(state, def.tech)) return `Requires ${TECH_BY_ID[def.tech].name}.`;
  if (def.world && def.world !== worldId) return def.world === "luna" ? "Luna only." : "Mars only.";
  if (type === "ice" && tile.terrain !== "polar" && tile.ice < 28) return "Needs an ice deposit (28+).";
  if (type === "he3" && tile.terrain !== "mare" && tile.he3 < 35) return "Needs mare soil or a helium deposit.";
  const index = indexTiles(world.tiles);
  const touch = neighborTiles(index, q, r).some((n) => n.building);
  if (!touch) return "Must touch an existing module.";
  const cost = buildingCost(state, type);
  if (world.stock.metals + 0.001 < cost.metals) return `Need ${fmt(cost.metals - world.stock.metals)} more metals.`;
  if (world.stock.water + 0.001 < cost.water) return `Need ${fmt(cost.water - world.stock.water)} more water.`;
  if (cost.credits > 0 && !canSpend(state, cost.credits)) return "Credit line refused.";
  return null;
}

export function placeBuilding(state: GameState, worldId: WorldId, q: number, r: number, type: BuildingId): ActionResult {
  const reason = placementError(state, worldId, q, r, type);
  if (reason) return fail(reason);
  const world = state.worlds[worldId];
  const tile = findTile(state, worldId, q, r)!;
  const cost = buildingCost(state, type);
  world.stock.metals -= cost.metals;
  world.stock.water -= cost.water;
  state.credits -= cost.credits;
  const turns = BUILDINGS[type].turns;
  tile.building = { type, hp: 100, progress: turns, total: turns };
  pushLog(state, `${BUILDINGS[type].name} laid down at ${world.name}. ${turns} sol${turns === 1 ? "" : "s"} to complete.`, "info");
  return { ok: true, sfx: "build", fx: [{ world: worldId, q, r }] };
}

export function cancelBuilding(state: GameState, worldId: WorldId, q: number, r: number): ActionResult {
  const tile = findTile(state, worldId, q, r);
  const b = tile?.building;
  if (!b || b.progress <= 0) return fail("Nothing unfinished here.");
  const cost = buildingCost(state, b.type);
  state.worlds[worldId].stock.metals += Math.floor(cost.metals * 0.5);
  state.worlds[worldId].stock.water += cost.water;
  state.credits += Math.floor(cost.credits * 0.5);
  tile!.building = null;
  pushLog(state, `${BUILDINGS[b.type].name} cancelled. Half the metals and credits return.`, "warn");
  return { ok: true, sfx: "click" };
}

export function repairBuilding(state: GameState, worldId: WorldId, q: number, r: number): ActionResult {
  const world = state.worlds[worldId];
  const tile = findTile(state, worldId, q, r);
  const b = tile?.building;
  if (!b || b.progress > 0) return fail("Only a finished module can be repaired.");
  if (b.hp >= 99) return fail("Integrity is already nominal.");
  if (world.stock.metals < 6) return fail("Repair needs 6 t of metals.");
  if (!canSpend(state, 10)) return fail("Credit line refused.");
  world.stock.metals -= 6;
  state.credits -= 10;
  b.hp = Math.min(100, b.hp + 42);
  pushLog(state, `${BUILDINGS[b.type].name} patched to ${Math.round(b.hp)}%.`, "good");
  return { ok: true, sfx: "build" };
}

export function queueResearch(state: GameState, id: GameState["tech"]["current"]): ActionResult {
  if (!id) return fail("No project.");
  if (state.outcome) return fail("The charter is closed.");
  const def = TECH_BY_ID[id];
  if (!def) return fail("Unknown project.");
  if (state.tech.unlocked.includes(id)) return fail("Already in the library.");
  const missing = def.req.filter((r) => !state.tech.unlocked.includes(r));
  if (missing.length) return fail(`Requires ${missing.map((m) => TECH_BY_ID[m].name).join(", ")}.`);
  if (state.tech.current === id) return fail("Already on the bench.");
  state.tech.current = id;
  state.tech.progress = 0;
  pushLog(state, `Research queued: ${def.name}.`, "info");
  return { ok: true, sfx: "research" };
}

export function chooseEvent(state: GameState, eventId: string, choiceId: string): ActionResult {
  const reason = applyChoice(state, eventId, choiceId);
  if (reason) return fail(reason);
  return { ok: true, sfx: "event" };
}

export function landingAdvice(state: GameState, worldId: WorldId, q: number, r: number): "good" | "poor" | "invalid" {
  const world = state.worlds[worldId];
  const tile = world.tiles.find((t) => t.q === q && t.r === r);
  if (!tile || tile.building) return "invalid";
  const index = indexTiles(world.tiles);
  const neigh = neighborTiles(index, q, r);
  const ice = neigh.filter((n) => n.terrain === "polar" || n.ice >= 40).length;
  const room = neigh.filter((n) => n.terrain !== "polar").length;
  if (tile.terrain !== "polar" && ice >= 1 && room >= 4) return "good";
  return "poor";
}

export function foundColony(state: GameState, q: number, r: number): ActionResult {
  const pending = state.founding;
  if (!pending) return fail("No hull is waiting to land.");
  const ship = state.ships.find((s) => s.id === pending.shipId);
  if (!ship) return fail("The landing hull is gone.");
  const world = state.worlds[pending.world];
  if (world.founded) return fail("An outpost is already there.");
  const tile = findTile(state, pending.world, q, r);
  if (!tile) return fail("Off the map.");
  if (tile.building) return fail("Tile occupied.");
  const advice = landingAdvice(state, pending.world, q, r);
  tile.building = { type: "command", hp: 100, progress: 0, total: 0 };
  world.founded = true;
  world.foundedTurn = state.turn;
  world.pop = Math.max(4, ship.crew - 1);
  world.morale = 70;
  ship.crew = Math.max(1, ship.crew - world.pop);
  const cap = storageCap(state, world);
  for (const k of CARGO_IDS) {
    world.stock[k] = Math.min(cap[k], (world.stock[k] ?? 0) + ship.cargo[k]);
    ship.cargo[k] = 0;
  }
  state.founding = null;
  pushLog(
    state,
    `${ship.name} founds ${world.name}. Population ${world.pop}. ${advice === "good" ? "The site has ice and room to grow." : "The site will be thirsty or cramped — build carefully."}`,
    advice === "good" ? "good" : "warn",
  );
  return { ok: true, sfx: "build", fx: [{ world: pending.world, q, r }], focus: { world: pending.world, q, r } };
}

function nextShipName(state: GameState): string {
  const used = new Set([...state.ships.map((s) => s.name), ...state.yard.map((y) => y.name)]);
  for (const name of SHIP_NAMES) {
    const full = `PAS ${name}`;
    if (!used.has(full)) return full;
  }
  return `PAS Hull ${state.seq + 1}`;
}

export function commissionShip(state: GameState, cls: ShipClass, loc: LocationId): ActionResult {
  if (state.outcome) return fail("The charter is closed.");
  const def = SHIPS[cls];
  let credits = def.credits;
  let metals = 0;
  let turns = def.buildTurns;
  if (loc === "earth") {
    credits = Math.round(def.credits * 1.05);
    turns = def.buildTurns + 1;
  } else {
    const world = state.worlds[loc];
    if (!world.founded) return fail("No yard without an outpost.");
    const yard = world.tiles.some((t) => t.building?.type === "shipyard" && t.building.progress === 0 && t.building.hp > 20);
    const pad = world.tiles.some((t) => t.building?.type === "pad" && t.building.progress === 0 && t.building.hp > 20);
    if (!yard || !pad) return fail("Needs a finished shipyard and launch pad.");
    metals = def.metals;
    credits = Math.round(def.credits * 0.75);
    if (hasTech(state, "drones")) turns = Math.max(1, turns - 1);
    if (world.stock.metals < metals) return fail(`Need ${fmt(metals - world.stock.metals)} more metals.`);
  }
  if (!canSpend(state, credits)) return fail("Credit line refused.");
  if (loc !== "earth") state.worlds[loc].stock.metals -= metals;
  state.credits -= credits;
  const name = nextShipName(state);
  state.yard.push({ id: uid(state, "yard"), cls, loc, eta: turns, name });
  pushLog(state, `${name} laid down at ${loc === "earth" ? "Earth" : state.worlds[loc].name}. ${turns} sols.`, "info");
  return { ok: true, sfx: "build" };
}

export function orderSupply(state: GameState, dest: WorldId, cargo: Partial<Record<CargoId, number>>): ActionResult {
  if (state.outcome) return fail("The charter is closed.");
  const world = state.worlds[dest];
  if (!world.founded) return fail("Nowhere to land a drop.");
  if (state.deliveries.length >= 2) return fail("Two drops are already in flight.");
  let cost = 0;
  const clean: Partial<Record<CargoId, number>> = {};
  for (const k of CARGO_IDS) {
    const n = Math.max(0, Math.floor(cargo[k] ?? 0));
    if (!n) continue;
    if (k === "he3") return fail("Earth does not sell helium-3.");
    clean[k] = n;
    cost += n * buyPrice(state, k);
  }
  if (cost <= 0) return fail("The manifest is empty.");
  cost *= 1.18;
  if (!canSpend(state, cost)) return fail("Credit line refused.");
  const route = planRoute(state, "earth", dest, "freighter");
  state.credits -= cost;
  state.deliveries.push({ id: uid(state, "drop"), dest, eta: Math.max(2, route.turns), cargo: clean });
  pushLog(state, `Supply drop chartered for ${world.name}. ${fmt(cost)} credits, ${Math.max(2, route.turns)} sols.`, "info");
  return { ok: true, sfx: "launch" };
}

export interface LaunchPreview {
  ok: boolean;
  reason?: string;
  cost: number;
  turns: number;
  burn: number;
  risk: number;
  founding: boolean;
}

export function previewLaunch(state: GameState, shipId: string, draft: LaunchDraft): LaunchPreview {
  const checked = checkLaunch(state, shipId, draft);
  if (!checked.ok) {
    return { ok: false, reason: checked.reason, cost: checked.cost, turns: checked.turns, burn: checked.burn, risk: checked.risk, founding: checked.founding };
  }
  return checked;
}

interface LaunchCheck extends LaunchPreview {
  ship: Ship;
  from: LocationId;
}

function checkLaunch(state: GameState, shipId: string, draft: LaunchDraft): LaunchCheck {
  const empty: LaunchCheck = { ok: false, cost: 0, turns: 0, burn: 0, risk: 0, founding: false, ship: state.ships[0]!, from: "earth" };
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.loc === "transit" || ship.mission) return { ...empty, reason: "That hull is not in dock." };
  if (state.founding?.shipId === ship.id) return { ...empty, reason: "Land this hull before sending it on.", ship, from: ship.loc };
  const from = ship.loc;
  if (!["earth", "luna", "mars"].includes(draft.dest)) return { ...empty, reason: "Unknown destination.", ship, from };
  if (!Number.isFinite(draft.fuel) || !Number.isInteger(draft.crew) || CARGO_IDS.some(k => !Number.isFinite(draft.cargo[k] ?? 0))) {
    return { ...empty, reason: "Manifest must contain finite loads and a whole crew count.", ship, from };
  }
  if (draft.dest === from) return { ...empty, reason: "Already there.", ship, from };
  if (state.outcome) return { ...empty, reason: "The charter is closed.", ship, from };
  const def = SHIPS[ship.cls];
  const route = planRoute(state, from, draft.dest, ship.cls);
  const founding = ship.cls === "colony" && draft.dest !== "earth" && !state.worlds[draft.dest].founded;
  if (draft.dest !== "earth" && !state.worlds[draft.dest].founded && !founding) {
    return { ...empty, reason: "Only a colony ship can make a first landing.", ship, from, ...route, founding };
  }
  if (from === "earth") {
    if (state.earthLaunches >= 2) return { ...empty, reason: "Earth can release two hulls a sol.", ship, from, ...route, founding };
  } else {
    const pads = state.worlds[from].tiles.filter((t) => t.building?.type === "pad" && t.building.progress === 0 && t.building.hp > 20).length;
    if (pads <= 0) return { ...empty, reason: "No finished launch pad.", ship, from, ...route, founding };
    if (state.worlds[from].launches >= pads) return { ...empty, reason: "Every pad on this world has already fired this sol.", ship, from, ...route, founding };
  }
  if (draft.crew < 1) return { ...empty, reason: "A hull needs at least one crew.", ship, from, ...route, founding };
  if (draft.crew > def.crew) return { ...empty, reason: "Crew quarters are full.", ship, from, ...route, founding };
  if (draft.fuel < 0 || draft.fuel > def.fuel) return { ...empty, reason: "Fuel load does not fit the tanks.", ship, from, ...route, founding };
  if (draft.fuel + 1e-6 < route.burn) return { ...empty, reason: `This leg burns ${route.burn} t. Tanks are short.`, ship, from, ...route, founding };
  let cargoSum = 0;
  for (const k of CARGO_IDS) {
    if ((draft.cargo[k] ?? 0) < -1e-6) return { ...empty, reason: "Cargo cannot be negative.", ship, from, ...route, founding };
    cargoSum += draft.cargo[k] ?? 0;
  }
  if (cargoSum > def.cargo + 1e-6) return { ...empty, reason: "Cargo bay is over capacity.", ship, from, ...route, founding };
  if (founding) {
    if (draft.crew < FOUNDING_MIN.crew) return { ...empty, reason: `A founding cadre needs ${FOUNDING_MIN.crew} crew.`, ship, from, ...route, founding };
    if ((draft.cargo.food ?? 0) < FOUNDING_MIN.food) return { ...empty, reason: `Load at least ${FOUNDING_MIN.food} t of food.`, ship, from, ...route, founding };
    if ((draft.cargo.water ?? 0) < FOUNDING_MIN.water) return { ...empty, reason: `Load at least ${FOUNDING_MIN.water} t of water.`, ship, from, ...route, founding };
    if ((draft.cargo.oxygen ?? 0) < FOUNDING_MIN.oxygen) return { ...empty, reason: `Load at least ${FOUNDING_MIN.oxygen} t of oxygen.`, ship, from, ...route, founding };
    if ((draft.cargo.metals ?? 0) < FOUNDING_MIN.metals) return { ...empty, reason: `Load at least ${FOUNDING_MIN.metals} t of metals.`, ship, from, ...route, founding };
  }

  let cost = 0;
  if (from === "earth") {
    for (const k of CARGO_IDS) {
      const delta = (draft.cargo[k] ?? 0) - ship.cargo[k];
      if (delta > 0) {
        if (k === "he3") return { ...empty, reason: "Earth does not sell helium-3.", ship, from, ...route, founding };
        cost += delta * buyPrice(state, k);
      } else if (delta < 0) cost += delta * sellPrice(state, k);
    }
    const fuelDelta = draft.fuel - ship.fuel;
    if (fuelDelta > 0) cost += fuelDelta * buyPrice(state, "propellant");
    else cost += fuelDelta * sellPrice(state, "propellant");
    const hire = draft.crew - ship.crew;
    if (hire > 0) cost += hire * hirePrice(state);
  } else {
    const world = state.worlds[from];
    const cap = storageCap(state, world);
    const changes = launchResourceDelta(ship, draft);
    for (const k of CARGO_IDS) {
      const delta = changes[k];
      if (delta > 0 && world.stock[k] + 1e-6 < delta) return { ...empty, reason: `Not enough ${k} in the outpost stores.`, ship, from, ...route, founding };
      if (delta < 0 && world.stock[k] - delta > cap[k] + 1e-6) return { ...empty, reason: `${k} storage is full — it cannot come off the ship.`, ship, from, ...route, founding };
    }
    const crewDelta = draft.crew - ship.crew;
    if (crewDelta > 0 && world.pop - crewDelta < 2) return { ...empty, reason: "Leave at least two people on the outpost.", ship, from, ...route, founding };
  }
  if (!canSpend(state, cost)) return { ...empty, reason: "Credit line refused.", ship, from, cost, ...route, founding };
  return { ok: true, cost, turns: route.turns, burn: route.burn, risk: route.risk, founding, ship, from };
}

export function launchShip(state: GameState, shipId: string, draft: LaunchDraft): ActionResult {
  const check = checkLaunch(state, shipId, draft);
  if (!check.ok || !check.ship) return fail(check.reason ?? "Cannot launch.");
  const ship = check.ship;
  const from = check.from;
  if (from === "earth") {
    state.credits -= check.cost;
    const hire = draft.crew - ship.crew;
    if (hire > 0) {
      /* paid above */
    }
  } else {
    const world = state.worlds[from];
    const changes = launchResourceDelta(ship, draft);
    for (const k of CARGO_IDS) {
      world.stock[k] = Math.max(0, world.stock[k] - changes[k]);
    }
    world.pop -= draft.crew - ship.crew;
    world.launches += 1;
  }
  if (from === "earth") state.earthLaunches += 1;
  for (const k of CARGO_IDS) ship.cargo[k] = draft.cargo[k] ?? 0;
  // Load the requested manifest, then consume the committed route burn once at departure.
  ship.fuel = draft.fuel - check.burn;
  ship.crew = draft.crew;
  ship.loc = "transit";
  ship.mission = { from, to: draft.dest, eta: check.turns, total: check.turns, risk: check.risk, founding: check.founding, burn: check.burn };
  state.stats.launched += 1;
  const destName = draft.dest === "earth" ? "Earth" : state.worlds[draft.dest].name;
  pushLog(
    state,
    `${ship.name} departs for ${destName}. ${check.turns} sols, burn ${check.burn} t, incident risk ${Math.round(check.risk * 100)}%.`,
    "info",
  );
  return { ok: true, sfx: "launch" };
}

export function unloadShip(state: GameState, shipId: string): ActionResult {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.loc === "transit" || ship.loc === "earth") return fail("Unload at a founded outpost.");
  if (state.founding?.shipId === ship.id) return fail("Land first — the cargo is the colony.");
  const world = state.worlds[ship.loc];
  if (!world.founded) return fail("No outpost to receive cargo.");
  const cap = storageCap(state, world);
  for (const k of CARGO_IDS) {
    const room = Math.max(0, cap[k] - world.stock[k]);
    const move = Math.min(room, ship.cargo[k]);
    world.stock[k] += move;
    ship.cargo[k] -= move;
  }
  pushLog(state, `${ship.name} unloads at ${world.name}.`, "info");
  return { ok: true, sfx: "click" };
}

export function sellCargo(state: GameState, shipId: string): ActionResult {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.loc !== "earth") return fail("Sell only at Earth dock.");
  let credits = 0;
  let he3 = 0;
  for (const k of CARGO_IDS) {
    credits += ship.cargo[k] * sellPrice(state, k);
    if (k === "he3") he3 += ship.cargo[k];
    ship.cargo[k] = 0;
  }
  if (credits <= 0) return fail("The bay is empty.");
  state.credits += credits;
  state.stats.he3Sold += he3;
  pushLog(state, `${ship.name} sells its cargo at Earth for ${fmt(credits)} credits.`, he3 > 0 ? "good" : "info");
  return { ok: true, sfx: "click" };
}

export function offloadFuel(state: GameState, shipId: string): ActionResult {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.loc === "transit" || ship.loc === "earth") return fail("Offload propellant at an outpost.");
  const world = state.worlds[ship.loc];
  if (!world.founded) return fail("No tanks on the ground.");
  const cap = storageCap(state, world);
  const room = Math.max(0, cap.propellant - world.stock.propellant);
  const move = Math.min(room, ship.fuel);
  if (move <= 0) return fail("Ground tanks are full or the ship is dry.");
  world.stock.propellant += move;
  ship.fuel -= move;
  pushLog(state, `${ship.name} offloads ${fmt(move)} t of propellant.`, "info");
  return { ok: true, sfx: "click" };
}

export function disembark(state: GameState, shipId: string): ActionResult {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.loc === "transit" || ship.loc === "earth") return fail("Crews disembark at an outpost.");
  if (state.founding?.shipId === ship.id) return fail("Found the outpost to put boots on the ground.");
  const world = state.worlds[ship.loc];
  if (!world.founded) return fail("No outpost.");
  if (ship.crew <= 1) return fail("The skeleton crew stays aboard.");
  const move = ship.crew - 1;
  world.pop += move;
  ship.crew = 1;
  pushLog(state, `${move} crew join ${world.name}. Population ${world.pop}.`, "good");
  return { ok: true, sfx: "click" };
}

export function fulfillContract(state: GameState, shipId: string): ActionResult {
  const contract = state.contract;
  if (!contract) return fail("No open quota.");
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.loc !== "earth") return fail("The quota is paid at Earth dock.");
  for (const [k, need] of Object.entries(contract.need) as [CargoId, number][]) {
    if ((ship.cargo[k] ?? 0) + 1e-6 < need) return fail(`Short ${fmt(need - (ship.cargo[k] ?? 0))} ${k}.`);
  }
  for (const [k, need] of Object.entries(contract.need) as [CargoId, number][]) ship.cargo[k] -= need;
  state.credits += contract.reward;
  if (contract.need.he3) state.stats.he3Sold += contract.need.he3;
  for (const w of [state.worlds.luna, state.worlds.mars]) if (w.founded) w.morale = Math.min(100, w.morale + 2);
  pushLog(state, `${contract.title} delivered. +${contract.reward} credits.`, "good");
  state.contract = null;
  return { ok: true, sfx: "click" };
}

export function foundingKit(burn: number, haveFuel: number): LaunchDraft["cargo"] & { fuel: number; crew: number } {
  return {
    ...emptyCargo(),
    food: 14,
    water: 12,
    oxygen: 26,
    metals: 44,
    fuel: Math.max(haveFuel, burn),
    crew: 11,
  };
}

export function shipById(state: GameState, id: string): Ship | null {
  return state.ships.find((s) => s.id === id) ?? null;
}
