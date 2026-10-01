import { queueResearch } from "./actions";
import { enqueueEvent, maybeQueueEvent } from "./events";
import { createGame } from "./state";

function equal(actual: unknown, expected: unknown, message?: string): void { if (actual !== expected) throw new Error(message ?? `${String(actual)} !== ${String(expected)}`); }
function ok(value: unknown, message: string): void { if (!value) throw new Error(message); }
function notEqual(actual: unknown, expected: unknown, message: string): void { if (actual === expected) throw new Error(message); }

const state = createGame("charter", 424242);
const first = queueResearch(state, "pv");
equal(first.ok, true);
state.tech.progress = 7;
const same = queueResearch(state, "pv");
equal(same.ok, false);
equal(state.tech.progress, 7, "reselecting the current project must preserve progress");
const invalid = queueResearch(state, "not-a-tech" as never);
equal(invalid.ok, false);

const legacy = createGame("charter", 424243);
delete legacy.eventLastTurn;
legacy.turn = 2;
maybeQueueEvent(legacy);
equal(legacy.events[0]?.kind, "solar", "scripted sol 2 event survives a legacy save");
equal(legacy.eventLastTurn?.["solar"], 2);

const cooldown = createGame("charter", 424244);
cooldown.turn = 4;
enqueueEvent(cooldown, "solar");
equal(cooldown.eventLastTurn?.["solar"], 4);
cooldown.events = [];
cooldown.turn = 7;
cooldown.rng = 1;
for (let i = 0; i < 80 && !cooldown.events.length; i++) maybeQueueEvent(cooldown);
notEqual(cooldown.events[0]?.kind, "solar", "same event kind is ineligible for fewer than four sols");
const kinds = ["solar", "dust", "meteor", "shortage", "fever", "audit", "grant", "ice", "anomaly", "contract"];
function onlySolarAt(turn: number) {
  const game = createGame("charter", 103);
  game.turn = turn;
  game.eventLastTurn = Object.fromEntries(kinds.map((kind) => [kind, turn]));
  game.eventLastTurn.solar = 4;
  game.foreshadow = "solar";
  return game;
}
const tooSoon = onlySolarAt(7);
for (let i = 0; i < 80; i++) maybeQueueEvent(tooSoon);
equal(tooSoon.events.length, 0, "foreshadow must not resurrect a cooling-down event");
const ready = onlySolarAt(8);
for (let i = 0; i < 80 && !ready.events.length; i++) maybeQueueEvent(ready);
equal(ready.events[0]?.kind, "solar", "event becomes eligible at exactly four sols");
equal(ready.eventLastTurn?.solar, 8);

const scripted = createGame("charter", 144);
scripted.turn = 9;
scripted.eventLastTurn = { contract: 8 };
maybeQueueEvent(scripted);
equal(scripted.events[0]?.kind, "contract", "scripted contract bypasses random cooldown");

// Identical persisted seeds and event histories must give identical sequences.
const a = createGame("charter", 203);
const b = JSON.parse(JSON.stringify(a)) as typeof a;
const observed: Record<string, number> = {};
for (let turn = 10; turn < 160; turn++) {
  a.turn = b.turn = turn;
  maybeQueueEvent(a);
  maybeQueueEvent(b);
  equal(JSON.stringify(a.events), JSON.stringify(b.events), "seeded replay diverged");
  equal(a.rng, b.rng, "persisted RNG diverged");
  const kind = a.events[0]?.kind;
  if (kind) {
    ok(observed[kind] === undefined || turn - observed[kind]! >= 4, "random event repeated too soon");
    observed[kind] = turn;
  }
  a.events = [];
  b.events = [];
}
ok(Object.keys(observed).length >= 3, "replay must exercise varied events");

const locked = queueResearch(state, "fusion");
equal(locked.ok, false);
equal(state.tech.progress, 7, "rejected research must preserve progress");
equal(queueResearch(state, "eclss").ok, true);
equal(state.tech.progress, 0, "an approved new project starts at zero");

console.log("mechanics: ok");
