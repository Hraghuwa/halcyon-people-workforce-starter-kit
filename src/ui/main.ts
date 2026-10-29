// Halcyon Basket: People & Workforce simulator. Login -> role shell -> views. Two roles: Recruiter and Candidate.
import { db, save, signIn, signOut, me, onRemoteChange, reset } from "./store.ts";
import { ui, esc, ic, avatar, meterRow, setRender, toast } from "./ui.ts";
import { START, result } from "./sim.ts";
import { overview, scenarioView, decide, agentDemo, impact, leaderboard, help, ract, playOf } from "./recruiter.ts";
import { journey, roles, chat, cHelp, cact, mine } from "./candidate.ts";

declare const Chart: any;
let role: "recruiter" | "candidate" = "recruiter";
let bump = false;
let charts: any[] = [];

const RNAV: [string, string, string][] = [["overview", "home", "Overview"], ["scenario", "scenario", "Scenario"], ["decide", "decide", "Make a Decision"], ["agent", "agent", "AI Agent Demo"], ["impact", "impact", "Your Impact"], ["leaderboard", "trophy", "Leaderboard"], ["help", "help", "Help"]];
const CNAV: [string, string, string][] = [["journey", "home", "My Journey"], ["roles", "scenario", "Open Roles"], ["chat", "chat", "Interview Chat"], ["help", "help", "Help"]];
const TITLES: Record<string, string> = { overview: "Hiring command centre", scenario: "Scenario", decide: "The Hiring Floor", agent: "AI Agent Demo", impact: "Your Impact", leaderboard: "Leaderboard", help: "Help", journey: "My Journey", roles: "Open Roles", chat: "Interview Chat" };

const cartArt = `<svg viewBox="0 0 120 90" class="cart" aria-hidden="true"><rect x="62" y="30" width="30" height="26" rx="3" fill="#c99556"/><rect x="74" y="30" width="6" height="26" fill="#e8c78d" opacity=".8"/><rect x="44" y="40" width="26" height="20" rx="3" fill="#b68446"/>
  <path d="M10 18h14l10 40h50l8-28H30" fill="none" stroke="#9b7cf6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="42" cy="72" r="6" fill="#9b7cf6"/><circle cx="78" cy="72" r="6" fill="#9b7cf6"/></svg>`;

type Prof = NonNullable<ReturnType<typeof me>>;
function topbar(p: Prof) {
  const rounds: [string, string][] = [["1", "Day 1-3"], ["2", "Day 4-7"], ["3", "Day 8-10"], ["4", "Day 11-13"]];
  return `<header class="top"><div class="brand">${ic("cart")}<b>Halcyon<br>Basket</b></div><p class="tag">Delivering more<br>to every home</p>
    <ol class="rounds" aria-label="Game rounds">${rounds.map(([n, d], i) => `<li class="${i === 0 ? "now" : "locked"}" title="${i === 0 ? "Round 1 is playable" : "Coming soon"}"><span class="rn">${n}</span><div><b>${d}</b><small>${i === 0 ? "People &amp; Workforce" : "Coming soon"}</small></div></li>`).join("")}
    <li class="locked"><span class="rn">${ic("check")}</span><div><b>Day 14</b><small>Board Review</small></div></li></ol>
    <button class="icon" aria-label="Notifications">${ic("bell")}</button>
    <div class="me">${avatar(p.name, 38)}<div><b>${esc(p.name)}</b><small>${p.role === "recruiter" ? "Recruiter" : "Candidate"}</small></div><button class="icon" aria-label="Sign out" title="Sign out" onclick="act('logout')">${ic("out")}</button></div></header>`;
}
function rail(p: Prof) {
  const nav = p.role === "recruiter" ? RNAV : CNAV;
  return `<nav class="rail" aria-label="Main">${nav.map(([k, i, l]) => `<button class="nav ${ui.view === k ? "on" : ""}" ${ui.view === k ? 'aria-current="page"' : ""} onclick="act('go','${k}')">${ic(i)}<span>${l}</span></button>`).join("")}
    <div class="promo">${cartArt}<b>Festival Sale</b><small>Be Ready. Deliver More.</small><button class="linkb" onclick="act('wipe')">Reset all game data</button></div></nav>`;
}

