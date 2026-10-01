import type { GameState } from "../core/types";

export type CinematicKind = "luna-arrival" | "mars-arrival";
export type CinematicMode = "progression" | "replay";

export interface CinematicDecisionContext {
  mode: CinematicMode;
  newGame: boolean;
  continuing: boolean;
  seenLuna: boolean;
  seenMars: boolean;
  foundingWorld: "luna" | "mars" | null;
  actualMarsArrival: boolean;
}

export function decideCinematic(context: CinematicDecisionContext): CinematicKind | null {
  if (context.mode === "replay") return null;
  if (context.newGame && !context.seenLuna && context.foundingWorld !== "mars") return "luna-arrival";
  if (context.actualMarsArrival && context.foundingWorld === "mars" && !context.seenMars) return "mars-arrival";
  return null;
}

export function cinematicSeenKey(kind: CinematicKind): string {
  return kind === "luna-arrival" ? "cinematicLunaArrival" : "cinematicMarsArrival";
}

export function shouldShowPendingMarsArrival(game: Pick<GameState, "founding" | "script">): boolean {
  return game.founding?.world === "mars" && !game.script[cinematicSeenKey("mars-arrival")];
}
