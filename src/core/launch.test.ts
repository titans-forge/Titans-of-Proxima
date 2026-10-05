import { assert } from "./testAssert";
import { launchShip, previewLaunch, launchResourceDelta } from "./actions";
import { storageCap } from "./sim";
import { createGame, emptyCargo } from "./state";

const game = createGame("charter", 42);
const ship = game.ships[0]!;
const draft = { dest: "earth" as const, cargo: { ...emptyCargo(), propellant: 24 }, fuel: ship.fuel + 4, crew: ship.crew };
const before = JSON.stringify(game);
assert.equal(launchResourceDelta(ship, draft).propellant, 28);
assert.equal(previewLaunch(game, ship.id, draft).ok, false, "cargo and tank draw cannot share the same 24 t");
assert.equal(launchShip(game, ship.id, draft).ok, false);
assert.equal(JSON.stringify(game), before, "rejected launch is atomic");
draft.cargo.propellant = 20;
const total = game.worlds.luna.stock.propellant + ship.fuel + ship.cargo.propellant;
const preview = previewLaunch(game, ship.id, draft);
assert.equal(preview.ok, true, "exact shared-store boundary is valid");
assert.equal(launchShip(game, ship.id, draft).ok, true);
assert.equal(game.worlds.luna.stock.propellant, 0);
assert.equal(game.worlds.luna.stock.propellant + ship.fuel + ship.cargo.propellant, total - preview.burn, "only the route burn leaves the system");

// Opposite transfers cancel: fuel can move into the cargo bay without ground stock.
const transfer = createGame("charter", 43);
const shuttle = transfer.ships[0]!;
transfer.worlds.luna.stock.propellant = 0;
const transferDraft = { dest: "earth" as const, cargo: { ...emptyCargo(), propellant: 4 }, fuel: shuttle.fuel - 4, crew: shuttle.crew };
assert.equal(previewLaunch(transfer, shuttle.id, transferDraft).ok, true);
assert.equal(launchShip(transfer, shuttle.id, transferDraft).ok, true);
assert.equal(transfer.worlds.luna.stock.propellant, 0);

const full = createGame("charter", 44);
const fullShip = full.ships[0]!;
const capacity = storageCap(full, full.worlds.luna).propellant;
full.worlds.luna.stock.propellant = capacity - 5;
fullShip.cargo.propellant = 4;
const over = { dest: "earth" as const, cargo: emptyCargo(), fuel: fullShip.fuel - 4, crew: fullShip.crew };
assert.equal(previewLaunch(full, fullShip.id, over).ok, false, "combined 8 t return exceeds 5 t ground room");
over.fuel = fullShip.fuel + 4;
full.worlds.luna.stock.propellant = capacity;
assert.equal(previewLaunch(full, fullShip.id, over).ok, true, "cargo-to-tank transfer can cancel at full ground storage");
over.fuel = Number.NaN;
assert.equal(previewLaunch(full, fullShip.id, over).ok, false);
console.log("launch: shared propellant, conservation, atomic rejection, transfers and finite manifests pass");
