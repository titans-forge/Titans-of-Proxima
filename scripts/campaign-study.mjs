import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { CAMPAIGN_HOLDOUT_SEEDS, CAMPAIGN_RECOVERY_HOLDOUT_SEEDS, runCampaignStudy } from "../src/core/campaignStudy.ts";

const args = process.argv.slice(2);
const seen = new Set();
let output, policy = "baseline", holdout = false, compare = false, compareRecovery = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (seen.has(arg)) throw new Error(`Repeated option ${arg}`);
  seen.add(arg);
  if (arg === "--holdout") holdout = true;
  else if (arg === "--compare") compare = true;
  else if (arg === "--compare-recovery") compareRecovery = true;
  else if (arg === "--output" && args[i + 1] && !args[i + 1].startsWith("--")) output = args[++i];
  else if (arg === "--policy" && ["baseline", "economic", "recovery"].includes(args[i + 1])) policy = args[++i];
  else throw new Error("Usage: npm run study:campaign -- [--policy baseline|economic|recovery | --compare | --compare-recovery] [--holdout] [--output /existing-directory/new-report.json]");
}
if ((compare || compareRecovery) && seen.has("--policy") || compare && compareRecovery) throw new Error("Choose one policy or one comparison, not both");
const recordedAt = new Date().toISOString();
const sourceHashes = {};
for (const path of ["src/core/campaignStudy.ts", "src/core/campaignStudyPolicy.ts", "src/core/campaignEconomyPolicy.ts", "src/core/campaignRecoveryPolicy.ts", "src/core/crewTransport.ts", "src/core/operations.ts", "src/core/shipService.ts", "src/core/data.ts", "src/core/actions.ts", "src/core/sim.ts"]) {
  sourceHashes[path] = createHash("sha256").update(await readFile(new URL(`../${path}`, import.meta.url))).digest("hex");
}
function buildStudy(selected) {
  const recoveryCohort = compareRecovery || selected === "recovery";
  const study = runCampaignStudy({ policy: selected, ...(holdout ? { seeds: recoveryCohort ? CAMPAIGN_RECOVERY_HOLDOUT_SEEDS : CAMPAIGN_HOLDOUT_SEEDS } : {}) });
  return {
    schema: "proxima_campaign_study_v1", recordedAt,
    policy: study.runs[0].report.policy,
    cohort: holdout ? recoveryCohort ? "predeclared-recovery-holdout-v2" : "predeclared-holdout-v1" : "fixed-regression-v1",
    limitations: study.limitations, summary: study.summary,
    reports: study.runs.map(run => run.report),
    economy: study.runs.map(({ report, finalState: game }) => ({
      difficulty: report.difficulty, seed: report.requestedSeed, he3Sold: game.stats.he3Sold,
      hulls: game.ships.length, hullsBuilding: game.yard.length, unlocked: game.tech.unlocked.length,
      repairPatches: report.actions.filter(a => a.action.startsWith("shiprepair ")).length,
      crewLandings: report.actions.filter(a => a.action.startsWith("disembark ")).length,
      shortageWorldSols: report.worlds.luna.warnings.shortageSols + report.worlds.mars.warnings.shortageSols,
    })),
  };
}
const artifact = compare || compareRecovery ? {
  schema: "proxima_campaign_comparison_v1", recordedAt, sourceHashes,
  caveat: "Paired deterministic pilots, not human-play balance certification or an optimal-play comparison. Different policies consume different RNG sequences.",
  studies: compareRecovery ? [buildStudy("economic"), buildStudy("recovery")] : [buildStudy("baseline"), buildStudy("economic")],
} : { ...buildStudy(policy), sourceHashes };
if (output) await writeFile(output, JSON.stringify(artifact, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output: output ?? null, studies: (artifact.studies ?? [artifact]).map(s => ({ policy: s.policy, cohort: s.cohort, summary: s.summary, economy: s.economy, limitations: s.limitations })) }, null, 2));
