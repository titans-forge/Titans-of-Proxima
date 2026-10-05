import { buyPrice, canSpend } from "./actions";
import { DIFF, SHIPS } from "./data";
import { fmt } from "./format";
import { previewShipRepair, repairShip } from "./shipService";
import type { ShipRepairPreview } from "./shipService";
import { createGame } from "./state";
import { assert } from "./testAssert";
import type { Difficulty, GameState, LocationId, ShipClass } from "./types";

let tests = 0;
function test(name: string, run: () => void): void {
  try {
    run();
    tests += 1;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

// Preserve malformed numeric values that ordinary save JSON would turn into null.
function snapshot(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === undefined) return "[undefined]";
    if (typeof item === "number" && !Number.isFinite(item)) return `[number:${item}]`;
    return item;
  });
}

function freeze(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value)) freeze(item);
  Object.freeze(value);
}

function fixture(cls: ShipClass = "courier", location: LocationId = "luna", difficulty: Difficulty = "charter"): GameState {
  const game = createGame(difficulty, 42);
  const ship = game.ships[0];
  ship.cls = cls;
  ship.loc = location;
  ship.hull = SHIPS[cls].hull / 2;
  ship.cargo = { water: 1.5, oxygen: 2, food: 3, metals: 4, he3: 1, regolith: 2, propellant: 1 };
  ship.fuel = 7.25;
  ship.crew = 2;
  game.credits = 1000.37;
  game.turn = 7;
  game.priceTurns = 3;
  game.tech = { unlocked: [], current: "pv", progress: 2 };
  game.yard = [{ id: "yard-test", cls: "freighter", loc: "earth", eta: 2, name: "PAS Waiting" }];
  game.deliveries = [{ id: "drop-test", dest: "luna", eta: 2, cargo: { food: 12 } }];
  for (const world of [game.worlds.luna, game.worlds.mars]) {
    world.founded = true;
    world.foundedTurn = 1;
    world.stock.metals = 100.5;
    for (const tile of world.tiles) tile.building = null;
    world.tiles[0].building = { type: "pad", hp: 100, progress: 0, total: 2 };
  }
  game.ships.push({ ...structuredClone(ship), id: "ship-other", name: "PAS Other", hull: SHIPS[cls].hull - 2 });
  return game;
}

function failUnchanged(game: GameState, shipId: string, reason: RegExp): ShipRepairPreview {
  const before = snapshot(game);
  const quote = previewShipRepair(game, shipId);
  assert.equal(quote.ok, false);
  assert.match(quote.reason ?? "", reason);
  assert.equal(snapshot(game), before, "Rejected quote must not mutate any state");
  const result = repairShip(game, shipId);
  assert.equal(result.ok, false);
  assert.equal(result.reason, quote.reason, "Preview and action agree on the blocker");
  assert.equal(result.sfx, "error");
  assert.equal(snapshot(game), before, "Failed repair must be byte-identical, including logs and RNG");
  return quote;
}

type ExpectedPatch = Pick<ShipRepairPreview, "restored" | "hullAfter" | "maxHull" | "metals" | "cost">;

function patchExactly(game: GameState, expected: ExpectedPatch): void {
  const before = structuredClone(game);
  const ship = game.ships[0];
  const quote = previewShipRepair(game, ship.id);
  assert.ok(quote.ok, quote.reason);
  assert.equal(quote.reason, undefined);
  assert.equal(quote.location, ship.loc);
  for (const field of ["restored", "hullAfter", "maxHull", "metals", "cost"] as const) {
    assert.equal(quote[field], expected[field], `Exact ${field}`);
  }
  assert.equal(snapshot(game), snapshot(before), "Successful quote is nonmutating");
  assert.equal(snapshot(previewShipRepair(game, ship.id)), snapshot(quote), "Repeated quotes are stable");
  const quoteBefore = snapshot(quote);
  assert.equal(snapshot(repairShip(game, ship.id)), snapshot({ ok: true, sfx: "build" }));
  assert.equal(snapshot(quote), quoteBefore, "Committing never rewrites an earlier quote");
  assert.equal(ship.hull, quote.hullAfter);
  assert.ok(ship.hull <= quote.maxHull, "Class maximum cannot be exceeded");
  assert.equal(game.credits, before.credits - quote.cost, "Debit is exactly the quoted invoice");

  const expectedState = structuredClone(before);
  expectedState.ships[0].hull = expected.hullAfter;
  expectedState.credits -= expected.cost;
  const location = quote.location!;
  if (location !== "earth") expectedState.worlds[location].stock.metals -= expected.metals;
  const name = location === "earth" ? "Earth" : before.worlds[location].name;
  expectedState.log.push({
    turn: before.turn,
    text: `${ship.name} patched at ${name}: +${fmt(expected.restored)} hull (${fmt(expected.hullAfter)}/${fmt(expected.maxHull)}), ${fmt(expected.metals)} t metals, ${fmt(expected.cost)} credits.`,
    tone: "good",
  });
  expectedState.log = expectedState.log.slice(-140);
  assert.equal(snapshot(game), snapshot(expectedState), "Only hull, quoted payment and the public repair log may change");
}

