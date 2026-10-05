import { buildingStatus } from "./buildingStatus";
import type { BuildingStatus } from "./buildingStatus";
import { CARGO_IDS, SHIPS } from "./data";
import {
  CAMPAIGN_POLICY_ID, CAMPAIGN_POLICY_LIMITATIONS, createCampaignPolicyMemory,
  playCampaignPolicy, STUDY_INDUSTRIES, STUDY_WORLDS,
} from "./campaignStudyPolicy";
import type { CampaignAction, CampaignPolicyMemory, StudyIndustry } from "./campaignStudyPolicy";
import { ECONOMY_POLICY_ID, ECONOMY_POLICY_LIMITATIONS, createEconomyPolicyMemory, playEconomyPolicy, type EconomyPolicyMemory } from "./campaignEconomyPolicy";
import { RECOVERY_POLICY_ID, RECOVERY_POLICY_LIMITATIONS, createRecoveryPolicyMemory, playRecoveryPolicy, type RecoveryPolicyMemory } from "./campaignRecoveryPolicy";
import { applyTurn, blockingReason, forecast, objectives, storageCap } from "./sim";
import { createGame } from "./state";
import { RESOURCES } from "./types";
import type { Difficulty, Forecast, GameState, LogLine, Objective, Stock, WorldId } from "./types";

// Chosen before observing outcomes. Include the original regression seed and small/large seeds.
export const CAMPAIGN_STUDY_SEEDS = [1, 2, 3, 7, 17, 42, 101, 997, 65537, 424242, 20260921, 987654321] as const;
export const CAMPAIGN_STUDY_MODES = ["survey", "charter", "hardship"] as const;
export const CAMPAIGN_STUDY_TURNS = 90;
export const CAMPAIGN_HOLDOUT_SEEDS = [20261005, 314159, 271828] as const;
// Fresh recovery cohort chosen before observing the v2 policy's outcomes.
export const CAMPAIGN_RECOVERY_HOLDOUT_SEEDS = [20261006, 161803, 707106] as const;
export type CampaignPolicy = "baseline" | "economic" | "recovery";
export type StudyPolicyMemory = CampaignPolicyMemory | EconomyPolicyMemory | RecoveryPolicyMemory;
const MAX_TURNS = 180;
const MAX_RUNS = 36;
const EPSILON = 1e-6;

export interface CampaignCheckpoint {
  game: GameState;
  policy: StudyPolicyMemory;
}

export interface CampaignRunOptions {
  difficulty: Difficulty;
  seed: number;
  maxTurns?: number;
  policy?: CampaignPolicy;
  /** Optional persistence adapter. Must preserve the complete game AND policy memory exactly. */
  checkpoint?: (value: CampaignCheckpoint) => CampaignCheckpoint;
}

export interface IndustryStudy {
  firstOperatingSol: number | null;
  operatingSols: number;
  statusSols: Record<BuildingStatus | "absent", number>;
}

export interface WorldStudy {
  foundedSol: number | null;
  population: number;
  minimumPopulation: number | null;
  maximumPopulation: number | null;
  morale: number;
  minimumMorale: number | null;
  stock: Stock;
  // Extrema exclude unfounded-world zeroes, but include every successful action and resolved turn.
  minimumStock: Stock | null;
  maximumStock: Stock | null;
  capacity: Stock;
  net: Stock;
  streak: number;
  resolvedSols: number;
  warnings: {
    foodShortageSols: number;
    waterShortageSols: number;
    oxygenShortageSols: number;
    brownoutSols: number;
    unpoweredSols: number;
    shortageSols: number;
    forecastDeaths: number;
    foodRunwaySols: number;
    waterRunwaySols: number;
    oxygenRunwaySols: number;
  };
  industry: Record<StudyIndustry, IndustryStudy>;
}

export interface CampaignRunReport {
  policy: string;
  difficulty: Difficulty;
  requestedSeed: number;
  effectiveSeed: number;
  maxTurns: number;
  outcome: "win" | "loss" | "stall";
  termination: "victory" | "defeat" | "turn-limit" | "blocked";
  reason: string;
  // applyTurn does not increment the sol when it closes the charter. Count calls separately.
  sol: number;
  turnsApplied: number;
  lastResolvedSol: number | null;
  credits: number;
  minimumCredits: number;
  maximumCredits: number;
  worlds: Record<WorldId, WorldStudy>;
  allIndustryBySol: number | null;
  objectives: Objective[];
  actions: CampaignAction[];
  deferred: Record<string, { count: number; firstSol: number; lastSol: number; lastReason: string }>;
  warningLog: LogLine[];
  invariantChecks: number;
}

