import { axialToPixel, hexPath, pixelToAxial, tileKey } from "../core/hex";
import { hash01 } from "../core/rng";
import { isWindowOpen } from "../core/routes";
import type { RouteSelection } from "../core/routeIntel";
import { landingAdvice } from "../core/actions";
import type { BuildingId, GameState, LocationId, Terrain, Tile, WorldId } from "../core/types";
import { terrainImage, buildingImage } from "./assets";
import { continuousTerrainRect } from "./terrainLayout";
import { hitSystemBody, systemNodes } from "./systemGeometry";
import { renderSystemChart } from "./systemChart";
import type { Forecast } from "../core/types";
import { buildingStatus, type BuildingStatusInfo } from "../core/buildingStatus";
import { MODULE_LABEL_FONT, MODULE_STATUS_FONT, MODULE_NAMES, layoutModuleAnnotations, moduleSpriteRect, moduleShadow, structuralOpacity, warningMarkerRect, type AnnotationRequest, type Rect } from "./moduleLayout";

export const HEX = 50;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Geom {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface DrawState {
  mode: "title" | "luna" | "mars" | "system";
  game: GameState | null;
  cam: Camera;
  hover: { q: number; r: number } | null;
  selected: { q: number; r: number } | null;
  hint: { q: number; r: number } | null;
  pulses: { world: WorldId; q: number; r: number; born: number }[];
  founding: boolean;
  anim: number;
  forecasts?: Partial<Record<WorldId, Forecast>>;
  route?: RouteSelection;
  annotationExclusions?: Rect[];
}

const STARS = Array.from({ length: 160 }, (_, i) => ({
  x: hash01(i, 2, 11),
  y: hash01(i, 5, 17),
  r: 0.35 + hash01(i, 8, 19) * 1.4,
  a: 0.2 + hash01(i, 3, 23) * 0.75,
  p: hash01(i, 9, 29) * Math.PI * 2,
}));

const TERRAIN: Record<Terrain, [string, string, string]> = {
  mare: ["#2e3642", "#3c4656", "#6d7c90"],
  highland: ["#8b9098", "#b7bcc4", "#eceff3"],
  crater: ["#4e5662", "#6a7382", "#d0d5dc"],
  polar: ["#d5e4f0", "#f4f8fb", "#9fb4c6"],
  rille: ["#596274", "#7d8798", "#c5ccd6"],
  plain: ["#c4623a", "#e08a55", "#f3c7a2"],
  canyon: ["#6d3128", "#8d4034", "#e0b09a"],
  dust: ["#d08a4e", "#e2b07a", "#f6e0c4"],
  volcano: ["#4a261f", "#7a3a2c", "#e7b39a"],
};

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  draw: DrawState,
  geom: Geom,
  time: number,
  dpr = 1,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const sky = ctx.createLinearGradient(0, 0, 0, cssH);
  if (draw.mode === "mars") {
    sky.addColorStop(0, "#140b0c");
    sky.addColorStop(1, "#2a120f");
  } else if (draw.mode === "luna") {
    sky.addColorStop(0, "#070910");
    sky.addColorStop(1, "#121722");
  } else {
    sky.addColorStop(0, "#05070c");
    sky.addColorStop(1, "#10151e");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cssW, cssH);
  drawStars(ctx, cssW, cssH, time, draw.anim);

  if (draw.mode === "luna" || draw.mode === "mars") {
    drawPlanetDisc(ctx, geom, draw.mode, time);
    ctx.save();
    ctx.translate(geom.cx + draw.cam.x, geom.cy + draw.cam.y);
    ctx.scale(draw.cam.zoom, draw.cam.zoom);
    if (draw.game) drawSurface(ctx, draw, geom, time);
    ctx.restore();
    if (draw.game) drawWeather(ctx, cssW, cssH, draw, time);
  } else {
    drawSystem(ctx, geom, draw, time);
  }
  drawVignette(ctx, cssW, cssH);
  if (draw.game && (draw.mode === "mars" || draw.mode === "luna")) drawSurfaceAnnotations(ctx, draw, geom);
}

