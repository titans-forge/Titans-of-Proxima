import { nextRand } from "./rng";
import { indexTiles, neighborTiles } from "./mapgen";
import { pushLog, uid } from "./state";
import { hasTech } from "./routes";
import { DIFF, FOUNDING_MIN } from "./data";
import type { GameState, WorldId } from "./types";

function choice(id: string, label: string, detail: string, disabled = false) {
  return { id, label, detail, disabled };
}

function defended(state: GameState, worldId: WorldId): boolean {
  const world = state.worlds[worldId];
  const index = indexTiles(world.tiles);
  return world.tiles.some((t) => {
    const b = t.building;
    if (!b || b.type !== "defense" || b.progress > 0 || b.hp <= 20) return false;
    return true;
  }) && index.size > 0;
}

function hasMedical(state: GameState): boolean {
  for (const id of ["luna", "mars"] as const) {
    if (state.worlds[id].tiles.some((t) => t.building?.type === "medical" && t.building.progress === 0 && t.building.hp > 20)) {
      return true;
    }
  }
  return false;
}

export function enqueueEvent(state: GameState, kind: string): void {
  if (state.events.length > 0 || state.outcome) return;
  const ev = makeEvent(state, kind);
  if (ev) {
    state.events.push(ev);
    state.eventLastTurn ??= {};
    state.eventLastTurn[kind] = state.turn;
  }
}

