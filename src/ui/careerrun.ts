// "Career Run": Mario-style side-scrolling platformer through the real Halcyon hiring pipeline.
// Vanilla JS + single <canvas> for gameplay, DOM glass cards for HUD/dialogs/meters, procedural offscreen sprites,
// fixed-timestep 60fps loop, object pools (zero allocations in loop), and live shared-state write-back to store.ts.
import { db, save, me, signIn, clampNpc } from "./store.ts";
import { ui, esc, ic, avatar, pct, sgn, toast, render } from "./ui.ts";
import { CITIES, PERSONAS, newWeek, newCareerRun, evalRun, lastRunFor, newPlay, type Cand, type CareerRunState } from "./sim.ts";
import { mine, status } from "./candidate.ts";

// ---------- Constants & Palettes ----------
const TILE = 40;
const DT = 1 / 60;
const GRAVITY = 0.62;
const MAX_FALL = 14;
const MOVE_ACC = 0.75;
const MAX_SPEED = 5.4;
const JUMP_FORCE = -13.2;
const DOUBLE_JUMP_FORCE = -11.4;
const COYOTE_FRAMES = 8;
const BUFFER_FRAMES = 8;

export interface WorldPalette {
  id: number;
  name: string;
  sub: string;
  intro: string;
  sky: [string, string, string];
  far: string;
  mid: string;
  fore: string;
  ground: string;
  groundTop: string;
  accent: string;
  warn: string;
}

export const WORLDS: WorldPalette[] = [
  {
    id: 0, name: "Halcyon Career Hub", sub: "Overworld Network",
    intro: "Walk the glowing hiring pipeline. Every branch updates your real application on the Recruiter's desk.",
    sky: ["#060916", "#0f1738", "#1d2252"], far: "#141c42", mid: "#1f295c", fore: "#2b3878",
    ground: "#1d2447", groundTop: "#8b6cf0", accent: "#3ddc97", warn: "#ff6b7d",
  },
  {
    id: 1, name: "1 · Job Board Plains", sub: "Stage 1 · Apply",
    intro: "8,400 applications arrive in 48 hours — jump onto matching job posts, collect ATS keywords, and dodge clickbait pits.",
    sky: ["#0b1026", "#1d1b4b", "#3b245e"], far: "#16193b", mid: "#2c2559", fore: "#f2a65a",
    ground: "#231f46", groundTop: "#3ddc97", accent: "#8b6cf0", warn: "#ff5d70",
  },
  {
    id: 2, name: "2 · Screening Caves", sub: "Stage 2 · Recruiter Screen",
    intro: "Inside the screening queue: honest answers open doors, inflated claims spring traps, and a person checks uncertain IDs.",
    sky: ["#050c18", "#0a2239", "#0f384c"], far: "#0d2b3e", mid: "#123e52", fore: "#2dd4bf",
    ground: "#0d2636", groundTop: "#2dd4bf", accent: "#f2b84b", warn: "#ff5d70",
  },
  {
    id: 3, name: "3 · Interview Castle", sub: "Stage 3 · HR, Tech & Panel",
    intro: "Three floors of the citadel test the skills you built. Fire STAR stories and win over the three-interviewer panel.",
    sky: ["#0c091e", "#1b1438", "#2d1f4e"], far: "#181130", mid: "#282048", fore: "#f2b84b",
    ground: "#221a3f", groundTop: "#f2b84b", accent: "#ff8c42", warn: "#ff5d70",
  },
  {
    id: 4, name: "4 · Offer Summit", sub: "Stage 4 · Negotiation",
    intro: "Climb the offer staircase before the deadline expires. Use market data to see true pay and make your final call.",
    sky: ["#0d0b26", "#3c1d5c", "#8c2d56"], far: "#1a1236", mid: "#2e1a47", fore: "#ffd66b",
    ground: "#28173d", groundTop: "#ffd66b", accent: "#3ddc97", warn: "#ff5d70",
  },
  {
    id: 5, name: "5 · Results Pavilion", sub: "Stage 5 · Final Outcome",
    intro: "Your journey through the pipeline is complete. See every branch you took and what changed in your real application.",
    sky: ["#090c1a", "#171d3b", "#2a1f5d"], far: "#131836", mid: "#1e2552", fore: "#8b6cf0",
    ground: "#171d3b", groundTop: "#3ddc97", accent: "#4da6ff", warn: "#f2b84b",
  },
];

// ---------- Ensure Candidate & CareerRun State ----------
export function ensureCand(): Cand {
  const m = me();
  let c = mine();
  if (!c) {
    const base = PERSONAS[0];
    c = {
      ...base,
      city: 0,
      id: m?.id ?? "cand_demo",
      name: m?.name ?? base.name,
      appliedAt: Date.now(),
    };
    c.week = newWeek(c);
    c.careerRun = newCareerRun("picker");
    db.cands.push(c);
    save();
  }
  if (!c.careerRun) {
    c.careerRun = newCareerRun("picker");
    save();
  }
  return c;
}

// Live write-back helper: syncs Cand + CareerRunState to db.last and saves to localStorage so Recruiter tabs update live.
export function syncToRecruiter(c: Cand, stageOverride?: "screened" | "offers" | "held") {
  const cr = c.careerRun!;
  // Sync candidate week meters too so "My Week" stays cohesive
  if (!c.week) c.week = newWeek(c);
  c.week.m.energy = Math.max(0, Math.min(100, cr.m.stamina));
  c.week.m.hope = Math.max(0, Math.min(100, cr.m.skills));
  c.week.m.faith = Math.max(0, Math.min(100, Math.round((cr.m.trust + cr.m.fairness) / 2)));

  const lim = Object.values(db.plays).at(-1)?.lim ?? newPlay(db.scenario).lim;
  const stg = stageOverride ?? (cr.offer.status === "accepted" || cr.offer.status === "negotiated" ? "offers" : db.last?.stage ?? "screened");
  db.last = lastRunFor(db.scenario, db.cands, lim, stg);
  if (cr.offer.status === "accepted" || cr.offer.status === "negotiated" || cr.interview.score >= 70) {
    if (!db.last.shortlist.includes(c.id)) db.last.shortlist.push(c.id);
    db.last.review = db.last.review.filter(id => id !== c.id);
  }
  save();
}

// ---------- Synthesized WebAudio SFX (muted by default, zero audio files) ----------
let audioMuted = true;
let audioCtx: AudioContext | null = null;
function tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.06, slide = 0, delay = 0) {
  if (audioMuted) return;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!audioCtx && AC) audioCtx = new AC();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  } catch { /* ignore audio errors */ }
}

export const sfx = {
  jump: () => tone(290, 0.13, "sine", 0.055, 220),
  doubleJump: () => { tone(420, 0.1, "triangle", 0.06, 260); tone(660, 0.12, "sine", 0.05, 180, 0.05); },
  coin: () => { tone(880, 0.07, "sine", 0.05); tone(1318.5, 0.18, "triangle", 0.055, 0, 0.06); },
  powerup: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.11, "triangle", 0.055, 40, i * 0.06)); },
  stomp: () => tone(220, 0.14, "triangle", 0.07, -130),
  hit: () => { tone(180, 0.2, "sawtooth", 0.06, -110); tone(120, 0.25, "sawtooth", 0.05, -60, 0.1); },
  door: () => { tone(440, 0.1, "sine", 0.05, 110); tone(554, 0.16, "triangle", 0.055, 160, 0.08); },
  bossHit: () => { tone(150, 0.12, "square", 0.07, 90); tone(310, 0.18, "triangle", 0.06, -120, 0.06); },
  win: () => { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.22, "triangle", 0.065, 0, i * 0.11)); },
};

// ---------- Pre-Allocated Object Pools (No allocations in RAF loop) ----------
interface Particle {
  active: boolean;
  x: number; y: number; vx: number; vy: number;
  size: number; alpha: number; life: number; maxLife: number;
  color: string; kind: "dust" | "spark" | "confetti" | "glow";
}
interface FloatText {
  active: boolean;
  x: number; y: number; vy: number;
  text: string; color: string; life: number; maxLife: number;
}
interface Enemy {
  active: boolean;
  x: number; y: number; w: number; h: number;
  vx: number; vy: number; minX: number; maxX: number;
  kind: "bot" | "ghost" | "drone";
  label: string; squashT: number;
}
interface Orb {
  active: boolean;
  x: number; y: number; vx: number; vy: number;
  r: number; keyword: string; friendly: boolean; life: number;
}

const MAX_PARTICLES = 140;
const PARTICLES: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
  active: false, x: 0, y: 0, vx: 0, vy: 0, size: 4, alpha: 1, life: 0, maxLife: 30, color: "#fff", kind: "dust",
}));

const MAX_FLOATS = 32;
const FLOATS: FloatText[] = Array.from({ length: MAX_FLOATS }, () => ({
  active: false, x: 0, y: 0, vy: -1, text: "", color: "#3ddc97", life: 0, maxLife: 45,
}));

const MAX_ENEMIES = 28;
const ENEMIES: Enemy[] = Array.from({ length: MAX_ENEMIES }, () => ({
  active: false, x: 0, y: 0, w: 34, h: 34, vx: -1.2, vy: 0, minX: 0, maxX: 400, kind: "bot", label: "Bias Bot", squashT: 0,
}));

const MAX_ORBS = 18;
const ORBS: Orb[] = Array.from({ length: MAX_ORBS }, () => ({
  active: false, x: 0, y: 0, vx: 0, vy: 0, r: 14, keyword: "WMS", friendly: true, life: 0,
}));

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

function spawnParticle(x: number, y: number, vx: number, vy: number, color: string, size = 4, maxLife = 28, kind: Particle["kind"] = "dust") {
  if (reduceMotion.matches && kind !== "spark") return;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = PARTICLES[i];
    if (!p.active) {
      p.active = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
      p.color = color; p.size = size; p.life = 0; p.maxLife = maxLife; p.alpha = 1; p.kind = kind;
      return;
    }
  }
}

function spawnBurst(x: number, y: number, color: string, count = 10, kind: Particle["kind"] = "spark") {
  const n = reduceMotion.matches ? Math.min(3, count) : count;
  for (let i = 0; i < n; i++) {
    const ang = (Math.PI * 2 * i) / n + (i * 0.37);
    const spd = 1.6 + (i % 3) * 1.1;
    spawnParticle(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd - 0.8, color, 4 + (i % 3), 24 + (i % 12), kind);
  }
}

function spawnConfetti(x: number, y: number) {
  const cols = ["#3ddc97", "#8b6cf0", "#4da6ff", "#f2b84b", "#ff6b7d"];
  const n = reduceMotion.matches ? 8 : 36;
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI * 0.85 + (Math.PI * 0.7 * i) / n;
    const spd = 3 + (i % 5) * 1.3;
    spawnParticle(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd - 2, cols[i % cols.length], 6, 55 + (i % 25), "confetti");
  }
}

function spawnFloat(x: number, y: number, text: string, color = "#3ddc97") {
  for (let i = 0; i < MAX_FLOATS; i++) {
    const f = FLOATS[i];
    if (!f.active) {
      f.active = true; f.x = x; f.y = y; f.vy = -1.35; f.text = text; f.color = color; f.life = 0; f.maxLife = 48;
      return;
    }
  }
}

// ---------- Procedural Offscreen Sprite & Layer Cache ----------
interface SpriteBank {
  ready: boolean;
  tiles: Record<string, HTMLCanvasElement>;
  glows: Record<string, HTMLCanvasElement>;
  parallax: Record<number, HTMLCanvasElement[]>;
}

const bank: SpriteBank = { ready: false, tiles: {}, glows: {}, parallax: {} };

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function buildSprites() {
  if (bank.ready) return;
  bank.ready = true;

  // Pre-render radial glow sprites (faked bloom with zero runtime blur cost)
  const glowColors: [string, string][] = [
    ["violet", "rgba(139,108,240,0.48)"],
    ["mint", "rgba(61,220,151,0.45)"],
    ["gold", "rgba(242,184,75,0.48)"],
    ["blue", "rgba(77,166,255,0.45)"],
    ["coral", "rgba(255,93,112,0.48)"],
  ];
  for (const [k, col] of glowColors) {
    const cv = makeCanvas(96, 96), g = cv.getContext("2d")!;
    const gr = g.createRadialGradient(48, 48, 4, 48, 48, 46);
    gr.addColorStop(0, col);
    gr.addColorStop(0.55, col.replace(/0\.\d+\)/, "0.14)"));
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 96, 96);
    bank.glows[k] = cv;
  }

  // Pre-render tiles for each world + shared special blocks
  for (const w of WORLDS) {
    // Ground tile '#'
    const gt = makeCanvas(TILE, TILE), gg = gt.getContext("2d")!;
    gg.fillStyle = w.ground;
    roundRectPath(gg, 1, 1, TILE - 2, TILE - 2, 6);
    gg.fill();
    gg.fillStyle = w.groundTop;
    roundRectPath(gg, 2, 2, TILE - 4, 7, 4);
    gg.fill();
    gg.strokeStyle = "rgba(255,255,255,0.12)";
    gg.lineWidth = 1;
    gg.strokeRect(2, 2, TILE - 4, TILE - 4);
    gg.fillStyle = "rgba(255,255,255,0.06)";
    gg.fillRect(7, 15, 10, 5);
    gg.fillRect(23, 25, 10, 5);
    bank.tiles["#_" + w.id] = gt;

    // Platform '='
    const pt = makeCanvas(TILE, TILE), pg = pt.getContext("2d")!;
    const pgr = pg.createLinearGradient(0, 0, 0, 18);
    pgr.addColorStop(0, "rgba(255,255,255,0.22)");
    pgr.addColorStop(1, w.mid);
    pg.fillStyle = pgr;
    roundRectPath(pg, 1, 2, TILE - 2, 16, 6);
    pg.fill();
    pg.fillStyle = w.accent;
    pg.fillRect(4, 2, TILE - 8, 3);
    pg.strokeStyle = "rgba(255,255,255,0.28)";
    pg.stroke();
    bank.tiles["=_" + w.id] = pt;

    // 4-Layer Parallax Cached Canvases per World (Width 960, Height 480)
    const PW = 960, PH = 480;
    const layers: HTMLCanvasElement[] = [];

    // Layer 0: Gradient Sky + Soft Light Shafts + Stars
    const l0 = makeCanvas(PW, PH), g0 = l0.getContext("2d")!;
    const skyG = g0.createLinearGradient(0, 0, 0, PH);
    skyG.addColorStop(0, w.sky[0]);
    skyG.addColorStop(0.58, w.sky[1]);
    skyG.addColorStop(1, w.sky[2]);
    g0.fillStyle = skyG;
    g0.fillRect(0, 0, PW, PH);
    // Subtle diagonal light shafts
    g0.save();
    for (let i = 0; i < 4; i++) {
      const lx = 120 + i * 240;
      const lg = g0.createLinearGradient(lx, 0, lx + 90, PH);
      lg.addColorStop(0, "rgba(255,255,255,0.06)");
      lg.addColorStop(1, "rgba(255,255,255,0)");
      g0.fillStyle = lg;
      g0.beginPath();
      g0.moveTo(lx, 0); g0.lineTo(lx + 75, 0); g0.lineTo(lx + 195, PH); g0.lineTo(lx + 110, PH);
      g0.closePath();
      g0.fill();
    }
    g0.restore();
    // Stars / atmospheric motes
    g0.fillStyle = "rgba(255,255,255,0.45)";
    for (let i = 0; i < 36; i++) {
      const sx = (i * 97 + w.id * 31) % PW;
      const sy = (i * 53 + w.id * 19) % 240;
      g0.beginPath();
      g0.arc(sx, sy, (i % 3 === 0) ? 1.8 : 1.1, 0, Math.PI * 2);
      g0.fill();
    }
    layers.push(l0);

    // Layer 1: Distant Silhouettes & Slow Clouds
    const l1 = makeCanvas(PW, PH), g1 = l1.getContext("2d")!;
    g1.fillStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i < 6; i++) {
      const cx = i * 165 + 40, cy = 72 + (i % 3) * 32;
      roundRectPath(g1, cx, cy, 96, 22, 11);
      g1.fill();
      g1.beginPath();
      g1.arc(cx + 28, cy, 18, 0, Math.PI * 2);
      g1.arc(cx + 62, cy - 4, 22, 0, Math.PI * 2);
      g1.fill();
    }
    g1.fillStyle = w.far;
    for (let i = 0; i < 8; i++) {
      const bx = i * 120;
      const bh = 110 + ((i * 47 + w.id * 23) % 110);
      if (w.id === 1 || w.id === 0) {
        // Dawn city towers & store silhouettes
        roundRectPath(g1, bx + 6, PH - bh - 60, 98, bh + 60, 8);
        g1.fill();
      } else if (w.id === 2) {
        // Bioluminescent cave stalactites & arches
        g1.beginPath();
        g1.moveTo(bx, 0); g1.lineTo(bx + 60, bh * 0.75); g1.lineTo(bx + 120, 0);
        g1.fill();
        g1.beginPath();
        g1.moveTo(bx, PH); g1.lineTo(bx + 60, PH - bh); g1.lineTo(bx + 120, PH);
        g1.fill();
      } else if (w.id === 3) {
        // Citadel towers & arches
        g1.fillRect(bx + 12, PH - bh - 70, 84, bh + 70);
        g1.beginPath();
        g1.moveTo(bx + 6, PH - bh - 70); g1.lineTo(bx + 54, PH - bh - 115); g1.lineTo(bx + 102, PH - bh - 70);
        g1.fill();
      } else {
        // Summit peaks
        g1.beginPath();
        g1.moveTo(bx - 30, PH); g1.lineTo(bx + 65, PH - bh - 80); g1.lineTo(bx + 160, PH);
        g1.fill();
      }
    }
    layers.push(l1);

    // Layer 2: Midground Neon-Glass Structures
    const l2 = makeCanvas(PW, PH), g2 = l2.getContext("2d")!;
    g2.fillStyle = w.mid;
    for (let i = 0; i < 6; i++) {
      const mx = i * 160 + 18;
      const mh = 80 + ((i * 37 + w.id * 13) % 75);
      roundRectPath(g2, mx, PH - mh - 50, 118, mh + 50, 10);
      g2.fill();
      g2.strokeStyle = "rgba(255,255,255,0.08)";
      g2.stroke();
      // Window lights in accent color
      g2.fillStyle = w.accent;
      g2.globalAlpha = 0.28;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          g2.fillRect(mx + 18 + c * 30, PH - mh - 28 + r * 22, 16, 8);
        }
      }
      g2.globalAlpha = 1;
      g2.fillStyle = w.mid;
    }
    layers.push(l2);

    // Layer 3: Foreground Atmospheric Silhouettes & Rim Highlights
    const l3 = makeCanvas(PW, PH), g3 = l3.getContext("2d")!;
    g3.strokeStyle = w.fore;
    g3.globalAlpha = 0.22;
    g3.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const fx = i * 192 + 24;
      g3.beginPath();
      g3.arc(fx + 40, PH - 36, 48, Math.PI, 0);
      g3.stroke();
    }
    g3.globalAlpha = 1;
    layers.push(l3);

    bank.parallax[w.id] = layers;
  }

  // Shared special tiles:
  // 'B' Brick / Glass Block
  const bt = makeCanvas(TILE, TILE), bg = bt.getContext("2d")!;
  bg.fillStyle = "#262d5e";
  roundRectPath(bg, 2, 2, TILE - 4, TILE - 4, 7);
  bg.fill();
  bg.strokeStyle = "rgba(167,139,250,0.45)";
  bg.lineWidth = 1.5;
  bg.stroke();
  bg.fillStyle = "rgba(255,255,255,0.12)";
  bg.fillRect(6, 6, TILE - 12, 5);
  bank.tiles["B"] = bt;

  // '?' Power-Up Block (Keyword / Resume / STAR)
  const qt = makeCanvas(TILE, TILE), qg = qt.getContext("2d")!;
  const qgr = qg.createLinearGradient(0, 0, TILE, TILE);
  qgr.addColorStop(0, "#f2b84b");
  qgr.addColorStop(1, "#d97724");
  qg.fillStyle = qgr;
  roundRectPath(qg, 2, 2, TILE - 4, TILE - 4, 8);
  qg.fill();
  qg.strokeStyle = "rgba(255,255,255,0.65)";
  qg.lineWidth = 1.5;
  qg.stroke();
  qg.fillStyle = "#1b1406";
  qg.font = "700 22px Poppins, system-ui, sans-serif";
  qg.textAlign = "center";
  qg.textBaseline = "middle";
  qg.fillText("?", TILE / 2, TILE / 2 + 1);
  bank.tiles["?"] = qt;

  // 'x' Used Block
  const xt = makeCanvas(TILE, TILE), xg = xt.getContext("2d")!;
  xg.fillStyle = "#1a1f3d";
  roundRectPath(xg, 3, 3, TILE - 6, TILE - 6, 7);
  xg.fill();
  xg.strokeStyle = "rgba(255,255,255,0.15)";
  xg.stroke();
  bank.tiles["x"] = xt;

  // 'P' Warp Pipe
  const ppt = makeCanvas(TILE, TILE), ppg = ppt.getContext("2d")!;
  const ppgr = ppg.createLinearGradient(0, 0, TILE, 0);
  ppgr.addColorStop(0, "#199473");
  ppgr.addColorStop(0.35, "#3ddc97");
  ppgr.addColorStop(1, "#0f5e48");
  ppg.fillStyle = ppgr;
  roundRectPath(ppg, 2, 0, TILE - 4, TILE, 4);
  ppg.fill();
  ppg.fillStyle = "rgba(255,255,255,0.3)";
  ppg.fillRect(8, 2, 5, TILE - 4);
  bank.tiles["P"] = ppt;

  // '^' Bounce Pad (Launch Spring)
  const bpt = makeCanvas(TILE, TILE), bpg = bpt.getContext("2d")!;
  bpg.fillStyle = "#1a2040";
  roundRectPath(bpg, 4, 24, TILE - 8, 14, 4);
  bpg.fill();
  bpg.strokeStyle = "#3ddc97";
  bpg.lineWidth = 2;
  bpg.beginPath();
  bpg.moveTo(10, 24); bpg.lineTo(16, 15); bpg.lineTo(24, 24); bpg.lineTo(30, 15);
  bpg.stroke();
  const bpgr = bpg.createLinearGradient(0, 8, TILE, 16);
  bpgr.addColorStop(0, "#3ddc97");
  bpgr.addColorStop(1, "#f2b84b");
  bpg.fillStyle = bpgr;
  roundRectPath(bpg, 2, 8, TILE - 4, 9, 4);
  bpg.fill();
  bank.tiles["^"] = bpt;
}

