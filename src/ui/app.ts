import {
  buildingCost,
  landingAdvice,
  buyPrice,
  cancelBuilding,
  chooseEvent,
  commissionShip,
  disembark,
  foundColony,
  foundingKit,
  fulfillContract,
  hirePrice,
  launchShip,
  offloadFuel,
  orderSupply,
  placeBuilding,
  placementError,
  previewLaunch,
  queueResearch,
  repairBuilding,
  sellCargo,
  sellPrice,
  unloadShip,
  type LaunchDraft,
} from "../core/actions";
import {
  BRANCH_LABEL,
  BRANCH_ORDER,
  BUILDINGS,
  BUILD_MENU,
  CARGO_IDS,
  DIFF,
  FOUNDING_MIN,
  GROUP_LABEL,
  RESOURCE_META,
  SHIPS,
  SHIP_CLASSES,
  TECHS,
  TECH_BY_ID,
  TERRAIN_LABEL,
} from "../core/data";
import { fmt, fmtInt, fmtSigned } from "../core/format";
import { applyTurn, blockingReason, forecast, objectives, researchRate, runway } from "../core/sim";
import { buildingImpact, constructionGuidance, type ConstructionGuidance } from "../core/guidance";
import { cargoLimit, fuelLimit, initialLaunchDraft, launchSummary, quotaReady, shipManifestKey, shipIntegrity } from "./fleetDraft";
import { isWindowOpen, planRoute, solsUntilWindow, solsWindowLeft } from "../core/routes";
import { availableRouteHull, chartShipStatus, compareDepartures, LOCATION_NAMES, windowCalendar, windowSummary, type DepartureOption, type RouteSelection } from "../core/routeIntel";
import { loadFrom, loadMeta, saveMeta, saveTo, type Meta, type SlotId } from "../core/save";
import { createGame } from "../core/state";
import type { BuildingId, CargoId, Difficulty, GameState, LocationId, Ship, Tile, TechId, WorldId } from "../core/types";
import { RESOURCES } from "../core/types";
import { axialToPixel } from "../core/hex";
import { HEX, pickBody, pickHex, renderFrame, worldFromScreen, type Camera, type Geom } from "../render/draw";
import { Soundscape } from "../audio/audio";
import { SoundtrackPlayer, soundtrackTracks } from "../audio/soundtrack";
import { buildingSpriteStyle } from "../render/assets";
import { FIELD_GUIDE, FIELD_GUIDE_CATEGORIES, guideCategory } from "../core/fieldGuide";
import { buildingStatus } from "../core/buildingStatus";
import { exportPlan, operationsBrief, type OperationsBrief } from "../core/operations";
import { crewArrivalAdvice, crewCapacity, crewDepartureBlocker, crewReturnPlan, crewTransferPlan } from "../core/crewTransport";
import { previewShipRepair, repairShip } from "../core/shipService";
import { boundsForTiles, clampCamera } from "../render/camera";
import type { Forecast } from "../core/types";
import { cinematicSeenKey, decideCinematic, shouldShowPendingMarsArrival, type CinematicKind } from "./cinematics";

interface Toast {
  id: number;
  text: string;
  born: number;
  bad?: boolean;
}
interface UiState {
  screen: "title" | "play";
  view: "luna" | "mars" | "system";
  diff: Difficulty;
  selected: { q: number; r: number } | null;
  hover: { q: number; r: number } | null;
  cam: Camera & { tx: number; ty: number };
  modal: string | null;
  tutorial: number | null;
  shipId: string | null;
  draft: LaunchDraft | null;
  route: RouteSelection;
  order: { dest: WorldId; food: number; water: number; oxygen: number; metals: number; propellant: number };
  pulses: { world: WorldId; q: number; r: number; born: number }[];
  toasts: Toast[];
  seq: number;
  confirm: { title: string; body: string; yes: string; go: () => void } | null;
  confirmReturn: string | null;
  guideCategory: (typeof FIELD_GUIDE_CATEGORIES)[number];
  drawer: "l" | "r" | null;
  cinematic: CinematicKind | null;
  cinematicReplay: boolean;
}

const STEPS: { title: string; body: string; coach: string }[] = [
  {
    title: "Charter brief",
    body: "You direct Proxima Astra. Luna is already occupied. Mars is surveyed and empty. Earth still feeds you — for a price, and after a delay.",
    coach: "",
  },
  {
    title: "Read the ground",
    body: "This is Luna. Drag to pan, scroll to zoom, click a hex. Pale tiles are polar ice. Cyan marks ice, a square marks metals, a violet dot is helium-3.",
    coach: "",
  },
  {
    title: "The sol clock",
    body: "Every Resolve Sol spends food, water, and oxygen. The left column shows how many sols each stock will cover. Build an ice mine on polar ground touching the outpost, then a greenhouse beside it.",
    coach: "end",
  },
  {
    title: "The corridor",
    body: "Press 3 for the system chart. A Mars window opens on sol 5 and stays open through sol 8. Crossings inside the window are shorter and safer. Off-window launches still fly.",
    coach: "",
  },
  {
    title: "Halcyon",
    body: "On sol 5 Earth releases the colony hull PAS Halcyon. Open Fleet, press Founding kit, and launch for Mars while the window is open. When it arrives, you choose the landing hex — green outlines have ice and room.",
    coach: "fleet",
  },
  {
    title: "One library",
    body: "Open Research and queue a project. Photovoltaic Tuning, Closed-Loop ECLSS, and Methalox ISRU each change what the bases can survive. Labs on either world feed the same tree.",
    coach: "",
  },
  {
    title: "How a charter ends",
    body: "Storms and Earth will demand a choice. There is no free answer. The Goals list is the only victory: both worlds self-sufficient, a real fleet, a capstone technology, and a solvent charter. Collapse, abandonment, or a revoked line ends the run.",
    coach: "goals",
  },
];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

export class GameApp {
  private game: GameState | null = null;
  private meta: Meta;
  private ui: UiState;
  private audio = new Soundscape();
  private music = new SoundtrackPlayer(() => { if (this.ui?.modal === "music") this.paint(); });
  private modalOpener: HTMLElement | null = null;
  private modalMarkup = "";
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private root: HTMLElement;
  private last = 0;
  private dpr = 1;
  private ptr: { id: number; x: number; y: number; moved: number; cx: number; cy: number } | null = null;
  private forecasts: Partial<Record<WorldId, Forecast>> = {};
  private guidance: Partial<Record<WorldId, ConstructionGuidance>> = {};
  private draftBasis = "";

  constructor(root: HTMLElement) {
    this.root = root;
    this.meta = loadMeta();
    if (!localStorage.getItem("proxima-astra:v1:meta") && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.meta.anim = 0.65;
    }
    this.ui = {
      screen: "title",
      view: "luna",
      diff: "charter",
      selected: null,
      hover: null,
      cam: { x: 0, y: 0, tx: 0, ty: 0, zoom: 1.28 },
      modal: null,
      tutorial: null,
      shipId: null,
      draft: null,
      route: { from: "earth", to: "mars", cls: "colony" },
      order: { dest: "luna", food: 12, water: 12, oxygen: 12, metals: 0, propellant: 8 },
      pulses: [],
      toasts: [],
      seq: 1,
      confirm: null,
      confirmReturn: null,
      guideCategory: "Moon",
      drawer: null,
      cinematic: null,
      cinematicReplay: false,
    };
    root.innerHTML = `
      <canvas id="view" aria-label="Charter map"></canvas>
      <div id="toasts"></div>
      <div id="title"></div>
      <div id="hud" hidden>
        <div id="scrim" hidden data-act="scrim"></div>
        <header class="top luna">
          <div class="brand">
            <span class="mark" aria-hidden="true"></span>
            <div><div class="kicker">Titans</div><div class="word">Proxima Astra</div></div>
          </div>
          <div class="seg" role="tablist" aria-label="Theater">
            <button type="button" data-act="view" data-id="luna" id="tab-luna" role="tab">Luna</button>
            <button type="button" data-act="view" data-id="system" id="tab-system" role="tab">System</button>
            <button type="button" data-act="view" data-id="mars" id="tab-mars" role="tab">Mars</button>
          </div>
          <div class="top-meta">
            <button type="button" class="only-mobile texty" data-act="drawer" data-id="l">Colony</button>
            <button type="button" class="only-mobile texty" data-act="drawer" data-id="r" id="site-drawer">Site</button>
            <div class="sol" id="sol-readout">Sol 1</div>
            <div class="credits" id="credit-readout">0 cr</div>
            <button type="button" class="texty" data-act="mute" id="btn-mute">Mute</button>
            <button type="button" class="texty" data-act="modal" data-id="music" id="btn-music">Music</button>
            <button type="button" class="texty" data-act="modal" data-id="settings">Menu</button>
          </div>
        </header>
        <div class="stage">
          <aside id="left" class="panel panel-l"></aside>
          <div id="viewport">
            <div id="banner" hidden></div>
            <div id="system-readout" hidden></div>
            <button type="button" class="home-control" data-act="home" aria-label="Center colony">⌂ <span>Home</span></button>
            <div id="legend"></div>
            <div id="tip" hidden></div>
          </div>
          <aside id="right" class="panel panel-r"></aside>
        </div>
        <footer class="bottom">
          <div class="log" id="log" aria-live="polite"></div>
          <div class="actions">
            <button type="button" class="texty" data-act="modal" data-id="fleet" id="btn-fleet">Fleet</button>
            <button type="button" class="texty" data-act="modal" data-id="tech">Research</button>
            <button type="button" class="texty" data-act="modal" data-id="earth">Earth</button>
            <button type="button" class="texty" data-act="modal" data-id="objectives">Goals</button>
            <button type="button" class="texty" data-act="modal" data-id="guide">Field guide</button>
            <button type="button" class="texty hide-mobile" data-act="modal" data-id="help">Help</button>
            <button type="button" class="texty" data-act="modal" data-id="event" id="btn-event" hidden>Situation</button>
            <button type="button" id="end-sol" data-act="end">Resolve sol</button>
          </div>
          <p class="keys hide-mobile" id="end-reason">1 Luna · 2 Mars · 3 System · E resolve · F fleet · R research · C Earth · G goals · M mute</p>
        </footer>
      </div>
      <div id="modal" hidden>
        <div class="backdrop" data-act="close"></div>
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <header><h2 id="modal-title"></h2><button type="button" class="texty" id="modal-close" data-act="close">Close</button></header>
          <div id="modal-body"></div>
        </div>
      </div>
      <div id="tutorial" hidden></div>
      <div id="cinematic" hidden></div>
    `;
    const canvas = root.querySelector("#view") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.music.element.id = "classical-audio";
    this.music.element.hidden = true;
    this.root.append(this.music.element);
    this.audio.setMuted(this.meta.muted);
    this.music.setMuted(this.meta.muted);
    this.bind();
    this.resize();
    this.paintTitle();
    requestAnimationFrame(this.loop);
  }

