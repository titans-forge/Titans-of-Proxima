import { disembark, launchShip, previewLaunch } from "./actions";
import { crewArrivalAdvice, crewCapacity, crewDepartureBlocker, crewReturnPlan, crewTransferPlan } from "./crewTransport";
import { SHIPS } from "./data";
import { applyTurn } from "./sim";
import { createGame, emptyCargo } from "./state";
import { assert } from "./testAssert";
import type { BuildingId, GameState, WorldId } from "./types";

// Deliberate support fixtures isolate capacity contracts, not campaign balance.
function supported(): GameState {
  const game = createGame("charter", 42);
  game.tech.unlocked = ["hydro"];
  for (const id of ["luna", "mars"] as const) {
    const w = game.worlds[id];
    w.founded = true;
    w.pop = 10;
    w.morale = 70;
    w.dust = w.radiation = w.shelter = w.quarantine = 0;
    Object.assign(w.stock, { energy: 100, water: 100, oxygen: 100, food: 100, regolith: 100, propellant: 60 });
    for (const tile of w.tiles) tile.building = null;
    const modules: BuildingId[] = ["command", "pad", ...Array<BuildingId>(3).fill("habitat"), ...Array<BuildingId>(8).fill("ice"), ...Array<BuildingId>(5).fill("isru"), ...Array<BuildingId>(3).fill("greenhouse"), ...Array<BuildingId>(12).fill("solar"), ...Array<BuildingId>(3).fill("regolith")];
    modules.forEach((type, i) => {
      w.tiles[i].terrain = id === "luna" ? "mare" : "plain";
      w.tiles[i].ice = 100;
      w.tiles[i].building = { type, hp: 100, progress: 0, total: 0 };
    });
  }
  game.ships[0].loc = "earth";
  return game;
}

for (const world of ["luna", "mars"] as const) {
  const game = supported();
  const before = JSON.stringify(game);
  const capacity = crewCapacity(game, world);
  assert.equal(capacity.housing, 60);
  assert.equal(capacity.additional, capacity.target - game.worlds[world].pop);
  const plan = crewTransferPlan(game, "ship-1", world)!;
  assert.ok(plan.ready);
  assert.equal(plan.passengers, 5);
  assert.equal(plan.draft.crew, SHIPS.courier.crew);
  assert.equal(plan.cost, previewLaunch(game, "ship-1", plan.draft).cost);
  assert.equal(JSON.stringify(game), before);
}
const game = supported();
const ship = game.ships[0];
const plan = crewTransferPlan(game, ship.id, "luna")!;
const openingCash = game.credits;
assert.ok(launchShip(game, ship.id, plan.draft).ok);
assert.equal(game.credits, openingCash - plan.cost);
assert.equal(game.worlds.luna.pop, 10, "A launch does not put passengers on the ground");
assert.equal(crewCapacity(game, "luna").reservedPassengers, 5);
assert.equal(crewTransferPlan(game, ship.id, "luna"), null);
applyTurn(game);
assert.equal(ship.loc, "luna", "Public departure and one-sol arrival");
assert.equal(game.worlds.luna.pop, 10, "Arrival is not disembarkation");
const arrival = crewArrivalAdvice(game, ship.id);
assert.ok(arrival.ready);
const beforeLanding = JSON.stringify(game);
assert.equal(crewArrivalAdvice(game, ship.id).populationAfter, 15);
assert.equal(JSON.stringify(game), beforeLanding);
assert.ok(disembark(game, ship.id).ok);
assert.equal(game.worlds.luna.pop, 15);
assert.equal(ship.crew, 1);
assert.equal(crewCapacity(game, "luna").reservedPassengers, 0);
assert.equal(crewArrivalAdvice(game, ship.id).ready, false);
assert.ok(crewReturnPlan(game, ship.id)!.ready);

const reserved = supported();
reserved.worlds.luna.pop = 36;
reserved.ships.push({ ...structuredClone(reserved.ships[0]), id: "incoming", loc: "transit", crew: 5, mission: { from: "earth", to: "luna", eta: 2, total: 2, risk: 0.1, burn: 2, founding: false } });
assert.equal(crewCapacity(reserved, "luna").additional, 0, "Already-booked passengers cannot be booked again");
assert.equal(crewTransferPlan(reserved, "ship-1", "luna")!.ready, false);
reserved.ships[1].mission = null;
reserved.ships[1].loc = "luna";
assert.equal(crewCapacity(reserved, "luna").additional, 0, "Docked passengers still reserve capacity");
reserved.worlds.luna.pop = 17;
for (const tile of reserved.worlds.luna.tiles) {
  if (tile.building?.type === "habitat") tile.building.progress = tile.building.total = 1;
}
const pendingBefore = JSON.stringify(reserved);
assert.equal(crewCapacity(reserved, "luna").housing, 18);
assert.equal(crewCapacity(reserved, "luna").pendingHousing, 42);
assert.equal(crewCapacity(reserved, "luna").additional, 0);
assert.equal(JSON.stringify(reserved), pendingBefore);

