import {
  chooseEvent, commissionShip, foundColony, launchShip, placeBuilding,
  queueResearch, repairBuilding, sellCargo,
} from "./actions";
import type { ActionResult, LaunchDraft } from "./actions";
import {
  createEconomyPolicyMemory, ECONOMY_POLICY_ID, ECONOMY_POLICY_LIMITATIONS,
  ECONOMY_POLICY_MAX_ACTIONS, playEconomyPolicy,
} from "./campaignEconomyPolicy";
import type { EconomyPolicyMemory } from "./campaignEconomyPolicy";
import { createCampaignPolicyMemory, playCampaignPolicy } from "./campaignStudyPolicy";
import type { CampaignAction, CampaignPolicyMemory, PolicyDecision } from "./campaignStudyPolicy";
import { CAPSTONES, CARGO_IDS, DIFF, SHIPS } from "./data";
import { applyTurn, blockingReason, forecast, objectives, storageCap } from "./sim";
import { createGame } from "./state";
import { assert } from "./testAssert";
import { RESOURCES } from "./types";
import type { BuildingId, Difficulty, GameState, ShipClass, TechId, WorldId } from "./types";

// Development cases only. The parent's reserved holdout seeds are intentionally absent.
const SEEDS = [1, 2, 3, 7, 17, 42] as const;
const MODES = ["survey", "charter", "hardship"] as const;
const TURN_BUDGET = 90;
const WORLDS = ["luna", "mars"] as const;

function equal(actual: unknown, expected: unknown, label: string): void {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);
}

function invariant(game: GameState): void {
  assert.ok(Number.isFinite(game.credits), "Credits must be finite; legal overdraft/debt is not a resource error");
  for (const id of WORLDS) {
    const world = game.worlds[id];
    const cap = storageCap(game, world);
    assert.ok(Number.isInteger(world.pop) && world.pop >= 0);
    assert.ok(Number.isFinite(world.morale) && world.morale >= 0 && world.morale <= 100);
    for (const k of RESOURCES) {
      assert.ok(Number.isFinite(world.stock[k]) && world.stock[k] >= 0, `${id}/${k} nonnegative, finite stock`);
      assert.ok(world.stock[k] <= cap[k] + 1e-6, `${id}/${k} storage cap`);
    }
    for (const tile of world.tiles) {
      if (!tile.building) continue;
      assert.ok(tile.building.hp >= 0 && tile.building.hp <= 100);
      assert.ok(tile.building.progress >= 0 && tile.building.progress <= tile.building.total);
    }
    const f = forecast(game, id);
    for (const k of RESOURCES) {
      assert.ok(Number.isFinite(f.net[k]));
      assert.ok(Number.isFinite(f.demand[k]) && f.demand[k] >= 0);
      assert.ok(Number.isFinite(f.produced[k]) && f.produced[k] >= 0);
    }
  }
  for (const ship of game.ships) {
    const def = SHIPS[ship.cls];
    assert.ok(Number.isFinite(ship.fuel) && ship.fuel >= 0 && ship.fuel <= def.fuel);
    assert.ok(Number.isInteger(ship.crew) && ship.crew >= 0 && ship.crew <= def.crew);
    assert.ok(ship.hull > 0 && ship.hull <= def.hull);
    let total = 0;
    for (const k of CARGO_IDS) {
      assert.ok(Number.isFinite(ship.cargo[k]) && ship.cargo[k] >= 0);
      total += ship.cargo[k];
    }
    assert.ok(total <= def.cargo + 1e-6);
  }
}

