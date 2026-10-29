// "The Candidate's Week": the person behind one of the 8,400 applications. Rent is due, so they need a joining letter by Day 4.
// Their choices change their real application (ID, start day), which the recruiter's agent then ranks. The two sides affect each other.
import { db, save, me } from "./store.ts";
import { ui, esc, ic, avatar, toast, render, sgn } from "./ui.ts";
import { CITIES, START_CM, lastRunFor, newPlay, type Cand, type CM } from "./sim.ts";
import { mine, status, challengeBox } from "./candidate.ts";

interface COpt { key: string; label: string; fx: Partial<CM>; set?: { id_check?: Cand["id_check"]; availableDay?: number }; note: string }
const OPTS: Record<string, COpt[]> = {
  id: [
    { key: "retake", label: "Retake the photo properly tonight", fx: { energy: -10, hope: 2 }, set: { id_check: "ok" }, note: "It costs your evening, but now the agent can read your ID." },
    { key: "asis", label: "Send it as it is and hope", fx: { hope: -2 }, note: "The agent cannot read it, so you wait in the ID queue until a person checks." },
    { key: "ask", label: "Ask the assistant what to do", fx: { faith: 3 }, note: "It says: bring your original to the ID desk on Day 2. It cannot fix this for you." },
  ],
  gap: [
    { key: "honest", label: "Add a short, honest note about my break", fx: { hope: 3, faith: 2 }, note: "Work gaps never count against you here. A note helps the person who reads your file." },
    { key: "skip", label: "Leave it blank", fx: {}, note: "That is fine. The agent ignores gaps." },
    { key: "invent", label: "Say I was working somewhere", fx: { faith: -3, hope: -1 }, note: "An invented job is a risk: a person may check it later, and you did not need to." },
  ],
  start: [
    { key: "d1", label: "Day 1", fx: { savings: -8 }, set: { availableDay: 1 }, note: "You skip a paid shift today. The agent ranks earlier starts first, so this helps." },
    { key: "d2", label: "Day 2", fx: { savings: -3 }, set: { availableDay: 2 }, note: "A small cost, and still a strong start date." },
    { key: "d3", label: "Day 3", fx: {}, set: { availableDay: 3 }, note: "No cost to you, but the agent sorts by start date first, so you rank lower." },
    { key: "d4", label: "Day 4", fx: {}, set: { availableDay: 4 }, note: "Safe for your shifts, and the lowest rank for a start date." },
  ],
  day2: [
    { key: "gig", label: "Take a gig shift", fx: { savings: 12, energy: -18 }, note: "Rent is a little closer, and you are tired." },
    { key: "rest", label: "Rest and get ready", fx: { energy: 20, hope: 3 }, note: "You feel steadier." },
    { key: "visit", label: "Take your original ID to the ID desk", fx: { energy: -12, hope: 4 }, set: { id_check: "ok" }, note: "A person checks your original, and your file is fixed." },
    { key: "train", label: "Practise interview questions with a friend", fx: { hope: 6, energy: -8 }, note: "You walk in feeling readier." },
  ],
};
const cl = (v: number) => Math.max(0, Math.min(100, v));
const DEF: [keyof CM, string, string, string][] = [["savings", "Savings", "bars", "revenue"], ["energy", "Energy", "clock", "energy"], ["hope", "Hope", "heart", "morale"], ["faith", "Faith in the system", "shield", "trust"]];

function cmeters(m: CM) {
  return `<section class="meters" aria-label="How you are doing">${DEF.map(([k, l, i, cls]) => { const d = m[k] - START_CM[k];
    return `<div class="mtr ${cls}"><span class="tile">${ic(i)}</span><div><div class="mv"><b class="num">${m[k]}</b><span>${l}</span>${d ? `<i class="chip ${d > 0 ? "ok" : "bad"}">${sgn(d)}</i>` : ""}</div>
      <div class="track"><span class="fill" style="--to:${m[k] / 100}"></span><span class="start" style="left:${START_CM[k]}%"></span></div></div><small>/100</small></div>`; }).join("")}</section>`;
}
const strip = (day: number) => `<ol class="days">${["Day 1 · Apply", "Day 2 · The wait", "Day 3 · The result", "Day 4 · Joining day"].map((l, i) => `<li class="${day === i + 1 ? "now" : day > i + 1 ? "done" : ""}">${day > i + 1 ? ic("check") : `<b>${i + 1}</b>`}<span>${l}</span></li>`).join("")}</ol>`;
const bot = (t: string) => `<div class="msg"><span class="av bot">${ic("agent")}</span><div class="bub"><b>Screening assistant <small>AI</small></b><p>${t}</p></div></div>`;