function blocked(edit: (g: GameState) => void, pattern: RegExp, world: WorldId = "luna"): void {
  const g = supported();
  edit(g);
  const before = JSON.stringify(g);
  const p = crewTransferPlan(g, "ship-1", world)!;
  assert.equal(p.ready, false);
  assert.match(p.blocker!, pattern);
  assert.equal(JSON.stringify(g), before);
}
blocked(g => { g.worlds.luna.founded = false; }, /Found this outpost/);
blocked(g => { g.credits = -220; }, /Credit line/);
blocked(g => { g.earthLaunches = 2; }, /two hulls/);
blocked(g => { g.ships[0].hull = 12; }, /Repair/);
blocked(g => { g.ships[0].cargo.food = 1; }, /loaded cargo/);
blocked(g => { g.ships[0].cls = "colony"; g.ships[0].hull = SHIPS.colony.hull; g.worlds.mars.founded = false; }, /Reserve/);
blocked(g => { g.outcome = { kind: "victory" }; }, /closed/);
blocked(g => {
  for (const tile of g.worlds.luna.tiles) if (tile.building?.type === "solar") tile.building.hp = 0;
  g.worlds.luna.stock.energy = 124;
}, /sustained power/);
blocked(g => {
  for (const tile of g.worlds.luna.tiles) if (tile.building?.type === "greenhouse") tile.building.hp = 0;
}, /sustained food/);
blocked(g => {
  for (const tile of g.worlds.luna.tiles) if (tile.building?.type === "regolith") tile.building.hp = 0;
  g.worlds.luna.stock.regolith = 1000;
}, /regolith feedstock/);
const stale = supported();
const stalePlan = crewTransferPlan(stale, "ship-1", "luna")!;
assert.equal(crewDepartureBlocker(stale, "ship-1", stalePlan.draft), null);
stale.worlds.luna.pop = 39;
const staleBefore = JSON.stringify(stale);
assert.match(crewDepartureBlocker(stale, "ship-1", stalePlan.draft)!, /exceeds/);
assert.equal(JSON.stringify(stale), staleBefore, "Departure advice never books or hires passengers");
assert.equal(crewDepartureBlocker(stale, "ship-1", { ...stalePlan.draft, crew: 2 }), null, "Check the actual edited manifest, not the old plan");
stale.ships.push({ ...structuredClone(stale.ships[0]), id: "booked", loc: "luna", crew: 2 });
assert.match(crewDepartureBlocker(stale, "ship-1", { ...stalePlan.draft, crew: 2 })!, /goal/);
assert.equal(crewDepartureBlocker(stale, "ship-1", { ...stalePlan.draft, dest: "earth" }), null);
assert.equal(crewDepartureBlocker(stale, "ship-1", { ...stalePlan.draft, crew: 1 }), null);
stale.worlds.mars.founded = false;
assert.equal(crewDepartureBlocker(stale, "ship-1", { ...stalePlan.draft, dest: "mars" }), null, "Founding has its own public launch contract");
const overcrowded = supported();
overcrowded.ships[0].loc = "luna";
overcrowded.ships[0].crew = 6;
overcrowded.worlds.luna.pop = 59;
assert.match(crewArrivalAdvice(overcrowded, "ship-1").blocker!, /housing/);
assert.equal(crewReturnPlan(overcrowded, "ship-1")!.ready, false);
const raw = createGame("charter", 42);
assert.equal(crewCapacity(raw, "luna").additional, 0, "Opening stocks are not sustained production");
assert.equal(crewTransferPlan(raw, "missing", "luna"), null);
assert.equal(crewArrivalAdvice(raw, "missing").eligible, false);
assert.equal(crewReturnPlan(raw, "missing"), null);
assert.equal(JSON.stringify(emptyCargo()), JSON.stringify(plan.draft.cargo));
console.log("crew transport: completed-only support, bookings, exact paid manifests, arrival/disembark separation and blockers pass");