function makeEvent(state: GameState, kind: string) {
  const id = uid(state, "ev");
  if (kind === "solar") {
    const mild = !state.script.solarDone;
    const choices = [
      choice("shelter", "Power down the prospect", "Next sol, arrays and surface mines nearly stop. Hardware is preserved."),
      choice(
        "ride",
        "Ride it out",
        mild
          ? "Keep the grids up. Expect scorched arrays and a sour watch."
          : "Arrays take a real hit. Transits near Luna get louder.",
      ),
    ];
    if (hasTech(state, "shelters")) {
      choices.push(choice("protocol", "Shelter protocol", "Crews under cover, arrays partly furled. Reduced output, no damage."));
    }
    return {
      id,
      kind,
      title: mild ? "Coronal mass ejection — advisory" : "Coronal mass ejection",
      body: mild
        ? "Shackleton's dosimeters climb. Earth calls it an advisory. You still have to choose how the next sol is spent."
        : "A full ejection is on the lunar face. Unsheltered film and anyone in the open will carry it.",
      choices,
    };
  }
  if (kind === "dust") {
    const mars = state.worlds.mars;
    if (!mars.founded) return null;
    const choices = [
      choice("seal", "Seal the hatches", "Three sols of dust. Solar collapses. Crews stay inside and morale dips."),
      choice("eva", "Keep the works running", "Same storm, but an EVA pulls extra metals. Someone may not come back if there is no medical bay."),
    ];
    if (hasTech(state, "dustmit")) {
      choices.push(choice("mitigated", "Dust protocol", "Mitigation gear shortens the storm to two sols without an EVA."));
    }
    return {
      id,
      kind,
      title: "Regional dust storm",
      body: `Eos Reach is browning out. Optical depth will smother the arrays${mars.dust > 0 ? " again" : ""}.`,
      choices,
    };
  }
  if (kind === "meteor") {
    const guns = defended(state, "luna") || hasTech(state, "interceptors");
    return {
      id,
      kind,
      title: "Micrometeorite swarm",
      body: "Radar paints a gravel front over Shackleton. There is time for one instruction.",
      choices: [
        choice(
          "dodge",
          "Burn propellant and dodge",
          state.worlds.luna.stock.propellant >= 6
            ? "Spend 6 t of propellant to shift the habs off the worst of the track."
            : "Not enough propellant on Luna.",
          state.worlds.luna.stock.propellant < 6,
        ),
        choice(
          "guns",
          guns ? "Trust the battery" : "Hope the gravel misses",
          guns
            ? "Point defense or the interceptor net should take it."
            : "No battery covers the prospect. This is a coin toss you will probably lose.",
        ),
        choice("hit", "Accept the strike", "A module loses a large share of its integrity. Crews will feel it."),
      ],
    };
  }
  if (kind === "contract") {
    const late = state.turn > 16 && hasTech(state, "he3extract");
    const reward = late ? 520 : 280;
    const what = late ? "8 kg of helium-3" : "22 t of metals";
    return {
      id,
      kind,
      title: late ? "Helium-3 quota" : "Structural metals quota",
      body: `An Earth consortium will pay ${reward} credits if ${what} arrives at Earth dock by sol ${state.turn + (late ? 16 : 12)}. Miss it and they will fine the charter.`,
      choices: [
        choice("accept", "Accept the quota", "The contract is tracked on the Earth desk. Deliver from a ship in Earth orbit."),
        choice("decline", "Decline", "No penalty. The desk will offer other work later."),
      ],
    };
  }
  if (kind === "shortage") {
    return {
      id,
      kind,
      title: "Earth supply short",
      body: "A strike in the Kourou yards and a bad harvest in the closed farms. Export prices jump unless you buy a reserve now.",
      choices: [
        choice(
          "buy",
          "Buy a reserve for Luna",
          state.credits >= 170 ? "Pay 160 credits. Food, water, and oxygen arrive in two sols." : "The credit line will not cover 160.",
          state.credits < 160,
        ),
        choice("endure", "Endure the spike", "Buy prices rise for four sols. Your own ISRU becomes the point."),
      ],
    };
  }
  if (kind === "fever") {
    const med = hasMedical(state);
    return {
      id,
      kind,
      title: "Cabin fever",
      body: "A respiratory cluster is moving through the night shift. It is not exotic. It is still how outposts empty.",
      choices: [
        choice("quarantine", "Quarantine the bay", "Morale slips and output slows for two sols. The infection stops."),
        choice(
          "treat",
          med ? "Treat in the medical bay" : "Buy a treatment protocol",
          med ? "The bay handles it. Morale recovers." : "Sixty credits and a remote protocol. No bay required.",
          !med && state.credits < 60,
        ),
        choice("ignore", "Keep the shifts", "Two people are likely to die. The rest will remember the order."),
      ],
    };
  }
  if (kind === "audit") {
    return {
      id,
      kind,
      title: "Charter audit",
      body: "Earth's inspector general wants the books closed in public. Paying is quieter than explaining a dual-world deficit.",
      choices: [
        choice("pay", "Remit 120 credits", state.credits >= 120 ? "The file closes." : "You cannot cover 120.", state.credits < 120),
        choice("refuse", "Refuse the audit", "Prices worsen and both crews hear that Earth is unhappy."),
      ],
    };
  }
  if (kind === "grant") {
    return {
      id,
      kind,
      title: "Inspector's grant",
      body: "A parliamentary delegation will release 180 credits if you host them for a sol. They film everything.",
      choices: [
        choice("host", "Host the delegation", "+180 credits. Morale falls on every founded world."),
        choice("no", "Keep the cameras out", "No money. No circus."),
      ],
    };
  }
  if (kind === "ice") {
    return {
      id,
      kind,
      title: "Buried ice lens",
      body: "The orbiter's radar return is unambiguous: a clean lens of ice beside one of your works, previously written off as dry soil.",
      choices: [choice("mark", "Mark it for the drill crews", "The richest dry neighbor of your base becomes an ice tile.")],
    };
  }
  if (kind === "anomaly") {
    const ship = state.ships.find((s) => s.mission);
    if (!ship) return null;
    return {
      id,
      kind,
      title: `Anomaly aboard ${ship.name}`,
      body: `${ship.name} reports a propulsion fault mid-coast. The crew can safe the burn or try to hold the original arrival.`,
      choices: [
        choice("safe", "Safe the burn", "Arrival slips one sol. Incident risk on this leg is cut in half."),
        choice("push", "Press the original arrival", "Roll the incident now. Cargo and hull are what you are gambling."),
      ],
    };
  }
  return null;
}

function damageRandom(state: GameState, worldId: WorldId, amount: number): string {
  const world = state.worlds[worldId];
  const pool = world.tiles.filter((t) => t.building && t.building.type !== "command" && t.building.progress === 0);
  const target = pool.length ? pool[Math.floor(nextRand(state) * pool.length)]! : world.tiles.find((t) => t.building?.type === "command");
  if (!target?.building) return "The swarm finds only empty regolith.";
  const b = target.building;
  if (b.type === "command") b.hp = Math.max(24, b.hp - amount * 0.45);
  else b.hp = Math.max(0, b.hp - amount);
  const name = b.type;
  if (b.hp <= 0) {
    target.building = null;
    return `The ${name} is destroyed.`;
  }
  return `The ${name} at ${target.q},${target.r} is down to ${Math.round(b.hp)}% integrity.`;
}

