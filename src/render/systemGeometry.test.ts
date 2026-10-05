import { assert } from "../core/testAssert";
import { createGame } from "../core/state";
import { boundsForTiles } from "./camera";
import { continuousTerrainRect } from "./terrainLayout";
import { dockMarker, hitSystemBody, routeControl, routePoint, systemNodes } from "./systemGeometry";

for (const [w, h] of [[760, 620], [390, 660], [320, 420], [1100, 220], [390, 220], [1400, 180], [320, 180]]) {
  const geom = { cx: w / 2 + 240, cy: h / 2 + 66, w, h };
  const nodes = systemNodes(geom);
  for (const id of ["earth", "luna", "mars"] as const) {
    const p = nodes[id];
    assert.ok(p.x - p.r >= geom.cx - w / 2 && p.x + p.r <= geom.cx + w / 2, `${id} stays horizontally in viewport`);
    assert.ok(p.y - p.r >= geom.cy - h / 2 && p.y + p.r + 39 <= geom.cy + h / 2, `${id} labels stay vertically in viewport`);
    assert.equal(hitSystemBody(p.x, p.y, nodes), id, "Visible center and hit target share geometry");
    const dock = dockMarker(p);
    for (const other of ["earth", "luna", "mars"] as const) {
      if (other === id) continue;
      const body = nodes[other];
      assert.ok(Math.hypot(dock.x - body.x, dock.y - body.y) > body.r + 12, "Dock marker clears the other planets");
    }
  }
  assert.equal(hitSystemBody(-100, -100, nodes), null);
  for (const [a, b] of [["earth", "luna"], ["earth", "mars"], ["luna", "mars"]] as const) {
    const c = routeControl(nodes, a, b, geom);
    assert.equal(JSON.stringify(c), JSON.stringify(routeControl(nodes, b, a, geom)), "Reverse flights use the same curve");
    assert.equal(JSON.stringify(routePoint(nodes[a], c, nodes[b], 0)), JSON.stringify({ x: nodes[a].x, y: nodes[a].y }));
    const forward = routePoint(nodes[a], c, nodes[b], 0.3), backward = routePoint(nodes[b], c, nodes[a], 0.7);
    assert.ok(Math.abs(forward.x - backward.x) < 1e-8 && Math.abs(forward.y - backward.y) < 1e-8);
    for (let i = 0; i <= 20; i++) {
      const point = routePoint(nodes[a], c, nodes[b], i / 20);
      assert.ok(point.y - 15 >= geom.cy - h / 2 && point.y + 15 <= geom.cy + h / 2 - 28, "Ship path clears viewport and bottom legend");
    }
  }
  const game = createGame("charter", 42);
  for (const world of Object.values(game.worlds)) {
    const bounds = boundsForTiles(world.tiles, 50);
    const rect = continuousTerrainRect(world.tiles, 50, { w, h }, 1.5);
    assert.ok(Math.abs(rect.w / rect.h - 1.5) < 1e-8, "Terrain preserves image aspect ratio");
    assert.ok(rect.x <= bounds.minX - w / 1.1 + 1e-6 && rect.x + rect.w >= bounds.maxX + w / 1.1 - 1e-6);
    assert.ok(rect.y <= bounds.minY - h / 1.1 + 1e-6 && rect.y + rect.h >= bounds.maxY + h / 1.1 - 1e-6);
  }
}
console.log("system geometry: responsive planet hit targets, bidirectional paths and single-image terrain coverage pass");
