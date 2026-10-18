// Kickoff weather for this week's NFL games (Open-Meteo, free, no key).
//   GET /api/weather -> { games: { "BUF-LV": { text: "Indoors", dome: true }, "DAL-GB": { text: "Clear, 48°F, wind 12 mph", ... } } }
import { getStore } from "@netlify/blobs";
import { NFL_ABBR, code } from "../lib/sheet.mjs";
import { kickoffWeather } from "../lib/weather.mjs";

const abbr = (t) => code(NFL_ABBR[t.name] || t.abbr);

export default async () => {
  const scores = (await getStore("scores").get("latest", { type: "json" })) || { games: [] };
  const now = Date.now();
  const list = scores.games.filter((g) => g.league === "NFL" && g.status === "scheduled" && g.venue &&
    new Date(g.date).getTime() > now - 3600e3 && new Date(g.date).getTime() < now + 8 * 864e5);
  const games = {};
  await Promise.all(list.map(async (g) => {
    try { const w = await kickoffWeather(g.venue, g.date); if (w) games[`${abbr(g.away)}-${abbr(g.home)}`] = { ...w, venue: g.venue.name }; } catch { /* skip this one */ }
  }));
  return Response.json({ updated: new Date().toISOString(), games }, {
    headers: { "Cache-Control": "public, max-age=600", "Netlify-CDN-Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" },
  });
};

export const config = { path: "/api/weather" };
