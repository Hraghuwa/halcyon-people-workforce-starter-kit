// Candidate side: see the opening, apply (or play a persona), chat with the hiring assistant, understand the decision, challenge it.
import { db, save, me } from "./store.ts";
import { ui, esc, ic, avatar, toast, render } from "./ui.ts";
import { CITIES, PERSONAS, type Cand } from "./sim.ts";

const form = { city: 0, gender: "F" as "F" | "M", lowIncomePin: false, distanceKm: 8, gapMonths: 0, availableDay: 2, id_check: "ok" as Cand["id_check"], age: 24, text: "" };
export const mine = (): Cand | undefined => db.cands.find(c => c.id === me()?.id);

function status(c: Cand) {
  const l = db.last, inL = (a: string[]) => a.includes(c.id);
  if (c.challenge?.resolution === "reinstated") return { step: 4, tone: "ok", title: "Reinstated by a recruiter", text: "A person reviewed your file personally and put you back on the shortlist. Interview invite is next." };
  if (!l || l.at < c.appliedAt) return { step: 1, tone: "", title: "Application received", text: "Your application is in. The recruiter has not run the screening yet, so nothing has happened to you." };
  if (inL(l.shortlist)) return l.stage === "offers" ? { step: 5, tone: "ok", title: "Offer approved", text: "A recruiter approved your offer. Check your messages for the joining details." }
    : l.stage === "held" ? { step: 4, tone: "warn", title: "Shortlisted, offers on hold", text: "You made the shortlist, but the recruiter has paused all offers while they fix something." }
    : { step: 4, tone: "ok", title: "Shortlisted", text: "The agent shortlisted you. A recruiter must approve your offer. The agent cannot send it on its own." };
  if (inL(l.review)) return { step: 3, tone: "warn", title: "A person needs to check your ID", text: "The agent could not read or match your ID. You are waiting for a recruiter, not rejected." };
  return { step: 2, tone: "bad", title: "Not shortlisted this round", text: l.reasons[c.id] ?? "More people applied than there are places." };
}

const timeline = (step: number) => `<ol class="steps h">${["Applied", "Screened", "ID check", "Interview", "Offer"].map((t, i) => `<li class="${step > i + 1 ? "done" : step === i + 1 ? "now" : ""}"><span class="dot">${step > i + 1 ? ic("check") : i + 1}</span><b>${t}</b></li>`).join("")}</ol>`;

export function journey() {
  const c = mine(), s = db.scenario;
  if (!c) return `<div class="card empty"><h2>You have not applied yet</h2><p>${s.published ? "There is an open role waiting for you." : "No role is open yet. Ask the recruiter to publish a scenario."}</p>${s.published ? `<button class="btn primary" onclick="act('go','roles')">See the open role</button>` : ""}</div>`;
  const st = status(c);
  return `<div class="two wide"><section class="card"><div class="ch"><div><small>Your application</small><h2>${esc(st.title)}</h2></div><span class="chip ${st.tone}">${esc(st.tone === "bad" ? "Needs attention" : st.tone === "warn" ? "Waiting" : st.tone === "ok" ? "Good news" : "Received")}</span></div>
    ${timeline(st.step)}<p class="lead">${esc(st.text)}</p>
    ${st.step === 2 && !c.challenge ? `<div class="challenge"><h3>You can challenge this</h3><p class="hint">A rejection you dispute stays with a person. Tell the recruiter why you think it is wrong.</p>
      <textarea class="text" data-k="ctext" rows="3" placeholder="For example: I took a career break for family reasons, but I can start on Day 1." oninput="act('ctext',this.value)">${esc(form.text)}</textarea>
      <button class="btn primary" onclick="act('challenge')">Send challenge to a recruiter</button></div>` : ""}
    ${c.challenge ? `<div class="alert ${c.challenge.resolution === "ignored" ? "bad" : "ok"}">${ic(c.challenge.resolution ? "check" : "clock")}<p>${!c.challenge.resolution ? "Your challenge is with a recruiter. A person will read it." : c.challenge.resolution === "reinstated" ? "A recruiter reviewed your file and reinstated you." : c.challenge.resolution === "upheld" ? "A recruiter reviewed it and kept the decision, with a written reason sent to you." : "Your challenge was not answered. You can raise it with HR."}</p></div>` : ""}</section>
    <aside class="card"><h3>Your file</h3><div class="who big">${avatar(c.name, 56)}<div><b>${esc(c.name)}</b><small>${esc(CITIES[c.city])} · ${c.distanceKm} km from the store</small></div></div>
    <ul class="why"><li>Can start Day ${c.availableDay}</li><li>Work gap: ${c.gapMonths} months (never a reason to reject)</li><li>ID: ${c.id_check === "ok" ? "matches" : c.id_check === "mismatch" ? "name differs" : "photo unreadable"}</li></ul>
    <button class="btn danger" onclick="act('withdraw')">Withdraw application</button></aside></div>`;
}

