import { DIFF } from "./data";
import { applyChoice, enqueueEvent, maybeQueueEvent } from "./events";
import { nextRand } from "./rng";
import { createGame } from "./state";
import type { Difficulty, GameState } from "./types";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string): void {
  check(JSON.stringify(actual) === JSON.stringify(expected), message);
}
function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

for (const late of [false, true]) {
  for (const legacy of [false, true]) {
    const game = createGame("charter", 921);
    game.turn = late ? 20 : 9;
    if (late) game.tech.unlocked.push("he3extract");
    enqueueEvent(game, "contract");
    const offer = game.events[0]!;
    const deadline = late ? 36 : 21;
    equal(offer.contractDeadline, deadline, "offer persists its exact deadline");
    check(offer.body.includes(`by sol ${deadline}.`), "displayed deadline agrees");
    if (legacy) delete offer.contractDeadline;
    game.turn += 1;
    const loaded = clone(game);
    equal(applyChoice(loaded, offer.id, "accept"), null, "accept saved offer");
    equal(loaded.contract?.deadline, deadline, "acceptance does not extend deadline");
    equal(loaded.contract?.reward, late ? 520 : 280, "offer terms remain unchanged");
  }
}
const oldOffer = createGame("charter", 922);
oldOffer.turn = 10;
enqueueEvent(oldOffer, "contract");
delete oldOffer.events[0]!.contractDeadline;
oldOffer.events[0]!.body = "Legacy quota without a parseable date.";
applyChoice(oldOffer, oldOffer.events[0]!.id, "accept");
equal(oldOffer.contract?.deadline, 22, "undated legacy offers retain the old acceptance fallback");

const kinds = ["solar", "dust", "meteor", "shortage", "fever", "audit", "grant", "ice", "anomaly", "contract"];
function onlyWeather(kind: "solar" | "dust", turn = 10): GameState {
  const game = createGame("charter", 404);
  game.turn = turn;
  game.worlds.mars.founded = true;
  game.tech.unlocked.push("warning");
  game.eventLastTurn = Object.fromEntries(kinds.map((key) => [key, turn]));
  game.eventLastTurn[kind] = turn - 4;
  for (let rng = 1; ; rng++) {
    if (nextRand({ rng }) <= DIFF.charter.eventChance) { game.rng = rng; break; }
  }
  return game;
}
for (const kind of ["solar", "dust"] as const) {
  const game = onlyWeather(kind);
  maybeQueueEvent(game);
  equal(game.events, [], "a warning does not enqueue its hazard in the same call");
  equal(game.pendingWeather, { kind, dueTurn: 11 }, "weather has a one-sol due time");
  equal(game.foreshadow, kind, "warning technology reveals pending weather");
  const before = JSON.stringify(game);
  maybeQueueEvent(game);
  equal(JSON.stringify(game), before, "repeated same-sol calls neither reroll nor repeat warnings");
  const loaded = clone(game);
  loaded.turn++;
  const rng = loaded.rng;
  maybeQueueEvent(loaded);
  equal(loaded.events[0]?.kind, kind, "persisted weather arrives next sol");
  equal(loaded.rng, rng, "weather delivery consumes no RNG");
  equal(loaded.foreshadow, null, "delivered warning clears");
  equal(loaded.pendingWeather, null, "weather is consumed exactly once");
  equal(loaded.eventLastTurn?.[kind], 11, "cooldown starts on actual delivery");
}

const conflict = onlyWeather("solar", 8);
maybeQueueEvent(conflict);
conflict.turn = 9;
maybeQueueEvent(conflict);
equal(conflict.events[0]?.kind, "contract", "scripted quota is not lost to pending weather");
applyChoice(conflict, conflict.events[0]!.id, "decline");
conflict.turn++;
maybeQueueEvent(conflict);
equal(conflict.events[0]?.kind, "solar", "pending weather survives a blocking scripted offer");

const legacy = createGame("charter", 31);
legacy.turn = 10;
delete legacy.eventLastTurn;
legacy.foreshadow = "solar";
legacy.tech.unlocked.push("warning");
for (let rng = 1; ; rng++) {
  if (nextRand({ rng }) > DIFF.charter.eventChance) { legacy.rng = rng; break; }
}
const expectedRng = { rng: legacy.rng };
nextRand(expectedRng);
maybeQueueEvent(legacy);
equal(legacy.events, [], "legacy warning cannot bypass the event chance");
equal(legacy.pendingWeather, undefined, "failed chance schedules no weather");
equal(legacy.rng, expectedRng.rng, "visibility consumes no additional random draws");

let pairedTurns = 0;
let warnings = 0;
const observed = new Set<string>();
for (const difficulty of ["survey", "charter", "hardship"] as Difficulty[]) {
  for (let seed = 1; seed <= 16; seed++) {
    const hidden = createGame(difficulty, seed);
    hidden.worlds.mars.founded = true;
    hidden.worlds.mars.pop = 20;
    const visible = clone(hidden);
    visible.tech.unlocked.push("warning");
    for (let turn = 1; turn <= 120; turn++) {
      hidden.turn = visible.turn = turn;
      maybeQueueEvent(hidden);
      maybeQueueEvent(visible);
      equal(hidden.rng, visible.rng, "paired hazard RNG stays identical");
      equal(hidden.events, visible.events, "paired event frequency, kind and severity stay identical");
      equal(hidden.pendingWeather, visible.pendingWeather, "weather scheduling is technology-independent");
      const warned = visible.log.some((line) => line.turn === turn && line.text.startsWith("Early-warning net:"));
      if (warned) {
        warnings++;
        check(visible.events.length === 0, "warning and hazard are not simultaneous");
        check(visible.pendingWeather?.dueTurn === turn + 1, "warning leads its actual scheduled hazard");
      }
      const event = hidden.events[0];
      if (event) {
        observed.add(event.kind);
        const preferred: Record<string, string> = { solar: "ride", dust: "eva", meteor: "hit", contract: "decline" };
        const choice = event.choices.find((item) => item.id === preferred[event.kind] && !item.disabled)
          ?? event.choices.find((item) => !item.disabled)!;
        equal(applyChoice(hidden, event.id, choice.id), null, "hidden event resolves");
        equal(applyChoice(visible, event.id, choice.id), null, "visible event resolves");
      }
      equal(hidden.worlds, visible.worlds, "technology does not increase hazard damage");
      equal(hidden.ships, visible.ships, "technology does not change ship damage");
      equal(hidden.credits, visible.credits, "paired economic effects agree");
      equal(hidden.rng, visible.rng, "damage RNG stays identical");
      nextRand(hidden);
      nextRand(visible);
      pairedTurns++;
    }
  }
}
check(warnings > 0 && observed.has("solar") && observed.has("dust") && observed.has("meteor"), "paired trial exercises warnings and damaging hazards");
console.log(`events regressions: ok; ${pairedTurns} paired sols, ${warnings} warnings, ${observed.size} event kinds`);
