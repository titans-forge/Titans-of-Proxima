import { applyChoice, enqueueEvent, maybeQueueEvent } from "./events";
import { listSlots, loadFrom, saveTo } from "./save";
import { createGame } from "./state";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string): void {
  check(JSON.stringify(actual) === JSON.stringify(expected), message);
}
const prefix = "proxima-astra:v1:";
const entries = new Map<string, string>();
let writes = 0;
let deletes = 0;
const storage: Storage = {
  get length() { return entries.size; },
  clear() { deletes++; entries.clear(); },
  getItem(key) { return entries.get(key) ?? null; },
  key(index) { return [...entries.keys()][index] ?? null; },
  removeItem(key) { deletes++; entries.delete(key); },
  setItem(key, value) { writes++; entries.set(key, value); },
};
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
let rejected = 0;
try {
  for (const difficulty of ["survey", "charter", "hardship"] as const) {
    const game = createGame(difficulty, 120);
    game.credits = -12.5;
    saveTo("slot1", game);
    equal(loadFrom("slot1"), game, "valid states round-trip, including negative credits");
    equal(listSlots()[0]?.difficulty, difficulty, "slot metadata agrees with loaded state");
  }
  const legacy = createGame("charter", 121);
  delete legacy.eventLastTurn;
  legacy.turn = 9;
  enqueueEvent(legacy, "contract");
  delete legacy.eventLastTurn;
  delete legacy.events[0]!.contractDeadline;
  legacy.turn = 10;
  entries.set(prefix + "slot1", JSON.stringify({ state: legacy }));
  const loadedLegacy = loadFrom("slot1");
  check(loadedLegacy, "original v1 without new optional fields or timestamp loads");
  equal(listSlots()[0]?.at, 0, "missing legacy timestamp defaults to zero");
  applyChoice(loadedLegacy, loadedLegacy.events[0]!.id, "accept");
  equal(loadedLegacy.contract?.deadline, 21, "loaded legacy offer honors its displayed deadline");

  const rich = createGame("charter", 122);
  rich.turn = 20;
  rich.tech.unlocked = ["shelters", "warning"];
  rich.tech.current = "fission";
  rich.pendingWeather = { kind: "solar", dueTurn: 21 };
  rich.foreshadow = "solar";
  rich.ships[0]!.loc = "transit";
  rich.ships[0]!.mission = { from: "luna", to: "mars", eta: 2, total: 4, risk: 0.2, founding: false, burn: 4 };
  rich.yard.push({ id: "yard-1", cls: "colony", loc: "earth", eta: 3, name: "Future" });
  rich.deliveries.push({ id: "drop-1", dest: "luna", eta: 2, cargo: { oxygen: 2 } });
  rich.contract = { id: "con-1", title: "Quota", detail: "A quota", need: { metals: 22 }, reward: 280, deadline: 32 };
  saveTo("slot1", rich);
  equal(loadFrom("slot1"), rich, "active nested simulation data round-trips");
  const pending = loadFrom("slot1")!;
  pending.turn++;
  maybeQueueEvent(pending);
  equal(pending.events[0]?.kind, "solar", "saved weather delivers after reload");
  for (const outcome of [{ kind: "victory" }, { kind: "defeat", reason: "Charter closed" }] as const) {
    rich.outcome = outcome;
    saveTo("slot1", rich);
    equal(loadFrom("slot1")?.outcome, outcome, "completed v1 games remain readable");
  }

  function rejectRaw(raw: string, label: string): void {
    entries.set(prefix + "slot2", raw);
    const writesBefore = writes;
    equal(loadFrom("slot2"), null, `${label}: rejected on load`);
    check(!listSlots().some((slot) => slot.slot === "slot2"), `${label}: excluded from list`);
    equal(entries.get(prefix + "slot2"), raw, `${label}: original slot retained`);
    equal(writes, writesBefore, `${label}: no storage rewrite`);
    equal(deletes, 0, `${label}: no deletion`);
    rejected++;
  }
  for (const value of [null, [], {}, { state: { version: 1, worlds: { luna: {} } } }, { state: { version: 2 } }]) {
    rejectRaw(JSON.stringify(value), "malformed root");
  }
  rejectRaw("{broken", "invalid JSON");

  const invalidFields: [string[], unknown][] = [
    [["turn"], "10"], [["turn"], 1.5], [["difficulty"], "unknown"], [["rng"], -1],
    [["worlds", "mars"], undefined], [["worlds", "luna", "tiles"], []],
    [["worlds", "luna", "stock", "water"], undefined], [["worlds", "luna", "pop"], null],
    [["worlds", "mars", "id"], "luna"], [["worlds", "luna", "tiles", "0", "terrain"], "unknown"],
    [["worlds", "luna", "tiles", "0", "building"], { type: "unknown", hp: 100, progress: 0, total: 0 }],
    [["ships", "0", "cls"], "unknown"], [["ships", "0", "cargo", "food"], undefined],
    [["ships", "0", "mission", "to"], "venus"], [["ships", "0", "mission", "risk"], 2],
    [["tech", "unlocked"], ["unknown"]], [["tech", "current"], "unknown"], [["script", "solar"], 1],
    [["eventLastTurn", "solar"], "2"], [["pendingWeather", "kind"], "meteor"],
    [["pendingWeather", "dueTurn"], 0], [["foreshadow"], "meteor"],
    [["events"], [{ id: "ev", kind: "solar", title: "Storm", body: "Storm", choices: [] }]],
    [["log", "0", "tone"], "invalid"], [["deliveries", "0", "cargo"], { energy: 1 }],
    [["founding"], { world: "mars" }], [["outcome"], { kind: "defeat" }],
    [["contract", "deadline"], null], [["stats", "crises"], undefined],
  ];
  for (const [path, value] of invalidFields) {
    const state = JSON.parse(JSON.stringify(rich)) as Record<string, unknown>;
    let parent = state;
    for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
    parent[path[path.length - 1]!] = value;
    rejectRaw(JSON.stringify({ at: 1, state }), path.join("."));
  }

  // JSON permits exponents that overflow JS numbers; stringify alone would mask these as null.
  const finitePaths = [
    ["credits"], ["worlds", "luna", "stock", "food"], ["worlds", "luna", "tiles", "0", "ice"],
    ["ships", "0", "fuel"], ["ships", "0", "mission", "burn"], ["tech", "progress"],
    ["contract", "reward"], ["deliveries", "0", "cargo", "oxygen"], ["stats", "he3Sold"],
  ];
  for (const path of finitePaths) {
    const state = JSON.parse(JSON.stringify(rich)) as Record<string, unknown>;
    let parent = state;
    for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
    parent[path[path.length - 1]!] = "OVERFLOW";
    rejectRaw(JSON.stringify({ at: 1, state }).replace('"OVERFLOW"', "1e400"), `${path.join(".")} infinity`);
  }
  rejectRaw(JSON.stringify({ state: rich, at: "OVERFLOW" }).replace('"OVERFLOW"', "1e400"), "timestamp infinity");
  equal(listSlots().length, 1, "valid slots remain listed beside corrupt data");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("storage unavailable"); } });
  equal(loadFrom("slot1"), null, "unavailable storage fails closed");
  equal(listSlots(), [], "unavailable storage returns no slots");
  console.log(`save regressions: ok; ${rejected} corrupt payloads rejected without deletion`);
} finally {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
}
