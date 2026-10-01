import type {
  BuildingId,
  CargoId,
  Difficulty,
  ResourceId,
  ShipClass,
  TechId,
  WorldId,
} from "./types";

export interface BuildingDef {
  id: BuildingId;
  name: string;
  group: "power" | "life" | "industry" | "flight" | "science";
  blurb: string;
  cost: { metals: number; credits: number; water: number };
  turns: number;
  power: number;
  housing: number;
  tech?: TechId;
  world?: WorldId;
}

export interface TechDef {
  id: TechId;
  name: string;
  branch: "power" | "life" | "propulsion" | "industry" | "defense" | "terra";
  tier: number;
  cost: number;
  req: TechId[];
  blurb: string;
  capstone?: boolean;
}

export interface ShipDef {
  cls: ShipClass;
  name: string;
  cargo: number;
  fuel: number;
  crew: number;
  hull: number;
  burn: number;
  buildTurns: number;
  credits: number;
  metals: number;
  blurb: string;
}

export const RESOURCE_META: Record<
  ResourceId,
  { label: string; unit: string; color: string; blurb: string }
> = {
  energy: {
    label: "Energy",
    unit: "MWh",
    color: "#ffd36a",
    blurb: "Stored power. Life support is fed first. Dark modules produce nothing.",
  },
  water: {
    label: "Water",
    unit: "t",
    color: "#7ecbff",
    blurb: "Drinking water and the feedstock for ISRU. Ice mines are the source.",
  },
  oxygen: {
    label: "Oxygen",
    unit: "t",
    color: "#d5f6ff",
    blurb: "Cabin air. ISRU cracks it from water and regolith. Running out kills fast.",
  },
  food: {
    label: "Food",
    unit: "t",
    color: "#9be38a",
    blurb: "Greenhouse output. A greenhouse beside ice or an ice mine yields more.",
  },
  metals: {
    label: "Metals",
    unit: "t",
    color: "#e4d2b0",
    blurb: "Structural feedstock from regolith works. Almost every module costs metals.",
  },
  he3: {
    label: "Helium-3",
    unit: "kg",
    color: "#f0b0ff",
    blurb: "Lunar export. Earth pays well, but only a shipped kilogram counts.",
  },
  regolith: {
    label: "Regolith",
    unit: "t",
    color: "#e0a56a",
    blurb: "Loose soil. ISRU eats it. Depots keep the surplus from spilling.",
  },
  propellant: {
    label: "Propellant",
    unit: "t",
    color: "#ffb088",
    blurb: "Methalox boiled by ISRU. Ships will not depart on an empty tank.",
  },
};

export const CARGO_IDS: CargoId[] = [
  "water",
  "oxygen",
  "food",
  "metals",
  "he3",
  "regolith",
  "propellant",
];

export const BUY_PRICE: Record<CargoId, number> = {
  water: 6,
  oxygen: 7,
  food: 5,
  metals: 10,
  he3: 0,
  regolith: 3,
  propellant: 8,
};

