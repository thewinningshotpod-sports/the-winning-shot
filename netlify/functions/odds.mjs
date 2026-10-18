// Vegas: each NFL game's favorite, for the VEGAS column on the Sheet.
//   GET /api/odds -> { source, lines: { "SEA-DEN": { fav, prob, details, source, at } } }
// With ODDS_API_KEY set (The Odds API, free plan: 500 credits a month), lines come from the
// median of US sportsbooks, refreshed at most every 3 hours (1 credit per refresh, about 240 a month).
// Without it, the page uses the line ESPN shows on its scoreboard.
// A game's line is frozen at kickoff, so every game is graded against its closing line.
import { getStore } from "@netlify/blobs";
import { NFL_ABBR, code } from "../lib/sheet.mjs";

const EVERY = 3 * 3600e3;
const json = (d, cache = "public, max-age=60") => Response.json(d, { headers: { "Cache-Control": cache, "Netlify-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
const abbr = (name) => code(NFL_ABBR[name] || name);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function fromOddsApi(key) {
  const url = `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${encodeURIComponent(key)}&regions=us&markets=h2h&oddsFormat=decimal`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`The Odds API ${r.status}`);
  const remaining = r.headers.get("x-requests-remaining");
  const out = {};
  for (const g of await r.json()) {
    const home = abbr(g.home_team), away = abbr(g.away_team), probs = { [home]: [], [away]: [] };
    for (const b of g.bookmakers || []) {
      const m = (b.markets || []).find((x) => x.key === "h2h");
      if (!m) continue;
      const o = Object.fromEntries((m.outcomes || []).map((x) => [abbr(x.name), 1 / x.price]));
      if (o[home] && o[away]) { const t = o[home] + o[away]; probs[home].push(o[home] / t); probs[away].push(o[away] / t); }
    }
    if (!probs[home].length) continue;
    const ph = median(probs[home]), pa = median(probs[away]);
    if (ph === pa) continue;
    const fav = ph > pa ? home : away;
    out[`${away}-${home}`] = { fav, prob: Math.round(Math.max(ph, pa) * 1000) / 1000, details: "", source: "Sportsbook consensus", books: probs[home].length, kickoff: g.commence_time };
  }
  return { out, remaining };
}

export default async () => {
  const store = getStore({ name: "odds", consistency: "strong" });
  const saved = (await store.get("lines", { type: "json" })) || { lines: {}, fetched: 0 };
  const scores = (await getStore("scores").get("latest", { type: "json" })) || { games: [] };
  const now = Date.now();
  const nfl = scores.games.filter((g) => g.league === "NFL");
  const keyOf = (g) => `${abbr(g.away.name) || code(g.away.abbr)}-${abbr(g.home.name) || code(g.home.abbr)}`;
  const started = new Set(nfl.filter((g) => g.status !== "scheduled" || new Date(g.date).getTime() <= now).map(keyOf));
  const lines = { ...saved.lines };
  const put = (k, v) => { if (!started.has(k) || !lines[k]) lines[k] = { ...v, at: new Date().toISOString() }; };

  // ESPN's own line, as a fallback (and the only source when there is no key).
  nfl.forEach((g) => {
    const k = keyOf(g);
    if (g.line && g.line.fav && !(lines[k] && lines[k].source === "Sportsbook consensus")) put(k, { ...g.line, fav: code(g.line.fav) });
  });

  const key = process.env.ODDS_API_KEY;
  let source = "ESPN", note = null;
  if (key) {
    source = "The Odds API";
    const upcoming = nfl.some((g) => g.status === "scheduled" && new Date(g.date).getTime() > now && new Date(g.date).getTime() < now + 8 * 864e5);
    if (upcoming && now - (saved.fetched || 0) > EVERY) {
      try {
        const { out, remaining } = await fromOddsApi(key);
        Object.entries(out).forEach(([k, v]) => { if (!(v.kickoff && new Date(v.kickoff).getTime() <= now)) put(k, v); });
        saved.fetched = now; saved.remaining = remaining;
      } catch (e) { note = e.message; }
    }
  }
  // Keep about three weeks of lines.
  const cutoff = now - 21 * 864e5;
  Object.keys(lines).forEach((k) => { if (new Date(lines[k].at).getTime() < cutoff) delete lines[k]; });
  await store.setJSON("lines", { lines, fetched: saved.fetched || 0, remaining: saved.remaining ?? null });
  return json({ source, lines, remaining: saved.remaining ?? null, note });
};

export const config = { path: "/api/odds" };
