import type { Difficulty, GameState } from "./types";
import { BUILDING_IDS, RESOURCES, TECH_IDS } from "./types";

const PREFIX = "proxima-astra:v1:";

export interface Meta {
  muted: boolean;
  anim: number;
  tutorialSeen: boolean;
}

export interface SlotInfo {
  slot: string;
  turn: number;
  difficulty: Difficulty;
  at: number;
  seed: number;
}

const SLOTS = ["autosave", "slot1", "slot2", "slot3"] as const;
export type SlotId = (typeof SLOTS)[number];

type Check = (value: unknown) => boolean;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite: Check = (value) => typeof value === "number" && Number.isFinite(value);
const nonnegative: Check = (value) => finite(value) && (value as number) >= 0;
const integer: Check = (value) => Number.isSafeInteger(value);
const count: Check = (value) => integer(value) && nonnegative(value);
const positiveInteger: Check = (value) => count(value) && (value as number) > 0;
const text: Check = (value) => typeof value === "string";
const id: Check = (value) => text(value) && (value as string).length > 0;
const boolean: Check = (value) => typeof value === "boolean";
const oneOf = (values: readonly unknown[]): Check => (value) => values.includes(value);
const optional = (check: Check): Check => (value) => value === undefined || check(value);
const nullable = (check: Check): Check => (value) => value === null || check(value);
const arrayOf = (check: Check): Check => (value) => Array.isArray(value) && value.every(check);
const objectOf = (fields: Record<string, Check>): Check => (value) =>
  record(value) && Object.entries(fields).every(([key, check]) => check(value[key]));
const recordOf = (check: Check): Check => (value) => record(value) && Object.values(value).every(check);
const cargoIds = RESOURCES.filter((key) => key !== "energy");
const quantities = (keys: readonly string[], partial = false): Check => (value) =>
  record(value) && (partial || keys.every((key) => nonnegative(value[key]))) &&
  Object.entries(value).every(([key, amount]) => keys.includes(key) && nonnegative(amount));
