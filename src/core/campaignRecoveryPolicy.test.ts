import { chooseEvent, commissionShip, disembark, foundColony, launchShip, placeBuilding, queueResearch, repairBuilding, sellCargo, type ActionResult, type LaunchDraft } from "./actions";
import { ECONOMY_POLICY_MAX_ACTIONS } from "./campaignEconomyPolicy";
import { createRecoveryPolicyMemory, playRecoveryPolicy, RECOVERY_POLICY_ID, type RecoveryPolicyMemory } from "./campaignRecoveryPolicy";
import { assertCampaignInvariants, runCampaign } from "./campaignStudy";
import { loadFrom, saveTo } from "./save";
import { repairShip } from "./shipService";
import { applyTurn, blockingReason } from "./sim";
import { createGame } from "./state";
import { assert } from "./testAssert";
import type { BuildingId, GameState, ShipClass, TechId, WorldId } from "./types";
import type { CampaignAction } from "./campaignStudyPolicy";

function replay(game: GameState, action: CampaignAction): void {
  assert.equal(game.turn, action.sol);
  const [verb, a, b, json] = action.action.split(" ");
  let result: ActionResult;
  if (verb === "shiprepair") result = repairShip(game, a);
  else if (verb === "disembark") result = disembark(game, a);
  else if (verb === "sell") result = sellCargo(game, a);
  else if (verb === "research") result = queueResearch(game, a as TechId);
  else if (verb === "event") result = chooseEvent(game, b, a.split("/")[1]);
  else if (verb === "launch") result = launchShip(game, a, JSON.parse(json) as LaunchDraft);
  else if (verb === "commission") result = commissionShip(game, a.split("/")[1] as ShipClass, "earth");
  else {
    const [q, r] = b.split(",").map(Number);
    if (verb === "found") result = foundColony(game, q, r);
    else if (verb === "repair") result = repairBuilding(game, a as WorldId, q, r);
    else {
      assert.equal(verb, "build");
      const [world, type] = a.split("/");
      result = placeBuilding(game, world as WorldId, q, r, type as BuildingId);
    }
  }
  assert.ok(result.ok, `Unreplayable public action ${action.action}: ${result.reason}`);
  assertCampaignInvariants(game);
}

const cases = [1, 2, 3, 7, 17, 42];
let repairs = 0, landings = 0, passengerFlights = 0;
for (const difficulty of ["survey", "charter", "hardship"] as const) {
  for (const seed of cases) {
    const run = runCampaign({ policy: "recovery", difficulty, seed });
    assert.equal(run.report.policy, RECOVERY_POLICY_ID);
    const repeated = runCampaign({ policy: "recovery", difficulty, seed });
    assert.equal(JSON.stringify(repeated), JSON.stringify(run), "All successful and unsuccessful outcomes replay exactly");
    const shadow = createGame(difficulty, seed);
    let index = 0;
    for (let turn = 0; turn < run.report.turnsApplied; turn++) {
      let phaseActions = 0;
      while (run.report.actions[index]?.sol === shadow.turn) {
        const action = run.report.actions[index++];
        replay(shadow, action);
        phaseActions++;
      }
      assert.ok(phaseActions <= ECONOMY_POLICY_MAX_ACTIONS);
      assert.equal(blockingReason(shadow), null);
      applyTurn(shadow);
      assertCampaignInvariants(shadow);
    }
    assert.equal(index, run.report.actions.length);
    assert.equal(JSON.stringify(shadow), JSON.stringify(run.finalState), "Complete public-action replay matches final state, including RNG");
    const memory = run.policyMemory as RecoveryPolicyMemory;
    const repairActions = run.report.actions.filter(a => a.action.startsWith("shiprepair ")).length;
    const landingActions = run.report.actions.filter(a => a.action.startsWith("disembark ")).length;
    assert.equal(memory.repairs, repairActions);
    assert.ok(memory.passengersDelivered >= landingActions);
    repairs += repairActions;
    landings += landingActions;
    passengerFlights += memory.passengerFlights;
    if (run.report.outcome === "win") assert.ok(run.report.objectives.every(o => o.done));
    console.log(`${difficulty}/${seed}: ${run.report.outcome} sol ${run.report.sol}, repairs ${repairActions}, landed ${memory.passengersDelivered}, shortages ${run.report.worlds.luna.warnings.shortageSols + run.report.worlds.mars.warnings.shortageSols}`);
  }
}
assert.ok(repairs > 0, "The driver must exercise real paid dock repairs");
assert.ok(landings > 0, "The driver must exercise actual disembarkation");
assert.ok(passengerFlights > 0, "The driver must exercise new Earth hiring and passenger departure, not only the opening courier's extra crew");

const entries = new Map<string, string>();
const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage: Storage = {
  get length() { return entries.size; }, clear() { entries.clear(); },
  getItem(key) { return entries.get(key) ?? null; }, key(i) { return [...entries.keys()][i] ?? null; },
  removeItem(key) { entries.delete(key); }, setItem(key, value) { entries.set(key, value); },
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
let checkpoints = 0;
try {
  for (const difficulty of ["survey", "charter", "hardship"] as const) {
    const saved = runCampaign({ policy: "recovery", difficulty, seed: 3, checkpoint(value) {
      saveTo("slot2", value.game);
      const game = loadFrom("slot2");
      assert.ok(game, "Repair and crew states remain compatible with the real save validator");
      checkpoints++;
      return { game, policy: JSON.parse(JSON.stringify(value.policy)) };
    } });
    assert.equal(JSON.stringify(saved), JSON.stringify(runCampaign({ policy: "recovery", difficulty, seed: 3 })));
  }
} finally {
  if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
}
const capped = createGame("charter", 42);
const cappedMemory = createRecoveryPolicyMemory();
cappedMemory.base.actionSol = capped.turn;
cappedMemory.base.actionsThisSol = ECONOMY_POLICY_MAX_ACTIONS;
const cappedBefore = JSON.stringify(capped);
assert.match(playRecoveryPolicy(capped, cappedMemory).blocked!, /budget/);
assert.equal(JSON.stringify(capped), cappedBefore);
const terminal = createGame("charter", 42);
terminal.outcome = { kind: "victory" };
const terminalBefore = JSON.stringify(terminal);
assert.equal(playRecoveryPolicy(terminal, createRecoveryPolicyMemory()).blocked, null);
assert.equal(JSON.stringify(terminal), terminalBefore);
assert.equal(runCampaign({ policy: "recovery", difficulty: "charter", seed: 42, maxTurns: 0 }).report.turnsApplied, 0);
console.log(`recovery policy: 18 development runs + 18 exact repeats + public-action shadow replay, ${checkpoints} real save/reload checkpoints, ${repairs} repairs, ${landings} crew landings`);
