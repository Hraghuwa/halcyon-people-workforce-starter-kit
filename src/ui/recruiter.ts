// Recruiter side: dashboard, scenario builder, and "The Hiring Floor" (a first-person, three-day play).
import { db, save, me, clampNpc } from "./store.ts";
import { ui, esc, ic, avatar, chartSlot, gate, ring, pct, sgn, toast, render, CIC, story, type Beat } from "./ui.ts";
import { S, R1, START, MKS, MN, CITIES, CASES, PERSONAS, DEFAULT_SCENARIO, newPlay, evalRun, funnel, result, lastRunFor, netScore, companyScore,
  type Play, type Decision, type ScenarioCfg } from "./sim.ts";
import type { HiringLimits } from "../engine/hiringAgent.ts";

const sc = (): ScenarioCfg => db.scenario;
export const playOf = (): Play | undefined => { const m = me(); return m ? db.plays[m.id] : undefined; };
const nCands = () => db.cands.filter(c => c.city < sc().cities).length;

const art = `<svg viewBox="0 0 360 150" class="art" aria-hidden="true"><defs><linearGradient id="belt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#303663"/><stop offset="1" stop-color="#151934"/></linearGradient></defs>
<rect width="360" height="150" fill="#0d1127"/><g stroke="#2a3060" opacity=".6">${[20, 50, 80].map(y => `<path d="M0 ${y}H360"/>`).join("")}${[40, 120, 200, 280].map(x => `<path d="M${x} 0V70"/>`).join("")}</g>
<polygon points="0,102 360,82 360,124 0,150" fill="url(#belt)"/><g>${[[24, 84], [88, 80], [160, 74], [238, 68], [300, 64]].map(([x, y], i) => `<rect x="${x}" y="${y}" width="36" height="28" rx="3" fill="${i % 2 ? "#c99556" : "#b68446"}"/><rect x="${x + 15}" y="${y}" width="6" height="28" fill="#e8c78d" opacity=".7"/>`).join("")}</g>
<g>${[[60, 70], [200, 58], [330, 52]].map(([x, y]) => `<circle cx="${x}" cy="${y - 14}" r="6" fill="#e2b48c"/><rect x="${x - 8}" y="${y - 7}" width="16" height="24" rx="6" fill="#f2b84b"/><rect x="${x - 8}" y="${y + 2}" width="16" height="3" fill="#fff" opacity=".7"/>`).join("")}</g></svg>`;

const facts = () => `<div class="facts">${[["people", sc().vacancies, "Temporary workers"], ["pin", sc().cities, "Cities"], ["doc", (sc().applications + nCands()).toLocaleString(), "Applications received"],
  ["user", sc().recruiters, "Recruiters available"], ["clock", "6 days", "Current hiring process"], ["warn", "45%", "Quit rate (last festival)"]].map(([i, v, l]) =>
  `<div>${ic(i as string)}<b class="num">${v}</b><small>${l}</small></div>`).join("")}</div>`;

const briefCard = () => `<section class="card brief"><div class="kick"><b>Round 1</b><span>Day 1 - 3</span></div><h2>${esc(sc().title)}</h2>
  <p>${esc(R1.brief.split(" Data shown")[0].replace(/600/, String(sc().vacancies)))}</p>${art}${facts()}
  <div class="alert">${ic("warn")}<p>If we fail to hire enough workers, stores stay understaffed, which hurts delivery times and customer experience.</p></div></section>`;

// ---------- Briefing (scroll-driven story, shown once per recruiter) ----------
export const recruiterBeats = (): Beat[] => {
  const s = sc(), read = Math.min(1, (s.recruiters * 60 * 2) / s.applications);
  return [
    { line: "It is festival season. Halcyon Basket is about to get very busy.", sub: "Marketing forecasts orders up 80%. Every store needs more hands." },
    { stat: { to: s.applications }, line: `people applied for ${s.vacancies} jobs in two days.`, sub: "Stores need them on the floor by Day 4." },
    { stat: { to: Math.max(1, Math.round(read * 100)), fmt: "pct" }, line: `is all that ${s.recruiters} recruiters can read in that time.`, sub: "About 60 CVs a day, each. The rest sit in a pile." },
    { stat: { to: 45, fmt: "pct" }, line: "of last festival's temps quit within a month.", sub: "Hire fast and hire wrong, and it costs you twice." },
    { line: "An AI agent can read every application tonight. But who decides who gets a job?", cta: { label: "Take the desk", act: "brief" } },
  ];
};

// ---------- Overview ----------
export function overview() {
  const p = playOf(), s = sc(), tmp = p ?? newPlay(s), pf = { ...tmp, choice: tmp.choice || "agent", day: 3 as const, decision: (tmp.decision || "approve") as Decision };
  const f = funnel(pf, s, db.cands), { run, out } = evalRun(s, db.cands, tmp.lim);
  const cand = db.cands.slice(-5).reverse();
  const open = db.cands.filter(c => c.challenge && !c.challenge.resolution).length;
  return `<div class="hero card"><div><small>${s.published ? "Scenario live" : "Scenario draft"}</small><h2>Hello, ${esc(me()?.name)}. ${s.published ? "Candidates are applying." : "Build and publish a scenario so candidates can apply."}</h2>
    <p>${s.published ? `${nCands()} real candidate${nCands() === 1 ? "" : "s"} joined the ${(s.applications).toLocaleString()} simulated applicants.` : "Your scenario sets how many places, cities, applications and recruiters the game uses."}</p></div>
    <div class="cta">${s.published ? `<button class="btn primary" onclick="act('go','decide')">${p ? "Continue your play" : "Start Day 1"} ${ic("send")}</button>` : `<button class="btn primary" onclick="act('go','scenario')">Create scenario</button>`}</div></div>
  <div class="kpis">${[["Applications", (s.applications + nCands()).toLocaleString(), "received over two days"], ["Shortlisted", String(run.shortlist.length), "by the agent, with clear ID"],
    ["Places filled", pct(out.fillRate), `of ${s.vacancies} (projected)`], ["Stay 30 days", pct(out.stay30), "last festival: 55%"]].map(([l, v, n]) =>
    `<div class="card kpi"><small>${l}</small><b class="num">${v}</b><span>${n}</span></div>`).join("")}</div>
  <div class="two"><section class="card"><h3>Hiring funnel by day</h3><p class="hint">Cumulative, on a log scale. Illustrative timeline for the approach you picked (agent if none yet).</p>
    ${chartSlot("c-funnel", { type: "line", aria: "Hiring funnel by day, log scale", options: { scales: { y: { type: "logarithmic", min: 10 } } }, data: { labels: f.days, datasets: [
      { label: "Applications", data: f.applications, borderColor: "#4da6ff", backgroundColor: "#4da6ff22", fill: true, tension: .35 }, { label: "Screened", data: f.screened.map(z => z || null), borderColor: "#a78bfa", tension: .35 },
      { label: "Shortlisted", data: f.shortlisted.map(z => z || null), borderColor: "#f2b84b", tension: .35 }, { label: "Offers", data: f.offers.map(z => z || null), borderColor: "#37d783", tension: .35 }] } }, 250)}</section>
    <section class="card"><h3>Your people</h3>${npcRow("meera")}${npcRow("anil")}<h3 class="sp">Candidates today ${open ? `<i class="chip bad">${open} challenge${open > 1 ? "s" : ""}</i>` : ""}</h3>
    ${cand.length ? cand.map(c => `<div class="row">${avatar(c.name, 32)}<div><b>${esc(c.name)}</b><small>${esc(CITIES[c.city])} · ${c.distanceKm} km</small></div>${c.challenge && !c.challenge.resolution ? '<i class="chip bad">challenge</i>' : ""}</div>`).join("") : '<p class="hint">No real candidates yet. Open a Candidate tab and apply to see them here.</p>'}</section></div>`;
}
function npcRow(k: "meera" | "anil") {
  const v = db.npc[k], name = k === "meera" ? "Meera Shah" : "Dr. Anil Rao", role = k === "meera" ? "Store operations" : "HR Lead";
  const mood = v >= 65 ? "Trusts you" : v >= 40 ? "Watching" : "Wary of you";
  return `<div class="row">${avatar(name, 36)}<div class="grow"><b>${name}</b><small>${role} · ${mood}</small><div class="track"><span class="fill" style="--to:${v / 100}"></span></div></div><b class="num">${v}</b></div>`;
}

// ---------- Scenario builder ----------
const stepper = (k: keyof ScenarioCfg, label: string, lo: number, hi: number, step: number, hint: string) => `<div class="field"><div><b>${label}</b><small>${hint}</small></div>
  <div class="stepper"><button type="button" aria-label="Less ${label}" onclick="act('sc','${k}',${-step},${lo},${hi})">${"−"}</button><b class="num">${(sc()[k] as number).toLocaleString()}</b><button type="button" aria-label="More ${label}" onclick="act('sc','${k}',${step},${lo},${hi})">+</button></div></div>`;
export function scenarioView() {
  const s = sc(), humanCap = s.recruiters * 60 * 2;
  return `<div class="two wide"><section class="card"><h2>Create your scenario</h2><p class="lead">You are the game master. Set the festival rush, then publish it. Candidates then see the opening and apply.</p>
    <label class="field col"><b>Scenario title</b><input class="text" data-k="title" value="${esc(s.title)}" maxlength="60" onchange="act('title',this.value)"></label>
    ${stepper("vacancies", "Places to fill", 200, 1200, 100, "temporary pickers and packers")}${stepper("applications", "Simulated applications", 2000, 12000, 1000, "arriving in two days")}
    ${stepper("cities", "Cities", 3, 9, 1, "places are split across them")}${stepper("recruiters", "Recruiters", 4, 20, 2, "each screens about 60 CVs a day")}
    <div class="field"><div><b>Crisis event</b><small>A surprise from the sheet hits the riskier choices</small></div><button type="button" class="sw" role="switch" aria-checked="${s.crisis}" aria-label="Crisis event" data-k="crisis" onclick="act('crisis')"><span></span></button></div>
    <div class="actions">${s.published ? `<button class="btn" onclick="act('unpublish')">Unpublish</button>` : ""}<button class="btn primary" onclick="act('publish')">${s.published ? "Update and keep live" : "Publish to candidates"}</button></div></section>
    <aside class="card"><h3>What this means</h3><div class="ringrow">${ring(Math.min(1, humanCap / (s.applications || 1)), "CVs people alone can read in 2 days", "#ff5d70")}${ring(Math.min(1, 0.45 * 600 / s.vacancies), "Places people alone fill by Day 3", "#f2b84b")}</div>
    <p class="hint">${s.recruiters} recruiters read about ${humanCap.toLocaleString()} CVs in two days, out of ${s.applications.toLocaleString()}. That gap is why you need an agent, and why a person must still sign every offer.</p>
    <h3 class="sp">Candidates will see</h3><div class="jobcard"><b>${esc(s.title)}</b><small>${s.vacancies} places · ${s.cities} cities · start by Day 4</small><span class="chip ${s.published ? "ok" : ""}">${s.published ? "Live" : "Draft"}</span></div></aside></div>`;
}

// ---------- The Hiring Floor ----------
let anim = { on: false, i: 0 };
const dayStrip = (p: Play) => `<ol class="days">${["Day 1 · Plan", "Day 2 · Gates", "Day 3 · Offers", "Debrief"].map((l, i) => `<li class="${p.day === i + 1 ? "now" : p.day > i + 1 ? "done" : ""}">${p.day > i + 1 ? ic("check") : `<b>${i + 1}</b>`}<span>${l}</span></li>`).join("")}</ol>`;

function approach(p: Play) {
  return `<section class="card"><div class="ch"><div><h2>Choose your approach</h2><p>Each option has a cost and a risk. People stay in charge of anything about a person.</p></div></div>
  <div class="opts" role="radiogroup" aria-label="Hiring approach">${R1.choices.map(c => {
    const on = p.choice === c.id, e = c.effects, no = c.humanCheckpoint === "No";
    return `<label class="opt ${on ? "on" : ""}"><input type="radio" name="ch" data-k="ch-${c.id}" ${on ? "checked" : ""} onchange="act('pick','${c.id}')">
      <div class="oh"><span class="oi ${c.id}">${ic(CIC[c.id])}</span><div><b>${c.label}</b><small>${c.delegation}</small></div></div><p>${c.whatItDoes.split(".")[0]}.</p>
      <div class="cost"><span>Build and run cost</span><b class="num">${c.cost}</b><span>Cost if it goes wrong</span><b class="num">${c.costIfWrong}</b></div>
      <div class="imp"><small>Expected impact</small>${MKS.map(k => `<div><span>${MN[k].replace("Customer ", "").replace("Employee ", "")}</span><b class="num ${e[k] === 0 ? "" : (k === "risk" ? -e[k] : e[k]) > 0 ? "ok" : "bad"}">${e[k] === 0 ? "0" : sgn(e[k])}</b></div>`).join("")}</div>
      ${no ? '<em class="bad">No human checkpoint: breaks Governance rule 3</em>' : ""}<span class="pick">${on ? "Selected" : "Select"}</span></label>`;
  }).join("")}</div></section>`;
}

function levers(p: Play) {
  const s = sc(), pk = (patch: Partial<HiringLimits>) => evalRun(s, db.cands, { ...p.lim, ...patch });
  const sw = (k: string, title: string, why: string, on: boolean, alt: ReturnType<typeof pk>) => `<div class="lever"><div class="lh"><div><b>${title}</b><p>${why}</p></div>
    <button type="button" class="sw" role="switch" aria-checked="${on}" aria-label="${title}" data-k="${k}" onclick="act('lever','${k}',${!on})"><span></span></button></div>
    <p class="if">If you turned it ${on ? "off" : "on"}: fairness <b class="${alt.run.fairness.passed ? "ok" : "bad"}">${alt.run.fairness.ratio.toFixed(2)}</b> · ID cases for people <b>${alt.run.idCases}</b> · staying 30 days <b>${pct(alt.out.stay30)}</b></p></div>`;
  const seg = (k: keyof HiringLimits, opts: [number, string, string][]) => `<div class="seg" role="radiogroup">${opts.map(([v, l, sub]) => `<button type="button" role="radio" aria-checked="${p.lim[k] === v}" data-k="${k}-${v}" onclick="act('lever','${k}',${v})"><b>${l}</b><small>${sub}</small></button>`).join("")}</div>`;
  const R = Math.min(12, s.recruiters);
  return `<section class="card"><h2>Set the agent's rules</h2><p class="lead">The agent screens every application. You decide how it behaves, and each switch shows what it would change.</p>
    ${sw("balancePins", "Reserve places for every pin-code group", "Without this the agent favours people who live near stores.", p.lim.balancePins, pk({ balancePins: !p.lim.balancePins }))}
    ${sw("idLate", "Check IDs only for the shortlist", "Rank first, check IDs for likely hires. Checking everyone first swamps recruiters.", !p.lim.idFirst, pk({ idFirst: !p.lim.idFirst }))}
    <div class="lever"><b>Shortlist size</b><p>Extra names cover people who do not show up.</p>${seg("overbook", [1, 1.3, 1.6].map(v => [v, v + "×", "fill " + pct(pk({ overbook: v }).out.fillRate)] as [number, string, string]))}</div>
    <div class="lever"><b>Recruiters on ID review</b><p>Each reviews about 20 unclear IDs a day.</p>${seg("reviewCapacity", [1, 2, 3].map(k => { const v = Math.max(1, Math.round(R * k / 3)) * 20; const w = pk({ reviewCapacity: v }).run.deferred; return [v, v / 20 + " of " + R, w ? w + " waiting" : "no queue"] as [number, string, string]; }))}</div></section>`;
}

function agentRun(p: Play) {
  const { run, out } = evalRun(sc(), db.cands, p.lim), steps = [["Perceive", run.log[0]?.text], ["Plan", run.log[1]?.text], ["Act", `${run.shortlist.length} candidates shortlisted. Interviews are booked on WhatsApp. Nothing is sent yet: offers wait for you.`], ["Reflect", run.log[2]?.text]];
  return `<section class="card"><h2>The agent is working</h2><p class="lead">Watch each step. Nothing it does is hidden.</p><ol class="steps">${steps.map(([t, x], i) => `<li class="${anim.i > i ? "done" : anim.i === i && anim.on ? "now" : ""}">
    <span class="dot">${anim.i > i ? ic("check") : i + 1}</span><div><b>${t}</b><p>${anim.i > i ? esc(x) : anim.i === i && anim.on ? '<span class="typing"><i></i><i></i><i></i></span>' : "Waiting"}</p></div></li>`).join("")}</ol>
    ${anim.i >= 4 ? `<div class="alert ok">${ic("check")}<p>Done in minutes. People alone would take days. Fill ${pct(out.fillRate)}, staying 30 days ${pct(out.stay30)}.</p></div>` : ""}</section>`;
}

function dialog(name: string, role: string, text: string, tone = "") {
  return `<div class="msg ${tone}">${avatar(name, 42)}<div class="bub"><b>${esc(name)} <small>${esc(role)}</small></b><p>${text}</p></div></div>`;
}
function replies(key: "id" | "meera" | "challenge", chosen: string | undefined) {
  return `<div class="you" role="group" aria-label="Your reply">${CASES[key].map(o => `<button type="button" class="reply ${chosen === o.key ? "on" : ""}" ${chosen ? "disabled" : ""} data-k="${key}-${o.key}" onclick="act('case','${key}','${o.key}')">${esc(o.label)}</button>`).join("")}</div>
    ${chosen ? `<div class="msg me"><div class="bub"><b>You</b><p>${esc(CASES[key].find(o => o.key === chosen)!.label)}</p></div></div><p class="note">${esc(CASES[key].find(o => o.key === chosen)!.note)}</p>${deltaChips(CASES[key].find(o => o.key === chosen)!)}` : ""}`;
}
// Juice: the immediate cost of what you just said, in people and in points.
function deltaChips(o: (typeof CASES)["id"][number]) {
  const c: [string, number, boolean][] = [["Meera", o.npc?.meera ?? 0, false], ["Dr. Rao", o.npc?.anil ?? 0, false], ...MKS.map(k => [({ revenue: "Revenue", trust: "Trust", morale: "Morale", risk: "Risk" })[k], o.fx[k] ?? 0, k === "risk"] as [string, number, boolean])];
  const on = c.filter(x => x[1] !== 0);
  return on.length ? `<div class="deltas" aria-label="Effects of your answer">${on.map(([l, v, inv], i) => `<i class="chip pop ${(inv ? -v : v) > 0 ? "ok" : "bad"}" style="--d:${i * .08}s">${l} ${sgn(v)}</i>`).join("")}</div>` : "";
}
const idTarget = () => db.cands.find(c => c.id_check !== "ok") ?? { ...PERSONAS[1], id: "", appliedAt: 0 };
const chTarget = () => db.cands.find(c => c.challenge && !c.challenge.resolution) ?? { ...PERSONAS[0], id: "" , appliedAt: 0, challenge: { text: "I was told I was not shortlisted. I have a 14-month gap for family reasons. Please look at my file." } };

function gate1(p: Play) {
  const { run } = evalRun(sc(), db.cands, p.lim), cap = p.lim.reviewCapacity, over = run.idCases > cap;
  return `<div class="gate">${gate("Gate 1")}<b>ID review</b><i class="chip ${over ? "bad" : "ok"}">${over ? run.deferred + " waiting" : "Cleared"}</i><p>People check the IDs the agent cannot read or match. Nobody is rejected for this.</p>
    <div class="track"><span class="fill ${over ? "risk" : ""}" style="--to:${Math.min(1, run.idCases / cap)}"></span></div><small class="num">${run.idCases} cases · capacity ${cap} a day</small></div>`;
}
function gate2(p: Play) {
  const f = evalRun(sc(), db.cands, p.lim).run.fairness, g: [string, number][] = [["Women", f.rates.women], ["Men", f.rates.men], ["Low-income pin codes", f.rates.lowIncomePin], ["Other pin codes", f.rates.otherPin]], mx = Math.max(...g.map(x => x[1]), .01);
  return `<div class="gate">${gate("Gate 2")}<b>Fairness check</b><i class="chip ${f.passed ? "ok" : "bad"}">${f.passed ? "Cleared" : "Blocked"}</i><p>Share of applicants shortlisted by group. The lowest must reach 80% of the highest. Groups are checked, never used to rank.</p>
    ${g.map(([n, v]) => `<div class="grp"><span>${n}</span><div class="track"><span class="fill" style="--to:${v / mx}"></span></div><b class="num">${pct(v)}</b></div>`).join("")}<small class="num">Ratio ${f.ratio.toFixed(2)} (needs 0.80)</small></div>`;
}
function gate3(p: Play) {
  const { run, out } = evalRun(sc(), db.cands, p.lim), f = run.fairness;
  let body: string;
  if (p.decision === "approve" || p.decision === "signoff") body = `<div class="offer"><div class="sheet"><b>${run.shortlist.length} offer letters</b><small>${pct(out.fillRate)} of places filled</small></div><div class="stamp enter" role="img" aria-label="Approved">APPROVED<small>${esc(me()?.name)} · Recruiter${p.decision === "signoff" ? " · HR Lead override" : ""}</small></div></div>`;
  else if (p.decision === "hold") body = `<p class="hint">Offers held. Stores stay short-staffed. Go back to Day 1 rules, or continue to the debrief.</p>`;
  else if (f.passed) body = `<button class="btn primary" data-k="approve" onclick="act('decision','approve')">Approve ${run.shortlist.length} offers as ${esc(me()?.name)}</button><p class="hint">Governance rule 3: no offer leaves without a person's approval.</p>`;
  else if (!p.confirm) body = `<p class="bad"><b>Offers are blocked.</b> A group is under-selected.</p><button class="btn primary" data-k="hold" onclick="act('decision','hold')">Hold offers</button><button class="btn danger" data-k="overrule" onclick="act('confirm',true)">HR Lead overrules...</button>`;
  else body = `<div class="confirm"><b>Overrule the fairness gate?</b><p>Offers go out although a group is under-selected. This adds Risk 3, costs 2 Trust, and is logged under the HR Lead's name.</p><button class="btn" data-k="cancel" onclick="act('confirm',false)">Cancel</button><button class="btn danger" data-k="signoff" onclick="act('decision','signoff')">Yes, overrule</button></div>`;
  return `<div class="gate wide">${gate("Gate 3")}<b>Offer approval</b>${body}</div>`;
}