/** Independently replay the callback receipt; equality also catches unreported state edits. */
function replay(game: GameState, action: CampaignAction): void {
  assert.equal(action.sol, game.turn);
  const [verb, a, b, json] = action.action.split(" ");
  let result: ActionResult;
  if (verb === "event") result = chooseEvent(game, b!, a!.split("/")[1]!);
  else if (verb === "research") result = queueResearch(game, a as TechId);
  else if (verb === "sell") result = sellCargo(game, a!);
  else if (verb === "launch") result = launchShip(game, a!, JSON.parse(json!) as LaunchDraft);
  else if (verb === "commission") {
    const [loc, cls] = a!.split("/");
    assert.equal(loc, "earth");
    result = commissionShip(game, cls as ShipClass, "earth");
  } else {
    const [q, r] = b!.split(",").map(Number);
    if (verb === "found") result = foundColony(game, q!, r!);
    else if (verb === "repair") result = repairBuilding(game, a as WorldId, q!, r!);
    else {
      assert.equal(verb, "build");
      const [id, type] = a!.split("/");
      result = placeBuilding(game, id as WorldId, q!, r!, type as BuildingId);
    }
  }
  assert.ok(result.ok, `Receipt must replay through public action: ${action.action}: ${result.reason}`);
}

interface Run {
  game: GameState;
  memory: CampaignPolicyMemory | EconomyPolicyMemory;
  actions: CampaignAction[];
  decisions: PolicyDecision[];
  turns: number;
  maxActions: number;
  minimumCredits: number;
  shortageSols: number;
  exportCredits: number;
  firstSale: number | null;
  commissioned: number;
}

function run(difficulty: Difficulty, seed: number, pilot = true, checkpoints = false): Run {
  let game = createGame(difficulty, seed);
  let memory: CampaignPolicyMemory | EconomyPolicyMemory = pilot ? createEconomyPolicyMemory() : createCampaignPolicyMemory();
  let shadow = structuredClone(game);
  const result: Run = {
    game, memory, actions: [], decisions: [], turns: 0, maxActions: 0,
    minimumCredits: game.credits, shortageSols: 0, exportCredits: 0, firstSale: null, commissioned: 0,
  };
  invariant(game);
  while (result.turns < TURN_BUDGET && !game.outcome) {
    let actionsThisPhase = 0;
    const beforeCredits = (): void => { result.minimumCredits = Math.min(result.minimumCredits, game.credits); };
    const afterAction = (action: CampaignAction): void => {
      actionsThisPhase++;
      assert.ok(actionsThisPhase <= (pilot ? ECONOMY_POLICY_MAX_ACTIONS : 256));
      if (pilot) {
        const credits = shadow.credits;
        replay(shadow, action);
        equal(game, shadow, `Every mutation must match public receipt at ${difficulty}/${seed} ${action.action}`);
        if (action.action.startsWith("sell ")) {
          result.exportCredits += game.credits - credits;
          result.firstSale ??= game.turn;
        }
      }
      if (action.action.startsWith("commission ")) result.commissioned++;
      invariant(game);
      beforeCredits();
      result.actions.push(action);
    };
    const decision = pilot ? playEconomyPolicy(game, memory as EconomyPolicyMemory, afterAction) : playCampaignPolicy(game, memory, afterAction);
    result.decisions.push(decision);
    result.maxActions = Math.max(result.maxActions, actionsThisPhase);
    invariant(game);
    if (pilot) equal(game, shadow, "No unreported mutation after the final callback");
    if (decision.blocked) break;
    assert.equal(blockingReason(game), null, "Events and founding must be resolved before a turn");
    for (const id of WORLDS) {
      const f = forecast(game, id);
      if (f.foodShortage || f.waterShortage || f.o2Shortage) result.shortageSols++;
    }
    applyTurn(game);
    if (pilot) {
      applyTurn(shadow);
      equal(game, shadow, "Public actions preserve RNG and subsequent simulation exactly");
    }
    result.turns++;
    invariant(game);
    beforeCredits();
    if (checkpoints) {
      const checkpoint = JSON.parse(JSON.stringify({ game, memory })) as { game: GameState; memory: CampaignPolicyMemory | EconomyPolicyMemory };
      game = checkpoint.game;
      memory = checkpoint.memory;
      shadow = structuredClone(game);
    }
  }
  result.game = game;
  result.memory = memory;
  if (game.outcome?.kind === "victory") assert.ok(objectives(game).every(o => o.done));
  if (!game.outcome && !result.decisions.at(-1)?.blocked) assert.equal(result.turns, TURN_BUDGET);
  return result;
}