function drawStars(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, anim: number): void {
  for (const s of STARS) {
    const tw = 0.65 + 0.35 * Math.sin(time * 0.001 * anim + s.p);
    ctx.fillStyle = `rgba(232, 238, 246, ${s.a * tw})`;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlanetDisc(ctx: CanvasRenderingContext2D, geom: Geom, mode: "luna" | "mars", time: number): void {
  const R = Math.min(geom.w, geom.h) * 0.72;
  const x = geom.cx;
  const y = geom.cy + 10;
  const g = ctx.createRadialGradient(x - R * 0.2, y - R * 0.25, R * 0.1, x, y, R);
  if (mode === "luna") {
    g.addColorStop(0, "rgba(196, 204, 214, 0.55)");
    g.addColorStop(0.45, "rgba(92, 100, 112, 0.35)");
    g.addColorStop(1, "rgba(20, 24, 32, 0)");
  } else {
    g.addColorStop(0, "rgba(232, 122, 74, 0.45)");
    g.addColorStop(0.5, "rgba(120, 48, 32, 0.32)");
    g.addColorStop(1, "rgba(40, 12, 8, 0)");
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = mode === "luna" ? "rgba(180, 200, 220, 0.08)" : "rgba(255, 170, 120, 0.08)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + Math.sin(time * 0.0001) * 4, y, R * 0.92, 0.2, 1.1);
  ctx.stroke();
}

function drawSurface(ctx: CanvasRenderingContext2D, draw: DrawState, geom: Geom, time: number): void {
  const game = draw.game!;
  const worldId: WorldId = draw.mode === "mars" ? "mars" : "luna";
  const world = game.worlds[worldId];
  const surface = terrainImage(worldId);
  if (surface.complete && surface.naturalWidth > 0 && world.tiles.length) {
    const rect = continuousTerrainRect(world.tiles, HEX, geom, surface.naturalWidth / surface.naturalHeight);
    ctx.drawImage(surface, rect.x, rect.y, rect.w, rect.h);
  }

  const links: { a: Tile; b: Tile }[] = [];
  const seen = new Set<string>();
  for (const t of world.tiles) {
    if (!t.building) continue;
    for (const n of world.tiles) {
      if (!n.building) continue;
      if (n === t) continue;
      const dq = Math.abs(t.q - n.q);
      const dr = Math.abs(t.r - n.r);
      const ds = Math.abs(t.q + t.r - n.q - n.r);
      if ((dq + dr + ds) / 2 !== 1) continue;
      const key = [tileKey(t.q, t.r), tileKey(n.q, n.r)].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ a: t, b: n });
    }
  }
  const buildings: { tile: Tile; x: number; y: number }[] = [];
  for (const tile of world.tiles) {
    const p = axialToPixel(tile.q, tile.r, HEX);
    const selected = draw.selected?.q === tile.q && draw.selected?.r === tile.r;
    const hover = draw.hover?.q === tile.q && draw.hover?.r === tile.r;
    drawHex(ctx, tile, p.x, p.y, worldId, game.seed, selected, hover);
    if (draw.hint && draw.hint.q === tile.q && draw.hint.r === tile.r && !tile.building) {
      ctx.save();
      hexPath(ctx, p.x, p.y, HEX - 4);
      ctx.strokeStyle = `rgba(242, 211, 164, ${0.55 + 0.35 * Math.sin(time * 0.005)})`;
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.restore();
    }
    if (draw.founding && draw.mode === worldId && game.founding?.world === worldId && !tile.building) {
      const advice = landingAdvice(game, worldId, tile.q, tile.r);
      if (advice === "good") {
        ctx.save();
        hexPath(ctx, p.x, p.y, HEX - 3);
        ctx.strokeStyle = `rgba(142, 215, 168, ${0.45 + 0.25 * Math.sin(time * 0.004)})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }
    }
    if (tile.building) buildings.push({ tile, x: p.x, y: p.y });
    const pulse = draw.pulses.find((x) => x.world === worldId && x.q === tile.q && x.r === tile.r);
    if (pulse) {
      const age = (time - pulse.born) / (700 / Math.max(0.4, draw.anim));
      if (age < 1) {
        hexPath(ctx, p.x, p.y, HEX - 2 + age * 10);
        ctx.strokeStyle = `rgba(242, 211, 164, ${1 - age})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = worldId === "luna" ? "rgba(158, 192, 255, 0.28)" : "rgba(255, 176, 120, 0.28)";
  for (const link of links) {
    const A = axialToPixel(link.a.q, link.a.r, HEX);
    const B = axialToPixel(link.b.q, link.b.r, HEX);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }
  buildings.sort((a, b) => a.y - b.y);
  for (const item of buildings) {
    const b = item.tile.building!;
    const info = buildingStatus(b, item.tile.q, item.tile.r, draw.forecasts?.[worldId] ?? null);
    drawModule(ctx, b.type, item.x, item.y, 58, b.hp, b.progress, b.total, info, worldId);
  }
}

function drawSurfaceAnnotations(ctx: CanvasRenderingContext2D, draw: DrawState, geom: Geom): void {
  const worldId = draw.mode === "mars" ? "mars" : "luna";
  const requests: AnnotationRequest[] = [];
  const roofs: { id: string; rect: { x: number; y: number; w: number; h: number } }[] = [];
  const labels = new Map<string, { name: string; status: BuildingStatusInfo; detail: boolean }>();
  const zoom = draw.cam.zoom;
  ctx.save();
  ctx.font = MODULE_LABEL_FONT;
  for (const tile of draw.game!.worlds[worldId].tiles) {
    const b = tile.building;
    if (!b) continue;
    const id = tileKey(tile.q, tile.r);
    const point = axialToPixel(tile.q, tile.r, HEX);
    const x = geom.cx + draw.cam.x + point.x * zoom;
    const y = geom.cy + draw.cam.y + (point.y - 2) * zoom;
    const sprite = buildingImage(worldId, b.type);
    const rect = moduleSpriteRect(worldId, b.type, sprite && sprite.image.naturalWidth > 0 ? sprite.sw / sprite.sh : 1);
    const roof = { x: x + rect.x * zoom, y: y + rect.y * zoom, w: rect.w * zoom, h: rect.h * zoom };
    roofs.push({ id, rect: roof });
    const selected = draw.selected?.q === tile.q && draw.selected?.r === tile.r;
    const hovered = draw.hover?.q === tile.q && draw.hover?.r === tile.r;
    const status = buildingStatus(b, tile.q, tile.r, draw.forecasts?.[worldId] ?? null);
    const detail = selected || hovered;
    if (zoom < 0.95 && !detail && status.status === "operating") continue;
    const name = MODULE_NAMES[b.type];
    const showStatus = detail || status.status !== "operating";
    const nameWidth = ctx.measureText(name).width;
    ctx.font = MODULE_STATUS_FONT;
    const statusWidth = showStatus ? ctx.measureText(status.label).width : 0;
    ctx.font = MODULE_LABEL_FONT;
    requests.push({ id, x, top: roof.y, bottom: roof.y + roof.h, left: roof.x, right: roof.x + roof.w, width: Math.ceil(Math.max(nameWidth, statusWidth)) + 14, height: showStatus ? 34 : 20, priority: selected ? 3 : hovered ? 2 : status.status !== "operating" ? 1 : 0 });
    labels.set(id, { name, status, detail: showStatus });
  }
  const viewport = { x: geom.cx - geom.w / 2 + 5, y: geom.cy - geom.h / 2 + 5, w: geom.w - 10, h: geom.h - 42 };
  const exclusions = draw.annotationExclusions ?? [];
  const placements = layoutModuleAnnotations(requests, viewport, roofs, exclusions);
  const markedExclusions = [...exclusions, ...placements.map(p => p.rect)];
  for (const request of requests) {
    const status = labels.get(request.id)!.status;
    if (status.status === "operating" || placements.some(p => p.id === request.id)) continue;
    const marker = warningMarkerRect(request, viewport, markedExclusions);
    if (!marker) continue;
    ctx.fillStyle = "#10151c";
    ctx.fillRect(marker.x, marker.y, marker.w, marker.h);
    ctx.strokeStyle = status.status === "unpowered" || status.status === "dead" ? "#ff9187" : "#f2d3a4";
    ctx.lineWidth = 1;
    ctx.strokeRect(marker.x + 0.5, marker.y + 0.5, marker.w - 1, marker.h - 1);
    ctx.font = MODULE_STATUS_FONT;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(status.status === "construction" ? "+" : "!", marker.x + marker.w / 2, marker.y + marker.h / 2);
    markedExclusions.push(marker);
  }
  // Paint important callouts last, while layout reserves their space first.
  for (const placement of placements.reverse()) {
    const { name, status, detail } = labels.get(placement.id)!;
    const r = placement.rect;
    const request = requests.find(item => item.id === placement.id)!;
    if (placement.leader) {
      ctx.beginPath();
      ctx.moveTo(request.x, (request.top + request.bottom) / 2);
      ctx.lineTo(r.x + r.w / 2, r.y + r.h / 2);
      ctx.strokeStyle = "rgba(6, 10, 16, 0.85)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = "rgba(232, 240, 248, 0.9)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(10, 14, 19, 0.9)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = request.priority >= 2 ? "rgba(242,211,164,0.85)" : "rgba(223,231,239,0.2)";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = MODULE_LABEL_FONT;
    ctx.fillStyle = "#f0f3f6";
    ctx.fillText(name, r.x + r.w / 2, r.y + 10);
    if (detail) {
      ctx.font = MODULE_STATUS_FONT;
      ctx.fillStyle = status.status === "operating" ? "#8ed7a8" : status.status === "unpowered" || status.status === "dead" ? "#ff9187" : "#f2d3a4";
      ctx.fillText(status.label, r.x + r.w / 2, r.y + 25);
    }
  }
  ctx.restore();
}

function drawHex(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  x: number,
  y: number,
  world: WorldId,
  seed: number,
  selected: boolean,
  hover: boolean,
): void {
  const [base, mid, hi] = TERRAIN[tile.terrain];
  const j = (tile.variant - 0.5) * 18;
  hexPath(ctx, x, y, HEX - 1.5);
  const g = ctx.createLinearGradient(x, y - HEX, x + j, y + HEX);
  g.addColorStop(0, mid);
  g.addColorStop(0.55, base);
  g.addColorStop(1, shade(base, -18));
  ctx.fillStyle = g;
  ctx.save();
  const terrainReady = terrainImage(world).complete && terrainImage(world).naturalWidth > 0;
  ctx.globalAlpha = terrainReady ? (tile.terrain === "polar" ? 0.23 : 0.09) : 1;
  ctx.fill();
  ctx.restore();

  ctx.save();
  hexPath(ctx, x, y, HEX - 2);
  ctx.clip();
  if (tile.terrain === "crater" || tile.terrain === "mare" || tile.terrain === "plain") {
    const cr = 6 + tile.variant * 10;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(x + 6, y + 2, cr, cr * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.stroke();
  }
  if (tile.terrain === "polar") {
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 12, y);
    ctx.lineTo(x - 2, y - 8);
    ctx.lineTo(x + 8, y + 4);
    ctx.stroke();
  }
  if (tile.terrain === "canyon") {
    ctx.strokeStyle = "rgba(40, 10, 8, 0.45)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - 16);
    ctx.quadraticCurveTo(x + 8, y, x - 2, y + 16);
    ctx.stroke();
  }
  if (tile.terrain === "dust") {
    ctx.strokeStyle = "rgba(90, 40, 16, 0.25)";
    ctx.beginPath();
    ctx.moveTo(x - 16, y + 4);
    ctx.lineTo(x + 16, y - 2);
    ctx.moveTo(x - 10, y + 10);
    ctx.lineTo(x + 14, y + 6);
    ctx.stroke();
  }
  if (tile.terrain === "volcano") {
    ctx.fillStyle = "#2a1410";
    ctx.beginPath();
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x + 10, y + 8);
    ctx.lineTo(x - 10, y + 8);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  hexPath(ctx, x, y, HEX - 2);
  ctx.fillStyle = world === "luna" ? "rgba(72, 96, 130, 0.12)" : "rgba(138, 62, 38, 0.11)";
  ctx.fill();
  ctx.restore();

  if (tile.ice >= 40) glyph(ctx, x - 12, y + 10, "#d7f4ff", "ice");
  if (tile.metal >= 55) glyph(ctx, x + 10, y + 10, "#f0e2c4", "metal");
  if (tile.he3 >= 50 && world === "luna") glyph(ctx, x, y + 12, "#f3c0ff", "he3");

  ctx.lineWidth = selected ? 3 : hover ? 2.2 : 1;
  ctx.strokeStyle = selected ? "rgba(242, 211, 164, 0.98)" : hover ? "rgba(232,238,246,0.82)" : "rgba(225,235,239,0.20)";
  hexPath(ctx, x, y, HEX - 1.2);
  ctx.stroke();
  void hi;
  void seed;
}

function glyph(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, kind: "ice" | "metal" | "he3"): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  if (kind === "ice") {
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, 5);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "metal") {
    ctx.fillRect(-4, -3, 8, 6);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawModule(
  ctx: CanvasRenderingContext2D,
  type: BuildingId,
  x: number,
  y: number,
  s: number,
  hp: number,
  progress: number,
  total: number,
  status: BuildingStatusInfo,
  world: WorldId,
): void {
  ctx.save();
  ctx.translate(x, y - 2);
  const shadow = moduleShadow(world, type);
  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.beginPath();
  ctx.ellipse(0, shadow.y, shadow.rx, shadow.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = structuralOpacity(status.status, hp);

  const palette: Record<string, string> = {
    command: "#d7c4a2",
    habitat: "#f2efe6",
    solar: "#1e2c44",
    fission: "#c6d4c2",
    fusion: "#d5e7ff",
    ice: "#d5f0f8",
    isru: "#e7d7b8",
    greenhouse: "#d9efd4",
    shipyard: "#c9c2b4",
    lab: "#d5dcf5",
    pad: "#b7c0c8",
    defense: "#d2c2b0",
    medical: "#f4f7fb",
    he3: "#edd0f5",
    depot: "#cabb9e",
    regolith: "#e2c09a",
    processor: "#f0c2a4",
    robotics: "#c8d6e6",
    aresfab: "#c7d0dc",
  };
  ctx.fillStyle = palette[type] ?? "#ddd";
  ctx.strokeStyle = "rgba(20,16,12,0.65)";
  ctx.lineWidth = 1.4;

  const sprite = buildingImage(world, type);
  if (sprite && sprite.image.complete && sprite.image.naturalWidth > 0 && sprite.sw > 0 && sprite.sh > 0) {
    const rect = moduleSpriteRect(world, type, sprite.sw / sprite.sh, s);
    ctx.drawImage(sprite.image, sprite.sx, sprite.sy, sprite.sw, sprite.sh, rect.x, rect.y, rect.w, rect.h);
    ctx.globalAlpha = 1;
    if (progress > 0) {
      ctx.strokeStyle = "rgba(242, 211, 164, 0.9)";
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
      ctx.setLineDash([]);
    }
    if (hp < 92 && progress === 0) {
      ctx.fillStyle = "rgba(10, 12, 16, 0.72)";
      ctx.fillRect(rect.x + 3, rect.y + rect.h - 5, rect.w - 6, 4);
      ctx.fillStyle = hp < 40 ? "#ff7d73" : "#f2c572";
      ctx.fillRect(rect.x + 3, rect.y + rect.h - 5, (rect.w - 6) * (hp / 100), 4);
    }
    ctx.restore();
    return;
  }

  if (type === "habitat" || type === "greenhouse" || type === "command") {
    ctx.beginPath();
    ctx.arc(0, 2, s * 0.46, Math.PI, 0);
    ctx.lineTo(s * 0.46, s * 0.45);
    ctx.lineTo(-s * 0.46, s * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = type === "greenhouse" ? "rgba(80, 160, 90, 0.85)" : "rgba(255, 196, 120, 0.9)";
    ctx.fillRect(-s * 0.16, s * 0.02, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.04, s * 0.02, s * 0.12, s * 0.2);
    if (type === "command") {
      ctx.strokeStyle = "#f2d3a4";
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.46);
      ctx.lineTo(0, -s * 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -s * 0.84, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = "#f2d3a4";
      ctx.fill();
    }
  } else if (type === "solar") {
    ctx.save();
    ctx.rotate(-0.5);
    ctx.fillStyle = "#16304a";
    ctx.fillRect(-s * 0.55, -s * 0.28, s * 1.1, s * 0.56);
    ctx.strokeStyle = "rgba(180,220,255,0.8)";
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s * 0.18, -s * 0.28);
      ctx.lineTo(i * s * 0.18, s * 0.28);
      ctx.stroke();
    }
    ctx.restore();
  } else if (type === "fission" || type === "fusion" || type === "processor") {
    ctx.beginPath();
    ctx.moveTo(-s * 0.28, s * 0.4);
    ctx.lineTo(-s * 0.16, -s * 0.35);
    ctx.lineTo(s * 0.16, -s * 0.35);
    ctx.lineTo(s * 0.28, s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -s * 0.02, s * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = type === "fusion" ? "#9ec0ff" : type === "processor" ? "#ffb088" : "#b7e0a8";
    ctx.fill();
  } else if (type === "ice" || type === "regolith" || type === "he3") {
    ctx.fillRect(-s * 0.1, -s * 0.45, s * 0.2, s * 0.9);
    ctx.beginPath();
    ctx.moveTo(-s * 0.34, s * 0.2);
    ctx.lineTo(0, -s * 0.15);
    ctx.lineTo(s * 0.34, s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (type === "isru" || type === "depot") {
    ctx.fillRect(-s * 0.4, -s * 0.05, s * 0.28, s * 0.42);
    ctx.fillRect(-s * 0.05, -s * 0.2, s * 0.24, s * 0.57);
    ctx.fillRect(s * 0.22, 0, s * 0.2, s * 0.37);
    ctx.strokeRect(-s * 0.4, -s * 0.05, s * 0.28, s * 0.42);
  } else if (type === "pad") {
    ctx.beginPath();
    ctx.arc(0, s * 0.1, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#f2d3a4";
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.15);
    ctx.lineTo(0, -s * 0.55);
    ctx.lineTo(s * 0.16, -s * 0.38);
    ctx.stroke();
  } else if (type === "defense") {
    ctx.fillRect(-s * 0.28, s * 0.05, s * 0.56, s * 0.28);
    ctx.beginPath();
    ctx.arc(0, s * 0.02, s * 0.16, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 0.45, -s * 0.28);
    ctx.stroke();
  } else if (type === "medical") {
    ctx.beginPath();
    ctx.arc(0, s * 0.05, s * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#d45555";
    ctx.fillRect(-s * 0.08, -s * 0.16, s * 0.16, s * 0.4);
    ctx.fillRect(-s * 0.2, -s * 0.02, s * 0.4, s * 0.14);
  } else if (type === "lab") {
    ctx.beginPath();
    ctx.arc(0, s * 0.28, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-s * 0.05, -s * 0.35, s * 0.1, s * 0.55);
    ctx.beginPath();
    ctx.arc(0, -s * 0.4, s * 0.22, Math.PI, 0);
    ctx.stroke();
  } else {
    ctx.fillRect(-s * 0.36, -s * 0.1, s * 0.72, s * 0.46);
    ctx.strokeRect(-s * 0.36, -s * 0.1, s * 0.72, s * 0.46);
    ctx.beginPath();
    ctx.moveTo(-s * 0.4, -s * 0.1);
    ctx.lineTo(0, -s * 0.42);
    ctx.lineTo(s * 0.4, -s * 0.1);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  if (progress > 0) {
    ctx.strokeStyle = "rgba(242, 211, 164, 0.9)";
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(-s * 0.62, -s * 0.62, s * 1.24, s * 1.24);
    ctx.setLineDash([]);
    const frac = total > 0 ? 1 - progress / total : 0;
    ctx.beginPath();
    ctx.strokeStyle = "#f2d3a4";
    ctx.lineWidth = 2;
    ctx.arc(0, 0, s * 0.78, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
  }
  if (hp < 92 && progress === 0) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(-s * 0.4, s * 0.62, s * 0.8, 4);
    ctx.fillStyle = hp < 40 ? "#ff7d73" : "#f2c572";
    ctx.fillRect(-s * 0.4, s * 0.62, s * 0.8 * (hp / 100), 4);
  }
  ctx.restore();
}

function drawWeather(ctx: CanvasRenderingContext2D, w: number, h: number, draw: DrawState, time: number): void {
  const game = draw.game!;
  const world = draw.mode === "mars" ? game.worlds.mars : game.worlds.luna;
  if (world.dust > 0 && draw.mode === "mars") {
    ctx.fillStyle = "rgba(180, 90, 40, 0.14)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255, 196, 140, 0.25)";
    for (let i = 0; i < 28; i++) {
      const y = (hash01(i, 4, 8) * h + time * 0.05 * draw.anim) % h;
      const x = hash01(i, 1, 4) * w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 40, y + 6);
      ctx.stroke();
    }
  }
  if ((world.radiation > 0 || world.shelter > 0) && draw.mode === "luna") {
    ctx.fillStyle = world.shelter ? "rgba(80, 120, 180, 0.08)" : "rgba(255, 220, 140, 0.07)";
    ctx.fillRect(0, 0, w, h);
  }
}

function drawSystem(ctx: CanvasRenderingContext2D, geom: Geom, draw: DrawState, time: number): void {
  if (draw.mode === "system") {
    renderSystemChart(ctx, geom, draw, time);
    return;
  }
  const c = geom;
  const earth = { x: c.cx - Math.min(220, c.w * 0.22), y: c.cy + 16 };
  const mars = { x: c.cx + Math.min(250, c.w * 0.26), y: c.cy - 18 };
  const angle = (draw.game ? draw.game.turn * 0.55 : 0) + time * 0.00012 * draw.anim;
  const luna = { x: earth.x + Math.cos(angle) * 108, y: earth.y + Math.sin(angle) * 64 };

  ctx.save();
  ctx.strokeStyle = "rgba(180, 200, 220, 0.18)";
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.ellipse(earth.x, earth.y, 108, 64, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const open = draw.game ? isWindowOpen(draw.game.turn) : true;
  ctx.strokeStyle = open ? "rgba(242, 211, 164, 0.85)" : "rgba(180, 190, 200, 0.25)";
  ctx.lineWidth = open ? 2.4 : 1.2;
  ctx.beginPath();
  ctx.moveTo(earth.x, earth.y);
  ctx.quadraticCurveTo(c.cx, c.cy - 90, mars.x, mars.y);
  ctx.stroke();

  body(ctx, earth.x, earth.y, 42, ["#1d4e89", "#3e8ed0", "#d6f0ff"], "Earth");
  body(ctx, luna.x, luna.y, 16, ["#9aa3ae", "#d5dbe3", "#f7f8fa"], "Luna");
  body(ctx, mars.x, mars.y, 30, ["#8a3d28", "#e07a45", "#f6c7a4"], "Mars");

  if (!draw.game) return;
  for (const ship of draw.game.ships) {
    let pos = ship.loc === "earth" ? earth : ship.loc === "luna" ? luna : ship.loc === "mars" ? mars : null;
    if (ship.mission) {
      const a = ship.mission.from === "earth" ? earth : ship.mission.from === "luna" ? luna : mars;
      const b = ship.mission.to === "earth" ? earth : ship.mission.to === "luna" ? luna : mars;
      const p = 1 - ship.mission.eta / Math.max(1, ship.mission.total);
      const wobble = 0.08 * Math.sin(time * 0.001 + ship.hull);
      const t = Math.min(0.98, Math.max(0.02, p + wobble * 0.05));
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.18;
      const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
      pos = quad(a, { x: mx, y: my }, b, t);
    }
    if (!pos) continue;
    ctx.save();
    ctx.translate(pos.x, pos.y - (ship.mission ? 0 : 28));
    ctx.rotate(time * 0.0004);
    ctx.fillStyle = ship.cls === "colony" ? "#f2d3a4" : "#d5e4f5";
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, 4);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(232,238,246,0.8)";
    ctx.font = "12px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(ship.name.replace("PAS ", ""), pos.x, pos.y - (ship.mission ? 16 : 40));
  }
}

function quad(a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

function body(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colors: [string, string, string], label: string): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, colors[2]);
  g.addColorStop(0.45, colors[1]);
  g.addColorStop(1, colors[0]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#e8eef6";
  ctx.font = "600 13px Sora, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, x, y + r + 18);
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

export function worldFromScreen(mx: number, my: number, cam: Camera, geom: Geom): { x: number; y: number } {
  return {
    x: (mx - geom.cx - cam.x) / cam.zoom,
    y: (my - geom.cy - cam.y) / cam.zoom,
  };
}

export function pickHex(mx: number, my: number, cam: Camera, geom: Geom): { q: number; r: number } | null {
  const w = worldFromScreen(mx, my, cam, geom);
  const axial = pixelToAxial(w.x, w.y, HEX);
  const center = axialToPixel(axial.q, axial.r, HEX);
  const dx = w.x - center.x;
  const dy = w.y - center.y;
  if (dx * dx + dy * dy > HEX * HEX * 1.15) return null;
  return axial;
}

export function pickBody(mx: number, my: number, geom: Geom): LocationId | null {
  return hitSystemBody(mx, my, systemNodes(geom));
}
