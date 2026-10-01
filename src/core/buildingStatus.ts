import { tileKey } from "./hex";
import type { Forecast, Placed } from "./types";

export type BuildingStatus = "operating" | "unpowered" | "limited" | "starved" | "standby" | "construction" | "dead";

export interface BuildingStatusInfo { status: BuildingStatus; label: string; symbol: string; }

const LABELS: Record<BuildingStatus, string> = {
  operating: "Operating", unpowered: "Unpowered", limited: "Limited", starved: "Starved",
  standby: "Standby", construction: "Construction", dead: "Offline",
};
const SYMBOLS: Record<BuildingStatus, string> = {
  operating: "OP", unpowered: "NO", limited: "LT", starved: "ST", standby: "SB", construction: "CN", dead: "XX",
};

export function buildingStatus(b: Placed, q: number, r: number, forecast: Forecast | null): BuildingStatusInfo {
  let status: BuildingStatus = "operating";
  const lines = forecast?.tiles[tileKey(q, r)] ?? [];
  const joined = lines.join(" ").toLowerCase();
  if (b.hp <= 15) status = "dead";
  else if (b.progress > 0) status = "construction";
  else if (forecast?.unpowered.includes(tileKey(q, r))) status = "unpowered";
  else if (joined.includes("starved") || joined.includes("short of")) status = "starved";
  else if (joined.includes("standby") || joined.includes("idle")) status = "standby";
  else if (joined.includes("limited") || joined.includes("reduced") || b.hp < 100) status = "limited";
  return { status, label: LABELS[status], symbol: SYMBOLS[status] };
}
