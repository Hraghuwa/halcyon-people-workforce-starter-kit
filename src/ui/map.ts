// Hiring Map: see where the agent's shortlist falls on a city. Rings are commute distance from the hub.
// Positions are generated from each person's distance (direction is random), so the map shows distance, not real streets.
import { db, save, me } from "./store.ts";
import { esc, pct, toast, render } from "./ui.ts";
import { CITIES, evalRun, buildPool, newPlay } from "./sim.ts";
import { playOf } from "./recruiter.ts";
import type { Applicant, HiringLimits } from "../engine/hiringAgent.ts";

type Layer = "applied" | "shortlist" | "fairness";
const st = { city: 0, layer: "shortlist" as Layer, lim: null as HiringLimits | null };
const BANDS: [number, number][] = [[0, 6], [6, 12], [12, 18], [18, 24], [24, 31]];
const C = { ok: "#3ddc97", gate: "#f2b84b", low: "#4da6ff", other: "#a78bfa", dim: "rgba(255,255,255,.16)", bad: "#ff6b7d" };

const lim = (): HiringLimits => st.lim ?? playOf()?.lim ?? newPlay(db.scenario).lim;
const h01 = (n: number) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
const pos = (a: Applicant) => { const t = h01(a.id * 7 + 1) * Math.PI * 2, r = Math.max(0.4, a.distanceKm + (h01(a.id * 13 + 5) - 0.5) * 1.2); return { x: r * Math.cos(t), y: r * Math.sin(t) }; };

function model() {
  const s = db.scenario; if (st.city >= s.cities) st.city = 0;
  const l = lim(), { run, out } = evalRun(s, db.cands, l), { pool, realMap } = buildPool(s, db.cands);
  const all = pool.filter(a => a.city === st.city), adults = all.filter(a => a.age >= 18);
  const sl = new Set(run.shortlist.map(a => a.id)), rv = new Set(run.review.map(r => r.id));
  const bands = BANDS.map(([lo, hi]) => { const inb = adults.filter(a => a.distanceKm >= lo && a.distanceKm < hi), n = inb.filter(a => sl.has(a.id)).length; return { label: `${lo}-${hi - 1} km`, total: inb.length, n, rate: inb.length ? n / inb.length : 0 }; });
  const shortHere = all.filter(a => sl.has(a.id)), reach = Math.max(0, ...shortHere.map(a => a.distanceKm));
  const far = adults.filter(a => a.distanceKm > reach).length;
  const real = [...realMap.entries()].filter(([, c]) => c.city === st.city).map(([id, c]) => ({ id, c, a: all.find(x => x.id === id)! }));
  return { l, run, out, all, adults, sl, rv, bands, reach, far, real, realMap };
}
let drawn: { pts: { x: number; y: number; a: Applicant; real?: string }[]; m: ReturnType<typeof model> } | null = null;

const statusOf = (m: ReturnType<typeof model>, a: Applicant) => m.sl.has(a.id) ? "Shortlisted" : m.rv.has(a.id) ? "Waiting for a person to check their ID" : a.age < 18 ? "Under 18: not eligible" : "Not shortlisted: ranked below the cutoff";