// ---------- Level 1 Blueprint & Interactive Entities ----------
export interface JobPost {
  id: string;
  col: number;
  row: number;
  wCols: number;
  title: string;
  sub: string;
  fit: boolean; // true = matching job post platform, false = wrong-fit pit warning
  applied: boolean;
  keyword?: string;
}

export interface NpcDef {
  id: string;
  name: string;
  role: string;
  col: number;
  row: number;
  prompt: string;
  options: {
    key: string;
    label: string;
    reply: string;
    fx: { trust?: number; skills?: number; fairness?: number; stamina?: number };
    npc?: { meera?: number; anil?: number };
  }[];
}

export interface ChoiceOption {
  key: string;
  label: string;
  route: "high" | "pipe" | "low";
  routeName: string;
  desc: string;
  preview: { trust: number; skills: number; fairness: number; time: string };
  set?: Partial<Pick<Cand, "availableDay" | "id_check" | "distanceKm">>;
}

export interface ChoiceGateDef {
  id: string;
  level: number;
  col: number;
  row: number;
  title: string;
  prompt: string;
  options: ChoiceOption[];
}

export interface BadgePickup {
  idx: number;
  col: number;
  row: number;
  label: string;
  secret?: boolean;
  collected: boolean;
}

export interface PowerBlock {
  col: number;
  row: number;
  kind: "resume" | "keyword" | "coin";
  label: string;
  used: boolean;
}

// Level 1: 112 columns x 12 rows (4480px wide x 480px tall)
// Rows 0..11. Ground is at rows 10..11, with pits for wrong-fit job posts and branching paths after col 62!
const L1_ROWS = 12;
const L1_COLS = 112;

export const L1_NPCS: NpcDef[] = [
  {
    id: "rhea_l1",
    name: "Rhea Verma",
    role: "Fellow Applicant",
    col: 21,
    row: 9,
    prompt: "Hey! 8,400 of us are applying for 600 festival spots. Some job posts are clickbait traps. How are you picking where to apply?",
    options: [
      {
        key: "share",
        label: "Share my matched store list so we both avoid the clickbait pits",
        reply: "Thank you! Look out for the glowing emerald platforms — those match our real shift skills.",
        fx: { trust: 6, fairness: 5, skills: 4 },
      },
      {
        key: "verify",
        label: "Check the store distance and shift start day before jumping",
        reply: "Smart move. The screening agent ranks Day 1-2 availability first and never penalizes career gaps.",
        fx: { skills: 7, trust: 3 },
      },
      {
        key: "rush",
        label: "No time to talk — I am blasting every button I see!",
        reply: "Careful! Wrong-fit posts drop straight into a rejection pit.",
        fx: { trust: -4, stamina: 5 },
      },
    ],
  },
  {
    id: "anil_l1",
    name: "Dr. Anil Rao",
    role: "HR Lead · Gate Checkpoint",
    col: 54,
    row: 9,
    prompt: "Welcome to the ATS pre-check. People worry that a work gap or a blurry ID will get them auto-rejected by our AI.",
    options: [
      {
        key: "honest_gap",
        label: "Include an honest note on my work break and verify my ID photo",
        reply: "Exactly right. Governance Rule 3 bars the agent from rejecting on work gaps, and a clear ID skips the review backlog.",
        fx: { trust: 8, fairness: 6, skills: 5 },
        npc: { anil: 6 },
      },
      {
        key: "ask_fair",
        label: "Ask how the four-fifths fairness guardrail protects outer pin codes",
        reply: "We audit selection rates across gender and pin-code groups every run. If the ratio drops below 0.80, offers are blocked.",
        fx: { fairness: 8, trust: 5 },
        npc: { anil: 5 },
      },
      {
        key: "game_keywords",
        label: "Ask which secret buzzwords trick the ATS into ranking me #1",
        reply: "Stuffing fake keywords might pass a naive filter, but a human recruiter reviews every shortlist before any offer goes out.",
        fx: { trust: -6, skills: 4 },
        npc: { anil: -5 },
      },
    ],
  },
];

export const L1_CHOICE: ChoiceGateDef = {
  id: "l1_apply_route",
  level: 1,
  col: 62,
  row: 9,
  title: "Stage 1 Choice · How do you submit your application?",
  prompt: "The ATS Gate lies ahead. Choose your application approach — each option previews its impact and opens a different physical path through the level.",
  options: [
    {
      key: "tailored",
      label: "Tailored & Honest Application (Skybridge Route)",
      route: "high",
      routeName: "High-Road Glass Skybridge",
      desc: "Match your true shift availability (Day 1), attach a clear ID, and climb the upper skybridge with a bonus Skills Badge.",
      preview: { trust: 12, skills: 10, fairness: 10, time: "−5s (Careful)" },
      set: { availableDay: 1, id_check: "ok" },
    },
    {
      key: "referral",
      label: "Store Worker Referral Pipe (Warp Route)",
      route: "pipe",
      routeName: "Express Referral Warp Pipe",
      desc: "Take the glowing warp pipe past the mid-level bots straight to the ATS Gate entrance.",
      preview: { trust: 5, skills: 0, fairness: -4, time: "+15s (Fast Warp)" },
      set: { availableDay: 2 },
    },
    {
      key: "blast",
      label: "Keyword-Stuffed Mass Blast (Lower Tunnel)",
      route: "low",
      routeName: "High-Volume Blast Tunnel",
      desc: "Blast 50 buzzwords through the lower tunnel. Gives extra raw skill points, but lowers recruiter trust and spawns extra filter bots.",
      preview: { trust: -10, skills: 15, fairness: -8, time: "+10s (Rushed)" },
      set: { id_check: "mismatch" },
    },
  ],
};

// ---------- Level 2: Screening Caves (Stage 2 · Recruiter Screen) ----------
export const L2_NPCS: NpcDef[] = [
  {
    id: "salma_l2",
    name: "Salma Sheikh",
    role: "Fellow Candidate · Screening Queue",
    col: 21,
    row: 9,
    prompt: "My phone camera blurred my Aadhaar card, and a bot flagged me! Should I re-upload a fake edit or ask for a human check?",
    options: [
      {
        key: "gate1_human",
        label: "Request Gate 1 Human Review — unclear IDs must be checked by a person",
        reply: "That worked! Governance Rule 1 routed my file to Dr. Anil's team instead of auto-rejecting me.",
        fx: { trust: 8, fairness: 8, skills: 4 },
      },
      {
        key: "explain_break",
        label: "Add a clear note explaining our caregiving gap honestly",
        reply: "Yes! Rule 3 says the screening agent can never reject anyone for a break in employment.",
        fx: { trust: 7, fairness: 6 },
      },
      {
        key: "hide_gap",
        label: "Stretch your past job dates so no one notices the gap",
        reply: "Uh oh — the verification gate cross-checks shift logs and springs a trap door!",
        fx: { trust: -8, skills: 4 },
      },
    ],
  },
  {
    id: "anil_l2",
    name: "Dr. Anil Rao",
    role: "Governance Lead · Gate 1 & 2",
    col: 54,
    row: 9,
    prompt: "Inside the Screening Caves, we run two hard guardrails: Gate 1 (Human ID Check) and Gate 2 (Four-Fifths Fairness Audit).",
    options: [
      {
        key: "verify_both",
        label: "Submit verified ID and support the 0.80 pin-code fairness check",
        reply: "Exemplary. Your file passes both gates cleanly and strengthens cohort fairness across all pin codes.",
        fx: { trust: 9, fairness: 9, skills: 5 },
        npc: { anil: 7 },
      },
      {
        key: "ask_speed",
        label: "Ask how human review avoids slowing down Day 1 hiring",
        reply: "Only uncertain IDs go to the human queue — clear applications move straight to interviews at full speed.",
        fx: { skills: 6, trust: 5 },
        npc: { anil: 5 },
      },
    ],
  },
];

export const L2_CHOICE: ChoiceGateDef = {
  id: "l2_route",
  level: 2,
  col: 62,
  row: 9,
  title: "Stage 2 Choice · How do you clear the Screening Assistant's ID & Gap Check?",
  prompt: "The Gatekeeper Bot is scanning for ID clarity and work history. Pick your screening strategy to open your route.",
  options: [
    {
      key: "honest_id",
      label: "Clarify ID & Explain Care Break Honestly (Crystal Bridge)",
      route: "high",
      routeName: "Upper Crystal Verification Bridge",
      desc: "Provide a crisp ID scan and an honest note on your 14-month care break. Opens the upper crystal bridge with a bonus Badge.",
      preview: { trust: 12, skills: 8, fairness: 12, time: "−5s (Verified)" },
      set: { id_check: "ok" },
    },
    {
      key: "escalate_human",
      label: "Invoke Gate 1 Human Recruiter Escalation (Warp Pipe)",
      route: "pipe",
      routeName: "Gate 1 Human Escalation Pipe",
      desc: "Route your file directly to a human recruiter via the teal warp pipe, bypassing the mid-cave Ghosted Specters.",
      preview: { trust: 8, skills: 4, fairness: 10, time: "+12s (Express)" },
      set: { id_check: "ok" },
    },
    {
      key: "inflate_exp",
      label: "Exaggerate Past Experience to Beat the Bot (Lower Cavern)",
      route: "low",
      routeName: "Inflated Claim Trap Cavern",
      desc: "Claim 5 years of fake lead experience. Boosts raw skill points, but triggers a trap door into the Ghosted Specter cavern.",
      preview: { trust: -12, skills: 14, fairness: -10, time: "+8s (Risky)" },
      set: { id_check: "unclear" },
    },
  ],
};

// ---------- Level 3: Interview Castle (Stage 3 · HR, Tech & Panel) ----------
export const L3_NPCS: NpcDef[] = [
  {
    id: "vikram_l3",
    name: "Vikram Patel",
    role: "Shift Lead · Practical Ops",
    col: 21,
    row: 9,
    prompt: "Welcome to Interview Castle! Floor 2 tests live warehouse ops, and Floor 3 is the 3-person Panel. Press Q or ★ STAR to fire structured examples!",
    options: [
      {
        key: "star_prep",
        label: "Practice a STAR story: Situation, Task, Action, and measurable Result",
        reply: "Spot on! A real example of how you kept pick accuracy at 99% during a rush wins over both HR and Ops.",
        fx: { skills: 9, trust: 7, fairness: 4 },
      },
      {
        key: "safety_first",
        label: "Emphasize cold-chain safety and scanner accuracy alongside speed",
        reply: "Meera loves that. Fast picking means nothing if fragile festival hampers get damaged.",
        fx: { trust: 8, skills: 6 },
        npc: { meera: 6 },
      },
    ],
  },
  {
    id: "meera_l3",
    name: "Meera Shah",
    role: "Store Operations · Panelist",
    col: 54,
    row: 9,
    prompt: "We have 600 festival spots to fill before Friday. When an aisle bottlenecks at 7 PM, how do you handle it on the floor?",
    options: [
      {
        key: "rebalance_aisle",
        label: "Flag the bottleneck on WMS, stage fast-moving SKUs, and help new pickers",
        reply: "That is real floor leadership. You just earned my green light for the Panel round!",
        fx: { skills: 10, trust: 9, fairness: 6 },
        npc: { meera: 8 },
      },
      {
        key: "solo_sprint",
        label: "Ignore everyone else and sprint to double my own pick count",
        reply: "Individual speed helps, but if the packing desk jams, the whole store misses dispatch.",
        fx: { skills: 7, trust: -4 },
        npc: { meera: -3 },
      },
    ],
  },
];

export const L3_CHOICE: ChoiceGateDef = {
  id: "l3_route",
  level: 3,
  col: 62,
  row: 9,
  title: "Stage 3 Choice · How do you tackle the Practical Ops Trial & Panel?",
  prompt: "The 3-Interviewer Panel (HR, Tech, Ops) awaits in the Citadel Arena. Choose how to demonstrate your capabilities.",
  options: [
    {
      key: "star_demo",
      label: "Live Safety & WMS Demo with STAR Stories (Citadel Lift)",
      route: "high",
      routeName: "Upper Citadel STAR Skybridge",
      desc: "Walk the panel through a structured STAR example and live scanner check on the upper citadel bridge.",
      preview: { trust: 12, skills: 14, fairness: 10, time: "−5s (Thorough)" },
    },
    {
      key: "peer_cosolve",
      label: "Co-Solve the Shift Bottleneck with Team Referral (Warp Pipe)",
      route: "pipe",
      routeName: "Team Sync Express Pipe",
      desc: "Partner with a fellow finalist to solve the floor bottleneck and warp straight to the Panel Podium.",
      preview: { trust: 10, skills: 8, fairness: 6, time: "+12s (Team Sync)" },
    },
    {
      key: "overtime_rush",
      label: "Promise Uncapped Overtime Speed & Skip Safety Check (Lower Hall)",
      route: "low",
      routeName: "High-Pressure Speed Gauntlet",
      desc: "Pledge 14-hour nonstop sprints through the lower hazard gauntlet. High raw skill score, but hurts stamina and fairness.",
      preview: { trust: -8, skills: 15, fairness: -12, time: "+8s (Burnout Risk)" },
    },
  ],
};

// ---------- Level 4: Offer Summit (Stage 4 · Negotiation & Offer Decision) ----------
export const L4_NPCS: NpcDef[] = [
  {
    id: "rhea_l4",
    name: "Rhea Verma",
    role: "Fellow Finalist · Summit Base",
    col: 21,
    row: 9,
    prompt: "We made it to Offer Summit! My initial offer is ₹185/hr, but the market benchmark platforms ahead show ₹205–₹215/hr for verified multi-skill pickers!",
    options: [
      {
        key: "share_benchmarks",
        label: "Compare our Market Data tokens so we both negotiate fair festival pay",
        reply: "Yes! With our Skills Badges and verified Day-1 start, we have real data to support ₹215/hr.",
        fx: { fairness: 10, trust: 7, skills: 6 },
      },
      {
        key: "check_terms",
        label: "Review shift differential and travel allowance before signing",
        reply: "Smart — checking the full breakdown prevents surprises on Day 1.",
        fx: { skills: 8, trust: 5 },
      },
    ],
  },
  {
    id: "meera_l4",
    name: "Meera Shah",
    role: "Hiring Manager · Offer Desk",
    col: 54,
    row: 9,
    prompt: "You cleared HR, Tech, and Ops with top marks! We have your standard ₹185/hr offer ready — or we can discuss a Lead Picker package.",
    options: [
      {
        key: "present_data",
        label: "Present my WMS badges, Day-1 readiness, and market rate benchmark",
        reply: "You came prepared! Let's step up to the Offer Decision Gate and lock in your Lead Picker package.",
        fx: { skills: 9, trust: 9, fairness: 8 },
        npc: { meera: 7, anil: 5 },
      },
      {
        key: "quick_sign",
        label: "Thank Meera and confirm immediate Day-1 shift start",
        reply: "Wonderful — having you on the floor Day 1 is a huge boost for our store.",
        fx: { trust: 8, stamina: 6 },
        npc: { meera: 6 },
      },
    ],
  },
];

export const L4_CHOICE: ChoiceGateDef = {
  id: "l4_route",
  level: 4,
  col: 62,
  row: 9,
  title: "Stage 4 Choice · The Offer Decision Gate (Base Offer: ₹185/hr)",
  prompt: "You stand at the Summit Decision Gate. Choose how to finalize your offer — this locks in your real compensation and role on the Recruiter's dashboard.",
  options: [
    {
      key: "negotiate",
      label: "Counter-Offer with Market Data & Badges → ₹215/hr (Summit Bridge)",
      route: "high",
      routeName: "High-Road Counter-Offer Bridge (₹215/hr)",
      desc: "Use your collected Skills Badges and Market Data tokens to secure ₹215/hr + Lead Picker Festival Track.",
      preview: { trust: 10, skills: 12, fairness: 12, time: "₹215/hr · Lead Role" },
    },
    {
      key: "accept_fast",
      label: "Accept Day-1 Festival Offer + Attendance Bonus → ₹195/hr (Warp Pipe)",
      route: "pipe",
      routeName: "Day-1 Express Acceptance Pipe (₹195/hr)",
      desc: "Lock in immediate Day-1 onboarding with a +₹10/hr fast-start bonus and warp to the Contract Seal.",
      preview: { trust: 12, skills: 6, fairness: 6, time: "₹195/hr · Day 1" },
    },
    {
      key: "walk_away",
      label: "Walk Away with Dignity for Closer Hub Fit (Lower Path)",
      route: "low",
      routeName: "Principled Walk-Away Path",
      desc: "Decline rigid shift terms and hold your application in priority reserve for the next neighborhood store cohort.",
      preview: { trust: 4, skills: 6, fairness: 15, time: "Held · Next Cohort" },
    },
  ],
};

// ---------- Level 5: Results Pavilion NPCs ----------
export const L5_NPCS: NpcDef[] = [
  {
    id: "anil_l5",
    name: "Dr. Anil Rao",
    role: "HR & Governance Lead · Pavilion",
    col: 18,
    row: 9,
    prompt: "Congratulations on completing Career Run! Every jump, badge, and ethical choice you made is now reflected in our live Hiring Map and Fairness Audit.",
    options: [
      {
        key: "celebrate_fair",
        label: "Review how human review and fairness gates protected every candidate",
        reply: "Together we proved that high-speed festival hiring and 0.80 fairness compliance can go hand in hand!",
        fx: { trust: 5, fairness: 5 },
        npc: { anil: 5 },
      },
    ],
  },
  {
    id: "meera_l5",
    name: "Meera Shah",
    role: "Store Operations Lead · Pavilion",
    col: 36,
    row: 9,
    prompt: "Welcome to the team! You can walk past your 4 Stage Monuments here, or use the Journey Tree below to replay any branch and test alternative outcomes.",
    options: [
      {
        key: "ready_day1",
        label: "Celebrate Day 1 readiness with the store operations crew!",
        reply: "See you on the floor! Switch to the Recruiter's Hiring Map anytime to see your live pin on the city map.",
        fx: { skills: 5, stamina: 5 },
        npc: { meera: 5 },
      },
    ],
  },
];

