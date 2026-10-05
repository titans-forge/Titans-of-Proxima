export type Difficulty = "survey" | "charter" | "hardship";
export type WorldId = "luna" | "mars";
export type LocationId = "earth" | "luna" | "mars";
export type Terrain =
  | "mare"
  | "highland"
  | "crater"
  | "polar"
  | "rille"
  | "plain"
  | "canyon"
  | "dust"
  | "volcano";

export const RESOURCES = [
  "energy",
  "water",
  "oxygen",
  "food",
  "metals",
  "he3",
  "regolith",
  "propellant",
] as const;
export type ResourceId = (typeof RESOURCES)[number];
export type CargoId = Exclude<ResourceId, "energy">;
export type Stock = Record<ResourceId, number>;

export const BUILDING_IDS = [
  "command",
  "habitat",
  "solar",
  "fission",
  "fusion",
  "ice",
  "isru",
  "greenhouse",
  "shipyard",
  "lab",
  "pad",
  "defense",
  "medical",
  "he3",
  "depot",
  "regolith",
  "processor",
  "robotics",
  "aresfab",
] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];

export const TECH_IDS = [
  "pv",
  "arrays",
  "fission",
  "fusion",
  "eclss",
  "hydro",
  "medical",
  "ecology",
  "methalox",
  "rendezvous",
  "ntr",
  "cycler",
  "sinter",
  "robots",
  "drones",
  "he3extract",
  "shelters",
  "interceptors",
  "warning",
  "dustmit",
  "algae",
  "atmos",
] as const;
export type TechId = (typeof TECH_IDS)[number];

export type ShipClass = "courier" | "freighter" | "colony" | "tanker";
export type Tone = "info" | "good" | "bad" | "warn";

export interface Tile {
  q: number;
  r: number;
  terrain: Terrain;
  ice: number;
  metal: number;
  he3: number;
  regolith: number;
  variant: number;
  building: Placed | null;
}

export interface Placed {
  type: BuildingId;
  hp: number;
  progress: number;
  total: number;
}

export interface World {
  id: WorldId;
  name: string;
  radius: number;
  founded: boolean;
  tiles: Tile[];
  stock: Stock;
  pop: number;
  morale: number;
  growth: number;
  lowMorale: number;
  streak: number;
  dust: number;
  shelter: number;
  radiation: number;
  quarantine: number;
  foundedTurn: number | null;
  launches: number;
  warnO2: boolean;
  warnFood: boolean;
  warnWater: boolean;
}

export interface Mission {
  from: LocationId;
  to: LocationId;
  eta: number;
  total: number;
  risk: number;
  founding: boolean;
  burn: number;
}

export interface Ship {
  id: string;
  name: string;
  cls: ShipClass;
  loc: LocationId | "transit";
  cargo: Record<CargoId, number>;
  fuel: number;
  crew: number;
  hull: number;
  mission: Mission | null;
}

export interface YardJob {
  id: string;
  cls: ShipClass;
  loc: LocationId;
  eta: number;
  name: string;
}

export interface Delivery {
  id: string;
  dest: WorldId;
  eta: number;
  cargo: Partial<Record<CargoId, number>>;
}

export interface Contract {
  id: string;
  title: string;
  detail: string;
  need: Partial<Record<CargoId, number>>;
  reward: number;
  deadline: number;
}

export interface GameEvent {
  id: string;
  kind: string;
  title: string;
  body: string;
  choices: EventChoice[];
  /** Fixed when a quota is offered; absent in legacy v1 offers. */
  contractDeadline?: number;
}

export interface EventChoice {
  id: string;
  label: string;
  detail: string;
  disabled?: boolean;
}

export interface LogLine {
  turn: number;
  text: string;
  tone: Tone;
}

export interface TechState {
  unlocked: TechId[];
  current: TechId | null;
  progress: number;
}

export interface GameState {
  version: 1;
  id: string;
  seed: number;
  rng: number;
  seq: number;
  turn: number;
  difficulty: Difficulty;
  credits: number;
  worlds: { luna: World; mars: World };
  ships: Ship[];
  yard: YardJob[];
  deliveries: Delivery[];
  tech: TechState;
  contract: Contract | null;
  events: GameEvent[];
  log: LogLine[];
  founding: { shipId: string; world: WorldId } | null;
  foreshadow: "solar" | "dust" | null;
  /** Weather is scheduled independently of whether the player can see it. */
  pendingWeather?: { kind: "solar" | "dust"; dueTurn: number } | null;
  /** Last sol on which each random event kind was enqueued; absent in legacy saves. */
  eventLastTurn?: Record<string, number>;
  priceMul: number;
  priceTurns: number;
  earthLaunches: number;
  script: Record<string, boolean>;
  outcome: null | { kind: "victory" } | { kind: "defeat"; reason: string };
  stats: {
    crises: number;
    launched: number;
    he3Sold: number;
    supplyRuns: number;
  };
}

export interface Forecast {
  produced: Stock;
  consumed: Stock;
  net: Stock;
  energyGen: number;
  energyDraw: number;
  energyNext: number;
  demand: Stock;
  rp: number;
  housing: number;
  brownout: boolean;
  unpowered: string[];
  suff: boolean;
  moraleNext: number;
  moraleTarget: number;
  deaths: number;
  foodShortage: boolean;
  waterShortage: boolean;
  o2Shortage: boolean;
  notes: string[];
  tiles: Record<string, string[]>;
}

export interface Objective {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  progress: string;
}