export function mapView() {
  const s = db.scenario, m = model(), p = playOf(), canApply = !!p && p.day === 1 && p.choice === "agent";
  const sw = (k: string, title: string, why: string, on: boolean) => `<div class="lever"><div class="lh"><div><b>${title}</b><p>${why}</p></div><button type="button" class="sw" role="switch" aria-checked="${on}" aria-label="${title}" data-k="m-${k}" onclick="act('maplim','${k}',${!on})"><span></span></button></div></div>`;
  const chip = (on: boolean, label: string, a: string, k: string) => `<button type="button" class="chipb ${on ? "on" : ""}" aria-pressed="${on}" data-k="${k}" onclick="${a}">${label}</button>`;
  const mx = Math.max(...m.bands.map(b => b.rate), 0.001);
  return `<div class="two wide"><section class="card mapcard"><div class="ch"><div><small>${esc(CITIES[st.city])} · hub in the centre</small><h2>Who the agent can see</h2></div></div>
    <div class="chips" role="group" aria-label="City">${CITIES.slice(0, s.cities).map((n, i) => chip(st.city === i, n, `act('mapcity',${i})`, "mc-" + i)).join("")}</div>
    <div class="chips lay" role="group" aria-label="Layer">${([["applied", "Who applied"], ["shortlist", "Shortlist"], ["fairness", "Fairness by distance"]] as [Layer, string][]).map(([k, l]) => chip(st.layer === k, l, `act('maplayer','${k}')`, "ml-" + k)).join("")}</div>
    <div class="mapwrap"><canvas id="mapc" role="img" aria-label="Map of applicants around the hub in ${esc(CITIES[st.city])}. ${m.reach} km is the farthest shortlisted distance."></canvas><div id="maptip" class="tip" hidden></div></div>
    <div class="legend">${st.layer === "applied" ? `<span><i style="background:${C.low}"></i>Outer or lower-income area</span><span><i style="background:${C.other}"></i>Central area</span>`
      : `<span><i style="background:${C.ok}"></i>Shortlisted</span><span><i style="background:${C.gate}"></i>ID needs a person</span><span><i style="background:${C.dim}"></i>Not shortlisted</span>`}<span><i class="ringi"></i>Your real candidates</span></div>
    <p class="hint">Dots are placed by each person's distance from the hub. Direction is random, so read the rings, not the streets.</p></section>
  <aside class="stack"><section class="card"><h3>${m.far ? "A blind spot" : "No blind spot"}</h3>
    <p class="${m.far ? "bad" : "ok"}">${m.far ? `Everyone shortlisted lives within <b>${m.reach} km</b>. <b>${m.far}</b> eligible applicants live farther, and the agent never sees them.` : "Everyone eligible lives within the shortlist's reach."}</p>
    <h3 class="sp">Share shortlisted, by distance</h3>${m.bands.map(b => `<div class="grp band"><span>${b.label}</span><div class="track"><span class="fill ${b.total && b.rate / mx < 0.4 ? "risk" : ""}" style="--to:${b.rate / mx}"></span></div><b class="num">${b.total ? pct(b.rate) : "n/a"}</b></div>`).join("")}
    <small>Overall: ${m.run.shortlist.length} shortlisted of ${(s.applications + db.cands.length).toLocaleString()} across ${s.cities} cities. Fairness ratio ${m.run.fairness.ratio.toFixed(2)} (needs 0.80).</small></section>
  <section class="card"><h3>What if...</h3><p class="hint">Change the agent's rules and watch the map change. This does not alter your game until you apply it.</p>
    ${sw("balancePins", "Reserve places for every pin-code group", "Fixes parity between groups.", m.l.balancePins)}${sw("idLate", "Check IDs only for the shortlist", "Frees up recruiters.", !m.l.idFirst)}
    <div class="actions"><button class="btn primary" ${canApply ? "" : "disabled"} onclick="act('mapuse')">Use these rules in my game</button>${canApply ? "" : '<small>Start Day 1 and pick the AI agent to apply them.</small>'}</div></section>
  <section class="card"><h3>Your real candidates here</h3>${m.real.length ? m.real.map(r => `<div class="row"><span class="dotl ${m.sl.has(r.id) ? "ok" : m.rv.has(r.id) ? "gate" : ""}"></span><div class="grow"><b>${esc(r.c.name)}</b><small>${r.c.distanceKm} km · ${esc(statusOf(m, r.a))}</small></div></div>`).join("") : '<p class="hint">No real candidates in this city yet. Open a Candidate tab and apply.</p>'}</section></aside></div>`;
}