export const ALL_CHOICES: Record<number, ChoiceGateDef> = {
  1: L1_CHOICE,
  2: L2_CHOICE,
  3: L3_CHOICE,
  4: L4_CHOICE,
};

export function currentChoice(lvl: number): ChoiceGateDef {
  return ALL_CHOICES[lvl] ?? L1_CHOICE;
}

export function currentNpcs(lvl: number): NpcDef[] {
  if (lvl === 2) return L2_NPCS;
  if (lvl === 3) return L3_NPCS;
  if (lvl === 4) return L4_NPCS;
  if (lvl === 5) return L5_NPCS;
  return L1_NPCS;
}

export interface Mover {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  label: string;
}

// Runtime Game State (Single active instance, zero per-frame allocations)
interface GameRuntime {
  running: boolean;
  rafId: number;
  lastTs: number;
  acc: number;
  frame: number;
  // FPS counter
  fpsShow: boolean;
  fps: number;
  fpsFrames: number;
  fpsLastTs: number;
  frameMs: number;
  tilesDrawn: number;
  // Camera & Juice
  camX: number;
  camY: number;
  introPanT: number; // >0 while panning from boss to hero
  introCardOpen: boolean;
  shakeT: number;
  shakeMag: number;
  hitStop: number;
  checkpointCol: number;
  checkpointRow: number;
  // Combo & Streak
  combo: number;
  comboTimer: number;
  // Player physics
  px: number; py: number; pw: number; ph: number;
  vx: number; vy: number;
  facing: 1 | -1;
  onGround: boolean;
  coyote: number;
  jumpBuf: number;
  jumpsLeft: number;
  hasDoubleJump: boolean;
  hasResumeShield: boolean;
  invuln: number;
  squashX: number;
  squashY: number;
  walkCycle: number;
  pipeAnimT: number;
  starCooldown: number;
  // Hub map cursor
  hubNode: number;
  hubPlayerX: number;
  hubPlayerY: number;
  // Level dynamic state
  loadedLevel: number;
  cols: number;
  tiles: string[][];
  bumps: { r: number; c: number; t: number }[];
  posts: JobPost[];
  powerBlocks: PowerBlock[];
  badges: BadgePickup[];
  movers: Mover[];
  nearNpc: NpcDef | null;
  activeNpc: NpcDef | null;
  choiceModalOpen: boolean;
  previewChoiceKey: string;
  recapOpen: boolean;
  routeMapOpen: boolean;
  recruiterOpen: boolean;
  // Stage Boss state
  bossActive: boolean;
  bossHp: number;
  bossMaxHp: number;
  bossDefeated: boolean;
  bossLaserY: number;
  bossLaserDir: number;
  bossTimer: number;
  bossSwitchCol: number;
  bossSwitchRow: number;
  bossSwitchCooldown: number;
}

export const G: GameRuntime = {
  running: false, rafId: 0, lastTs: 0, acc: 0, frame: 0,
  fpsShow: true, fps: 60, fpsFrames: 0, fpsLastTs: 0, frameMs: 1.2, tilesDrawn: 0,
  camX: 0, camY: 0, introPanT: 0, introCardOpen: false,
  shakeT: 0, shakeMag: 0, hitStop: 0,
  checkpointCol: 3, checkpointRow: 8,
  combo: 1, comboTimer: 0,
  px: 120, py: 320, pw: 30, ph: 40,
  vx: 0, vy: 0, facing: 1, onGround: false,
  coyote: 0, jumpBuf: 0, jumpsLeft: 1,
  hasDoubleJump: false, hasResumeShield: false, invuln: 0,
  squashX: 1, squashY: 1, walkCycle: 0, pipeAnimT: 0, starCooldown: 0,
  hubNode: 1, hubPlayerX: 180, hubPlayerY: 250,
  loadedLevel: 0, cols: L1_COLS,
  tiles: [], bumps: [], posts: [], powerBlocks: [], badges: [], movers: [],
  nearNpc: null, activeNpc: null,
  choiceModalOpen: false, previewChoiceKey: "tailored",
  recapOpen: false, routeMapOpen: false, recruiterOpen: true,
  bossActive: false, bossHp: 3, bossMaxHp: 3, bossDefeated: false,
  bossLaserY: 220, bossLaserDir: 1, bossTimer: 0,
  bossSwitchCol: 88, bossSwitchRow: 9, bossSwitchCooldown: 0,
};

function resetPlayerAndCamera(c: Cand, lvl: number, startAtChoice: boolean) {
  const cr = c.careerRun!;
  const ch = currentChoice(lvl);
  G.loadedLevel = lvl;
  G.checkpointCol = startAtChoice ? ch.col - 2 : 3;
  G.checkpointRow = 8;
  G.px = G.checkpointCol * TILE;
  G.py = G.checkpointRow * TILE;
  G.vx = 0; G.vy = 0; G.facing = 1; G.onGround = false;
  G.hasDoubleJump = cr.keywords.length > 0 || lvl >= 2;
  G.hasResumeShield = false;
  G.invuln = 0;
  G.starCooldown = 0;
  G.combo = 1; G.comboTimer = 0;
  G.nearNpc = null; G.activeNpc = null;
  G.previewChoiceKey = ch.options[0].key;
  G.choiceModalOpen = startAtChoice;
  G.recapOpen = false;

  if (startAtChoice || lvl === 5) {
    G.camX = Math.max(0, G.px - 260);
    G.introPanT = 0;
    G.introCardOpen = lvl === 5 && !startAtChoice;
  } else {
    G.camX = 3300;
    G.introPanT = reduceMotion.matches ? 0 : 105;
    G.introCardOpen = true;
  }
}

// Build Level 1 tiles & entities cleanly
export function loadLevel1(c: Cand, startAtChoice = false) {
  const cr = c.careerRun!;
  G.cols = L1_COLS;
  // Initialize empty 12x112 grid
  const grid: string[][] = Array.from({ length: L1_ROWS }, () => Array.from({ length: L1_COLS }, () => " "));

  // Fill ground on rows 10 & 11, leaving wrong-fit pits at cols 15..17, 35..37, 49..51
  const pitCols = new Set([15, 16, 17, 35, 36, 37, 49, 50, 51]);
  for (let col = 0; col < L1_COLS; col++) {
    if (!pitCols.has(col)) {
      grid[10][col] = "#";
      grid[11][col] = "#";
    }
  }

  // Platforms, bricks & question blocks
  // Early platforms + Secret Bonus cloud alcove (cols 8..14, row 3)
  for (let col = 8; col <= 13; col++) grid[3][col] = "=";
  grid[6][7] = "="; grid[5][8] = "="; // stepping stones to secret bonus room

  // Question blocks & bricks
  grid[7][6] = "B"; grid[7][7] = "?"; grid[7][8] = "B";
  grid[6][25] = "B"; grid[6][26] = "?"; grid[6][27] = "B";
  grid[6][42] = "?";
  grid[6][57] = "B"; grid[6][58] = "?";

  // Mid-level Choice Gate at col 62 and Warp Pipe at col 64
  grid[8][64] = "P"; grid[9][64] = "P";

  // Branch routes between col 65 and col 83:
  const pickedRoute = cr.choices["l1_apply_route"]?.route;
  if (pickedRoute === "high") {
    for (let col = 65; col <= 82; col++) grid[5][col] = "=";
    grid[3][73] = "?";
  } else {
    grid[7][66] = "="; grid[6][68] = "=";
  }
  for (let col = 68; col <= 72; col++) grid[8][col] = "=";
  for (let col = 76; col <= 80; col++) grid[8][col] = "=";

  // Boss Arena platforms (cols 85..98)
  grid[7][87] = "="; grid[7][88] = "="; grid[7][89] = "=";
  grid[6][92] = "="; grid[6][93] = "=";

  // ATS Gate barrier at col 99 (opens when bossDefeated)
  for (let r = 4; r <= 9; r++) grid[r][99] = "G";

  // Checkpoint Flag at col 104
  for (let r = 4; r <= 9; r++) grid[r][104] = "F";

  G.tiles = grid;
  G.bumps = [];
  G.movers = [];

  // Matching Job Posts (glowing teal platforms) & Wrong-Fit Pits (coral trap warnings)
  G.posts = [
    { id: "picker_mum", col: 10, row: 7, wCols: 4, title: "Picker · Hub", sub: "Day 1 · 6 km", fit: true, applied: cr.appliedJobs.includes("Picker · Hub"), keyword: "Fast-Pick" },
    { id: "pit_unpaid", col: 15, row: 10, wCols: 3, title: "Unpaid 60h Trial", sub: "Wrong Fit Pit!", fit: false, applied: false },
    { id: "packer_s1", col: 28, row: 7, wCols: 4, title: "Packer · Shift A", sub: "Fair Quota", fit: true, applied: cr.appliedJobs.includes("Packer · Shift A"), keyword: "WMS-Scan" },
    { id: "pit_10yr", col: 35, row: 10, wCols: 3, title: "10yr Exp Entry", sub: "Clickbait Pit!", fit: false, applied: false },
    { id: "sorter_inv", col: 44, row: 7, wCols: 4, title: "Inventory · Day 2", sub: "Verified ID", fit: true, applied: cr.appliedJobs.includes("Inventory · Day 2"), keyword: "Safety-ID" },
    { id: "pit_ghost", col: 49, row: 10, wCols: 3, title: "Ghost Listing", sub: "Expired Pit!", fit: false, applied: false },
    { id: "express_rider", col: 71, row: 5, wCols: 4, title: "Lead Picker · Bonus", sub: "Skybridge Role", fit: true, applied: cr.appliedJobs.includes("Lead Picker · Bonus"), keyword: "Team-Sync" },
  ];
  for (const jp of G.posts) {
    if (jp.fit) {
      for (let dc = 0; dc < jp.wCols; dc++) G.tiles[jp.row][jp.col + dc] = "=";
    }
  }

  // Power-up '?' blocks
  G.powerBlocks = [
    { col: 7, row: 7, kind: "keyword", label: "Keyword: Double Jump!", used: false },
    { col: 26, row: 6, kind: "resume", label: "Resume Shield (+Stamina)", used: false },
    { col: 42, row: 6, kind: "keyword", label: "Keyword: Shift-Ready", used: false },
    { col: 58, row: 6, kind: "resume", label: "Resume Polish (+Trust)", used: false },
    { col: 73, row: 3, kind: "keyword", label: "Keyword: Zero-Defect", used: false },
  ];

  // 3 Collectible Skills Badges in Level 1
  const savedBadges = cr.badges[1] ?? [false, false, false];
  G.badges = [
    { idx: 0, col: 11, row: 2, label: "Secret Alcove Badge", secret: true, collected: !!savedBadges[0] },
    { idx: 1, col: 45, row: 5, label: "Scanner Mastery Badge", secret: false, collected: !!savedBadges[1] },
    { idx: 2, col: 74, row: 4, label: "Fair Route Badge", secret: false, collected: !!savedBadges[2] },
  ];

  // Populate pooled Enemies
  for (const e of ENEMIES) e.active = false;
  for (const o of ORBS) o.active = false;
  const enemyDefs: [number, number, number, number, Enemy["kind"], string][] = [
    [19, 9, 18 * TILE, 24 * TILE, "bot", "Spam Bot"],
    [39, 9, 38 * TILE, 47 * TILE, "bot", "Clickbait Bug"],
    [55, 9, 52 * TILE, 60 * TILE, "bot", "Auto-Filter"],
    [69, 9, 66 * TILE, 82 * TILE, "drone", "Buzzword Drone"],
    [77, 9, 67 * TILE, 83 * TILE, "bot", "Quota Bot"],
  ];
  enemyDefs.forEach(([col, row, minX, maxX, kind, label], i) => {
    const e = ENEMIES[i];
    e.active = true; e.x = col * TILE; e.y = row * TILE + 6; e.w = 34; e.h = 34;
    e.vx = i % 2 === 0 ? -1.35 : 1.35; e.vy = 0; e.minX = minX; e.maxX = maxX;
    e.kind = kind; e.label = label; e.squashT = 0;
  });

  // Reset Boss state
  G.bossActive = false; G.bossHp = 3; G.bossMaxHp = 3; G.bossDefeated = false;
  G.bossLaserY = 200; G.bossLaserDir = 1; G.bossTimer = 0;
  G.bossSwitchCol = 88; G.bossSwitchRow = 9; G.bossSwitchCooldown = 0;

  resetPlayerAndCamera(c, 1, startAtChoice);
}

// ---------- Level 2: Screening Caves (Bioluminescent Cavern, Moving Platforms, Verification Gates) ----------
export function loadLevel2(c: Cand, startAtChoice = false) {
  const cr = c.careerRun!;
  G.cols = L1_COLS;
  const grid: string[][] = Array.from({ length: L1_ROWS }, () => Array.from({ length: L1_COLS }, () => " "));

  // Cavern floor with Trap Chasms at cols 15..18, 33..37, 48..51
  const l1Choice = cr.choices["l1_apply_route"]?.picked;
  // Carry-forward from Stage 1: If player chose "tailored" or "referral" in Stage 1, chasm 33..37 is bridged!
  const pitCols = new Set([15, 16, 17, 18, 48, 49, 50, 51]);
  if (l1Choice !== "tailored" && l1Choice !== "referral") {
    [34, 35, 36].forEach(col => pitCols.add(col));
  }
  for (let col = 0; col < L1_COLS; col++) {
    if (!pitCols.has(col)) {
      grid[10][col] = "#";
      grid[11][col] = "#";
    }
  }

  // Secret upper crystal ledge (cols 9..14, row 3) + Bounce pad at col 7
  grid[9][7] = "^";
  for (let col = 9; col <= 14; col++) grid[3][col] = "=";

  // Question blocks & crystal bricks
  grid[6][12] = "?";
  grid[6][25] = "B"; grid[6][26] = "?"; grid[6][27] = "B";
  grid[6][42] = "?";
  grid[6][57] = "B"; grid[6][58] = "?";

  // Choice Gate Warp Pipe at col 64
  grid[8][64] = "P"; grid[9][64] = "P";

  // Branch routes (cols 65..82)
  const pickedRoute = cr.choices["l2_route"]?.route;
  if (pickedRoute === "high") {
    for (let col = 65; col <= 82; col++) grid[5][col] = "=";
    grid[3][73] = "?";
  } else {
    grid[7][66] = "="; grid[6][68] = "=";
  }
  for (let col = 68; col <= 72; col++) grid[8][col] = "=";
  for (let col = 76; col <= 80; col++) grid[8][col] = "=";

  // Gatekeeper Boss Arena (cols 85..98) with bounce pad & platforms
  grid[9][86] = "^";
  grid[7][87] = "="; grid[7][88] = "="; grid[7][89] = "=";
  grid[6][92] = "="; grid[6][93] = "=";

  for (let r = 4; r <= 9; r++) grid[r][99] = "G";
  for (let r = 4; r <= 9; r++) grid[r][104] = "F";

  G.tiles = grid;
  G.bumps = [];

  // Moving Verification Platforms in Level 2
  G.movers = [
    { x: 15 * TILE, y: 8 * TILE, w: 3 * TILE, h: 16, vx: 1.4, vy: 0, minX: 14 * TILE, maxX: 19 * TILE, minY: 8 * TILE, maxY: 8 * TILE, label: "ID Scan Slider" },
    { x: 48 * TILE, y: 7 * TILE, w: 3 * TILE, h: 16, vx: -1.5, vy: 0, minX: 47 * TILE, maxX: 52 * TILE, minY: 7 * TILE, maxY: 7 * TILE, label: "Fairness Lift" },
  ];

  // Verification Gates & Trap Pits
  G.posts = [
    { id: "gate1_id", col: 10, row: 7, wCols: 4, title: "Gate 1 · Clear ID", sub: "Human Checked", fit: true, applied: c.id_check === "ok", keyword: "ID-Verified" },
    { id: "pit_blur", col: 15, row: 10, wCols: 4, title: "Unverified Drop", sub: "Ride Moving Slider!", fit: false, applied: false },
    { id: "stage1_carry", col: 33, row: 8, wCols: 5, title: l1Choice === "tailored" ? "✓ Stage 1 Honest Bridge" : "Work-Gap Check", sub: "Rule 3 Protected", fit: true, applied: true, keyword: "Gap-Protected" },
    { id: "gate2_fair", col: 42, row: 7, wCols: 4, title: "Gate 2 · 0.80 Audit", sub: "Pin-Code Fair", fit: true, applied: false, keyword: "Fair-Cohort" },
    { id: "pit_ghost2", col: 48, row: 10, wCols: 4, title: "Auto-Ghost Chasm", sub: "Use Fairness Lift!", fit: false, applied: false },
    { id: "human_lane", col: 71, row: 5, wCols: 4, title: "Recruiter Fast-Track", sub: "Verified Shortlist", fit: true, applied: false, keyword: "Human-Cleared" },
  ];
  for (const jp of G.posts) {
    if (jp.fit) {
      for (let dc = 0; dc < jp.wCols; dc++) G.tiles[jp.row][jp.col + dc] = "=";
    }
  }

  G.powerBlocks = [
    { col: 12, row: 6, kind: "keyword", label: "Keyword: Gate-1-Pass", used: false },
    { col: 26, row: 6, kind: "resume", label: "ID Clarity Shield", used: false },
    { col: 42, row: 6, kind: "keyword", label: "Keyword: Four-Fifths", used: false },
    { col: 58, row: 6, kind: "resume", label: "Human Review Boost", used: false },
    { col: 73, row: 3, kind: "keyword", label: "Keyword: Audit-Ready", used: false },
  ];

  const savedBadges = cr.badges[2] ?? [false, false, false];
  G.badges = [
    { idx: 0, col: 11, row: 2, label: "Crystal Cavern Badge", secret: true, collected: !!savedBadges[0] },
    { idx: 1, col: 44, row: 5, label: "Gate 1 Governance Badge", secret: false, collected: !!savedBadges[1] },
    { idx: 2, col: 74, row: 4, label: "Fairness 0.80 Badge", secret: false, collected: !!savedBadges[2] },
  ];

  for (const e of ENEMIES) e.active = false;
  for (const o of ORBS) o.active = false;
  const enemyDefs: [number, number, number, number, Enemy["kind"], string][] = [
    [22, 9, 19 * TILE, 26 * TILE, "ghost", "Ghosted! Specter"],
    [39, 9, 37 * TILE, 46 * TILE, "bot", "ID Reject Bot"],
    [55, 9, 52 * TILE, 60 * TILE, "ghost", "Silence Wraith"],
    [69, 9, 66 * TILE, 82 * TILE, "drone", "Gap Filter Drone"],
    [77, 9, 67 * TILE, 83 * TILE, "ghost", "Queue Specter"],
  ];
  enemyDefs.forEach(([col, row, minX, maxX, kind, label], i) => {
    const e = ENEMIES[i];
    e.active = true; e.x = col * TILE; e.y = row * TILE + 6; e.w = 34; e.h = 34;
    e.vx = i % 2 === 0 ? -1.45 : 1.45; e.vy = 0; e.minX = minX; e.maxX = maxX;
    e.kind = kind; e.label = label; e.squashT = 0;
  });

  G.bossActive = false; G.bossHp = 3; G.bossMaxHp = 3; G.bossDefeated = false;
  G.bossLaserY = 210; G.bossLaserDir = 1; G.bossTimer = 0;
  G.bossSwitchCol = 88; G.bossSwitchRow = 9; G.bossSwitchCooldown = 0;

  resetPlayerAndCamera(c, 2, startAtChoice);
}

