import { assert } from "./testAssert";
import { CAMPAIGN_HOLDOUT_SEEDS, runCampaign, runCampaignStudy, assertCampaignInvariants } from "./campaignStudy";
import { ECONOMY_POLICY_ID } from "./campaignEconomyPolicy";
import { loadFrom, saveTo } from "./save";

const study = runCampaignStudy({ policy: "economic", seeds: CAMPAIGN_HOLDOUT_SEEDS });
assert.equal(study.runs.length, 9);
assert.ok(study.limitations.some(s => s.includes("not optimal")));
for (const run of study.runs) {
  const r = run.report;
  assert.equal(r.policy, ECONOMY_POLICY_ID);
  assertCampaignInvariants(run.finalState);
  if (r.outcome === "win") assert.ok(r.objectives.every(o => o.done));
  const repeated = runCampaign({ policy: "economic", difficulty: r.difficulty, seed: r.requestedSeed });
  assert.equal(JSON.stringify(repeated), JSON.stringify(run), "Unseen seeds must replay exactly, including unsuccessful outcomes");
}

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
    const reloaded = runCampaign({ policy: "economic", difficulty, seed: CAMPAIGN_HOLDOUT_SEEDS[0], checkpoint(value) {
      saveTo("slot2", value.game);
      const game = loadFrom("slot2");
      assert.ok(game, "A naturally played economy state must pass the real save validator");
      checkpoints++;
      return { game, policy: JSON.parse(JSON.stringify(value.policy)) };
    } });
    assert.equal(JSON.stringify(reloaded), JSON.stringify(study.runs.find(r => r.report.difficulty === difficulty && r.report.requestedSeed === CAMPAIGN_HOLDOUT_SEEDS[0])));
  }
} finally {
  if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
}
assert.ok(checkpoints > 30);
for (const policy of ["baseline", "economic"] as const) {
  assert.equal(runCampaign({ policy, difficulty: "charter", seed: 42, maxTurns: 0 }).report.turnsApplied, 0);
}
let rejected = false;
try { runCampaign({ policy: "unknown" as never, difficulty: "survey", seed: 1 }); } catch { rejected = true; }
assert.ok(rejected, "Unknown policy must not silently fall back");
console.log(JSON.stringify({ holdout: study.summary, realSaveReloadCheckpoints: checkpoints }));
console.log("integrated economy study: 9 reserved cases, 9 exact repeats, 3 real save/reload continuations; no balance certification");
