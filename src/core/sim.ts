import {
  BUILDINGS,
  CAPSTONES,
  DIFF,
  POWER_PRIORITY,
  SHIPS,
  TECH_BY_ID,
} from "./data";
import { maybeQueueEvent, resolveIncident } from "./events";
import { fmt } from "./format";
import { tileKey } from "./hex";
import { indexTiles, neighborTiles } from "./mapgen";
import { hasTech } from "./routes";
import { emptyCargo, emptyStock, pushLog, uid } from "./state";
import type {
  BuildingId,
  Forecast,
  GameState,
  Objective,
  Placed,
  ResourceId,
  Stock,
  Tile,
  World,
  WorldId,
} from "./types";
import { RESOURCES } from "./types";

const FOOD = 0.32;
const WATER = 0.24;
const OXY = 0.36;
const ENERGY = 0.18;

export interface TurnReport {
  toasts: string[];
  sfx: "turn" | "event" | "win" | "lose" | "arrive";
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function storageCap(state: GameState, world: World): Stock {
  const sinter = hasTech(state, "sinter") ? 1.45 : 1;
  let depots = 0;
  for (const t of world.tiles) {
    const b = t.building;
    if (b?.type === "depot" && b.progress <= 1 && b.hp > 15) depots += 1;
  }
  const base: Stock = {
    energy: 96,
    water: 150,
    oxygen: 150,
    food: 130,
    metals: 130,
    he3: 50,
    regolith: 140,
    propellant: 110,
  };
  const out = emptyStock();
  for (const k of RESOURCES) {
    const depotBonus = (k === "energy" ? 42 : k === "he3" ? 28 : 52) * sinter;
    out[k] = base[k] + (world.founded ? 28 : 0) + depots * depotBonus;
  }
  return out;
}

function active(b: Placed | null): b is Placed {
  return !!b && b.progress <= 1 && b.hp > 15;
}

function hpOf(b: Placed): number {
  return clamp(b.hp / 100, 0.2, 1);
}

export function runway(stock: number, produced: number, demand: number): number | null {
  const deficit = demand - produced;
  if (deficit <= 0.08) return null;
  if (stock <= 0) return 0;
  return stock / deficit;
}

function zeroForecast(world: World): Forecast {
  const z = emptyStock();
  return {
    produced: { ...z },
    consumed: { ...z },
    demand: { ...z },
    net: { ...z },
    energyGen: 0,
    energyDraw: 0,
    energyNext: world.stock.energy,
    rp: 0,
    housing: 0,
    brownout: false,
    unpowered: [],
    suff: false,
    moraleNext: world.morale,
    moraleTarget: world.morale,
    deaths: 0,
    foodShortage: false,
    waterShortage: false,
    o2Shortage: false,
    notes: world.founded ? [] : ["No outpost. Orbital survey only."],
    tiles: {},
  };
}

function note(map: Record<string, string[]>, key: string, line: string): void {
  (map[key] ??= []).push(line);
}

export function forecast(state: GameState, worldId: WorldId): Forecast {
  const world = state.worlds[worldId];
  if (!world.founded) return zeroForecast(world);

  const produced = emptyStock();
  const consumed = emptyStock();
  const demand = emptyStock();
  const notes: string[] = [];
  const tiles: Record<string, string[]> = {};
  const index = indexTiles(world.tiles);
  const mod = consumptionMod(state);
  const qMul = world.quarantine > 0 ? 0.86 : 1;
  const outdoor = world.shelter === 1 ? 0.4 : world.shelter === 2 ? 0.75 : 1;

  interface Row {
    tile: Tile;
    b: Placed;
    key: string;
  }
  const rows: Row[] = [];
  for (const tile of world.tiles) {
    if (!active(tile.building)) continue;
    rows.push({ tile, b: tile.building, key: tileKey(tile.q, tile.r) });
  }

  const neighborActive = (tile: Tile, pred: (b: Placed, n: Tile) => boolean) =>
    neighborTiles(index, tile.q, tile.r).some((n) => active(n.building) && pred(n.building, n));

  let gen = 0;
  let rp = world.pop * 0.06;
  let housing = 0;
  const loads: Row[] = [];

  for (const row of rows) {
    const { b, tile, key } = row;
    const hp = hpOf(b);
    if (b.type === "command") {
      gen += 12;
      rp += 3;
      housing += BUILDINGS.command.housing;
      note(tiles, key, "RTG +12 MWh · research staff");
    } else if (b.type === "habitat") {
      housing += BUILDINGS.habitat.housing;
    } else if (b.type === "solar") {
      let base = world.id === "luna" ? 11 : 7.4;
      if (hasTech(state, "pv")) base *= 1.2;
      if (hasTech(state, "arrays")) base *= 1.3;
      if (world.id === "luna" && tile.terrain === "polar") base *= 1.12;
      if (world.id === "mars" && tile.terrain === "polar") base *= 0.78;
      if (world.id === "mars" && (tile.terrain === "plain" || tile.terrain === "volcano")) base *= 1.08;
      if (world.id === "mars" && world.dust > 0) base *= hasTech(state, "dustmit") ? 0.62 : 0.28;
      if (world.radiation > 0 && world.id === "luna") base *= 0.72;
      if (world.shelter === 1) base *= 0.15;
      else if (world.shelter === 2) base *= 0.55;
      if (hasTech(state, "pv")) {
        const near = neighborTiles(index, tile.q, tile.r).filter((n) => n.building?.type === "solar" && active(n.building)).length;
        if (near >= 2) base *= 1.1;
      }
      const out = base * hp;
      gen += out;
      note(tiles, key, `Array +${fmt(out)} MWh`);
    } else if (b.type === "fission") {
      const out = Math.max(0, 20 * hp - 1);
      gen += out;
      note(tiles, key, `Fission +${fmt(out)} MWh`);
    } else if (b.type === "fusion") {
      const out = Math.max(0, 44 * hp - 2);
      gen += out;
      note(tiles, key, `Fusion +${fmt(out)} MWh`);
    }
    const draw = BUILDINGS[b.type].power;
    if (draw > 0 && b.type !== "fission" && b.type !== "fusion") loads.push(row);
  }

  loads.sort((a, b) => POWER_PRIORITY.indexOf(a.b.type) - POWER_PRIORITY.indexOf(b.b.type));
  const popLoad = world.pop * ENERGY * mod;
  let supply = gen + world.stock.energy;
  const popGot = Math.min(supply, popLoad);
  supply -= popGot;
  const brownout = popLoad > 0.05 && popGot < popLoad - 0.05;
  const unpowered: string[] = [];
  const powered = new Set<string>();
  let paid = popGot;
  for (const row of loads) {
    const draw = BUILDINGS[row.b.type].power;
    if (draw <= supply + 1e-6) {
      supply -= draw;
      paid += draw;
      powered.add(row.key);
    } else {
      unpowered.push(row.key);
      note(tiles, row.key, "Unpowered");
    }
  }
  const desiredDraw = popLoad + loads.reduce((s, row) => s + BUILDINGS[row.b.type].power, 0);
  const cap = storageCap(state, world);
  const energyNext = clamp(supply, 0, cap.energy);
  produced.energy = gen;
  consumed.energy = paid;
  demand.energy = desiredDraw;

  const isPowered = (row: Row) => BUILDINGS[row.b.type].power <= 0 || powered.has(row.key) || row.b.type === "fission" || row.b.type === "fusion" || row.b.type === "command";

  let waterPool = world.stock.water;
  let regPool = world.stock.regolith;

  // Upkeep is paid from opening metal only. One eligible factory is selected
  // deterministically; duplicate factories are standby and never stack.
  const openingMetals = Math.max(0, world.stock.metals);
  const robotics = world.tiles
    .filter((t) => t.building?.type === "robotics")
    .sort((a, b) => hpOf(b.building!) - hpOf(a.building!) || tileKey(a.q, a.r).localeCompare(tileKey(b.q, b.r)));
  let roboticsBonus = 1;
  let robotOperator: Tile | null = null;
  for (const tile of robotics) {
    const b = tile.building!;
    const key = tileKey(tile.q, tile.r);
    if (b.progress > 1) { note(tiles, key, "Robotics construction — standby"); continue; }
    if (b.hp <= 15) { note(tiles, key, "Robotics offline — dead"); continue; }
    if (!isPowered({ tile, b, key })) { note(tiles, key, "Robotics standby — unpowered"); continue; }
    if (robotOperator) { note(tiles, key, "Robotics standby — another factory operates"); continue; }
    robotOperator = tile;
    const scale = hpOf(b) * qMul;
    const want = scale;
    const actual = Math.min(openingMetals, want);
    demand.metals += want;
    consumed.metals += actual;
    const funded = want > 0 ? actual / want : 0;
    roboticsBonus = 1 + 0.2 * scale * funded;
    note(tiles, key, actual + 1e-6 >= want ? `Robotics operating · −${fmt(actual)} t metals · mining +${fmt((roboticsBonus - 1) * 100)}%` : actual > 0 ? `Robotics limited · −${fmt(actual)} t metals · mining +${fmt((roboticsBonus - 1) * 100)}%` : "Robotics starved — no opening-stock metals");
  }

  for (const row of rows) {
    if (!isPowered(row)) continue;
    const hp = hpOf(row.b);
    const { tile, key } = row;
    if (row.b.type === "ice") {
      let water = (3 + tile.ice / 22) * hp;
      if (tile.terrain === "polar") water += 1.6 * hp;
      if (hasTech(state, "robots")) water *= 1.4;
      water *= qMul * outdoor * roboticsBonus;
      const reg = 0.8 * hp * (hasTech(state, "robots") ? 1.4 : 1) * qMul * outdoor * roboticsBonus;
      const met = 0.45 * hp * qMul * outdoor * roboticsBonus;
      produced.water += water;
      produced.regolith += reg;
      produced.metals += met;
      waterPool += water;
      regPool += reg;
      note(tiles, key, `Ice +${fmt(water)} t water`);
    } else if (row.b.type === "regolith") {
      let reg = (3 + tile.regolith / 40) * hp;
      let met = (2.8 + tile.metal / 28) * hp;
      if (hasTech(state, "robots")) {
        reg *= 1.4;
        met *= 1.4;
      }
      reg *= qMul * outdoor;
      met *= qMul * outdoor * roboticsBonus;
      reg *= roboticsBonus;
      produced.regolith += reg;
      produced.metals += met;
      regPool += reg;
      note(tiles, key, `Works +${fmt(met)} t metals · +${fmt(reg)} t regolith`);
    } else if (row.b.type === "he3") {
      let he = (1.25 + tile.he3 / 50) * hp;
      if (hasTech(state, "robots")) he *= 1.25;
      he *= qMul * (world.shelter === 1 ? 0.35 : outdoor) * roboticsBonus;
      produced.he3 += he;
      note(tiles, key, `Extract +${fmt(he)} kg He-3`);
    } else if (row.b.type === "processor") {
      produced.oxygen += 2.3 * hp * qMul;
      produced.food += 0.7 * hp * qMul;
      note(tiles, key, "Processor oxygen loop");
    } else if (row.b.type === "lab") {
      let gain = 4 * hp;
      if (neighborActive(tile, (b) => b.type === "habitat" || b.type === "command")) gain += 2;
      gain *= world.quarantine > 0 ? 0.8 : 1;
      rp += gain;
      note(tiles, key, `Lab +${fmt(gain)} RP`);
    }
  }

  for (const row of rows) {
    if (!isPowered(row) || row.b.type !== "greenhouse") continue;
    const hp = hpOf(row.b);
    let food = 6.4 * hp;
    if (hasTech(state, "hydro")) food *= 1.45;
    if (world.id === "mars" && hasTech(state, "algae")) food *= 1.35;
    const besideIce =
      neighborActive(row.tile, (b) => b.type === "ice") ||
      neighborTiles(index, row.tile.q, row.tile.r).some((n) => n.terrain === "polar" || n.ice >= 50);
    if (besideIce) food *= 1.3;
    food *= qMul;
    if (world.shelter === 1) food *= 0.88;
    const want = 1.6;
    demand.water += want;
    if (waterPool < want) {
      food *= 0.4;
      consumed.water += waterPool;
      waterPool = 0;
      note(tiles, row.key, "Greenhouse thirsty — reduced crop");
    } else {
      waterPool -= want;
      consumed.water += want;
    }
    produced.food += food;
    note(tiles, row.key, `Crop +${fmt(food)} t`);
  }

  for (const row of rows) {
    if (!isPowered(row) || row.b.type !== "isru") continue;
    const hp = hpOf(row.b);
    let scale = hp * (neighborActive(row.tile, (b) => b.type === "ice") ? 1.25 : 1);
    scale *= qMul;
    if (world.shelter === 1) scale *= 0.55;
    else if (world.shelter === 2) scale *= 0.8;
    const wantW = 3 * scale;
    const wantR = 2 * scale;
    demand.water += wantW;
    demand.regolith += wantR;
    const eff = wantW <= 0 ? 0 : Math.min(1, waterPool / wantW, regPool / Math.max(0.001, wantR));
    if (eff > 0.02) {
      const useW = wantW * eff;
      const useR = wantR * eff;
      waterPool -= useW;
      regPool -= useR;
      consumed.water += useW;
      consumed.regolith += useR;
      produced.oxygen += 4.6 * scale * eff;
      produced.propellant += (hasTech(state, "methalox") ? 4.3 : 2.7) * scale * eff;
      produced.metals += 1.15 * scale * eff;
      note(tiles, row.key, `ISRU${eff < 1 - 1e-6 ? " limited" : ""} +${fmt(4.6 * scale * eff)} t oxygen`);
    } else note(tiles, row.key, "ISRU idle — short of water or regolith");
  }

  const needFood = world.pop * FOOD * mod;
  const needWater = world.pop * WATER * mod;
  const needO2 = world.pop * OXY * mod;
  demand.food += needFood;
  demand.water += needWater;
  demand.oxygen += needO2;

  const take = (res: ResourceId, need: number) => {
    const have = world.stock[res] + produced[res] - consumed[res];
    const actual = Math.min(Math.max(0, have), need);
    consumed[res] += actual;
    return actual;
  };
  const gotFood = take("food", needFood);
  const gotWater = take("water", needWater);
  const gotO2 = take("oxygen", needO2);
  const foodShortage = needFood > 0.05 && gotFood < needFood - 0.05;
  const waterShortage = needWater > 0.05 && gotWater < needWater - 0.05;
  const o2Shortage = needO2 > 0.05 && gotO2 < needO2 - 0.05;

  // Foundries run after life support has taken its water. They may use metal
  // mined this sol, but never displace people for fictional chip-fabrication RP.
  const fabs = rows.filter((row) => row.b.type === "aresfab" && isPowered(row)).sort((a, b) => a.key.localeCompare(b.key));
  for (const tile of world.tiles.filter((t) => t.building?.type === "aresfab").sort((a, b) => tileKey(a.q, a.r).localeCompare(tileKey(b.q, b.r)))) {
    const b = tile.building!;
    const key = tileKey(tile.q, tile.r);
    if (b.progress > 1) note(tiles, key, "Aresfab construction — idle");
    else if (b.hp <= 15) note(tiles, key, "Aresfab offline — dead");
    else if (!fabs.some((f) => f.key === key)) note(tiles, key, "Aresfab idle — unpowered");
  }
  for (const row of fabs) {
    const scale = hpOf(row.b) * qMul;
    const wantMetal = scale;
    const wantWater = 0.5 * scale;
    demand.metals += wantMetal;
    demand.water += wantWater;
    const availableMetal = Math.max(0, world.stock.metals + produced.metals - consumed.metals);
    const availableWater = Math.max(0, world.stock.water + produced.water - consumed.water);
    const eff = Math.min(1, availableMetal / Math.max(0.001, wantMetal), availableWater / Math.max(0.001, wantWater));
    const useMetal = wantMetal * eff;
    const useWater = wantWater * eff;
    consumed.metals += useMetal;
    consumed.water += useWater;
    if (eff > 0) {
      const out = 14 * scale * eff;
      rp += out;
      note(tiles, row.key, `Aresfab${eff < 1 - 1e-6 ? " limited" : ""} +${fmt(out)} RP · −${fmt(useMetal)} t metals · −${fmt(useWater)} t water`);
    } else note(tiles, row.key, "Aresfab idle — short of post-life-support metals or water");
  }

  const hazard = DIFF[state.difficulty].hazard;
  let deaths = 0;
  if (o2Shortage) deaths += Math.max(1, Math.ceil(world.pop * 0.12 * hazard));
  if (foodShortage) deaths += Math.max(1, Math.ceil(world.pop * 0.08 * hazard));
  if (waterShortage) deaths += Math.max(1, Math.ceil(world.pop * 0.05 * hazard));
  deaths = Math.min(world.pop, deaths);

  const medical = rows.some((row) => row.b.type === "medical" && isPowered(row));
  const defense = rows.some((row) => row.b.type === "defense" && isPowered(row));
  const processor = rows.some((row) => row.b.type === "processor" && isPowered(row));
  let habs = 0;
  let covered = 0;
  let fissionGrief = 0;
  for (const row of rows) {
    if (row.b.type === "habitat") {
      habs += 1;
      if (neighborActive(row.tile, (b) => b.type === "medical")) covered += 1;
    }
    if (row.b.type === "fission" && neighborActive(row.tile, (b) => b.type === "habitat" || b.type === "command")) fissionGrief += 1;
  }

  let target = 56;
  if (!foodShortage && produced.food + 0.05 >= demand.food) target += 6;
  else target -= 12;
  if (!waterShortage && produced.water + 0.05 >= demand.water) target += 4;
  else if (waterShortage) target -= 8;
  if (!o2Shortage && produced.oxygen + 0.05 >= demand.oxygen) target += 5;
  else if (o2Shortage) target -= 14;
  if (!brownout && gen + 0.15 >= desiredDraw) target += 4;
  else target -= 8;
  const excess = world.pop - housing;
  if (excess > 0) target -= excess * 5;
  if (medical) target += 6;
  if (habs > 0 && covered === habs) target += 4;
  target -= fissionGrief * 6;
  if (world.dust > 0) target -= 5;
  if (world.radiation > 0) target -= 4;
  if (world.shelter === 1) target -= 2;
  if (state.credits < 0) target -= 4;
  if (hasTech(state, "ecology")) target += 6;
  if (processor) target += 3;
  if (defense) target += 2;
  const darkHabs = rows.filter((row) => row.b.type === "habitat" && !isPowered(row)).length;
  target -= darkHabs * 3;
  target = clamp(target, 0, 100);
  const moraleNext = clamp(world.morale + (target - world.morale) * 0.42, 0, 100);

  const net = emptyStock();
  for (const k of RESOURCES) net[k] = produced[k] - demand[k];

  const suff =
    world.pop > 0 &&
    deaths === 0 &&
    !brownout &&
    net.food >= -0.05 &&
    net.water >= -0.05 &&
    net.oxygen >= -0.05 &&
    gen + 0.15 >= desiredDraw &&
    world.stock.food > 5 &&
    world.stock.water > 5 &&
    world.stock.oxygen > 5;

  if (brownout) notes.push("Life support is browning out.");
  if (world.dust > 0) notes.push(`Dust storm · ${world.dust} sol${world.dust === 1 ? "" : "s"} left.`);
  if (world.shelter === 1) notes.push("Arrays and mines are powered down.");
  if (world.shelter === 2) notes.push("Shelter protocol — partial power.");
  if (world.radiation > 0) notes.push("Radiation elevated.");
  if (world.quarantine > 0) notes.push("Quarantine slows the works.");
  if (suff) notes.push("This sol counts as self-sufficient.");
  else if (world.pop > 0) notes.push("Not yet self-sufficient.");
  if (excess > 0) notes.push(`Overcrowded by ${excess}.`);

  return {
    produced,
    consumed,
    demand,
    net,
    energyGen: gen,
    energyDraw: desiredDraw,
    energyNext,
    rp,
    housing,
    brownout,
    unpowered,
    suff,
    moraleNext,
    moraleTarget: target,
    deaths,
    foodShortage,
    waterShortage,
    o2Shortage,
    notes,
    tiles,
  };
}

function consumptionMod(state: GameState): number {
  let m = DIFF[state.difficulty].consumption;
  if (hasTech(state, "eclss")) m *= 0.8;
  if (hasTech(state, "ecology")) m *= 0.85;
  return m;
}

function applyEconomy(state: GameState, worldId: WorldId, f: Forecast): void {
  const world = state.worlds[worldId];
  if (!world.founded) {
    tickTimers(world);
    return;
  }
  const cap = storageCap(state, world);
  for (const k of RESOURCES) {
    if (k === "energy") {
      world.stock.energy = r2(clamp(f.energyNext, 0, cap.energy));
      continue;
    }
    const next = world.stock[k] + f.produced[k] - f.consumed[k];
    world.stock[k] = r2(clamp(next, 0, cap[k]));
  }

  if (f.deaths > 0) {
    world.pop = Math.max(0, world.pop - f.deaths);
    world.morale = clamp(world.morale - f.deaths * 3, 0, 100);
    const why = [f.o2Shortage ? "oxygen" : "", f.foodShortage ? "food" : "", f.waterShortage ? "water" : ""].filter(Boolean).join(", ");
    pushLog(state, `${world.name} loses ${f.deaths} to ${why || "shortages"}. Population ${world.pop}.`, "bad");
  } else if (
    world.pop > 0 &&
    world.pop < f.housing &&
    world.morale >= 62 &&
    world.stock.food > 8 &&
    world.stock.oxygen > 6 &&
    world.stock.water > 6 &&
    !f.brownout
  ) {
    let rate = 0.34;
    if (hasTech(state, "ecology")) rate += 0.12;
    if (world.tiles.some((t) => t.building?.type === "medical" && active(t.building) && !f.unpowered.includes(tileKey(t.q, t.r)))) rate += 0.1;
    world.growth += rate;
    if (world.growth >= 1) {
      world.growth -= 1;
      world.pop += 1;
      pushLog(state, `${world.name} records a birth. Population ${world.pop}.`, "good");
    }
  }

  world.morale = r2(f.moraleNext);
  if (world.morale < 8) world.lowMorale += 1;
  else world.lowMorale = 0;
  if (f.suff) world.streak += 1;
  else world.streak = 0;

  warnRunway(state, world, "oxygen", f, world.warnO2, (v) => (world.warnO2 = v));
  warnRunway(state, world, "food", f, world.warnFood, (v) => (world.warnFood = v));
  warnRunway(state, world, "water", f, world.warnWater, (v) => (world.warnWater = v));

  for (const t of world.tiles) {
    const b = t.building;
    if (!b || b.progress <= 0) continue;
    b.progress -= 1;
    if (b.progress === 0) {
      pushLog(state, `${BUILDINGS[b.type].name} completed at ${world.name}.`, "good");
    }
  }
  tickTimers(world);
}

function warnRunway(
  state: GameState,
  world: World,
  res: "oxygen" | "food" | "water",
  f: Forecast,
  flagged: boolean,
  setFlag: (v: boolean) => void,
): void {
  const left = runway(world.stock[res], f.produced[res], f.demand[res]);
  if (left !== null && left < 4) {
    if (!flagged) {
      pushLog(state, `${world.name} ${res} runway is under four sols.`, "warn");
      setFlag(true);
    }
  } else if (left === null || left > 6) setFlag(false);
}

function tickTimers(world: World): void {
  if (world.dust > 0) world.dust -= 1;
  if (world.radiation > 0) world.radiation -= 1;
  if (world.quarantine > 0) world.quarantine -= 1;
  world.shelter = 0;
  world.launches = 0;
}

export function researchRate(state: GameState): number {
  return forecast(state, "luna").rp + forecast(state, "mars").rp;
}

export function suggestions(state: GameState, worldId: WorldId): BuildingId[] {
  const world = state.worlds[worldId];
  if (!world.founded) return [];
  const f = forecast(state, worldId);
  const out: BuildingId[] = [];
  const pending = new Set(world.tiles.flatMap((t) => t.building && t.building.progress > 0 ? [t.building.type] : []));
  const consider = (id: BuildingId, when: boolean) => {
    if (when && !pending.has(id)) out.push(id);
  };
  const food = runway(world.stock.food, f.produced.food, f.demand.food);
  const water = runway(world.stock.water, f.produced.water, f.demand.water);
  const o2 = runway(world.stock.oxygen, f.produced.oxygen, f.demand.oxygen);
  const feedstockLimited = world.tiles.some(t => t.building?.type === "isru" &&
    f.tiles[tileKey(t.q, t.r)]?.some(line => line.includes("limited") || line.includes("idle")));
  consider("solar", f.brownout || f.unpowered.length > 0);
  consider("ice", water !== null && (water < 12 || !world.tiles.some(t => active(t.building) && t.building.type === "ice")));
  // Protect the starter metal budget and supply ISRU before adding consumers.
  consider("regolith", f.produced.metals < 1 || (feedstockLimited && f.net.regolith < 0));
  consider("greenhouse", food !== null && food < 12);
  consider("isru", o2 !== null && o2 < 12 && !feedstockLimited);
  consider("solar", f.energyGen + 0.2 < f.energyDraw || f.brownout);
  consider("habitat", f.housing - world.pop < 4);
  consider("lab", state.tech.current !== null && f.rp < 6);
  return [...new Set(out)];
}

export function objectives(state: GameState): Objective[] {
  const d = DIFF[state.difficulty];
  const luna = state.worlds.luna;
  const mars = state.worlds.mars;
  const techN = state.tech.unlocked.length;
  const cap = CAPSTONES.some((id) => state.tech.unlocked.includes(id));
  const fleet = state.ships.length;
  return [
    {
      id: "mars",
      label: "Found Eos Reach on Mars",
      detail: "Land a colony ship during or between windows and choose a site beside ice.",
      done: mars.founded,
      progress: mars.founded ? "Landed" : "No outpost",
    },
    {
      id: "luna",
      label: `Luna self-sufficient (${luna.streak}/${d.streak})`,
      detail: `Population ${d.lunaPop}+ and ${d.streak} sols in a row with non-negative food, water, oxygen, and power.`,
      done: luna.streak >= d.streak && luna.pop >= d.lunaPop,
      progress: `Pop ${luna.pop}/${d.lunaPop}`,
    },
    {
      id: "mars-ss",
      label: `Mars self-sufficient (${mars.streak}/${d.streak})`,
      detail: `Population ${d.marsPop}+ and the same ${d.streak}-sol streak under Martian dust.`,
      done: mars.founded && mars.streak >= d.streak && mars.pop >= d.marsPop,
      progress: mars.founded ? `Pop ${mars.pop}/${d.marsPop}` : "Unfounded",
    },
    {
      id: "fleet",
      label: `Fleet of ${d.ships} hulls`,
      detail: "Couriers, freighters, tankers, and colony ships all count, in flight or docked.",
      done: fleet >= d.ships,
      progress: `${fleet}/${d.ships}`,
    },
    {
      id: "tech",
      label: `Research ${d.techs} technologies, including a capstone`,
      detail: "Capstones: Compact Fusion, Closed Ecology, Aldrin Cyclers, Atmospheric Processors.",
      done: techN >= d.techs && cap,
      progress: `${techN}/${d.techs}${cap ? " · capstone" : ""}`,
    },
    {
      id: "solvent",
      label: "Charter solvent",
      detail: "Credits at or above zero. Earth will finance a deficit — until it doesn't.",
      done: state.credits >= 0,
      progress: `${Math.round(state.credits)} cr`,
    },
  ];
}

export function blockingReason(state: GameState): string | null {
  if (state.outcome?.kind === "victory") return "The charter is complete.";
  if (state.outcome?.kind === "defeat") return "The charter is closed.";
  if (state.events.length > 0) return "A situation needs an order.";
  if (state.founding) return "Choose a landing site.";
  return null;
}

function checkOutcome(state: GameState): GameState["outcome"] {
  const d = DIFF[state.difficulty];
  const limit = state.difficulty === "hardship" ? 3 : 4;
  for (const world of [state.worlds.luna, state.worlds.mars]) {
    if (!world.founded) continue;
    if (world.pop <= 0) {
      state.outcome = { kind: "defeat", reason: `${world.name} collapsed. There is no one left to answer the radio.` };
      return state.outcome;
    }
    if (world.lowMorale >= limit) {
      state.outcome = { kind: "defeat", reason: `${world.name} abandons the charter. Morale broke, and the crews walked the contract.` };
      return state.outcome;
    }
  }
  if (state.credits <= d.bankrupt) {
    state.outcome = { kind: "defeat", reason: "Earth revokes the charter. The credit line is closed and the flags come down." };
    return state.outcome;
  }
  if (objectives(state).every((o) => o.done)) state.outcome = { kind: "victory" };
  return state.outcome;
}

export function applyTurn(state: GameState): TurnReport {
  if (state.outcome) return { toasts: ["The charter is already closed."], sfx: state.outcome.kind === "victory" ? "win" : "lose" };
  const toasts: string[] = [];
  const fl = forecast(state, "luna");
  const fm = forecast(state, "mars");
  applyEconomy(state, "luna", fl);
  applyEconomy(state, "mars", fm);

  if (state.credits < 0) {
    const fee = Math.min(60, Math.max(12, Math.abs(state.credits) * 0.04));
    state.credits = r2(state.credits - fee);
    pushLog(state, `Debt service ${fmt(fee)} credits.`, "warn");
  }
  if (state.priceTurns > 0) {
    state.priceTurns -= 1;
    if (state.priceTurns <= 0) {
      state.priceMul = 1;
      pushLog(state, "Earth prices ease back to the posted tariff.", "info");
    }
  }

  let arrived = 0;
  for (const ship of [...state.ships]) {
    if (!ship.mission) continue;
    ship.mission.eta -= 1;
    if (ship.mission.eta > 0) continue;
    const dest = ship.mission.to;
    const founding = ship.mission.founding;
    resolveIncident(state, ship, false);
    if (!state.ships.includes(ship)) {
      toasts.push(`${ship.name} is lost.`);
      continue;
    }
    ship.loc = dest;
    ship.mission = null;
    arrived += 1;
    if (founding && dest !== "earth" && !state.worlds[dest].founded && ship.crew >= 8) {
      state.founding = { shipId: ship.id, world: dest };
      pushLog(state, `${ship.name} is in orbit over ${state.worlds[dest].name}. Choose a landing hex.`, "good");
      toasts.push(`${ship.name} awaiting landing orders.`);
    } else {
      pushLog(state, `${ship.name} docks at ${dest === "earth" ? "Earth" : state.worlds[dest].name}.`, "info");
      toasts.push(`${ship.name} docked at ${dest === "earth" ? "Earth" : dest}.`);
    }
  }

  const remainingDeliveries = [];
  for (const drop of state.deliveries) {
    drop.eta -= 1;
    if (drop.eta > 0) {
      remainingDeliveries.push(drop);
      continue;
    }
    const world = state.worlds[drop.dest];
    if (!world.founded) {
      pushLog(state, `A supply drop reaches ${world.name} and finds no one. Cargo lost.`, "bad");
      continue;
    }
    const cap = storageCap(state, world);
    for (const [k, v] of Object.entries(drop.cargo) as [keyof typeof drop.cargo, number][]) {
      if (!v) continue;
      world.stock[k] = r2(Math.min(cap[k], world.stock[k] + v));
    }
    state.stats.supplyRuns += 1;
    pushLog(state, `Supply drop lands at ${world.name}.`, "good");
    toasts.push(`Supply drop at ${world.name}.`);
  }
  state.deliveries = remainingDeliveries;

  const yardLeft = [];
  for (const job of state.yard) {
    if (job.loc !== "earth") {
      const world = state.worlds[job.loc];
      const f = job.loc === "luna" ? fl : fm;
      const ready = world.tiles.some((t) => {
        const b = t.building;
        return b?.type === "shipyard" && b.progress <= 1 && b.hp > 15 && !f.unpowered.includes(tileKey(t.q, t.r));
      });
      if (!ready) {
        pushLog(state, `Shipyard at ${world.name} is dark or unfinished. ${job.name} waits.`, "warn");
        yardLeft.push(job);
        continue;
      }
    }
    job.eta -= 1;
    if (job.eta > 0) {
      yardLeft.push(job);
      continue;
    }
    const def = SHIPS[job.cls];
    state.ships.push({
      id: uid(state, "ship"),
      name: job.name,
      cls: job.cls,
      loc: job.loc,
      cargo: emptyCargo(),
      fuel: 0,
      crew: 1,
      hull: def.hull,
      mission: null,
    });
    pushLog(state, `${job.name} (${def.name}) is commissioned at ${job.loc === "earth" ? "Earth" : state.worlds[job.loc].name}.`, "good");
    toasts.push(`${job.name} commissioned.`);
  }
  state.yard = yardLeft;

  if (state.tech.current) {
    const gain = fl.rp + fm.rp;
    state.tech.progress += gain;
    const def = state.tech.current;
    if (state.tech.progress >= TECH_BY_ID[def].cost) {
      state.tech.unlocked.push(def);
      state.tech.current = null;
      state.tech.progress = 0;
      pushLog(state, `Research complete: ${TECH_BY_ID[def].name}.`, "good");
      toasts.push("Research complete.");
    }
  }

  if (state.contract && state.turn >= state.contract.deadline) {
    state.credits -= 120;
    for (const w of [state.worlds.luna, state.worlds.mars]) if (w.founded) w.morale = clamp(w.morale - 5, 0, 100);
    pushLog(state, `Quota missed (${state.contract.title}). Earth fines the charter 120 credits.`, "bad");
    state.contract = null;
  }

  const outcome = checkOutcome(state);
  if (outcome) {
    pushLog(
      state,
      outcome.kind === "victory" ? "The charter is the corridor. Luna and Mars both hold." : outcome.reason,
      outcome.kind === "victory" ? "good" : "bad",
    );
    return { toasts: [outcome.kind === "victory" ? "Victory." : "Charter lost."], sfx: outcome.kind === "victory" ? "win" : "lose" };
  }

  maybeQueueEvent(state);
  state.turn += 1;
  state.earthLaunches = 0;

  if (state.turn === 5 && !state.script.halcyon) {
    state.script.halcyon = true;
    state.ships.push({
      id: uid(state, "ship"),
      name: "PAS Halcyon",
      cls: "colony",
      loc: "earth",
      cargo: emptyCargo(),
      fuel: DIFF[state.difficulty].halcyonFuel,
      crew: 2,
      hull: SHIPS.colony.hull,
      mission: null,
    });
    pushLog(state, "Earth releases PAS Halcyon. The Mars window is open. Crew the hull and load a founding kit.", "good");
    toasts.push("PAS Halcyon is at Earth dock.");
  }

  if (toasts.length === 0) toasts.push(`Sol ${state.turn - 1} resolved.`);
  let sfx: TurnReport["sfx"] = "turn";
  if (state.events.length) sfx = "event";
  else if (arrived > 0) sfx = "arrive";
  return { toasts, sfx };
}