// ---------- Level 3: Interview Castle (3-Floor Citadel, Bounce Pads, STAR Projectiles, 3-Interviewer Panel Boss) ----------
export function loadLevel3(c: Cand, startAtChoice = false) {
  const cr = c.careerRun!;
  G.cols = L1_COLS;
  const grid: string[][] = Array.from({ length: L1_ROWS }, () => Array.from({ length: L1_COLS }, () => " "));

  const pitCols = new Set([16, 17, 18, 35, 36, 37, 50, 51]);
  for (let col = 0; col < L1_COLS; col++) {
    if (!pitCols.has(col)) {
      grid[10][col] = "#";
      grid[11][col] = "#";
    }
  }

  // Bounce pads ('^') to launch between Citadel floors!
  grid[9][8] = "^";
  grid[9][33] = "^";
  grid[9][65] = "^";
  grid[9][85] = "^";

  // Upper Citadel Floor 2 & 3 ledges
  for (let col = 9; col <= 14; col++) grid[3][col] = "=";
  for (let col = 22; col <= 26; col++) grid[5][col] = "=";
  for (let col = 38; col <= 43; col++) grid[4][col] = "=";

  grid[6][11] = "?";
  grid[6][25] = "B"; grid[6][26] = "?"; grid[6][27] = "B";
  grid[6][42] = "?";
  grid[6][57] = "B"; grid[6][58] = "?";

  // Choice Gate Warp Pipe at col 64
  grid[8][64] = "P"; grid[9][64] = "P";

  const pickedRoute = cr.choices["l3_route"]?.route;
  if (pickedRoute === "high") {
    for (let col = 65; col <= 82; col++) grid[5][col] = "=";
    grid[3][73] = "?";
  } else {
    grid[7][66] = "="; grid[6][68] = "=";
  }
  for (let col = 68; col <= 72; col++) grid[8][col] = "=";
  for (let col = 76; col <= 80; col++) grid[8][col] = "=";

  // Panel Boss Arena platforms
  grid[7][87] = "="; grid[7][88] = "="; grid[7][89] = "=";
  grid[5][91] = "="; grid[5][92] = "="; grid[5][93] = "=";

  for (let r = 4; r <= 9; r++) grid[r][99] = "G";
  for (let r = 4; r <= 9; r++) grid[r][104] = "F";

  G.tiles = grid;
  G.bumps = [];

  // Moving Citadel Lifts
  G.movers = [
    { x: 16 * TILE, y: 7 * TILE, w: 3 * TILE, h: 16, vx: 0, vy: 1.2, minX: 16 * TILE, maxX: 16 * TILE, minY: 4 * TILE, maxY: 8 * TILE, label: "Floor 2 Lift" },
    { x: 35 * TILE, y: 7 * TILE, w: 3 * TILE, h: 16, vx: 1.5, vy: 0, minX: 34 * TILE, maxX: 39 * TILE, minY: 7 * TILE, maxY: 7 * TILE, label: "Ops Trial Bridge" },
  ];

  G.posts = [
    { id: "hr_empathy", col: 10, row: 7, wCols: 4, title: "Floor 1 · HR Fit", sub: "Team & Reliability", fit: true, applied: cr.interview.hr, keyword: "STAR-Story" },
    { id: "pit_jargon", col: 16, row: 10, wCols: 3, title: "Buzzword Trap", sub: "Take Floor 2 Lift!", fit: false, applied: false },
    { id: "tech_wms", col: 28, row: 7, wCols: 4, title: "Floor 2 · WMS Trial", sub: "99.4% Pick Accuracy", fit: true, applied: cr.interview.tech, keyword: "WMS-Master" },
    { id: "pit_unsafe", col: 35, row: 10, wCols: 3, title: "Skipped Safety Pit", sub: "Jump Ops Bridge!", fit: false, applied: false },
    { id: "ops_coldchain", col: 44, row: 7, wCols: 4, title: "Cold-Chain Check", sub: "Zero Spoilage", fit: true, applied: false, keyword: "Cold-Chain" },
    { id: "panel_stage", col: 71, row: 5, wCols: 4, title: "Floor 3 · Panel Prep", sub: "HR + Tech + Ops", fit: true, applied: cr.interview.exec, keyword: "Panel-Ready" },
  ];
  for (const jp of G.posts) {
    if (jp.fit) {
      for (let dc = 0; dc < jp.wCols; dc++) G.tiles[jp.row][jp.col + dc] = "=";
    }
  }

  G.powerBlocks = [
    { col: 11, row: 6, kind: "keyword", label: "Keyword: STAR-Method", used: false },
    { col: 26, row: 6, kind: "resume", label: "Confidence Shield", used: false },
    { col: 42, row: 6, kind: "keyword", label: "Keyword: Floor-Safety", used: false },
    { col: 58, row: 6, kind: "resume", label: "Panel Calm (+Stamina)", used: false },
    { col: 73, row: 3, kind: "keyword", label: "Keyword: Shift-Leader", used: false },
  ];

  const savedBadges = cr.badges[3] ?? [false, false, false];
  G.badges = [
    { idx: 0, col: 11, row: 2, label: "Citadel Belfry Badge", secret: true, collected: !!savedBadges[0] },
    { idx: 1, col: 40, row: 3, label: "Ops Trial Gold Badge", secret: false, collected: !!savedBadges[1] },
    { idx: 2, col: 74, row: 4, label: "STAR Storyteller Badge", secret: false, collected: !!savedBadges[2] },
  ];

  for (const e of ENEMIES) e.active = false;
  for (const o of ORBS) o.active = false;
  const enemyDefs: [number, number, number, number, Enemy["kind"], string][] = [
    [20, 9, 19 * TILE, 26 * TILE, "drone", "Curveball Question"],
    [39, 9, 38 * TILE, 47 * TILE, "bot", "Stress Timer"],
    [55, 9, 52 * TILE, 60 * TILE, "drone", "Gotcha Prompt"],
    [69, 9, 66 * TILE, 82 * TILE, "bot", "Panel Skeptic"],
    [77, 9, 67 * TILE, 83 * TILE, "drone", "Rush Scenario"],
  ];
  enemyDefs.forEach(([col, row, minX, maxX, kind, label], i) => {
    const e = ENEMIES[i];
    e.active = true; e.x = col * TILE; e.y = row * TILE + 6; e.w = 34; e.h = 34;
    e.vx = i % 2 === 0 ? -1.5 : 1.5; e.vy = 0; e.minX = minX; e.maxX = maxX;
    e.kind = kind; e.label = label; e.squashT = 0;
  });

  G.bossActive = false; G.bossHp = 3; G.bossMaxHp = 3; G.bossDefeated = false;
  G.bossLaserY = 200; G.bossLaserDir = 1; G.bossTimer = 0;
  G.bossSwitchCol = 88; G.bossSwitchRow = 9; G.bossSwitchCooldown = 0;

  resetPlayerAndCamera(c, 3, startAtChoice);
}

// ---------- Level 4: Offer Summit (Golden-Hour Ascent, Cloud Lifts, Market Data, Final Offer Gate) ----------
export function loadLevel4(c: Cand, startAtChoice = false) {
  const cr = c.careerRun!;
  G.cols = L1_COLS;
  const grid: string[][] = Array.from({ length: L1_ROWS }, () => Array.from({ length: L1_COLS }, () => " "));

  const pitCols = new Set([15, 16, 17, 34, 35, 36, 49, 50, 51]);
  for (let col = 0; col < L1_COLS; col++) {
    if (!pitCols.has(col)) {
      grid[10][col] = "#";
      grid[11][col] = "#";
    }
  }

  // Summit bounce pads & golden cloud ledges
  grid[9][8] = "^";
  grid[9][32] = "^";
  grid[9][65] = "^";
  grid[9][86] = "^";
  for (let col = 9; col <= 14; col++) grid[3][col] = "=";
  for (let col = 37; col <= 42; col++) grid[4][col] = "=";

  grid[6][11] = "?";
  grid[6][25] = "B"; grid[6][26] = "?"; grid[6][27] = "B";
  grid[6][42] = "?";
  grid[6][57] = "B"; grid[6][58] = "?";

  // Choice Gate Warp Pipe at col 64
  grid[8][64] = "P"; grid[9][64] = "P";

  const pickedRoute = cr.choices["l4_route"]?.route;
  if (pickedRoute === "high") {
    for (let col = 65; col <= 82; col++) grid[5][col] = "=";
    grid[3][73] = "?";
  } else {
    grid[7][66] = "="; grid[6][68] = "=";
  }
  for (let col = 68; col <= 72; col++) grid[8][col] = "=";
  for (let col = 76; col <= 80; col++) grid[8][col] = "=";

  // Summit Boss Arena platforms
  grid[7][87] = "="; grid[7][88] = "="; grid[7][89] = "=";
  grid[6][92] = "="; grid[6][93] = "=";

  for (let r = 4; r <= 9; r++) grid[r][99] = "G";
  for (let r = 4; r <= 9; r++) grid[r][104] = "F";

  G.tiles = grid;
  G.bumps = [];

  G.movers = [
    { x: 15 * TILE, y: 7 * TILE, w: 3 * TILE, h: 16, vx: 1.5, vy: 0, minX: 14 * TILE, maxX: 19 * TILE, minY: 7 * TILE, maxY: 7 * TILE, label: "Market Cloud" },
    { x: 49 * TILE, y: 7 * TILE, w: 3 * TILE, h: 16, vx: -1.5, vy: 0, minX: 48 * TILE, maxX: 53 * TILE, minY: 7 * TILE, maxY: 7 * TILE, label: "Bonus Ascent" },
  ];

  G.posts = [
    { id: "mkt_base", col: 10, row: 7, wCols: 4, title: "Market Rate · ₹185/hr", sub: "Mumbai Base Benchmark", fit: true, applied: true, keyword: "Benchmark-185" },
    { id: "pit_lowball", col: 15, row: 10, wCols: 3, title: "Lowball Anchor", sub: "Below Minimum!", fit: false, applied: false },
    { id: "mkt_peak", col: 28, row: 7, wCols: 4, title: "Festival Peak +₹20/hr", sub: "Day 1 Shift Bonus", fit: true, applied: false, keyword: "Peak-Bonus" },
    { id: "pit_explode", col: 34, row: 10, wCols: 3, title: "Exploding Clause", sub: "Unfair Fine Print!", fit: false, applied: false },
    { id: "mkt_lead", col: 44, row: 7, wCols: 4, title: "Lead Track · ₹215/hr", sub: "Multi-Skill Tier", fit: true, applied: false, keyword: "Lead-215" },
    { id: "summit_offer", col: 71, row: 5, wCols: 4, title: "Signed Lead Offer", sub: "₹215/hr · Day 1", fit: true, applied: cr.offer.status === "negotiated", keyword: "Offer-Sealed" },
  ];
  for (const jp of G.posts) {
    if (jp.fit) {
      for (let dc = 0; dc < jp.wCols; dc++) G.tiles[jp.row][jp.col + dc] = "=";
    }
  }

  G.powerBlocks = [
    { col: 11, row: 6, kind: "keyword", label: "Keyword: Pay-Parity", used: false },
    { col: 26, row: 6, kind: "resume", label: "Negotiation Leverage", used: false },
    { col: 42, row: 6, kind: "keyword", label: "Keyword: Festival-Bonus", used: false },
    { col: 58, row: 6, kind: "resume", label: "Contract Clarity", used: false },
    { col: 73, row: 3, kind: "keyword", label: "Keyword: Top-Tier-215", used: false },
  ];

  const savedBadges = cr.badges[4] ?? [false, false, false];
  G.badges = [
    { idx: 0, col: 11, row: 2, label: "Summit Peak Badge", secret: true, collected: !!savedBadges[0] },
    { idx: 1, col: 39, row: 3, label: "Market Benchmark Badge", secret: false, collected: !!savedBadges[1] },
    { idx: 2, col: 74, row: 4, label: "Fair Offer Seal Badge", secret: false, collected: !!savedBadges[2] },
  ];

  for (const e of ENEMIES) e.active = false;
  for (const o of ORBS) o.active = false;
  const enemyDefs: [number, number, number, number, Enemy["kind"], string][] = [
    [20, 9, 18 * TILE, 25 * TILE, "bot", "Lowball Anchor"],
    [39, 9, 37 * TILE, 46 * TILE, "drone", "Exploding Offer"],
    [55, 9, 52 * TILE, 60 * TILE, "bot", "Fine-Print Bug"],
    [69, 9, 66 * TILE, 82 * TILE, "drone", "Countdown Drone"],
    [77, 9, 67 * TILE, 83 * TILE, "bot", "Pressure Bot"],
  ];
  enemyDefs.forEach(([col, row, minX, maxX, kind, label], i) => {
    const e = ENEMIES[i];
    e.active = true; e.x = col * TILE; e.y = row * TILE + 6; e.w = 34; e.h = 34;
    e.vx = i % 2 === 0 ? -1.5 : 1.5; e.vy = 0; e.minX = minX; e.maxX = maxX;
    e.kind = kind; e.label = label; e.squashT = 0;
  });

  G.bossActive = false; G.bossHp = 3; G.bossMaxHp = 3; G.bossDefeated = false;
  G.bossLaserY = 200; G.bossLaserDir = 1; G.bossTimer = 0;
  G.bossSwitchCol = 88; G.bossSwitchRow = 9; G.bossSwitchCooldown = 0;

  resetPlayerAndCamera(c, 4, startAtChoice);
}

// ---------- Level 5: Results Pavilion (Interactive Ending Stage + Trophy Monuments) ----------
export function loadLevel5(c: Cand) {
  const cr = c.careerRun!;
  const COLS5 = 56;
  G.cols = COLS5;
  const grid: string[][] = Array.from({ length: L1_ROWS }, () => Array.from({ length: COLS5 }, () => " "));
  for (let col = 0; col < COLS5; col++) {
    grid[10][col] = "#";
    grid[11][col] = "#";
  }
  // Celebratory bounce pads & upper Victory Gallery platforms
  grid[9][8] = "^";
  grid[9][26] = "^";
  grid[9][44] = "^";
  for (let col = 10; col <= 16; col++) grid[5][col] = "=";
  for (let col = 28; col <= 34; col++) grid[5][col] = "=";
  for (let r = 4; r <= 9; r++) grid[r][50] = "F";

  G.tiles = grid;
  G.bumps = [];
  G.movers = [];
  G.powerBlocks = [];
  G.badges = [];
  for (const e of ENEMIES) e.active = false;
  for (const o of ORBS) o.active = false;

  const r1 = cr.choices["l1_apply_route"]?.route?.toUpperCase() ?? "HIGH";
  const r2 = cr.choices["l2_route"]?.route?.toUpperCase() ?? "HIGH";
  const r3 = cr.choices["l3_route"]?.route?.toUpperCase() ?? "HIGH";
  const r4 = cr.choices["l4_route"]?.route?.toUpperCase() ?? "HIGH";

  G.posts = [
    { id: "mon_1", col: 10, row: 7, wCols: 4, title: `Stage 1 · ${r1}`, sub: `${cr.appliedJobs.length || 1} Roles Applied`, fit: true, applied: true },
    { id: "mon_2", col: 20, row: 7, wCols: 4, title: `Stage 2 · ${r2}`, sub: `ID: ${c.id_check.toUpperCase()}`, fit: true, applied: true },
    { id: "mon_3", col: 30, row: 7, wCols: 4, title: `Stage 3 · ${r3}`, sub: `Panel Score ${cr.interview.score || 94}%`, fit: true, applied: true },
    { id: "mon_4", col: 40, row: 7, wCols: 4, title: `Stage 4 · ${r4}`, sub: `₹${cr.offer.final}/hr · ${cr.offer.status.toUpperCase()}`, fit: true, applied: true },
  ];
  for (const jp of G.posts) {
    for (let dc = 0; dc < jp.wCols; dc++) G.tiles[jp.row][jp.col + dc] = "=";
  }

  G.bossActive = false; G.bossDefeated = true;
  resetPlayerAndCamera(c, 5, false);
  spawnConfetti(6 * TILE, 6 * TILE);
}

export function loadLevel(c: Cand, lvl: number, startAtChoice = false) {
  if (lvl === 1) loadLevel1(c, startAtChoice);
  else if (lvl === 2) loadLevel2(c, startAtChoice);
  else if (lvl === 3) loadLevel3(c, startAtChoice);
  else if (lvl === 4) loadLevel4(c, startAtChoice);
  else if (lvl === 5) loadLevel5(c);
}

// ---------- Input State (Keyboard + On-Screen Touch) ----------
const keysDown = new Set<string>();
let listenersBound = false;

function fireStarProjectile() {
  const c = ensureCand(), cr = c.careerRun!;
  if (cr.current === 0 || G.starCooldown > 0) return;
  G.starCooldown = 22;
  for (let i = 0; i < MAX_ORBS; i++) {
    const o = ORBS[i];
    if (!o.active) {
      o.active = true;
      o.x = G.px + (G.facing > 0 ? G.pw + 6 : -6);
      o.y = G.py + 16;
      o.vx = G.facing * 7.8;
      o.vy = -0.4;
      o.r = 12;
      o.friendly = true;
      o.keyword = "★ STAR";
      o.life = 0;
      sfx.doubleJump();
      spawnBurst(o.x, o.y, "#ffd66b", 8, "spark");
      spawnFloat(G.px, G.py - 12, "★ STAR Example Fired!", "#ffd66b");
      break;
    }
  }
}

function onKey(e: KeyboardEvent, down: boolean) {
  if (ui.view !== "run") return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const code = e.code;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(code)) e.preventDefault();
  if (down) {
    keysDown.add(code);
    if ((code === "Space" || code === "ArrowUp" || code === "KeyW") && !e.repeat) {
      G.jumpBuf = BUFFER_FRAMES;
      if (G.introCardOpen) { G.introCardOpen = false; G.introPanT = 0; render(); }
    }
    if ((code === "KeyE" || code === "Enter") && !e.repeat) triggerInteract();
    if (code === "KeyQ" && !e.repeat) fireStarProjectile();
    if (code === "KeyF" && !e.repeat) { G.fpsShow = !G.fpsShow; render(); }
    if (code === "KeyM" && !e.repeat) { audioMuted = !audioMuted; toast(audioMuted ? "Audio muted" : "Synthesized SFX on"); render(); }
  } else {
    keysDown.delete(code);
  }
}

export function bindInputOnce() {
  if (listenersBound) return;
  listenersBound = true;
  addEventListener("keydown", e => onKey(e, true));
  addEventListener("keyup", e => onKey(e, false));
  addEventListener("blur", () => keysDown.clear());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) keysDown.clear();
    else G.lastTs = performance.now();
  });
}

function triggerInteract() {
  const c = ensureCand(), cr = c.careerRun!;
  if (cr.current === 0) {
    if (G.hubNode <= cr.unlocked) {
      cr.current = G.hubNode;
      loadLevel(c, G.hubNode, false);
      sfx.door();
      save(); render();
    } else {
      toast("Complete Stage " + cr.unlocked + " first to unlock this stage!");
    }
    return;
  }
  if (G.introCardOpen) { G.introCardOpen = false; G.introPanT = 0; render(); return; }
  if (G.nearNpc && !G.activeNpc) {
    G.activeNpc = G.nearNpc;
    sfx.door();
    render();
    return;
  }
  if (cr.current >= 1 && cr.current <= 4) {
    const ch = currentChoice(cr.current);
    const pCol = Math.floor((G.px + G.pw / 2) / TILE);
    if (Math.abs(pCol - ch.col) <= 3 && !G.choiceModalOpen) {
      G.previewChoiceKey = ch.options[0].key;
      G.choiceModalOpen = true;
      sfx.door();
      render();
    }
  }
}

// ---------- Tile Collision Helpers ----------
function isSolid(r: number, c: number): boolean {
  if (r < 0 || r >= L1_ROWS) return false;
  if (c < 0 || c >= G.cols) return true;
  const ch = G.tiles[r]?.[c] ?? " ";
  return ch === "#" || ch === "B" || ch === "?" || ch === "x" || ch === "=" || ch === "P" || ch === "G" || ch === "^";
}

function addCombo(c: Cand, boost = 0.25) {
  G.combo = Math.min(4, +(G.combo + boost).toFixed(2));
  G.comboTimer = 210;
  if (c.careerRun && G.combo > c.careerRun.comboBest) c.careerRun.comboBest = G.combo;
}

