import { launchResourceDelta, previewLaunch, type LaunchDraft } from "../core/actions";
import { CARGO_IDS, RESOURCE_META, SHIPS } from "../core/data";
import { fmt } from "../core/format";
import type { CargoId, GameState, Ship } from "../core/types";

export function shipIntegrity(ship: Ship): number {
  return Math.max(0, Math.min(100, ship.hull / SHIPS[ship.cls].hull * 100));
}

export function shipManifestKey(ship: Ship): string {
  return JSON.stringify([ship.id, ship.loc, ship.fuel, ship.crew, CARGO_IDS.map(k => ship.cargo[k]), ship.mission?.to ?? null]);
}

export function initialLaunchDraft(ship: Ship): LaunchDraft {
  return { dest: ship.loc === "earth" ? "mars" : "earth", cargo: { ...ship.cargo }, fuel: ship.fuel, crew: ship.crew };
}

export function cargoLimit(state: GameState, ship: Ship, draft: LaunchDraft, k: CargoId): number {
  const otherCargo = CARGO_IDS.reduce((sum, id) => sum + (id === k ? 0 : draft.cargo[id]), 0);
  const bay = SHIPS[ship.cls].cargo - otherCargo;
  const available = ship.loc === "earth" || ship.loc === "transit" ? bay
    : ship.cargo[k] + state.worlds[ship.loc].stock[k] - (k === "propellant" ? draft.fuel - ship.fuel : 0);
  return Math.max(0, Math.min(bay, available));
}

export function fuelLimit(state: GameState, ship: Ship, draft: LaunchDraft): number {
  const available = ship.loc === "earth" || ship.loc === "transit" ? SHIPS[ship.cls].fuel
    : ship.fuel + state.worlds[ship.loc].stock.propellant - (draft.cargo.propellant - ship.cargo.propellant);
  return Math.max(0, Math.min(SHIPS[ship.cls].fuel, available));
}

export function launchSummary(state: GameState, ship: Ship, draft: LaunchDraft): string {
  const preview = previewLaunch(state, ship.id, draft);
  if (!preview.ok) return preview.reason ?? "Cannot launch";
  const leg = `${preview.turns} sol${preview.turns === 1 ? "" : "s"}; burn ${preview.burn} t; incident risk ${Math.round(preview.risk * 100)}%.`;
  const cash = ` ${preview.cost >= 0 ? "Cost" : "Credit"} ${fmt(Math.abs(preview.cost))} cr; balance after launch ${fmt(state.credits - preview.cost)} cr.`;
  const fuel = ` Arrive with ${fmt(draft.fuel - preview.burn)} t tank fuel${preview.founding ? "; founding flight" : ""}.`;
  if (ship.loc === "earth" || ship.loc === "transit") return leg + cash + fuel;
  const delta = launchResourceDelta(ship, draft);
  const stores = CARGO_IDS.filter(k => Math.abs(delta[k]) > 0.001)
    .map(k => `${RESOURCE_META[k].label.toLowerCase()} ${fmt(state.worlds[ship.loc as "luna" | "mars"].stock[k] - delta[k])} ${RESOURCE_META[k].unit}`);
  return leg + cash + fuel + (stores.length ? ` Ground stores after launch: ${stores.join(", ")}.` : "");
}

export function quotaReady(state: GameState, ship: Ship): boolean {
  return !!state.contract && ship.loc === "earth" && Object.entries(state.contract.need).every(([k, amount]) => ship.cargo[k as CargoId] + 1e-6 >= (amount ?? 0));
}