// Clear goals with live status: the core loop of "am I winning?"
function objectives(p: Play) {
  const r = result(p, sc(), db.cands), agent = p.choice === "agent";
  const o: [string, boolean | null][] = [["Fairness ratio at 0.80 or above", agent ? r.run!.fairness.passed : null], ["No gate overruled", agent && p.decision ? p.decision !== "signoff" : null],
    ["Meera and Dr. Rao both keep 40+ trust", Math.min(db.npc.meera, db.npc.anil) >= 40], ["Company score of 60 or more", p.day === 4 ? r.score >= 60 : null]];
  return `<ul class="goals">${o.map(([t, ok]) => `<li class="${ok === null ? "na" : ok ? "ok" : "bad"}">${ok === null ? '<span class="o"></span>' : ic(ok ? "check" : "warn")}<span>${t}</span></li>`).join("")}</ul>`;
}
function timeline(p: Play) {
  const ev: [boolean, string][] = [[true, `Day 1 · ${(sc().applications + nCands()).toLocaleString()} applications open`], [!!p.choice, `Day 1 · You chose ${R1.choices.find(c => c.id === p.choice)?.label ?? "..."}`],
    [p.day > 1 && p.choice === "agent", "Day 1 · Agent screened everyone"], [!!p.id, "Day 2 · ID case answered"], [!!p.meera, "Day 2 · Store manager handled"],
    [!!p.challenge, "Day 3 · Challenge answered"], [!!p.decision, "Day 3 · Offers decided"], [p.day === 4, "Day 14 · Board review"]];
  return `<aside class="card tl"><h3>Objectives</h3>${objectives(p)}<h3 class="sp">Timeline</h3><ul>${ev.map(([d, t]) => `<li class="${d ? "done" : ""}">${d ? ic("check") : '<span class="o"></span>'}<span>${esc(t)}</span></li>`).join("")}</ul></aside>`;
}

