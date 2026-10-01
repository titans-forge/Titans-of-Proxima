import { DIFF, SHIPS } from "./data";
import type { GameState, LocationId, ShipClass, TechId } from "./types";

const CYCLE = 9;
const OPEN_START = 4;
const OPEN_END = 7;

export function isWindowOpen(turn: number): boolean {
  const phase = (turn - 1) % CYCLE;
  return phase >= OPEN_START && phase <= OPEN_END;
}

export function solsUntilWindow(turn: number): number {
  if (isWindowOpen(turn)) return 0;
  for (let i = 1; i <= CYCLE; i++) if (isWindowOpen(turn + i)) return i;
  return CYCLE;
}

export function solsWindowLeft(turn: number): number {
  if (!isWindowOpen(turn)) return 0;
  let n = 0;
  while (isWindowOpen(turn + n)) n++;
  return n;
}

export function baseTransit(from: LocationId, to: LocationId): number {
  if (from === to) return 0;
  const pair = [from, to].sort().join("-");
  if (pair === "earth-luna") return 2;
  if (pair === "earth-mars") return 8;
  if (pair === "luna-mars") return 7;
  return 6;
}

export interface RoutePlan {
  turns: number;
  burn: number;
  risk: number;
  window: boolean;
  mars: boolean;
}

export function planRoute(state: GameState, from: LocationId, to: LocationId, cls: ShipClass): RoutePlan {
  const mars = from === "mars" || to === "mars";
  const luna = from === "luna" || to === "luna";
  const window = isWindowOpen(state.turn);
  const tech = state.tech.unlocked;
  let turns = baseTransit(from, to);
  if (mars && window) turns -= 3;
  if (tech.includes("ntr")) turns -= 1;
  if (mars && window && tech.includes("cycler")) turns -= 2;
  turns = Math.max(1, turns);
  if (cls === "courier") turns = Math.max(1, turns - 1);

  let burn = turns * SHIPS[cls].burn;
  if (tech.includes("methalox")) burn *= 0.8;
  if (tech.includes("ntr")) burn *= 0.9;
  burn = Math.ceil(burn);

  let risk = 0.04;
  if (mars) risk += window ? 0.035 : 0.12;
  if (!mars && luna) risk += 0.012;
  if (mars && state.worlds.mars.dust > 0) risk += 0.09;
  if (luna && state.worlds.luna.radiation > 0) risk += 0.07;
  if (tech.includes("rendezvous")) risk *= 0.62;
  if (tech.includes("warning")) risk *= 0.85;
  if (mars && window && tech.includes("cycler")) risk *= 0.72;
  const diff = DIFF[state.difficulty].hazard;
  risk = Math.max(0.02, Math.min(0.58, risk * (0.85 + diff * 0.15)));

  return { turns, burn, risk, window, mars };
}

export function hasTech(state: GameState, id: TechId): boolean {
  return state.tech.unlocked.includes(id);
}
