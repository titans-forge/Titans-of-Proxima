import { assert } from "../core/testAssert";
import { foundColony, launchShip, sellCargo, unloadShip } from "../core/actions";
import { createGame, emptyCargo } from "../core/state";
import { cargoLimit, fuelLimit, initialLaunchDraft, launchSummary, quotaReady, shipManifestKey, shipIntegrity } from "./fleetDraft";
import { SHIPS } from "../core/data";

const game = createGame("charter", 42);
const ship = game.ships[0]!;
for (const cls of ["courier", "freighter", "colony", "tanker"] as const) {
  assert.equal(shipIntegrity({ ...ship, cls, hull: SHIPS[cls].hull }), 100, "Every full-health class must fill its integrity bar");
  assert.equal(shipIntegrity({ ...ship, cls, hull: SHIPS[cls].hull / 2 }), 50);
  assert.equal(shipIntegrity({ ...ship, cls, hull: 0 }), 0);
}
const draft = initialLaunchDraft(ship);
assert.equal(draft.dest, "earth");
draft.cargo.propellant = 20;
draft.fuel += 4;
assert.equal(cargoLimit(game, ship, draft, "propellant"), 20);
assert.equal(fuelLimit(game, ship, draft), 16);
assert.match(launchSummary(game, ship, draft), /propellant 0 t/);
const key = shipManifestKey(ship);
assert.equal(launchShip(game, ship.id, draft).ok, true);
assert.notEqual(shipManifestKey(ship), key, "departure invalidates a draft basis");
ship.mission = null;
ship.loc = "earth";
assert.equal(initialLaunchDraft(ship).dest, "mars", "arrival never keeps the current dock as destination");
ship.cargo = { ...emptyCargo(), metals: 22 };
game.contract = { id: "fixture", title: "Metals", detail: "22 tonnes", need: { metals: 22 }, reward: 280, deadline: 21 };
assert.equal(quotaReady(game, ship), true);
const saleKey = shipManifestKey(ship);
assert.equal(sellCargo(game, ship.id).ok, true);
assert.notEqual(shipManifestKey(ship), saleKey);
assert.equal(initialLaunchDraft(ship).cargo.metals, 0);
assert.equal(quotaReady(game, ship), false, "quota action uses real cargo, not the draft");
ship.loc = "luna";
ship.cargo.metals = 10;
const unloadKey = shipManifestKey(ship);
assert.equal(unloadShip(game, ship.id).ok, true);
assert.notEqual(shipManifestKey(ship), unloadKey);

// Synthetic first-landing fixture: cargo and crew must refresh together.
ship.loc = "mars";
ship.cargo.metals = 44;
ship.crew = 11;
game.founding = { shipId: ship.id, world: "mars" };
const landingKey = shipManifestKey(ship);
const tile = game.worlds.mars.tiles.find(t => !t.building)!;
assert.equal(foundColony(game, tile.q, tile.r).ok, true);
assert.notEqual(shipManifestKey(ship), landingKey);
const landedDraft = initialLaunchDraft(ship);
assert.equal(landedDraft.cargo.metals, 0);
assert.equal(landedDraft.crew, 1);
assert.equal(landedDraft.dest, "earth");
console.log("fleet draft: lifecycle invalidation, real quota, shared-store limits and departure preview pass");
