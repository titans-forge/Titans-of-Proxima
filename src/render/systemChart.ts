import { LOCATION_NAMES } from "../core/routeIntel";
import { isWindowOpen } from "../core/routes";
import type { LocationId } from "../core/types";
import { systemSprite } from "./assets";
import type { DrawState, Geom } from "./draw";
import { dockMarker, routeControl, routePoint, systemNodes } from "./systemGeometry";

export function renderSystemChart(ctx: CanvasRenderingContext2D, geom: Geom, draw: DrawState, time: number): void {
  const nodes = systemNodes(geom);
  const open = draw.game ? isWindowOpen(draw.game.turn) : true;
  const pairs: [LocationId, LocationId][] = [["earth", "luna"], ["earth", "mars"], ["luna", "mars"]];
  ctx.save();
  for (const [a, b] of pairs) {
    const selected = draw.route && [a, b].includes(draw.route.from) && [a, b].includes(draw.route.to);
    const control = routeControl(nodes, a, b, geom);
    ctx.strokeStyle = selected ? "#91dfdb" : b === "mars" && open ? "rgba(242,211,164,0.58)" : "rgba(177,193,211,0.24)";
    ctx.lineWidth = selected ? 2.5 : 1.3;
    ctx.setLineDash(selected ? [8, 7] : b === "mars" && !open ? [3, 7] : []);
    ctx.lineDashOffset = selected ? -time * 0.012 * draw.anim : 0;
    ctx.beginPath(); ctx.moveTo(nodes[a].x, nodes[a].y);
    ctx.quadraticCurveTo(control.x, control.y, nodes[b].x, nodes[b].y); ctx.stroke(); ctx.setLineDash([]);
    if (selected && draw.route) {
      const A = nodes[draw.route.from], B = nodes[draw.route.to];
      const p = routePoint(A, control, B, 0.6), ahead = routePoint(A, control, B, 0.62);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(ahead.y - p.y, ahead.x - p.x));
      ctx.fillStyle = "#91dfdb";
      ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-4, 4); ctx.lineTo(-4, -4); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }
  ctx.lineDashOffset = 0;
  for (const id of ["earth", "luna", "mars"] as const) {
    const p = nodes[id];
    const sprite = systemSprite(id);
    if (sprite.image.complete && sprite.image.naturalWidth > 0) {
      const size = p.r * 2.5;
      ctx.drawImage(sprite.image, sprite.sx, sprite.sy, sprite.sw, sprite.sh, p.x - size / 2, p.y - size / 2, size, size);
    } else {
      ctx.fillStyle = id === "earth" ? "#3e8ed0" : id === "luna" ? "#c0cad5" : "#e07a45";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.font = "600 14px Sora, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#e8eef6";
    ctx.fillText(LOCATION_NAMES[id], p.x, p.y + p.r + 22);
    if (draw.game) {
      ctx.font = "11px ui-monospace, monospace"; ctx.fillStyle = "#aab9c8";
      const status = id === "earth" ? "Supply & markets" : draw.game.worlds[id].founded ? `${draw.game.worlds[id].pop} crew` : "Unfounded";
      ctx.fillText(status, p.x, p.y + p.r + 39);
      const docked = draw.game.ships.filter(s => !s.mission && s.loc === id && s.id !== draw.game?.founding?.shipId).length;
      if (docked) {
        const dock = dockMarker(p);
        drawChartShip(ctx, dock.x, dock.y, 23, -Math.PI / 4);
        ctx.fillStyle = "#e8eef6"; ctx.fillText(String(docked), dock.x, dock.y + 23);
      }
    }
  }
  for (const [index, ship] of (draw.game?.ships.filter(s => s.mission) ?? []).entries()) {
    const mission = ship.mission!;
    const a = nodes[mission.from], b = nodes[mission.to], control = routeControl(nodes, mission.from, mission.to, geom);
    const t = Math.min(0.95, Math.max(0.05, 1 - mission.eta / Math.max(1, mission.total)));
    const pos = routePoint(a, control, b, t), ahead = routePoint(a, control, b, t + 0.01);
    drawChartShip(ctx, pos.x, pos.y, 29, Math.atan2(ahead.y - pos.y, ahead.x - pos.x));
    if (index < 4) {
      const text = `${ship.name.replace("PAS ", "")} · ${mission.eta} sol${mission.eta === 1 ? "" : "s"}`;
      ctx.font = "11px ui-monospace, monospace";
      const width = ctx.measureText(text).width + 12;
      const x = Math.max(geom.cx - geom.w / 2 + width / 2 + 6, Math.min(geom.cx + geom.w / 2 - width / 2 - 6, pos.x));
      const y = pos.y - 28 - (index % 2) * 16;
      ctx.fillStyle = "rgba(7,12,18,0.9)"; ctx.fillRect(x - width / 2, y - 11, width, 17);
      ctx.fillStyle = "#e8eef6"; ctx.textAlign = "center"; ctx.fillText(text, x, y + 1);
    }
  }
  ctx.restore();
}

function drawChartShip(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number): void {
  const sprite = systemSprite("ship");
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle + Math.PI / 4);
  if (sprite.image.complete && sprite.image.naturalWidth > 0) {
    ctx.drawImage(sprite.image, sprite.sx, sprite.sy, sprite.sw, sprite.sh, -size / 2, -size / 2, size, size);
  } else {
    ctx.rotate(-Math.PI / 4); ctx.fillStyle = "#e8eef6";
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, 4); ctx.lineTo(-3, 0); ctx.lineTo(-6, -4); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