const classes = [
  { cls: "courier", maxHull: 48, patch: 12, metals: 2, smallMetals: 1 },
  { cls: "freighter", maxHull: 74, patch: 19, metals: 5, smallMetals: 2 },
  { cls: "colony", maxHull: 86, patch: 22, metals: 7, smallMetals: 2 },
  { cls: "tanker", maxHull: 64, patch: 16, metals: 4, smallMetals: 2 },
] as const;
const locations: LocationId[] = ["earth", "luna", "mars"];
const difficulties: Difficulty[] = ["survey", "charter", "hardship"];

// Explicit class expectations exercise ceiling, proportional materials and near-full caps.
for (const spec of classes) {
  const damageCases = [
    { name: "half hull", hull: spec.maxHull / 2, restored: spec.patch, metals: spec.metals },
    { name: "heavily damaged", hull: 1, restored: spec.patch, metals: spec.metals },
    { name: "fractional low hull", hull: 0.25, restored: spec.patch, metals: spec.metals },
    { name: "five missing", hull: spec.maxHull - 5, restored: 5, metals: spec.smallMetals },
    { name: "one missing", hull: spec.maxHull - 1, restored: 1, metals: 1 },
    { name: "fractional near-full", hull: spec.maxHull - 0.25, restored: 0.25, metals: 1 },
  ];
  for (const location of locations) {
    for (const damage of damageCases) {
      test(`${spec.cls} at ${location}: ${damage.name}`, () => {
        const game = fixture(spec.cls, location);
        game.ships[0].hull = damage.hull;
        patchExactly(game, {
          restored: damage.restored, hullAfter: damage.hull + damage.restored, maxHull: spec.maxHull,
          metals: damage.metals, cost: location === "earth" ? damage.metals * 10 + 10 : 10,
        });
      });
    }
  }
}

const tariffs = [
  { multiplier: 1, costs: { survey: [28, 55, 73, 46], charter: [30, 60, 80, 50], hardship: [32.4, 66, 88.4, 54.8] } },
  { multiplier: 1.35, costs: { survey: [34.3, 70.75, 95.05, 58.6], charter: [37, 77.5, 104.5, 64], hardship: [40.24, 85.6, 115.84, 70.48] } },
  { multiplier: 1.23456, costs: { survey: [32.22, 65.56, 87.78, 54.44], charter: [34.69, 71.73, 96.42, 59.38], hardship: [37.65, 79.14, 106.79, 65.31] } },
];
for (const tariff of tariffs) {
  for (const difficulty of difficulties) {
    classes.forEach((spec, i) => {
      test(`${spec.cls}: Earth tariff ${tariff.multiplier} on ${difficulty}`, () => {
        const game = fixture(spec.cls, "earth", difficulty);
        game.priceMul = tariff.multiplier;
        game.worlds.luna.stock.metals = game.worlds.mars.stock.metals = 0;
        const quote = previewShipRepair(game, game.ships[0].id);
        assert.equal(quote.cost, Math.round((quote.metals * buyPrice(game, "metals") + 10) * 100) / 100);
        patchExactly(game, {
          restored: spec.patch, hullAfter: spec.maxHull / 2 + spec.patch, maxHull: spec.maxHull,
          metals: spec.metals, cost: tariff.costs[difficulty][i],
        });
      });
    });
  }
}