function ask(q: string, opts: COpt[], picked: string | undefined) {
  const o = OPTS[q].find(x => x.key === picked);
  return `<div class="you" role="group" aria-label="Your answer">${opts.map(x => `<button type="button" class="reply ${picked === x.key ? "on" : ""}" ${picked ? "disabled" : ""} data-k="w-${q}-${x.key}" onclick="act('wpick','${q}','${x.key}')">${esc(x.label)}</button>`).join("")}</div>
    ${o ? `<div class="msg me"><div class="bub"><b>You</b><p>${esc(o.label)}</p></div></div><p class="note">${esc(o.note)}</p>${chips(o.fx)}` : ""}`;
}
const chips = (fx: Partial<CM>) => { const on = DEF.filter(([k]) => fx[k]); return on.length ? `<div class="deltas">${on.map(([k, l], i) => `<i class="chip pop ${fx[k]! > 0 ? "ok" : "bad"}" style="--d:${i * .08}s">${l.split(" ")[0]} ${sgn(fx[k]!)}</i>`).join("")}</div>` : ""; };

// "Where you stand": your distance against how far the shortlist reached.
function stand(c: Cand) {
  const cut = db.last?.cuts?.[c.id]; if (!cut) return "";
  const k = 118 / 31, a = -0.7, d = Math.max(0.5, c.distanceKm), x = 150 + d * k * Math.cos(a), y = 150 + d * k * Math.sin(a), st = status(c);
  return `<figure class="standf"><svg class="stand" viewBox="0 0 300 300" role="img" aria-label="You live ${c.distanceKm} km from the hub. People shortlisted in your group live within ${cut.km} km.">
    ${[6, 12, 18, 24, 30].map(r => `<circle cx="150" cy="150" r="${r * k}" fill="none" stroke="rgb(255 255 255 / .14)"/><text x="${150 + r * k * 0.707 + 3}" y="${150 - r * k * 0.707}" fill="rgb(255 255 255 / .45)" font-size="9">${r} km</text>`).join("")}
    ${cut.km ? `<circle cx="150" cy="150" r="${cut.km * k}" fill="rgb(61 220 151 / .14)" stroke="#3ddc97" stroke-dasharray="4 4"/>` : ""}
    <circle cx="150" cy="150" r="5" fill="#fff" stroke="#8b6cf0" stroke-width="3"/>
    <circle cx="${x}" cy="${y}" r="9" fill="${st.step >= 3 ? "#3ddc97" : "#ff6b7d"}" stroke="#fff" stroke-width="2.5"/><text x="${x > 190 ? x - 13 : x + 13}" y="${y + 4}" text-anchor="${x > 190 ? "end" : "start"}" fill="#fff" font-size="12" font-weight="600">You · ${c.distanceKm} km</text></svg>
    <figcaption>${cut.km ? `The shortlist in your group reached <b>${cut.km} km</b>.` : "Nobody in your group was shortlisted."} You live <b>${c.distanceKm} km</b> from the hub.</figcaption></figure>`;
}

const finalM = (c: Cand): CM => {
  const m = { ...c.week!.m }, r = c.challenge?.resolution;
  if (r === "reinstated") { m.hope += 15; m.faith += 10; } else if (r === "upheld") { m.faith += 3; m.hope -= 2; } else if (r === "ignored") { m.faith -= 12; m.hope -= 6; }
  return { savings: cl(m.savings), energy: cl(m.energy), hope: cl(m.hope), faith: cl(m.faith) };
};
const ready = (c: Cand) => !!db.last && db.last.at >= c.appliedAt;

