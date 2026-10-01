import { Soundscape } from "./audio";
import { SoundtrackPlayer, parseStoredVolume } from "./soundtrack";

function assertEqual(actual: unknown, expected: unknown, message = ""): void {
  if (actual !== expected) throw new Error(`${message} expected ${String(expected)}, got ${String(actual)}`);
}

class MockAudio {
  preload = ""; src = ""; volume = 1; muted = false; paused = true;
  private listeners = new Map<string, (() => void)[]>();
  pending: Array<{ resolve: () => void; reject: () => void }> = [];
  addEventListener(type: string, listener: () => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  emit(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener(); }
  load(): void { this.paused = true; }
  play(): Promise<void> { this.paused = false; return new Promise((resolve, reject) => this.pending.push({ resolve: () => { this.emit("playing"); resolve(); }, reject })); }
  pause(): void { this.paused = true; this.emit("pause"); }
}

class MockGain { gain = { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; connect() {} }
class MockOscillator { type = "sine"; frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; connect() {} start() {} stop() {} }
class MockFilter extends MockOscillator { filter = ""; }
class MockContext {
  state = "suspended"; currentTime = 0; oscillatorCount = 0; destination = {};
  resume() { this.state = "running"; return Promise.resolve(); }
  createGain() { return new MockGain(); }
  createOscillator() { this.oscillatorCount += 1; return new MockOscillator(); }
  createBiquadFilter() { return new MockFilter(); }
}

const storage = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
(globalThis as any).document = { createElement: () => new MockAudio() };
(globalThis as any).AudioContext = MockContext;

const soundscape = new Soundscape();
soundscape.unlock();
soundscape.setScene("luna");
soundscape.setScene("mars");
assertEqual((soundscape as any).ctx.oscillatorCount, 0, "unlock and setScene must not start ambient sources");
soundscape.sfx("click");
assertEqual((soundscape as any).ctx.oscillatorCount, 1, "brief SFX remains available");
soundscape.setMuted(true);
soundscape.sfx("click");
assertEqual((soundscape as any).ctx.oscillatorCount, 1, "mute silences SFX");

assertEqual(parseStoredVolume("bad"), 0.24);
assertEqual(parseStoredVolume("2"), 0.24);
assertEqual(parseStoredVolume("0.5"), 0.5);
storage.set("proxima-astra:v1:soundtrack-track", "not-a-track");
storage.set("proxima-astra:v1:soundtrack-volume", "bad");
const player = new SoundtrackPlayer();
assertEqual(player.trackId, "bach-aria");
assertEqual(player.volume, 0.24);
assertEqual(player.element.paused, true);
player.setMuted(true);
assertEqual(player.element.muted, true);
player.setVolume(0.4);
assertEqual(player.element.volume, 0.4);

player.play();
const first = (player.element as any).pending.shift();
player.pause();
first.resolve();
await Promise.resolve();
assertEqual(player.requested, false, "a stale play promise cannot override pause");
assertEqual(player.status, "paused", "stale playing event cannot misreport playback");
assertEqual(player.element.paused, true, "stale event leaves audio paused");
player.play();
(player.element as any).pending.shift().resolve();
await Promise.resolve();
assertEqual(player.requested, true);
(player.element as any).emit("ended");
assertEqual(player.trackId, "handel-sarabande", "ended advances while playback was requested");
(player.element as any).emit("error");
assertEqual(player.requested, false, "load errors stop requested playback");
player.pause();
const pausedTrack = player.trackId;
(player.element as any).emit("ended");
assertEqual(player.trackId, pausedTrack, "ended does not advance after pause");

const rejected = new SoundtrackPlayer();
rejected.play();
(rejected.element as any).pending.shift().reject();
await Promise.resolve();
await Promise.resolve();
assertEqual(rejected.status, "error", "rejected play is reported");
assertEqual(rejected.requested, false);
rejected.pause();
rejected.setMuted(true);
rejected.setMuted(false);
assertEqual(rejected.element.paused, true, "unmuting never starts paused music");

const switched = new SoundtrackPlayer();
switched.play();
const oldPlay = (switched.element as any).pending.shift();
switched.setTrack("holst-mars");
oldPlay.reject();
await Promise.resolve();
assertEqual(switched.requested, true, "stale rejection cannot cancel the new track");
(switched.element as any).pending.shift().resolve();
await Promise.resolve();
assertEqual(switched.trackId, "holst-mars");
assertEqual(switched.status, "playing");

(globalThis as any).localStorage.setItem = () => { throw new Error("quota"); };
player.setVolume(0.2);
assertEqual(player.volume, 0.2, "storage failure does not break volume control");

console.log("audio checks passed");