function debrief(p: Play) {
  const r = result(p, sc(), db.cands), c = R1.choices.find(x => x.id === p.choice)!, why: string[] = [c.why];
  if (r.run && r.out) { if (!r.run.fairness.passed) why.push(r.d === "signoff" ? "You overruled a failed fairness gate: Risk +3, Trust -2." : "Offers were held while fairness failed: Revenue -2.");
    if (r.run.deferred) why.push(`${r.run.deferred} ID cases had no recruiter free: Morale -1.`); why.push(`${pct(r.out.stay30)} expected to stay 30 days (last festival 55%).`); }
  (["id", "meera", "challenge"] as const).forEach(k => { const o = CASES[k].find(x => x.key === p[k]); if (o) why.push(`${o.label}: ${o.note}`); });
  const nets = R1.choices.map(x => ({ l: x.label, n: x.id === p.choice ? r.net : netScore(x.effects) }));
  const talk = `We chose "${c.label}" for the festival hiring sprint and scored ${r.score}. ${p.choice === "agent" ? `The agent screened ${(sc().applications + nCands()).toLocaleString()} applications, but a person decided ID cases and checked fairness (ratio ${r.fairness?.toFixed(2)}). ${r.d === "signoff" ? "We overruled a blocked fairness gate, which cost us Risk and Trust." : r.d === "hold" ? "We held offers until fairness was fixed." : "A person approved every offer."}` : c.id === "agentic" ? "There was no human checkpoint, which breaks Governance rule 3." : "People kept control, but slowly."}`;
  const fairStar = p.choice === "agent" ? !!r.run?.fairness.passed && p.decision !== "signoff" : p.choice !== "agentic";
  const stars: [boolean, string][] = [[r.score >= 60, "Score 60 or more"], [fairStar, "Fair and accountable"], [Math.min(db.npc.meera, db.npc.anil) >= 50, "Trusted by your people"]];
  const mine = db.runs.filter(x => x.name === me()?.name), best = Math.max(0, ...mine.map(x => x.score));
  const pb = mine.length > 1 ? (r.score >= best ? "New personal best" : `Your best: ${best}`) : "Play again to beat this";
  return `<section class="card"><div class="ch"><div><small>Debrief · Day 14 board review</small><h2 class="gtext sheen">${r.board ? "The board steps in" : r.score >= 60 ? "The board is pleased" : "The board has questions"}</h2></div><div class="scorebig"><b class="num gtext">${r.score}</b><small>Company score</small></div></div>
    <div class="stars" role="img" aria-label="${stars.filter(x => x[0]).length} of 3 stars">${stars.map(([on, l], i) => `<span class="star ${on ? "on" : ""}" style="--d:${i * .25 + .3}s">${ic("star")}<small>${l}</small></span>`).join("")}<span class="chip ${r.score >= best ? "ok" : ""}">${pb}</span></div>
    ${r.badges.length ? `<div class="badges">${r.badges.map(b => `<span class="badge">${ic("trophy")}${b}</span>`).join("")}</div>` : '<p class="hint">No badges yet. Fairness, holding the line, and personally reviewing a challenge each earn one.</p>'}
    <div class="two"><div><h3>Why these numbers</h3><ul class="why">${why.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div><div><h3>How the four approaches compare</h3>
    ${chartSlot("c-cmp", { type: "bar", aria: "Net score by approach", data: { labels: nets.map(n => n.l), datasets: [{ data: nets.map(n => n.n), backgroundColor: nets.map(n => n.n < 0 ? "#ff5d70" : "#8b6cf0") , borderRadius: 6 }] }, options: { plugins: { legend: { display: false } } } }, 200)}</div></div>
    <h3>Say it in one breath</h3><p class="talk" id="talk">${esc(talk)}</p>
    <div class="actions"><button class="btn" onclick="act('copy')">Copy talking points</button><button class="btn" onclick="act('go','impact')">See impact</button><button class="btn" onclick="act('go','leaderboard')">Leaderboard</button><button class="btn primary" onclick="act('replay')">Replay with a different approach</button></div></section>`;
}

