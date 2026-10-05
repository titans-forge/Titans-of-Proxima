import {
  assertCampaignInvariants, CAMPAIGN_STUDY_MODES, CAMPAIGN_STUDY_SEEDS,
  CAMPAIGN_STUDY_TURNS, formatCampaignStudy, runCampaign, runCampaignStudy,
} from "./campaignStudy";
import type { CampaignCheckpoint, CampaignRun } from "./campaignStudy";
import { STUDY_INDUSTRIES, STUDY_WORLDS } from "./campaignStudyPolicy";
import { loadFrom, saveTo } from "./save";
import { assert } from "./testAssert";
import { RESOURCES } from "./types";

function equal(actual: unknown, expected: unknown, message: string): void {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

function rejects(fn: () => unknown, pattern: RegExp): void {
  let error: unknown;
  try { fn(); } catch (caught) { error = caught; }
  assert.ok(error instanceof Error, "Expected a bounded-study input error");
  assert.match(error.message, pattern);
}

const started = performance.now();
const study = runCampaignStudy();
assert.equal(study.runs.length, 36, "Twelve preselected seeds in each of three modes");
assert.equal(study.summary.length, 3);
assert.equal(new Set(study.runs.map(run => `${run.report.difficulty}/${run.report.requestedSeed}`)).size, 36);
assert.ok(study.limitations.some(line => line.includes("not an optimal-play")));

function verifyRun(run: CampaignRun): void {
  const r = run.report;
  const label = `${r.difficulty}/${r.requestedSeed}`;
  assertCampaignInvariants(run.finalState, label);
  assert.equal(r.effectiveSeed, run.finalState.seed);
  assert.equal(r.effectiveSeed, r.requestedSeed + Math.round((r.effectiveSeed - r.requestedSeed) / 17) * 17, "Report map retry seed");
  assert.ok(r.effectiveSeed >= r.requestedSeed && r.effectiveSeed <= r.requestedSeed + 15 * 17);
  assert.ok(r.turnsApplied <= r.maxTurns);
  assert.ok(r.invariantChecks >= r.turnsApplied * 2 + r.actions.length + 1);
  assert.ok(r.minimumCredits <= r.credits && r.credits <= r.maximumCredits);
  assert.notEqual(r.termination, "blocked", `${label}: legal policy must resolve observed event/founding blockers`);
  if (r.outcome === "win") {
    assert.equal(run.finalState.outcome?.kind, "victory");
    assert.ok(r.objectives.every(o => o.done), `${label}: never manufacture a win`);
    assert.equal(r.sol, r.lastResolvedSol);
  } else if (r.outcome === "loss") {
    assert.equal(run.finalState.outcome?.kind, "defeat");
    assert.ok(run.finalState.outcome?.kind === "defeat" && r.reason === run.finalState.outcome.reason);
    assert.equal(r.sol, r.lastResolvedSol);
  } else {
    assert.equal(run.finalState.outcome, null);
    assert.equal(r.termination, "turn-limit");
    assert.equal(r.turnsApplied, r.maxTurns);
    assert.equal(r.sol, r.turnsApplied + 1, "A nonterminal turn advances the displayed sol");
  }
  const seen = [];
  for (const id of STUDY_WORLDS) {
    const w = r.worlds[id];
    equal(w.stock, run.finalState.worlds[id].stock, `${label} final ${id} resources`);
    assert.equal(w.population, run.finalState.worlds[id].pop);
    assert.ok(w.resolvedSols <= r.turnsApplied);
    if (w.foundedSol !== null) {
      assert.ok(w.minimumStock && w.maximumStock);
      assert.ok(w.minimumPopulation !== null && w.maximumPopulation !== null);
      assert.ok(w.minimumPopulation <= w.population && w.population <= w.maximumPopulation);
      for (const resource of RESOURCES) {
        assert.ok(Number.isFinite(w.minimumStock[resource]) && w.minimumStock[resource] >= 0);
        assert.ok(w.minimumStock[resource] <= w.stock[resource] && w.stock[resource] <= w.maximumStock[resource]);
        assert.ok(w.stock[resource] <= w.capacity[resource] + 1e-6);
      }
    } else {
      assert.equal(w.minimumStock, null, "Unfounded zeroes must not corrupt stock minima");
      assert.equal(w.minimumPopulation, null);
    }
    for (const [key, value] of Object.entries(w.warnings)) {
      assert.ok(Number.isInteger(value) && value >= 0, `${label} ${id}/${key}`);
      if (key !== "forecastDeaths") assert.ok(value <= w.resolvedSols, "Count warning sols, not forecast calls");
    }
    for (const type of STUDY_INDUSTRIES) {
      const industry = w.industry[type];
      assert.equal(Object.values(industry.statusSols).reduce((a, b) => a + b, 0), w.resolvedSols);
      assert.equal(industry.operatingSols, industry.statusSols.operating);
      assert.equal(industry.firstOperatingSol === null, industry.operatingSols === 0);
      if (industry.firstOperatingSol !== null) {
        seen.push(industry.firstOperatingSol);
        assert.ok(industry.firstOperatingSol <= (r.lastResolvedSol ?? 0));
        assert.ok(r.actions.some(action => action.action.startsWith(`build ${id}/${type} `)), "Industry must be legally built");
      }
    }
  }
  assert.equal(r.allIndustryBySol, seen.length === 4 ? Math.max(...seen) : null);
  for (const line of r.warningLog) assert.ok(line.tone === "warn" || line.tone === "bad");
  // Complete state (including RNG, queues and logs), policy memory and all telemetry must replay.
  const repeated = runCampaign({ difficulty: r.difficulty, seed: r.requestedSeed, maxTurns: r.maxTurns });
  equal(repeated, run, `${label}: identical seed reproducibility`);
}

for (const run of study.runs) verifyRun(run);
assert.ok(study.runs.some(run => run.report.warningLog.length > run.finalState.log.filter(line => line.tone === "warn" || line.tone === "bad").length), "Warnings survive the core's rolling log limit");
for (const summary of study.summary) {
  assert.equal(summary.runs, CAMPAIGN_STUDY_SEEDS.length);
  assert.equal(summary.wins + summary.losses + summary.stalls, summary.runs, "Do not discard failures from denominator");
}

// Preserve the pre-existing Survey success signal, without requiring other seeds/modes to win.
const original = study.runs.find(run => run.report.difficulty === "survey" && run.report.requestedSeed === 20260921)!;
assert.equal(original.report.outcome, "win", "Original Survey regression seed must still work with the extracted policy");
assert.ok(original.report.allIndustryBySol !== null);

// Exercise real save.ts validation at every boundary of one complete campaign per mode.
// The adapter receives only naturally played states, never injected stock/unlocks/RNG.
const entries = new Map<string, string>();
const storage: Storage = {
  get length() { return entries.size; },
  clear() { entries.clear(); },
  getItem(key) { return entries.get(key) ?? null; },
  key(index) { return [...entries.keys()][index] ?? null; },
  removeItem(key) { entries.delete(key); },
  setItem(key, value) { entries.set(key, value); },
};
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
let checkpoints = 0;
const checkpointCoverage = new Set<string>();
try {
  for (const difficulty of CAMPAIGN_STUDY_MODES) {
    const frames: string[] = [];
    const baseline = runCampaign({ difficulty, seed: 20260921, checkpoint(value) {
      frames.push(JSON.stringify(value));
      return value;
    } });
    let frame = 0;
    const reloaded = runCampaign({ difficulty, seed: 20260921, checkpoint(value) {
      assert.equal(JSON.stringify(value), frames[frame++], `${difficulty}: same full state BEFORE each reload`);
      if (value.game.events.length) checkpointCoverage.add("events");
      if (value.game.founding) checkpointCoverage.add("founding");
      if (value.game.pendingWeather) checkpointCoverage.add("weather");
      if (value.game.ships.some(ship => ship.mission)) checkpointCoverage.add("transit");
      if (value.policy.industrySeen.length) checkpointCoverage.add("policy-memory");
      if (value.game.outcome) checkpointCoverage.add(value.game.outcome.kind);
      saveTo("slot3", value.game);
      const game = loadFrom("slot3");
      assert.ok(game, `${difficulty}: a naturally played state must load at sol ${value.game.turn}`);
      const policy = JSON.parse(JSON.stringify(value.policy)) as CampaignCheckpoint["policy"];
      checkpoints++;
      return { game, policy };
    } });
    assert.equal(frame, frames.length);
    equal(reloaded, baseline, `${difficulty}: save/reload continuation including policy memory`);
    equal(reloaded, study.runs.find(run => run.report.difficulty === difficulty && run.report.requestedSeed === 20260921), `${difficulty}: checkpoint instrumentation is observational`);
  }
} finally {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
}
for (const feature of ["events", "founding", "weather", "transit", "policy-memory", "victory"]) assert.ok(checkpointCoverage.has(feature), `Real checkpoint coverage: ${feature}`);
assert.ok(checkpoints > 30);

// Explicit tiny budgets test honest stalls and the terminal/nonterminal sol distinction.
for (const difficulty of CAMPAIGN_STUDY_MODES) {
  for (const maxTurns of [0, 1]) {
    const run = runCampaign({ difficulty, seed: 42, maxTurns });
    assert.equal(run.report.outcome, "stall");
    assert.equal(run.report.termination, "turn-limit");
    assert.equal(run.report.turnsApplied, maxTurns);
    assert.equal(run.report.sol, maxTurns + 1);
    assert.equal(run.report.lastResolvedSol, maxTurns || null);
    assert.equal(run.report.worlds.luna.resolvedSols, maxTurns);
    assert.equal(run.report.worlds.mars.minimumStock, null);
  }
}
for (const seed of [0, -1, 1.5, NaN, Infinity]) rejects(() => runCampaign({ difficulty: "survey", seed }), /seed/);
for (const maxTurns of [-1, 181, 1.5, Infinity]) rejects(() => runCampaign({ difficulty: "survey", seed: 1, maxTurns }), /budget/);
rejects(() => runCampaignStudy({ seeds: [] }), /cases/);
rejects(() => runCampaignStudy({ modes: [] }), /cases/);
rejects(() => runCampaignStudy({ seeds: [1, 1] }), /Duplicate/);
rejects(() => runCampaignStudy({ modes: ["survey", "survey"] }), /Duplicate/);
rejects(() => runCampaignStudy({ seeds: Array.from({ length: 13 }, (_, i) => i + 1) }), /cases/);
rejects(() => runCampaign({ difficulty: "survey", seed: 42, maxTurns: 0, checkpoint: () => ({} as CampaignCheckpoint) }), /Checkpoint changed/);

console.log(formatCampaignStudy(study.runs));
console.log(`campaign study: 36 baseline + 36 repeat + 6 persistence + 6 short-budget runs; ${checkpoints} real save/reload checks; ${CAMPAIGN_STUDY_TURNS}-turn baseline cap; ${((performance.now() - started) / 1000).toFixed(2)}s`);
console.log(`Policy limitations: ${study.limitations.join(" ")}`);