const started = performance.now();
const pilots: Run[] = [];
const baselines: Run[] = [];
assert.notEqual(ECONOMY_POLICY_ID, "survey-industry-baseline-v1");
assert.ok(ECONOMY_POLICY_LIMITATIONS.some(line => line.includes("winnability")));
const fresh = createEconomyPolicyMemory();
fresh.industrySeen.push("luna/robotics");
equal(createEconomyPolicyMemory().industrySeen, [], "Independent memory instances");

for (const difficulty of MODES) {
  for (const seed of SEEDS) {
    const pilot = run(difficulty, seed);
    const repeated = run(difficulty, seed, true, true);
    equal(repeated, pilot, `${difficulty}/${seed}: full deterministic replay, including JSON checkpoint continuation`);
    const baseline = run(difficulty, seed, false);
    pilots.push(pilot);
    baselines.push(baseline);
    assert.equal(baseline.game.stats.he3Sold, 0, "Independent baseline still never trades");
    assert.equal(pilot.decisions.some(d => d.blocked), false, "Development pilot must not exhaust a planning budget");
    assert.ok(pilot.game.stats.he3Sold > 0, "Development pilot must demonstrate a real Earth sale");
    assert.ok(pilot.exportCredits > 0 && pilot.firstSale !== null);
    assert.ok(pilot.maxActions <= ECONOMY_POLICY_MAX_ACTIONS);
    const memory = pilot.memory as EconomyPolicyMemory;
    assert.equal(memory.policyId, ECONOMY_POLICY_ID);
    assert.ok((memory.commissions ?? 0) <= DIFF[difficulty].ships + 2);
    assert.ok((memory.foundingLaunches ?? 0) <= 2);
    assert.ok(new Set(pilot.memory.industrySeen).size === pilot.memory.industrySeen.length);
  }
}

// No caller-side changes to stock, unlocks, turns or RNG are used to obtain these results.
for (const difficulty of MODES) {
  const group = pilots.filter(p => p.game.difficulty === difficulty);
  const baseline = baselines.filter(p => p.game.difficulty === difficulty);
  assert.ok(group.some(p => p.game.worlds.mars.founded), `${difficulty}: actual expansion`);
  assert.ok(group.some(p => CAPSTONES.some(id => p.game.tech.unlocked.includes(id)) && p.game.tech.unlocked.length >= DIFF[difficulty].techs));
  if (difficulty !== "survey") {
    assert.ok(group.some(p => p.commissioned > 0 && p.game.ships.length >= DIFF[difficulty].ships), `${difficulty}: delivered commissioned hulls`);
    assert.ok(group.some(p => forecast(p.game, "luna").housing >= DIFF[difficulty].lunaPop), `${difficulty}: beyond baseline housing cap`);
  }
  const sum = (runs: Run[], f: (run: Run) => number): number => runs.reduce((n, r) => n + f(r), 0);
  const population = (p: Run): number => p.game.worlds.luna.pop + p.game.worlds.mars.pop;
  console.log(`${difficulty} terminal population totals: baseline=${sum(baseline, population)}, economy=${sum(group, population)}; different stopping sols, not a matched-time comparison`);
}

// Hidden state is unreadable to planning; public actions retain ownership of RNG mutations.
const opaque = createGame("charter", 42);
const opaqueMemory: EconomyPolicyMemory = { policyId: ECONOMY_POLICY_ID, industrySeen: [] };
const expected = structuredClone(opaque);
playEconomyPolicy(expected, createEconomyPolicyMemory());
for (const key of ["seed", "rng", "pendingWeather", "foreshadow"] as const) {
  Object.defineProperty(opaque, key, { configurable: true, get() { throw new Error(`Hidden state read: ${key}`); } });
}
playEconomyPolicy(opaque, opaqueMemory);
for (const key of ["seed", "rng", "pendingWeather", "foreshadow"] as const) {
  if (key in expected) Object.defineProperty(opaque, key, { configurable: true, writable: true, enumerable: true, value: expected[key] });
  else Reflect.deleteProperty(opaque, key);
}
equal(opaque, expected, "Planning does not inspect hidden state or depend on seed labels");

