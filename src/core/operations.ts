import { previewLaunch, sellPrice, type LaunchDraft } from "./actions";
import { BUILDINGS, CAPSTONES, CARGO_IDS, DIFF, SHIPS, TECH_BY_ID } from "./data";
import { planRoute } from "./routes";
import { forecast } from "./sim";
import { emptyCargo } from "./state";
import type { GameState, Ship, TechId, WorldId } from "./types";

export interface ExportPlan {
  shipId: string;
  shipName: string;
  from: "earth" | "luna";
  draft: LaunchDraft;
  ready: boolean;
  blocker: string | null;
  kilograms: number;
  sale: number;
  cashOutlay: number;
  fuelBurn: number;
  saleSol: number;
  legRisks: number[];
}

export interface PopulationPlan {
  world: WorldId;
  founded: boolean;
  population: number;
  target: number;
  housing: number;
  pendingHousing: number;
  safeStreak: number;
  targetNet: { food: number; water: number; oxygen: number };
  targetPower: { generation: number; demand: number };
  next: string;
}

export interface OperationsBrief {
  cash: { balance: number; spendable: number; debtFee: number; next: string };
  exports: ExportPlan[];
  exportNext: string;
  population: PopulationPlan[];
  fleet: { ready: number; pending: number; target: number };
  research: { unlocked: number; target: number; capstone: boolean };
}

function idle(game: GameState, ship: Ship): boolean {
  return !ship.mission && ship.loc !== "transit" && game.founding?.shipId !== ship.id;
}

// These are manifests, not orders. The second leg holds current weather/tech fixed.
export function exportPlan(game: GameState, shipId: string): ExportPlan | null {
  const ship = game.ships.find(s => s.id === shipId);
  if (!ship || !idle(game, ship) || (ship.loc !== "earth" && ship.loc !== "luna") || game.outcome) return null;
  const from = ship.loc;
  if (from === "earth" && CARGO_IDS.some(k => ship.cargo[k] > 0)) return null;
  const outbound = planRoute(game, from, from === "earth" ? "luna" : "earth", ship.cls);
  const returnState = { ...game, turn: game.turn + outbound.turns };
  const inbound = from === "earth" ? planRoute(returnState, "luna", "earth", ship.cls) : null;
  const fuelBurn = outbound.burn + (inbound?.burn ?? 0);
  const cargo = from === "luna" ? { ...ship.cargo } : emptyCargo();
  const otherCargo = CARGO_IDS.reduce((sum, k) => sum + (k === "he3" ? 0 : cargo[k]), 0);
  const kilograms = Math.max(0, Math.floor(Math.min(SHIPS[ship.cls].cargo - otherCargo, ship.cargo.he3 + game.worlds.luna.stock.he3)));
  if (from === "luna") cargo.he3 = kilograms;
  const draft = { dest: from === "earth" ? "luna" as const : "earth" as const, cargo, fuel: Math.max(ship.fuel, fuelBurn), crew: ship.crew };
  const preview = previewLaunch(game, ship.id, draft);
  const returnPad = game.worlds.luna.tiles.some(t => t.building?.type === "pad" && t.building.progress === 0 && t.building.hp > 20);
  const reserveFounder = from === "earth" && ship.cls === "colony" && !game.worlds.mars.founded && !game.ships.some(s => s.mission?.founding && s.mission.to === "mars");
  const blocker = !preview.ok ? preview.reason ?? "Departure unavailable." : !returnPad ? "Luna needs a finished launch pad for the return." : reserveFounder ? "Reserve the colony ship for Mars founding before a pickup run." : kilograms <= 0 ? "No helium-3 ready to export." : null;
  return {
    shipId, shipName: ship.name, from, draft, ready: blocker === null, blocker,
    kilograms, sale: kilograms * sellPrice(game, "he3"), cashOutlay: preview.cost,
    fuelBurn, saleSol: game.turn + outbound.turns + (inbound?.turns ?? 0),
    legRisks: inbound ? [outbound.risk, inbound.risk] : [outbound.risk],
  };
}