function boostIce(state: GameState): string {
  const worlds = [state.worlds.luna, state.worlds.mars].filter((w) => w.founded);
  const world = worlds[Math.floor(nextRand(state) * worlds.length)] ?? state.worlds.luna;
  const index = indexTiles(world.tiles);
  let best: { q: number; r: number } | null = null;
  let score = 1e9;
  for (const t of world.tiles) {
    if (t.building) continue;
    const near = neighborTiles(index, t.q, t.r).some((n) => n.building);
    if (!near) continue;
    if (t.ice < score) {
      score = t.ice;
      best = t;
    }
  }
  if (!best) return "The lens sits outside the tether range. Logged and left.";
  const tile = index.get(`${best.q},${best.r}`)!;
  tile.ice = Math.min(100, tile.ice + 48);
  if (tile.terrain !== "polar") tile.terrain = world.id === "luna" ? "crater" : "crater";
  return `${world.name} marks a fresh ice lens at ${tile.q},${tile.r}.`;
}

export function applyChoice(state: GameState, eventId: string, choiceId: string): string | null {
  const idx = state.events.findIndex((e) => e.id === eventId);
  if (idx < 0) return "That situation has already closed.";
  const ev = state.events[idx]!;
  const picked = ev.choices.find((c) => c.id === choiceId);
  if (!picked) return "Unknown order.";
  if (picked.disabled) return "That order cannot be carried out.";
  state.events.splice(idx, 1);
  state.stats.crises += 1;

  if (ev.kind === "solar") {
    state.script.solarDone = true;
    if (choiceId === "shelter") {
      state.worlds.luna.shelter = 1;
      pushLog(state, "Shackleton powers down for the ejection.", "warn");
    } else if (choiceId === "protocol") {
      state.worlds.luna.shelter = 2;
      pushLog(state, "Shelter protocol: arrays furled, crews under the ridge.", "info");
    } else {
      const msg = damageRandom(state, "luna", hasTech(state, "shelters") ? 16 : 26);
      state.worlds.luna.radiation = 1;
      state.worlds.luna.morale = Math.max(0, state.worlds.luna.morale - 5);
      for (const s of state.ships) {
        if (s.loc === "luna" || s.mission?.from === "luna" || s.mission?.to === "luna") s.hull = Math.max(8, s.hull - 8);
      }
      pushLog(state, `The ejection walks over the prospect. ${msg}`, "bad");
    }
    return null;
  }

  if (ev.kind === "dust") {
    if (choiceId === "mitigated") {
      state.worlds.mars.dust = 2;
      pushLog(state, "Dust protocol shortens the storm. Arrays will still sag.", "warn");
    } else if (choiceId === "eva") {
      state.worlds.mars.dust = 3;
      state.worlds.mars.stock.metals += 10;
      state.worlds.mars.morale = Math.max(0, state.worlds.mars.morale - 7);
      if (!hasMedical(state) && state.worlds.mars.pop > 1) {
        state.worlds.mars.pop -= 1;
        pushLog(state, "The EVA brings back metals and leaves one name off the watch bill.", "bad");
      } else {
        pushLog(state, "The EVA holds. Extra metals are in the yard; the medical bay earns its keep.", "warn");
      }
    } else {
      state.worlds.mars.dust = 3;
      state.worlds.mars.morale = Math.max(0, state.worlds.mars.morale - 2);
      pushLog(state, "Hatches sealed at Eos Reach. The storm owns the surface.", "warn");
    }
    return null;
  }

  if (ev.kind === "meteor") {
    if (choiceId === "dodge") {
      state.worlds.luna.stock.propellant = Math.max(0, state.worlds.luna.stock.propellant - 6);
      pushLog(state, "A propellant puff shifts the hab cluster. The gravel passes south.", "good");
    } else if (choiceId === "guns") {
      const guns = defended(state, "luna");
      const tech = hasTech(state, "interceptors");
      const roll = nextRand(state);
      const stop = guns || tech ? roll < (guns && tech ? 0.95 : guns ? 0.8 : 0.55) : roll < 0.22;
      if (stop) pushLog(state, "The swarm is broken before it reaches the ridge.", "good");
      else pushLog(state, damageRandom(state, "luna", 34), "bad");
    } else {
      pushLog(state, damageRandom(state, "luna", hasTech(state, "shelters") ? 24 : 36), "bad");
      state.worlds.luna.morale = Math.max(0, state.worlds.luna.morale - 4);
    }
    return null;
  }

  if (ev.kind === "contract" && choiceId === "accept") {
    const late = ev.title.startsWith("Helium");
    state.contract = {
      id: uid(state, "con"),
      title: ev.title,
      detail: ev.body,
      need: late ? { he3: 8 } : { metals: 22 },
      reward: late ? 520 : 280,
      deadline: state.turn + (late ? 16 : 12),
    };
    pushLog(state, `Contract open: ${state.contract.title}. Deliver to Earth by sol ${state.contract.deadline}.`, "info");
    return null;
  }
  if (ev.kind === "contract") {
    pushLog(state, "Quota declined. The desk files it without comment.", "info");
    return null;
  }

  if (ev.kind === "shortage") {
    if (choiceId === "buy") {
      state.credits -= 160;
      state.deliveries.push({
        id: uid(state, "drop"),
        dest: "luna",
        eta: 2,
        cargo: { food: 18, water: 16, oxygen: 16 },
      });
      pushLog(state, "Reserve purchased. A drop is two sols out from Luna.", "info");
    } else {
      state.priceMul = Math.max(state.priceMul, 1.45);
      state.priceTurns = Math.max(state.priceTurns, 4);
      pushLog(state, "Earth prices spike for four sols.", "warn");
    }
    return null;
  }

  if (ev.kind === "fever") {
    const worlds = [state.worlds.luna, state.worlds.mars].filter((w) => w.founded && w.pop > 0);
    const world = worlds.sort((a, b) => b.pop - a.pop)[0] ?? state.worlds.luna;
    if (choiceId === "quarantine") {
      world.quarantine = 2;
      world.morale = Math.max(0, world.morale - 3);
      pushLog(state, `${world.name} quarantines a bay. Output will sag.`, "warn");
    } else if (choiceId === "treat") {
      if (!hasMedical(state)) state.credits -= 60;
      world.morale = Math.min(100, world.morale + 2);
      pushLog(state, `The cluster at ${world.name} is treated.`, "good");
    } else {
      world.pop = Math.max(0, world.pop - 2);
      world.morale = Math.max(0, world.morale - 10);
      pushLog(state, `Two dead at ${world.name}. The watch bill is quieter.`, "bad");
    }
    return null;
  }

  if (ev.kind === "audit") {
    if (choiceId === "pay") {
      state.credits -= 120;
      pushLog(state, "Audit remitted. The file closes.", "info");
    } else {
      state.priceMul = Math.max(state.priceMul, 1.32);
      state.priceTurns = Math.max(state.priceTurns, 5);
      for (const w of [state.worlds.luna, state.worlds.mars]) if (w.founded) w.morale = Math.max(0, w.morale - 4);
      pushLog(state, "Audit refused. Earth marks the charter difficult, and the crews hear it.", "bad");
    }
    return null;
  }

  if (ev.kind === "grant") {
    if (choiceId === "host") {
      state.credits += 180;
      for (const w of [state.worlds.luna, state.worlds.mars]) if (w.founded) w.morale = Math.max(0, w.morale - 3);
      pushLog(state, "The delegation pays 180 credits and films the galley.", "info");
    } else pushLog(state, "Cameras declined.", "info");
    return null;
  }

  if (ev.kind === "ice") {
    pushLog(state, boostIce(state), "good");
    return null;
  }

  if (ev.kind === "anomaly") {
    const ship = state.ships.find((s) => s.mission);
    if (!ship?.mission) {
      pushLog(state, "The anomaly clears before anyone answers. The ship is already elsewhere.", "info");
      return null;
    }
    if (choiceId === "safe") {
      ship.mission.eta += 1;
      ship.mission.total += 1;
      ship.mission.risk *= 0.5;
      pushLog(state, `${ship.name} safes the burn. Arrival slips a sol.`, "warn");
    } else {
      resolveIncident(state, ship, true);
    }
    return null;
  }

  pushLog(state, "Order noted.", "info");
  return null;
}

