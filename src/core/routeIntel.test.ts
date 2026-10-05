import { assert } from "./testAssert";
import { availableRouteHull, chartShipStatus, compareDepartures, windowCalendar, windowSummary } from "./routeIntel";
import { planRoute } from "./routes";
import { createGame } from "./state";

const game = createGame("charter", 42);
const original = JSON.stringify(game);
for (const cls of ["courier", "freighter", "colony", "tanker"] as const) {
  for (const from of ["earth", "luna", "mars"] as const) {
    for (const to of ["earth", "luna", "mars"] as const) {
      if (from === to) continue;
      const comparison = compareDepartures(game, { from, to, cls });
      assert.equal(JSON.stringify(comparison.now.plan), JSON.stringify(planRoute(game, from, to, cls)), "UI uses authoritative route engine");
      assert.equal(comparison.now.arrival, game.turn + comparison.now.plan.turns);
      if (comparison.window) {
        assert.equal(comparison.window.departure, 5);
        assert.equal(comparison.window.arrival, 5 + comparison.window.plan.turns);
        assert.ok(comparison.window.plan.burn < comparison.now.plan.burn);
        assert.ok(comparison.window.plan.risk < comparison.now.plan.risk);
      } else assert.ok(from !== "mars" && to !== "mars");
    }
  }
}
assert.equal(JSON.stringify(game), original, "Read-only planning leaves RNG, saves and ships unchanged");
assert.equal(windowCalendar(1).filter(d => d.open).map(d => d.sol).join(","), "5,6,7,8");
assert.equal(windowCalendar(8).filter(d => d.open).map(d => d.sol).join(","), "8,14,15,16");
assert.match(windowSummary(8), /1 sol including today/);
game.turn = 5;
assert.equal(compareDepartures(game, { from: "earth", to: "mars", cls: "colony" }).window, null);
const hull = game.ships[0];
assert.equal(availableRouteHull(game, { from: "luna", to: "earth", cls: hull.cls })?.id, hull.id);
assert.match(chartShipStatus(game, hull), /Docked at Luna/);
game.founding = { shipId: hull.id, world: "luna" };
assert.equal(availableRouteHull(game, { from: "luna", to: "earth", cls: hull.cls }), undefined, "First landing must finish before route preparation");
assert.match(chartShipStatus(game, hull), /Awaiting landing at Luna/);
console.log("route intelligence: 24 authoritative plans, window comparison, calendar boundaries and nonmutation pass");