export const SELL_PRICE: Record<CargoId, number> = {
  water: 2,
  oxygen: 3,
  food: 2,
  metals: 5,
  he3: 42,
  regolith: 1,
  propellant: 4,
};

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  command: {
    id: "command",
    name: "Command Module",
    group: "science",
    blurb: "Charter anchor. RTG power, housing, and a small research staff. Cannot be rebuilt.",
    cost: { metals: 0, credits: 0, water: 0 },
    turns: 0,
    power: 0,
    housing: 18,
  },
  habitat: {
    id: "habitat",
    name: "Habitat",
    group: "life",
    blurb: "Pressurized quarters. Beside a medical bay, crews sleep better.",
    cost: { metals: 14, credits: 30, water: 0 },
    turns: 2,
    power: 2,
    housing: 14,
  },
  solar: {
    id: "solar",
    name: "Solar Array",
    group: "power",
    blurb: "Thin-film power. Strong on Luna's peaks of eternal light, weak in Martian dust.",
    cost: { metals: 8, credits: 0, water: 0 },
    turns: 1,
    power: 0,
    housing: 0,
  },
  fission: {
    id: "fission",
    name: "Fission Plant",
    group: "power",
    blurb: "Steady kilowatts. Crews dislike living against the shield wall.",
    cost: { metals: 26, credits: 110, water: 0 },
    turns: 3,
    power: 1,
    housing: 0,
    tech: "fission",
  },
  fusion: {
    id: "fusion",
    name: "Compact Fusion",
    group: "power",
    blurb: "Charter capstone reactor. Ends the power argument if you can feed it metals.",
    cost: { metals: 40, credits: 220, water: 0 },
    turns: 4,
    power: 2,
    housing: 0,
    tech: "fusion",
  },
  ice: {
    id: "ice",
    name: "Ice Mine",
    group: "industry",
    blurb: "Thermal drill. Requires an ice deposit. Greenhouses and ISRU love the adjacency.",
    cost: { metals: 14, credits: 0, water: 0 },
    turns: 2,
    power: 3,
    housing: 0,
  },
  isru: {
    id: "isru",
    name: "ISRU Plant",
    group: "industry",
    blurb: "Turns water and regolith into oxygen, propellant, and a little metal.",
    cost: { metals: 10, credits: 0, water: 0 },
    turns: 2,
    power: 4,
    housing: 0,
  },
  greenhouse: {
    id: "greenhouse",
    name: "Greenhouse",
    group: "life",
    blurb: "Crops under film. +30% beside an ice mine or polar ice. Drinks water.",
    cost: { metals: 12, credits: 0, water: 4 },
    turns: 2,
    power: 3,
    housing: 0,
  },
  shipyard: {
    id: "shipyard",
    name: "Shipyard",
    group: "flight",
    blurb: "Gantry and tanks. Builds hulls on this world. Goes dark without power.",
    cost: { metals: 26, credits: 80, water: 0 },
    turns: 3,
    power: 3,
    housing: 0,
  },
  lab: {
    id: "lab",
    name: "Research Lab",
    group: "science",
    blurb: "Shared charter science. Extra output beside a habitat or the command module.",
    cost: { metals: 16, credits: 50, water: 0 },
    turns: 2,
    power: 3,
    housing: 0,
  },
  pad: {
    id: "pad",
    name: "Starship Transport Hub",
    group: "flight",
    blurb: "Robot-assisted landing and cargo handling. One departure per hub per sol. The displayed Starship is illustrative; flyable ships are listed in Fleet.",
    cost: { metals: 16, credits: 30, water: 0 },
    turns: 2,
    power: 1,
    housing: 0,
  },
  defense: {
    id: "defense",
    name: "Point Defense",
    group: "flight",
    blurb: "Kinetic battery. Covers this hex and its neighbors from micrometeorites.",
    cost: { metals: 14, credits: 40, water: 0 },
    turns: 2,
    power: 2,
    housing: 0,
  },
  medical: {
    id: "medical",
    name: "Medical Bay",
    group: "life",
    blurb: "Surgery and quarantine. Unlocks safer answers to illness events.",
    cost: { metals: 12, credits: 50, water: 0 },
    turns: 2,
    power: 2,
    housing: 0,
    tech: "medical",
  },
  he3: {
    id: "he3",
    name: "He-3 Extractor",
    group: "industry",
    blurb: "Luna only. Sifts solar-wind helium from mare soil. Earth's favorite cargo.",
    cost: { metals: 18, credits: 70, water: 0 },
    turns: 2,
    power: 4,
    housing: 0,
    tech: "he3extract",
    world: "luna",
  },
  depot: {
    id: "depot",
    name: "Storage Depot",
    group: "industry",
    blurb: "Sintered tanks and racks. Raises every storage cap on this world.",
    cost: { metals: 10, credits: 0, water: 0 },
    turns: 1,
    power: 0,
    housing: 0,
  },
  regolith: {
    id: "regolith",
    name: "Regolith Works",
    group: "industry",
    blurb: "Excavator and magnetic separator. Metals and ISRU feedstock.",
    cost: { metals: 10, credits: 0, water: 0 },
    turns: 1,
    power: 3,
    housing: 0,
  },
  processor: {
    id: "processor",
    name: "Atmo Processor",
    group: "industry",
    blurb: "Mars only. A thin local oxygen loop and a morale bump. Terraforming, barely.",
    cost: { metals: 24, credits: 130, water: 0 },
    turns: 3,
    power: 5,
    housing: 0,
    tech: "atmos",
    world: "mars",
  },
  robotics: {
    id: "robotics",
    name: "Humanoid Robotics Factory",
    group: "industry",
    blurb: "Builds and maintains humanoid mining robots. Up to +20% ice, regolith, and He-3 output for 1 t metal per sol. Only the strongest powered factory operates; bonuses do not stack.",
    cost: { metals: 24, credits: 100, water: 0 },
    turns: 3,
    power: 5,
    housing: 0,
    tech: "robots",
  },
  aresfab: {
    id: "aresfab",
    name: "Aresfab Chip Foundry",
    group: "industry",
    blurb: "High-density chip fabrication for colony research. Up to 14 RP per sol for 1 t metal and 0.5 t water. Crew water needs come first. Damage or limited supplies reduce output.",
    cost: { metals: 30, credits: 150, water: 0 },
    turns: 3,
    power: 6,
    housing: 0,
    tech: "drones",
  },
};