export interface CampaignRun {
  report: CampaignRunReport;
  finalState: GameState;
  policyMemory: StudyPolicyMemory;
}

export interface ModeStudySummary {
  difficulty: Difficulty;
  runs: number;
  wins: number;
  losses: number;
  stalls: number;
  solRange: [number, number];
  populationRange: Record<WorldId, [number, number]>;
  creditsRange: [number, number];
  industryComplete: number;
}

function requireRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}: ${value} outside [${min}, ${max}]`);
}

function checkOptions(options: CampaignRunOptions): number {
  if (options.policy !== undefined && options.policy !== "baseline" && options.policy !== "economic" && options.policy !== "recovery") throw new Error("Unknown campaign study policy");
  if (!CAMPAIGN_STUDY_MODES.includes(options.difficulty)) throw new Error("Unknown campaign study difficulty");
  if (!Number.isSafeInteger(options.seed) || options.seed < 1 || options.seed > 0xffffffff - 255) throw new Error("Study seed must be a positive uint32 integer with room for map retries");
  const maxTurns = options.maxTurns ?? CAMPAIGN_STUDY_TURNS;
  if (!Number.isInteger(maxTurns) || maxTurns < 0 || maxTurns > MAX_TURNS) throw new Error(`Study turn budget must be an integer from 0 to ${MAX_TURNS}`);
  return maxTurns;
}

/** Credits and forecast net deltas may be negative; stock, ship loads and population may not. */
export function assertCampaignInvariants(game: GameState, context = "campaign"): void {
  const at = `${context}: ${game.difficulty}/${game.seed} sol ${game.turn}`;
  requireRange(game.credits, -Infinity, Infinity, `${at} credits`);
  requireRange(game.rng, 0, 0xffffffff, `${at} RNG`);
  requireRange(game.tech.progress, 0, Infinity, `${at} research`);
  for (const id of STUDY_WORLDS) {
    const world = game.worlds[id];
    const cap = storageCap(game, world);
    for (const k of RESOURCES) {
      requireRange(cap[k], 0, Infinity, `${at} ${id}/${k} capacity`);
      requireRange(world.stock[k], 0, cap[k] + EPSILON, `${at} ${id}/${k}`);
    }
    requireRange(world.pop, 0, Infinity, `${at} ${id} population`);
    if (!Number.isInteger(world.pop)) throw new Error(`${at} ${id} fractional population`);
    requireRange(world.morale, 0, 100, `${at} ${id} morale`);
    for (const tile of world.tiles) {
      if (!tile.building) continue;
      requireRange(tile.building.hp, 0, 100, `${at} ${id} integrity`);
      requireRange(tile.building.progress, 0, tile.building.total, `${at} ${id} construction`);
    }
  }
  for (const ship of game.ships) {
    const def = SHIPS[ship.cls];
    let cargo = 0;
    for (const k of CARGO_IDS) {
      requireRange(ship.cargo[k], 0, def.cargo + EPSILON, `${at} ${ship.id}/${k}`);
      cargo += ship.cargo[k];
    }
    requireRange(cargo, 0, def.cargo + EPSILON, `${at} ${ship.id} total cargo`);
    requireRange(ship.fuel, 0, def.fuel + EPSILON, `${at} ${ship.id} fuel`);
    requireRange(ship.crew, 0, def.crew, `${at} ${ship.id} crew`);
    requireRange(ship.hull, 0, def.hull, `${at} ${ship.id} hull`);
  }
}

function checkForecast(f: Forecast, context: string): void {
  for (const key of ["produced", "consumed", "demand", "net"] as const) {
    for (const resource of RESOURCES) requireRange(f[key][resource], key === "net" ? -Infinity : 0, Infinity, `${context} ${key}/${resource}`);
  }
  for (const key of ["energyGen", "energyDraw", "energyNext", "rp", "housing", "deaths"] as const) requireRange(f[key], 0, Infinity, `${context} ${key}`);
}

function newIndustry(): IndustryStudy {
  return { firstOperatingSol: null, operatingSols: 0, statusSols: { operating: 0, unpowered: 0, limited: 0, starved: 0, standby: 0, construction: 0, dead: 0, absent: 0 } };
}

function newWorldStudy(game: GameState, id: WorldId): WorldStudy {
  const world = game.worlds[id];
  return {
    foundedSol: world.foundedTurn, population: world.pop, minimumPopulation: null, maximumPopulation: null,
    morale: world.morale, minimumMorale: null,
    stock: { ...world.stock }, minimumStock: null, maximumStock: null,
    capacity: storageCap(game, world), net: { ...forecast(game, id).net }, streak: world.streak, resolvedSols: 0,
    warnings: { foodShortageSols: 0, waterShortageSols: 0, oxygenShortageSols: 0, brownoutSols: 0, unpoweredSols: 0, shortageSols: 0, forecastDeaths: 0, foodRunwaySols: 0, waterRunwaySols: 0, oxygenRunwaySols: 0 },
    industry: { robotics: newIndustry(), aresfab: newIndustry() },
  };
}

function sampleResolvedSol(game: GameState, id: WorldId, result: WorldStudy): void {
  const world = game.worlds[id];
  if (!world.founded) return;
  const f = forecast(game, id);
  checkForecast(f, `${game.difficulty}/${game.seed} sol ${game.turn} ${id}`);
  result.resolvedSols++;
  const w = result.warnings;
  w.foodShortageSols += Number(f.foodShortage);
  w.waterShortageSols += Number(f.waterShortage);
  w.oxygenShortageSols += Number(f.o2Shortage);
  w.brownoutSols += Number(f.brownout);
  w.unpoweredSols += Number(f.unpowered.length > 0);
  w.shortageSols += Number(f.foodShortage || f.waterShortage || f.o2Shortage);
  w.forecastDeaths += f.deaths;
  for (const type of STUDY_INDUSTRIES) {
    const entry = result.industry[type];
    const tile = world.tiles.find(t => t.building?.type === type);
    const status = tile?.building ? buildingStatus(tile.building, tile.q, tile.r, f).status : "absent";
    entry.statusSols[status]++;
    // Count only completed factories in the forecast actually consumed by applyTurn.
    // Progress=1 can produce in core, but is still "construction" in buildingStatus.
    if (status === "operating") {
      entry.operatingSols++;
      entry.firstOperatingSol ??= game.turn;
    }
  }
}

export function runCampaign(options: CampaignRunOptions): CampaignRun {
  const maxTurns = checkOptions(options);
  let game = createGame(options.difficulty, options.seed);
  const economic = options.policy === "economic";
  const recovery = options.policy === "recovery";
  const policyId = recovery ? RECOVERY_POLICY_ID : economic ? ECONOMY_POLICY_ID : CAMPAIGN_POLICY_ID;
  let policy: StudyPolicyMemory = recovery ? createRecoveryPolicyMemory() : economic ? createEconomyPolicyMemory() : createCampaignPolicyMemory();
  const worlds = { luna: newWorldStudy(game, "luna"), mars: newWorldStudy(game, "mars") };
  const actions: CampaignAction[] = [];
  const warningLog: LogLine[] = [];
  const deferred: CampaignRunReport["deferred"] = {};
  let logTail: LogLine | undefined;
  let invariantChecks = 0;
  let minimumCredits = game.credits;
  let maximumCredits = game.credits;
  let turnsApplied = 0;
  let lastResolvedSol: number | null = null;
  let blocked: string | null = null;

  const inspect = (context: string): void => {
    assertCampaignInvariants(game, context);
    invariantChecks++;
    minimumCredits = Math.min(minimumCredits, game.credits);
    maximumCredits = Math.max(maximumCredits, game.credits);
    const index = logTail ? game.log.indexOf(logTail) : -1;
    if (logTail && index < 0) throw new Error("Study log cursor lost: warning telemetry would be incomplete");
    for (const line of game.log.slice(index + 1)) if (line.tone === "warn" || line.tone === "bad") warningLog.push({ ...line });
    logTail = game.log.at(-1);
    for (const id of STUDY_WORLDS) {
      const world = game.worlds[id];
      if (!world.founded) continue;
      const result = worlds[id];
      result.minimumPopulation = Math.min(result.minimumPopulation ?? world.pop, world.pop);
      result.maximumPopulation = Math.max(result.maximumPopulation ?? world.pop, world.pop);
      result.minimumMorale = Math.min(result.minimumMorale ?? world.morale, world.morale);
      result.minimumStock ??= { ...world.stock };
      result.maximumStock ??= { ...world.stock };
      for (const k of RESOURCES) {
        result.minimumStock[k] = Math.min(result.minimumStock[k], world.stock[k]);
        result.maximumStock[k] = Math.max(result.maximumStock[k], world.stock[k]);
      }
    }
  };
  const checkpoint = (): void => {
    if (!options.checkpoint) return;
    const before = JSON.stringify({ game, policy });
    const restored = options.checkpoint({ game, policy });
    if (JSON.stringify(restored) !== before) throw new Error(`Checkpoint changed campaign state at ${options.difficulty}/${options.seed} sol ${game.turn}`);
    game = restored.game;
    policy = restored.policy;
    logTail = game.log.at(-1);
  };

  inspect("initial");
  checkpoint();
  while (turnsApplied < maxTurns && !game.outcome) {
    const onAction = (action: CampaignAction): void => {
      actions.push(action);
      inspect(action.action);
    };
    const decision = recovery ? playRecoveryPolicy(game, policy as RecoveryPolicyMemory, onAction) : economic ? playEconomyPolicy(game, policy as EconomyPolicyMemory, onAction) : playCampaignPolicy(game, policy, onAction);
    for (const item of decision.deferred) {
      const entry = deferred[item.action] ??= { count: 0, firstSol: game.turn, lastSol: game.turn, lastReason: item.reason };
      entry.count++;
      entry.lastSol = game.turn;
      entry.lastReason = item.reason;
    }
    inspect("planned");
    blocked = decision.blocked ?? blockingReason(game);
    if (blocked) break;
    lastResolvedSol = game.turn;
    for (const id of STUDY_WORLDS) sampleResolvedSol(game, id, worlds[id]);
    applyTurn(game);
    turnsApplied++;
    for (const id of STUDY_WORLDS) {
      const w = game.worlds[id];
      if (!w.founded) continue;
      worlds[id].warnings.foodRunwaySols += Number(w.warnFood);
      worlds[id].warnings.waterRunwaySols += Number(w.warnWater);
      worlds[id].warnings.oxygenRunwaySols += Number(w.warnO2);
    }
    inspect(`resolved sol ${lastResolvedSol}`);
    checkpoint();
  }

  for (const id of STUDY_WORLDS) {
    const world = game.worlds[id];
    const f = forecast(game, id);
    checkForecast(f, `final ${id}`);
    Object.assign(worlds[id], { foundedSol: world.foundedTurn, population: world.pop, morale: world.morale, stock: { ...world.stock }, capacity: storageCap(game, world), net: { ...f.net }, streak: world.streak });
  }
  const industrySols = STUDY_WORLDS.flatMap(id => STUDY_INDUSTRIES.map(type => worlds[id].industry[type].firstOperatingSol));
  const allIndustryBySol = industrySols.every((sol): sol is number => sol !== null) ? Math.max(...industrySols) : null;
  const termination = game.outcome?.kind ?? (blocked ? "blocked" : "turn-limit");
  const outcome = termination === "victory" ? "win" : termination === "defeat" ? "loss" : "stall";
  const reason = game.outcome?.kind === "defeat" ? game.outcome.reason : termination === "victory" ? "All campaign objectives satisfied" : blocked ?? `No terminal outcome after ${maxTurns} applied turns`;
  return {
    report: {
      policy: policyId, difficulty: options.difficulty, requestedSeed: options.seed, effectiveSeed: game.seed,
      maxTurns, outcome, termination, reason, sol: game.turn, turnsApplied, lastResolvedSol,
      credits: game.credits, minimumCredits, maximumCredits, worlds, allIndustryBySol,
      objectives: objectives(game), actions, deferred, warningLog, invariantChecks,
    },
    finalState: game,
    policyMemory: policy,
  };
}

function range(values: number[]): [number, number] {
  return [Math.min(...values), Math.max(...values)];
}

export function summarizeCampaignRuns(runs: readonly CampaignRun[]): ModeStudySummary[] {
  return CAMPAIGN_STUDY_MODES.flatMap(difficulty => {
    const reports = runs.filter(run => run.report.difficulty === difficulty).map(run => run.report);
    if (!reports.length) return [];
    return [{
      difficulty, runs: reports.length,
      wins: reports.filter(r => r.outcome === "win").length,
      losses: reports.filter(r => r.outcome === "loss").length,
      stalls: reports.filter(r => r.outcome === "stall").length,
      solRange: range(reports.map(r => r.sol)),
      populationRange: { luna: range(reports.map(r => r.worlds.luna.population)), mars: range(reports.map(r => r.worlds.mars.population)) },
      creditsRange: range(reports.map(r => r.credits)),
      industryComplete: reports.filter(r => r.allIndustryBySol !== null).length,
    }];
  });
}

export function runCampaignStudy(options: {
  seeds?: readonly number[];
  modes?: readonly Difficulty[];
  maxTurns?: number;
  policy?: CampaignPolicy;
} = {}): { runs: CampaignRun[]; summary: ModeStudySummary[]; limitations: readonly string[] } {
  const seeds = options.seeds ?? CAMPAIGN_STUDY_SEEDS;
  const modes = options.modes ?? CAMPAIGN_STUDY_MODES;
  if (!seeds.length || !modes.length || seeds.length * modes.length > MAX_RUNS) throw new Error(`Study requires 1-${MAX_RUNS} seed/mode cases`);
  if (new Set(seeds).size !== seeds.length || new Set(modes).size !== modes.length) throw new Error("Duplicate study seeds or modes would inflate the sample");
  // Validate the entire matrix before spending time on the first run.
  for (const difficulty of modes) for (const seed of seeds) checkOptions({ difficulty, seed, maxTurns: options.maxTurns, policy: options.policy });
  const runs = modes.flatMap(difficulty => seeds.map(seed => runCampaign({ difficulty, seed, maxTurns: options.maxTurns, policy: options.policy })));
  return { runs, summary: summarizeCampaignRuns(runs), limitations: options.policy === "recovery" ? RECOVERY_POLICY_LIMITATIONS : options.policy === "economic" ? ECONOMY_POLICY_LIMITATIONS : CAMPAIGN_POLICY_LIMITATIONS };
}

export function formatCampaignStudy(runs: readonly CampaignRun[]): string {
  const lines = [`policy=${[...new Set(runs.map(run => run.report.policy))].join(",")}; bounded cases=${runs.length}; turn budgets=${[...new Set(runs.map(run => run.report.maxTurns))].join(",")}`, "industryBy = all four completed factories have operated at least once, not necessarily simultaneously", "mode seed->effective result sol/turns pop(L/M) credits[min] industryBy warn/bad shortageWorldSols unmet"];
  for (const { report: r } of runs) {
    const bad = r.warningLog.filter(line => line.tone === "bad").length;
    const shortage = r.worlds.luna.warnings.shortageSols + r.worlds.mars.warnings.shortageSols;
    const unmet = r.objectives.filter(o => !o.done).map(o => o.id).join(",") || "none";
    lines.push(`${r.difficulty} ${r.requestedSeed}->${r.effectiveSeed} ${r.outcome} ${r.sol}/${r.turnsApplied} ${r.worlds.luna.population}/${r.worlds.mars.population} ${r.credits.toFixed(2)}[${r.minimumCredits.toFixed(2)}] ${r.allIndustryBySol ?? "incomplete"} ${r.warningLog.length - bad}/${bad} ${shortage} ${unmet}`);
  }
  for (const s of summarizeCampaignRuns(runs)) {
    lines.push(`${s.difficulty}: ${s.wins} wins, ${s.losses} losses, ${s.stalls} stalls; sols ${s.solRange.join("-")}; population L ${s.populationRange.luna.join("-")} / M ${s.populationRange.mars.join("-")}; credits ${s.creditsRange.map(n => n.toFixed(2)).join(" to ")}; all industry ${s.industryComplete}/${s.runs}`);
  }
  return lines.join("\n");
}
