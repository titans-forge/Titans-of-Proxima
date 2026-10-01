import { foundColony, launchShip, placeBuilding, placementError, previewLaunch, queueResearch } from "./core/actions";
import { applyChoice, enqueueEvent } from "./core/events";
import { isWindowOpen, solsUntilWindow } from "./core/routes";
import { applyTurn, blockingReason, forecast, objectives, suggestions } from "./core/sim";
import { createGame } from "./core/state";
import type { BuildingId, GameState, TechId } from "./core/types";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function dist(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

function neighborIce(game: GameState): { q: number; r: number } {
  const tiles = game.worlds.luna.tiles;
  const command = tiles.find((t) => t.building?.type === "command");
  assert(command, "missing command");
  const ice = tiles.find((t) => !t.building && (t.terrain === "polar" || t.ice >= 40) && dist(t, command!) === 1);
  assert(ice, "no ice neighbor");
  return ice!;
}

function findLegal(game: GameState, type: BuildingId): { q: number; r: number } | null {
  for (const tile of game.worlds.luna.tiles) {
    if (placementError(game, "luna", tile.q, tile.r, type) === null) return { q: tile.q, r: tile.r };
  }
  return null;
}

function bot(game: GameState, turns: number): void {
  const order: BuildingId[] = ["ice", "greenhouse", "isru", "regolith", "solar", "habitat", "lab", "depot"];
  const techOrder: TechId[] = ["eclss", "pv", "methalox", "sinter", "shelters"];
  for (let i = 0; i < turns; i++) {
    if (game.outcome) return;
    const ev = game.events[0];
    if (ev) {
      const choice = ev.choices.find((c) => !c.disabled) ?? ev.choices[0];
      if (choice) applyChoice(game, ev.id, choice.id);
    }
    if (game.founding) {
      const world = game.worlds[game.founding.world];
      const tile = world.tiles.find((t) => !t.building && t.terrain !== "polar") ?? world.tiles.find((t) => !t.building);
      if (tile) foundColony(game, tile.q, tile.r);
    }
    for (const type of order) {
      const spot = findLegal(game, type);
      if (!spot) continue;
      if (placeBuilding(game, "luna", spot.q, spot.r, type).ok) break;
    }
    if (!game.tech.current) {
      const next = techOrder.find((id) => !game.tech.unlocked.includes(id));
      if (next) queueResearch(game, next);
    }
    if (blockingReason(game)) break;
    applyTurn(game);
  }
}

function main(): void {
  assert(!isWindowOpen(1), "sol 1 window should be closed");
  assert(isWindowOpen(5) && isWindowOpen(8) && !isWindowOpen(9), "window is sols 5 through 8");
  assert(solsUntilWindow(1) === 4, "window opens on sol 5");

  const game = createGame("charter", 42);
  assert(game.worlds.luna.founded && !game.worlds.mars.founded, "only Luna starts founded");
  assert(game.ships.some((s) => s.name === "PAS Cinder"), "courier exists");
  assert(game.worlds.luna.tiles.some((t) => t.building?.type === "solar"), "starter array");
  assert(game.worlds.luna.tiles.some((t) => t.building?.type === "pad"), "starter pad");

  const ice = neighborIce(game);
  assert(placementError(game, "luna", ice.q, ice.r, "ice") === null, "ice mine should be legal");
  const placed = placeBuilding(game, "luna", ice.q, ice.r, "ice");
  assert(placed.ok, placed.reason ?? "place failed");
  assert(!placeBuilding(game, "luna", ice.q, ice.r, "solar").ok, "occupied tile accepted a building");

  applyTurn(game);
  applyTurn(game);
  const mine = game.worlds.luna.tiles.find((t) => t.building?.type === "ice");
  assert(mine?.building?.progress === 0, "ice mine should finish in two sols");
  assert(forecast(game, "luna").produced.water > 3, "ice mine should produce water");

  const ship = game.ships[0]!;
  const refusedBefore = JSON.stringify(ship);
  const refused = launchShip(game, ship.id, { dest: "earth", cargo: { ...ship.cargo }, fuel: 0, crew: ship.crew });
  assert(!refused.ok, "launch without fuel should fail");
  assert(JSON.stringify(ship) === refusedBefore, "rejected launch must not mutate the ship");

  const fuelTest = createGame("survey", 42);
  const courier = fuelTest.ships[0]!;
  const leg = previewLaunch(fuelTest, courier.id, { dest: "earth", cargo: { ...courier.cargo }, fuel: 12, crew: courier.crew });
  assert(leg.ok && leg.burn > 0, "fuel regression route should be launchable");
  const fuelBefore = 12;
  assert(launchShip(fuelTest, courier.id, { dest: "earth", cargo: { ...courier.cargo }, fuel: fuelBefore, crew: courier.crew }).ok, "fuel regression launch");
  assert(courier.fuel === fuelBefore - leg.burn, "route burn must be deducted at departure");
  courier.mission!.eta = 1;
  applyTurn(fuelTest);
  assert(courier.loc === "earth" && courier.fuel === fuelBefore - leg.burn, "arrival must not burn fuel a second time");

  const queueTest = createGame("charter", 43);
  const open = findLegal(queueTest, "greenhouse");
  assert(open && placeBuilding(queueTest, "luna", open.q, open.r, "greenhouse").ok, "queued greenhouse should place");
  queueTest.worlds.luna.stock.food = 0;
  assert(!suggestions(queueTest, "luna").includes("greenhouse"), "guidance must not duplicate a pending greenhouse");

  if (game.events.length === 0) enqueueEvent(game, "solar");
  const ev = game.events[0];
  assert(ev, "solar event queued");
  applyChoice(game, ev.id, "shelter");
  assert(game.worlds.luna.shelter === 1, "shelter should engage");

  const survey = createGame("survey", 7);
  bot(survey, 14);
  assert(survey.outcome?.kind !== "defeat", "survey bot should not lose inside 14 sols");
  assert(survey.worlds.luna.pop > 0, "Luna crew died in the bot run");

  const doomed = createGame("charter", 3);
  doomed.worlds.luna.pop = 0;
  applyTurn(doomed);
  assert(doomed.outcome?.kind === "defeat", "empty crew should end the charter");

  const victor = createGame("survey", 9);
  victor.worlds.mars.founded = true;
  victor.worlds.mars.pop = 40;
  victor.worlds.luna.pop = 40;
  victor.worlds.luna.streak = 5;
  victor.worlds.mars.streak = 5;
  victor.tech.unlocked = ["pv", "arrays", "fission", "fusion", "eclss", "hydro"];
  while (victor.ships.length < 3) {
    const base = victor.ships[0]!;
    victor.ships.push({ ...base, id: `extra-${victor.ships.length}`, name: `PAS Extra ${victor.ships.length}` });
  }
  victor.credits = 100;
  const goals = objectives(victor);
  assert(
    goals.every((g) => g.done),
    `victory goals incomplete: ${goals.filter((g) => !g.done).map((g) => g.id).join(",")}`,
  );

  const round = JSON.parse(JSON.stringify(game)) as GameState;
  assert(round.seed === game.seed && round.worlds.luna.tiles.length > 0, "save roundtrip");

  const landing = createGame("survey", 11);
  const colony = landing.ships[0];
  const landingTile = landing.worlds.mars.tiles.find((t) => !t.building && t.terrain !== "polar");
  assert(colony && landingTile, "landing fixture");
  colony!.cls = "colony";
  landing.founding = { shipId: colony!.id, world: "mars" };
  const landed = foundColony(landing, landingTile!.q, landingTile!.r);
  assert(landed.ok && landed.focus?.world === "mars" && landed.focus.q === landingTile!.q && landed.focus.r === landingTile!.r, "foundColony must focus the actual landing tile");
  console.log("selftest ok");
}

main();