for (const location of ["luna", "mars"] as const) {
  for (const difficulty of difficulties) {
    test(`${location}: manual workshop needs neither tech, power nor unused launches on ${difficulty}`, () => {
      const game = fixture("courier", location, difficulty);
      game.tech = { unlocked: [], current: null, progress: 0 };
      game.priceMul = 20;
      game.worlds[location].stock.energy = 0;
      game.worlds[location].stock.metals = 2;
      game.worlds[location].launches = 100;
      game.worlds[location].tiles[0].building!.hp = 20.001;
      game.worlds[location].pop = 0;
      game.ships[0].crew = 0;
      game.ships[0].fuel = 0;
      patchExactly(game, { restored: 12, hullAfter: 36, maxHull: 48, metals: 2, cost: 10 });
      assert.equal(game.worlds[location].stock.metals, 0);
    });
  }
}

test("Earth repairs need no founded worlds, pads, available launches or ground stores", () => {
  const game = fixture("courier", "earth");
  for (const world of [game.worlds.luna, game.worlds.mars]) {
    world.founded = false;
    world.stock.metals = 0;
    world.tiles[0].building = null;
  }
  game.earthLaunches = 2;
  patchExactly(game, { restored: 12, hullAfter: 36, maxHull: 48, metals: 2, cost: 30 });
});

test("Technology grants no discount or extra hull restoration", () => {
  const game = fixture("colony", "mars");
  game.tech.unlocked = ["sinter", "robots", "drones", "ntr"];
  patchExactly(game, { restored: 22, hullAfter: 65, maxHull: 86, metals: 7, cost: 10 });
});

for (const location of locations) {
  test(`${location}: quotes work on deeply frozen state and return no mutable state references`, () => {
    const game = fixture("courier", location);
    freeze(game);
    const before = snapshot(game);
    const quote = previewShipRepair(game, game.ships[0].id);
    assert.ok(quote.ok);
    assert.equal(Object.keys(quote).sort().join(","), "cost,hullAfter,location,maxHull,metals,ok,restored");
    quote.cost = -100;
    quote.hullAfter = 999;
    assert.equal(snapshot(game), before);
    assert.equal(previewShipRepair(game, game.ships[0].id).cost, location === "earth" ? 30 : 10);
  });
  for (const difficulty of difficulties) {
    test(`${location}: exact ${difficulty} credit line accepted; any shortfall refused`, () => {
      const game = fixture("courier", location, difficulty);
      const quote = previewShipRepair(game, game.ships[0].id);
      game.credits = DIFF[difficulty].overdraft + quote.cost;
      assert.ok(canSpend(game, quote.cost));
      const short = structuredClone(game);
      short.credits -= 0.001;
      const refused = failUnchanged(short, short.ships[0].id, /Credit line refused/);
      assert.equal(refused.cost, quote.cost, "Unaffordable quotes still show the current invoice");
      patchExactly(game, { restored: 12, hullAfter: 36, maxHull: 48, metals: 2, cost: quote.cost });
      assert.equal(game.credits, DIFF[difficulty].overdraft);
    });
  }
}

test("Earth invoice rounds once after material total and labour, preserving an existing subcent balance", () => {
  const game = fixture("freighter", "earth", "survey");
  game.credits = 1000.12345;
  game.priceMul = 1.23456;
  patchExactly(game, { restored: 19, hullAfter: 56, maxHull: 74, metals: 5, cost: 65.56 });
});

test("Even free Earth materials still require ten credits labour", () => {
  const game = fixture("courier", "earth");
  game.priceMul = 0;
  patchExactly(game, { restored: 12, hullAfter: 36, maxHull: 48, metals: 2, cost: 10 });
});

for (const emptyFleet of [false, true]) {
  test(`Unknown hull, empty fleet ${emptyFleet}`, () => {
    const game = fixture();
    if (emptyFleet) game.ships = [];
    freeze(game);
    const quote = failUnchanged(game, "missing-ship", /Unknown ship/);
    assert.equal(snapshot(quote), snapshot({
      ok: false, restored: 0, hullAfter: 0, maxHull: 0, metals: 0, cost: 0, location: null, reason: "Unknown ship.",
    }));
  });
}