export function drawMap() {
  const cv = document.getElementById("mapc") as HTMLCanvasElement | null; if (!cv || me()?.role !== "recruiter") return;
  const m = model(), dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = w / 2, cy = h / 2, k = (Math.min(w, h) / 2 - 26) / 31;                  // pixels per km
  // rings, tinted by the share shortlisted in each distance band when the fairness layer is on
  const mx = Math.max(...m.bands.map(b => b.rate), 0.001);
  for (let i = BANDS.length - 1; i >= 0; i--) {
    const [lo, hi] = BANDS[i], b = m.bands[i];
    g.beginPath(); g.arc(cx, cy, hi * k, 0, Math.PI * 2); g.arc(cx, cy, lo * k, 0, Math.PI * 2, true);
    if (st.layer === "fairness" && b.total) { const rel = b.rate / mx; g.fillStyle = rel >= 0.8 ? "rgba(61,220,151,.16)" : rel >= 0.4 ? "rgba(242,184,75,.16)" : "rgba(255,107,125,.2)"; } else g.fillStyle = i % 2 ? "rgba(255,255,255,.025)" : "rgba(255,255,255,.05)";
    g.fill("evenodd");
  }
  g.strokeStyle = "rgba(255,255,255,.12)"; g.fillStyle = "rgba(255,255,255,.45)"; g.font = "11px Poppins, system-ui, sans-serif"; g.lineWidth = 1;
  BANDS.forEach(([lo, hi], i) => { g.beginPath(); g.arc(cx, cy, hi * k, 0, Math.PI * 2); g.stroke(); if (i < BANDS.length - 1) g.fillText(`${hi} km`, cx + hi * k * 0.707 + 4, cy - hi * k * 0.707 - 2); });
  // dots: dim ones first so the shortlist sits on top
  const pts = m.all.map(a => { const p = pos(a); return { x: cx + p.x * k, y: cy + p.y * k, a }; });
  const order = (a: Applicant) => (st.layer === "applied" ? 0 : m.sl.has(a.id) ? 2 : m.rv.has(a.id) ? 1 : 0);
  [...pts].sort((p, q) => order(p.a) - order(q.a)).forEach(({ x, y, a }) => {
    let col: string, r = 2.1;
    if (st.layer === "applied") col = a.lowIncomePin ? C.low : C.other;
    else if (m.sl.has(a.id)) { col = C.ok; r = 3; } else if (m.rv.has(a.id)) { col = C.gate; r = 2.8; } else col = a.age < 18 ? "rgba(255,255,255,.07)" : C.dim;
    g.globalAlpha = st.layer === "applied" ? 0.8 : 1; g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  });
  g.globalAlpha = 1;
  // hub
  g.fillStyle = "#fff"; g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#8b6cf0"; g.lineWidth = 3; g.stroke();
  // real candidates, with a halo and a name
  const realPts: typeof pts = [];
  m.real.forEach(({ id, c }) => { const p = pts.find(q => q.a.id === id); if (!p) return; (p as any).real = c.name; realPts.push(p);
    g.lineWidth = 2; g.strokeStyle = "#fff"; g.fillStyle = m.sl.has(id) ? C.ok : m.rv.has(id) ? C.gate : "#ff6b7d"; g.beginPath(); g.arc(p.x, p.y, 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = "#fff"; g.font = "600 12px Poppins, system-ui, sans-serif"; g.fillText(c.name.split(" ")[0], p.x + 10, p.y + 4); });
  drawn = { pts, m };
}

// hover: show who a dot is (updates the tooltip directly, no re-render)
addEventListener("pointermove", e => {
  const tip = document.getElementById("maptip"), cv = document.getElementById("mapc") as HTMLCanvasElement | null;
  if (!tip || !cv || !drawn) return;
  if (e.target !== cv) { tip.hidden = true; return; }
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  let best: (typeof drawn.pts)[number] | null = null, bd = 100;
  for (const p of drawn.pts) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
  if (!best) { tip.hidden = true; return; }
  const a = best.a, real = (best as any).real as string | undefined;
  tip.innerHTML = `<b>${real ? esc(real) + " (real candidate)" : "Applicant #" + (a.id + 1)}</b><span>${a.distanceKm} km · ${a.lowIncomePin ? "outer or lower-income area" : "central area"} · can start Day ${a.availableDay}</span><span class="st">${esc(statusOf(drawn.m, a))}</span>`;
  tip.hidden = false; tip.style.left = Math.min(x + 14, r.width - 230) + "px"; tip.style.top = Math.max(4, y - 10) + "px";
}, { passive: true });
addEventListener("resize", () => drawMap());

export function mact(a: string, ...r: any[]): boolean {
  if (me()?.role !== "recruiter") return false;
  const [x, y] = r;
  switch (a) {
    case "mapcity": st.city = x; break;
    case "maplayer": st.layer = x; break;
    case "maplim": { const l = { ...lim() } as any; if (x === "idLate") l.idFirst = !y; else l[x] = y; st.lim = l; break; }
    case "mapuse": { const p = playOf(); if (p && st.lim) { p.lim = { ...st.lim }; save(); st.lim = null; toast("Rules applied to your game"); } else toast("Change a rule first"); break; }
    default: return false;
  }
  render(); return true;
}
