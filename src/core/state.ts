import { DIFF, SHIPS } from "./data";
import { generateMap, indexTiles, neighborTiles, pickLunaStart } from "./mapgen";
import type { CargoId, Difficulty, GameState, Stock, World, WorldId } from "./types";
import { RESOURCES } from "./types";

export function emptyStock(): Stock {
  return { energy: 0, water: 0, oxygen: 0, food: 0, metals: 0, he3: 0, regolith: 0, propellant: 0 };
}

export function emptyCargo(): Record<CargoId, number> {
  return { water: 0, oxygen: 0, food: 0, metals: 0, he3: 0, regolith: 0, propellant: 0 };
}

function stockMul(base: Stock, m: number): Stock {
  const out = emptyStock();
  for (const k of RESOURCES) out[k] = Math.round(base[k] * m);
  return out;
}

function bareWorld(id: WorldId, name: string, radius: number, seed: number, founded: boolean): World {
  return {
    id,
    name,
    radius,
    founded,
    tiles: generateMap(id, radius, seed),
    stock: emptyStock(),
    pop: 0,
    morale: 70,
    growth: 0,
    lowMorale: 0,
    streak: 0,
    dust: 0,
    shelter: 0,
    radiation: 0,
    quarantine: 0,
    foundedTurn: founded ? 1 : null,
    launches: 0,
    warnO2: false,
    warnFood: false,
    warnWater: false,
  };
}

export function pushLog(state: GameState, text: string, tone: GameState["log"][number]["tone"] = "info"): void {
  state.log.push({ turn: state.turn, text, tone });
  if (state.log.length > 140) state.log.splice(0, state.log.length - 140);
}

export function uid(state: GameState, prefix: string): string {
  state.seq += 1;
  return `${prefix}-${state.seq}`;
}

export function createGame(difficulty: Difficulty, seed?: number): GameState {
  const chosen = seed && seed > 0 ? Math.floor(seed) : Math.floor(Math.random() * 1_000_000_000) + 1;
  for (let i = 0; i < 16; i++) {
    const game = build(difficulty, chosen + i * 17);
    if (startIsPlayable(game)) return game;
  }
  return build(difficulty, chosen);
}

function startIsPlayable(state: GameState): boolean {
  const world = state.worlds.luna;
  const index = indexTiles(world.tiles);
  const command = world.tiles.find((t) => t.building?.type === "command");
  if (!command) return false;
  const neigh = neighborTiles(index, command.q, command.r);
  const iceFree = neigh.some((n) => !n.building && (n.terrain === "polar" || n.ice >= 40));
  const open = neigh.filter((n) => !n.building && n.terrain !== "polar").length;
  return iceFree && open >= 1;
}

function build(difficulty: Difficulty, seed: number): GameState {
  const diff = DIFF[difficulty];
  const luna = bareWorld("luna", "Shackleton Prospect", 4, seed, true);
  const mars = bareWorld("mars", "Eos Reach", 5, seed ^ 0x51ed, false);
  const start = pickLunaStart(luna.tiles);
  const index = indexTiles(luna.tiles);
  const neigh = neighborTiles(index, start.q, start.r);
  const open = neigh
    .filter((n) => n.terrain !== "polar" && n.ice < 40)
    .sort((a, b) => a.metal - b.metal);
  start.building = { type: "command", hp: 100, progress: 0, total: 0 };
  if (open[0]) open[0].building = { type: "solar", hp: 100, progress: 0, total: 1 };
  if (open[1]) open[1].building = { type: "pad", hp: 100, progress: 0, total: 2 };

  luna.stock = stockMul(
    { energy: 40, water: 58, oxygen: 82, food: 52, metals: 74, he3: 0, regolith: 26, propellant: 24 },
    diff.stock,
  );
  luna.pop = 14;
  luna.morale = diff.morale;

  const courier = SHIPS.courier;
  const state: GameState = {
    version: 1,
    id: `charter-${seed.toString(36)}`,
    seed,
    rng: (seed ^ 0xa5a5a5a5) >>> 0 || 1,
    seq: 10,
    turn: 1,
    difficulty,
    credits: diff.credits,
    worlds: { luna, mars },
    ships: [
      {
        id: "ship-1",
        name: "PAS Cinder",
        cls: "courier",
        loc: "luna",
        cargo: emptyCargo(),
        fuel: Math.min(courier.fuel, 12),
        crew: 2,
        hull: courier.hull,
        mission: null,
      },
    ],
    yard: [],
    deliveries: [],
    tech: { unlocked: [], current: null, progress: 0 },
    contract: null,
    events: [],
    log: [],
    founding: null,
    foreshadow: null,
    eventLastTurn: {},
    priceMul: 1,
    priceTurns: 0,
    earthLaunches: 0,
    script: {},
    outcome: null,
    stats: { crises: 0, launched: 0, he3Sold: 0, supplyRuns: 0 },
  };

  pushLog(state, "Charter sealed. Shackleton Prospect has a command module, one array, and a pad on the rim.", "good");
  pushLog(state, "Colony hull PAS Halcyon leaves the Earth yards on sol 5, as the Mars window opens.", "info");
  pushLog(state, "Food, water, and oxygen tick down every sol. An ice mine and a greenhouse are the first honest work.", "warn");
  return state;
}

export function worldOf(state: GameState, id: WorldId): World {
  return state.worlds[id];
}