  private bind(): void {
    this.root.addEventListener("click", (ev) => {
      const el = (ev.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!el) return;
      this.audio.unlock();
      this.onAct(el);
    });
    this.root.addEventListener("input", (ev) => this.onInput(ev));
    this.root.addEventListener("change", (ev) => this.onChange(ev));
    this.canvas.addEventListener("pointerdown", (ev) => this.onDown(ev));
    this.canvas.addEventListener("pointermove", (ev) => this.onMove(ev));
    this.canvas.addEventListener("pointerup", (ev) => this.onUp(ev));
    this.canvas.addEventListener("pointercancel", () => { this.clearTip(); this.endDrag(); });
    this.canvas.addEventListener("pointerleave", () => this.clearTip());
    this.canvas.addEventListener(
      "wheel",
      (ev) => {
        if (this.ui.screen !== "play" || this.ui.view === "system" || this.ui.cinematic) return;
        ev.preventDefault();
        this.zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.08 : 0.92);
      },
      { passive: false },
    );
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (ev) => this.onKey(ev));
    window.addEventListener("pointerdown", () => this.audio.unlock(), { once: true });
  }

  private loop = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0.016);
    this.last = now;
    const k = 1 - Math.pow(0.0015, dt * this.meta.anim);
    this.ui.cam.x += (this.ui.cam.tx - this.ui.cam.x) * k;
    this.ui.cam.y += (this.ui.cam.ty - this.ui.cam.y) * k;
    this.clampCam();
    const life = 4200 / this.meta.anim;
    const before = this.ui.toasts.length;
    this.ui.toasts = this.ui.toasts.filter((t) => now - t.born < life);
    this.ui.pulses = this.ui.pulses.filter((p) => now - p.born < 900 / this.meta.anim);
    if (this.ui.toasts.length !== before) this.paintToasts();
    this.draw(now);
    requestAnimationFrame(this.loop);
  };

  private resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.clampCam();
  }

  private clampCam(): void {
    if (!this.game || this.ui.view === "system") return;
    const vp = this.root.querySelector("#viewport")?.getBoundingClientRect();
    if (!vp) return;
    clampCamera(this.ui.cam, { width: vp.width, height: vp.height }, boundsForTiles(this.game.worlds[this.ui.view].tiles, HEX));
  }

  private geom(): Geom {
    const rect = this.canvas.getBoundingClientRect();
    if (this.ui.screen === "title") return { cx: rect.width / 2, cy: rect.height / 2, w: rect.width, h: rect.height };
    const vp = (this.root.querySelector("#viewport") as HTMLElement).getBoundingClientRect();
    return {
      cx: vp.left - rect.left + vp.width / 2,
      cy: vp.top - rect.top + vp.height / 2,
      w: vp.width,
      h: vp.height,
    };
  }

  private draw(now: number): void {
    const g = this.geom();
    const canvasRect = this.canvas.getBoundingClientRect();
    const annotationExclusions = Array.from(this.root.querySelectorAll<HTMLElement>("#banner, #legend, .home-control"))
      .filter(el => !el.hidden)
      .map(el => el.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0)
      .map(rect => ({ x: rect.left - canvasRect.left, y: rect.top - canvasRect.top, w: rect.width, h: rect.height }));
    renderFrame(
      this.ctx,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
      {
        mode: this.ui.screen === "title" ? "title" : this.ui.view,
        game: this.game,
        cam: this.ui.cam,
        hover: this.ui.hover,
        selected: this.ui.selected,
        hint: this.hintTile(this.game),
        pulses: this.ui.pulses,
        founding: !!this.game?.founding,
        anim: this.meta.anim,
        forecasts: this.forecasts,
        route: this.ui.view === "system" ? this.ui.route : undefined,
        annotationExclusions,
      },
      g,
      now,
      this.dpr,
    );
  }

  private paintTitle(): void {
    const host = this.root.querySelector("#title") as HTMLElement;
    const save = loadFrom("autosave");
    host.innerHTML = `
      <div class="title-card">
        <p class="kicker">Charter operations</p>
        <h1>Titans of<br>Proxima Astra</h1>
        <p class="lede">Settle Luna. Endure Mars. Hold the corridor between them. A turn-based charter of two worlds, one fleet, and an Earth that still writes the checks.</p>
        <div class="diffs">
          ${(["survey", "charter", "hardship"] as Difficulty[])
            .map(
              (id) => `<button type="button" class="diff ${this.ui.diff === id ? "on" : ""}" data-act="diff" data-id="${id}">
                <strong>${DIFF[id].label}</strong><span>${esc(DIFF[id].blurb)}</span>
              </button>`,
            )
            .join("")}
        </div>
        <div class="title-actions">
          <button type="button" class="btn primary" id="begin" data-act="begin">Open charter</button>
          ${save ? `<button type="button" class="btn" data-act="continue">Continue · sol ${save.turn} · ${DIFF[save.difficulty].label}</button>` : ""}
        </div>
        <p class="fine">Local saves only · No account · Headphones recommended</p>
      </div>`;
  }

  private begin(): void {
    const game = createGame(this.ui.diff);
    this.start(game, !this.meta.tutorialSeen);
  }

  private start(game: GameState, tutorial: boolean): void {
    this.game = game;
    this.ui.screen = "play";
    this.ui.modal = null;
    this.ui.selected = null;
    this.ui.shipId = null;
    this.ui.draft = null;
    this.ui.hover = null;
    this.ui.tutorial = tutorial ? 0 : null;
    this.ui.cinematic = null;
    this.ui.cinematicReplay = false;
    (this.root.querySelector("#title") as HTMLElement).hidden = true;
    (this.root.querySelector("#hud") as HTMLElement).hidden = false;
    this.focusView(game.founding?.world ?? "luna");
    this.audio.setScene("luna");
    this.paint();
    const kind = decideCinematic({ mode: "progression", newGame: game.turn === 1 && !game.script.cinematicLunaArrival, continuing: true, seenLuna: !!game.script.cinematicLunaArrival, seenMars: !!game.script.cinematicMarsArrival, foundingWorld: game.founding?.world ?? null, actualMarsArrival: false });
    if (kind) this.showCinematic(kind);
    else if (shouldShowPendingMarsArrival(game)) this.showCinematic("mars-arrival");
    this.autosave();
  }

  private showCinematic(kind: CinematicKind, replay = false): void {
    this.ui.cinematic = kind;
    this.ui.cinematicReplay = replay;
    this.paintCinematic();
  }

  private dismissCinematic(): void {
    const kind = this.ui.cinematic;
    if (!kind) return;
    if (!this.ui.cinematicReplay && this.game) {
      this.game.script[cinematicSeenKey(kind)] = true;
      this.autosave();
    }
    this.ui.cinematic = null;
    this.ui.cinematicReplay = false;
    this.paintCinematic();
    this.paint();
  }

  private focusView(view: "luna" | "mars" | "system"): void {
    this.clearTip();
    this.ui.view = view;
    this.audio.setScene(view);
    if (!this.game || view === "system") {
      this.ui.cam.tx = 0;
      this.ui.cam.ty = 0;
      return;
    }
    const world = this.game.worlds[view];
    const anchor = world.tiles.find((t) => t.building?.type === "command") ?? { q: 0, r: 0 };
    const pos = axialToPixel(anchor.q, anchor.r, HEX);
    this.ui.cam.tx = -pos.x * this.ui.cam.zoom;
    this.ui.cam.ty = -pos.y * this.ui.cam.zoom;
    this.clampCam();
  }

  private endTurn(): void {
    const game = this.game;
    if (!game) return;
    const block = blockingReason(game);
    if (block) {
      this.toast(block);
      this.audio.sfx("error");
      if (game.events.length) this.ui.modal = "event";
      this.paint();
      return;
    }
    const report = applyTurn(game);
    this.audio.sfx(report.sfx);
    for (const t of report.toasts) this.toast(t);
    if (game.founding) this.focusView(game.founding.world);
    if (game.founding?.world === "mars" && !game.script.cinematicMarsArrival) this.showCinematic("mars-arrival");
    if (game.outcome) this.ui.modal = "endgame";
    else if (game.events.length) this.ui.modal = "event";
    this.autosave();
    this.paint();
  }

  private act(result: { ok: boolean; reason?: string; sfx?: string; fx?: { world: WorldId; q: number; r: number }[]; focus?: { world: WorldId; q: number; r: number } }): void {
    const marsLanding = this.game?.founding?.world === "mars";
    if (!result.ok) {
      this.toast(result.reason ?? "Refused.", true);
      this.audio.sfx("error");
      this.paint();
      return;
    }
    this.audio.sfx(result.sfx ?? "click");
    if (result.focus && this.game) {
      this.ui.selected = { q: result.focus.q, r: result.focus.r };
      this.focusView(result.focus.world);
    }
    for (const fx of result.fx ?? []) this.ui.pulses.push({ ...fx, born: performance.now() });
    if (this.game?.founding) this.focusView(this.game.founding.world);
    if (this.game?.outcome) this.ui.modal = "endgame";
    if (marsLanding && this.game && !this.game.script.cinematicMarsArrival) this.showCinematic("mars-arrival");
    this.autosave();
    this.paint();
  }

  private toast(text: string, bad = false): void {
    this.ui.seq += 1;
    this.ui.toasts.push({ id: this.ui.seq, text, born: performance.now(), bad });
    this.paintToasts();
  }

  private paintToasts(): void {
    const host = this.root.querySelector("#toasts") as HTMLElement;
    host.innerHTML = this.ui.toasts.map((t) => `<div class="toast${t.bad ? " bad" : ""}">${esc(t.text)}</div>`).join("");
  }

  private autosave(): void {
    if (!this.game) return;
    try {
      saveTo("autosave", this.game);
    } catch {
      this.toast("Autosave failed — storage may be full.");
    }
  }

  private paint(): void {
    const game = this.game;
    if (!game || this.ui.screen !== "play") return;
    this.forecasts = { luna: forecast(game, "luna"), mars: forecast(game, "mars") };
    this.guidance = { luna: constructionGuidance(game, "luna"), mars: constructionGuidance(game, "mars") };
    const selectedShip = game.ships.find(s => s.id === this.ui.shipId);
    if (selectedShip && this.draftBasis !== shipManifestKey(selectedShip)) this.ensureDraft(game, selectedShip);
    this.clampCam();
    const top = this.root.querySelector(".top") as HTMLElement;
    top.classList.remove("luna", "mars", "system");
    top.classList.add(this.ui.view);
    (this.root.querySelector("#site-drawer") as HTMLElement).textContent = this.ui.view === "system" ? "Routes" : "Site";
    (this.root.querySelector("#sol-readout") as HTMLElement).textContent = `Sol ${game.turn}`;
    (this.root.querySelector("#credit-readout") as HTMLElement).textContent = `${fmtInt(game.credits)} cr`;
    (this.root.querySelector("#btn-mute") as HTMLElement).textContent = this.meta.muted ? "Unmute" : "Mute";
    for (const id of ["luna", "mars", "system"] as const) {
      const tab = this.root.querySelector(`#tab-${id}`) as HTMLButtonElement;
      tab.setAttribute("aria-selected", this.ui.view === id ? "true" : "false");
    }
    const waiting = game.ships.some((s) => s.name === "PAS Halcyon" && s.loc === "earth" && !s.mission && !game.worlds.mars.founded);
    (this.root.querySelector("#btn-fleet") as HTMLButtonElement).classList.toggle("ping", waiting);
    const evBtn = this.root.querySelector("#btn-event") as HTMLButtonElement;
    evBtn.hidden = game.events.length === 0;
    const block = blockingReason(game);
    const end = this.root.querySelector("#end-sol") as HTMLButtonElement;
    end.disabled = !!block;
    end.textContent = game.outcome ? "Charter closed" : `Resolve sol ${game.turn}`;
    const reason = this.root.querySelector("#end-reason") as HTMLElement;
    reason.textContent = block
      ? block
      : "1 Luna · 2 Mars · 3 System · E resolve · F fleet · R research · C Earth · G goals · M mute";

    if (!this.ui.selected && this.ui.view !== "system") {
      const hint = this.hintTile(game);
      if (hint) this.ui.selected = hint;
    }

    const left = this.root.querySelector("#left") as HTMLElement;
    const right = this.root.querySelector("#right") as HTMLElement;
    (this.root.querySelector(".home-control") as HTMLElement).hidden = this.ui.view === "system";
    const ls = left.scrollTop;
    const rs = right.scrollTop;
    left.innerHTML = this.leftHTML(game);
    right.innerHTML = this.rightHTML(game);
    left.scrollTop = ls;
    right.scrollTop = rs;

    const log = this.root.querySelector("#log") as HTMLElement;
    log.innerHTML = game.log
      .slice(-3)
      .map((l) => `<p class="${l.tone}">Sol ${l.turn} · ${esc(l.text)}</p>`)
      .join("");

    this.paintBanner(game);
    this.paintLegend();
    this.paintTutorial();
    this.paintModal(game);
    this.paintCinematic();
    this.syncDrawer();
    document.body.dataset.coach = this.ui.tutorial !== null ? (STEPS[this.ui.tutorial]?.coach ?? "") : "";
  }

  private leftHTML(game: GameState): string {
    if (this.ui.view === "system") return this.systemLeft(game);
    const id = this.ui.view;
    const world = game.worlds[id];
    const f = this.forecasts[id] ?? forecast(game, id);
    const chips = [
      world.founded ? `<span class="chip good">Founded</span>` : `<span class="chip">Survey only</span>`,
      isWindowOpen(game.turn) ? `<span class="chip good">Window open</span>` : `<span class="chip">Window in ${solsUntilWindow(game.turn)}</span>`,
      world.dust > 0 ? `<span class="chip warn">Dust ${world.dust}</span>` : "",
      world.shelter ? `<span class="chip warn">Sheltered</span>` : "",
      world.radiation > 0 ? `<span class="chip bad">Radiation</span>` : "",
      world.quarantine > 0 ? `<span class="chip warn">Quarantine</span>` : "",
      f.suff ? `<span class="chip good">Self-sufficient</span>` : "",
    ].join("");
    const rows = RESOURCES.map((r) => {
      const meta = RESOURCE_META[r];
      const net = f.net[r];
      const left = runway(world.stock[r], f.produced[r], f.demand[r]);
      const hot = left !== null && left < 5;
      return `<div class="res ${hot ? "hot" : ""}">
        <i class="swatch" style="background:${meta.color}"></i>
        <b>${meta.label}</b>
        <span class="amt">${fmt(world.stock[r])} <span class="faint">${meta.unit}</span></span>
        <span class="rate ${net > 0.05 ? "up" : net < -0.05 ? "down" : ""}">${fmtSigned(net)}</span>
        <div class="runway">${left === null ? "Cover stable next sol" : `${fmt(left)} sols of cover`}</div>
      </div>`;
    }).join("");
    const goals = objectives(game)
      .map((o) => `<li><span class="${o.done ? "done" : ""}">${o.done ? "●" : "○"} ${esc(o.label)}</span><span class="faint">${esc(o.progress)}</span></li>`)
      .join("");
    return `
      <p class="kicker">${id === "luna" ? "Luna" : "Mars"}</p>
      <h2 class="world-name">${esc(world.name)}</h2>
      <div class="chips">${chips}</div>
      <div class="rowline"><span>Morale</span><span>${fmt(world.morale)}</span></div>
      ${world.founded ? `<p class="faint">Next sol ${fmt(f.moraleNext)} · current equilibrium ${fmt(f.moraleTarget)}</p>` : ""}
      <div class="meter" aria-hidden="true"><span style="width:${world.morale}%;background:${world.morale < 25 ? "var(--bad)" : "var(--gold)"}"></span></div>
      <div class="rowline"><span>Crew</span><span>${world.pop} / ${f.housing || "—"} berths</span></div>
      <div class="rowline"><span>Power</span><span>${fmt(f.energyGen)} gen / ${fmt(f.energyDraw)} draw</span></div>
      <div class="meter"><span style="width:${Math.min(100, (f.energyGen / Math.max(0.1, f.energyDraw)) * 100)}%;background:${f.energyGen + 0.2 < f.energyDraw ? "var(--bad)" : "var(--luna)"}"></span></div>
      <div class="section-label">Stores · next sol</div>
      ${world.founded ? rows : `<p class="muted">No consumption until a colony ship lands.</p>`}
      ${f.notes.map((n) => `<p class="faint">${esc(n)}</p>`).join("")}
      ${world.founded && !game.tech.current ? `<p class="warn">Research idle · ${fmt(researchRate(game))} RP/sol unused.</p><button type="button" class="texty" data-act="modal" data-id="tech">Choose research</button>` : ""}
      <div class="section-label">Charter goals</div>
      <ul class="goals">${goals}</ul>
      ${game.contract ? `<p class="warn">Open quota: ${esc(game.contract.title)} by sol ${game.contract.deadline}.</p>` : ""}
    `;
  }

  private systemLeft(game: GameState): string {
    const block = (id: WorldId) => {
      const w = game.worlds[id];
      const f = forecast(game, id);
      const food = runway(w.stock.food, f.produced.food, f.demand.food);
      return `<div class="section-label">${esc(w.name)}</div>
        <div class="rowline"><span>${w.founded ? "Crew" : "Status"}</span><span>${w.founded ? w.pop : "unfounded"}</span></div>
        <div class="rowline"><span>Morale</span><span>${w.founded ? fmt(w.morale) : "—"}</span></div>
        <div class="rowline"><span>Food cover</span><span>${!w.founded ? "—" : food === null ? "stable" : fmt(food) + " sols"}</span></div>
        <div class="rowline"><span>Streak</span><span>${w.streak}</span></div>`;
    };
    const win = isWindowOpen(game.turn)
      ? `Mars window open for ${solsWindowLeft(game.turn)} sols.`
      : `Next Mars window in ${solsUntilWindow(game.turn)} sols.`;
    return `<p class="kicker">System</p><h2 class="world-name">Earth · Luna · Mars</h2><p class="muted">${win}</p>${block("luna")}${block("mars")}
      <div class="section-label">Hulls</div>
      ${game.ships
        .map((s) => `<button type="button" class="fleet-link" data-act="chart-ship" data-id="${esc(s.id)}"><b>${esc(s.name)}</b><small>${esc(chartShipStatus(game, s))}</small></button>`)
        .join("")}
      `;
  }

  private rightHTML(game: GameState): string {
    if (this.ui.view === "system") return this.routesHTML(game);
    const id = this.ui.view;
    const world = game.worlds[id];
    if (game.founding?.world === id) {
      return `<p class="kicker">Landing</p><h2 class="world-name">Choose a site</h2>
        <p class="muted">Green hexes sit beside ice with room for a solar array, a mine, and a greenhouse. The gold hex is a sound site. Pale polar tiles are the ice itself — do not put the command module on them.</p>
        <button type="button" class="btn primary" data-act="land-hint">Land on the marked hex</button>
        <p class="faint">Founding minimums were loaded aboard: ${FOUNDING_MIN.crew} crew, food ${FOUNDING_MIN.food}, water ${FOUNDING_MIN.water}, oxygen ${FOUNDING_MIN.oxygen}, metals ${FOUNDING_MIN.metals}.</p>`;
    }
    const tile = this.ui.selected ? world.tiles.find((t) => t.q === this.ui.selected!.q && t.r === this.ui.selected!.r) : null;
    const f = forecast(game, id);
    const head = tile ? this.tileHTML(tile, f.tiles[`${tile.q},${tile.r}`] ?? [], id) : `<p class="kicker">Site</p><h2 class="world-name">No hex selected</h2><p class="muted">Select a tile. New modules must touch a module already on the ground. Adjacency is the bonus: greenhouses like ice, labs like habitats, fission dislikes bedrooms.</p>`;
    if (!world.founded) return head + `<p class="warn">Orbital survey only. A colony ship has to land before you can build.</p>`;
    const advice = this.guidance[id];
    const next = advice?.building;
    const suggest = new Set(next ? [next] : []);
    const hint = this.hintTile(game);
    const quick =
      next && hint
        ? `<p class="muted">${esc(advice?.reason ?? "")}</p><button type="button" class="btn primary" data-act="build-hint" data-id="${next}">Build ${esc(BUILDINGS[next].name)} on the marked hex</button><p class="decision-read">${esc(this.buildImpactText(game, id, hint.q, hint.r, next))}</p>`
        : advice ? `<p class="muted">${esc(advice.reason)}</p>${advice.blocker ? `<p class="warn">${esc(advice.blocker)}</p>` : ""}` : "";
    if (tile?.building) return head + quick + `<button type="button" class="btn" data-act="construction-site">Choose construction site</button>`;
    const groups = ["power", "life", "industry", "science", "flight"] as const;
    const menu = groups
      .map((g) => {
        const items = BUILD_MENU.filter((b) => BUILDINGS[b].group === g)
          .map((b) => {
            const err = tile ? placementError(game, id, tile.q, tile.r, b) : "Select a tile.";
            const cost = buildingCost(game, b);
            const bits = [cost.metals ? `${cost.metals} met` : "", cost.water ? `${cost.water} w` : "", cost.credits ? `${cost.credits} cr` : "", `${BUILDINGS[b].turns} sol`]
              .filter(Boolean)
              .join(" · ");
            const impact = tile && !err ? this.buildImpactText(game, id, tile.q, tile.r, b) : "";
            return `<button type="button" class="build ${suggest.has(b) ? "suggest" : ""} ${err ? "blocked" : ""}" data-act="build" data-id="${b}" title="${esc(err || `${BUILDINGS[b].blurb} ${impact}`)}">
              <i class="build-thumb" aria-hidden="true" style="${esc(buildingSpriteStyle(id, b))}"></i>
              ${suggest.has(b) ? `<span class="next">Next</span>` : ""}<b>${BUILDINGS[b].name}</b><small class="${err ? "why" : ""}">${esc(err || bits)}</small>
            </button>`;
          })
          .join("");
        return `<div class="build-group"><div class="section-label">${GROUP_LABEL[g]}</div><div class="builds">${items}</div></div>`;
      })
      .join("");
    return head + quick + menu;
  }

  private buildImpactText(game: GameState, id: WorldId, q: number, r: number, type: BuildingId): string {
    const impact = buildingImpact(game, id, q, r, type);
    if (!impact) return "";
    const changes = RESOURCES.filter(k => Math.abs(impact.after.net[k] - impact.before.net[k]) > 0.05)
      .map(k => `${RESOURCE_META[k].label.toLowerCase()} ${fmtSigned(impact.after.net[k] - impact.before.net[k])} ${RESOURCE_META[k].unit}/sol`);
    const rp = impact.after.rp - impact.before.rp;
    if (Math.abs(rp) > 0.05) changes.push(`research ${fmtSigned(rp)} RP/sol`);
    return `Finished in ${impact.completionSols} sols. At today's crew, weather and stores: ${changes.join("; ") || "no flow change"}. After ordering: ${fmt(impact.metalsLeft)} t metals, ${fmt(impact.creditsLeft)} cr.${impact.after.unpowered.length > impact.before.unpowered.length ? " Warning: additional modules would lose power." : ""}`;
  }

  private tileHTML(tile: Tile, lines: string[], worldId: "luna" | "mars"): string {
    const b = tile.building;
    const status = b ? buildingStatus(b, tile.q, tile.r, this.forecasts[worldId] ?? null) : null;
    const repair = b && b.progress === 0 && b.hp < 99;
    const cancel = b && b.progress > 0;
    return `<p class="kicker">${TERRAIN_LABEL[tile.terrain] ?? tile.terrain}</p>
      <h2 class="world-name">${b ? BUILDINGS[b.type].name : "Open ground"}</h2>
      ${b ? `<i class="tile-portrait" aria-hidden="true" style="${esc(buildingSpriteStyle(worldId, b.type))}"></i>` : ""}
      <p class="muted">${b ? esc(BUILDINGS[b.type].blurb) : "Ice, metal, and helium are orbital estimates. The drill will find out."}</p>
      <div class="rowline"><span>Ice</span><span>${tile.ice}</span></div>
      <div class="rowline"><span>Metals</span><span>${tile.metal}</span></div>
      <div class="rowline"><span>Helium-3</span><span>${tile.he3}</span></div>
      <div class="rowline"><span>Regolith</span><span>${tile.regolith}</span></div>
      ${b ? `<div class="rowline"><span>Integrity</span><span>${Math.round(b.hp)}%</span></div>` : ""}
      ${b && status ? `<p class="status-line status-${status.status}"><b>${b.progress > 0 ? "Construction" : "Next sol"}:</b> ${b.progress > 0 ? `${b.progress} sol${b.progress === 1 ? "" : "s"} remaining${b.progress === 1 ? "; finishes on resolution" : ""}` : status.label}</p>` : ""}
      ${lines.map((l) => `<p class="faint">${esc(l)}</p>`).join("")}
      <div class="inline" style="margin-top:8px">
        ${repair ? `<button type="button" class="texty" data-act="repair">Repair · 6 met · 10 cr</button>` : ""}
        ${cancel ? `<button type="button" class="texty" data-act="cancel">Cancel build</button>` : ""}
      </div>`;
  }

  private routesHTML(game: GameState): string {
    const route = this.ui.route;
    const compare = compareDepartures(game, route);
    const options = (selected: LocationId, exclude?: LocationId) => (["earth", "luna", "mars"] as LocationId[])
      .filter(id => id !== exclude).map(id => `<option value="${id}" ${selected === id ? "selected" : ""}>${LOCATION_NAMES[id]}</option>`).join("");
    const read = (title: string, option: DepartureOption) => `<div class="route-option"><h3>${title}</h3>
      <div class="route-numbers"><div><strong>${option.plan.turns}</strong><span>sols in flight</span></div><div><strong>${option.plan.burn}<small> t</small></strong><span>fuel burn</span></div><div><strong>${(option.plan.risk * 100).toFixed(1)}<small>%</small></strong><span>incident risk</span></div></div>
      <p>Departs sol ${option.departure} · arrives sol ${option.arrival}</p></div>`;
    const ship = availableRouteHull(game, route);
    const future = compare.window;
    const arrivalDelta = future ? Math.abs(future.arrival - compare.now.arrival) : 0;
    const benefit = future ? `Waiting ${future.wait} sol${future.wait === 1 ? "" : "s"} saves ${compare.now.plan.burn - future.plan.burn} t fuel and ${((compare.now.plan.risk - future.plan.risk) * 100).toFixed(1)} percentage points of risk. Arrival ${arrivalDelta === 0 ? "is the same sol" : `is ${arrivalDelta} sol${arrivalDelta === 1 ? "" : "s"} ${future.arrival < compare.now.arrival ? "earlier" : "later"}`}.` : "";
    return `<p class="kicker">Route planner</p><h2 class="world-name">${LOCATION_NAMES[route.from]} → ${LOCATION_NAMES[route.to]}</h2>
      <div class="route-fields"><label>From<select aria-label="Route origin" data-route="from">${options(route.from)}</select></label><label>To<select aria-label="Route destination" data-route="to">${options(route.to, route.from)}</select></label></div>
      <label class="route-class">Hull<select aria-label="Route hull" data-route="cls">${SHIP_CLASSES.map(id => `<option value="${id}" ${id === route.cls ? "selected" : ""}>${SHIPS[id].name}</option>`).join("")}</select></label>
      ${read("Depart today", compare.now)}${future ? read(`Wait for sol ${future.departure}`, future) + `<p class="decision-read">${benefit}</p>` : `<p class="good">${compare.now.plan.mars ? "Today's departure is inside the Mars window." : "This leg does not depend on the Mars window."}</p>`}
      <button type="button" class="btn primary" data-act="route-fleet" ${ship ? "" : "disabled"}>${ship ? `Prepare ${esc(ship.name.replace("PAS ", ""))}` : "No matching hull at origin"}</button>
      ${future ? `<p class="faint">Window estimate holds today's weather and technology fixed. Colony needs and crises still advance while you wait.</p>` : ""}
      <p class="faint">Incident risk is a game probability, not a guarantee of damage. Preparation does not launch or schedule a ship.</p>`;
  }

  private hintTile(game: GameState | null): { q: number; r: number } | null {
    if (!game || this.ui.view === "system") return null;
    const id = this.ui.view;
    const world = game.worlds[id];
    if (game.founding?.world === id) {
      return world.tiles.find((t) => landingAdvice(game, id, t.q, t.r) === "good") ?? null;
    }
    if (!world.founded) return null;
    return this.guidance[id]?.site ?? null;
  }

  private paintBanner(game: GameState): void {
    const banner = this.root.querySelector("#banner") as HTMLElement;
    if (this.ui.view === "system") { banner.hidden = true; return; }
    if (game.founding) {
      banner.hidden = false;
      banner.innerHTML = `<strong>Landing window.</strong> ${esc(game.worlds[game.founding.world].name)} is under your hull. The gold hex is a sound site — click it, or press Land on the right.`;
      return;
    }
    const halcyon = game.ships.find((s) => s.name === "PAS Halcyon" && s.loc === "earth" && !s.mission);
    if (halcyon && !game.worlds.mars.founded) {
      banner.hidden = false;
      const open = isWindowOpen(game.turn);
      banner.innerHTML = `<strong>PAS Halcyon is at Earth.</strong> ${open ? `Mars window is open for ${solsWindowLeft(game.turn)} sols.` : `Window in ${solsUntilWindow(game.turn)} sols. You can still launch off-window.`} Open Fleet and load a founding kit.`;
      return;
    }
    if (game.worlds[this.ui.view].founded) {
      const advice = this.guidance[this.ui.view];
      const next = advice?.building;
      const hint = this.hintTile(game);
      if (next && hint) {
        banner.hidden = false;
        banner.innerHTML = `<strong>${BUILDINGS[next].name}.</strong> ${esc(advice?.reason ?? "")} Gold marks the recommended site.`;
        return;
      }
      if (next && advice?.blocker) {
        banner.hidden = false;
        banner.innerHTML = `<strong>${BUILDINGS[next].name} is waiting.</strong> ${esc(advice.blocker)}`;
        return;
      }
    }
    banner.hidden = true;
  }

  private paintLegend(): void {
    const host = this.root.querySelector("#legend") as HTMLElement;
    host.classList.toggle("system-legend", this.ui.view === "system");
    const readout = this.root.querySelector("#system-readout") as HTMLElement;
    readout.hidden = this.ui.view !== "system" || !this.game;
    if (this.ui.view === "system") {
      if (this.game) readout.innerHTML = `<p class="kicker">Transfer calendar</p><h2>${windowSummary(this.game.turn)}</h2><div class="window-calendar" aria-label="Mars departure window, next nine sols">${windowCalendar(this.game.turn).map(d => `<span class="${d.open ? "open" : ""} ${d.today ? "today" : ""}" title="Sol ${d.sol}: ${d.open ? "Mars window open" : "Mars window closed"}${d.today ? "; today" : ""}">${d.sol}<i>${d.open ? "Open" : "—"}</i></span>`).join("")}</div>`;
      host.innerHTML = `<span class="chart-key">Selected route</span><span>Gold = open Mars legs</span><span>Schematic · not to scale</span>`;
      return;
    }
    const mars = this.ui.view === "mars";
    host.innerHTML = mars
      ? `<span><i class="swatch" style="background:#c4623a"></i>Plain</span><span><i class="swatch" style="background:#f3e4d4"></i>Ice</span><span><i class="swatch" style="background:#6d3128"></i>Canyon</span><span><i class="swatch" style="background:#d08a4e"></i>Dust</span>`
      : `<span><i class="swatch" style="background:#3c4656"></i>Mare</span><span><i class="swatch" style="background:#b7bcc4"></i>Highland</span><span><i class="swatch" style="background:#d5e4f0"></i>Ice</span><span>◆ ice · ▭ metal · ● He-3</span>`;
  }

  private paintTutorial(): void {
    const host = this.root.querySelector("#tutorial") as HTMLElement;
    if (this.ui.tutorial === null) {
      host.hidden = true;
      return;
    }
    const step = STEPS[this.ui.tutorial];
    if (!step) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = `<div class="tutor-card">
      <p class="kicker">Briefing ${this.ui.tutorial + 1} / ${STEPS.length}</p>
      <h2>${esc(step.title)}</h2>
      <p>${esc(step.body)}</p>
      <div class="inline">
        <button type="button" class="texty" data-act="tutor-skip">Skip</button>
        <button type="button" class="texty" data-act="tutor-back" ${this.ui.tutorial === 0 ? "disabled" : ""}>Back</button>
        <button type="button" class="btn primary" id="tutor-next" data-act="tutor-next">${this.ui.tutorial === STEPS.length - 1 ? "Take the watch" : "Next"}</button>
      </div>
    </div>`;
  }

  private paintCinematic(): void {
    const host = this.root.querySelector("#cinematic") as HTMLElement;
    this.root.querySelectorAll<HTMLElement>("#hud, #modal, #tutorial, #title, #view").forEach(el => {
      el.inert = !!this.ui.cinematic;
    });
    if (!this.ui.cinematic) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    const mars = this.ui.cinematic === "mars-arrival";
    host.hidden = false;
    host.innerHTML = `<div class="cinematic-stage" role="dialog" aria-modal="true" aria-labelledby="cinematic-title">
      <img src="assets/starship-${mars ? "mars-arrival-v1" : "luna-arrival-v2"}.png" alt="Imagined Starship approach to ${mars ? "Mars" : "the Moon"}">
      <div class="cinematic-copy"><p class="cinematic-label">Imagined future · game cinematic</p><h2 id="cinematic-title">${mars ? "Mars approach" : "Lunar arrival"}</h2><p>${mars ? "Eos Reach is no longer a survey mark. Your founding hull is on final approach." : "Shackleton Prospect is the first ground beneath the charter."}</p><div class="inline"><button type="button" class="btn primary" data-act="cinematic-continue">Continue</button><button type="button" class="texty" data-act="cinematic-skip">Skip</button></div></div>
    </div>`;
    this.root.querySelector<HTMLElement>("#cinematic button")?.focus();
  }

  private paintModal(game: GameState): void {
    const root = this.root.querySelector("#modal") as HTMLElement;
    if (!this.ui.modal) {
      root.hidden = true;
      this.modalMarkup = "";
      if (this.modalOpener?.isConnected) this.modalOpener.focus();
      this.modalOpener = null;
      return;
    }
    if (root.hidden) this.modalOpener = document.activeElement as HTMLElement | null;
    root.hidden = false;
    const title = this.root.querySelector("#modal-title") as HTMLElement;
    const body = this.root.querySelector("#modal-body") as HTMLElement;
    const close = this.root.querySelector("#modal-close") as HTMLButtonElement;
    const sheet = this.root.querySelector("#modal .sheet") as HTMLElement;
    const active = document.activeElement as HTMLElement | null;
    const activeInside = !!active && sheet.contains(active);
    const activeAct = activeInside ? active.dataset.act : null;
    const activeId = activeInside ? active.dataset.id : null;
    const activeElementId = activeInside ? active.id : null;
    const map: Record<string, string> = {
      fleet: "Fleet",
      tech: "Research",
      earth: "Earth desk",
      objectives: "Charter goals",
      help: "Watch bill",
      settings: "Menu",
      music: "Soundtrack",
      log: "Log",
      event: game.events[0]?.title ?? "Situation",
      endgame: game.outcome?.kind === "victory" ? "Charter complete" : "Charter revoked",
      confirm: this.ui.confirm?.title ?? "Confirm",
      guide: "Field guide",
    };
    title.textContent = map[this.ui.modal] ?? "Charter";
    close.hidden = this.ui.modal === "event";
    const markup = this.modalHTML(game);
    if (markup !== this.modalMarkup) {
      body.innerHTML = markup;
      this.modalMarkup = markup;
    }
    if (!sheet.contains(document.activeElement) || (document.activeElement as HTMLElement)?.hidden) {
      const replacement = Array.from(body.querySelectorAll<HTMLElement>("button, input, select, a, textarea"))
        .find((element) => activeElementId ? element.id === activeElementId : !!activeAct && element.dataset.act === activeAct && element.dataset.id === activeId);
      (replacement ?? (!close.hidden ? close : body.querySelector<HTMLElement>("button:not([disabled])")))?.focus();
    }
  }

  private modalHTML(game: GameState): string {
    const m = this.ui.modal;
    if (m === "event" && game.events[0]) {
      const ev = game.events[0];
      return `<p>${esc(ev.body)}</p>${ev.choices
        .map(
          (c) => `<button type="button" class="choice" data-act="choice" data-id="${esc(c.id)}" ${c.disabled ? "disabled" : ""}>
            <b>${esc(c.label)}</b><span class="muted">${esc(c.detail)}</span></button>`,
        )
        .join("")}`;
    }
    if (m === "endgame") {
      const won = game.outcome?.kind === "victory";
      return `<p class="${won ? "good" : "bad"}">${won ? "Luna and Mars both hold. The corridor is yours." : esc(game.outcome && game.outcome.kind === "defeat" ? game.outcome.reason : "")}</p>
        <div class="rowline"><span>Sols</span><span>${game.turn}</span></div>
        <div class="rowline"><span>Crises answered</span><span>${game.stats.crises}</span></div>
        <div class="rowline"><span>Launches</span><span>${game.stats.launched}</span></div>
        <div class="rowline"><span>Helium-3 sold</span><span>${fmt(game.stats.he3Sold)} kg</span></div>
        <div class="inline" style="margin-top:12px"><button type="button" class="btn primary" data-act="title">Return to title</button></div>`;
    }
    if (m === "confirm" && this.ui.confirm) {
      return `<p>${esc(this.ui.confirm.body)}</p><div class="inline"><button type="button" class="btn primary" data-act="confirm-yes">${esc(this.ui.confirm.yes)}</button><button type="button" class="texty" data-act="close">Cancel</button></div>`;
    }
    if (m === "objectives") {
      const brief = operationsBrief(game);
      return this.goalRoadmapHTML(game, brief) + objectives(game)
        .map(
          (o) => `<div class="choice" style="cursor:default"><b class="${o.done ? "good" : ""}">${o.done ? "Complete · " : ""}${esc(o.label)}</b><span class="muted">${esc(o.detail)} ${esc(o.progress)}</span></div>`,
        )
        .join("") + `<p class="faint">Difficulty: ${DIFF[game.difficulty].label}. Seed ${game.seed}.</p>`;
    }
    if (m === "log") {
      return `<div class="stack">${[...game.log].reverse().map((l) => `<p class="${l.tone}">Sol ${l.turn} · ${esc(l.text)}</p>`).join("")}</div>`;
    }
    if (m === "help") return this.helpHTML();
    if (m === "guide") return this.fieldGuideHTML();
    if (m === "settings") return this.settingsHTML(game);
    if (m === "music") return this.musicHTML();
    if (m === "tech") return this.techHTML(game);
    if (m === "earth") return this.earthHTML(game);
    if (m === "fleet") return this.fleetHTML(game);
    return "";
  }

  private helpHTML(): string {
    return `<div class="cols"><div>
      <p>Each sol, outposts eat food, water, and oxygen and draw power. Life support is paid first. Modules left in the dark produce nothing.</p>
      <p>Ice mines want polar ground. Greenhouses want to touch that ice. ISRU turns water and regolith into oxygen and propellant. Regolith works are how you get metals after the starter pile is gone.</p>
      <p>Ships carry cargo, fuel, and crew. Earth sells into a docked hull immediately. A pad can throw one hull per sol. Mars is faster and safer inside the window.</p>
    </div><div>
      <p><b>Keys.</b> 1 Luna, 2 Mars, 3 system, E resolve, F fleet, R research, C Earth, G goals, H help, L log, M mute, arrows or WASD pan, +/- zoom, Esc closes.</p>
      <p><b>Victory.</b> Both worlds self-sufficient for a streak, populations at the goal, enough hulls, enough technologies including one capstone, credits at or above zero.</p>
      <p><b>Defeat.</b> A founded world reaches zero crew, morale stays broken, or Earth calls the debt.</p>
    </div></div>`;
  }

  private fieldGuideHTML(): string {
    const tabs = FIELD_GUIDE_CATEGORIES.map((category, index) => `<button type="button" id="guide-tab-${index}" class="texty ${this.ui.guideCategory === category ? "ping" : ""}" role="tab" tabindex="${this.ui.guideCategory === category ? 0 : -1}" aria-selected="${this.ui.guideCategory === category}" aria-controls="guide-panel" data-act="guide-category" data-id="${category}">${category}</button>`).join("");
    const facts = FIELD_GUIDE.filter((item) => guideCategory(item) === this.ui.guideCategory)
      .map((item) => `<article class="guide-entry"><div class="section-label">${item.category} · verified ${item.verifiedDate}</div><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p><p class="faint">Source: ${item.sourceUrl ? `<a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(item.sourceTitle)}</a>` : esc(item.sourceTitle)}</p></article>`)
      .join("");
    const note = this.ui.guideCategory === "SpaceX" ? `<p class="faint">Proposal note: the 2016 item is a dated proposal, with no promised dates or official endorsement.</p>` : "";
    return `<div class="guide-tabs" role="tablist" aria-label="Field guide category">${tabs}</div>${note}<div id="guide-panel" class="guide-list" role="tabpanel" aria-labelledby="guide-tab-${FIELD_GUIDE_CATEGORIES.indexOf(this.ui.guideCategory)}">${facts}</div>`;
  }

  private settingsHTML(game: GameState): string {
    const speeds = [
      [0.65, "Deliberate"],
      [1, "Nominal"],
      [1.8, "Brisk"],
    ] as const;
    return `<div class="inline">${speeds
      .map(
        ([n, label]) =>
          `<button type="button" class="texty ${this.meta.anim === n ? "ping" : ""}" data-act="speed" data-id="${n}">${label}</button>`,
      )
      .join("")}
      <button type="button" class="texty" data-act="mute">${this.meta.muted ? "Unmute" : "Mute"}</button>
    </div>
    <p class="faint">Seed ${game.seed} · ${DIFF[game.difficulty].label} · sol ${game.turn}</p>
    <div class="section-label">Save</div>
    <div class="inline">
      <button type="button" class="texty" data-act="save" data-id="slot1">Slot 1</button>
      <button type="button" class="texty" data-act="save" data-id="slot2">Slot 2</button>
      <button type="button" class="texty" data-act="save" data-id="slot3">Slot 3</button>
    </div>
    <div class="section-label">Load</div>
    <div class="inline">
      <button type="button" class="texty" data-act="load" data-id="autosave">Autosave</button>
      <button type="button" class="texty" data-act="load" data-id="slot1">Slot 1</button>
      <button type="button" class="texty" data-act="load" data-id="slot2">Slot 2</button>
      <button type="button" class="texty" data-act="load" data-id="slot3">Slot 3</button>
    </div>
    <div class="inline" style="margin-top:14px">
      <button type="button" class="texty" data-act="newgame">New charter</button>
      <button type="button" class="texty" data-act="title">Title</button>
      <button type="button" class="texty" data-act="briefing">Replay briefing</button>
      <button type="button" class="texty" data-act="replay-cinematic" data-id="luna-arrival">Replay lunar arrival</button>
      <button type="button" class="texty" data-act="replay-cinematic" data-id="mars-arrival">Replay Mars approach</button>
    </div>`;
  }

  private musicHTML(): string {
    const track = soundtrackTracks.find((item) => item.id === this.music.trackId) ?? soundtrackTracks[0];
    const state = this.music.status === "error" ? `<p class="bad" role="alert">${esc(this.music.error)}</p>` : `<p class="faint" aria-live="polite">${this.music.status === "loading" ? "Loading…" : this.music.status === "playing" ? "Playing" : "Paused"}</p>`;
    return `<div class="music-player">
      <label class="section-label" for="music-track">Track</label>
      <select id="music-track" data-music-track aria-label="Soundtrack track">${soundtrackTracks.map((item) => `<option value="${item.id}" ${item.id === this.music.trackId ? "selected" : ""}>${esc(item.title)}</option>`).join("")}</select>
      <p><b>${esc(track.composer)}</b><br><span class="muted">${esc(track.performer)} · ${esc(track.license)}</span><br><a href="${esc(track.source)}" target="_blank" rel="noreferrer">Source and credits</a></p>
      <div class="inline"><button type="button" class="btn" data-act="music-play" aria-label="${this.music.requested ? "Pause" : "Play"}">${this.music.requested ? "❚❚ Pause" : "▶ Play"}</button><button type="button" class="texty" data-act="music-next" aria-label="Next track">▶| Next</button></div>
      <label class="slider" for="music-volume">Volume<input id="music-volume" type="range" min="0" max="1" step="0.01" value="${this.music.volume}" data-music-volume aria-label="Music volume"><span>${Math.round(this.music.volume * 100)}%</span></label>
      ${this.meta.muted ? '<p class="warn">All audio muted</p>' : ''}
      <button type="button" class="texty" data-act="mute" aria-label="${this.meta.muted ? 'Unmute all audio' : 'Mute all audio'}">${this.meta.muted ? 'Unmute all audio' : 'Mute all audio'}</button>
      ${state}
    </div>`;
  }

  private techHTML(game: GameState): string {
    const rate = researchRate(game);
    const cur = game.tech.current ? TECH_BY_ID[game.tech.current] : null;
    const pct = cur ? Math.min(100, (game.tech.progress / cur.cost) * 100) : 0;
    const head = cur
      ? `<p>${esc(cur.name)} · ${fmt(game.tech.progress)} / ${cur.cost} RP · ${fmt(rate)} RP/sol${rate > 0 ? ` · about ${Math.ceil((cur.cost - game.tech.progress) / rate)} sols` : ""}</p><div class="bar"><span style="width:${pct}%"></span></div>`
      : `<p class="warn">No project queued. Research points this sol will be lost.</p><p class="faint">${fmt(rate)} RP/sol available from both worlds.</p>`;
    const cols = BRANCH_ORDER.map((branch) => {
      const cards = TECHS.filter((t) => t.branch === branch)
        .map((t) => {
          const owned = game.tech.unlocked.includes(t.id);
          const active = game.tech.current === t.id;
          const ready = t.req.every((r) => game.tech.unlocked.includes(r));
          return `<button type="button" class="tech ${owned ? "owned" : ""} ${active ? "active" : ""} ${!owned && !ready ? "locked" : ""}" data-act="research" data-id="${t.id}">
            <b>${esc(t.name)}</b>
            <small class="faint">${t.cost} RP${t.capstone ? " · capstone" : ""}</small>
            <small class="muted">${esc(t.blurb)}</small>
          </button>`;
        })
        .join("");
      return `<div><div class="section-label">${BRANCH_LABEL[branch]}</div>${cards}</div>`;
    }).join("");
    return head + `<div class="tree">${cols}</div>`;
  }

  private earthHTML(game: GameState): string {
    const brief = operationsBrief(game);
    const rows = CARGO_IDS.map((id) => {
      const buy = buyPrice(game, id);
      return `<tr><td>${RESOURCE_META[id].label}</td><td>${Number.isFinite(buy) ? fmt(buy) : "—"}</td><td>${fmt(sellPrice(game, id))}</td></tr>`;
    }).join("");
    const order = this.ui.order;
    const manifest: Partial<Record<CargoId, number>> = {
      food: order.food,
      water: order.water,
      oxygen: order.oxygen,
      metals: order.metals,
      propellant: order.propellant,
    };
    let cost = 0;
    for (const k of CARGO_IDS) {
      const n = manifest[k] ?? 0;
      if (n > 0 && Number.isFinite(buyPrice(game, k))) cost += n * buyPrice(game, k);
    }
    cost *= 1.18;
    const eta = Math.max(2, planRoute(game, "earth", order.dest, "freighter").turns);
    const steppers = (["food", "water", "oxygen", "metals", "propellant"] as const)
      .map(
        (k) => `<div class="inline"><span style="width:110px">${RESOURCE_META[k].label}</span>
          <button type="button" class="texty" data-act="step" data-id="${k}" data-dir="-1">−</button>
          <span>${order[k]}</span>
          <button type="button" class="texty" data-act="step" data-id="${k}" data-dir="1">+</button></div>`,
      )
      .join("");
    const contract = game.contract
      ? `<p class="warn">${esc(game.contract.title)} · due sol ${game.contract.deadline} · ${esc(game.contract.detail)}</p>`
      : `<p class="faint">No open quota.</p>`;
    return this.operationsHTML(game, brief) + this.crewPlannerHTML(game) + `<div class="cols"><div>
      <p>${isWindowOpen(game.turn) ? `Mars window open · ${solsWindowLeft(game.turn)} sols.` : `Mars window in ${solsUntilWindow(game.turn)} sols.`}</p>
      ${contract}
      ${game.priceTurns > 0 ? `<p class="warn">Tariff elevated for ${game.priceTurns} sols.</p>` : ""}
      <div class="section-label">Posted tariff · buy / sell</div>
      <table class="price-table"><tbody>${rows}</tbody></table>
      <p class="faint">Hire cost ${fmt(hirePrice(game))} cr per crew at Earth dock. Overdraft to ${fmtInt(DIFF[game.difficulty].overdraft)}.</p>
    </div><div>
      <div class="section-label">Charter a supply drop</div>
      <div class="inline">
        <button type="button" class="texty ${order.dest === "luna" ? "ping" : ""}" data-act="odest" data-id="luna">Luna</button>
        <button type="button" class="texty ${order.dest === "mars" ? "ping" : ""}" data-act="odest" data-id="mars">Mars</button>
      </div>
      ${steppers}
      <p>${fmt(cost)} cr · about ${eta} sols · handling included. Two drops may be in flight.</p>
      <button type="button" class="btn primary" data-act="drop">Dispatch drop</button>
      <div class="section-label">Commission a hull at Earth</div>
      <div class="stack">${SHIP_CLASSES.map((cls) => {
        const d = SHIPS[cls];
        return `<button type="button" class="choice" data-act="commission" data-id="${cls}" data-loc="earth"><b>${d.name}</b><span class="muted">${Math.round(d.credits * 1.05)} cr · ${d.buildTurns + 1} sols · ${esc(d.blurb)}</span></button>`;
      }).join("")}</div>
    </div></div>`;
  }

  private goalRoadmapHTML(game: GameState, brief: OperationsBrief): string {
    const diff = DIFF[game.difficulty];
    return `<div class="section-label">Population roadmap</div><div class="population-roadmap">${brief.population.map(p => `<section>
      <div class="rowline"><b>${p.world === "luna" ? "Luna" : "Mars"}</b><span>${p.population} / ${p.target} crew</span></div>
      <div class="goal-meter" role="progressbar" aria-label="${p.world === "luna" ? "Luna" : "Mars"} population goal" aria-valuenow="${p.population}" aria-valuemin="0" aria-valuemax="${Math.max(p.target, p.population)}"><span style="width:${Math.min(100, p.population / p.target * 100)}%"></span><i style="left:${Math.min(99, p.housing / p.target * 100)}%" title="Completed housing: ${p.housing}"></i></div>
      <p class="faint">Housing ${p.housing}${p.pendingHousing ? ` + ${p.pendingHousing} under construction` : ""} · safe sols ${p.safeStreak} / ${diff.streak}</p>
      <p>${esc(p.next)}</p>
      ${p.founded ? `<p class="faint">At ${p.target} crew, today's completed production: food ${fmtSigned(p.targetNet.food)}, water ${fmtSigned(p.targetNet.water)}, oxygen ${fmtSigned(p.targetNet.oxygen)} / sol. Power ${fmt(p.targetPower.generation)} gen / ${fmt(p.targetPower.demand)} draw; stored energy is a buffer, not generation.</p>` : ""}
    </section>`).join("")}</div>
    <p class="muted">Fleet ${brief.fleet.ready} / ${brief.fleet.target}${brief.fleet.pending ? `; ${brief.fleet.pending} building (not counted yet)` : ""}. Research ${brief.research.unlocked} / ${brief.research.target}; capstone ${brief.research.capstone ? "complete" : "still needed"}. Target-population estimates hold weather and modules fixed.</p>
    <div class="inline"><button type="button" class="texty" data-act="modal" data-id="earth">Plan crew & exports</button><button type="button" class="texty" data-act="modal" data-id="tech">Open research</button></div>
    <div class="section-label">Charter checklist</div>`;
  }

  private crewPlannerHTML(game: GameState): string {
    const capacities = (["luna", "mars"] as const).map(world => crewCapacity(game, world));
    const plans = capacities.map(c => game.ships.flatMap(s => {
      const p = crewTransferPlan(game, s.id, c.world);
      return p?.ready ? [p] : [];
    }).sort((a, b) => b.passengers - a.passengers || a.cost - b.cost)[0]);
    return `<details class="crew-planner" ${plans.some(Boolean) ? "open" : ""}><summary>Crew transfer planner</summary>
      <div class="population-roadmap">${capacities.map((c, i) => {
        const p = plans[i];
        return `<section><div class="rowline"><b>${c.world === "luna" ? "Luna" : "Mars"}</b><span>${c.population} / ${c.target} crew</span></div>
          <p>Support for ${c.additional} more toward the goal · ${c.reservedPassengers} passengers aboard or inbound.</p>
          <p class="muted">${esc(c.blocker ?? `Completed housing ${c.housing}; current production and power cover these additional crew.`)}</p>
          ${p ? `<p>${esc(p.shipName)} · ${p.passengers} passengers · ${fmt(p.cost)} cr departure cost · estimated arrival sol ${p.arrivalSol} · ${(p.risk * 100).toFixed(1)}% incident risk.</p><button type="button" class="texty" data-act="prepare-crew" data-id="${esc(p.shipId)}" data-world="${c.world}">Prepare ${c.world === "luna" ? "Luna" : "Mars"} crew transfer</button>` : c.additional ? `<p class="muted">No ready Earth hull. Sell loaded cargo or return a suitable empty hull to Earth; keep the founding ship for Mars.</p>` : ""}
        </section>`;
      }).join("")}</div>
      <p class="muted">Alternative manifests, not orders. Completed housing and today's production only; conditions can change before arrival. Paid hiring happens at departure, and passengers join the outpost only after disembarking. These are one-way legs; plan return fuel separately.</p>
    </details>`;
  }

  private operationsHTML(game: GameState, brief: OperationsBrief): string {
    const ready = brief.exports.filter(p => p.ready);
    const dockedSales = game.ships.filter(s => s.loc === "earth" && !s.mission && CARGO_IDS.some(k => s.cargo[k] > 0));
    return `<section class="operations-brief" aria-label="Operations brief">
      <div class="section-label">Cash & exports</div>
      <div class="cash-metrics"><div><span class="faint">Cash balance</span><b class="${brief.cash.balance < 0 ? "warn" : "good"}">${fmt(brief.cash.balance)} cr</b></div><div><span class="faint">Available with credit line</span><b>${fmt(brief.cash.spendable)} cr</b></div><div><span class="faint">Estimated debt charge</span><b class="${brief.cash.debtFee ? "warn" : ""}">${fmt(brief.cash.debtFee)} cr</b></div></div>
      <p>${esc(brief.cash.next)}</p>
      ${dockedSales.map(s => `<p class="good">${esc(s.name)} has cargo at Earth worth ${fmt(CARGO_IDS.reduce((sum, k) => sum + s.cargo[k] * sellPrice(game, k), 0))} cr at posted prices. <button type="button" class="texty" data-act="review-ship" data-id="${esc(s.id)}">Review cargo sale</button></p>`).join("")}
      <div class="trade-flow"><span>Extract on Luna</span><span aria-hidden="true">→</span><span>Load & fly</span><span aria-hidden="true">→</span><span>Sell at Earth</span></div>
      <p>${esc(brief.exportNext)}</p>
      ${ready.length ? ready.map(p => `<div class="export-option">
        <div class="rowline"><b>${esc(p.shipName)}</b><span>${p.kilograms} kg · ${fmt(p.sale)} cr gross sale</span></div>
        <p class="faint">${p.from === "earth" ? "Earth → Luna → Earth" : "Luna → Earth"} · estimated sale sol ${p.saleSol} · ${p.fuelBurn} t fuel burn · ${fmt(p.cashOutlay)} cr new departure outlay · incident risk ${p.legRisks.map(r => `${(r * 100).toFixed(1)}%`).join(" / ")} per leg.</p>
        <button type="button" class="texty" data-act="prepare-export" data-id="${esc(p.shipId)}">Prepare ${p.from === "earth" ? "pickup run" : "export manifest"}</button>
      </div>`).join("") : `<p class="faint">${brief.exports.map(p => `${p.shipName}: ${p.blocker}`).map(esc).join(" ") || "No idle Earth or Luna hull is available for an export."}</p>`}
      ${ready.length ? `<details class="estimate-assumptions"><summary>Estimate assumptions</summary><p class="faint">Options are alternatives, not reserved cargo. Uses stock already present, not future production. Weather and technology stay fixed for planning. Gross sale is not profit: existing fuel, extraction costs and possible transit losses are not deducted. A pickup run still needs its return manifest at Luna.</p></details>` : ""}
      ${game.contract ? `<p class="warn">An open quota may pay more than a direct sale. Check the quota before selling its cargo.</p>` : ""}
    </section>`;
  }

  private fleetHTML(game: GameState): string {
    if (!this.ui.shipId || !game.ships.some((s) => s.id === this.ui.shipId)) {
      const first = game.ships[0];
      if (first) this.ensureDraft(game, first);
    }
    const list = game.ships
      .map((s) => {
        const where = s.mission ? `${s.mission.from} → ${s.mission.to} · ${s.mission.eta} sols` : s.loc;
        return `<button type="button" class="ship ${s.id === this.ui.shipId ? "on" : ""}" data-act="ship" data-id="${s.id}">
          <b>${esc(s.name)}</b> <span class="faint">${SHIPS[s.cls].name}</span>
          <div class="rowline"><span>${esc(where)}</span><span>crew ${s.crew}</span></div>
          <div class="rowline"><span>Integrity</span><span>${Math.round(shipIntegrity(s))}%</span></div>
          <div class="hull" role="progressbar" aria-label="${esc(s.name)} integrity" aria-valuenow="${Math.round(shipIntegrity(s))}" aria-valuemin="0" aria-valuemax="100"><span style="width:${shipIntegrity(s)}%"></span></div>
        </button>`;
      })
      .join("");
    const yards = game.yard
      .map((y) => `<p class="faint">${esc(y.name)} · ${y.cls} · ${y.loc} · ${y.eta} sols</p>`)
      .join("");
    return `<div class="fleet"><div><div class="section-label">Hulls</div>${list}${yards || ""}</div><div>${this.draftHTML(game)}</div></div>`;
  }

  private ensureDraft(_game: GameState, ship: Ship): void {
    this.ui.shipId = ship.id;
    this.ui.draft = initialLaunchDraft(ship);
    this.draftBasis = shipManifestKey(ship);
  }

  private draftHTML(game: GameState): string {
    const ship = game.ships.find((s) => s.id === this.ui.shipId);
    if (!ship || !this.ui.draft) return `<p class="muted">Select a hull.</p>`;
    const draft = this.ui.draft;
    if (ship.mission || ship.loc === "transit") {
      return `<h3>${esc(ship.name)}</h3><p>In transit to ${ship.mission?.to}. ${ship.mission?.eta} sols remain. Incident risk ${Math.round((ship.mission?.risk ?? 0) * 100)}%.</p>`;
    }
    const from = ship.loc;
    const preview = previewLaunch(game, ship.id, draft);
    const def = SHIPS[ship.cls];
    const dests: LocationId[] = ["earth", "luna", "mars"].filter((d) => d !== from) as LocationId[];
    const sliders = CARGO_IDS.map((k) => {
      const max = this.cargoMax(game, ship, draft, k);
      return `<label class="slider">${RESOURCE_META[k].label}<input type="range" min="0" max="${Math.max(Math.ceil(draft.cargo[k]), Math.floor(max))}" step="0.01" value="${draft.cargo[k]}" data-cargo="${k}"><span>${fmt(draft.cargo[k])}</span></label>`;
    }).join("");
    const fuelMax = fuelLimit(game, ship, draft);
    const crewMax = from === "earth" ? def.crew : Math.min(def.crew, ship.crew + Math.max(0, game.worlds[from].pop - 2));
    const founding = ship.cls === "colony" && draft.dest !== "earth" && !game.worlds[draft.dest].founded;
    const trade = exportPlan(game, ship.id);
    const service = previewShipRepair(game, ship.id);
    const arrival = crewArrivalAdvice(game, ship.id);
    const crewReturn = crewReturnPlan(game, ship.id);
    const departureBlocker = crewDepartureBlocker(game, ship.id, draft);
    return `<h3 style="margin-top:0">${esc(ship.name)}</h3>
      <p class="muted">${esc(def.blurb)} Integrity ${Math.round(shipIntegrity(ship))}% (${fmt(ship.hull)} / ${def.hull} hull).</p>
      ${ship.hull < def.hull ? `<section class="ship-service" aria-label="Dock repair"><div class="rowline"><b>Dock repair</b><span>+${fmt(service.restored)} hull · ${fmt(service.cost)} cr</span></div><p class="muted">${service.metals} t repair metal${from === "earth" ? " bought at current Earth prices" : " from ground stores"}; labour included. Hull after patch ${fmt(service.hullAfter)} / ${def.hull}.</p>${service.ok ? "" : `<p class="warn">${esc(service.reason ?? "Repair unavailable.")}</p>`}<button type="button" class="texty" data-act="repair-ship" ${service.ok ? "" : "disabled"}>Repair hull · ${fmt(service.cost)} cr</button></section>` : ""}
      ${trade?.ready ? `<p class="faint">Export opportunity: ${trade.kilograms} kg helium-3, ${fmt(trade.sale)} cr gross at Earth. <button type="button" class="texty" data-act="prepare-export" data-id="${esc(ship.id)}">Prepare ${trade.from === "earth" ? "pickup run" : "export manifest"}</button></p>` : ""}
      ${crewReturn?.ready && ship.cls === "colony" ? `<p class="muted">Outposts have unreserved crew capacity. <button type="button" class="texty" data-act="prepare-crew-return" data-id="${esc(ship.id)}">Prepare return for crew</button></p>` : ""}
      <p>On board: ${fmt(CARGO_IDS.reduce((s, k) => s + ship.cargo[k], 0))} / ${def.cargo} bay · tank ${fmt(ship.fuel)} t · crew ${ship.crew}.</p>
      ${from !== "earth" && arrival.passengers ? `<p class="${arrival.ready ? "good" : "warn"}">${arrival.passengers} passenger${arrival.passengers === 1 ? "" : "s"} would bring the outpost to ${arrival.populationAfter} crew / ${arrival.housing} completed berths. ${arrival.ready ? "Current production and power cover them; one pilot stays aboard." : esc(arrival.blocker ?? "Check life support before landing crew.")}</p>` : ""}
      <p id="manifest-read">Planned departure: ${fmt(CARGO_IDS.reduce((s, k) => s + draft.cargo[k], 0))} / ${def.cargo} bay.</p>
      <label class="slider">Destination
        <select data-dest="1">${dests.map((d) => `<option value="${d}" ${draft.dest === d ? "selected" : ""}>${d}</option>`).join("")}</select>
        <span></span>
      </label>
      ${sliders}
      <label class="slider">Fuel<input type="range" min="0" max="${Math.max(Math.ceil(draft.fuel), Math.floor(fuelMax))}" step="0.01" value="${draft.fuel}" data-fuel="1"><span>${fmt(draft.fuel)}</span></label>
      <label class="slider">Crew<input type="range" min="1" max="${Math.max(1, Math.floor(crewMax))}" step="1" value="${Math.floor(draft.crew)}" data-crew="1"><span>${fmt(draft.crew)}</span></label>
      <p id="launch-read" class="decision-read ${preview.ok ? "good" : "bad"}" aria-live="polite">${esc(launchSummary(game, ship, draft))}</p>
      <p id="crew-departure-read" class="warn" aria-live="polite" ${departureBlocker ? "" : "hidden"}>${departureBlocker ? esc(departureBlocker) : ""}</p>
      ${quotaReady(game, ship) ? `<p class="warn">This cargo meets the open quota. Deliver for ${fmt(game.contract!.reward)} cr before selling it.</p>` : ""}
      <div class="inline">
        <button type="button" class="btn primary" data-act="launch" ${preview.ok ? "" : "disabled"}>Launch</button>
        ${founding ? `<button type="button" class="texty" data-act="kit">Founding kit</button>` : ""}
        ${from !== "earth" ? `<button type="button" class="texty" data-act="unload">Unload</button><button type="button" class="texty" data-act="fueloff">Offload fuel</button><button type="button" class="texty" data-act="disembark" ${arrival.eligible ? "" : "disabled"}>${arrival.ready ? `Disembark ${arrival.passengers} crew` : "Review crew landing"}</button>` : `<button type="button" class="texty" data-act="sell">Sell cargo</button>`}
        ${from === "earth" && game.contract ? `<button type="button" class="${quotaReady(game, ship) ? "btn primary" : "texty"}" data-act="deliver" ${quotaReady(game, ship) ? "" : "disabled"}>Deliver quota</button>` : ""}
      </div>
      ${from !== "earth" ? `<div class="section-label">Lay down a hull here</div>${SHIP_CLASSES.map((cls) => `<button type="button" class="texty" data-act="commission" data-id="${cls}" data-loc="${from}">${SHIPS[cls].name}</button>`).join(" ")}` : ""}`;
  }

  private cargoMax(game: GameState, ship: Ship, draft: LaunchDraft, k: CargoId): number {
    return cargoLimit(game, ship, draft, k);
  }

  private onInput(ev: Event): void {
    if (this.ui.cinematic) return;
    const input = ev.target as HTMLInputElement;
    if (input.hasAttribute("data-music-volume")) {
      this.music.setVolume(Number(input.value), false);
      const output = input.parentElement?.querySelector("span");
      if (output) output.textContent = `${Math.round(this.music.volume * 100)}%`;
      return;
    }
    const game = this.game;
    const draft = this.ui.draft;
    if (!game || !draft) return;
    if (input.dataset.cargo) {
      draft.cargo[input.dataset.cargo as CargoId] = Number(input.value);
    } else if (input.dataset.fuel) draft.fuel = Number(input.value);
    else if (input.dataset.crew) draft.crew = Number(input.value);
    else return;
    const ship = game.ships.find((s) => s.id === this.ui.shipId);
    if (!ship) return;
    const preview = previewLaunch(game, ship.id, draft);
    const read = this.root.querySelector("#launch-read");
    if (read) {
      read.className = `decision-read ${preview.ok ? "good" : "bad"}`;
      read.textContent = launchSummary(game, ship, draft);
    }
    const manifest = this.root.querySelector("#manifest-read");
    if (manifest) manifest.textContent = `Planned departure: ${fmt(CARGO_IDS.reduce((sum, k) => sum + draft.cargo[k], 0))} / ${SHIPS[ship.cls].cargo} bay.`;
    const departureRead = this.root.querySelector<HTMLElement>("#crew-departure-read");
    if (departureRead) {
      const blocker = crewDepartureBlocker(game, ship.id, draft);
      departureRead.hidden = !blocker;
      departureRead.textContent = blocker ?? "";
    }
    this.root.querySelectorAll<HTMLInputElement>("[data-cargo], [data-fuel]").forEach(slider => {
      const value = slider.dataset.cargo ? draft.cargo[slider.dataset.cargo as CargoId] : draft.fuel;
      const limit = slider.dataset.cargo ? cargoLimit(game, ship, draft, slider.dataset.cargo as CargoId) : fuelLimit(game, ship, draft);
      slider.max = String(Math.max(Math.ceil(value), Math.floor(limit)));
    });
    const span = input.parentElement?.querySelector("span");
    if (span && (input.dataset.cargo || input.dataset.fuel || input.dataset.crew)) span.textContent = fmt(Number(input.value));
    const launch = this.root.querySelector("[data-act='launch']") as HTMLButtonElement | null;
    if (launch) launch.disabled = !preview.ok;
  }

  private onChange(ev: Event): void {
    if (this.ui.cinematic) return;
    const el = ev.target as HTMLSelectElement;
    if (el.hasAttribute("data-music-track")) { this.music.setTrack(el.value); this.paint(); return; }
    if (el.dataset.route) {
      if (el.dataset.route === "from" && el.value in LOCATION_NAMES) {
        this.ui.route.from = el.value as LocationId;
        if (this.ui.route.to === this.ui.route.from) this.ui.route.to = this.ui.route.from === "earth" ? "mars" : "earth";
      } else if (el.dataset.route === "to" && el.value in LOCATION_NAMES && el.value !== this.ui.route.from) this.ui.route.to = el.value as LocationId;
      else if (el.dataset.route === "cls" && SHIP_CLASSES.includes(el.value as Ship["cls"])) this.ui.route.cls = el.value as Ship["cls"];
      this.paint();
      this.root.querySelector<HTMLSelectElement>(`[data-route='${el.dataset.route}']`)?.focus();
      return;
    }
    if (!el.dataset.dest || !this.ui.draft) return;
    this.ui.draft.dest = el.value as LocationId;
    this.paint();
  }

  private onAct(el: HTMLElement): void {
    const act = el.dataset.act;
    if (this.ui.cinematic) {
      if (act === "cinematic-continue" || act === "cinematic-skip") this.dismissCinematic();
      return;
    }
    const game = this.game;
    if (act === "chart-ship" && game && el.dataset.id) {
      const ship = game.ships.find(s => s.id === el.dataset.id);
      if (ship) { this.ensureDraft(game, ship); this.ui.modal = "fleet"; this.paint(); }
      return;
    }
    if (act === "route-fleet" && game) {
      const route = this.ui.route;
      const ship = availableRouteHull(game, route);
      if (ship) {
        this.ensureDraft(game, ship);
        if (this.ui.draft) this.ui.draft.dest = route.to;
        this.ui.modal = "fleet";
        this.paint();
      }
      return;
    }
    if (act === "diff") {
      this.ui.diff = (el.dataset.id as Difficulty) ?? "charter";
      this.paintTitle();
      return;
    }
    if (act === "begin") {
      this.begin();
      return;
    }
    if (act === "continue") {
      const save = loadFrom("autosave");
      if (save) this.start(save, false);
      else this.toast("No autosave.");
      return;
    }
    if (act === "replay-cinematic" && (el.dataset.id === "luna-arrival" || el.dataset.id === "mars-arrival")) {
      this.showCinematic(el.dataset.id, true);
      return;
    }
    if (!game && act !== "close") return;
    if (act === "view" && el.dataset.id) {
      this.focusView(el.dataset.id as "luna" | "mars" | "system");
      this.ui.drawer = null;
      this.paint();
      return;
    }
    if (act === "home") {
      if (this.ui.view !== "system") this.focusView(this.ui.view);
      this.paint();
      return;
    }
    if (act === "construction-site" && game && this.ui.view !== "system") {
      this.clearTip();
      const worldId = this.ui.view;
      const site = game.worlds[worldId].tiles.find((t) =>
        !t.building && BUILD_MENU.some((b) => placementError(game, worldId, t.q, t.r, b) === null));
      if (site) {
        this.ui.selected = { q: site.q, r: site.r };
        const p = axialToPixel(site.q, site.r, HEX);
        this.ui.cam.tx = -p.x * this.ui.cam.zoom;
        this.ui.cam.ty = -p.y * this.ui.cam.zoom;
      } else this.toast("No available construction site within the current budget.", true);
      this.paint();
      return;
    }
    if (act === "drawer") {
      const id = el.dataset.id === "r" ? "r" : "l";
      this.ui.drawer = this.ui.drawer === id ? null : id;
      this.syncDrawer();
      return;
    }
    if (act === "scrim") {
      this.ui.drawer = null;
      this.syncDrawer();
      return;
    }
    if (act === "mute") {
      this.meta.muted = !this.meta.muted;
      this.audio.setMuted(this.meta.muted);
      this.music.setMuted(this.meta.muted);
      saveMeta(this.meta);
      this.paint();
      return;
    }
    if (act === "music-play") { this.music.requested ? this.music.pause() : this.music.play(); this.paint(); return; }
    if (act === "music-next") { this.music.next(); this.paint(); return; }
    if (act === "modal" && el.dataset.id) {
      this.ui.modal = el.dataset.id;
      if (el.dataset.id === "guide") this.ui.guideCategory = "Moon";
      if (el.dataset.id === "fleet") this.prepareFleet();
      this.paint();
      return;
    }
    if (act === "close") {
      if (this.ui.modal === "event") return;
      this.ui.modal = this.ui.confirmReturn ?? null;
      this.ui.confirmReturn = null;
      this.ui.confirm = null;
      this.paint();
      return;
    }
    if (act === "end") {
      this.endTurn();
      return;
    }
    if (act === "tutor-skip") {
      this.meta.tutorialSeen = true;
      saveMeta(this.meta);
      this.ui.tutorial = null;
      this.paint();
      return;
    }
    if (act === "tutor-back") {
      if (this.ui.tutorial !== null) this.ui.tutorial = Math.max(0, this.ui.tutorial - 1);
      this.paint();
      return;
    }
    if (act === "tutor-next") {
      if (this.ui.tutorial === null) return;
      if (this.ui.tutorial >= STEPS.length - 1) {
        this.meta.tutorialSeen = true;
        saveMeta(this.meta);
        this.ui.tutorial = null;
      } else this.ui.tutorial += 1;
      this.paint();
      return;
    }
    if (!game) return;
    if (act === "guide-category" && el.dataset.id) {
      if (FIELD_GUIDE_CATEGORIES.includes(el.dataset.id as (typeof FIELD_GUIDE_CATEGORIES)[number])) this.ui.guideCategory = el.dataset.id as (typeof FIELD_GUIDE_CATEGORIES)[number];
      this.paint();
      return;
    }
    if (act === "land-hint") {
      const hint = this.hintTile(game);
      if (hint && game.founding) this.act(foundColony(game, hint.q, hint.r));
      else this.toast("No marked landing site.");
      return;
    }
    if (act === "build-hint" && el.dataset.id && this.ui.view !== "system") {
      const hint = this.hintTile(game);
      if (!hint) {
        this.toast("No legal hex for that module.");
        this.audio.sfx("error");
        return;
      }
      this.ui.selected = hint;
      this.act(placeBuilding(game, this.ui.view, hint.q, hint.r, el.dataset.id as BuildingId));
      return;
    }
    if (act === "build" && el.dataset.id && this.ui.view !== "system" && this.ui.selected) {
      this.act(placeBuilding(game, this.ui.view, this.ui.selected.q, this.ui.selected.r, el.dataset.id as BuildingId));
      return;
    }
    if (act === "build") {
      this.toast("Select a tile first.");
      this.audio.sfx("error");
      return;
    }
    if (act === "repair" && this.ui.view !== "system" && this.ui.selected) {
      this.act(repairBuilding(game, this.ui.view, this.ui.selected.q, this.ui.selected.r));
      return;
    }
    if (act === "cancel" && this.ui.view !== "system" && this.ui.selected) {
      this.act(cancelBuilding(game, this.ui.view, this.ui.selected.q, this.ui.selected.r));
      return;
    }
    if ((act === "ship" || act === "review-ship") && el.dataset.id) {
      const ship = game.ships.find((s) => s.id === el.dataset.id);
      if (ship) this.ensureDraft(game, ship);
      if (ship && act === "review-ship") this.ui.modal = "fleet";
      this.paint();
      return;
    }
    if (act === "prepare-export" && el.dataset.id) {
      const plan = exportPlan(game, el.dataset.id);
      const ship = game.ships.find(s => s.id === el.dataset.id);
      if (!plan?.ready || !ship) { this.toast(plan?.blocker ?? "That export is no longer available."); return; }
      this.ensureDraft(game, ship);
      this.ui.draft = structuredClone(plan.draft);
      this.ui.modal = "fleet";
      this.paint();
      this.toast("Manifest prepared. No ship launched and no cargo sold.");
      return;
    }
    if (act === "prepare-crew" && el.dataset.id && (el.dataset.world === "luna" || el.dataset.world === "mars")) {
      const plan = crewTransferPlan(game, el.dataset.id, el.dataset.world);
      const ship = game.ships.find(s => s.id === el.dataset.id);
      if (!plan?.ready || !ship) { this.toast(plan?.blocker ?? "That crew transfer is no longer available."); return; }
      this.ensureDraft(game, ship);
      this.ui.draft = structuredClone(plan.draft);
      this.ui.modal = "fleet";
      this.paint();
      this.toast("Crew manifest prepared. No hiring, departure or landing yet.");
      return;
    }
    if (act === "repair-ship" && this.ui.shipId) return this.act(repairShip(game, this.ui.shipId));
    if (act === "prepare-crew-return" && el.dataset.id) {
      const plan = crewReturnPlan(game, el.dataset.id);
      const ship = game.ships.find(s => s.id === el.dataset.id);
      if (!plan?.ready || !ship) { this.toast(plan?.blocker ?? "That return is no longer available."); return; }
      this.ensureDraft(game, ship);
      this.ui.draft = structuredClone(plan.draft);
      this.paint();
      this.toast("Return manifest prepared. No departure yet.");
      return;
    }
    if (act === "launch" && this.ui.shipId && this.ui.draft) {
      const shipId = this.ui.shipId;
      const draft = structuredClone(this.ui.draft);
      const blocker = crewDepartureBlocker(game, shipId, draft);
      if (blocker && previewLaunch(game, shipId, draft).ok) {
        this.ui.confirm = {
          title: "Review passenger departure",
          body: `${blocker} ${draft.crew - 1} passenger${draft.crew === 2 ? " is" : "s are"} planned for ${LOCATION_NAMES[draft.dest]}. Conditions can change before arrival; a separate disembarkation is still required.`,
          yes: "Launch anyway",
          go: () => { this.ui.modal = "fleet"; if (this.game === game) this.act(launchShip(game, shipId, draft)); },
        };
        this.ui.confirmReturn = "fleet";
        this.ui.modal = "confirm";
        this.paint();
      } else this.act(launchShip(game, shipId, draft));
      return;
    }
    if (act === "kit" && this.ui.draft && this.ui.shipId) {
      const ship = game.ships.find((s) => s.id === this.ui.shipId);
      if (ship && ship.loc !== "transit") {
        const route = planRoute(game, ship.loc, this.ui.draft.dest, ship.cls);
        const kit = foundingKit(route.burn, ship.fuel);
        this.ui.draft.cargo = {
          water: kit.water,
          oxygen: kit.oxygen,
          food: kit.food,
          metals: kit.metals,
          he3: 0,
          regolith: 0,
          propellant: 0,
        };
        this.ui.draft.fuel = Math.min(SHIPS[ship.cls].fuel, kit.fuel);
        this.ui.draft.crew = Math.min(SHIPS[ship.cls].crew, kit.crew);
        this.paint();
      }
      return;
    }
    if (act === "unload" && this.ui.shipId) return this.act(unloadShip(game, this.ui.shipId));
    if (act === "sell" && this.ui.shipId) return this.act(sellCargo(game, this.ui.shipId));
    if (act === "fueloff" && this.ui.shipId) return this.act(offloadFuel(game, this.ui.shipId));
    if (act === "disembark" && this.ui.shipId) {
      const shipId = this.ui.shipId;
      const arrival = crewArrivalAdvice(game, shipId);
      if (!arrival.eligible) { this.toast(arrival.blocker ?? "Cannot disembark.", true); return; }
      if (arrival.ready) return this.act(disembark(game, shipId));
      this.ui.confirm = {
        title: "Crew landing risk",
        body: `${arrival.blocker} ${arrival.passengers} passenger${arrival.passengers === 1 ? "" : "s"} would raise population to ${arrival.populationAfter} with ${arrival.housing} completed berths. This may cause shortages or overcrowding.`,
        yes: "Disembark anyway",
        go: () => { this.ui.modal = "fleet"; this.act(disembark(game, shipId)); },
      };
      this.ui.confirmReturn = "fleet";
      this.ui.modal = "confirm";
      this.paint();
      return;
    }
    if (act === "deliver" && this.ui.shipId) return this.act(fulfillContract(game, this.ui.shipId));
    if (act === "commission") {
      this.act(commissionShip(game, (el.dataset.id as Ship["cls"]) ?? "courier", (el.dataset.loc as LocationId) ?? "earth"));
      return;
    }
    if (act === "research" && el.dataset.id) {
      const id = el.dataset.id as TechId;
      const target = TECH_BY_ID[id];
      const ready = !!target && target.req.every((r) => game.tech.unlocked.includes(r)) && !game.tech.unlocked.includes(id);
      if (!ready) {
        this.act(queueResearch(game, id));
        return;
      }
      if (game.tech.current && game.tech.current !== id && game.tech.progress > 0) {
        const currentName = TECH_BY_ID[game.tech.current]?.name ?? game.tech.current;
        this.ui.confirm = {
          title: "Switch research?",
          body: `Switch from ${currentName} to ${target.name}? The ${fmt(game.tech.progress)} RP already invested in ${currentName} will be lost.`,
          yes: `Switch to ${target.name}`,
          go: () => { this.ui.modal = "tech"; this.act(queueResearch(game, id)); },
        };
        this.ui.confirmReturn = "tech";
        this.ui.modal = "confirm";
        this.paint();
      } else this.act(queueResearch(game, id));
      return;
    }
    if (act === "choice" && game.events[0]) {
      this.act(chooseEvent(game, game.events[0].id, el.dataset.id ?? ""));
      if (game.events.length === 0 && this.ui.modal === "event") this.ui.modal = null;
      this.paint();
      return;
    }
    if (act === "step") {
      const key = el.dataset.id as "food" | "water" | "oxygen" | "metals" | "propellant";
      const dir = Number(el.dataset.dir);
      this.ui.order[key] = Math.max(0, this.ui.order[key] + dir * (key === "metals" ? 2 : 2));
      this.paint();
      return;
    }
    if (act === "odest") {
      this.ui.order.dest = el.dataset.id === "mars" ? "mars" : "luna";
      this.paint();
      return;
    }
    if (act === "drop") {
      const o = this.ui.order;
      this.act(orderSupply(game, o.dest, { food: o.food, water: o.water, oxygen: o.oxygen, metals: o.metals, propellant: o.propellant }));
      return;
    }
    if (act === "speed") {
      const n = Number(el.dataset.id);
      this.meta.anim = n === 0.65 || n === 1.8 ? n : 1;
      saveMeta(this.meta);
      this.paint();
      return;
    }
    if (act === "save") {
      saveTo(el.dataset.id as SlotId, game);
      this.toast(`Saved ${el.dataset.id}.`);
      return;
    }
    if (act === "load") {
      const slot = el.dataset.id as SlotId;
      const next = loadFrom(slot);
      if (!next) {
        this.toast("That slot is empty or damaged. Its stored data has not been deleted.");
        return;
      }
      this.ui.confirm = {
        title: "Load charter",
        body: `Replace the current sol with ${slot}?`,
        yes: "Load",
        go: () => this.start(next, false),
      };
      this.ui.modal = "confirm";
      this.paint();
      return;
    }
    if (act === "newgame") {
      this.ui.confirm = {
        title: "New charter",
        body: "Leave this sol? Autosave keeps the current one until a new charter overwrites it.",
        yes: "New charter",
        go: () => {
          this.toTitle();
        },
      };
      this.ui.modal = "confirm";
      this.paint();
      return;
    }
    if (act === "confirm-yes" && this.ui.confirm) {
      const go = this.ui.confirm.go;
      this.ui.confirm = null;
      this.ui.confirmReturn = null;
      this.ui.modal = null;
      go();
      return;
    }
    if (act === "title") {
      this.toTitle();
      return;
    }
    if (act === "briefing") {
      this.ui.tutorial = 0;
      this.ui.modal = null;
      this.paint();
    }
  }

  private prepareFleet(): void {
    const game = this.game;
    if (!game) return;
    if (!this.ui.shipId || !game.ships.some((s) => s.id === this.ui.shipId)) {
      const ship = game.ships[0];
      if (ship) this.ensureDraft(game, ship);
    }
  }

  private toTitle(): void {
    this.ui.screen = "title";
    this.ui.modal = null;
    this.ui.tutorial = null;
    (this.root.querySelector("#hud") as HTMLElement).hidden = true;
    (this.root.querySelector("#title") as HTMLElement).hidden = false;
    (this.root.querySelector("#modal") as HTMLElement).hidden = true;
    (this.root.querySelector("#tutorial") as HTMLElement).hidden = true;
    this.audio.setScene("title");
    this.paintTitle();
    document.body.dataset.coach = "";
  }

  private syncDrawer(): void {
    document.body.classList.toggle("drawer-l", this.ui.drawer === "l");
    document.body.classList.toggle("drawer-r", this.ui.drawer === "r");
    (this.root.querySelector("#scrim") as HTMLElement).hidden = this.ui.drawer === null;
  }

  private onDown(ev: PointerEvent): void {
    if (this.ui.screen !== "play" || this.ui.cinematic) return;
    this.audio.unlock();
    this.clearTip();
    this.ptr = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: 0, cx: this.ui.cam.x, cy: this.ui.cam.y };
    this.canvas.setPointerCapture(ev.pointerId);
  }

  private onMove(ev: PointerEvent): void {
    if (this.ui.screen !== "play" || !this.game || this.ui.cinematic) return;
    if (this.ptr && this.ptr.id === ev.pointerId && this.ui.view !== "system") {
      const dx = ev.clientX - this.ptr.x;
      const dy = ev.clientY - this.ptr.y;
      this.ptr.moved += Math.abs(ev.movementX) + Math.abs(ev.movementY);
      if (this.ptr.moved > 4) {
        this.clearTip();
        this.canvas.classList.add("grabbing");
        this.ui.cam.x = this.ptr.cx + dx;
        this.ui.cam.y = this.ptr.cy + dy;
        this.ui.cam.tx = this.ui.cam.x;
        this.ui.cam.ty = this.ui.cam.y;
        this.clampCam();
        return;
      }
    }
    const rect = this.canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    if (this.ui.view === "luna" || this.ui.view === "mars") {
      const hex = pickHex(mx, my, this.ui.cam, this.geom());
      const world = this.game.worlds[this.ui.view];
      const tile = hex ? world.tiles.find((t) => t.q === hex.q && t.r === hex.r) ?? null : null;
      this.ui.hover = tile ? { q: tile.q, r: tile.r } : null;
      const tip = this.root.querySelector("#tip") as HTMLElement;
      if (!tile) tip.hidden = true;
      else {
        tip.hidden = false;
        const vp = (this.root.querySelector("#viewport") as HTMLElement).getBoundingClientRect();
        tip.innerHTML = `<b>${TERRAIN_LABEL[tile.terrain]}</b><br>Ice ${tile.ice} · Metal ${tile.metal}${tile.building ? `<br>${BUILDINGS[tile.building.type].name}<br>${tile.building.progress > 0 ? "Current" : "Next sol"}: ${buildingStatus(tile.building, tile.q, tile.r, this.forecasts[this.ui.view] ?? null).label}` : ""}`;
        tip.style.left = `${Math.max(8, Math.min(vp.width - tip.offsetWidth - 8, ev.clientX - vp.left + 14))}px`;
        tip.style.top = `${Math.max(8, Math.min(vp.height - tip.offsetHeight - 8, ev.clientY - vp.top + 14))}px`;
      }
    }
  }

  private onUp(ev: PointerEvent): void {
    if (this.ui.cinematic || !this.ptr || !this.game) return;
    const moved = this.ptr.moved;
    this.endDrag();
    this.clearTip();
    if (moved > 5) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    if (this.ui.view === "system") {
      const hit = pickBody(mx, my, this.geom());
      if (hit === "earth") {
        this.ui.modal = "earth";
        this.paint();
      } else if (hit === "luna" || hit === "mars") {
        this.focusView(hit);
        this.paint();
      }
      return;
    }
    const hex = pickHex(mx, my, this.ui.cam, this.geom());
    if (!hex) return;
    const world = this.game.worlds[this.ui.view];
    const tile = world.tiles.find((t) => t.q === hex.q && t.r === hex.r);
    if (!tile) return;
    if (this.game.founding?.world === this.ui.view) {
      this.act(foundColony(this.game, tile.q, tile.r));
      return;
    }
    this.ui.selected = { q: tile.q, r: tile.r };
    if (window.innerWidth <= 980) this.ui.drawer = "r";
    this.audio.sfx("click");
    this.paint();
  }

  private endDrag(): void {
    this.ptr = null;
    this.canvas.classList.remove("grabbing");
  }

  private clearTip(): void {
    this.ui.hover = null;
    const tip = this.root.querySelector("#tip") as HTMLElement | null;
    if (tip) tip.hidden = true;
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const before = worldFromScreen(mx, my, this.ui.cam, this.geom());
    const old = this.ui.cam.zoom;
    this.ui.cam.zoom = Math.max(0.55, Math.min(2.5, this.ui.cam.zoom * factor));
    this.ui.cam.x += before.x * (old - this.ui.cam.zoom);
    this.ui.cam.y += before.y * (old - this.ui.cam.zoom);
    this.ui.cam.tx = this.ui.cam.x;
    this.ui.cam.ty = this.ui.cam.y;
    this.clearTip();
    this.clampCam();
  }

  private onKey(ev: KeyboardEvent): void {
    if (this.ui.cinematic) {
      ev.preventDefault();
      if (ev.key === "Escape" || ev.key === "Enter" && (ev.target as HTMLElement)?.dataset.act === "cinematic-continue") {
        this.dismissCinematic();
        return;
      }
      if (ev.key === "Tab") {
        const buttons = Array.from(this.root.querySelectorAll<HTMLElement>("#cinematic button:not([disabled])"));
        if (buttons.length) {
          const index = buttons.indexOf(document.activeElement as HTMLElement);
          buttons[(index + (ev.shiftKey ? -1 : 1) + buttons.length) % buttons.length]!.focus();
        }
      }
      return;
    }
    if (this.ui.modal) {
      const modal = this.root.querySelector("#modal .sheet") as HTMLElement | null;
      if (ev.key === "Escape") {
        ev.preventDefault();
        if (this.ui.modal !== "event") {
          this.ui.modal = this.ui.confirmReturn ?? null;
          this.ui.confirmReturn = null;
          this.ui.confirm = null;
          this.paint();
        }
        return;
      }
      if (ev.key === "Tab" && modal) {
        const focusable = Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
          .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
        if (focusable.length) {
          ev.preventDefault();
          const index = focusable.indexOf(document.activeElement as HTMLElement);
          const next = index < 0 ? (ev.shiftKey ? focusable.length - 1 : 0) : (index + (ev.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
          focusable[next]!.focus();
        }
        return;
      }
      if ((ev.target as HTMLElement)?.dataset.act === "guide-category" && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) {
        ev.preventDefault();
        const index = FIELD_GUIDE_CATEGORIES.indexOf(this.ui.guideCategory);
        const next = ev.key === "Home" ? 0 : ev.key === "End" ? FIELD_GUIDE_CATEGORIES.length - 1 : (index + (ev.key === "ArrowRight" ? 1 : -1) + FIELD_GUIDE_CATEGORIES.length) % FIELD_GUIDE_CATEGORIES.length;
        this.ui.guideCategory = FIELD_GUIDE_CATEGORIES[next]!;
        this.paint();
        this.root.querySelector<HTMLElement>(`#guide-tab-${next}`)?.focus();
      }
      // Native typing, selection, sliders, and Enter/Space still work inside a
      // dialog; only the gameplay shortcut dispatcher below is bypassed.
      return;
    }
    if (ev.key === "Escape") this.clearTip();
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      return;
    }
    if (this.ui.screen !== "play") return;
    const k = ev.key.toLowerCase();
    if (ev.key === "Escape") {
      if (this.ui.modal && this.ui.modal !== "event") {
        this.ui.modal = null;
        this.paint();
      }
      this.ui.drawer = null;
      this.syncDrawer();
      return;
    }
    if (k === "e") this.endTurn();
    else if (k === "1") {
      this.focusView("luna");
      this.paint();
    } else if (k === "2") {
      this.focusView("mars");
      this.paint();
    } else if (k === "3") {
      this.focusView("system");
      this.paint();
    } else if (k === "f") {
      this.ui.modal = "fleet";
      this.prepareFleet();
      this.paint();
    } else if (k === "r") {
      this.ui.modal = "tech";
      this.paint();
    } else if (k === "c") {
      this.ui.modal = "earth";
      this.paint();
    } else if (k === "g") {
      this.ui.modal = "objectives";
      this.paint();
    } else if (k === "h" || ev.key === "?") {
      this.ui.modal = "help";
      this.paint();
    } else if (k === "l") {
      this.ui.modal = "log";
      this.paint();
    } else if (k === "m") {
      this.meta.muted = !this.meta.muted;
      this.audio.setMuted(this.meta.muted);
      this.music.setMuted(this.meta.muted);
      saveMeta(this.meta);
      this.paint();
    } else if (ev.key === "ArrowLeft" || k === "a") this.nudge(36, 0);
    else if (ev.key === "ArrowRight" || k === "d") this.nudge(-36, 0);
    else if (ev.key === "ArrowUp" || k === "w") this.nudge(0, 36);
    else if (ev.key === "ArrowDown" || k === "s") this.nudge(0, -36);
    else if (k === "+" || k === "=") this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.08);
    else if (k === "-" || k === "_") this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, 0.92);
  }

  private nudge(x: number, y: number): void {
    if (this.ui.view === "system") return;
    this.ui.cam.tx += x;
    this.ui.cam.ty += y;
    this.clearTip();
    this.clampCam();
  }
}