const chip = (on: boolean, label: string, a: string) => `<button type="button" class="chipb ${on ? "on" : ""}" aria-pressed="${on}" onclick="${a}">${label}</button>`;
export function roles() {
  const s = db.scenario, c = mine();
  if (!s.published) return `<div class="card empty"><h2>No open roles yet</h2><p>When a recruiter publishes a scenario, the role appears here. Keep this tab open: it updates by itself.</p></div>`;
  const job = `<section class="card job"><div class="ch"><div><small>Open now · ${s.cities} cities</small><h2>${esc(s.title)}</h2></div><span class="chip ok">Live</span></div>
    <p>Halcyon Basket needs <b>${s.vacancies}</b> temporary pickers and packers before Day 4. About <b>${s.applications.toLocaleString()}</b> people are applying, so a smart screening agent helps, and a person approves every offer.</p>
    <div class="facts">${[["people", s.vacancies, "places"], ["pin", s.cities, "cities"], ["clock", "Day 4", "start by"]].map(([i, v, l]) => `<div>${ic(i as string)}<b class="num">${v}</b><small>${l}</small></div>`).join("")}</div></section>`;
  if (c) return job + `<section class="card"><h3>You have applied</h3><p class="hint">See what happens next in My Journey.</p><button class="btn primary" onclick="act('go','journey')">Open My Journey</button></section>`;
  return job + `<section class="card"><h2>Play as someone, or be yourself</h2><p class="lead">Each person below has a real story. See how the system treats them, then try your own.</p>
    <div class="personas">${PERSONAS.map((p, i) => `<div class="persona">${avatar(p.name, 52)}<b>${p.name}</b><small>${CITIES[p.city]} · ${p.distanceKm} km</small><p>${esc(p.story)}</p><button class="btn" onclick="act('apply',${i})">Apply as ${p.name.split(" ")[0]}</button></div>`).join("")}</div></section>
  <section class="card"><h2>Your own application</h2><div class="form">
    <div class="field col"><b>City</b><div class="chips">${CITIES.slice(0, s.cities).map((n, i) => chip(form.city === i, n, `act('f','city',${i})`)).join("")}</div></div>
    <div class="field col"><b>Where do you live?</b><div class="chips">${chip(!form.lowIncomePin, "Close to the main area", "act('f','lowIncomePin',false)")}${chip(form.lowIncomePin, "Outer or lower-income area", "act('f','lowIncomePin',true)")}</div></div>
    <div class="field col"><b>When can you start?</b><div class="chips">${[1, 2, 3, 4, 5].map(d => chip(form.availableDay === d, "Day " + d, `act('f','availableDay',${d})`)).join("")}</div></div>
    <div class="field col"><b>Your ID</b><div class="chips">${chip(form.id_check === "ok", "Matches my application", "act('f','id_check','ok')")}${chip(form.id_check === "unreadable", "My photo is blurry", "act('f','id_check','unreadable')")}${chip(form.id_check === "mismatch", "My name is spelled differently", "act('f','id_check','mismatch')")}</div></div>
    <div class="field"><div><b>Distance from the store</b><small>kilometres</small></div><div class="stepper"><button type="button" aria-label="Less distance" onclick="act('fs','distanceKm',-2,0,40)">−</button><b class="num">${form.distanceKm}</b><button type="button" aria-label="More distance" onclick="act('fs','distanceKm',2,0,40)">+</button></div></div>
    <div class="field"><div><b>Gap in work history</b><small>months. This is never a reason to reject you.</small></div><div class="stepper"><button type="button" aria-label="Shorter gap" onclick="act('fs','gapMonths',-2,0,48)">−</button><b class="num">${form.gapMonths}</b><button type="button" aria-label="Longer gap" onclick="act('fs','gapMonths',2,0,48)">+</button></div></div>
    <div class="field col"><b>Gender <small>(used only to check the system is fair, never to rank you)</small></b><div class="chips">${chip(form.gender === "F", "Woman", "act('f','gender','F')")}${chip(form.gender === "M", "Man", "act('f','gender','M')")}</div></div>
    <div class="actions"><button class="btn primary" onclick="act('apply',-1)">Submit application</button></div></div></section>`;
}

