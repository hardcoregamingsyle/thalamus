// Tiny helpers that tie the Web-Audio sfx and the canvas confetti to a DOM
// element, so study widgets can celebrate "on top of" themselves without each
// reimplementing rect math. All fire-and-forget.

import { confettiPop, confettiBurst } from "@/lib/confetti";

/** Positioned confetti pop at the centre of a widget (for a correct answer). */
export function celebrateAt(el: HTMLElement | null): void {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  confettiPop(r.left + r.width / 2, r.top + r.height * 0.2);
}

/** Bigger confetti burst for milestones (finish a deck / a whole path). */
export function bigCelebrateAt(el: HTMLElement | null): void {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  confettiBurst(r.left + r.width / 2, r.top + r.height / 2, { count: 70, power: 12 });
}