export function resolveIncident(
  state: GameState,
  ship: GameState["ships"][number],
  forced: boolean,
): void {
  const roll = nextRand(state);
  const risk = ship.mission?.risk ?? 0.1;
  if (!forced && roll >= risk) return;
  const founding = ship.mission?.founding;
  if (founding) {
    ship.hull = Math.max(28, ship.hull - 16);
    for (const k of Object.keys(ship.cargo) as (keyof typeof ship.cargo)[]) {
      const retain = 0.9 + nextRand(state) * 0.1;
      ship.cargo[k] = Math.round(ship.cargo[k] * retain);
    }
    if (ship.cargo.metals >= FOUNDING_MIN.metals - 6) {
      ship.cargo.metals = Math.max(ship.cargo.metals, FOUNDING_MIN.metals);
    }
    pushLog(state, `${ship.name} takes a hull strike. The founding cadre stays sealed; some cargo is scorched.`, "bad");
    return;
  }
  ship.hull -= 16 + Math.floor(nextRand(state) * 18);
  for (const k of Object.keys(ship.cargo) as (keyof typeof ship.cargo)[]) {
    ship.cargo[k] = Math.floor(ship.cargo[k] * (0.5 + nextRand(state) * 0.3));
  }
  if (ship.crew > 1 && nextRand(state) < 0.45) ship.crew -= 1;
  if (ship.hull <= 0) {
    pushLog(state, `${ship.name} is lost with everyone aboard.`, "bad");
    state.ships = state.ships.filter((s) => s.id !== ship.id);
    return;
  }
  pushLog(state, `${ship.name} arrives damaged. Hull ${Math.round(ship.hull)}.`, "warn");
}