const mission = { from: "luna", to: "earth", eta: 1, total: 2, risk: 0.1, founding: false, burn: 2 } as const;
const blockers: { name: string; change: (game: GameState) => void; reason: RegExp }[] = [
  { name: "transit without mission", change: g => { g.ships[0].loc = "transit"; }, reason: /not in dock/ },
  { name: "transit with mission", change: g => { g.ships[0].loc = "transit"; g.ships[0].mission = { ...mission }; }, reason: /not in dock/ },
  { name: "mission while apparently docked", change: g => { g.ships[0].mission = { ...mission }; }, reason: /not in dock/ },
  { name: "mission with zero ETA", change: g => { g.ships[0].mission = { ...mission, eta: 0 }; }, reason: /not in dock/ },
  { name: "pending first landing", change: g => { g.founding = { shipId: g.ships[0].id, world: "mars" }; }, reason: /landing site/ },
  { name: "another hull pending first landing", change: g => { g.founding = { shipId: g.ships[1].id, world: "mars" }; }, reason: /landing site/ },
  { name: "victory", change: g => { g.outcome = { kind: "victory" }; }, reason: /charter is closed/ },
  { name: "defeat", change: g => { g.outcome = { kind: "defeat", reason: "Test closure" }; }, reason: /charter is closed/ },
  { name: "queued event", change: g => { g.events.push({ id: "event-test", kind: "audit", title: "Audit", body: "Pending", choices: [] }); }, reason: /situation needs an order/ },
];
for (const location of locations) {
  for (const blocker of blockers) {
    test(`${location}: ${blocker.name} is atomic`, () => {
      const game = fixture("courier", location);
      blocker.change(game);
      freeze(game);
      failUnchanged(game, game.ships[0].id, blocker.reason);
    });
  }
}

for (const spec of classes) {
  test(`${spec.cls}: full hull never costs anything`, () => {
    const game = fixture(spec.cls);
    game.ships[0].hull = spec.maxHull;
    const quote = failUnchanged(game, game.ships[0].id, /already nominal/);
    assert.equal(quote.restored, 0);
    assert.equal(quote.hullAfter, spec.maxHull);
    assert.equal(quote.metals, 0);
    assert.equal(quote.cost, 0);
  });
  for (const hull of [0, -1, spec.maxHull + 0.01, NaN, Infinity, -Infinity, null, undefined, "24", true]) {
    test(`${spec.cls}: malformed hull ${String(hull)}`, () => {
      const game = fixture(spec.cls);
      game.ships[0].hull = hull as number;
      freeze(game);
      const quote = failUnchanged(game, game.ships[0].id, /integrity is invalid/);
      assert.equal(quote.restored, 0);
      assert.equal(quote.cost, 0);
      assert.equal(quote.metals, 0);
      assert.equal(quote.maxHull, spec.maxHull);
    });
  }
}

for (const location of ["luna", "mars"] as const) {
  test(`${location}: a pad on an unfounded world is insufficient`, () => {
    const game = fixture("courier", location);
    game.worlds[location].founded = false;
    failUnchanged(game, game.ships[0].id, /No outpost/);
  });
  for (const padState of [
    { progress: 1, hp: 100 }, { progress: -1, hp: 100 }, { progress: 0.01, hp: 100 },
    { progress: NaN, hp: 100 }, { progress: 0, hp: 20 }, { progress: 0, hp: 19.999 },
    { progress: 0, hp: 0 }, { progress: 0, hp: NaN },
  ]) {
    test(`${location}: pad ${snapshot(padState)} cannot provide repairs`, () => {
      const game = fixture("courier", location);
      Object.assign(game.worlds[location].tiles[0].building!, padState);
      failUnchanged(game, game.ships[0].id, /finished launch pad/);
    });
  }
  for (const replacement of [null, "shipyard"] as const) {
    test(`${location}: a missing pad or a shipyard alone is insufficient`, () => {
      const game = fixture("courier", location);
      game.worlds[location].tiles[0].building = replacement ? { type: replacement, hp: 100, progress: 0, total: 0 } : null;
      failUnchanged(game, game.ships[0].id, /finished launch pad/);
    });
  }
  test(`${location}: any one qualifying pad is enough`, () => {
    const game = fixture("courier", location);
    game.worlds[location].tiles[0].building!.hp = 20;
    game.worlds[location].tiles[1].building = { type: "pad", hp: 21, progress: 0, total: 2 };
    patchExactly(game, { restored: 12, hullAfter: 36, maxHull: 48, metals: 2, cost: 10 });
  });
  for (const stock of [0, 1.999999, -1, NaN, Infinity, -Infinity]) {
    test(`${location}: insufficient or malformed metals ${stock}`, () => {
      const game = fixture("courier", location);
      game.worlds[location].stock.metals = stock;
      game.ships[0].cargo.metals = 100;
      const quote = failUnchanged(game, game.ships[0].id, /2 t of metals.*outpost stores/);
      assert.equal(quote.metals, 2);
      assert.equal(quote.cost, 10);
      assert.equal(quote.restored, 12);
    });
  }
}

