import { disembark, launchShip, placeBuilding, placementError } from "./actions";
import { createEconomyPolicyMemory, ECONOMY_POLICY_MAX_ACTIONS, playEconomyPolicy, type EconomyPolicyMemory } from "./campaignEconomyPolicy";
import type { CampaignAction, CampaignPolicyMemory, PolicyDecision } from "./campaignStudyPolicy";
import { crewArrivalAdvice, crewCapacity, crewReturnPlan, crewTransferPlan } from "./crewTransport";
import { SHIPS } from "./data";
import { previewShipRepair, repairShip } from "./shipService";

export const RECOVERY_POLICY_ID = "objective-economy-recovery-v2";
export const RECOVERY_POLICY_LIMITATIONS = [
  "Bounded economic-v1 policy plus paid dock repair and conservative colony-hull passenger runs; feasibility examples, not human balance certification or optimal play.",
  "The original v1 policy remains unchanged. Extra public actions share its 64-actions-per-sol budget; at most four repair patches per call and one colony-hull departure per call.",
  "Uses completed housing and current sustainable production; docked/inbound passengers reserve capacity. Weather, damage and natural growth can change support before arrival.",
  "Paid repairs use the new dock workshop mechanic, not reduced hazard or difficulty. No automatic repair occurs in the player's game.",
  "Only colony hulls run passenger service. Crew move through explicit launch/arrival/disembark actions; ferries wait if current support is insufficient.",
  "Greedy construction and fixed research remain v1 limitations. Contracts, supply drops and Mars exports are omitted. Same seed labels do not imply matched RNG shocks.",
] as const;

export interface RecoveryPolicyMemory extends CampaignPolicyMemory {
  policyId: typeof RECOVERY_POLICY_ID;
  base: EconomyPolicyMemory;
  repairs: number;
  passengersDelivered: number;
  passengerFlights: number;
}

export function createRecoveryPolicyMemory(): RecoveryPolicyMemory {
  return { policyId: RECOVERY_POLICY_ID, industrySeen: [], base: createEconomyPolicyMemory(), repairs: 0, passengersDelivered: 0, passengerFlights: 0 };
}

export function playRecoveryPolicy(game: Parameters<typeof playEconomyPolicy>[0], memory: RecoveryPolicyMemory, afterAction: (action: CampaignAction) => void = () => {}): PolicyDecision {
  const decision = playEconomyPolicy(game, memory.base, afterAction);
  memory.industrySeen = [...memory.base.industrySeen];
  if (decision.blocked || game.outcome || game.events.length || game.founding) return decision;
  const extra = (action: string, perform: () => { ok: boolean; reason?: string }, remember?: () => void): boolean => {
    if ((memory.base.actionsThisSol ?? 0) >= ECONOMY_POLICY_MAX_ACTIONS) {
      decision.blocked = "Recovery policy action budget reached";
      return false;
    }
    const result = perform();
    if (!result.ok) throw new Error(`${RECOVERY_POLICY_ID} sol ${game.turn}: ${action}: ${result.reason}`);
    memory.base.actionsThisSol = (memory.base.actionsThisSol ?? 0) + 1;
    remember?.();
    afterAction({ sol: game.turn, action });
    return true;
  };
  let patches = 0;
  for (const ship of game.ships) {
    while (!ship.mission && ship.hull < SHIPS[ship.cls].hull * 0.75 && patches < 4) {
      const quote = previewShipRepair(game, ship.id);
      if (!quote.ok || game.credits < quote.cost) {
        decision.deferred.push({ action: `shiprepair ${ship.id}`, reason: quote.reason ?? "Waiting for repair cash without more borrowing" });
        break;
      }
      if (!extra(`shiprepair ${ship.id}`, () => repairShip(game, ship.id), () => memory.repairs++)) return decision;
      patches++;
    }
    const arrival = crewArrivalAdvice(game, ship.id);
    if (arrival.ready && !extra(`disembark ${ship.id}`, () => disembark(game, ship.id), () => { memory.passengersDelivered += arrival.passengers; })) return decision;
  }
  // The founding kit has no pad. A reusable Mars ferry needs a real departure site.
  const mars = game.worlds.mars;
  if (mars.founded && game.ships.some(s => s.cls === "colony" && s.loc === "mars" && !s.mission) && !mars.tiles.some(t => t.building?.type === "pad") && (["luna", "mars"] as const).some(world => crewCapacity(game, world).additional > 0)) {
    const site = mars.tiles.filter(t => !placementError(game, "mars", t.q, t.r, "pad")).sort((a, b) => a.ice - b.ice)[0];
    if (site && !extra(`build mars/pad ${site.q},${site.r}`, () => placeBuilding(game, "mars", site.q, site.r, "pad"))) return decision;
  }
  for (const ship of game.ships) {
    if (ship.cls !== "colony" || ship.mission) continue;
    if (ship.loc === "earth") {
      const plans = (["luna", "mars"] as const).flatMap(world => {
        const plan = crewTransferPlan(game, ship.id, world);
        return plan?.ready && game.credits - plan.cost >= 80 ? [plan] : [];
      }).sort((a, b) => b.passengers - a.passengers);
      const plan = plans[0];
      if (plan) {
        extra(`launch ${ship.id} earth/${plan.world} ${JSON.stringify(plan.draft)}`, () => launchShip(game, ship.id, plan.draft), () => memory.passengerFlights++);
        break;
      }
    } else {
      const plan = crewReturnPlan(game, ship.id);
      if (plan?.ready) {
        extra(`launch ${ship.id} ${ship.loc}/earth ${JSON.stringify(plan.draft)}`, () => launchShip(game, ship.id, plan.draft));
        break;
      }
    }
  }
  return decision;
}