function clampMeter(v: number) { return Math.max(0, Math.min(100, Math.round(v))); }

function hitQuestionBlock(c: Cand, r: number, col: number) {
  const ch = G.tiles[r]?.[col];
  if (ch !== "?" && ch !== "B") return;
  G.bumps.push({ r, c: col, t: 0 });
  if (ch === "?") {
    G.tiles[r][col] = "x";
    const pb = G.powerBlocks.find(b => b.row === r && b.col === col);
    const cr = c.careerRun!;
    sfx.powerup();
    spawnBurst(col * TILE + 20, r * TILE, "#f2b84b", 12, "spark");
    if (pb?.kind === "keyword") {
      G.hasDoubleJump = true;
      const kw = pb.label.replace("Keyword: ", "");
      if (!cr.keywords.includes(kw)) cr.keywords.push(kw);
      cr.m.skills = clampMeter(cr.m.skills + 6);
      spawnFloat(col * TILE, r * TILE - 12, "+" + pb.label, "#8b6cf0");
    } else {
      G.hasResumeShield = true;
      cr.m.stamina = clampMeter(cr.m.stamina + 15);
      cr.m.trust = clampMeter(cr.m.trust + 5);
      spawnFloat(col * TILE, r * TILE - 12, "+" + (pb?.label || "Resume Shield!"), "#3ddc97");
    }
    addCombo(c, 0.25);
    syncToRecruiter(c);
    updateHudDom(c);
  } else {
    sfx.stomp();
  }
}

function respawnAtCheckpoint(c: Cand, reason: string) {
  const cr = c.careerRun!;
  const lvl = cr.current || 1;
  if (G.hasResumeShield) {
    G.hasResumeShield = false;
    G.invuln = 75;
    G.vy = -9;
    sfx.hit();
    spawnFloat(G.px, G.py - 14, "Shield Absorbed Hit!", "#f2b84b");
    updateHudDom(c);
    return;
  }
  cr.deaths[lvl] = (cr.deaths[lvl] ?? 0) + 1;
  if (cr.deaths[lvl] >= 2 && !cr.mentorOn) {
    toast("Tip: Failed twice! Toggle Mentor Ghost in the HUD for jump-arc guides.");
  } else {
    toast(reason);
  }
  cr.m.stamina = clampMeter(Math.max(25, cr.m.stamina - 8));
  G.combo = 1; G.comboTimer = 0;
  G.px = G.checkpointCol * TILE;
  G.py = G.checkpointRow * TILE;
  G.vx = 0; G.vy = -4;
  G.invuln = 70;
  G.shakeT = reduceMotion.matches ? 0 : 14;
  G.shakeMag = 6;
  sfx.hit();
  syncToRecruiter(c);
  updateHudDom(c);
}

// ---------- Fixed-Timestep Update (60Hz) ----------
function updateFixed() {
  const c = ensureCand(), cr = c.careerRun!;
  const lvl = cr.current;
  G.frame++;

  // Update pooled particles & floating text
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = PARTICLES[i];
    if (!p.active) continue;
    p.life++;
    if (p.life >= p.maxLife) { p.active = false; continue; }
    p.x += p.vx;
    p.y += p.vy;
    if (p.kind === "confetti") p.vy += 0.12;
    p.alpha = 1 - p.life / p.maxLife;
  }
  for (let i = 0; i < MAX_FLOATS; i++) {
    const f = FLOATS[i];
    if (!f.active) continue;
    f.life++;
    if (f.life >= f.maxLife) { f.active = false; continue; }
    f.y += f.vy;
  }

  // Hub Map logic
  if (lvl === 0) {
    const left = keysDown.has("ArrowLeft") || keysDown.has("KeyA");
    const right = keysDown.has("ArrowRight") || keysDown.has("KeyD");
    if (left && G.frame % 10 === 0 && G.hubNode > 1) { G.hubNode--; sfx.jump(); updateHudDom(c); }
    if (right && G.frame % 10 === 0 && G.hubNode < Math.min(5, cr.unlocked)) { G.hubNode++; sfx.jump(); updateHudDom(c); }
    const cv = document.getElementById("crun-canvas") as HTMLCanvasElement | null;
    const cw = cv?.clientWidth || 760;
    const targetX = Math.round(cw * (0.13 + (G.hubNode - 1) * 0.185));
    const targetY = 235 + (G.hubNode % 2 === 0 ? -36 : 24);
    G.hubPlayerX += (targetX - G.hubPlayerX) * 0.16;
    G.hubPlayerY += (targetY - G.hubPlayerY) * 0.16;
    return;
  }

  // Ensure level grid matches current stage
  if (G.loadedLevel !== lvl || G.tiles.length === 0) {
    loadLevel(c, lvl, false);
  }

  // Pause gameplay physics when modal or intro pan is active
  if (G.introPanT > 0) {
    G.introPanT--;
    const t = G.introPanT / 105;
    G.camX = (3300 - 80) * t * t;
    if (G.introPanT === 0 && G.introCardOpen) { G.introCardOpen = false; render(); }
    return;
  }
  if (G.activeNpc || G.choiceModalOpen || G.recapOpen || G.routeMapOpen) return;

  if (G.hitStop > 0) { G.hitStop--; return; }
  if (G.shakeT > 0) G.shakeT--;
  if (G.invuln > 0) G.invuln--;
  if (G.starCooldown > 0) G.starCooldown--;
  if (G.comboTimer > 0) {
    G.comboTimer--;
    if (G.comboTimer === 0) { G.combo = 1; updateHudDom(c); }
  }

  // Warp pipe animation
  if (G.pipeAnimT > 0) {
    G.pipeAnimT--;
    G.py += 1.5;
    if (G.pipeAnimT === 0) {
      G.px = 84 * TILE;
      G.py = 8 * TILE;
      G.checkpointCol = 84;
      G.checkpointRow = 8;
      spawnBurst(G.px + 15, G.py + 20, "#3ddc97", 16, "spark");
      spawnFloat(G.px, G.py - 18, "Express Warp Complete!", "#3ddc97");
    }
    return;
  }

  // Block bump decay
  for (let i = G.bumps.length - 1; i >= 0; i--) {
    G.bumps[i].t += 0.16;
    if (G.bumps[i].t >= 1) G.bumps.splice(i, 1);
  }

  // Update Moving Platforms (and carry player if standing on one)
  for (let i = 0; i < G.movers.length; i++) {
    const m = G.movers[i];
    const prevX = m.x, prevY = m.y;
    m.x += m.vx;
    m.y += m.vy;
    if (m.vx !== 0 && (m.x <= m.minX || m.x + m.w >= m.maxX)) m.vx *= -1;
    if (m.vy !== 0 && (m.y <= m.minY || m.y >= m.maxY)) m.vy *= -1;
    const dx = m.x - prevX, dy = m.y - prevY;
    if (G.onGround && G.px + G.pw > m.x && G.px < m.x + m.w && Math.abs((G.py + G.ph) - prevY) <= 6) {
      G.px += dx;
      G.py += dy;
    }
  }

  // Horizontal movement
  const moveL = keysDown.has("ArrowLeft") || keysDown.has("KeyA");
  const moveR = keysDown.has("ArrowRight") || keysDown.has("KeyD");
  if (moveL) { G.vx = Math.max(-MAX_SPEED, G.vx - MOVE_ACC); G.facing = -1; }
  else if (moveR) { G.vx = Math.min(MAX_SPEED, G.vx + MOVE_ACC); G.facing = 1; }
  else { G.vx *= 0.78; if (Math.abs(G.vx) < 0.08) G.vx = 0; }

  // Coyote time & Jump buffer
  if (G.onGround) {
    G.coyote = COYOTE_FRAMES;
    G.jumpsLeft = (G.hasDoubleJump || cr.mentorOn) ? 2 : 1;
  } else if (G.coyote > 0) {
    G.coyote--;
  }
  if (G.jumpBuf > 0) G.jumpBuf--;

  if (G.jumpBuf > 0) {
    if (G.coyote > 0) {
      G.vy = JUMP_FORCE;
      G.onGround = false;
      G.coyote = 0;
      G.jumpBuf = 0;
      G.jumpsLeft = (G.hasDoubleJump || cr.mentorOn) ? 1 : 0;
      G.squashX = 0.78; G.squashY = 1.26;
      sfx.jump();
      spawnParticle(G.px + G.pw / 2, G.py + G.ph, -G.facing * 1.2, -0.4, "rgba(255,255,255,0.55)", 5, 18, "dust");
    } else if (G.jumpsLeft > 0) {
      G.vy = DOUBLE_JUMP_FORCE;
      G.jumpsLeft--;
      G.jumpBuf = 0;
      G.squashX = 0.8; G.squashY = 1.22;
      sfx.doubleJump();
      spawnBurst(G.px + G.pw / 2, G.py + G.ph, "#8b6cf0", 8, "spark");
      spawnFloat(G.px, G.py - 10, "Keyword Boost!", "#a78bfa");
    }
  }

  // Variable jump height when releasing jump key early
  const holdingJump = keysDown.has("Space") || keysDown.has("ArrowUp") || keysDown.has("KeyW");
  if (!holdingJump && G.vy < -4.5) G.vy *= 0.86;

  // Apply Gravity
  G.vy = Math.min(MAX_FALL, G.vy + GRAVITY);

  // Move X & resolve tile collisions
  G.px += G.vx;
  const c0 = Math.floor(G.px / TILE), c1 = Math.floor((G.px + G.pw - 0.01) / TILE);
  const r0 = Math.floor(G.py / TILE), r1 = Math.floor((G.py + G.ph - 0.01) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let col = c0; col <= c1; col++) {
      if (isSolid(r, col)) {
        if (G.vx > 0) G.px = col * TILE - G.pw;
        else if (G.vx < 0) G.px = (col + 1) * TILE;
        G.vx = 0;
      }
    }
  }
  G.px = Math.max(0, Math.min(G.cols * TILE - G.pw, G.px));

  // Move Y & resolve tile + moving platform collisions
  const wasOnGround = G.onGround;
  const prevPy = G.py;
  G.onGround = false;
  G.py += G.vy;
  const nc0 = Math.floor(G.px / TILE), nc1 = Math.floor((G.px + G.pw - 0.01) / TILE);
  const nr0 = Math.floor(G.py / TILE), nr1 = Math.floor((G.py + G.ph - 0.01) / TILE);
  for (let r = nr0; r <= nr1; r++) {
    for (let col = nc0; col <= nc1; col++) {
      if (isSolid(r, col)) {
        const ch = G.tiles[r]?.[col];
        if (G.vy > 0) {
          G.py = r * TILE - G.ph;
          if (ch === "^") {
            // Bounce Pad launch!
            G.vy = -16.2;
            G.onGround = false;
            G.jumpsLeft = (G.hasDoubleJump || cr.mentorOn) ? 2 : 1;
            G.squashX = 0.72; G.squashY = 1.34;
            sfx.doubleJump();
            spawnBurst(col * TILE + 20, r * TILE + 10, "#3ddc97", 12, "spark");
            spawnFloat(G.px, G.py - 12, "Spring Launch!", "#3ddc97");
          } else {
            G.vy = 0;
            G.onGround = true;
            if (!wasOnGround) {
              G.squashX = 1.24; G.squashY = 0.78;
              spawnParticle(G.px + G.pw / 2, G.py + G.ph, (G.frame % 2 ? 1 : -1) * 1.1, -0.3, "rgba(255,255,255,0.45)", 4, 15, "dust");
            }
          }
        } else if (G.vy < 0) {
          G.py = (r + 1) * TILE;
          G.vy = 0;
          hitQuestionBlock(c, r, col);
        }
      }
    }
  }

  // Landing on Moving Platforms
  if (G.vy >= 0) {
    for (let i = 0; i < G.movers.length; i++) {
      const m = G.movers[i];
      if (G.px + G.pw > m.x && G.px < m.x + m.w && prevPy + G.ph <= m.y + 8 && G.py + G.ph >= m.y) {
        G.py = m.y - G.ph;
        G.vy = 0;
        G.onGround = true;
        break;
      }
    }
  }

  // Squash & stretch spring recovery + trailing run dust
  G.squashX += (1 - G.squashX) * 0.22;
  G.squashY += (1 - G.squashY) * 0.22;
  if (G.onGround && Math.abs(G.vx) > 2.2) {
    G.walkCycle += Math.abs(G.vx) * 0.09;
    if (G.frame % 7 === 0) {
      spawnParticle(G.px + (G.facing > 0 ? 4 : G.pw - 4), G.py + G.ph - 2, -G.facing * 0.8, -0.3, "rgba(167,139,250,0.4)", 3.5, 16, "dust");
    }
  }

  // Check Pits (fell below floor)
  if (G.py > L1_ROWS * TILE + 24) {
    respawnAtCheckpoint(c, "Fell into a hazard pit! Returned to last checkpoint.");
    return;
  }

  // Check Matching Job Post / Verification / Benchmark platform landings
  const pFootRow = Math.floor((G.py + G.ph + 2) / TILE);
  const pCenterCol = Math.floor((G.px + G.pw / 2) / TILE);
  for (const jp of G.posts) {
    if (jp.fit && !jp.applied && G.onGround && pFootRow === jp.row && pCenterCol >= jp.col && pCenterCol < jp.col + jp.wCols) {
      jp.applied = true;
      if (lvl === 1 && !cr.appliedJobs.includes(jp.title)) cr.appliedJobs.push(jp.title);
      if (jp.keyword && !cr.keywords.includes(jp.keyword)) cr.keywords.push(jp.keyword);
      cr.m.skills = clampMeter(cr.m.skills + 7);
      cr.m.trust = clampMeter(cr.m.trust + 4);
      addCombo(c, 0.5);
      sfx.coin();
      spawnBurst(G.px + G.pw / 2, G.py + G.ph, "#3ddc97", 14, "spark");
      spawnFloat(G.px, G.py - 16, `✓ ${jp.title} (x${G.combo})`, "#3ddc97");
      G.checkpointCol = jp.col;
      G.checkpointRow = jp.row - 1;
      syncToRecruiter(c);
      updateHudDom(c);
    }
  }

  // Check Skills Badges collection
  for (const b of G.badges) {
    if (!b.collected) {
      const bx = b.col * TILE + 8, by = b.row * TILE + 8;
      if (G.px < bx + 24 && G.px + G.pw > bx && G.py < by + 24 && G.py + G.ph > by) {
        b.collected = true;
        if (!cr.badges[lvl]) cr.badges[lvl] = [false, false, false];
        cr.badges[lvl][b.idx] = true;
        const secKey = `l${lvl}_alcove`;
        if (b.secret && !cr.secrets.includes(secKey)) cr.secrets.push(secKey);
        cr.m.skills = clampMeter(cr.m.skills + 10);
        cr.m.fairness = clampMeter(cr.m.fairness + 5);
        addCombo(c, 0.5);
        sfx.powerup();
        spawnBurst(bx + 12, by + 12, "#f2b84b", 18, "spark");
        spawnFloat(bx, by - 12, `★ ${b.label}!`, "#f2b84b");
        syncToRecruiter(c);
        updateHudDom(c);
      }
    }
  }

  // Check proximity to Talkable NPCs for current level
  G.nearNpc = null;
  const npcs = currentNpcs(lvl);
  for (const npc of npcs) {
    if (Math.abs(G.px - npc.col * TILE) < 62 && Math.abs(G.py - npc.row * TILE) < 64) {
      G.nearNpc = npc;
      break;
    }
  }

  // Auto-open Choice Gate when reaching col 62 for the first time in Levels 1..4
  if (lvl >= 1 && lvl <= 4) {
    const ch = currentChoice(lvl);
    if (!cr.choices[ch.id] && pCenterCol >= ch.col && pCenterCol <= ch.col + 1) {
      G.checkpointCol = ch.col - 1;
      G.checkpointRow = 8;
      G.previewChoiceKey = ch.options[0].key;
      G.choiceModalOpen = true;
      G.vx = 0;
      sfx.door();
      render();
      return;
    }
  }

  // Update Enemies & Player/STAR-Orb vs Enemy collisions
  for (let i = 0; i < MAX_ENEMIES; i++) {
    const e = ENEMIES[i];
    if (!e.active) continue;
    if (e.squashT > 0) {
      e.squashT--;
      if (e.squashT === 0) e.active = false;
      continue;
    }
    e.x += e.vx;
    if (e.x <= e.minX || e.x + e.w >= e.maxX) e.vx *= -1;

    // Check if hit by player's ★ STAR projectile
    for (let j = 0; j < MAX_ORBS; j++) {
      const o = ORBS[j];
      if (o.active && o.keyword === "★ STAR" && o.x + o.r > e.x && o.x - o.r < e.x + e.w && o.y + o.r > e.y && o.y - o.r < e.y + e.h) {
        o.active = false;
        e.squashT = 20;
        addCombo(c, 0.5);
        cr.m.skills = clampMeter(cr.m.skills + 5);
        sfx.stomp();
        spawnBurst(e.x + e.w / 2, e.y + e.h / 2, "#ffd66b", 12, "spark");
        spawnFloat(e.x, e.y - 10, `★ STAR Cleared ${e.label}!`, "#ffd66b");
        updateHudDom(c);
        break;
      }
    }
    if (e.squashT > 0) continue;

    // Player vs Enemy collision
    if (G.px < e.x + e.w && G.px + G.pw > e.x && G.py < e.y + e.h && G.py + G.ph > e.y) {
      if (G.vy > 0 && G.py + G.ph - G.vy <= e.y + 16) {
        e.squashT = 22;
        G.vy = -10.2;
        addCombo(c, 0.5);
        cr.m.skills = clampMeter(cr.m.skills + 4);
        sfx.stomp();
        spawnBurst(e.x + e.w / 2, e.y + e.h / 2, "#3ddc97", 10, "spark");
        spawnFloat(e.x, e.y - 10, `Stomped ${e.label}! x${G.combo}`, "#3ddc97");
        updateHudDom(c);
      } else if (G.invuln === 0) {
        respawnAtCheckpoint(c, `Hit by ${e.label}! Stomp from above or press Q to fire a STAR story.`);
        return;
      }
    }
  }

  // Update player-fired STAR projectiles even outside boss arena
  for (let i = 0; i < MAX_ORBS; i++) {
    const o = ORBS[i];
    if (!o.active || o.keyword !== "★ STAR") continue;
    o.life++;
    o.x += o.vx;
    o.y += o.vy;
    if (o.life > 90) { o.active = false; continue; }
    // Hit Boss Tower at col 97..99!
    if (!G.bossDefeated && G.bossActive && o.x >= 96 * TILE && G.bossSwitchCooldown === 0) {
      o.active = false;
      damageStageBoss(c, 96 * TILE, o.y);
    }
  }

  // Stage Boss Arena (cols 83..99 in Stages 1..4)
  if (lvl >= 1 && lvl <= 4 && !G.bossDefeated && pCenterCol >= 82) {
    if (!G.bossActive) {
      G.bossActive = true;
      G.checkpointCol = 83;
      G.checkpointRow = 8;
      const bossNames: Record<number, string> = {
        1: "BOSS: The ATS Gate! Stomp Override Switch 3x!",
        2: "BOSS: The Gatekeeper! Stomp Honest Crystal 3x!",
        3: "BOSS: The Interview Panel! Stomp Podium or Fire ★ STAR (Q) 3x!",
        4: "BOSS: Closing Deadline Clock! Stomp Fair Contract Seal 3x!",
      };
      spawnFloat(G.px, G.py - 24, bossNames[lvl] || bossNames[1], "#f2b84b");
    }
    G.bossTimer++;
    if (G.bossSwitchCooldown > 0) G.bossSwitchCooldown--;

    // Sweeping scanner / pressure beam
    G.bossLaserY += G.bossLaserDir * (1.5 + (3 - G.bossHp) * 0.45);
    if (G.bossLaserY > 368) G.bossLaserDir = -1;
    if (G.bossLaserY < 165) G.bossLaserDir = 1;

    // Spawn Boss Orbs every 85 frames
    if (G.bossTimer % 85 === 20) {
      for (let i = 0; i < MAX_ORBS; i++) {
        const o = ORBS[i];
        if (!o.active) {
          o.active = true;
          o.x = 97 * TILE;
          o.y = 210 + ((G.bossTimer * 37) % 140);
          o.vx = -3.1;
          o.vy = Math.sin(G.bossTimer) * 0.6;
          o.r = 13;
          o.friendly = (G.bossTimer % 170 === 20);
          o.keyword = o.friendly ? "+Bonus Orb" : "Hazard Pulse";
          o.life = 0;
          break;
        }
      }
    }

    // Update Boss Orbs
    for (let i = 0; i < MAX_ORBS; i++) {
      const o = ORBS[i];
      if (!o.active || o.keyword === "★ STAR") continue;
      o.life++;
      o.x += o.vx;
      o.y += o.vy;
      if (o.x < 81 * TILE || o.life > 240) { o.active = false; continue; }
      if (G.px < o.x + o.r && G.px + G.pw > o.x - o.r && G.py < o.y + o.r && G.py + G.ph > o.y - o.r) {
        o.active = false;
        if (o.friendly) {
          cr.m.skills = clampMeter(cr.m.skills + 5);
          sfx.coin();
          spawnFloat(o.x, o.y - 10, "+Matched Data Orb!", "#4da6ff");
          updateHudDom(c);
        } else if (G.invuln === 0) {
          respawnAtCheckpoint(c, "Clipped by a Boss Pulse! Jump over coral orbs.");
          return;
        }
      }
    }

    // Check Boss Switch stomp
    const swX = G.bossSwitchCol * TILE, swY = G.bossSwitchRow * TILE + 12;
    if (G.bossSwitchCooldown === 0 && G.vy > 0 && G.px + G.pw > swX && G.px < swX + TILE && G.py + G.ph >= swY && G.py + G.ph <= swY + 28) {
      G.vy = -11.5;
      damageStageBoss(c, swX, swY);
    }
  }

  // Check Checkpoint Flag at col 104 (Stages 1..4) or col 50 (Stage 5 Pavilion)
  const flagCol = lvl === 5 ? 49 : 103;
  if (pCenterCol >= flagCol && !G.recapOpen) {
    if (lvl === 5) {
      spawnConfetti(G.px, G.py - 20);
      sfx.win();
      G.checkpointCol = 6;
      G.px = 6 * TILE;
      toast("Career Run Complete! Explore your Full Journey Tree below or replay any stage branch.");
      return;
    }
    G.recapOpen = true;
    if (cr.unlocked < lvl + 1) cr.unlocked = (lvl + 1) as CareerRunState["unlocked"];
    if (lvl === 1 && cr.appliedJobs.length === 0) cr.appliedJobs.push("Picker · Hub");
    if (lvl === 2) c.id_check = "ok";
    if (lvl === 3) cr.interview = { hr: true, tech: true, exec: true, score: Math.max(cr.interview.score, 94) };
    if (lvl === 4 && cr.offer.status === "pending") {
      cr.offer = { base: 185, final: 215, role: "Lead Picker · Festival Hub", status: "negotiated" };
    }
    c.appliedAt = Date.now();
    sfx.win();
    spawnConfetti(G.px, G.py - 20);
    syncToRecruiter(c, lvl >= 4 ? "offers" : "screened");
    render();
    return;
  }

  // Smooth Easing Camera with Horizontal Look-Ahead
  const cv = document.getElementById("crun-canvas") as HTMLCanvasElement | null;
  const viewW = cv ? cv.clientWidth || 900 : 900;
  const lookAhead = G.facing * 95 + G.vx * 14;
  const targetCamX = Math.max(0, Math.min(G.cols * TILE - viewW, G.px - viewW * 0.36 + lookAhead));
  G.camX += (targetCamX - G.camX) * (reduceMotion.matches ? 1 : 0.11);
}