export function maybeQueueEvent(state: GameState): void {
  if (state.events.length > 0 || state.outcome) return;
  if (state.turn === 2 && !state.script.solar) {
    state.script.solar = true;
    enqueueEvent(state, "solar");
    return;
  }
  if (state.turn === 9 && !state.script.contract && !state.contract) {
    state.script.contract = true;
    enqueueEvent(state, "contract");
    return;
  }
  if (state.turn < 4) return;

  const last = state.eventLastTurn ?? {};
  const eligible = (kind: string): boolean => state.turn - (last[kind] ?? -Infinity) >= 4;
  if (hasTech(state, "warning") && !state.foreshadow && nextRand(state) < 0.45) {
    const warned = ["solar", ...(state.worlds.mars.founded ? ["dust"] : [])].filter(eligible);
    const kind = warned.length ? warned[Math.floor(nextRand(state) * warned.length)] as "solar" | "dust" : null;
    if (kind) {
      state.foreshadow = kind;
      pushLog(
        state,
        kind === "dust"
          ? "Early-warning net: a dust front is lifting on Mars. Expect it within a sol."
          : "Early-warning net: proton flux is climbing. A solar event is likely within a sol.",
        "warn",
      );
    }
  }

  const chance = DIFF[state.difficulty].eventChance;
  const biased = state.foreshadow && nextRand(state) < 0.7;
  if (!biased && nextRand(state) > chance) return;

  const pool: { kind: string; w: number }[] = [
    { kind: "solar", w: 3 },
    { kind: "dust", w: state.worlds.mars.founded ? 4 : 0 },
    { kind: "meteor", w: 3 },
    { kind: "shortage", w: state.turn > 8 ? 2 : 0 },
    { kind: "fever", w: state.turn > 7 ? 2 : 0 },
    { kind: "audit", w: state.turn > 10 ? 2 : 0 },
    { kind: "grant", w: state.turn > 6 ? 2 : 0 },
    { kind: "ice", w: 2 },
    { kind: "anomaly", w: state.ships.some((s) => s.mission) ? 3 : 0 },
    { kind: "contract", w: !state.contract && state.turn > 12 ? 2 : 0 },
  ];
  if (state.foreshadow) {
    const hit = pool.find((p) => p.kind === state.foreshadow);
    if (hit) hit.w += 8;
    state.foreshadow = null;
  }
  // Apply cooldown after foreshadow weighting so an ineligible kind cannot be
  // resurrected by its warning bonus.
  for (const p of pool) if (!eligible(p.kind)) p.w = 0;
  const total = pool.reduce((s, p) => s + Math.max(0, p.w), 0);
  if (total <= 0) return;
  let r = nextRand(state) * total;
  let kind: string | null = null;
  for (const p of pool) {
    if (p.w <= 0) continue;
    r -= p.w;
    if (r <= 0) {
      kind = p.kind;
      break;
    }
  }
  if (kind) enqueueEvent(state, kind);
}