export const BUILD_MENU: BuildingId[] = [
  "solar",
  "fission",
  "fusion",
  "habitat",
  "greenhouse",
  "medical",
  "ice",
  "regolith",
  "isru",
  "he3",
  "processor",
  "robotics",
  "aresfab",
  "depot",
  "lab",
  "pad",
  "shipyard",
  "defense",
];

export const GROUP_LABEL: Record<BuildingDef["group"], string> = {
  power: "Power",
  life: "Life support",
  industry: "Industry",
  flight: "Flight & defense",
  science: "Science",
};

export const TECHS: TechDef[] = [
  { id: "pv", name: "Photovoltaic Tuning", branch: "power", tier: 0, cost: 12, req: [], blurb: "Solar output +20%. Adjacent arrays share inverters for another +10%." },
  { id: "arrays", name: "High-Efficiency Arrays", branch: "power", tier: 1, cost: 24, req: ["pv"], blurb: "A further +30% from every solar array." },
  { id: "fission", name: "Fission Plants", branch: "power", tier: 1, cost: 30, req: ["pv"], blurb: "Unlocks the fission plant. Dust and night stop mattering." },
  { id: "fusion", name: "Compact Fusion", branch: "power", tier: 2, cost: 60, req: ["fission", "arrays"], capstone: true, blurb: "Capstone. Unlocks the compact fusion module." },
  { id: "eclss", name: "Closed-Loop ECLSS", branch: "life", tier: 0, cost: 12, req: [], blurb: "Life-support consumption −20% on both worlds." },
  { id: "hydro", name: "Hydroponic Bays", branch: "life", tier: 1, cost: 22, req: ["eclss"], blurb: "Greenhouses yield +45% food." },
  { id: "medical", name: "Field Medicine", branch: "life", tier: 1, cost: 20, req: ["eclss"], blurb: "Unlocks the medical bay and safer epidemic choices." },
  { id: "ecology", name: "Closed Ecology", branch: "life", tier: 2, cost: 58, req: ["hydro", "medical"], capstone: true, blurb: "Capstone. Another −15% consumption and a lasting morale lift." },
  { id: "methalox", name: "Methalox ISRU", branch: "propulsion", tier: 0, cost: 14, req: [], blurb: "ISRU propellant +60%. Ship burn −20%." },
  { id: "rendezvous", name: "Precision Rendezvous", branch: "propulsion", tier: 1, cost: 22, req: ["methalox"], blurb: "Transit incident risk −38%." },
  { id: "ntr", name: "Nuclear Thermal", branch: "propulsion", tier: 1, cost: 34, req: ["methalox"], blurb: "Crossings are one sol shorter and burn 10% less." },
  { id: "cycler", name: "Aldrin Cyclers", branch: "propulsion", tier: 2, cost: 64, req: ["ntr", "rendezvous"], capstone: true, blurb: "Capstone. Mars windows cut two extra sols and further reduce risk." },
  { id: "sinter", name: "Regolith Sintering", branch: "industry", tier: 0, cost: 14, req: [], blurb: "Module metal costs −20%. Depots hold more." },
  { id: "robots", name: "Autonomous Mining", branch: "industry", tier: 1, cost: 26, req: ["sinter"], blurb: "Ice mines and regolith works produce +40%. Unlocks humanoid robotics factories." },
  { id: "drones", name: "Shipyard Drones", branch: "industry", tier: 2, cost: 32, req: ["robots"], blurb: "Hulls on a colonial yard finish one sol sooner. Unlocks Aresfab chip foundries." },
  { id: "he3extract", name: "Helion Extraction", branch: "industry", tier: 2, cost: 28, req: ["robots"], blurb: "Unlocks the lunar helium-3 extractor." },
  { id: "shelters", name: "Storm Shelters", branch: "defense", tier: 0, cost: 14, req: [], blurb: "A third, gentler answer to solar storms. Impact damage is lighter." },
  { id: "interceptors", name: "Kinetic Interceptors", branch: "defense", tier: 1, cost: 24, req: ["shelters"], blurb: "Point defense reliably kills micrometeorites. Bare bases sometimes do too." },
  { id: "warning", name: "Early Warning Net", branch: "defense", tier: 1, cost: 22, req: ["shelters"], blurb: "Heliophysics calls storms a sol early. Transit risk drops." },
  { id: "dustmit", name: "Dust Mitigation", branch: "terra", tier: 0, cost: 16, req: [], blurb: "Martian arrays keep more of their output under a dust storm." },
  { id: "algae", name: "Algae Crusts", branch: "terra", tier: 1, cost: 28, req: ["dustmit", "hydro"], blurb: "Mars greenhouses gain a second crop loop." },
  { id: "atmos", name: "Atmospheric Processors", branch: "terra", tier: 2, cost: 56, req: ["algae"], capstone: true, blurb: "Capstone. Unlocks the Mars atmosphere processor." },
];