function login() {
  const rc = role === "recruiter";
  return `<div class="login"><section class="lhero"><div class="brand big">${ic("cart")}<b>Halcyon Basket</b></div>
    <h1 class="gtext sheen">${rc ? "You decide who gets hired." : "You are the one waiting for the call."}</h1>
    <p>${rc ? "600 festival jobs. 8,400 applicants. 12 tired recruiters. Use an AI agent, and keep people in charge." : "Apply for a festival job, chat with the screening assistant, and see exactly why the system decided what it did."}</p>
    <div class="lstats"><div><b class="num">8,400</b><small>applications in 2 days</small></div><div><b class="num">3</b><small>human gates</small></div><div><b class="num">4</b><small>ways to hire</small></div></div></section>
    <section class="lcard"><div class="seg2" role="tablist" aria-label="Choose your role">${(["recruiter", "candidate"] as const).map(r => `<button role="tab" aria-selected="${role === r}" data-k="role-${r}" onclick="act('role','${r}')">${ic(r === "recruiter" ? "decide" : "user")}<b>${r === "recruiter" ? "Recruiter" : "Candidate"}</b><small>${r === "recruiter" ? "Create the scenario and run the hiring" : "Apply and get hired"}</small></button>`).join("")}</div>
    <label class="field col"><b>Your name</b><input id="nm" class="text" data-k="nm" maxlength="30" placeholder="${rc ? "For example: Shreya" : "For example: Priya"}" onkeydown="if(event.key==='Enter')act('login')"></label>
    <button class="btn primary wide" data-k="go" onclick="act('login')">Continue as ${rc ? "Recruiter" : "Candidate"} ${ic("send")}</button>
    <p class="hint">No password: this is a classroom game. To see both sides at once, open this page in a second tab and sign in as the other role.</p></section></div>`;
}

function app(p: Prof) {
  ui.charts = [];
  const v = ui.view;
  const body = p.role === "recruiter" ? (({ overview, scenario: scenarioView, decide, agent: agentDemo, impact, leaderboard, help } as Record<string, () => string>)[v] ?? overview)()
    : (({ journey, roles, chat, help: cHelp } as Record<string, () => string>)[v] ?? roles)();
  const imm = body.startsWith('<section class="story"');
  if (imm) return `${topbar(p)}<div class="shell imm"><main id="main" tabindex="-1">${body}</main></div>`;
  let meters = "";
  if (p.role === "recruiter") {
    const pl = playOf();
    if (pl?.choice) { const r = result(pl, db.scenario, db.cands); meters = meterRow(r.measures, r.deltas, pl.day < 4); } else meters = meterRow(START);
  }
  return `${topbar(p)}<div class="shell">${rail(p)}<main id="main" tabindex="-1"><div class="pagehead"><h1 class="gtext sheen">${TITLES[v] ?? ""}</h1></div>${meters}${body}</main></div>`;
}

function draw() {
  charts.forEach(c => c.destroy()); charts = [];
  if (typeof Chart === "undefined") { document.querySelectorAll(".chart").forEach(e => (e.innerHTML = '<p class="hint">Charts need an internet connection to load.</p>')); return; }
  Chart.defaults.color = "#aab0cf"; Chart.defaults.borderColor = "rgba(255,255,255,.07)"; Chart.defaults.font.family = "Poppins, system-ui, sans-serif";
  ui.charts.forEach(({ id, cfg }) => {
    const el = document.getElementById(id) as HTMLCanvasElement | null; if (!el) return;
    const o = cfg.options ?? {};
    charts.push(new Chart(el, { ...cfg, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 450 }, ...o,
      plugins: { ...(o.plugins ?? {}), legend: { ...(o.plugins?.legend ?? {}), labels: { usePointStyle: true, boxWidth: 8 } } } } }));
  });
}