export function decide() {
  const s = sc(), m = me()!;
  if (!s.published) return `<div class="card empty"><h2>Publish your scenario first</h2><p>Candidates cannot apply until the scenario is live.</p><button class="btn primary" onclick="act('go','scenario')">Go to Scenario</button></div>`;
  if (!m.briefed) return story(recruiterBeats(), "brief");
  let p = db.plays[m.id];
  if (!p) { p = db.plays[m.id] = newPlay(s); save(); }
  const agent = p.choice === "agent";
  let main = "", foot = "";
  if (p.day === 1) {
    if (p.step === 0) { main = `<div class="split">${briefCard()}<div>${approach(p)}<div class="why card"><span class="wi">${ic("spark")}</span><div><b>Why does this matter?</b><p>Your decision will impact our ability to meet festival demand, customer satisfaction, employee well-being and operational risk.</p></div>
      <button class="btn primary" ${p.choice ? "" : "disabled"} onclick="act('proceed')">Proceed ${ic("send")}</button></div></div></div>`; }
    else if (p.step === 1) { main = levers(p); foot = `<button class="btn" onclick="act('step',0)">Back</button><button class="btn primary" onclick="act('run')">Run the agent</button>`; }
    else { main = agentRun(p); foot = anim.i >= 4 ? `<button class="btn primary" onclick="act('day',2)">Continue to Day 2</button>` : ""; }
  } else if (p.day === 2) {
    const t = idTarget(), mt = db.npc.meera < 40;
    main = `<section class="card deskcard"><div class="ch"><div><small>Day 2 · 9:04 am · Your desk</small><h2>Clear the gates</h2></div></div>
      ${agent ? `<div class="gates">${gate1(p)}</div>${dialog("Dr. Anil Rao", "HR Lead", `${esc(t.name)}'s ID does not match the application: <i>${t.id_check === "unreadable" ? "the photo is unreadable" : "the name is spelled differently"}</i>. ${db.npc.anil < 40 ? "Last time you cut a corner, so I am watching this one." : "What do we do?"}`, "npc")}${replies("id", p.id)}` : ""}
      ${(!agent || p.id) ? dialog("Meera Shah", "Store operations", `${mt ? "After last time, I will be direct. " : ""}Stores open on Thursday and we are short. Just take the nearest 600 applicants and be done with it. Pin codes and quotas are slowing us down.`, "npc") + replies("meera", p.meera) : ""}
      ${agent && p.meera ? `<div class="gates">${gate2(p)}</div>` : ""}</section>`;
    foot = p.meera ? `<button class="btn primary" onclick="act('day',3)">Continue to Day 3</button>` : "";
  } else if (p.day === 3) {
    const t = chTarget(), cr = sc().crisis && R1.surprise?.effects[p.choice as "agent"] ? R1.surprise.text : "";
    main = `<section class="card deskcard"><div class="ch"><div><small>Day 3 · 8:40 am · Your desk</small><h2>Offers and the store</h2></div></div>
      ${dialog(t.name, "Applicant", esc(t.challenge?.text ?? ""), "npc")}${replies("challenge", p.challenge)}
      ${p.challenge && agent ? `<div class="gates">${gate3(p)}</div>` : ""}
      ${p.challenge && cr ? `<div class="alert bad">${ic("warn")}<p><b>Crisis:</b> ${esc(cr)}</p></div>` : ""}</section>`;
    foot = p.challenge && (!agent || p.decision) ? `<button class="btn primary" onclick="act('finish')">Go to the board review</button>` : "";
  } else main = debrief(p);
  const solo = p.day === 4 || (p.day === 1 && p.step === 0);
  return `${dayStrip(p)}<div class="${solo ? "" : "two wide"}"><div class="stack">${main}${foot ? `<div class="actions end">${foot}</div>` : ""}</div>${solo ? "" : timeline(p)}</div>`;
}

