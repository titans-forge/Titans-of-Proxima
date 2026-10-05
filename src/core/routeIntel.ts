import { isWindowOpen, planRoute, solsUntilWindow, solsWindowLeft } from "./routes";
import type { RoutePlan } from "./routes";
import type { GameState, LocationId, Ship, ShipClass } from "./types";

export const LOCATION_NAMES: Record<LocationId, string> = { earth: "Earth", luna: "Luna", mars: "Mars" };
export interface RouteSelection { from: LocationId; to: LocationId; cls: ShipClass; }
export interface DepartureOption { departure: number; arrival: number; wait: number; plan: RoutePlan; }

export function availableRouteHull(state: GameState, selection: RouteSelection): Ship | undefined {
  return state.ships.find(s => !s.mission && s.loc === selection.from && s.cls === selection.cls && s.id !== state.founding?.shipId);
}

export function chartShipStatus(state: GameState, ship: Ship): string {
  if (ship.mission) return `${LOCATION_NAMES[ship.mission.from]} → ${LOCATION_NAMES[ship.mission.to]} · arrives sol ${state.turn + ship.mission.eta}`;
  if (state.founding?.shipId === ship.id) return `Awaiting landing at ${LOCATION_NAMES[state.founding.world]}`;
  return `Docked at ${LOCATION_NAMES[ship.loc as LocationId]}`;
}

export function compareDepartures(state: GameState, selection: RouteSelection): { now: DepartureOption; window: DepartureOption | null } {
  const option = (wait: number): DepartureOption => {
    // Later departure holds today's technology and weather fixed, not a forecast.
    const plan = planRoute({ ...state, turn: state.turn + wait }, selection.from, selection.to, selection.cls);
    return { departure: state.turn + wait, arrival: state.turn + wait + plan.turns, wait, plan };
  };
  const now = option(0);
  return { now, window: now.plan.mars && !isWindowOpen(state.turn) ? option(solsUntilWindow(state.turn)) : null };
}

export function windowCalendar(turn: number, count = 9): { sol: number; open: boolean; today: boolean }[] {
  return Array.from({ length: count }, (_, i) => ({ sol: turn + i, open: isWindowOpen(turn + i), today: i === 0 }));
}

export function windowSummary(turn: number): string {
  const left = solsWindowLeft(turn);
  return isWindowOpen(turn)
    ? `Mars window open · ${left} sol${left === 1 ? "" : "s"} including today`
    : `Mars window opens on sol ${turn + solsUntilWindow(turn)}`;
}