function damageStageBoss(c: Cand, hitX: number, hitY: number) {
  const cr = c.careerRun!;
  const lvl = cr.current;
  G.bossHp--;
  G.bossSwitchCooldown = 40;
  G.hitStop = reduceMotion.matches ? 0 : 6;
  G.shakeT = reduceMotion.matches ? 0 : 16;
  G.shakeMag = 7;
  sfx.bossHit();
  spawnBurst(hitX + 20, hitY, "#f2b84b", 18, "spark");
  G.bossSwitchCol = G.bossHp === 2 ? 93 : 88;
  G.bossSwitchRow = G.bossHp === 2 ? 5 : 9;

  // In Level 3 (Interview Panel), each hit wins over one Panelist (HR -> Tech -> Exec)!
  if (lvl === 3) {
    if (G.bossHp === 2) { cr.interview.hr = true; spawnFloat(hitX, hitY - 18, "HR Panelist Approved ✓ (2 left)", "#3ddc97"); }
    else if (G.bossHp === 1) { cr.interview.tech = true; spawnFloat(hitX, hitY - 18, "Tech Lead Approved ✓ (1 left)", "#4da6ff"); }
    else { cr.interview.exec = true; cr.interview.score = 94; }
  }

  if (G.bossHp <= 0) {
    G.bossDefeated = true;
    G.bossActive = false;
    for (const o of ORBS) o.active = false;
    for (let r = 4; r <= 9; r++) G.tiles[r][99] = " ";
    cr.m.trust = clampMeter(cr.m.trust + 10);
    cr.m.fairness = clampMeter(cr.m.fairness + 8);
    sfx.win();
    spawnConfetti(98 * TILE, 6 * TILE);
    const winMsg: Record<number, string> = {
      1: "ATS GATE UNLOCKED! Human Review Active!",
      2: "GATEKEEPER CLEARED! Gate 1 & 2 Passed!",
      3: "PANEL UNANIMOUS (94%)! Shortlisted for Offer!",
      4: "CONTRACT SEALED! Summit Flag Unlocked!",
    };
    spawnFloat(hitX, hitY - 24, winMsg[lvl] || winMsg[1], "#3ddc97");
    syncToRecruiter(c, lvl >= 4 ? "offers" : "screened");
    updateHudDom(c);
  } else if (lvl !== 3) {
    spawnFloat(hitX, hitY - 18, `Stage ${lvl} Boss Hit! ${G.bossHp} HP left`, "#f2b84b");
  }
}

// ---------- Procedural Hero & Canvas Renderer ----------
function drawHero(g: CanvasRenderingContext2D, x: number, y: number, outfit: CareerRunState["outfit"], facing: 1 | -1) {
  if (G.invuln > 0 && Math.floor(G.invuln / 4) % 2 === 1) return;
  const pal = outfit === "rider" ? { suit: "#0ea5a4", cap: "#ff6b7d", trim: "#7ee7b8" }
    : outfit === "lead" ? { suit: "#d97724", cap: "#f2b84b", trim: "#fff3b0" }
    : { suit: "#6a4de0", cap: "#9b7cf6", trim: "#3ddc97" };

  // Power-up aura (Double Jump or Resume Shield)
  if (G.hasDoubleJump || G.hasResumeShield) {
    const glow = bank.glows[G.hasResumeShield ? "mint" : "violet"];
    if (glow) g.drawImage(glow, x - 33, y - 28, 96, 96);
  }

  g.save();
  const cx = x + G.pw / 2, by = y + G.ph;
  const breath = G.onGround && Math.abs(G.vx) < 0.2 ? Math.sin(G.frame * 0.08) * 0.03 : 0;
  g.translate(cx, by);
  g.scale(G.squashX * (1 - breath), G.squashY * (1 + breath));
  g.translate(-G.pw / 2, -G.ph);

  // Legs with running cycle
  const step = G.onGround && Math.abs(G.vx) > 0.3 ? Math.sin(G.walkCycle) * 5 : (!G.onGround ? 4 : 0);
  g.fillStyle = "#1c2242";
  roundRectPath(g, 5, 29, 8, 11 + step * 0.5, 3); g.fill();
  roundRectPath(g, 17, 29, 8, 11 - step * 0.5, 3); g.fill();

  // Shoes
  g.fillStyle = pal.trim;
  roundRectPath(g, 3, 36 + step * 0.4, 11, 5, 2); g.fill();
  roundRectPath(g, 16, 36 - step * 0.4, 11, 5, 2); g.fill();

  // Jacket / Torso
  g.fillStyle = pal.suit;
  roundRectPath(g, 3, 15, 24, 16, 6); g.fill();
  g.fillStyle = pal.trim;
  g.fillRect(6, 20, 18, 3);

  // Head
  g.fillStyle = "#f3cfae";
  roundRectPath(g, 5, 4, 20, 13, 6); g.fill();

  // Visor / Cap
  g.fillStyle = pal.cap;
  roundRectPath(g, 3, 1, 24, 6, 3); g.fill();
  roundRectPath(g, facing > 0 ? 15 : -1, 4, 16, 3.5, 2); g.fill();

  // Expressive Eyes
  g.fillStyle = "#111631";
  const ex = facing > 0 ? 17 : 8;
  g.fillRect(ex, 8, 3, 4);
  g.fillRect(ex + (facing > 0 ? 4 : -4), 8, 3, 4);

  g.restore();
}

function drawHubOverworld(g: CanvasRenderingContext2D, w: number, h: number, c: Cand) {
  const cr = c.careerRun!;
  const layers = bank.parallax[0];
  if (layers) {
    g.drawImage(layers[0], 0, 0, w, h);
    g.drawImage(layers[1], 0, 0, w, h);
  }

  // Glowing overworld network grid & branching paths
  const nodes = [
    { id: 1, x: Math.round(w * 0.13), y: 260, title: "1 · Job Board Plains", sub: "Apply & ATS Gate" },
    { id: 2, x: Math.round(w * 0.315), y: 195, title: "2 · Screening Caves", sub: "Recruiter Screen" },
    { id: 3, x: Math.round(w * 0.50), y: 260, title: "3 · Interview Castle", sub: "HR, Tech & Panel" },
    { id: 4, x: Math.round(w * 0.685), y: 195, title: "4 · Offer Summit", sub: "Negotiation" },
    { id: 5, x: Math.round(w * 0.87), y: 245, title: "5 · Results Pavilion", sub: "Final Outcome" },
  ];

  // Draw main spline + 3 branch arcs per node to visualize taken vs unexplored routes
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i], b = nodes[i + 1];
    const unlocked = cr.unlocked > i + 1;
    const chKey = i === 0 ? "l1_apply_route" : `l${i + 1}_route`;
    const picked = cr.choices[chKey]?.route;

    const routes: [("high" | "pipe" | "low"), number, string][] = [
      ["high", -44, "#3ddc97"],
      ["pipe", 0, "#a78bfa"],
      ["low", 44, "#f2b84b"],
    ];
    for (const [rk, dy, col] of routes) {
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + dy, b.x, b.y);
      if (picked === rk) {
        g.strokeStyle = col;
        g.lineWidth = 4;
        g.setLineDash([]);
      } else {
        g.strokeStyle = unlocked ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)";
        g.lineWidth = 2;
        g.setLineDash([5, 5]);
      }
      g.stroke();
    }
  }
  g.setLineDash([]);

  // Draw level nodes
  for (const n of nodes) {
    const isUnlocked = n.id <= cr.unlocked;
    const isSelected = G.hubNode === n.id;
    const glow = bank.glows[isSelected ? "mint" : isUnlocked ? "violet" : "blue"];
    if (glow && isUnlocked) g.drawImage(glow, n.x - 48, n.y - 48, 96, 96);

    g.fillStyle = isUnlocked ? (isSelected ? "#3ddc97" : "#8b6cf0") : "#1d2447";
    g.strokeStyle = isSelected ? "#fff" : "rgba(255,255,255,0.35)";
    g.lineWidth = isSelected ? 3 : 1.5;
    g.beginPath();
    g.arc(n.x, n.y, isSelected ? 24 : 20, 0, Math.PI * 2);
    g.fill();
    g.stroke();

    g.fillStyle = isUnlocked ? "#090c1a" : "#8189ad";
    g.font = "700 15px Poppins, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(isUnlocked ? String(n.id) : "🔒", n.x, n.y + 1);

    // Node label pill
    g.fillStyle = "rgba(14,18,46,0.88)";
    roundRectPath(g, n.x - 74, n.y + 30, 148, 38, 9);
    g.fill();
    g.strokeStyle = isSelected ? "#3ddc97" : "rgba(255,255,255,0.14)";
    g.lineWidth = 1;
    g.stroke();

    g.fillStyle = isUnlocked ? "#fff" : "#8189ad";
    g.font = "600 12px Poppins, system-ui, sans-serif";
    g.fillText(n.title, n.x, n.y + 44);
    g.fillStyle = "#b0b6d3";
    g.font = "500 10.5px Poppins, system-ui, sans-serif";
    g.fillText(n.sub, n.x, n.y + 59);
  }

  // Draw Hero on Hub Overworld
  drawHero(g, G.hubPlayerX - 15, G.hubPlayerY - 46, cr.outfit, 1);

  // Bottom prompt bar on canvas
  g.fillStyle = "rgba(9,12,26,0.82)";
  roundRectPath(g, w / 2 - 230, h - 48, 460, 34, 17);
  g.fill();
  g.fillStyle = "#eceefa";
  g.font = "500 12.5px Poppins, system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText("Use ◀ ▶ or click a node · Press SPACE or E to enter Stage " + G.hubNode, w / 2, h - 27);
}