// ---------- Agent glass box ----------
export function agentDemo() {
  const s = sc(), p = playOf(), lim = p?.lim ?? newPlay(s).lim, { run, out } = evalRun(s, db.cands, lim), mine = db.cands.find(c => c.id === (me() ? ui.tab : ""));
  const top = run.shortlist.slice(0, 6);
  return `<div class="two wide"><section class="card"><h2>The agent, with the lid off</h2><p class="lead">Perceive, Plan, Act, Reflect. Every rule is visible and nothing is learned in secret.</p>
    <ol class="steps">${[["Perceive", run.log[0].text], ["Plan", run.log[1].text], ["Act", "Interviews booked and documents requested. It cannot send an offer."], ["Reflect", run.log[2].text]].map(([t, x], i) => `<li class="done"><span class="dot">${i + 1}</span><div><b>${t}</b><p>${esc(x)}</p></div></li>`).join("")}</ol></section>
    <aside class="card"><h3>The rules it follows</h3><ul class="why"><li>Only <b>under-18</b> is rejected automatically.</li><li>Work gaps never exclude anyone. Distance only affects rank.</li><li>ID problems wait for a person.</li><li>Fairness is checked, never used to rank.</li><li>No offer without a named recruiter.</li></ul></aside></div>
  <section class="card"><h3>Sample of who it picked first</h3><div class="table"><table><thead><tr><th>#</th><th>City</th><th>Start</th><th>Distance</th><th>Pin group</th><th>Work gap</th></tr></thead><tbody>${top.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(CITIES[a.city])}</td><td>Day ${a.availableDay}</td><td class="num">${a.distanceKm} km</td><td>${a.lowIncomePin ? "Low-income" : "Other"}</td><td class="num">${a.gapMonths} mo</td></tr>`).join("")}</tbody></table></div>
  <p class="hint">Fill ${pct(out.fillRate)} · staying 30 days ${pct(out.stay30)} · ${run.review.length} ID cases for people.</p></section>`;
}

// ---------- Impact + Leaderboard + Help ----------
export function impact() {
  const s = sc(), p = playOf(), tmp = p?.choice ? p : { ...newPlay(s), choice: "agent" as const }, r = result(tmp, s, db.cands), f = r.run?.fairness;
  return `<div class="kpis">${[["Company score", String(r.score), p?.day === 4 ? "your result" : "projection"], ["Fairness ratio", f ? f.ratio.toFixed(2) : "n/a", "needs 0.80"], ["Places filled", pct(r.fill), "of " + s.vacancies], ["Stay 30 days", pct(r.stay), "last festival 55%"]]
    .map(([l, v, n]) => `<div class="card kpi"><small>${l}</small><b class="num">${v}</b><span>${n}</span></div>`).join("")}</div>
  <div class="two"><section class="card"><h3>Who got shortlisted</h3>${f ? chartSlot("c-fair", { type: "bar", aria: "Share shortlisted by group", data: { labels: ["Women", "Men", "Low-income pin", "Other pin"], datasets: [{ data: [f.rates.women, f.rates.men, f.rates.lowIncomePin, f.rates.otherPin].map(x => Math.round(x * 1000) / 10), backgroundColor: ["#8b6cf0", "#8b6cf0", "#4da6ff", "#4da6ff"], borderRadius: 6 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { title: { display: true, text: "% shortlisted" } } } } }) : '<p class="hint">Pick the AI agent to see fairness.</p>'}</section>
  <section class="card"><h3>Measures: start vs now</h3>${chartSlot("c-meas", { type: "bar", aria: "Measures at start and now", data: { labels: MKS.map(k => MN[k].split(" ")[0]), datasets: [{ label: "Start", data: MKS.map(k => START[k]), backgroundColor: "#3a4070", borderRadius: 6 }, { label: "Now", data: MKS.map(k => r.measures[k]), backgroundColor: "#8b6cf0", borderRadius: 6 }] } })}</section></div>`;
}

export function leaderboard() {
  const samples = (["person", "agent", "agentic"] as const).map(c => { const r = result({ ...newPlay(sc()), choice: c, decision: "approve" as Decision }, sc(), []); return { id: "s" + c, name: "Sample · " + R1.choices.find(x => x.id === c)!.label, score: r.score, fairness: r.fairness ?? 0, fill: r.fill, stay: r.stay, choice: c, badges: r.badges, at: 0, sample: true }; });
  const val = (r: any) => (ui.sort.col === "name" ? r.name : r[ui.sort.col]);
  const rows = [...db.runs, ...samples].sort((a, b) => { const va = val(a), vb = val(b); return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * ui.sort.dir; });
  const th = (c: string, l: string) => `<th><button class="th" onclick="act('sort','${c}')">${l}${ui.sort.col === c ? (ui.sort.dir < 0 ? " ▼" : " ▲") : ""}</button></th>`;
  return `<section class="card"><h2>Leaderboard</h2><p class="lead">Every finished play lands here. Sample rows show the engine's own results for comparison.</p><div class="table"><table><thead><tr><th>#</th>${th("name", "Player")}${th("score", "Score")}${th("fairness", "Fairness")}${th("fill", "Filled")}${th("stay", "Stay 30d")}<th>Badges</th></tr></thead>
  <tbody>${rows.map((r, i) => `<tr class="${r.sample ? "sample" : ""}"><td>${i + 1}</td><td><span class="who">${avatar(r.name, 26)}${esc(r.name)}</span></td><td class="num"><b>${r.score}</b></td><td class="num">${r.fairness ? r.fairness.toFixed(2) : "n/a"}</td><td class="num">${pct(r.fill)}</td><td class="num">${pct(r.stay)}</td><td>${r.badges.map(b => `<span class="badge sm">${esc(b)}</span>`).join("")}</td></tr>`).join("")}</tbody></table></div></section>`;
}

export const help = () => `<section class="card"><h2>How to play</h2><ol class="steps">${[["Create the scenario", "Set places, cities, applications and recruiters, then publish. Candidates can now apply."], ["Day 1: choose who hires", "Person, Gen AI, an AI agent, or fully agentic AI. If you pick the agent, set its rules and watch it work."],
  ["Day 2: clear the gates", "Answer the HR lead and the store manager. They remember what you do. Then check the fairness gate."], ["Day 3: offers", "Answer a candidate's challenge, then approve, hold, or overrule. Every offer needs a person."],
  ["Day 14: board review", "See your score, badges and how the other approaches compare. Replay to try a different path."]].map(([t, x], i) => `<li class="done"><span class="dot">${i + 1}</span><div><b>${t}</b><p>${x}</p></div></li>`).join("")}</ol>
  <div class="actions"><button class="btn" onclick="act('rebrief')">Watch the briefing again</button></div><h3>Words used</h3><p class="hint"><b>Governance rule 3:</b> no AI on hiring without a human checkpoint. <b>Four-fifths rule:</b> the lowest group's selection rate must reach 80% of the highest, used here as an internal guardrail. <b>SPOT:</b> Signal, Pattern, Orchestrate, Test and trust.</p></section>`;

// ---------- actions ----------
export function ract(a: string, ...r: any[]): boolean {
  const [x, y, z, w] = r;
  const m = me(); if (!m || m.role !== "recruiter") return false;
  const p = db.plays[m.id], s = sc();
  switch (a) {
    case "sc": (s as any)[x] = Math.max(z, Math.min(w, (s as any)[x] + y)); break;
    case "title": s.title = String(x).slice(0, 60) || DEFAULT_SCENARIO.title; break;
    case "crisis": s.crisis = !s.crisis; break;
    case "publish": s.published = true; s.by = m.name; save(); toast("Scenario is live. Candidates can apply."); return true;
    case "unpublish": s.published = false; break;
    case "pick": p.choice = x; break;
    case "proceed": if (p.choice === "agent") p.step = 1; else { p.day = 2; p.step = 0; } break;
    case "step": p.step = x; break;
    case "lever": { const lim = p.lim as any; if (x === "idLate") lim.idFirst = !y; else lim[x] = y; p.decision = ""; break; }
    case "run": {
      p.step = 2; anim = { on: true, i: 0 };
      db.last = lastRunFor(s, db.cands, p.lim, "screened");
      const t = window.setInterval(() => { anim.i++; if (anim.i >= 4) { anim.on = false; clearInterval(t); } render(); }, 900);
      break;
    }
    case "day": p.day = x; p.step = 0; break;
    case "case": {
      const o = CASES[x as "id"].find(q => q.key === y)!; (p as any)[x] = y;
      if (o.npc?.meera) db.npc.meera = clampNpc(db.npc.meera + o.npc.meera); if (o.npc?.anil) db.npc.anil = clampNpc(db.npc.anil + o.npc.anil);
      if (x === "meera" && y === "comply") p.lim.balancePins = false; if (x === "meera" && y === "compromise") p.lim.overbook = 1.6;
      if (x === "challenge") { const c = db.cands.find(q => q.challenge && !q.challenge.resolution); if (c?.challenge) c.challenge.resolution = y === "reinstate" ? "reinstated" : y === "uphold" ? "upheld" : "ignored"; }
      if (x === "meera" && p.choice === "agent") db.last = lastRunFor(s, db.cands, p.lim, "screened");
      break;
    }
    case "decision": p.decision = x; p.confirm = false; if (db.last) db.last.stage = x === "hold" ? "held" : "offers"; break;
    case "confirm": p.confirm = x; break;
    case "finish": {
      p.day = 4; if (!p.saved) { const r = result(p, s, db.cands); db.runs.push({ id: Math.random().toString(36).slice(2), name: m.name, score: r.score, fairness: r.fairness ?? 0, fill: r.fill, stay: r.stay, choice: p.choice, badges: r.badges, at: Date.now() }); p.saved = true; }
      break;
    }
    case "replay": db.plays[m.id] = newPlay(s); anim = { on: false, i: 0 }; save(); ui.view = "decide"; render(); return true;
    case "sort": ui.sort = { col: x, dir: ui.sort.col === x ? -ui.sort.dir : -1 }; break;
    case "copy": { const t = document.getElementById("talk")?.innerText ?? ""; (navigator.clipboard?.writeText(t) ?? Promise.reject()).then(() => toast("Copied"), () => toast("Select the text and copy it")); return true; }
    default: return false;
  }
  save(); render(); return true;
}
export { companyScore, START };