export function weekView() {
  const c = mine();
  if (!c?.week) return `<div class="card empty"><h2>Your week has not started</h2><p>Apply to an open role and your week begins.</p><button class="btn primary" onclick="act('go','roles')">See the open role</button></div>`;
  const w = c.week, first = esc(c.name.split(" ")[0]), st = status(c);
  let main = "", foot = "";
  if (w.day === 1) {
    main = `<section class="card deskcard"><div class="ch"><div><small>Day 1 · 8:10 pm · On your phone</small><h2>Apply</h2></div></div>
      ${bot(`Hi ${first}. I am an AI assistant for Halcyon Basket. I cannot decide who gets hired: a recruiter does. I will ask you ${w.q1 ? "two things" : "one thing"}.`)}
      ${w.q1 ? bot(w.q1 === "id" ? "Your ID photo is hard to read. What would you like to do?" : `Your file shows a ${c.gapMonths}-month break from work. Do you want to add a note?`) + ask(w.q1, OPTS[w.q1], w.picks[w.q1]) : ""}
      ${!w.q1 || w.picks[w.q1] ? bot("When can you start? Rent is due soon, but a paid shift is a paid shift.") + ask("start", OPTS.start, w.picks.start) : ""}</section>`;
    foot = w.picks.start ? `<button class="btn primary" onclick="act('wday',2)">Go to Day 2</button>` : "";
  } else if (w.day === 2) {
    const o = OPTS.day2.filter(x => x.key === "gig" || x.key === "rest" || (x.key === "visit" ? w.q1 === "id" && w.picks.id !== "retake" : w.q1 !== "id" || w.picks.id === "retake"));
    main = `<section class="card deskcard"><div class="ch"><div><small>Day 2 · Morning · Your kitchen table</small><h2>The wait</h2></div></div>
      ${bot("The agent screens every application tonight. You cannot hurry it. How do you spend today?")}${ask("day2", o, w.picks.day2)}</section>`;
    foot = w.picks.day2 ? `<button class="btn primary" onclick="act('wday',3)">Go to Day 3</button>` : "";
  } else if (w.day === 3) {
    if (!ready(c)) main = `<section class="card"><h2>The screening has not run yet</h2><p class="lead">A recruiter has to run it. Keep this tab open: your result appears here by itself.</p>
      <button class="btn primary" onclick="act('wscreen')">Run the screening now (demo)</button><p class="hint">In class, the recruiter does this. This button lets you play alone.</p></section>`;
    else main = `<section class="card"><div class="ch"><div><small>Day 3 · Your inbox</small><h2>${esc(st.title)}</h2></div><span class="chip ${st.tone}">${st.tone === "bad" ? "Needs attention" : st.tone === "warn" ? "Waiting" : "Good news"}</span></div>
      <p class="lead">${esc(st.text.split(" Nobody")[0])}</p>${stand(c)}
      ${w.why ? `<div class="alert ok">${ic("check")}<p><b>Why this happened.</b> The agent ranks people in your city by start date, then by distance. Your start date is Day ${c.availableDay}. Work gaps and gender are never used to rank you. They are only checked afterwards, to see whether the system is fair.</p></div>` : `<button class="btn" onclick="act('wwhy')">Why did this happen?</button>`}
      ${st.step === 2 && !c.challenge ? challengeBox() : ""}
      ${c.challenge ? `<div class="alert ${c.challenge.resolution === "ignored" ? "bad" : "ok"}">${ic(c.challenge.resolution ? "check" : "clock")}<p>${!c.challenge.resolution ? "Your challenge is with a recruiter. A person will read it." : c.challenge.resolution === "reinstated" ? "A recruiter reviewed your file and reinstated you." : c.challenge.resolution === "upheld" ? "A recruiter reviewed it and kept the decision, with a written reason." : "Your challenge was not answered."}</p></div>` : ""}</section>`;
    foot = ready(c) ? `<button class="btn primary" onclick="act('wday',4)">See how the week ends</button>` : "";
  } else {
    const m = finalM(c), hired = st.step === 5 || c.challenge?.resolution === "reinstated";
    const heard = c.challenge?.resolution === "reinstated" || c.challenge?.resolution === "upheld" || (st.step === 5);
    const stars: [boolean, string][] = [[w.why, "You understood why"], [heard, "A person looked at your case"], [hired, "You got the job"]];
    main = `<section class="card"><div class="ch"><div><small>Day 4 · Joining day</small><h2 class="gtext sheen">${hired ? "You are in." : st.step === 4 ? "Almost there." : st.step === 3 ? "Still waiting on a person." : "Not this time."}</h2></div></div>
      <p class="lead">${esc(hired ? "A recruiter approved your place. Rent is due, and you can pay it." : st.step === 4 ? "You are shortlisted. A recruiter still has to approve your offer. The agent cannot send it." : st.step === 3 ? "A person still has to check your ID. You are waiting, not rejected." : "You were not shortlisted. You now know why, and what you could change next time.")}</p>
      <div class="stars" role="img" aria-label="${stars.filter(x => x[0]).length} of 3 stars">${stars.map(([on, l], i) => `<span class="star ${on ? "on" : ""}" style="--d:${i * .25 + .2}s">${ic("star")}<small>${l}</small></span>`).join("")}</div>
      <p class="hint">${m.savings < 15 ? "Savings ran low this week, and that is the pressure real applicants carry." : "You kept some savings in reserve."}</p>
      <div class="actions"><button class="btn primary" onclick="act('wagain')">Play again as someone else</button><button class="btn" onclick="act('go','journey')">See my journey</button></div></section>`;
  }
  const side = `<aside class="card tl"><h3>Your goal</h3><p class="lead">Get a joining letter by Day 4. Rent is due.</p><div class="who">${avatar(c.name, 40)}<div><b>${esc(c.name)}</b><small>${esc(CITIES[c.city])} · ${c.distanceKm} km</small></div></div>
    <p class="hint">${esc(c.story)}</p><h3 class="sp">Your choices</h3><ul class="goals">${Object.entries(w.picks).map(([q, k]) => `<li class="ok">${ic("check")}<span>${esc(OPTS[q].find(x => x.key === k)?.label ?? k)}</span></li>`).join("") || '<li class="na"><span class="o"></span><span>None yet</span></li>'}</ul></aside>`;
  return `${strip(w.day)}${cmeters(w.day === 4 ? finalM(c) : w.m)}<div class="two wide"><div class="stack">${main}${foot ? `<div class="actions end">${foot}</div>` : ""}</div>${side}</div>`;
}

