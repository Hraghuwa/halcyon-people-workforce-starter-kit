// Shared state. Data lives in localStorage so a Recruiter tab and a Candidate tab in the same browser see each other live.
// Who you are is per tab (sessionStorage). No passwords: this is a classroom game, not an account system.
import { DEFAULT_SCENARIO, type Cand, type LastRun, type Play, type RunRec, type ScenarioCfg } from "./sim.ts";

export interface Profile { id: string; role: "recruiter" | "candidate"; name: string }
export interface Store { v: 1; profiles: Profile[]; scenario: ScenarioCfg; cands: Cand[]; last: LastRun | null; runs: RunRec[]; npc: { meera: number; anil: number }; plays: Record<string, Play> }

const KEY = "halcyon.v1";
const blank = (): Store => ({ v: 1, profiles: [], scenario: { ...DEFAULT_SCENARIO }, cands: [], last: null, runs: [], npc: { meera: 50, anil: 50 }, plays: {} });
function load(): Store { try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null"); return s?.v === 1 ? s : blank(); } catch { return blank(); } }
export let db: Store = load();
export const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* private mode: state lives for this tab only */ } };
export const onRemoteChange = (cb: () => void) => addEventListener("storage", e => { if (e.key === KEY) { db = load(); cb(); } });
export const reset = () => { db = blank(); save(); };

let sid: string | undefined; // who this tab is; sessionStorage only helps it survive a reload
try { sid = sessionStorage.getItem("halcyon.me") ?? undefined; } catch { /* storage blocked: memory only */ }
export const me = (): Profile | undefined => db.profiles.find(p => p.id === sid);
export function signIn(role: Profile["role"], name: string) {
  const clean = name.trim().slice(0, 30) || (role === "recruiter" ? "Recruiter" : "Candidate");
  let p = db.profiles.find(x => x.role === role && x.name.toLowerCase() === clean.toLowerCase());
  if (!p) { p = { id: role[0] + Math.random().toString(36).slice(2, 8), role, name: clean }; db.profiles.push(p); save(); }
  sid = p.id; try { sessionStorage.setItem("halcyon.me", p.id); } catch { /* ignore */ }
  return p;
}
export const signOut = () => { sid = undefined; try { sessionStorage.removeItem("halcyon.me"); } catch { /* ignore */ } };
export const clampNpc = (v: number) => Math.max(0, Math.min(100, v));
