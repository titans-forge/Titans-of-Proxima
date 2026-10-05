import { buyPrice, canSpend } from "./actions";
import type { ActionResult } from "./actions";
import { SHIPS } from "./data";
import { fmt } from "./format";
import { pushLog } from "./state";
import type { GameState, LocationId } from "./types";

export interface ShipRepairPreview {
  ok: boolean;
  reason?: string;
  restored: number;
  hullAfter: number;
  maxHull: number;
  metals: number;
  cost: number;
  /** No repair location for an unknown or undocked hull. */
  location: LocationId | null;
}

export function previewShipRepair(game: GameState, shipId: string): ShipRepairPreview {
  const ship = game.ships.find(s => s.id === shipId);
  const def = ship ? SHIPS[ship.cls] : undefined;
  const quote: ShipRepairPreview = {
    ok: false,
    restored: 0,
    hullAfter: 0,
    maxHull: def?.hull ?? 0,
    metals: 0,
    cost: 0,
    location: ship && (ship.loc === "earth" || ship.loc === "luna" || ship.loc === "mars") ? ship.loc : null,
  };
  if (!ship) return { ...quote, reason: "Unknown ship." };
  if (!def || !Number.isFinite(ship.hull) || ship.hull <= 0 || ship.hull > def.hull) {
    return { ...quote, reason: "Hull integrity is invalid." };
  }
  quote.hullAfter = ship.hull;
  if (!quote.location || ship.mission) return { ...quote, reason: "That hull is not in dock." };
  if (game.outcome) return { ...quote, reason: "The charter is closed." };
  if (game.events.length > 0) return { ...quote, reason: "A situation needs an order." };
  if (game.founding) return { ...quote, reason: "Choose a landing site before repairing hulls." };
  if (ship.hull === def.hull) return { ...quote, reason: "Hull integrity is already nominal." };

  const world = quote.location === "earth" ? null : game.worlds[quote.location];
  if (world) {
    if (!world.founded) return { ...quote, reason: "No outpost on this world." };
    const pad = world.tiles.some(t => t.building?.type === "pad" && t.building.progress === 0 && t.building.hp > 20);
    if (!pad) return { ...quote, reason: "Needs a finished launch pad with integrity above 20%." };
  }

  quote.restored = Math.min(def.hull - ship.hull, Math.ceil(def.hull * 0.25));
  quote.hullAfter = Math.min(def.hull, ship.hull + quote.restored);
  quote.metals = Math.max(1, Math.ceil(def.metals * quote.restored / def.hull));
  quote.cost = world ? 10 : Math.round((quote.metals * buyPrice(game, "metals") + 10) * 100) / 100;
  if (!Number.isFinite(quote.cost) || quote.cost < 10) return { ...quote, reason: "Repair price is invalid." };
  if (world && (!Number.isFinite(world.stock.metals) || world.stock.metals < quote.metals)) {
    return { ...quote, reason: `Repair needs ${fmt(quote.metals)} t of metals in the outpost stores.` };
  }
  if (!Number.isFinite(game.credits) || !canSpend(game, quote.cost)) return { ...quote, reason: "Credit line refused." };
  return { ...quote, ok: true };
}

export function repairShip(game: GameState, shipId: string): ActionResult {
  // Quotes reserve nothing; every paid patch rechecks the current dock and resources.
  const quote = previewShipRepair(game, shipId);
  if (!quote.ok) return { ok: false, reason: quote.reason, sfx: "error" };
  const ship = game.ships.find(s => s.id === shipId)!;
  const location = quote.location!;
  if (location !== "earth") game.worlds[location].stock.metals -= quote.metals;
  game.credits -= quote.cost;
  ship.hull = quote.hullAfter;
  const name = location === "earth" ? "Earth" : game.worlds[location].name;
  pushLog(
    game,
    `${ship.name} patched at ${name}: +${fmt(quote.restored)} hull (${fmt(quote.hullAfter)}/${fmt(quote.maxHull)}), ${fmt(quote.metals)} t metals, ${fmt(quote.cost)} credits.`,
    "good",
  );
  return { ok: true, sfx: "build" };
}