function drawLevelCanvas(g: CanvasRenderingContext2D, w: number, h: number, c: Cand) {
  const cr = c.careerRun!;
  const worldId = cr.current || 1;
  const layers = bank.parallax[worldId] ?? bank.parallax[1];

  // 4-Layer Cached Parallax with wrap-around scrolling
  const factors = [0, 0.15, 0.35, 0.6];
  for (let i = 0; i < layers.length; i++) {
    const lay = layers[i];
    const f = factors[i];
    if (f === 0) {
      g.drawImage(lay, 0, 0, w, h);
    } else {
      const ox = -((G.camX * f) % lay.width);
      g.drawImage(lay, ox, 0, lay.width, h);
      if (ox + lay.width < w) g.drawImage(lay, ox + lay.width, 0, lay.width, h);
    }
  }

  g.save();
  // Screen shake offset
  if (G.shakeT > 0 && !reduceMotion.matches) {
    const dx = (Math.sin(G.frame * 1.9) * G.shakeMag * G.shakeT) / 16;
    const dy = (Math.cos(G.frame * 2.3) * G.shakeMag * G.shakeT) / 16;
    g.translate(dx, dy);
  }
  g.translate(-Math.round(G.camX), 0);

  // Only draw visible tiles!
  const colStart = Math.max(0, Math.floor(G.camX / TILE) - 1);
  const colEnd = Math.min(G.cols - 1, Math.ceil((G.camX + w) / TILE) + 1);
  let drawnCount = 0;

  const groundSprite = bank.tiles["#_" + worldId] ?? bank.tiles["#_1"];
  const platSprite = bank.tiles["=_" + worldId] ?? bank.tiles["=_1"];

  for (let r = 0; r < L1_ROWS; r++) {
    for (let col = colStart; col <= colEnd; col++) {
      const ch = G.tiles[r]?.[col];
      if (!ch || ch === " ") continue;
      drawnCount++;
      const bump = G.bumps.find(b => b.r === r && b.c === col);
      const by = bump ? -Math.sin(bump.t * Math.PI) * 9 : 0;
      const tx = col * TILE, ty = r * TILE + by;

      if (ch === "#") g.drawImage(groundSprite, tx, ty);
      else if (ch === "=") g.drawImage(platSprite, tx, ty);
      else if (ch === "B") g.drawImage(bank.tiles["B"], tx, ty);
      else if (ch === "^") g.drawImage(bank.tiles["^"], tx, ty);
      else if (ch === "?") {
        if (bank.glows.gold) g.drawImage(bank.glows.gold, tx - 28, ty - 28, 96, 96);
        g.drawImage(bank.tiles["?"], tx, ty);
      } else if (ch === "x") g.drawImage(bank.tiles["x"], tx, ty);
      else if (ch === "P") g.drawImage(bank.tiles["P"], tx, ty);
      else if (ch === "G") {
        g.fillStyle = "rgba(255,93,112,0.75)";
        g.fillRect(tx + 12, ty, 16, TILE);
        g.fillStyle = "#fff";
        g.fillRect(tx + 18, ty, 4, TILE);
      } else if (ch === "F") {
        g.fillStyle = "#eceefa";
        g.fillRect(tx + 17, ty, 6, TILE);
        if (r === 4) {
          if (bank.glows.mint) g.drawImage(bank.glows.mint, tx - 28, ty - 28, 96, 96);
          g.fillStyle = "#3ddc97";
          g.beginPath();
          g.moveTo(tx + 23, ty + 4);
          g.lineTo(tx + 72, ty + 20);
          g.lineTo(tx + 23, ty + 36);
          g.closePath();
          g.fill();
        }
      }
    }
  }
  G.tilesDrawn = drawnCount;

  // Draw Moving Platforms
  g.textAlign = "center";
  for (let i = 0; i < G.movers.length; i++) {
    const m = G.movers[i];
    if (m.x + m.w < G.camX - 40 || m.x > G.camX + w + 40) continue;
    g.fillStyle = "#2dd4bf";
    roundRectPath(g, m.x, m.y, m.w, m.h, 6);
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = "#e2e8f0";
    g.font = "600 10px Poppins, system-ui, sans-serif";
    g.fillText("⇄ " + m.label, m.x + m.w / 2, m.y - 6);
  }

  // Draw Job Post Signs / Verification Gates / Monuments & Wrong-Fit Pit Warnings
  for (const jp of G.posts) {
    const jx = jp.col * TILE, jw = jp.wCols * TILE;
    if (jx + jw < G.camX - 60 || jx > G.camX + w + 60) continue;
    const cx = jx + jw / 2;
    if (jp.fit) {
      const jy = jp.row * TILE;
      if (bank.glows[jp.applied ? "mint" : "violet"]) {
        g.drawImage(bank.glows[jp.applied ? "mint" : "violet"], cx - 48, jy - 52, 96, 96);
      }
      g.fillStyle = jp.applied ? "rgba(18,53,42,0.92)" : "rgba(23,29,59,0.92)";
      roundRectPath(g, jx, jy - 36, jw, 30, 7);
      g.fill();
      g.strokeStyle = jp.applied ? "#3ddc97" : "#8b6cf0";
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = jp.applied ? "#3ddc97" : "#fff";
      g.font = "600 11.5px Poppins, system-ui, sans-serif";
      g.fillText((jp.applied ? "✓ " : "★ ") + jp.title, cx, jy - 21);
      g.fillStyle = "#b0b6d3";
      g.font = "500 10px Poppins, system-ui, sans-serif";
      g.fillText(jp.sub, cx, jy - 10);
    } else {
      const py = 10 * TILE + 8;
      g.fillStyle = "rgba(255,93,112,0.18)";
      g.fillRect(jx, 10 * TILE, jw, 2 * TILE);
      g.fillStyle = "#ff5d70";
      g.font = "700 11px Poppins, system-ui, sans-serif";
      g.fillText("⚠ " + jp.title, cx, py);
      g.fillStyle = "#ffb3be";
      g.font = "500 10px Poppins, system-ui, sans-serif";
      g.fillText(jp.sub, cx, py + 14);
    }
  }

  // Draw Collectible Skills Badges
  for (const b of G.badges) {
    if (b.collected) continue;
    const bx = b.col * TILE + 20, by = b.row * TILE + 20 + Math.sin(G.frame * 0.08 + b.idx) * 4;
    if (bx < G.camX - 40 || bx > G.camX + w + 40) continue;
    if (bank.glows.gold) g.drawImage(bank.glows.gold, bx - 48, by - 48, 96, 96);
    g.fillStyle = "#ffd66b";
    g.beginPath();
    g.arc(bx, by, 13, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "#1d1604";
    g.font = "700 12px Poppins, system-ui, sans-serif";
    g.fillText("★", bx, by + 4);
  }

  // Draw Talkable NPCs for current level
  const npcs = currentNpcs(worldId);
  for (const npc of npcs) {
    const nx = npc.col * TILE + 20, ny = npc.row * TILE + 4;
    if (nx < G.camX - 60 || nx > G.camX + w + 60) continue;
    if (bank.glows.blue) g.drawImage(bank.glows.blue, nx - 48, ny - 32, 96, 96);
    g.fillStyle = npc.id.startsWith("anil") ? "#4da6ff" : npc.id.startsWith("meera") ? "#3ddc97" : "#a78bfa";
    roundRectPath(g, nx - 12, ny + 12, 24, 24, 6);
    g.fill();
    g.fillStyle = "#f3cfae";
    g.beginPath();
    g.arc(nx, ny + 6, 9, 0, Math.PI * 2);
    g.fill();
    const isNear = G.nearNpc?.id === npc.id;
    g.fillStyle = isNear ? "rgba(139,108,240,0.95)" : "rgba(14,18,46,0.85)";
    roundRectPath(g, nx - 64, ny - 30, 128, 22, 6);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "600 10.5px Poppins, system-ui, sans-serif";
    g.fillText(isNear ? `[E] Talk to ${npc.name.split(" ")[0]}` : npc.name, nx, ny - 15);
  }

  // Draw Mid-Level Choice Gate Kiosk at col 62 (for Stages 1..4)
  if (worldId >= 1 && worldId <= 4) {
    const ch = currentChoice(worldId);
    const cgX = ch.col * TILE + 20, cgY = ch.row * TILE;
    if (cgX > G.camX - 80 && cgX < G.camX + w + 80) {
      if (bank.glows.violet) g.drawImage(bank.glows.violet, cgX - 48, cgY - 40, 96, 96);
      g.fillStyle = "#8b6cf0";
      roundRectPath(g, cgX - 18, cgY - 10, 36, 50, 8);
      g.fill();
      g.strokeStyle = "#fff";
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = "#fff";
      g.font = "700 11px Poppins, system-ui, sans-serif";
      g.fillText(cr.choices[ch.id] ? `[E] Route: ${cr.choices[ch.id].route.toUpperCase()}` : "[E] Choice Gate", cgX, cgY - 18);
    }
  }

  // Draw Enemies
  for (let i = 0; i < MAX_ENEMIES; i++) {
    const e = ENEMIES[i];
    if (!e.active || e.x + e.w < G.camX - 40 || e.x > G.camX + w + 40) continue;
    const ey = e.squashT > 0 ? e.y + e.h - 12 : e.y;
    const eh = e.squashT > 0 ? 12 : e.h;
    g.fillStyle = e.kind === "drone" ? "#f2b84b" : e.kind === "ghost" ? "#a78bfa" : "#ff5d70";
    roundRectPath(g, e.x, ey, e.w, eh, 8);
    g.fill();
    if (e.squashT === 0) {
      g.fillStyle = "#111631";
      g.fillRect(e.x + 6, ey + 9, 6, 6);
      g.fillRect(e.x + e.w - 12, ey + 9, 6, 6);
      g.fillStyle = "#fff";
      g.font = "600 9.5px Poppins, system-ui, sans-serif";
      g.fillText(e.label, e.x + e.w / 2, ey - 5);
    }
  }

  // Draw Player-fired ★ STAR Projectiles & Boss Orbs
  for (let i = 0; i < MAX_ORBS; i++) {
    const o = ORBS[i];
    if (!o.active) continue;
    g.fillStyle = o.keyword === "★ STAR" ? "#ffd66b" : o.friendly ? "#4da6ff" : "#ff5d70";
    g.beginPath();
    g.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = 1.5;
    g.stroke();
    if (o.keyword === "★ STAR") {
      g.fillStyle = "#1d1604";
      g.font = "700 11px Poppins, system-ui, sans-serif";
      g.fillText("★", o.x, o.y + 4);
    }
  }

  // Draw Stage Boss & Override Switch (cols 84..100 in Stages 1..4)
  if (worldId >= 1 && worldId <= 4 && !G.bossDefeated && G.camX + w > 82 * TILE) {
    const swX = G.bossSwitchCol * TILE, swY = G.bossSwitchRow * TILE + 14;
    if (bank.glows.gold) g.drawImage(bank.glows.gold, swX - 28, swY - 38, 96, 96);
    g.fillStyle = G.bossSwitchCooldown > 0 ? "#8189ad" : "#f2b84b";
    roundRectPath(g, swX + 2, swY, TILE - 4, 26, 6);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "700 11px Poppins, system-ui, sans-serif";
    const swLabels: Record<number, string> = {
      1: `▼ STOMP OVERRIDE (${G.bossHp} HP)`,
      2: `▼ HONEST CRYSTAL (${G.bossHp} HP)`,
      3: `▼ STAR PODIUM / [Q] (${G.bossHp} HP)`,
      4: `▼ SEAL CONTRACT (${G.bossHp} HP)`,
    };
    g.fillText(swLabels[worldId] || swLabels[1], swX + 20, swY - 8);

    // Boss Tower at col 98
    const bx = 98 * TILE, by = 4 * TILE;
    g.fillStyle = "#1d2447";
    roundRectPath(g, bx - 16, by, 44, 6 * TILE, 8);
    g.fill();
    g.strokeStyle = worldId === 3 ? "#f2b84b" : "#ff5d70";
    g.lineWidth = 2;
    g.stroke();

    const bossTitles: Record<number, string> = {
      1: `ATS GATE · ${G.bossHp}/3`,
      2: `GATEKEEPER · ${G.bossHp}/3`,
      3: `PANEL · ${G.bossHp}/3`,
      4: `DEADLINE · ${G.bossHp}/3`,
    };
    g.fillStyle = worldId === 3 ? "#ffd66b" : "#ff5d70";
    g.font = "700 12px Poppins, system-ui, sans-serif";
    g.fillText(bossTitles[worldId] || bossTitles[1], bx + 6, by - 10);

    // In Stage 3, draw the 3 Panelists (HR, Tech, Ops) on the tower!
    if (worldId === 3) {
      const panelists: [string, boolean, number][] = [
        ["HR", G.bossHp <= 2, by + 35],
        ["TECH", G.bossHp <= 1, by + 110],
        ["OPS", G.bossHp <= 0, by + 185],
      ];
      for (const [lbl, ok, py] of panelists) {
        g.fillStyle = ok ? "#3ddc97" : "#f2b84b";
        roundRectPath(g, bx - 10, py, 32, 26, 6);
        g.fill();
        g.fillStyle = "#090c1a";
        g.font = "700 9px Poppins, system-ui, sans-serif";
        g.fillText(ok ? "✓" : lbl, bx + 6, py + 15);
      }
    }

    // Sweeping Laser Indicator
    g.strokeStyle = "rgba(255,93,112,0.55)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(84 * TILE, G.bossLaserY);
    g.lineTo(98 * TILE, G.bossLaserY);
    g.stroke();
  }

  // Draw Mentor Ghost Helper
  if (cr.mentorOn || (cr.deaths[worldId] ?? 0) >= 2) {
    const gx = G.px - G.facing * 42, gy = G.py - 22 + Math.sin(G.frame * 0.09) * 5;
    if (bank.glows.blue) g.drawImage(bank.glows.blue, gx - 32, gy - 32, 80, 80);
    g.fillStyle = "rgba(77,166,255,0.82)";
    g.beginPath();
    g.arc(gx + 12, gy + 12, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "600 10px Poppins, system-ui, sans-serif";
    g.fillText("Mentor: Jump green posts!", gx + 12, gy - 6);

    if (cr.mentorOn) {
      g.fillStyle = "rgba(61,220,151,0.55)";
      for (let step = 1; step <= 6; step++) {
        const t = step * 5;
        const ax = G.px + G.pw / 2 + G.facing * MAX_SPEED * t;
        const ay = G.py + G.ph / 2 + JUMP_FORCE * t + 0.5 * GRAVITY * t * t;
        g.beginPath();
        g.arc(ax, ay, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // Draw Hero
  drawHero(g, G.px, G.py, cr.outfit, G.facing);

  // Draw Pooled Particles
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = PARTICLES[i];
    if (!p.active) continue;
    g.globalAlpha = p.alpha;
    g.fillStyle = p.color;
    g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  g.globalAlpha = 1;

  // Draw Pooled Floating Text
  g.font = "700 13px Poppins, system-ui, sans-serif";
  for (let i = 0; i < MAX_FLOATS; i++) {
    const f = FLOATS[i];
    if (!f.active) continue;
    g.globalAlpha = Math.max(0, 1 - f.life / f.maxLife);
    g.fillStyle = f.color;
    g.fillText(f.text, f.x + 16, f.y);
  }
  g.globalAlpha = 1;

  g.restore();

  // Soft atmospheric vignette around canvas edges
  const vg = g.createRadialGradient(w / 2, h / 2, w * 0.32, w / 2, h / 2, w * 0.62);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(5,8,20,0.48)");
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
}

// ---------- Main RAF Loop (Fixed Timestep, DPR <= 2, Tab Pause) ----------
function loop(ts: number) {
  if (!G.running || ui.view !== "run") {
    G.running = false;
    return;
  }
  const cv = document.getElementById("crun-canvas") as HTMLCanvasElement | null;
  if (!cv) {
    G.running = false;
    return;
  }
  if (!document.hidden) {
    const t0 = performance.now();
    if (!G.lastTs) G.lastTs = ts;
    const rawDelta = ts - G.lastTs;
    if (rawDelta > 120) {
      G.fpsLastTs = ts;
      G.fpsFrames = 0;
    }
    const elapsed = Math.min(0.1, rawDelta / 1000);
    G.lastTs = ts;
    G.acc += elapsed;
    let steps = 0;
    while (G.acc >= DT) {
      updateFixed();
      G.acc -= DT;
      steps++;
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = cv.clientWidth || 920, ch = cv.clientHeight || 480;
    if (cv.width !== cw * dpr || cv.height !== ch * dpr) {
      cv.width = cw * dpr;
      cv.height = ch * dpr;
    }
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const c = ensureCand();
    if (c.careerRun!.current === 0) drawHubOverworld(g, cw, ch, c);
    else drawLevelCanvas(g, cw, ch, c);

    // FPS tracking (60Hz fixed-step + render budget)
    G.fpsFrames += Math.max(1, steps);
    G.frameMs = +(performance.now() - t0).toFixed(2);
    if (ts - G.fpsLastTs >= 500) {
      G.fps = Math.min(60, Math.round((G.fpsFrames * 1000) / (ts - G.fpsLastTs)));
      G.fpsFrames = 0;
      G.fpsLastTs = ts;
      const fpsEl = document.getElementById("crun-fps");
      if (fpsEl && G.fpsShow) {
        fpsEl.textContent = `${G.fps} FPS · ${G.frameMs}ms · tiles:${G.tilesDrawn}`;
      }
    }
  }
  G.rafId = requestAnimationFrame(loop);
}

export function startCareerRunLoop() {
  buildSprites();
  bindInputOnce();
  const cv = document.getElementById("crun-canvas") as HTMLCanvasElement | null;
  if (!cv) return;
  const c = ensureCand();
  const lvl = c.careerRun!.current;
  if (lvl >= 1 && (G.tiles.length === 0 || G.loadedLevel !== lvl)) {
    loadLevel(c, lvl, false);
  }
  // Bind click on Hub Map canvas nodes
  cv.onclick = (ev) => {
    const cr = c.careerRun!;
    if (cr.current !== 0) return;
    const r = cv.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top, w = r.width || 760;
    const nodes = [
      { id: 1, x: Math.round(w * 0.13), y: 260 }, { id: 2, x: Math.round(w * 0.315), y: 195 }, { id: 3, x: Math.round(w * 0.50), y: 260 },
      { id: 4, x: Math.round(w * 0.685), y: 195 }, { id: 5, x: Math.round(w * 0.87), y: 245 },
    ];
    for (const n of nodes) {
      if (Math.hypot(x - n.x, y - n.y) < 38) {
        if (n.id <= cr.unlocked) {
          G.hubNode = n.id;
          triggerInteract();
        } else {
          toast("Complete Stage " + cr.unlocked + " first!");
        }
        break;
      }
    }
  };
  if (!G.running) {
    G.running = true;
    G.lastTs = performance.now();
    G.fpsLastTs = G.lastTs;
    G.rafId = requestAnimationFrame(loop);
  }
}

// Fast DOM HUD update without re-mounting the canvas
function updateHudDom(c: Cand) {
  const cr = c.careerRun!;
  const lvl = Math.min(4, Math.max(1, cr.current || 1));
  const setTxt = (id: string, v: string) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const setBar = (id: string, v: number) => { const el = document.getElementById(id); if (el) el.style.setProperty("--to", String(v / 100)); };
  setTxt("cr-m-skills", String(cr.m.skills)); setBar("cr-b-skills", cr.m.skills);
  setTxt("cr-m-trust", String(cr.m.trust)); setBar("cr-b-trust", cr.m.trust);
  setTxt("cr-m-stamina", String(cr.m.stamina)); setBar("cr-b-stamina", cr.m.stamina);
  setTxt("cr-m-fairness", String(cr.m.fairness)); setBar("cr-b-fairness", cr.m.fairness);
  setTxt("cr-combo", `x${G.combo.toFixed(1)}`);
  const bArr = cr.badges[lvl] ?? [false, false, false];
  const bPct = Math.round((bArr.filter(Boolean).length / 3) * 100);
  setTxt("cr-badges", `★ ${bArr.filter(Boolean).length}/3 (${bPct}%)`);
  setTxt("cr-jobs", `${cr.appliedJobs.length} applied`);
  setTxt("cr-kw", `${cr.keywords.length} keywords`);
  setTxt("cr-rec-kw", cr.keywords.length ? cr.keywords.join(", ") : "None yet");
  setTxt("cr-rec-roles-hdr", `Applied Roles (${cr.appliedJobs.length})`);
  const rolesEl = document.getElementById("cr-rec-roles");
  if (rolesEl) {
    rolesEl.innerHTML = cr.appliedJobs.length
      ? cr.appliedJobs.map(j => `<span class="chip ok">✓ ${esc(j)}</span>`).join("")
      : '<span class="hint">Jump on emerald job posts in Level 1</span>';
  }
}

// ---------- DOM Glass Cards: HUD, Modals, Route Map, Results Pavilion & Live Recruiter's View ----------
function recruiterSidePanel(c: Cand) {
  const cr = c.careerRun!;
  const lim = Object.values(db.plays).at(-1)?.lim ?? newPlay(db.scenario).lim;
  const { run } = evalRun(db.scenario, db.cands, lim);
  const st = status(c);
  const cut = db.last?.cuts?.[c.id];
  return `<aside class="card cr-recpanel" aria-label="Live Recruiter's View">
    <div class="ch"><div><small>Live Telemetry · Shared Store</small><h3>Recruiter's View</h3></div><span class="chip ${st.tone || "ok"}">${esc(st.title)}</span></div>
    <p class="hint">Changes as you jump, talk and choose in Career Run. Open a Recruiter tab to see it on the Hiring Map live.</p>
    <div class="who">${avatar(c.name, 38)}<div><b>${esc(c.name)}</b><small>${esc(CITIES[c.city])} · ${c.distanceKm} km · Start Day ${c.availableDay}</small></div></div>
    <div class="cr-kv">
      <div><span>ID Gate 1</span><b class="${c.id_check === "ok" ? "ok" : "bad"}">${c.id_check === "ok" ? "Verified ✓" : c.id_check}</b></div>
      <div><span>Fairness Gate 2</span><b class="${run.fairness.passed ? "ok" : "bad"}">${run.fairness.ratio.toFixed(2)} ${run.fairness.passed ? "Passed" : "Blocked"}</b></div>
      <div><span>Panel Score</span><b class="${cr.interview.score >= 70 ? "ok" : ""}">${cr.interview.score ? cr.interview.score + "%" : "Pending"}</b></div>
      <div><span>Offer Status</span><b class="${cr.offer.status === "negotiated" || cr.offer.status === "accepted" ? "ok" : ""}">₹${cr.offer.final}/hr (${esc(cr.offer.status)})</b></div>
    </div>
    <h4 class="sp" id="cr-rec-roles-hdr">Applied Roles (${cr.appliedJobs.length})</h4>
    <div class="chips" id="cr-rec-roles">${cr.appliedJobs.length ? cr.appliedJobs.map(j => `<span class="chip ok">✓ ${esc(j)}</span>`).join("") : '<span class="hint">Jump on emerald job posts in Level 1</span>'}</div>
    <h4 class="sp">ATS Keywords</h4>
    <p class="hint" id="cr-rec-kw">${cr.keywords.length ? esc(cr.keywords.join(", ")) : "None yet"}</p>
    <h4 class="sp">Recruiter Leads</h4>
    <div class="grp"><span>Dr. Anil Rao</span><div class="track"><span class="fill" style="--to:${db.npc.anil / 100}"></span></div><b class="num">${db.npc.anil}</b></div>
    <div class="grp"><span>Meera Shah</span><div class="track"><span class="fill" style="--to:${db.npc.meera / 100}"></span></div><b class="num">${db.npc.meera}</b></div>
  </aside>`;
}

function choiceModal(c: Cand) {
  const cr = c.careerRun!;
  const ch = currentChoice(cr.current || 1);
  const prev = ch.options.find(o => o.key === G.previewChoiceKey) ?? ch.options[0];
  const p = prev.preview;
  return `<div class="cr-modal" role="dialog" aria-modal="true" aria-label="${esc(ch.title)}">
    <div class="card cr-dialog">
      <div class="ch"><div><small>Branching Choice Moment · Preview Consequences</small><h2>${esc(ch.title)}</h2></div><span class="chip warn">Changes Physical Route</span></div>
      <p class="lead">${esc(ch.prompt)}</p>
      <div class="cr-choices">
        ${ch.options.map(o => {
          const on = o.key === prev.key;
          return `<button type="button" class="opt ${on ? "on" : ""}" onclick="act('crprev','${o.key}')">
            <div class="oh"><span class="oi agent">${ic("spark")}</span><div><b>${esc(o.label)}</b><small>${esc(o.routeName)}</small></div></div>
            <p>${esc(o.desc)}</p>
            <div class="deltas" style="margin:4px 0 0">
              <i class="chip ${o.preview.trust >= 0 ? "ok" : "bad"}">Trust ${sgn(o.preview.trust)}</i>
              <i class="chip ${o.preview.skills >= 0 ? "ok" : "bad"}">Skills ${sgn(o.preview.skills)}</i>
              <i class="chip ${o.preview.fairness >= 0 ? "ok" : "bad"}">Fairness ${sgn(o.preview.fairness)}</i>
              <i class="chip">${esc(o.preview.time)}</i>
            </div>
          </button>`;
        }).join("")}
      </div>
      <div class="if"><b>Consequence Preview (${esc(prev.routeName)}):</b> Trust <b class="${p.trust >= 0 ? "ok" : "bad"}">${sgn(p.trust)}</b> · Skills <b class="ok">${sgn(p.skills)}</b> · Fairness <b class="${p.fairness >= 0 ? "ok" : "bad"}">${sgn(p.fairness)}</b> · <b>${esc(p.time)}</b>
      ${cr.choices[ch.id] ? ` · <em>Previously took: ${esc(cr.choices[ch.id].label)}</em>` : ""}</div>
      <div class="actions end">
        <button class="btn primary lg" onclick="act('crcommit','${prev.key}')">Commit to ${esc(prev.routeName)} ${ic("send")}</button>
      </div>
    </div>
  </div>`;
}

function npcModal(c: Cand, npc: NpcDef) {
  const picked = c.careerRun!.npcs[npc.id];
  const chosenOpt = npc.options.find(o => o.key === picked);
  return `<div class="cr-modal" role="dialog" aria-modal="true" aria-label="Conversation with ${esc(npc.name)}">
    <div class="card cr-dialog">
      <div class="msg">${avatar(npc.name, 48)}<div class="bub"><b>${esc(npc.name)} <small>${esc(npc.role)}</small></b><p>${esc(npc.prompt)}</p></div></div>
      <div class="you">
        ${npc.options.map(o => `<button type="button" class="reply ${picked === o.key ? "on" : ""}" onclick="act('crnpc','${npc.id}','${o.key}')">${esc(o.label)}</button>`).join("")}
      </div>
      ${chosenOpt ? `<div class="msg me"><div class="bub"><b>You</b><p>${esc(chosenOpt.label)}</p></div></div><p class="note">${esc(chosenOpt.reply)}</p>` : ""}
      <div class="actions end"><button class="btn primary" onclick="act('crnpcclose')">Continue Run</button></div>
    </div>
  </div>`;
}

function routeMapModal(c: Cand) {
  const cr = c.careerRun!;
  return `<div class="cr-modal" role="dialog" aria-modal="true" aria-label="Branching Route Map">
    <div class="card cr-dialog">
      <div class="ch"><div><small>Replay & Branch Explorer</small><h2>Your Career Route Map (Stages 1–4)</h2></div><button class="btn" onclick="act('crroute',false)">Close</button></div>
      <p class="lead">Every choice opens a physical route and updates your real application. Click <b>Try a different choice</b> on any unlocked stage to jump straight to its decision gate.</p>
      <div class="stack">
        ${[1, 2, 3, 4].map(lvl => {
          const ch = currentChoice(lvl);
          const picked = cr.choices[ch.id];
          const unlocked = cr.unlocked >= lvl;
          return `<div class="gate">
            <span class="desk">Stage ${lvl}</span><b>${esc(WORLDS[lvl].name)}</b>
            <span class="chip ${picked ? "ok" : unlocked ? "warn" : ""}">${picked ? "Taken: " + esc(picked.label) : unlocked ? "Unlocked" : "Locked"}</span>
            <div class="chips" style="margin:6px 0">
              ${ch.options.map(o => `<span class="chip ${picked?.picked === o.key ? "ok" : ""}">${picked?.picked === o.key ? "✓ " : "○ Unexplored: "}${esc(o.routeName)}</span>`).join("")}
            </div>
            ${unlocked ? `<div class="actions"><button class="btn primary" onclick="act('crtrychoice',${lvl})">Try a different choice in Stage ${lvl}</button></div>` : ""}
          </div>`;
        }).join("")}
      </div>
    </div>
  </div>`;
}

function recapModal(c: Cand) {
  const cr = c.careerRun!;
  const lvl = cr.current || 1;
  const bArr = cr.badges[lvl] ?? [false, false, false];
  const bCount = bArr.filter(Boolean).length;
  const ch = currentChoice(lvl);
  const route = cr.choices[ch.id]?.label ?? "Standard Path";
  const nextLvl = Math.min(5, lvl + 1);
  const summaryByStage: Record<number, string> = {
    1: `Route "${route}" updated your availability to Day ${c.availableDay}, ID status to ${c.id_check}, and submitted ${cr.appliedJobs.length} matched role(s).`,
    2: `Route "${route}" cleared Gate 1 ID Verification (${c.id_check}) and Gate 2 Four-Fifths Fairness Audit on the Recruiter's dashboard.`,
    3: `Route "${route}" earned unanimous Panel approval (HR ✓ · Tech ✓ · Ops ✓ · Score ${cr.interview.score}%) and placed you on the Recruiter's shortlist.`,
    4: `Route "${route}" finalized your offer at ₹${cr.offer.final}/hr (${cr.offer.role} · ${cr.offer.status.toUpperCase()}) and unlocked the Results Pavilion!`,
  };
  return `<div class="cr-modal" role="dialog" aria-modal="true" aria-label="Stage ${lvl} Complete">
    <div class="card cr-dialog">
      <div class="ch"><div><small>Checkpoint Flag Reached · Live State Written Back</small><h2 class="gtext sheen">Stage ${lvl} Complete: ${esc(WORLDS[lvl].name)}!</h2></div><span class="chip ok">Stage ${nextLvl} Unlocked</span></div>
      <p class="lead">Your choices and badges are live on the Recruiter's Hiring Map and dashboard.</p>
      <div class="kpis" style="margin:10px 0">
        <div class="card kpi"><small>Stage ${lvl} Badges</small><b class="num">${bCount}/3</b><span>${Math.round((bCount / 3) * 100)}% · Peak x${cr.comboBest.toFixed(1)}</span></div>
        <div class="card kpi"><small>Trust & Fairness</small><b class="num">${cr.m.trust} / ${cr.m.fairness}</b><span>ID: ${esc(c.id_check)}</span></div>
        <div class="card kpi"><small>Offer / Stage Status</small><b class="num">₹${cr.offer.final}/hr</b><span>${esc(cr.offer.role)}</span></div>
      </div>
      <div class="alert ok">${ic("check")}<p><b>What changed in your real application:</b> ${esc(summaryByStage[lvl] || summaryByStage[1])}</p></div>
      <div class="actions end">
        <button class="btn" onclick="act('crtrychoice',${lvl})">Try a different choice</button>
        <button class="btn" onclick="act('crreplay',${lvl})">Replay Stage ${lvl}</button>
        <button class="btn" onclick="act('crhub')">Hub Map</button>
        <button class="btn primary lg" onclick="act('crenter',${nextLvl})">Continue to ${esc(WORLDS[nextLvl].name)} ${ic("send")}</button>
      </div>
    </div>
  </div>`;
}

// Comprehensive Results Pavilion & Full Branching Journey Tree Card (shown in Stage 5)
function resultsPavilionPanel(c: Cand) {
  const cr = c.careerRun!;
  const totalBadges = [1, 2, 3, 4].reduce((sum, lvl) => sum + ((cr.badges[lvl] ?? []).filter(Boolean).length), 0);
  const st = status(c);
  return `<section class="card" style="margin-top:16px" aria-label="Results Pavilion Full Career Journey Tree">
    <div class="ch">
      <div><small>Stage 5 · Interactive Results Pavilion & Full Branching Tree</small><h2 class="gtext sheen">Career Run Complete: ${esc(cr.offer.role)} · ₹${cr.offer.final}/hr (${esc(cr.offer.status.toUpperCase())})</h2></div>
      <span class="chip ${st.tone || "ok"}">${esc(st.title)}</span>
    </div>
    <p class="lead">Every jump, NPC conversation, and branch decision you made across all 4 stages is live in the shared store. Review your taken vs. unexplored paths below — or jump back to any Choice Gate with one click.</p>
    <div class="kpis" style="margin:12px 0">
      <div class="card kpi"><small>Final Offer & Pay</small><b class="num">₹${cr.offer.final}/hr</b><span>Base ₹${cr.offer.base}/hr · ${esc(cr.offer.status)}</span></div>
      <div class="card kpi"><small>Interview Panel</small><b class="num">${cr.interview.score || 94}%</b><span>HR ✓ · Tech ✓ · Ops ✓</span></div>
      <div class="card kpi"><small>Skills Badges</small><b class="num">${totalBadges}/12</b><span>Peak Combo x${cr.comboBest.toFixed(1)} · ${cr.secrets.length} Secret(s)</span></div>
    </div>
    <div class="cr-tree-grid">
      ${[1, 2, 3, 4].map(lvl => {
        const ch = currentChoice(lvl);
        const picked = cr.choices[ch.id];
        const bCount = (cr.badges[lvl] ?? []).filter(Boolean).length;
        return `<div class="gate">
          <div class="ch"><div><span class="desk">Stage ${lvl}</span><b>${esc(WORLDS[lvl].name)}</b></div><span class="chip warn">★ ${bCount}/3 Badges</span></div>
          <p class="hint" style="margin:4px 0"><b>Taken Branch:</b> ${picked ? esc(picked.label) : "Default Route"}</p>
          <div class="chips" style="margin:6px 0">
            ${ch.options.map(o => `<span class="chip ${picked?.picked === o.key ? "ok" : ""}">${picked?.picked === o.key ? "✓ Taken: " : "○ Unexplored: "}${esc(o.routeName)}</span>`).join("")}
          </div>
          <div class="actions">
            <button class="btn" onclick="act('crtrychoice',${lvl})">Replay Stage ${lvl} Choice Gate</button>
            <button class="btn" onclick="act('crreplay',${lvl})">Replay Full Stage ${lvl}</button>
          </div>
        </div>`;
      }).join("")}
    </div>
    <div class="actions end" style="margin-top:14px">
      <button class="btn" onclick="act('go','journey')">View Candidate Journey Timeline</button>
      <button class="btn primary lg" onclick="act('crviewmap')">Switch to Recruiter Hiring Map (Live) ${ic("map")}</button>
    </div>
  </section>`;
}

export function runView(): string {
  const c = ensureCand(), cr = c.careerRun!;
  const w = WORLDS[cr.current] ?? WORLDS[0];
  const lvl = Math.min(4, Math.max(1, cr.current || 1));
  const bArr = cr.badges[lvl] ?? [false, false, false];
  const bPct = Math.round((bArr.filter(Boolean).length / 3) * 100);

  setTimeout(() => startCareerRunLoop(), 0);

  const meters: [string, string, number, string, string][] = [
    ["skills", "Skills", cr.m.skills, "spark", "revenue"],
    ["trust", "Trust", cr.m.trust, "people", "trust"],
    ["stamina", "Stamina", cr.m.stamina, "heart", "energy"],
    ["fairness", "Fairness", cr.m.fairness, "shield", "morale"],
  ];

  return `<section class="meters cr-meters" aria-label="Candidate Career Run Meters">
    ${meters.map(([k, label, val, icon, cls]) => `<div class="mtr ${cls}">
      <span class="tile">${ic(icon)}</span>
      <div>
        <div class="mv"><b class="num" id="cr-m-${k}">${val}</b><span>${label}</span></div>
        <div class="track"><span class="fill" id="cr-b-${k}" style="--to:${val / 100}"></span></div>
      </div>
      <small>/100</small>
    </div>`).join("")}
  </section>

  <div class="card cr-toolbar">
    <div class="cr-stage-info">
      <span class="desk">${cr.current === 0 ? "OVERWORLD" : "STAGE " + cr.current}</span>
      <b>${esc(w.name)}</b>
      <span class="chip ok" id="cr-combo">x${G.combo.toFixed(1)}</span>
      <span class="chip warn" id="cr-badges">★ ${bArr.filter(Boolean).length}/3 (${bPct}%)</span>
      <span class="chip" id="cr-jobs">${cr.appliedJobs.length} applied</span>
      <span class="chip" id="cr-kw">${cr.keywords.length} keywords</span>
    </div>
    <div class="cr-controls-bar">
      <div class="chips" role="group" aria-label="Role Outfit">
        ${(["picker", "rider", "lead"] as const).map(o => `<button type="button" class="chipb ${cr.outfit === o ? "on" : ""}" onclick="act('croutfit','${o}')">${o === "picker" ? "🟣 Picker" : o === "rider" ? "🟢 Rider" : "🟠 Lead"}</button>`).join("")}
      </div>
      ${cr.current === 0 ? `<button class="btn primary" onclick="act('crenter',${G.hubNode})">Enter Stage ${G.hubNode}</button>` : `<button class="btn" onclick="act('crhub')">Hub Map</button>`}
      <button class="btn ${cr.mentorOn ? "primary" : ""}" onclick="act('crmentor')" title="Dynamic Difficulty Helper">👻 Mentor ${cr.mentorOn ? "On" : "Off"}</button>
      <button class="btn" onclick="act('crroute',true)">Route Map</button>
      <button class="btn ${G.recruiterOpen ? "primary" : ""}" onclick="act('crrec')">Recruiter's View</button>
      <button class="btn" onclick="act('crsfx')">${audioMuted ? "🔇 Muted" : "🔊 SFX"}</button>
      <button class="btn" onclick="act('crfps')">FPS</button>
    </div>
  </div>

  <div class="cr-layout ${G.recruiterOpen ? "with-rec" : ""}">
    <div class="card cr-stage-wrap">
      ${G.fpsShow ? `<div id="crun-fps" class="cr-fps">60 FPS · 1.2ms · tiles:${G.tilesDrawn}</div>` : ""}
      <canvas id="crun-canvas" width="920" height="480" role="img" aria-label="${esc(w.name)} gameplay canvas"></canvas>

      ${cr.current > 0 && G.introCardOpen ? `<div class="cr-intro-card card">
        <small>${esc(w.sub)} · Real-Life Stage</small>
        <h3>${esc(w.name)}</h3>
        <p>${esc(w.intro)}</p>
        <button class="btn primary" onclick="act('crstartpan')">Start Run ${ic("send")}</button>
      </div>` : ""}

      <div class="cr-touch" aria-label="On-screen touch controls">
        <div class="cr-dpad">
          <button type="button" class="btn" onpointerdown="act('crkey','ArrowLeft',true)" onpointerup="act('crkey','ArrowLeft',false)" onpointerleave="act('crkey','ArrowLeft',false)">◀ Left</button>
          <button type="button" class="btn" onpointerdown="act('crkey','ArrowRight',true)" onpointerup="act('crkey','ArrowRight',false)" onpointerleave="act('crkey','ArrowRight',false)">Right ▶</button>
        </div>
        <div class="cr-ab">
          <button type="button" class="btn" onclick="act('crstar')">Q · ★ STAR Story</button>
          <button type="button" class="btn" onclick="act('cractkey')">E · Interact / Talk</button>
          <button type="button" class="btn primary" onpointerdown="act('crjump')" onpointerup="act('crkey','Space',false)">▲ Jump / Double Jump</button>
        </div>
      </div>

      ${G.activeNpc ? npcModal(c, G.activeNpc) : ""}
      ${G.choiceModalOpen ? choiceModal(c) : ""}
      ${G.recapOpen ? recapModal(c) : ""}
      ${G.routeMapOpen ? routeMapModal(c) : ""}
    </div>
    ${G.recruiterOpen ? recruiterSidePanel(c) : ""}
  </div>
  ${cr.current === 5 ? resultsPavilionPanel(c) : ""}`;
}

export function cract(a: string, ...r: any[]): boolean {
  if (!a.startsWith("cr")) return false;
  const c = ensureCand(), cr = c.careerRun!;
  const [x, y] = r;
  switch (a) {
    case "croutfit":
      cr.outfit = x;
      if (x === "picker") { c.distanceKm = 6; c.availableDay = 1; }
      else if (x === "rider") { c.distanceKm = 14; c.availableDay = 2; }
      else { c.distanceKm = 9; c.availableDay = 1; }
      syncToRecruiter(c);
      break;
    case "crenter": {
      const target = Number(x) || 1;
      if (target <= cr.unlocked) {
        G.hubNode = target;
        cr.current = target as CareerRunState["current"];
        loadLevel(c, target, false);
        sfx.door();
      } else {
        toast("Complete Stage " + cr.unlocked + " first!");
      }
      break;
    }
    case "crhub":
      cr.current = 0;
      G.recapOpen = false;
      G.choiceModalOpen = false;
      G.activeNpc = null;
      sfx.door();
      break;
    case "crstartpan":
      G.introCardOpen = false;
      G.introPanT = 0;
      break;
    case "crmentor":
      cr.mentorOn = !cr.mentorOn;
      toast(cr.mentorOn ? "Mentor Ghost helper enabled (Jump-arc guide + Extra Jump)" : "Mentor Ghost helper off");
      break;
    case "crroute":
      G.routeMapOpen = !!x;
      break;
    case "crrec":
      G.recruiterOpen = !G.recruiterOpen;
      break;
    case "crsfx":
      audioMuted = !audioMuted;
      if (!audioMuted) sfx.coin();
      break;
    case "crfps":
      G.fpsShow = !G.fpsShow;
      break;
    case "crkey":
      if (y) keysDown.add(x); else keysDown.delete(x);
      return true;
    case "crjump":
      keysDown.add("Space");
      G.jumpBuf = BUFFER_FRAMES;
      if (G.introCardOpen) { G.introCardOpen = false; G.introPanT = 0; render(); }
      return true;
    case "crstar":
      fireStarProjectile();
      return true;
    case "cractkey":
      triggerInteract();
      return true;
    case "crnpc": {
      const allNpcs = [...L1_NPCS, ...L2_NPCS, ...L3_NPCS, ...L4_NPCS, ...L5_NPCS];
      const npc = allNpcs.find(n => n.id === x);
      const opt = npc?.options.find(o => o.key === y);
      if (npc && opt && !cr.npcs[npc.id]) {
        cr.npcs[npc.id] = opt.key;
        if (opt.fx.trust) cr.m.trust = clampMeter(cr.m.trust + opt.fx.trust);
        if (opt.fx.skills) cr.m.skills = clampMeter(cr.m.skills + opt.fx.skills);
        if (opt.fx.fairness) cr.m.fairness = clampMeter(cr.m.fairness + opt.fx.fairness);
        if (opt.fx.stamina) cr.m.stamina = clampMeter(cr.m.stamina + opt.fx.stamina);
        if (opt.npc?.anil) db.npc.anil = clampNpc(db.npc.anil + opt.npc.anil);
        if (opt.npc?.meera) db.npc.meera = clampNpc(db.npc.meera + opt.npc.meera);
        addCombo(c, 0.5);
        sfx.coin();
        syncToRecruiter(c);
      }
      break;
    }
    case "crnpcclose":
      G.activeNpc = null;
      break;
    case "crprev":
      G.previewChoiceKey = x;
      break;
    case "crcommit": {
      const lvl = cr.current || 1;
      const ch = currentChoice(lvl);
      const opt = ch.options.find(o => o.key === x) ?? ch.options[0];
      cr.choices[ch.id] = { picked: opt.key, label: opt.label, route: opt.route, level: lvl };
      cr.m.trust = clampMeter(cr.m.trust + opt.preview.trust);
      cr.m.skills = clampMeter(cr.m.skills + opt.preview.skills);
      cr.m.fairness = clampMeter(cr.m.fairness + opt.preview.fairness);
      if (opt.set) Object.assign(c, opt.set);

      // Stage-specific outcome updates
      if (lvl === 3) {
        cr.interview.hr = true;
        if (opt.route === "high") { cr.interview.tech = true; cr.interview.score = 92; }
      } else if (lvl === 4) {
        if (opt.key === "negotiate") {
          cr.offer = { base: 185, final: 215, role: "Lead Picker · Festival Hub", status: "negotiated" };
        } else if (opt.key === "accept_fast") {
          cr.offer = { base: 185, final: 195, role: "Picker · Festival Hub", status: "accepted" };
        } else {
          cr.offer = { base: 185, final: 185, role: "Held for Next Cohort", status: "walked" };
        }
      }

      G.choiceModalOpen = false;
      sfx.powerup();

      // Physically alter the level path based on the chosen branch!
      if (opt.route === "high") {
        for (let col = 65; col <= 82; col++) G.tiles[5][col] = "=";
        G.tiles[7][64] = "="; G.tiles[6][65] = "=";
        G.tiles[3][73] = "?";
        G.py = 5 * TILE - G.ph;
        G.px = 65 * TILE;
        spawnFloat(G.px, G.py - 16, `${opt.routeName} Unlocked!`, "#3ddc97");
      } else if (opt.route === "pipe") {
        G.px = 64 * TILE + 5;
        G.py = 8 * TILE - G.ph;
        G.pipeAnimT = 28;
        spawnFloat(G.px, G.py - 16, `Entering ${opt.routeName}...`, "#a78bfa");
      } else {
        G.px = 66 * TILE;
        G.py = 9 * TILE - G.ph;
        spawnFloat(G.px, G.py - 16, `${opt.routeName} Open!`, "#f2b84b");
      }
      syncToRecruiter(c, lvl >= 4 ? "offers" : "screened");
      break;
    }
    case "crtrychoice": {
      const target = Number(x) || 1;
      cr.current = target as CareerRunState["current"];
      G.routeMapOpen = false;
      G.recapOpen = false;
      loadLevel(c, target, true);
      sfx.door();
      break;
    }
    case "crreplay": {
      const target = Number(x) || 1;
      cr.current = target as CareerRunState["current"];
      G.recapOpen = false;
      loadLevel(c, target, false);
      sfx.door();
      break;
    }
    case "crunlockall":
      cr.unlocked = 5;
      for (const lvl of [1, 2, 3, 4]) cr.badges[lvl] = [true, true, true];
      syncToRecruiter(c, "offers");
      break;
    case "crviewmap": {
      const p = signIn("recruiter", "Aarav Mehta");
      p.briefed = true;
      ui.view = "map";
      ui.mapCity = c.city;
      break;
    }
    default:
      return false;
  }
  save();
  render();
  return true;
}
