type Scene = "title" | "luna" | "mars" | "system";

/** Short interface cues only. Scene changes never start a sustained source. */
export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  unlock(): void {
    try {
      if (!this.ctx) {
        const ctx = new AudioContext();
        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : 0.22;
        master.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.22, this.ctx.currentTime, 0.05);
  }

  setScene(_scene: Scene): void {}

  sfx(kind: string): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    if (kind === "click") this.tone(740, 0.04, "square", 0.04, 880);
    else if (kind === "build") { this.tone(220, 0.12, "triangle", 0.06, 330); this.tone(440, 0.16, "sine", 0.04, 660); }
    else if (kind === "error") this.tone(140, 0.14, "sawtooth", 0.04, 90);
    else if (kind === "turn") { this.tone(392, 0.08, "sine", 0.05, 392); this.tone(523, 0.12, "sine", 0.04, 784); }
    else if (kind === "launch") this.sweep(180, 720, 0.35, 0.05);
    else if (kind === "event") { this.tone(660, 0.1, "square", 0.04, 495); this.tone(495, 0.18, "triangle", 0.04, 330); }
    else if (kind === "research") this.tone(520, 0.2, "sine", 0.05, 780);
    else if (kind === "arrive") this.tone(480, 0.16, "triangle", 0.05, 720);
    else if (kind === "win") [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, "sine", 0.05, f, t + i * 0.12));
    else if (kind === "lose") [392, 349, 311, 233].forEach((f, i) => this.tone(f, 0.28, "triangle", 0.05, f * 0.9, t + i * 0.14));
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slide: number, when?: number): void {
    if (!this.ctx || !this.master) return;
    const t = when ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator(); const g = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t); osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master); osc.start(t); osc.stop(t + dur + 0.02);
  }

  private sweep(from: number, to: number, dur: number, gain: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime; const osc = this.ctx.createOscillator(); const g = this.ctx.createGain(); const filter = this.ctx.createBiquadFilter();
    osc.type = "sawtooth"; osc.frequency.setValueAtTime(from, t); osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    filter.type = "lowpass"; filter.frequency.setValueAtTime(400, t); filter.frequency.linearRampToValueAtTime(1800, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter); filter.connect(g); g.connect(this.master); osc.start(t); osc.stop(t + dur + 0.02);
  }
}