// ---------- interactive text scroll ----------
// Progress p runs 0..beats while the sticky stage is pinned. Each beat: words reveal, numbers count, then it fades out.
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function storyTick() {
  const s = document.querySelector<HTMLElement>(".story"); if (!s || reduce.matches) return;
  const beats = [...s.querySelectorAll<HTMLElement>(".beat")], n = beats.length, stage = s.querySelector<HTMLElement>(".stage")!;
  const top = document.querySelector<HTMLElement>(".top")?.offsetHeight ?? 66, r = s.getBoundingClientRect();
  const p = Math.max(0, Math.min(n, ((top - r.top) / Math.max(1, r.height - stage.offsetHeight)) * n));
  beats.forEach((b, i) => {
    const t = clamp01(p - i), last = i === n - 1, on = last ? p >= i : p >= i && p < i + 1;
    b.classList.toggle("on", on); b.style.opacity = on ? String(last || t < .82 ? 1 : 1 - (t - .82) / .18) : "0";
    const ws = b.querySelectorAll<HTMLElement>(".w");
    ws.forEach((w, k) => { const v = clamp01((t / .5) * ws.length - k); w.style.opacity = String(0.08 + 0.92 * v); w.style.transform = `translateY(${(1 - v) * 16}px)`; w.style.filter = `blur(${(1 - v) * 6}px)`; });
    const st = b.querySelector<HTMLElement>(".stat");
    if (st) { const e = 1 - Math.pow(1 - clamp01(t / .45), 3), to = +st.dataset.to!; st.textContent = st.dataset.fmt === "pct" ? Math.round(to * e) + "%" : Math.round(to * e).toLocaleString(); st.style.setProperty("--sx", clamp01(t) * 120 - 10 + "%"); st.style.setProperty("--sy", "30%"); }
    const late = clamp01((t - .5) / .2);
    b.querySelectorAll<HTMLElement>(".sub,.btn").forEach(e => { e.style.opacity = String(late); e.style.pointerEvents = late > .6 ? "auto" : "none"; });
  });
  s.querySelectorAll<HTMLElement>(".sdots li").forEach((d, i) => d.classList.toggle("on", i === Math.min(n - 1, Math.floor(p))));
}
// Liquid-glass light: the highlight on a card and on glass headlines follows the pointer.
let pr = 0, pe: PointerEvent | null = null;
addEventListener("pointermove", e => {
  pe = e; if (pr) return;
  pr = requestAnimationFrame(() => {
    pr = 0; if (!pe) return;
    const c = (pe.target as HTMLElement | null)?.closest?.(".card") as HTMLElement | null;
    if (c) { const r = c.getBoundingClientRect(); c.style.setProperty("--mx", pe.clientX - r.left + "px"); c.style.setProperty("--my", pe.clientY - r.top + "px"); }
    document.querySelectorAll<HTMLElement>(".gtext.sheen:not(.stat)").forEach(el => { const r = el.getBoundingClientRect(); el.style.setProperty("--sx", ((pe!.clientX - r.left) / Math.max(1, r.width)) * 100 + "%"); el.style.setProperty("--sy", ((pe!.clientY - r.top) / Math.max(1, r.height)) * 100 + "%"); });
  });
}, { passive: true });
addEventListener("scroll", storyTick, { passive: true });

function paint() {
  const root = document.getElementById("app")!, fk = (document.activeElement as HTMLElement | null)?.dataset?.k, nm = (document.getElementById("nm") as HTMLInputElement | null)?.value;
  const p = me();
  if (p && !ui.view) ui.view = p.role === "recruiter" ? "overview" : mine() ? "journey" : "roles";
  root.innerHTML = (p ? app(p) : login()) + (ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : "");
  if (!p && nm) (document.getElementById("nm") as HTMLInputElement).value = nm;
  document.title = p ? `${TITLES[ui.view] ?? "Halcyon"} · Halcyon People & Workforce` : "Halcyon People & Workforce Simulator";
  document.documentElement.style.setProperty("--toph", (document.querySelector<HTMLElement>(".top")?.offsetHeight ?? 70) + "px");
  draw(); storyTick();
  if (fk) (document.querySelector(`[data-k="${fk}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  if (bump) { bump = false; const m = document.querySelectorAll(".stack .msg, .stack .gate"); m[m.length - 1]?.scrollIntoView({ behavior: "smooth", block: "center" }); }
}
setRender(paint);

(window as any).act = (a: string, ...r: any[]) => {
  if (a === "go") { ui.view = r[0]; paint(); window.scrollTo({ top: 0 }); return; }
  if (a === "role") { role = r[0]; paint(); return; }
  if (a === "login") { const p = signIn(role, (document.getElementById("nm") as HTMLInputElement)?.value ?? ""); ui.view = ""; paint(); toast("Welcome, " + p.name); return; }
  if (a === "logout") { signOut(); ui.view = ""; paint(); return; }
  if (a === "brief") { const p = me(); if (p) { p.briefed = true; save(); } ui.view = p?.role === "candidate" ? "roles" : "decide"; paint(); window.scrollTo({ top: 0 }); return; }
  if (a === "rebrief") { const p = me(); if (p) { p.briefed = false; save(); } ui.view = p?.role === "candidate" ? "roles" : "decide"; paint(); window.scrollTo({ top: 0 }); return; }
  if (a === "wipe") { if (confirm("Erase all scenarios, candidates and scores on this browser?")) { reset(); signOut(); ui.view = ""; paint(); } return; }
  if (["case", "decision", "run", "day", "finish"].includes(a)) bump = true;
  if (ract(a, ...r) || cact(a, ...r)) return;
};
onRemoteChange(paint);
paint();
