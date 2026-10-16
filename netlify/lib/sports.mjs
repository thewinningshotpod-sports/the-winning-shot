// Shared code for The Winning Shot's score updates.
// Pulls games from API-Sports for four leagues, turns them into one simple
// format, and saves the last eight days in Netlify Blobs under "scores/latest".

import { getStore } from "@netlify/blobs";

const TZ = "America/New_York";

// One entry per league. `season` works out the season API-Sports expects
// from today's date (y = year, m = month 1-12, in Eastern time).
export const LEAGUES = [
  { code: "NFL", host: "v1.american-football.api-sports.io", path: "/games", league: 1,
    season: ({ y, m }) => (m >= 3 ? y : y - 1) },
  { code: "NBA", host: "v1.basketball.api-sports.io", path: "/games", league: 12,
    season: ({ y, m }) => (m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`) },
  { code: "MLB", host: "v1.baseball.api-sports.io", path: "/games", league: 1,
    season: ({ y }) => y },
  { code: "EPL", host: "v3.football.api-sports.io", path: "/fixtures", league: 39,
    season: ({ y, m }) => (m >= 7 ? y : y - 1) },
];

// Days to fetch on each run, relative to today in Eastern time.
// Each run makes 3 calls per sport. Hourly runs = 72 calls a day per sport,
// under the free plan's 100 a day. On a paid plan you can run more often.
const DAY_OFFSETS = [-1, 0, 1];
const KEEP_DAYS = 8;

export function easternDate(offsetDays = 0, now = Date.now()) {
  return new Date(now + offsetDays * 864e5).toLocaleDateString("en-CA", { timeZone: TZ });
}
function easternYM(now = Date.now()) {
  const [y, m] = easternDate(0, now).split("-").map(Number);
  return { y, m };
}

// Short display names for the ticker: "Buffalo Bills" -> "Bills".
const TWO_WORD = ["Red Sox", "White Sox", "Blue Jays", "Maple Leafs", "Red Wings", "Blue Jackets",
  "Golden Knights", "Trail Blazers"];
export function shortName(name = "", league = "") {
  const n = String(name).trim();
  if (league === "EPL") return n.replace(/^AFC\s+/, "").replace(/\s+(FC|AFC)$/, "").replace(/ & Hove Albion$/, "");
  const two = TWO_WORD.find((t) => n.endsWith(" " + t));
  if (two) return two;
  const parts = n.split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : n;
}

const FINAL = new Set(["FT", "AOT", "AET", "PEN", "AP"]);
const SCHEDULED = new Set(["NS", "TBD"]);
const OFF = new Set(["PST", "POST", "CANC", "ABD", "SUSP", "AWD", "WO", "INTR"]);

function statusOf(league, short, elapsed) {
  const s = String(short || "").toUpperCase();
  if (FINAL.has(s)) {
    if (s === "AOT") return ["final", "Final/OT"];
    if (s === "AP") return ["final", league === "EPL" ? "Pens" : "Final/SO"];
    if (s === "AET") return ["final", "AET"];
    if (s === "PEN") return ["final", "Pens"];
    return ["final", league === "EPL" ? "FT" : "Final"];
  }
  if (SCHEDULED.has(s)) return ["scheduled", ""];
  if (OFF.has(s)) return ["off", s === "PST" || s === "POST" ? "Postponed" : s === "CANC" ? "Canceled" : s];
  if (league === "EPL" && elapsed) return ["live", `${elapsed}'`];
  const inn = s.match(/^IN(\d+)$/);
  if (inn) return ["live", `Inn ${inn[1]}`];
  return ["live", s || "Live"];
}

const num = (v) => {
  if (v == null) return null;
  if (typeof v === "object") v = v.total ?? null;
  const n = Number(v);
  return v === null || Number.isNaN(n) ? null : n;
};

// Turns one API-Sports game into { id, league, date, status, statusText, home, away }.
export function normalize(L, item) {
  try {
    const g = item.game || item.fixture || item;
    const id = g.id ?? item.id;
    const ts = g.timestamp ?? g.date?.timestamp ?? item.timestamp;
    const date = ts ? new Date(ts * 1000) : new Date(g.date?.date ? `${g.date.date}T${g.date.time || "00:00"}Z` : g.date || item.date);
    if (id == null || Number.isNaN(date.getTime())) return null;
    const st = g.status || item.status || {};
    const [status, statusText] = statusOf(L.code, st.short, st.elapsed);
    const t = item.teams || {};
    const sc = L.code === "EPL" ? item.goals || {} : item.scores || {};
    const side = (k) => ({
      name: t[k]?.name || "TBD",
      short: shortName(t[k]?.name, L.code),
      score: status === "scheduled" ? null : num(sc[k]),
    });
    return { id: `${L.code}-${id}`, league: L.code, date: date.toISOString(), status, statusText, home: side("home"), away: side("away") };
  } catch {
    return null;
  }
}

async function fetchLeague(L, date, key, now) {
  const params = new URLSearchParams({ league: String(L.league), season: String(L.season(easternYM(now))), date, timezone: TZ });
  const res = await fetch(`https://${L.host}${L.path}?${params}`, { headers: { "x-apisports-key": key } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const errs = json.errors && (Array.isArray(json.errors) ? json.errors : Object.values(json.errors));
  if (errs && errs.length) throw new Error(errs.join("; "));
  return json.response || [];
}

// Fetch every league, merge with what was saved before, keep the last KEEP_DAYS days, save.
export async function refresh({ now = Date.now() } = {}) {
  const key = process.env.API_SPORTS_KEY;
  if (!key) throw new Error("API_SPORTS_KEY is not set in Netlify's environment variables.");
  const store = getStore("scores");
  const prev = (await store.get("latest", { type: "json" })) || { games: [] };
  const games = new Map((prev.games || []).map((g) => [g.id, g]));
  const errors = [];
  const dates = DAY_OFFSETS.map((d) => easternDate(d, now));

  await Promise.all(LEAGUES.map(async (L) => {
    for (const d of dates) {
      try {
        for (const item of await fetchLeague(L, d, key, now)) {
          const g = normalize(L, item);
          if (g) games.set(g.id, g);
        }
      } catch (e) {
        errors.push(`${L.code} ${d}: ${e.message}`);
      }
    }
  }));

  const cutoff = now - KEEP_DAYS * 864e5;
  const data = {
    updated: new Date(now).toISOString(),
    games: [...games.values()].filter((g) => new Date(g.date).getTime() > cutoff).sort((a, b) => a.date.localeCompare(b.date)),
    errors,
  };
  await store.setJSON("latest", data);
  if (errors.length) console.warn("Score refresh finished with errors:", errors);
  return data;
}
