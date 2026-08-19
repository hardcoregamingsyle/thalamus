// Lightweight Web-Audio sound effects for interactive study widgets. No assets
// — every sound is synthesized with the Web Audio API, so it works offline and
// adds no bundle weight. All calls are fire-and-forget and swallowed on any
// failure (no audio hardware / autoplay policy → silently no-op).

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  start = 0,
  duration = 0.15,
  type: OscillatorType = "sine",
  volume = 0.15,
): void {
  const c = getCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + start);
    gain.gain.setValueAtTime(0, c.currentTime + start);
    gain.gain.linearRampToValueAtTime(volume, c.currentTime + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime + start);
    osc.stop(c.currentTime + start + duration + 0.02);
  } catch { /* no-op */ }
}

export const sfx = {
  correct(): void {
    // Bright two-note "ding" going up.
    tone(660, 0, 0.12, "sine", 0.16);
    tone(880, 0.09, 0.16, "sine", 0.14);
  },
  wrong(): void {
    // Soft descending "buzz".
    tone(220, 0, 0.18, "sawtooth", 0.09);
    tone(180, 0.08, 0.2, "sawtooth", 0.08);
  },
  flip(): void {
    // Quick "tick" for card flips.
    tone(520, 0, 0.05, "triangle", 0.08);
  },
  advance(): void {
    // Upward "pop" for moving to the next step.
    tone(500, 0, 0.07, "triangle", 0.12);
    tone(740, 0.06, 0.09, "triangle", 0.1);
  },
  complete(): void {
    // Rising fanfare when a path is finished.
    tone(523, 0, 0.14, "sine", 0.14);
    tone(659, 0.12, 0.14, "sine", 0.14);
    tone(784, 0.24, 0.2, "sine", 0.14);
  },
  click(): void {
    tone(320, 0, 0.04, "square", 0.05);
  },
};
