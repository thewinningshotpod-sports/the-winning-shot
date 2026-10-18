// Shared code for The Winning Shot's live scores.
// Source: ESPN's public scoreboard feed (no key needed). It is unofficial and
// undocumented, so if ESPN changes it, this file is the one place to fix.
// Games from the last eight days are kept in Netlify Blobs under "scores/latest".

import { getStore } from "@netlify/blobs";

const TZ = "America/New_York";
const BASE = "https://site.api.espn.com/apis/site/v2/sports/";

export const LEAGUES = [
  { code: "NFL", path: "football/nfl" },
  { code: "NBA", path: "basketball/nba" },
  { code: "MLB", path: "baseball/mlb" },
  { code: "EPL", path: "soccer/eng.1" },
];

// Each refresh reads the current scoreboard plus yesterday, today and tomorrow (Eastern).
const DAY_OFFSETS = [-1, 0, 1];
const KEEP_DAYS = 8;

export function easternDate(offsetDays = 0, now = Date.now()) {
  return new Date(now + offsetDays * 864e5).toLocaleDateString("en-CA", { timeZone: TZ });
}
const espnDate = (offset, now) => easternDate(offset, now).replace(/-/g, "");

const num = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// Turns one ESPN event into { id, league, date, status, statusText, home, away }.
export function normalize(L, ev) {
  try {
    const comp = (ev.competitions || [])[0];
    if (!comp) return null;
    const type = (ev.status || comp.status || {}).type || {};
    const name = String(type.name || "");
    let status = type.state === "in" ? "live" : type.state === "post" ? "final" : "scheduled";
    if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED/.test(name)) status = "off";
    const statusText = status === "scheduled" ? "" : String(type.shortDetail || type.detail || (status === "final" ? "Final" : "Live"));
    const side = (homeAway) => {
      const c = comp.competitors.find((x) => x.homeAway === homeAway) || {};
      const t = c.team || {};
      return {
        name: t.displayName || t.name || "TBD",
        short: t.shortDisplayName || t.name || t.abbreviation || "TBD",
        abbr: t.abbreviation || "",
        logo: t.logo || "",
        score: status === "scheduled" || status === "off" ? null : num(c.score),
      };
    };
    const date = new Date(ev.date);
    if (!ev.id || Number.isNaN(date.getTime())) return null;
    const out = { id: `${L.code}-${ev.id}`, league: L.code, date: date.toISOString(), status, statusText, home: side("home"), away: side("away") };
    if (L.code === "NFL") Object.assign(out, nflExtras(comp, status, out));
    return out;
  } catch {
    return null;
  }
}

// NFL only: ESPN's game id (for box scores), live win probability, the venue, and the pre-game line.
const pct = (v) => { const n = num(v); return n == null ? null : n > 1 ? n / 100 : n; };
function nflExtras(comp, status, g) {
  const x = { espnId: String(comp.id || "").trim() || undefined };
  const pr = comp.situation && comp.situation.lastPlay && comp.situation.lastPlay.probability;
  if (status === "live" && pr && pct(pr.homeWinPercentage) != null) {
    x.wp = { home: pct(pr.homeWinPercentage), away: pct(pr.awayWinPercentage), tie: pct(pr.tiePercentage) || 0 };
  }
  const v = comp.venue;
  if (v) {
    const a = v.address || {};
    x.venue = { name: v.fullName || "", city: a.city || "", state: a.state || "", country: a.country || "", indoor: !!v.indoor };
  }
  const o = (comp.odds || [])[0];
  if (o && status === "scheduled") {
    const ml = (t) => num(t && (t.moneyLine ?? t.moneyline));
    const hm = ml(o.homeTeamOdds), am = ml(o.awayTeamOdds);
    let fav = o.homeTeamOdds && o.homeTeamOdds.favorite ? g.home.abbr : o.awayTeamOdds && o.awayTeamOdds.favorite ? g.away.abbr : "";
    if (!fav && hm != null && am != null && hm !== am) fav = hm < am ? g.home.abbr : g.away.abbr;
    if (!fav && o.details) { const m = String(o.details).match(/^([A-Z]{2,3})\s/); if (m) fav = m[1]; }
    const imp = (m) => (m == null ? null : m < 0 ? -m / (-m + 100) : 100 / (m + 100));
    let prob = null;
    if (fav && hm != null && am != null) { const h = imp(hm), a2 = imp(am); prob = (fav === g.home.abbr ? h : a2) / (h + a2); }
    if (fav) x.line = { fav, prob: prob == null ? null : Math.round(prob * 1000) / 1000, details: String(o.details || ""), source: (o.provider && o.provider.name) || "ESPN", at: new Date().toISOString() };
  }
  return x;
}

async function fetchBoard(L, date) {
  const url = `${BASE}${L.path}/scoreboard?limit=200${date ? `&dates=${date}` : ""}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.events || [];
}

// Fetch every league, merge with what was saved before, keep the last KEEP_DAYS days, save.
export async function refresh({ now = Date.now() } = {}) {
  const store = getStore("scores");
  const prev = (await store.get("latest", { type: "json" })) || { games: [] };
  const games = new Map((prev.games || []).map((g) => [g.id, g]));
  const errors = [];
  const dates = [null, ...DAY_OFFSETS.map((d) => espnDate(d, now))];

  await Promise.all(LEAGUES.flatMap((L) => dates.map(async (d) => {
    try {
      for (const ev of await fetchBoard(L, d)) {
        const g = normalize(L, ev);
        if (!g) continue;
        // Keep the last line seen before kickoff: games are graded against the closing line.
        const old = games.get(g.id);
        if (old && old.line && !g.line) g.line = old.line;
        games.set(g.id, g);
      }
    } catch (e) {
      errors.push(`${L.code} ${d || "current"}: ${e.message}`);
    }
  })));

  const cutoff = now - KEEP_DAYS * 864e5;
  const horizon = now + 10 * 864e5;
  const data = {
    updated: new Date(now).toISOString(),
    source: "ESPN",
    games: [...games.values()]
      .filter((g) => { const t = new Date(g.date).getTime(); return t > cutoff && t < horizon; })
      .sort((a, b) => a.date.localeCompare(b.date)),
    errors,
  };
  await store.setJSON("latest", data);
  if (errors.length) console.warn("Score refresh finished with errors:", errors);
  return data;
}

// How old saved scores may be before the next request refreshes them:
// 30 seconds while any game is live or about to start, 5 minutes otherwise.
export function maxAgeMs(data, now = Date.now()) {
  const games = (data && data.games) || [];
  const busy = games.some((g) => g.status === "live" ||
    (g.status === "scheduled" && new Date(g.date).getTime() < now + 15 * 60e3 && new Date(g.date).getTime() > now - 6 * 3600e3));
  return busy ? 30e3 : 5 * 60e3;
}
