import { boundsForTiles, clampCamera } from "./camera";
import { buildingStatus } from "../core/buildingStatus";
import type { Forecast } from "../core/types";
const assert = { ok: (v: unknown, m: string) => { if (!v) throw new Error(m); }, equal: (a: unknown, b: unknown, m?: string) => { if (a !== b) throw new Error(m ?? `${String(a)} !== ${String(b)}`); } };

const bounds = boundsForTiles([{ q: -2, r: 0 }, { q: 2, r: 0 }, { q: 0, r: 2 }], 50);
const cam = { x: 9999, y: -9999, tx: 9999, ty: -9999, zoom: 1 };
clampCamera(cam, { width: 420, height: 320 }, bounds);
assert.ok(cam.x < 9999 && cam.y > -9999, "camera target is bounded");
assert.ok(cam.tx >= (-210 - bounds.maxX) && cam.tx <= (210 - bounds.minX), "horizontal edge remains reachable");
assert.ok(cam.ty >= (-160 - bounds.maxY) && cam.ty <= (160 - bounds.minY), "vertical edge remains reachable");
assert.ok(-cam.x >= bounds.minX && -cam.x <= bounds.maxX, "viewport center cannot leave map horizontally");
assert.ok(-cam.y >= bounds.minY && -cam.y <= bounds.maxY, "viewport center cannot leave map vertically");
for (const zoom of [0.55, 1, 2.5]) {
  for (const x of [bounds.minX, bounds.maxX]) {
    const edge = { x: -x * zoom, y: 0, zoom };
    clampCamera(edge, { width: 390, height: 574 }, bounds);
    assert.equal(edge.x, -x * zoom, "edge tile can be centered on mobile");
  }
}

const empty: Forecast = {
  produced: {} as Forecast["produced"], consumed: {} as Forecast["consumed"], net: {} as Forecast["net"], demand: {} as Forecast["demand"],
  energyGen: 0, energyDraw: 0, energyNext: 0, rp: 0, housing: 0, brownout: false, unpowered: ["1,1"], suff: false,
  moraleNext: 0, moraleTarget: 0, deaths: 0, foodShortage: false, waterShortage: false, o2Shortage: false, notes: [], tiles: {},
};
assert.equal(buildingStatus({ type: "solar", hp: 100, progress: 1, total: 1 }, 0, 0, empty).status, "construction");
assert.equal(buildingStatus({ type: "solar", hp: 10, progress: 0, total: 0 }, 0, 0, empty).status, "dead");
assert.equal(buildingStatus({ type: "solar", hp: 100, progress: 0, total: 0 }, 1, 1, empty).status, "unpowered");
empty.unpowered = [];
empty.tiles["2,2"] = ["Robotics limited"];
assert.equal(buildingStatus({ type: "robotics", hp: 100, progress: 0, total: 0 }, 2, 2, empty).status, "limited");
empty.tiles["3,3"] = ["Robotics starved"];
assert.equal(buildingStatus({ type: "robotics", hp: 100, progress: 0, total: 0 }, 3, 3, empty).status, "starved");
empty.tiles["4,4"] = ["Robotics standby"];
assert.equal(buildingStatus({ type: "robotics", hp: 100, progress: 0, total: 0 }, 4, 4, empty).status, "standby");
assert.equal(buildingStatus({ type: "robotics", hp: 50, progress: 0, total: 0 }, 4, 4, empty).status, "standby", "standby takes precedence over damage");
empty.tiles["4,4"] = ["Greenhouse thirsty — reduced crop"];
assert.equal(buildingStatus({ type: "greenhouse", hp: 100, progress: 0, total: 0 }, 4, 4, empty).status, "limited");
empty.tiles["4,4"] = ["Aresfab limited +7 RP"];
assert.equal(buildingStatus({ type: "aresfab", hp: 100, progress: 0, total: 0 }, 4, 4, empty).status, "limited");
console.log("polish: camera bounds and forecast status fixtures pass");