function exportNext(game: GameState): string {
  const path: TechId[] = ["sinter", "robots", "he3extract"];
  const missing = path.find(id => !game.tech.unlocked.includes(id));
  if (missing) return `Research ${TECH_BY_ID[missing].name} on the path to Helion Extraction.`;
  const extractors = game.worlds.luna.tiles.filter(t => t.building?.type === "he3" && t.building.hp > 20);
  if (!extractors.length) return "Place a lunar helium-3 extractor on mare soil or a helium deposit, beside your outpost.";
  if (!extractors.some(t => t.building?.progress === 0)) return "The extractor is under construction. Keep its power supply ready.";
  if (forecast(game, "luna").produced.he3 <= 0) return "The extractor is idle. Check its power and water before relying on exports.";
  return "Load helium-3 at Luna, fly to Earth, then sell cargo at Earth dock. Income is not automatic.";
}

export function completedModulesState(game: GameState): GameState {
  // Core forecasts activate final-sol construction during resolution. Readiness
  // advice is deliberately stricter: only modules completed now count here.
  const completed = structuredClone(game);
  for (const w of Object.values(completed.worlds)) for (const t of w.tiles) {
    if (t.building && t.building.progress > 0) t.building.progress = Math.max(2, t.building.progress);
  }
  return completed;
}

export function operationsBrief(game: GameState): OperationsBrief {
  const diff = DIFF[game.difficulty];
  const completed = completedModulesState(game);
  const population = (["luna", "mars"] as const).map(world => {
    const w = game.worlds[world];
    const target = world === "luna" ? diff.lunaPop : diff.marsPop;
    const current = forecast(completed, world);
    const pendingHousing = w.tiles.reduce((sum, t) => sum + (t.building && t.building.progress > 0 && t.building.hp > 15 ? BUILDINGS[t.building.type].housing : 0), 0);
    const atTarget = structuredClone(completed);
    atTarget.worlds[world].pop = target;
    const targetForecast = forecast(atTarget, world);
    const targetNet = { food: targetForecast.net.food, water: targetForecast.net.water, oxygen: targetForecast.net.oxygen };
    const targetPower = { generation: targetForecast.energyGen, demand: targetForecast.energyDraw };
    let next = "Maintain life support and finish the safe-sol streak.";
    if (!w.founded) next = "Send a colony ship with its founding kit; choose a landing site on arrival.";
    else if (current.deaths || current.brownout || current.energyGen + 0.001 < current.energyDraw || current.net.food < 0 || current.net.water < 0 || current.net.oxygen < 0) next = "Stabilize life support and sustained power at today's population before expanding.";
    else if (current.housing < target) next = current.housing + pendingHousing >= target ? "Housing is on the way. Wait for completion before bringing more crew." : "Add habitat capacity for the population goal. An unfinished habitat does not house crew.";
    else if (Object.values(targetNet).some(n => n < -0.001) || targetForecast.brownout || targetForecast.energyGen + 0.001 < targetForecast.energyDraw) next = "Add life-support production and power for the target population before hiring crew.";
    else if (w.pop < target) next = w.morale < 62 ? "Room and today's production cover the goal. Bring crew and disembark; natural growth waits for morale 62+." : "Room and today's production cover the goal. Bring crew and disembark, or allow natural growth; weather can change.";
    else if (w.streak >= diff.streak) next = "Population and safe-sol goals met. Keep the outpost supplied.";
    return { world, founded: w.founded, population: w.pop, target, housing: current.housing, pendingHousing, safeStreak: w.streak, targetNet, targetPower, next };
  });
  const debtFee = game.credits < 0 ? Math.round(Math.min(60, Math.max(12, Math.abs(game.credits) * 0.04)) * 100) / 100 : 0;
  return {
    cash: {
      balance: game.credits, spendable: Math.max(0, game.credits - diff.overdraft), debtFee,
      next: debtFee ? `Debt adds ${debtFee} credits next sol at this balance. Sell exports before borrowing for discretionary buildings.` : "Keep a cash reserve for repairs, fuel and the Mars founding kit.",
    },
    exports: game.ships.flatMap(s => { const plan = exportPlan(game, s.id); return plan ? [plan] : []; }),
    exportNext: exportNext(game), population,
    fleet: { ready: game.ships.length, pending: game.yard.length, target: diff.ships },
    research: { unlocked: game.tech.unlocked.length, target: diff.techs, capstone: CAPSTONES.some(id => game.tech.unlocked.includes(id)) },
  };
}
