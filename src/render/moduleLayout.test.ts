import { assert } from "../core/testAssert";
import { createGame } from "../core/state";
import { spriteSpec, buildingImage, buildingSpriteStyle } from "./assets";
import { renderFrame, HEX } from "./draw";
import { axialToPixel } from "../core/hex";
import { layoutModuleAnnotations, moduleSpriteRect, moduleShadow, structuralOpacity, overlaps, warningMarkerRect, MODULE_LABEL_FONT } from "./moduleLayout";
import type { AnnotationRequest, Rect } from "./moduleLayout";

assert.equal(spriteSpec("mars", "aresfab").file, "proxima-aresfab-mars-v2.png");
assert.equal(spriteSpec("luna", "aresfab").file, "proxima-industry-v1.png");
assert.equal(spriteSpec("luna", "aresfab").index, 2);
for (const type of ["pad", "robotics", "depot"] as const) {
  assert.equal(JSON.stringify(spriteSpec("mars", type)), JSON.stringify(spriteSpec("luna", type)), "Other industrial mappings stay shared");
}
for (const aspect of [0.7, 1, 1.8]) {
  const rect = moduleSpriteRect("mars", "aresfab", aspect);
  assert.ok(Math.abs(rect.w / rect.h - aspect) < 1e-8, "Sprite proportions are preserved");
  assert.ok(Math.abs(rect.y + rect.h * 0.87 - 24) < 1e-8, "Foundation contact remains at its ground pivot");
  assert.ok(rect.w <= 87 && rect.h <= 87);
}
for (const aspect of [0, NaN, Infinity]) assert.equal(moduleSpriteRect("mars", "aresfab", aspect).w, 87);
assert.equal(moduleSpriteRect("luna", "aresfab").w, 58 * 1.64, "Luna frame sizing remains unchanged");
const shadow = moduleShadow("mars", "aresfab");
assert.ok(shadow.y + shadow.ry <= 25, "Contact shadow is tucked below the foundation, not a detached oval");
for (const status of ["operating", "unpowered", "dead", "construction", "starved", "limited", "standby"] as const) {
  assert.ok(structuralOpacity(status, 0) >= 0.75 && structuralOpacity(status, 100) <= 1, "Stopped buildings stay opaque enough to read");
}

const viewport: Rect = { x: 5, y: 5, w: 390, h: 400 };
for (const zoom of [0.55, 0.94, 0.95, 1, 2.5]) {
  for (const dpr of [1, 2]) {
    const requests: AnnotationRequest[] = [
      { id: "selected", x: 180, top: 100, bottom: 100 + 58 * zoom, left: 140, right: 220, width: 90, height: 34, priority: 3 },
      { id: "hovered", x: 185, top: 106, bottom: 106 + 58 * zoom, left: 145, right: 225, width: 86, height: 34, priority: 2 },
      { id: "ordinary", x: 182, top: 100, bottom: 100 + 58 * zoom, left: 142, right: 222, width: 64, height: 20, priority: 0 },
      { id: "edge", x: 7, top: 150, bottom: 200, left: -28, right: 42, width: 90, height: 34, priority: 3 },
    ];
    const placements = layoutModuleAnnotations(requests, viewport, []);
    assert.ok(placements.some(p => p.id === "selected"));
    assert.ok(placements.some(p => p.id === "edge"), "Selected edge callout is clamped/repositioned");
    for (const p of placements) {
      assert.ok(p.rect.x >= viewport.x && p.rect.y >= viewport.y && p.rect.x + p.rect.w <= viewport.x + viewport.w && p.rect.y + p.rect.h <= viewport.y + viewport.h);
      assert.equal(p.rect.h, requests.find(r => r.id === p.id)!.height, `Annotation height is CSS-sized at zoom ${zoom}, DPR ${dpr}`);
      for (const other of placements) if (p !== other) assert.ok(!overlaps(p.rect, other.rect), "Annotation boxes never overlap");
    }
    assert.equal(JSON.stringify(placements), JSON.stringify(layoutModuleAnnotations([...requests].reverse(), viewport, [])), "Layout is independent of module paint order");
  }
}
const blocked: AnnotationRequest = { id: "fab", x: 200, top: 150, bottom: 200, left: 160, right: 240, width: 90, height: 20, priority: 0 };
const coveringRoof = [{ id: "neighbor", rect: { x: 5, y: 5, w: 390, h: 400 } }];
assert.equal(layoutModuleAnnotations([blocked], viewport, coveringRoof).length, 0, "Ordinary labels yield to neighboring art");
assert.equal(layoutModuleAnnotations([{ ...blocked, priority: 3 }], viewport, coveringRoof).length, 1, "Important callouts retain a readable backed fallback");
assert.equal(layoutModuleAnnotations([{ ...blocked, x: -200, left: -240, right: -160, priority: 3 }], viewport, []).length, 0, "Offscreen selections are not falsely pinned to a screen edge");
const banner = { x: 80, y: 200, w: 240, h: 65 };
const avoidingBanner = layoutModuleAnnotations([{ ...blocked, priority: 3 }], viewport, [], [banner]);
assert.equal(avoidingBanner.length, 1);
assert.ok(!overlaps(avoidingBanner[0]!.rect, banner), "Selected callouts avoid the actual banner/HUD bounds");
const crowded = { ...blocked, priority: 1 };
const blockedCallouts = [
  { x: 120, y: 202, w: 170, h: 32 },
  { x: 120, y: 120, w: 170, h: 27 },
  { x: 244, y: 140, w: 110, h: 55 },
  { x: 45, y: 140, w: 112, h: 55 },
];
assert.equal(layoutModuleAnnotations([crowded], viewport, coveringRoof, blockedCallouts).length, 0, "Crowded warning has no room for a full callout");
const marker = warningMarkerRect(crowded, viewport, blockedCallouts);
assert.ok(marker !== null, "An on-building warning survives callout suppression");
assert.ok(marker!.x >= crowded.left && marker!.x + marker!.w <= crowded.right);
assert.equal(warningMarkerRect(crowded, viewport, [viewport]), null, "A structure completely hidden by HUD is not relabeled elsewhere");