export const TECH_BY_ID: Record<TechId, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t])) as Record<TechId, TechDef>;

export const BRANCH_LABEL: Record<TechDef["branch"], string> = {
  power: "Power",
  life: "Life support",
  propulsion: "Propulsion",
  industry: "Industry",
  defense: "Defense",
  terra: "Terraforming",
};

export const BRANCH_ORDER: TechDef["branch"][] = ["power", "life", "propulsion", "industry", "defense", "terra"];

export const CAPSTONES: TechId[] = ["fusion", "ecology", "cycler", "atmos"];

export const SHIPS: Record<ShipClass, ShipDef> = {
  courier: {
    cls: "courier",
    name: "Courier",
    cargo: 28,
    fuel: 16,
    crew: 6,
    hull: 48,
    burn: 2,
    buildTurns: 2,
    credits: 180,
    metals: 8,
    blurb: "Fast light hull. One sol off every crossing. Fragile in a gravel storm.",
  },
  freighter: {
    cls: "freighter",
    name: "Freighter",
    cargo: 72,
    fuel: 24,
    crew: 5,
    hull: 74,
    burn: 3,
    buildTurns: 3,
    credits: 320,
    metals: 18,
    blurb: "The workhorse. Room for metals, water, and a contract quota.",
  },
  colony: {
    cls: "colony",
    name: "Colony ship",
    cargo: 120,
    fuel: 32,
    crew: 22,
    hull: 86,
    burn: 4,
    buildTurns: 4,
    credits: 460,
    metals: 24,
    blurb: "The only hull that can found a world. Carries a cadre and a starter kit.",
  },
  tanker: {
    cls: "tanker",
    name: "Tanker",
    cargo: 36,
    fuel: 70,
    crew: 3,
    hull: 64,
    burn: 3,
    buildTurns: 3,
    credits: 300,
    metals: 16,
    blurb: "Propellant tanks first. Use it to pre-position fuel for a Mars window.",
  },
};