// The first time a result is visible, it moves the candidate's meters once.
function applyResult(c: Cand) {
  const w = c.week!; if (w.res || !ready(c)) return;
  const s = status(c).step; w.res = true;
  const fx: Partial<CM> = s >= 4 ? { hope: 12, faith: 5 } : s === 3 ? { hope: -2 } : { hope: -12, faith: -8 };
  (Object.keys(fx) as (keyof CM)[]).forEach(k => (w.m[k] = cl(w.m[k] + (fx[k] ?? 0))));
}

export function gact(a: string, ...r: any[]): boolean {
  const p = me(); if (!p || p.role !== "candidate") return false;
  const c = mine(), [x, y] = r; if (!c?.week) return false;
  const w = c.week;
  switch (a) {
    case "wpick": {
      const o = OPTS[x]?.find(q => q.key === y); if (!o || w.picks[x]) return true;
      w.picks[x] = y; (Object.keys(o.fx) as (keyof CM)[]).forEach(k => (w.m[k] = cl(w.m[k] + (o.fx[k] ?? 0)))); if (o.set) Object.assign(c, o.set);
      break;
    }
    case "wday": w.day = x; applyResult(c); break;
    case "wscreen": { const lim = Object.values(db.plays).at(-1)?.lim ?? newPlay(db.scenario).lim; db.last = lastRunFor(db.scenario, db.cands, lim, "screened"); applyResult(c); toast("The screening has run"); break; }
    case "wwhy": if (!w.why) { w.why = true; w.m.faith = cl(w.m.faith + 2); } break;
    case "wagain": db.cands = db.cands.filter(q => q.id !== c.id); ui.view = "roles"; break;
    default: return false;
  }
  save(); render(); return true;
}
