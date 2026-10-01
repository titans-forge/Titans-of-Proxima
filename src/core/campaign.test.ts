import { chooseEvent, foundColony, foundingKit, launchShip, placementError, placeBuilding, previewLaunch, queueResearch, landingAdvice, repairBuilding } from "./actions";
import { applyTurn, blockingReason, forecast, objectives } from "./sim";
import { createGame, emptyCargo } from "./state";
import { TECH_BY_ID } from "./data";
import { buildingStatus } from "./buildingStatus";
import type { BuildingId, GameState, TechId, WorldId } from "./types";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

// Real seeded Survey campaign: all mutations use public actions, never injected resources or unlocks.
const game = createGame("survey", 20260921);
const industryRan = new Set<string>();
const research: TechId[] = ["eclss", "sinter", "robots", "drones", "pv", "hydro", "medical", "ecology"];
function build(worldId: WorldId, type: BuildingId, count = 1): boolean {
  const world = game.worlds[worldId];
  if (world.tiles.filter(t => t.building?.type === type).length >= count) return true;
  const sites = world.tiles.filter(t => !t.building && !placementError(game, worldId, t.q, t.r, type));
  sites.sort((a, b) => type === "ice" ? b.ice - a.ice : type === "regolith" ? b.metal - a.metal : a.ice - b.ice);
  if (!sites[0]) return false;
  check(placeBuilding(game, worldId, sites[0].q, sites[0].r, type).ok, `legal build ${worldId}/${type}`);
  return true;
}
let industrySol = 0;
for (let step = 0; step < 90 && !game.outcome; step++) {
  while (game.events.length) {
    const event = game.events[0]!;
    const preferred = event.kind === "contract" ? "decline" : event.kind === "dust" ? "seal" : event.kind === "meteor" ? "dodge" : "shelter";
    const choice = event.choices.find(c => c.id === preferred && !c.disabled) ?? event.choices.find(c => !c.disabled);
    check(choice, `no legal event choice: ${event.kind}`);
    check(chooseEvent(game, event.id, choice.id).ok, `event ${event.kind}`);
  }
  if (game.founding) {
    const site = game.worlds.mars.tiles.find(t => landingAdvice(game, "mars", t.q, t.r) === "good");
    check(site, "Mars landing site exists");
    check(foundColony(game, site.q, site.r).ok, "legal Mars founding");
  }
  if (!game.tech.current) {
    const next = research.find(id => !game.tech.unlocked.includes(id) && TECH_BY_ID[id].req.every(req => game.tech.unlocked.includes(req)));
    if (next) check(queueResearch(game, next).ok, `research ${next}`);
  }
  for (const id of ["luna", "mars"] as const) {
    const world = game.worlds[id];
    if (!world.founded) continue;
    for (const t of world.tiles) if (t.building && t.building.hp < 80 && t.building.progress === 0 && world.stock.metals > 20) repairBuilding(game, id, t.q, t.r);
    for (const type of ["ice", "greenhouse", "regolith", "solar", "isru", "lab"] as BuildingId[]) build(id, type);
    const f = forecast(game, id);
    if (f.energyGen < f.energyDraw + 12) build(id, "solar", world.tiles.filter(t => t.building?.type === "solar").length + 1);
    if (f.net.water < 0) build(id, "ice", game.turn > 23 ? 3 : 2);
    if (f.net.oxygen < 0) build(id, "isru", 2);
    if (f.net.food < 0) build(id, "greenhouse", 2);
    if (game.tech.unlocked.includes("robots")) build(id, "robotics");
    if (game.tech.unlocked.includes("drones")) build(id, "aresfab");
    if (industryRan.size === 4) build(id, "habitat");
    const current = forecast(game, id);
    for (const t of world.tiles) if (t.building && ["robotics", "aresfab"].includes(t.building.type) && buildingStatus(t.building, t.q, t.r, current).status === "operating") industryRan.add(`${id}/${t.building.type}`);
  }
  const ship = game.ships.find(s => s.name === "PAS Halcyon");
  if (ship && !ship.mission && ship.loc === "earth" && !game.worlds.mars.founded) {
    const preview = previewLaunch(game, ship.id, { dest: "mars", cargo: emptyCargo(), fuel: ship.fuel, crew: 11 });
    const kit = foundingKit(preview.burn, ship.fuel);
    const draft = { dest: "mars" as const, cargo: kit, fuel: kit.fuel, crew: kit.crew };
    if (previewLaunch(game, ship.id, draft).ok) check(launchShip(game, ship.id, draft).ok, "legal founding launch");
  }
  if (industryRan.size === 4 && !industrySol) industrySol = game.turn;
  check(!blockingReason(game), `campaign blocked at sol ${game.turn}: ${blockingReason(game)}`);
  applyTurn(game);
  const outcome = game.outcome as GameState["outcome"];
  check(!outcome || outcome.kind === "victory", `campaign lost at sol ${game.turn}: ${outcome?.kind === "defeat" ? outcome.reason : ""}`);
}
check(game.worlds.mars.founded, "Mars founded through legal flight");
check(industryRan.size === 4, `industry not operating on both worlds by sol ${game.turn}: ${[...industryRan]}; credits ${game.credits}; tech ${game.tech.unlocked}`);
check(game.worlds.luna.pop > 0 && game.worlds.mars.pop > 0, "both colonies survived");
check(game.outcome?.kind === "victory", `victory not reached: ${JSON.stringify(objectives(game))}; credits ${game.credits}`);
console.log(`campaign: all four factories operated by sol ${industrySol}; Survey victory at sol ${game.turn}; credits ${Math.round(game.credits)}; population ${game.worlds.luna.pop}/${game.worlds.mars.pop}`);