const worldId = oneOf(["luna", "mars"]);
const location = oneOf(["earth", "luna", "mars"]);
const shipClass = oneOf(["courier", "freighter", "colony", "tanker"]);
const weatherKind = oneOf(["solar", "dust"]);
const eventKind = oneOf(["solar", "dust", "meteor", "contract", "shortage", "fever", "audit", "grant", "ice", "anomaly"]);
const placed = objectOf({ type: oneOf(BUILDING_IDS), hp: nonnegative, progress: count, total: count });
const tile = objectOf({
  q: integer, r: integer,
  terrain: oneOf(["mare", "highland", "crater", "polar", "rille", "plain", "canyon", "dust", "volcano"]),
  ice: nonnegative, metal: nonnegative, he3: nonnegative, regolith: nonnegative,
  variant: finite, building: nullable(placed),
});
const world = objectOf({
  id: worldId, name: text, radius: positiveInteger, founded: boolean,
  tiles: (value) => arrayOf(tile)(value) && (value as unknown[]).length > 0,
  stock: quantities(RESOURCES), pop: count, morale: finite, growth: finite,
  lowMorale: count, streak: count, dust: count, shelter: count, radiation: count,
  quarantine: count, foundedTurn: nullable(positiveInteger), launches: count,
  warnO2: boolean, warnFood: boolean, warnWater: boolean,
});
const mission = objectOf({
  from: location, to: location, eta: positiveInteger, total: positiveInteger,
  risk: (value) => nonnegative(value) && (value as number) <= 1,
  founding: boolean, burn: nonnegative,
});
const ship = objectOf({
  id, name: text, cls: shipClass, loc: oneOf(["earth", "luna", "mars", "transit"]),
  cargo: quantities(cargoIds), fuel: nonnegative, crew: count, hull: finite,
  mission: nullable(mission),
});
const event = objectOf({
  id, kind: eventKind, title: text, body: text,
  choices: (value) => arrayOf(objectOf({ id, label: text, detail: text, disabled: optional(boolean) }))(value) &&
    (value as unknown[]).length > 0,
  contractDeadline: optional(positiveInteger),
});
const gameState = objectOf({
  version: oneOf([1]), id, seed: positiveInteger,
  rng: (value) => count(value) && (value as number) <= 0xffffffff,
  seq: count, turn: positiveInteger, difficulty: oneOf(["survey", "charter", "hardship"]), credits: finite,
  worlds: objectOf({
    luna: (value) => world(value) && (value as Record<string, unknown>).id === "luna",
    mars: (value) => world(value) && (value as Record<string, unknown>).id === "mars",
  }),
  ships: arrayOf(ship),
  yard: arrayOf(objectOf({ id, cls: shipClass, loc: location, eta: positiveInteger, name: text })),
  deliveries: arrayOf(objectOf({ id, dest: worldId, eta: positiveInteger, cargo: quantities(cargoIds, true) })),
  tech: objectOf({ unlocked: arrayOf(oneOf(TECH_IDS)), current: nullable(oneOf(TECH_IDS)), progress: nonnegative }),
  contract: nullable(objectOf({
    id, title: text, detail: text, need: quantities(cargoIds, true), reward: nonnegative, deadline: positiveInteger,
  })),
  events: arrayOf(event),
  log: arrayOf(objectOf({ turn: positiveInteger, text, tone: oneOf(["info", "good", "bad", "warn"]) })),
  founding: nullable(objectOf({ shipId: id, world: worldId })),
  foreshadow: nullable(weatherKind),
  pendingWeather: optional(nullable(objectOf({ kind: weatherKind, dueTurn: positiveInteger }))),
  eventLastTurn: optional(recordOf(count)),
  priceMul: nonnegative, priceTurns: count, earthLaunches: count,
  script: recordOf(boolean),
  outcome: nullable((value) => objectOf({ kind: oneOf(["victory"]) })(value) ||
    objectOf({ kind: oneOf(["defeat"]), reason: text })(value)),
  stats: objectOf({ crises: count, launched: count, he3Sold: nonnegative, supplyRuns: count }),
});

function readSlot(slot: SlotId): { at: number; state: GameState } | null {
  try {
    const raw = localStorage.getItem(PREFIX + slot);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // New v1 fields are optional; core simulation data is never fabricated.
    if (!record(parsed) || !gameState(parsed.state) || !optional(nonnegative)(parsed.at)) return null;
    return { at: (parsed.at as number | undefined) ?? 0, state: parsed.state as GameState };
  } catch {
    return null;
  }
}

export function saveTo(slot: SlotId, state: GameState): void {
  localStorage.setItem(PREFIX + slot, JSON.stringify({ at: Date.now(), state }));
}

export function loadFrom(slot: SlotId): GameState | null {
  return readSlot(slot)?.state ?? null;
}

export function listSlots(): SlotInfo[] {
  const out: SlotInfo[] = [];
  for (const slot of SLOTS) {
    const parsed = readSlot(slot);
    if (parsed) {
      out.push({
        slot,
        turn: parsed.state.turn,
        difficulty: parsed.state.difficulty,
        at: parsed.at,
        seed: parsed.state.seed,
      });
    }
  }
  return out;
}

export function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(PREFIX + "meta");
    if (!raw) return { muted: false, anim: 1, tutorialSeen: false };
    const parsed = JSON.parse(raw) as Partial<Meta>;
    return {
      muted: !!parsed.muted,
      anim: parsed.anim === 0.65 || parsed.anim === 1.8 ? parsed.anim : 1,
      tutorialSeen: !!parsed.tutorialSeen,
    };
  } catch {
    return { muted: false, anim: 1, tutorialSeen: false };
  }
}

export function saveMeta(meta: Meta): void {
  localStorage.setItem(PREFIX + "meta", JSON.stringify(meta));
}
