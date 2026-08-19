// Tiny dependency-free canvas confetti engine. A single fixed full-viewport
// canvas is created lazily on first use, so there is zero cost until a widget
// actually celebrates. All particles are plain rotating rects with gravity and
// drag — no assets, no bundle weight. Calls are fire-and-forget and silently
// no-op on any failure (SSR / no canvas / hidden tab).
//
// Bright, kid-friendly palette shared by every celebration.

export const CONFETTI_COLORS = [
  "#f43f5e", // rose
  "#f97316", // orange
  "#facc15", // yellow
  "#4ade80", // green
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#f472b6", // pink
  "#22d3ee", // cyan
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
  life: number;
  maxLife: number;
  shape: "rect" | "circle";
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let running = false;

function ensureCanvas(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.style.position = "fixed";
      canvas.style.inset = "0";
      canvas.style.width = "100vw";
      canvas.style.height = "100vh";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "9999";
      canvas.style.display = "none";
      document.body.appendChild(canvas);
      ctx = canvas.getContext("2d");
    }
    if (!canvas || !ctx) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== window.innerWidth * dpr || canvas.height !== window.innerHeight * dpr) {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return true;
  } catch {
    return false;
  }
}

function spawnBurst(
  x: number,
  y: number,
  count: number,
  colors: string[],
  opts: { spread?: number; power?: number; gravity?: number } = {},
): void {
  const spread = opts.spread ?? Math.PI; // radians of the fan
  const power = opts.power ?? 11;
  const baseAngle = opts.spread === Math.PI * 2 ? 0 : -Math.PI / 2;
  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (Math.random() - 0.5) * spread;
    const speed = power * (0.55 + Math.random() * 0.85);
    const w = 6 + Math.random() * 6;
    particles.push({
      x: x + (Math.random() - 0.5) * 16,
      y: y + (Math.random() - 0.5) * 16,
      vx: Math.cos(angle) * speed * (0.5 + Math.random()),
      vy: Math.sin(angle) * speed - (2 + Math.random() * 3),
      w,
      h: 8 + Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 0,
      maxLife: 70 + Math.random() * 40,
      shape: Math.random() < 0.3 ? "circle" : "rect",
    });
  }
}

function frame(): void {
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life++;
    if (p.life > p.maxLife || p.y > window.innerHeight + 30) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += 0.22; // gravity
    p.vx *= 0.985; // drag
    p.vy *= 0.985;
    p.rot += p.vr;
    p.x += p.vx;
    p.y += p.vy;
    const fade = Math.max(0, 1 - (p.life / p.maxLife) ** 1.4);
    ctx.globalAlpha = fade;
    ctx.fillStyle = p.color;
    if (p.shape === "circle") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  if (particles.length > 0) {
    void requestAnimationFrame(frame);
  } else {
    running = false;
    if (canvas) canvas.style.display = "none";
  }
}

function start(): void {
  if (!ensureCanvas() || !canvas) return;
  canvas.style.display = "block";
  if (!running) {
    running = true;
    void requestAnimationFrame(frame);
  }
}

/** Confetti burst from a point (e.g. over a widget that got a correct answer). */
export function confettiBurst(
  x: number,
  y: number,
  opts?: { count?: number; colors?: string[]; power?: number },
): void {
  if (!ensureCanvas()) return;
  spawnBurst(x, y, opts?.count ?? 60, opts?.colors ?? CONFETTI_COLORS, { power: opts?.power ?? 11 });
  start();
}

/** Small pop for a single correct answer — lighter than a full burst. */
export function confettiPop(
  x: number,
  y: number,
  colors?: string[],
): void {
  if (!ensureCanvas()) return;
  spawnBurst(x, y, 22, colors ?? CONFETTI_COLORS, { power: 6 });
  start();
}

/** Full-screen multi-burst celebration (task complete / level up). */
export function confettiCelebrate(count = 5): void {
  if (!ensureCanvas()) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Bottom corners + center-top, a few staggered waves.
  for (let wave = 0; wave < 3; wave++) {
    const cx = [w * 0.2, w * 0.8, w * 0.5, w * 0.95, w * 0.05];
    const cy = [h * 0.85, h * 0.8, h * 0.35, h * 0.9, h * 0.9];
    for (let i = 0; i < count; i++) {
      const t = wave * 140 + i * 90;
      setTimeout(() => {
        spawnBurst(cx[i % cx.length], cy[i % cy.length], 34, CONFETTI_COLORS, {
          spread: Math.PI * 2,
          power: 12,
        });
        start();
      }, t);
    }
  }
}

/** Gentle full-screen confetti rain for a fixed duration. */
export function confettiRain(durationMs = 1200): void {
  if (!ensureCanvas()) return;
  const w = window.innerWidth;
  const startTime = performance.now();
  const tick = () => {
    if (!running || performance.now() - startTime > durationMs) return;
    for (let i = 0; i < 2; i++) {
      spawnBurst(Math.random() * w, -10, 3, CONFETTI_COLORS, { spread: Math.PI, power: 4 });
    }
    start();
    requestAnimationFrame(tick);
  };
  start();
  requestAnimationFrame(tick);
}

/** Immediately clear any in-flight confetti. */
export function stopConfetti(): void {
  particles = [];
  if (canvas) canvas.style.display = "none";
}
