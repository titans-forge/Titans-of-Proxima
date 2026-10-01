import { placeBuilding } from "./actions";
import { applyTurn, forecast } from "./sim";
import { createGame } from "./state";
import type { BuildingId, GameState, WorldId } from "./types";

function ok(value: unknown, message: string): void { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void { if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`); }
function near(actual: number, expected: number, message: string): void { if (Math.abs(actual - expected) > 0.01) throw new Error(`${message}: ${actual} !== ${expected}`); }

function fixture(worldId: WorldId = "luna"): GameState {
  const state = createGame("charter", 91731);
  const world = state.worlds[worldId];
  world.founded = true;
  world.pop = 0;
  world.stock = { energy: 0, water: 100, oxygen: 100, food: 100, metals: 100, he3: 0, regolith: 100, propellant: 0 };
  world.tiles.forEach((tile) => { tile.building = null; });
  const tiles = world.tiles.slice(0, 8);
  const put = (index: number, type: BuildingId) => { tiles[index].building = { type, hp: 100, progress: 0, total: 0 }; };
  put(0, "command"); put(1, "fission"); put(2, "fission"); put(3, "ice"); put(4, "regolith"); put(5, "he3");
  world.tiles[3].ice = 60; world.tiles[4].metal = 70; world.tiles[4].regolith = 80; world.tiles[5].he3 = 70;
  state.tech.unlocked = ["robots"];
  return state;
}

const gated = createGame("charter", 91732);
const command = gated.worlds.luna.tiles.find((t) => t.building?.type === "command")!;
const open = gated.worlds.luna.tiles.find((t) => !t.building && Math.abs(t.q - command.q) <= 1 && Math.abs(t.r - command.r) <= 1)!;
gated.worlds.luna.stock.metals = 1000;
gated.credits = 1000;
equal(placeBuilding(gated, "luna", open.q, open.r, "robotics").ok, false, "robotics is tech gated");
gated.tech.unlocked.push("robots");
equal(placeBuilding(gated, "luna", open.q, open.r, "robotics").ok, true, "robotics places after robots tech");
const fabTile = gated.worlds.luna.tiles.find((t) => !t.building && Math.abs(t.q - command.q) <= 1 && Math.abs(t.r - command.r) <= 1)!;
equal(placeBuilding(gated, "luna", fabTile.q, fabTile.r, "aresfab").ok, false, "Aresfab requires its own technology");
gated.tech.unlocked.push("drones");
equal(placeBuilding(gated, "luna", fabTile.q, fabTile.r, "aresfab").ok, true, "aresfab places after drones tech");

const base = fixture();
const robot = structuredClone(base);
robot.tech.unlocked = ["robots"];
robot.worlds.luna.tiles[6].building = { type: "robotics", hp: 100, progress: 0, total: 3 };
const before = forecast(base, "luna");
const after = forecast(robot, "luna");
near(after.produced.water, before.produced.water * 1.2, "powered robotics boosts ice mining by 20%");
near(after.produced.regolith, before.produced.regolith * 1.2, "powered robotics boosts regolith mining by 20%");
near(after.produced.he3, before.produced.he3 * 1.2, "powered robotics boosts He-3 mining by 20%");
near(after.consumed.metals, 1, "robotics consumes one opening-stock metal");
near(after.demand.metals, 1, "robotics reports one metal demand");

const fab = fixture();
fab.tech.unlocked = ["drones"];
fab.worlds.luna.tiles[6].building = { type: "aresfab", hp: 100, progress: 0, total: 3 };
const fabForecast = forecast(fab, "luna");
near(fabForecast.rp - 3, 14, "full powered Aresfab adds fourteen RP");
near(fabForecast.consumed.metals, 1, "Aresfab consumes one metal");
near(fabForecast.consumed.water, 0.5, "Aresfab consumes half a ton of water after life support");
const pure = JSON.stringify(fab);
forecast(fab, "luna");
equal(JSON.stringify(fab), pure, "forecast is pure and idempotent");
const capped = structuredClone(fab);
for (const i of [3, 4, 5]) capped.worlds.luna.tiles[i].building = null;
capped.worlds.luna.tiles[7].building = { type: "aresfab", hp: 100, progress: 0, total: 3 };
capped.worlds.luna.stock.metals = 1;
capped.worlds.luna.stock.water = 0.5;
const cappedForecast = forecast(capped, "luna");
ok(cappedForecast.consumed.metals <= capped.worlds.luna.stock.metals + cappedForecast.produced.metals + 0.001 && cappedForecast.consumed.water <= capped.worlds.luna.stock.water + cappedForecast.produced.water + 0.001, "multiple fabs never overspend inputs");
near(cappedForecast.rp, 17, "two fabs share inputs sufficient for exactly one full batch");
const lifePriority = structuredClone(capped);
lifePriority.worlds.luna.pop = 4;
lifePriority.worlds.luna.tiles[3].building = null;
const priorityForecast = forecast(lifePriority, "luna");
near(priorityForecast.consumed.water, 0.5, "life support consumes water before fabs");
near(priorityForecast.rp, 3.24, "fabs idle when life support used all water");

const doubled = structuredClone(robot);
doubled.worlds.luna.tiles[7].building = { type: "robotics", hp: 100, progress: 0, total: 3 };
const doubleForecast = forecast(doubled, "luna");
near(doubleForecast.produced.water, after.produced.water, "robotics factories do not stack");
near(doubleForecast.consumed.metals, after.consumed.metals, "standby robotics does not consume metals");
const starved = structuredClone(robot);
starved.worlds.luna.stock.metals = 0;
const starvedForecast = forecast(starved, "luna");
near(starvedForecast.produced.water, before.produced.water, "starved robotics gives no free mining bonus");
near(starvedForecast.consumed.metals, 0, "starved robotics consumes no metal");
const unfinished = structuredClone(robot);
unfinished.worlds.luna.tiles[6].building!.progress = 2;
near(forecast(unfinished, "luna").produced.water, before.produced.water, "construction gives no robotics bonus");
const dead = structuredClone(robot);
dead.worlds.luna.tiles[6].building!.hp = 10;
near(forecast(dead, "luna").produced.water, before.produced.water, "dead robotics gives no bonus");
const unpowered = structuredClone(robot);
unpowered.worlds.luna.tiles = unpowered.worlds.luna.tiles.filter((t) => t.building?.type !== "fission");
near(forecast(unpowered, "luna").produced.water, before.produced.water, "unpowered robotics gives no bonus");

const strongest = structuredClone(doubled);
const factories = strongest.worlds.luna.tiles.filter((t) => t.building?.type === "robotics")
  .sort((a, b) => `${a.q},${a.r}`.localeCompare(`${b.q},${b.r}`));
factories[0].building!.hp = 30;
near(forecast(strongest, "luna").produced.water, after.produced.water, "healthy factory wins over coordinate-first damaged factory");
near(forecast(strongest, "luna").consumed.metals, 1, "only strongest factory pays upkeep");
const partial = structuredClone(robot);
partial.worlds.luna.stock.metals = 0.25;
near(forecast(partial, "luna").produced.water, before.produced.water * 1.05, "quarter upkeep funds a five-percent bonus");

for (const mode of ["construction", "dead", "unpowered", "starved"] as const) {
  const inactive = structuredClone(fab);
  if (mode === "construction") inactive.worlds.luna.tiles[6].building!.progress = 2;
  if (mode === "dead") inactive.worlds.luna.tiles[6].building!.hp = 10;
  if (mode === "unpowered") inactive.worlds.luna.tiles = inactive.worlds.luna.tiles.filter((t) => t.building?.type !== "fission");
  if (mode === "starved") {
    inactive.worlds.luna.stock.metals = 0;
    for (const i of [3, 4, 5]) inactive.worlds.luna.tiles[i].building = null;
  }
  const f = forecast(inactive, "luna");
  near(f.rp, 3, `${mode} Aresfab produces no RP`);
  near(f.consumed.metals, 0, `${mode} Aresfab consumes no metal`);
  near(f.consumed.water, 0, `${mode} Aresfab consumes no water`);
}
const damagedFab = structuredClone(fab);
damagedFab.worlds.luna.tiles[6].building!.hp = 50;
near(forecast(damagedFab, "luna").rp, 10, "half-health fab gives seven RP plus command research");
const finishingFab = structuredClone(fab);
finishingFab.worlds.luna.tiles[6].building!.progress = 1;
near(forecast(finishingFab, "luna").rp, fabForecast.rp, "fab operates on the sol construction finishes, like other buildings");
const finishingRobot = structuredClone(robot);
finishingRobot.worlds.luna.tiles[6].building!.progress = 1;
near(forecast(finishingRobot, "luna").produced.water, after.produced.water, "robotics operates on completion sol");

const marsBase = fixture("mars");
const mars = structuredClone(marsBase);
mars.worlds.mars.tiles[6].building = { type: "robotics", hp: 100, progress: 0, total: 3 };
mars.worlds.mars.tiles[7].building = { type: "aresfab", hp: 100, progress: 0, total: 3 };
const mf = forecast(mars, "mars");
near(mf.produced.water, forecast(marsBase, "mars").produced.water * 1.2, "robotics works on Mars");
near(mf.rp, 17, "Aresfab works on Mars");
near(mf.consumed.metals, 2, "both facilities share accounted metals");
const repeat = forecast(mars, "mars");
equal(JSON.stringify(mf), JSON.stringify(repeat), "repeated forecast is identical");

const committed = structuredClone(fab);
committed.worlds.luna.pop = 4;
committed.tech.current = "fusion";
committed.tech.progress = 0;
const expectedRP = forecast(committed, "luna").rp + forecast(committed, "mars").rp;
applyTurn(committed);
near(committed.tech.progress, expectedRP, "turn resolution commits the forecast research output");

const legacy = createGame("charter", 91733);
equal(legacy.version, 1, "legacy save version remains one");
ok(legacy.worlds.luna.stock && legacy.worlds.mars.stock, "legacy save world stock shape remains intact");
console.log("industry tests passed");