export function chat() {
  const c = mine(), st = c ? status(c) : null, bot = (t: string) => `<div class="msg"><span class="av bot">${ic("agent")}</span><div class="bub"><b>Halcyon hiring assistant</b><p>${t}</p></div></div>`;
  if (!c) return `<div class="card empty"><h2>Apply first</h2><p>The assistant chats with you once you have applied.</p></div>`;
  const before = !db.last || db.last.at < c.appliedAt;
  return `<section class="card chat"><h2>Interview chat</h2><p class="lead">This is the screening agent talking to you. A person makes every decision about you.</p>
    ${bot(`Hi ${esc(c.name.split(" ")[0])}. I am an AI assistant for Halcyon Basket. I do not decide who gets a job: a recruiter does. I can book your interview and check your documents.`)}
    ${bot("When can you start? You can change this until screening runs.")}
    <div class="you">${[1, 2, 3, 4, 5].map(d => `<button type="button" class="reply ${c.availableDay === d ? "on" : ""}" ${before ? "" : "disabled"} onclick="act('start',${d})">Day ${d}</button>`).join("")}</div>
    ${bot(`Got it: Day ${c.availableDay}. ${before ? "Waiting for the recruiter to run screening." : ""}`)}
    ${st && !before ? bot(`<b>${esc(st.title)}.</b> ${esc(st.text)}`) : ""}</section>`;
}

export const cHelp = () => `<section class="card"><h2>How this works for you</h2><ol class="steps">${[["Apply", "Pick a persona to see a story, or apply as yourself."], ["Screening", "An AI agent reads every application. It cannot send offers or reject anyone for a work gap."], ["A person decides", "A recruiter checks unclear IDs and approves each offer."], ["You can challenge", "If you are not shortlisted, you get the reason in plain words and can ask a person to look again."]]
  .map(([t, x], i) => `<li class="done"><span class="dot">${i + 1}</span><div><b>${t}</b><p>${x}</p></div></li>`).join("")}</ol></section>`;

export function cact(a: string, ...r: any[]): boolean {
  const m = me(); if (!m || m.role !== "candidate") return false;
  const [x, y, z, w] = r, c = mine();
  switch (a) {
    case "f": (form as any)[x] = y; break;
    case "fs": (form as any)[x] = Math.max(z, Math.min(w, (form as any)[x] + y)); break;
    case "ctext": form.text = x; return true;
    case "apply": {
      const base = x >= 0 ? PERSONAS[x] : { name: m.name, city: form.city, gender: form.gender, lowIncomePin: form.lowIncomePin, age: form.age, gapMonths: form.gapMonths, distanceKm: form.distanceKm, availableDay: form.availableDay, id_check: form.id_check, story: "Applied as themselves." };
      db.cands = db.cands.filter(q => q.id !== m.id); db.cands.push({ ...base, id: m.id, appliedAt: Date.now() }); ui.view = "journey"; toast("Application sent"); break;
    }
    case "withdraw": db.cands = db.cands.filter(q => q.id !== m.id); ui.view = "roles"; break;
    case "start": if (c) c.availableDay = x; break;
    case "challenge": if (c && form.text.trim()) { c.challenge = { text: form.text.trim().slice(0, 300) }; form.text = ""; toast("Challenge sent to a recruiter"); } else { toast("Write a sentence first"); return true; } break;
    default: return false;
  }
  save(); render(); return true;
}
