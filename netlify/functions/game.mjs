// One NFL game's details from ESPN's game summary (unofficial, no key):
// team stats and leaders once it starts, injuries and weather before it does.
//   GET /api/game?id=<ESPN event id>
import { kickoffWeather } from "../lib/weather.mjs";

const pick = (stats, names) => names.map((n) => stats.find((s) => s.name === n)).filter(Boolean);
const STATS = ["totalYards", "netPassingYards", "rushingYards", "firstDowns", "thirdDownEff", "turnovers", "possessionTime", "sacksYardsLost", "totalPenaltiesYards"];

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^\d{5,14}$/.test(id)) return Response.json({ error: "Bad game id." }, { status: 400 });
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`, { headers: { accept: "application/json" } });
  if (!r.ok) return Response.json({ error: `ESPN ${r.status}` }, { status: 502 });
  const s = await r.json();
  const comp = (s.header && s.header.competitions && s.header.competitions[0]) || {};
  const state = (comp.status && comp.status.type && comp.status.type.state) || "pre";
  const side = (ha) => (comp.competitors || []).find((c) => c.homeAway === ha) || {};
  const ab = (c) => (c.team && c.team.abbreviation) || "";
  const teams = { home: ab(side("home")), away: ab(side("away")) };

  // Team stats: only the lines both teams have, in a fixed order.
  const bt = (s.boxscore && s.boxscore.teams) || [];
  const tAway = bt.find((t) => t.homeAway === "away") || bt[0], tHome = bt.find((t) => t.homeAway === "home") || bt[1];
  let stats = [];
  if (state !== "pre" && tAway && tHome) {
    const a = tAway.statistics || [], h = tHome.statistics || [];
    stats = pick(a, STATS).map((x) => { const y = h.find((z) => z.name === x.name); return y ? { label: x.label, away: x.displayValue, home: y.displayValue } : null; }).filter(Boolean).slice(0, 7);
  }

  // Leaders: passing, rushing, receiving for each team.
  const leaders = state === "pre" ? [] : (s.leaders || []).map((t) => ({
    team: (t.team && t.team.abbreviation) || "",
    cats: (t.leaders || []).filter((c) => /passing|rushing|receiving/i.test(c.name || "")).slice(0, 3).map((c) => {
      const l = (c.leaders || [])[0];
      return l ? { cat: c.displayName || c.name, name: (l.athlete && (l.athlete.shortName || l.athlete.displayName)) || "", line: l.displayValue || "" } : null;
    }).filter(Boolean),
  }));

  // Injuries: players listed Out, Doubtful or Questionable.
  const ORDER = { out: 0, "injured reserve": 0, doubtful: 1, questionable: 2 };
  const injuries = (s.injuries || []).map((t) => ({
    team: (t.team && t.team.abbreviation) || "",
    list: (t.injuries || []).map((i) => ({ name: (i.athlete && (i.athlete.shortName || i.athlete.displayName)) || "", pos: (i.athlete && i.athlete.position && i.athlete.position.abbreviation) || "", status: String(i.status || ""), detail: (i.details && (i.details.type || i.details.detail)) || (i.type && i.type.description) || "" }))
      .filter((i) => ORDER[i.status.toLowerCase()] != null).sort((a, b) => ORDER[a.status.toLowerCase()] - ORDER[b.status.toLowerCase()]).slice(0, 6),
  })).filter((t) => t.list.length);

  const gi = s.gameInfo || {};
  const v = gi.venue || {};
  const venue = v.fullName ? { name: v.fullName, city: (v.address || {}).city || "", state: (v.address || {}).state || "", country: (v.address || {}).country || "", indoor: !!v.indoor || /dome|indoor/i.test(v.fullName) } : null;
  let weather = null;
  if (state === "pre" && venue) { try { weather = await kickoffWeather(venue, comp.date); } catch { /* no weather */ } }

  const wpSeries = (s.winprobability || []).map((p) => Math.round((p.homeWinPercentage ?? 0) * 1000) / 1000).filter((x) => x >= 0 && x <= 1);
  const step = Math.max(1, Math.ceil(wpSeries.length / 60));
  return Response.json({ id, state, teams, stats, leaders, injuries, venue, weather, wp: wpSeries.filter((_, i) => i % step === 0 || i === wpSeries.length - 1), link: `https://www.espn.com/nfl/game/_/gameId/${id}` }, {
    headers: { "Cache-Control": "public, max-age=30", "Netlify-CDN-Cache-Control": `public, s-maxage=${state === "in" ? 30 : 900}, stale-while-revalidate=60` },
  });
};

export const config = { path: "/api/game" };