export const SHIP_CLASSES: ShipClass[] = ["courier", "freighter", "colony", "tanker"];

export interface DiffMods {
  id: Difficulty;
  label: string;
  blurb: string;
  consumption: number;
  eventChance: number;
  credits: number;
  price: number;
  stock: number;
  hire: number;
  hazard: number;
  overdraft: number;
  bankrupt: number;
  lunaPop: number;
  marsPop: number;
  streak: number;
  techs: number;
  ships: number;
  morale: number;
  halcyonFuel: number;
}

export const DIFF: Record<Difficulty, DiffMods> = {
  survey: {
    id: "survey",
    label: "Survey",
    blurb: "Fuller stores, quieter hazards, a kinder credit line. Learn the corridor.",
    consumption: 0.82,
    eventChance: 0.26,
    credits: 1800,
    price: 0.9,
    stock: 1.22,
    hire: 0.85,
    hazard: 0.7,
    overdraft: -500,
    bankrupt: -1400,
    lunaPop: 28,
    marsPop: 20,
    streak: 2,
    techs: 6,
    ships: 2,
    morale: 78,
    halcyonFuel: 16,
  },
  charter: {
    id: "charter",
    label: "Charter",
    blurb: "The intended campaign. Windows matter, and Earth does not extend infinite credit.",
    consumption: 1,
    price: 1,
    eventChance: 0.4,
    credits: 1280,
    stock: 1,
    hire: 1,
    hazard: 1,
    overdraft: -220,
    bankrupt: -900,
    lunaPop: 40,
    marsPop: 32,
    streak: 3,
    techs: 8,
    ships: 3,
    morale: 72,
    halcyonFuel: 10,
  },
  hardship: {
    id: "hardship",
    label: "Hardship",
    blurb: "Thin tanks, frequent crises, a short leash from Earth. For a second charter.",
    consumption: 1.16,
    eventChance: 0.55,
    credits: 1350,
    price: 1.12,
    stock: 0.82,
    hire: 1.15,
    hazard: 1.3,
    overdraft: -80,
    bankrupt: -650,
    lunaPop: 48,
    marsPop: 38,
    streak: 4,
    techs: 10,
    ships: 4,
    morale: 64,
    halcyonFuel: 8,
  },
};

export const TERRAIN_LABEL: Record<string, string> = {
  mare: "Mare",
  highland: "Highland",
  crater: "Crater",
  polar: "Polar ice",
  rille: "Rille",
  plain: "Plain",
  canyon: "Canyon",
  dust: "Dust basin",
  volcano: "Volcanic rise",
};

export const HIRE_COST = 26;

export const FOUNDING_MIN = {
  crew: 10,
  food: 12,
  water: 10,
  oxygen: 22,
  metals: 44,
};

export const SHIP_NAMES = [
  "Vesper",
  "Meridian",
  "Quiet Sun",
  "Glass Tide",
  "Aphelion",
  "Red Covenant",
  "Lumen",
  "Nadir",
  "Far Counsel",
  "White Orchard",
  "Peregrine",
  "Ash Window",
  "Copper Saint",
  "Low Horizon",
  "Salt Psalm",
  "Kite",
  "Umbra",
  "Solace",
  "Two Rivers",
  "Cold Meridian",
  "Third Bell",
  "Ochre Line",
];

/** Keep order: life support and food before export industry. Shed from the end. */
export const POWER_PRIORITY: BuildingId[] = [
  "pad",
  "habitat",
  "medical",
  "greenhouse",
  "ice",
  "isru",
  "regolith",
  "processor",
  "he3",
  "lab",
  "shipyard",
  "defense",
  "depot",
  "command",
  "solar",
  "fission",
  "fusion",
  "robotics",
  "aresfab",
];
