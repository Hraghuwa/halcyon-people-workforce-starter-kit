// Shared UI kit: escaping, icons, illustrated avatars, meters, charts, toasts. Every user-typed string goes through esc().
import { MKS, MN, START, type MK } from "./sim.ts";
import type { Measures } from "../engine/game.ts";

export const ui = { view: "", toast: "", charts: [] as { id: string; cfg: any }[], sort: { col: "score", dir: -1 }, tab: "" as string, chat: {} as Record<string, string> };
export let render: () => void = () => {};
export const setRender = (f: () => void) => { render = f; };

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const pct = (x: number) => Math.round(x * 100) + "%";
export const sgn = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(Math.round(n * 10) / 10);
let tt: number | undefined;
export const toast = (m: string) => { ui.toast = m; render(); clearTimeout(tt); tt = window.setTimeout(() => { ui.toast = ""; render(); }, 2800); };

const P: Record<string, string> = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  scenario: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  decide: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l3 3 5-6"/>',
  agent: '<rect x="4" y="8" width="16" height="11" rx="3.5"/><path d="M12 8V4M9 13.5h.01M15 13.5h.01M9.5 16.5h5"/>',
  impact: '<path d="M4 20V11M10 20V4M16 20v-7M22 20H2"/>', trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 20h8"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .6 3.2 2.4 3.5 5.2"/>',
  bars: '<path d="M5 20v-6M12 20V6M19 20v-10"/>', heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v5M12 16h.01"/>', spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  net: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5L6 17M12 11.5l6 5.5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', cart: '<path d="M3 4h2.5l2 11h10l2-8H7"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
  out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>', plus: '<path d="M12 5v14M5 12h14"/>', warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>', pin: '<path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>', send: '<path d="M4 12l16-8-6 16-3-7z"/>',
};
export const ic = (n: string, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] ?? ""}</svg>`;
export const MIC: Record<MK, string> = { revenue: "bars", trust: "people", morale: "heart", risk: "shield" };
export const CIC: Record<string, string> = { person: "user", genai: "spark", agent: "agent", agentic: "net" };

// Illustrated people (not initials): the same name always draws the same face.
export function avatar(seed: string, size = 40) {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const skin = ["#f3cfae", "#dba577", "#b97c52", "#8d5d3e"][h % 4], hair = ["#15151f", "#2e2018", "#51331f", "#7b5233"][(h >>> 2) % 4];
  const [a, b] = [["#5b3df5", "#9b7cf6"], ["#0ea5a4", "#4aa3ff"], ["#d64582", "#f2a65a"], ["#2f9e6e", "#7ee7b8"]][(h >>> 4) % 4], st = (h >>> 6) % 3, id = "g" + (h % 9973);
  const hairP = st === 0 ? '<path d="M15 26c0-10 4-15 9-15s9 5 9 15c-2.5-5-5.5-6.5-9-6.5S17.5 21 15 26z" />' : st === 1
    ? '<path d="M14 29c-2-12 4-18 10-18s12 6 10 18c-1-3-2-5-3-6-4-3-10-3-14 0-1 1-2 3-3 6z"/><rect x="12" y="24" width="4.5" height="13" rx="2.2"/><rect x="31.5" y="24" width="4.5" height="13" rx="2.2"/>'
    : '<path d="M15 25c1-8 5-12 9-12s8 4 9 12c-3-4-6-5-9-5s-6 1-9 5z"/>';
  return `<svg class="av" width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="${esc(seed)}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
    <circle cx="24" cy="24" r="24" fill="url(#${id})"/><path d="M6 44c1-8 8-11 18-11s17 3 18 11a24 24 0 0 1-36 0z" fill="#1a1d36"/><rect x="21" y="28" width="6" height="6" rx="2" fill="${skin}"/><ellipse cx="24" cy="23" rx="7.5" ry="8.5" fill="${skin}"/><g fill="${hair}">${hairP}</g></svg>`;
}

export function meterRow(v: Measures, d?: Measures, ghost = false) {
  return `<section class="meters" aria-label="Company measures">${MKS.map(k => {
    const dd = d ? d[k] - 0 : 0, good = (k === "risk" ? -dd : dd) >= 0;
    return `<div class="mtr ${k}"><span class="tile">${ic(MIC[k])}</span><div><div class="mv"><b class="num">${v[k]}</b><span>${MN[k]}</span>${d && dd !== 0 ? `<i class="chip ${good ? "ok" : "bad"}">${sgn(dd)}</i>` : ""}</div>
      <div class="track"><span class="fill ${ghost ? "ghost" : ""}" style="--to:${v[k] / 100}"></span><span class="start" style="left:${START[k]}%"></span></div></div><small>/100</small></div>`;
  }).join("")}</section>`;
}

// Charts are described here and drawn after render (see main.ts), so views stay plain strings.
export function chartSlot(id: string, cfg: any, h = 230) { ui.charts.push({ id, cfg }); return `<div class="chart" style="height:${h}px"><canvas id="${id}" role="img" aria-label="${esc(cfg.aria ?? id)}"></canvas></div>`; }
export const gate = (n: string) => `<span class="desk">${n}</span>`;
export const ring = (v: number, label: string, color: string) => `<div class="ringw"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" stroke="rgb(255 255 255 / .08)" stroke-width="3"/><circle cx="18" cy="18" r="15.5" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${Math.round(v * 97.4)} 97.4" transform="rotate(-90 18 18)"/></svg><b class="num">${pct(v)}</b><small>${esc(label)}</small></div>`;

// ---------- scroll-driven briefing ----------
// A tall section with a sticky stage. Words fade in as you scroll, numbers count up, and main.ts (storyTick) does the maths.
export interface Beat { line: string; stat?: { to: number; fmt?: "n" | "pct" }; sub?: string; cta?: { label: string; act: string } }
export function story(beats: Beat[], skipAct: string) {
  return `<section class="story" style="--beats:${beats.length}" aria-label="Briefing"><div class="stage">
    <button class="skip" onclick="act('${skipAct}')">Skip briefing</button><ol class="sdots" aria-hidden="true">${beats.map((_, i) => `<li data-i="${i}"></li>`).join("")}</ol>
    ${beats.map((b, i) => `<div class="beat" data-i="${i}">${b.stat ? `<div class="stat gtext sheen" data-to="${b.stat.to}" data-fmt="${b.stat.fmt ?? "n"}" aria-label="${b.stat.to}">0</div>` : ""}
      <p class="line">${b.line.split(" ").map(w => `<span class="w">${esc(w)}</span>`).join(" ")}</p>${b.sub ? `<p class="sub">${esc(b.sub)}</p>` : ""}
      ${b.cta ? `<button class="btn primary lg" onclick="act('${b.cta.act}')">${esc(b.cta.label)} ${ic("send")}</button>` : ""}</div>`).join("")}</div></section>`;
}
