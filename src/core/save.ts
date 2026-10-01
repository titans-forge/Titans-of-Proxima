import type { Difficulty, GameState } from "./types";

const PREFIX = "proxima-astra:v1:";

export interface Meta {
  muted: boolean;
  anim: number;
  tutorialSeen: boolean;
}

export interface SlotInfo {
  slot: string;
  turn: number;
  difficulty: Difficulty;
  at: number;
  seed: number;
}

const SLOTS = ["autosave", "slot1", "slot2", "slot3"] as const;
export type SlotId = (typeof SLOTS)[number];

export function saveTo(slot: SlotId, state: GameState): void {
  localStorage.setItem(PREFIX + slot, JSON.stringify({ at: Date.now(), state }));
}

export function loadFrom(slot: SlotId): GameState | null {
  try {
    const raw = localStorage.getItem(PREFIX + slot);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: GameState };
    if (!parsed.state || parsed.state.version !== 1 || !parsed.state.worlds?.luna) return null;
    return parsed.state;
  } catch {
    return null;
  }
}

export function listSlots(): SlotInfo[] {
  const out: SlotInfo[] = [];
  for (const slot of SLOTS) {
    try {
      const raw = localStorage.getItem(PREFIX + slot);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { at?: number; state?: GameState };
      if (!parsed.state || parsed.state.version !== 1) continue;
      out.push({
        slot,
        turn: parsed.state.turn,
        difficulty: parsed.state.difficulty,
        at: parsed.at ?? 0,
        seed: parsed.state.seed,
      });
    } catch {
      /* ignore broken slot */
    }
  }
  return out;
}

export function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(PREFIX + "meta");
    if (!raw) return { muted: false, anim: 1, tutorialSeen: false };
    const parsed = JSON.parse(raw) as Partial<Meta>;
    return {
      muted: !!parsed.muted,
      anim: parsed.anim === 0.65 || parsed.anim === 1.8 ? parsed.anim : 1,
      tutorialSeen: !!parsed.tutorialSeen,
    };
  } catch {
    return { muted: false, anim: 1, tutorialSeen: false };
  }
}

export function saveMeta(meta: Meta): void {
  localStorage.setItem(PREFIX + "meta", JSON.stringify(meta));
}