// Exhausted action budget must stop before mutation, survive serialization, and renew next sol.
const budgetGame = createGame("survey", 1);
let budgetMemory = createEconomyPolicyMemory();
budgetMemory.actionSol = budgetGame.turn;
budgetMemory.actionsThisSol = ECONOMY_POLICY_MAX_ACTIONS;
budgetMemory = JSON.parse(JSON.stringify(budgetMemory)) as EconomyPolicyMemory;
const budgetBefore = structuredClone(budgetGame);
let budgetCallbacks = 0;
assert.match(playEconomyPolicy(budgetGame, budgetMemory, () => budgetCallbacks++).blocked ?? "", /budget/);
equal(budgetGame, budgetBefore, "Action budget is checked before mutation");
assert.equal(budgetCallbacks, 0);
applyTurn(budgetGame);
playEconomyPolicy(budgetGame, budgetMemory, () => budgetCallbacks++);
assert.ok(budgetCallbacks > 0 && budgetCallbacks <= ECONOMY_POLICY_MAX_ACTIONS);

const phaseGame = createGame("charter", 17);
const phaseMemory = createEconomyPolicyMemory();
let phaseCallbacks = 0;
for (let call = 0; call < 5; call++) {
  playEconomyPolicy(phaseGame, phaseMemory, () => phaseCallbacks++);
  invariant(phaseGame);
  assert.equal(phaseMemory.actionsThisSol, phaseCallbacks, "Same-sol calls share their persisted action budget");
}
assert.ok(phaseCallbacks <= ECONOMY_POLICY_MAX_ACTIONS);

// A terminal state, reached by public simulation, is a pure no-op including memory.
const terminal = pilots.find(p => p.game.outcome);
if (terminal) {
  const game = structuredClone(terminal.game);
  const memory = structuredClone(terminal.memory) as EconomyPolicyMemory;
  const before = JSON.stringify({ game, memory });
  equal(playEconomyPolicy(game, memory, () => { throw new Error("Terminal callback"); }), { blocked: null, deferred: [] }, "Terminal decision");
  assert.equal(JSON.stringify({ game, memory }), before);
}

console.log("policy mode seed effective outcome sols he3Sold exportCredits credits minCredits popL/M housingL/M ships commissioned techs shortageWorldSols maxActions");
for (let i = 0; i < pilots.length; i++) {
  for (const [label, p] of [["baseline", baselines[i]!], ["economy", pilots[i]!]] as const) {
    const g = p.game;
    console.log(`${label} ${g.difficulty} ${SEEDS[i % SEEDS.length]} ${g.seed} ${g.outcome?.kind ?? "turn-limit"} ${p.turns} ${g.stats.he3Sold.toFixed(1)} ${p.exportCredits.toFixed(0)} ${g.credits.toFixed(0)} ${p.minimumCredits.toFixed(0)} ${g.worlds.luna.pop}/${g.worlds.mars.pop} ${forecast(g, "luna").housing}/${forecast(g, "mars").housing} ${g.ships.length} ${p.commissioned} ${g.tech.unlocked.length} ${p.shortageSols} ${p.maxActions}`);
    if (label === "economy" && !g.outcome) {
      console.log(`Unresolved ${g.difficulty}/${SEEDS[i % SEEDS.length]}: ${objectives(g).filter(o => !o.done).map(o => `${o.id}: ${o.progress}`).join("; ")}. Last deferrals: ${JSON.stringify(p.decisions.at(-1)?.deferred)}`);
    }
  }
}
console.log(`economy pilot: 18 development + 18 replay/checkpoint + 18 independent baseline runs, ${TURN_BUDGET}-turn cap; ${((performance.now() - started) / 1000).toFixed(2)}s`);
console.log(`Policy limitations: ${ECONOMY_POLICY_LIMITATIONS.join(" ")}`);