class TestImage {
  static mode: "loaded" | "loading" | "failed" = "loaded";
  src = "";
  get complete(): boolean { return TestImage.mode !== "loading"; }
  get naturalWidth(): number { return TestImage.mode === "loaded" ? 1254 : 0; }
  get naturalHeight(): number { return this.naturalWidth; }
}
const originalImage = globalThis.Image;
globalThis.Image = TestImage as unknown as typeof Image;
try {
  const marsSprite = buildingImage("mars", "aresfab")!;
  assert.equal(marsSprite.image.src, "/assets/proxima-aresfab-mars-v2.png");
  assert.equal(marsSprite.sw, 1254);
  assert.equal(marsSprite.sx, 0);
  assert.ok(buildingSpriteStyle("mars", "aresfab").includes('background-size:100% 100%'));
  assert.ok(buildingSpriteStyle("mars", "aresfab").includes(marsSprite.image.src));
  assert.equal(buildingImage("luna", "aresfab")!.sw, 627);

  const game = createGame("survey", 42);
  const tile = game.worlds.mars.tiles.find(t => t.q === 0 && t.r === 0)!;
  tile.building = { type: "aresfab", hp: 10, progress: 0, total: 3 };
  const neighbor = game.worlds.mars.tiles.find(t => t.q === 1 && t.r === 0)!;
  neighbor.building = { type: "solar", hp: 100, progress: 1, total: 1 };
  const point = axialToPixel(tile.q, tile.r, HEX);
  for (const mode of ["loaded", "loading", "failed"] as const) {
    TestImage.mode = mode;
    for (const zoom of [0.55, 0.95, 2.5]) for (const dpr of [1, 2]) {
      const operations: string[] = [];
      const texts: { text: string; font: string; alpha: number }[] = [];
      const properties = { font: "", globalAlpha: 1, textBaseline: "alphabetic" } as Record<string, unknown>;
      const stack: Record<string, unknown>[] = [];
      const ctx = new Proxy(properties, {
        get(target, key: string) {
          if (key in target) return target[key];
          if (key === "save") return () => stack.push({ ...target });
          if (key === "restore") return () => Object.assign(target, stack.pop());
          if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
          if (key === "measureText") return (text: string) => ({ width: text.length * 6 });
          if (key === "fillText") return (text: string) => { operations.push("text"); texts.push({ text, font: String(target.font), alpha: Number(target.globalAlpha) }); };
          return () => operations.push(key);
        },
      }) as unknown as CanvasRenderingContext2D;
      renderFrame(ctx, 760, 620, { mode: "mars", game, cam: { x: -point.x * zoom, y: -point.y * zoom, zoom }, hover: null, selected: { q: tile.q, r: tile.r }, hint: null, pulses: [], founding: false, anim: 0 }, { cx: 380, cy: 310, w: 760, h: 620 }, 0, dpr);
      assert.ok(texts.some(t => t.text === "Chip foundry" && t.font === MODULE_LABEL_FONT && t.alpha === 1), `${mode} image path keeps selected typography fully visible`);
      assert.ok(texts.some(t => t.text === "Offline"), "Stopped state is disclosed independently of sprite opacity");
      if (mode === "loaded") assert.ok(operations.lastIndexOf("drawImage") < operations.indexOf("text"), "Text is painted after all sprites");
    }
  }
  TestImage.mode = "failed";
  const warningTexts: string[] = [];
  const warningCtx = new Proxy({}, { get(_target, key: string) {
    if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
    if (key === "measureText") return (text: string) => ({ width: text.length * 6 });
    if (key === "fillText") return (text: string) => warningTexts.push(text);
    return () => {};
  } }) as unknown as CanvasRenderingContext2D;
  renderFrame(warningCtx, 390, 400, { mode: "mars", game, cam: { x: 0, y: 0, zoom: 0.55 }, hover: null, selected: null, hint: null, pulses: [], founding: false, anim: 0, annotationExclusions: [{ x: 120, y: 218, w: 150, h: 40 }, { x: 120, y: 140, w: 150, h: 30 }, { x: 223, y: 166, w: 110, h: 54 }, { x: 40, y: 166, w: 125, h: 54 }] }, { cx: 195, cy: 200, w: 390, h: 400 }, 0);
  assert.ok(warningTexts.includes("!"), "A low-zoom stopped module retains a warning when full annotation placement fails");
} finally {
  globalThis.Image = originalImage;
}
console.log("module layout: Mars-only sprite, ground pivot, aspect, opacity, callout collisions, zoom/DPR and loaded/loading/failed rendering pass");