for (const credits of [NaN, Infinity, -Infinity]) {
  test(`Nonfinite credits ${credits} cannot finance repairs`, () => {
    const game = fixture();
    game.credits = credits;
    failUnchanged(game, game.ships[0].id, /Credit line refused/);
  });
}
for (const price of [NaN, Infinity, -Infinity, -1]) {
  test(`Malformed Earth price ${price} cannot create free repairs or credit`, () => {
    const game = fixture("courier", "earth");
    game.priceMul = price;
    failUnchanged(game, game.ships[0].id, /Repair price is invalid/);
  });
}

const staleBlockers = [
  ...blockers,
  { name: "ship removed", change: (g: GameState) => { g.ships.shift(); }, reason: /Unknown ship/ },
  { name: "now full", change: (g: GameState) => { g.ships[0].hull = 48; }, reason: /already nominal/ },
  { name: "hull corrupted", change: (g: GameState) => { g.ships[0].hull = NaN; }, reason: /integrity is invalid/ },
  { name: "outpost lost", change: (g: GameState) => { g.worlds.luna.founded = false; }, reason: /No outpost/ },
  { name: "pad being built", change: (g: GameState) => { g.worlds.luna.tiles[0].building!.progress = 1; }, reason: /finished launch pad/ },
  { name: "pad damaged", change: (g: GameState) => { g.worlds.luna.tiles[0].building!.hp = 20; }, reason: /finished launch pad/ },
  { name: "metals spent", change: (g: GameState) => { g.worlds.luna.stock.metals = 1; }, reason: /metals/ },
  { name: "credits spent", change: (g: GameState) => { g.credits = DIFF.charter.overdraft; }, reason: /Credit line refused/ },
];
for (const blocker of staleBlockers) {
  test(`A stale valid quote cannot bypass ${blocker.name}`, () => {
    const game = fixture();
    const id = game.ships[0].id;
    const oldQuote = previewShipRepair(game, id);
    const oldBytes = snapshot(oldQuote);
    assert.ok(oldQuote.ok);
    blocker.change(game);
    failUnchanged(game, id, blocker.reason);
    assert.equal(snapshot(oldQuote), oldBytes, "The old quote is just a value, not a reservation");
  });
}

test("A stale Earth tariff quote cannot bypass the current credit line", () => {
  const game = fixture("courier", "earth");
  game.credits = DIFF.charter.overdraft + 30;
  assert.ok(previewShipRepair(game, game.ships[0].id).ok);
  game.priceMul = 1.5;
  assert.equal(failUnchanged(game, game.ships[0].id, /Credit line refused/).cost, 40);
});

test("Commit reprices tariff, difficulty and changed hull without a new caller quote", () => {
  const game = fixture("freighter", "earth");
  const oldQuote = previewShipRepair(game, game.ships[0].id);
  assert.equal(oldQuote.cost, 60);
  game.priceMul = 1.23456;
  game.difficulty = "hardship";
  game.ships[0].hull = 73.5;
  const before = structuredClone(game);
  assert.ok(repairShip(game, game.ships[0].id).ok);
  assert.equal(game.ships[0].hull, 74);
  assert.equal(game.credits, before.credits - 23.83);
  assert.equal(snapshot(game.worlds), snapshot(before.worlds));
  assert.equal(oldQuote.restored, 19);
  assert.equal(oldQuote.cost, 60);
});

