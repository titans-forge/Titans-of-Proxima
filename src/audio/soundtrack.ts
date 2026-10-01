export interface SoundtrackTrack { id: string; title: string; composer: string; performer: string; license: string; source: string; src: string }

export const soundtrackTracks: SoundtrackTrack[] = [
  { id: "bach-aria", title: "Goldberg Variations: Aria", composer: "Johann Sebastian Bach", performer: "Kimiko Ishizaka", license: "CC0 1.0 Universal", source: "https://freemusicarchive.org/music/Kimiko_Ishizaka/The_Open_Goldberg_Variations/KIMIKO_ISHIZAKA_-_Goldberg_Variations_BWV_988_-_01_-_Aria__44k-24b/", src: "audio/bach-goldberg-aria.mp3" },
  { id: "handel-sarabande", title: "Water Music: Sarabande", composer: "George Frideric Handel", performer: "United States Marine Band, Marine Chamber Orchestra", license: "Public domain - U.S. federal work", source: "https://commons.wikimedia.org/wiki/File:Handel's_Water_Music_-_16._Sarabande_-_Chamber_Orchestra_-_United_States_Marine_Band.opus", src: "audio/handel-water-music-sarabande.mp3" },
  { id: "holst-venus", title: "Venus, the Bringer of Peace", composer: "Gustav Holst", performer: "United States Air Force Heritage of America Band", license: "Public domain - U.S. federal work", source: "https://commons.wikimedia.org/wiki/File:Holst-_venus.ogg", src: "audio/holst-venus.mp3" },
  { id: "holst-mars", title: "Mars, the Bringer of War", composer: "Gustav Holst", performer: "United States Air Force Heritage of America Band", license: "Public domain - U.S. federal work", source: "https://commons.wikimedia.org/wiki/File:Holst-_mars.ogg", src: "audio/holst-mars.mp3" },
];

const TRACK_KEY = "proxima-astra:v1:soundtrack-track";
const VOLUME_KEY = "proxima-astra:v1:soundtrack-volume";
const DEFAULT_VOLUME = 0.24;
const validTrack = (id: string | null) => soundtrackTracks.some((track) => track.id === id) ? id! : soundtrackTracks[0].id;
const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string): void => { try { localStorage.setItem(key, value); } catch { /* optional storage */ } };

export function parseStoredVolume(value: string | null): number {
  if (value === null || value === "") return DEFAULT_VOLUME;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_VOLUME;
}

export class SoundtrackPlayer {
  readonly element: HTMLAudioElement;
  trackId: string;
  volume: number;
  muted = false;
  requested = false;
  status: "paused" | "loading" | "playing" | "error" = "paused";
  error = "";
  private intent = 0;
  constructor(private readonly onUpdate = () => {}) {
    this.element = document.createElement("audio");
    this.element.preload = "metadata";
    this.trackId = validTrack(read(TRACK_KEY));
    this.volume = parseStoredVolume(read(VOLUME_KEY));
    this.element.volume = this.volume;
    this.element.addEventListener("playing", () => {
      if (!this.requested || this.element.paused) {
        if (!this.element.paused) this.element.pause();
        this.status = "paused";
      } else { this.status = "playing"; this.error = ""; }
      this.onUpdate();
    });
    this.element.addEventListener("pause", () => { this.status = "paused"; this.onUpdate(); });
    this.element.addEventListener("waiting", () => { if (this.requested) { this.status = "loading"; this.onUpdate(); } });
    this.element.addEventListener("error", () => { this.status = "error"; this.error = "Track could not be loaded."; this.requested = false; this.onUpdate(); });
    this.element.addEventListener("ended", () => { if (this.requested) this.next(); });
    this.loadTrack(this.trackId, false);
  }
  setMuted(muted: boolean): void { this.muted = muted; this.element.muted = muted; this.onUpdate(); }
  setVolume(volume: number, notify = true): void { this.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : DEFAULT_VOLUME)); this.element.volume = this.volume; write(VOLUME_KEY, String(this.volume)); if (notify) this.onUpdate(); }
  setTrack(id: string): void {
    const next = validTrack(id); if (next === this.trackId) return;
    const play = this.requested; this.intent += 1; this.requested = play; this.trackId = next; write(TRACK_KEY, next); this.loadTrack(next, play);
  }
  play(): void {
    this.requested = true; const token = ++this.intent; this.status = "loading"; this.error = ""; this.onUpdate();
    void Promise.resolve(this.element.play()).catch(() => { if (token !== this.intent || !this.requested) return; this.requested = false; this.status = "error"; this.error = "Playback was blocked. Press Play to try again."; this.onUpdate(); });
  }
  pause(): void { this.intent += 1; this.requested = false; this.element.pause(); this.status = "paused"; this.onUpdate(); }
  next(): void { const index = soundtrackTracks.findIndex((track) => track.id === this.trackId); const next = soundtrackTracks[(index + 1) % soundtrackTracks.length]; this.setTrack(next.id); }
  private loadTrack(id: string, play: boolean): void { const track = soundtrackTracks.find((item) => item.id === id)!; this.element.src = track.src; this.element.load(); this.status = play ? "loading" : "paused"; this.onUpdate(); if (play) this.play(); }
}