for (const [from, to] of [["earth", "mars"], ["luna", "earth"], ["luna", "mars"]] as const) {
  test(`Commit follows changed dock ${from} to ${to}`, () => {
    const game = fixture("courier", from);
    const quote = previewShipRepair(game, game.ships[0].id);
    game.ships[0].loc = to;
    const before = structuredClone(game);
    assert.ok(repairShip(game, game.ships[0].id).ok);
    assert.equal(game.credits, before.credits - (to === "earth" ? 30 : 10));
    assert.equal(game.worlds.luna.stock.metals, before.worlds.luna.stock.metals);
    assert.equal(game.worlds.mars.stock.metals, before.worlds.mars.stock.metals - (to === "mars" ? 2 : 0));
    assert.equal(quote.location, from);
  });
}

test("Changed class uses its own maximum and construction metals", () => {
  const game = fixture();
  const quote = previewShipRepair(game, game.ships[0].id);
  game.ships[0].cls = "colony";
  const credits = game.credits;
  const metals = game.worlds.luna.stock.metals;
  assert.ok(repairShip(game, game.ships[0].id).ok);
  assert.equal(game.ships[0].hull, 46);
  assert.equal(game.worlds.luna.stock.metals, metals - 7);
  assert.equal(game.credits, credits - 10);
  assert.equal(quote.maxHull, 48);
});

test("Caller-edited quotes cannot control payment or repair size", () => {
  const game = fixture();
  const quote = previewShipRepair(game, game.ships[0].id);
  Object.assign(quote, { ok: false, restored: 1000, hullAfter: 1000, maxHull: 1000, metals: 0, cost: -1000, location: "earth" });
  patchExactly(game, { restored: 12, hullAfter: 36, maxHull: 48, metals: 2, cost: 10 });
});

test("A stale refusal does not survive newly available stores", () => {
  const game = fixture();
  game.worlds.luna.stock.metals = 0;
  const oldQuote = previewShipRepair(game, game.ships[0].id);
  assert.equal(oldQuote.ok, false);
  game.worlds.luna.stock.metals = 2;
  assert.ok(repairShip(game, game.ships[0].id).ok);
  assert.equal(game.worlds.luna.stock.metals, 0);
  assert.equal(game.ships[0].hull, 36);
});

for (const spec of classes) {
  for (const location of locations) {
    test(`${spec.cls}: repeated paid patches at ${location} share a sol but never exceed maximum`, () => {
      const game = fixture(spec.cls, location);
      game.ships[0].hull = 1;
      const startTurn = game.turn;
      let count = 0;
      while (game.ships[0].hull < spec.maxHull) {
        assert.ok(count < 4, "The bounded test needs at most four patches");
        const restored = Math.min(spec.maxHull - game.ships[0].hull, spec.patch);
        const metals = Math.max(1, Math.ceil(SHIPS[spec.cls].metals * restored / spec.maxHull));
        patchExactly(game, {
          restored, hullAfter: game.ships[0].hull + restored, maxHull: spec.maxHull,
          metals, cost: location === "earth" ? metals * 10 + 10 : 10,
        });
        count += 1;
      }
      assert.equal(count, 4);
      assert.equal(game.turn, startTurn);
      failUnchanged(game, game.ships[0].id, /already nominal/);
    });
  }
}

test("Repeated patches stop immediately when the next payment fails", () => {
  const game = fixture();
  game.ships[0].hull = 1;
  game.worlds.luna.stock.metals = 2;
  patchExactly(game, { restored: 12, hullAfter: 13, maxHull: 48, metals: 2, cost: 10 });
  failUnchanged(game, game.ships[0].id, /metals/);
  game.worlds.luna.stock.metals = 2;
  game.credits = DIFF.charter.overdraft;
  failUnchanged(game, game.ships[0].id, /Credit line refused/);
});

test("Public pushLog retains the current sol and its 140-entry history bound", () => {
  const game = fixture();
  game.log = Array.from({ length: 140 }, (_, i) => ({ turn: i, text: `Earlier entry ${i}`, tone: "info" as const }));
  patchExactly(game, { restored: 12, hullAfter: 36, maxHull: 48, metals: 2, cost: 10 });
  assert.equal(game.log.length, 140);
  assert.equal(game.log[0].text, "Earlier entry 1");
  assert.equal(game.log[139].turn, game.turn);
});

console.log(`ship service: ${tests} focused cases pass (all hull classes, exact invoices, atomic blockers, stale quotes and repeated paid patches)`);
