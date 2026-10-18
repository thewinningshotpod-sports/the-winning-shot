// Trending players for Who Better?: the NFL players most added in Sleeper fantasy leagues
// over the last 48 hours (Sleeper API, free, read-only, no key), paired by position.
//   GET /api/trending -> { matchups: [{ pos, a: {name, team, adds, wiki}, b: {...} }], updated }
// Each player's Wikipedia page is found by search (name + team + "American football"),
// so the photo on the card is the right person or none at all.
import { getStore } from "@netlify/blobs";

const POS = { QB: "Quarterback", RB: "Running back", WR: "Wide receiver", TE: "Tight end" };
const json = (d) => Response.json(d, { headers: { "Cache-Control": "public, max-age=900", "Netlify-CDN-Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" } });

async function players(store) {
  const saved = await store.get("players", { type: "json" });
  if (saved && Date.now() - saved.at < 24 * 3600e3) return saved.map;
  const r = await fetch("https://api.sleeper.app/v1/players/nfl");
  if (!r.ok) { if (saved) return saved.map; throw new Error(`Sleeper ${r.status}`); }
  const all = await r.json(), map = {};
  for (const [id, p] of Object.entries(all)) {
    if (p && POS[p.position] && p.team && p.full_name) map[id] = { n: p.full_name, p: p.position, t: p.team };
  }
  await store.setJSON("players", { at: Date.now(), map });
  return map;
}

async function wikiTitle(store, p) {
  const key = `wiki/${p.n}|${p.t}`.toLowerCase().replace(/[^a-z0-9/|]+/g, "-");
  const hit = await store.get(key, { type: "json" });
  if (hit) return hit.title;
  let title = null;
  try {
    const q = `${p.n} American football ${p.t}`;
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=3&format=json&formatversion=2`, { headers: { "User-Agent": "TheWinningShot/1.0 (thewinningshot.netlify.app)" } });
    const hits = ((await r.json()).query || {}).search || [];
    const last = p.n.split(" ").slice(-1)[0].toLowerCase();
    const ok = hits.find((h) => h.title.toLowerCase().startsWith(p.n.toLowerCase()) && /football|nfl|quarterback|receiver|running back|tight end/i.test(h.snippet || ""))
      || hits.find((h) => h.title.toLowerCase().includes(last) && /american football/i.test(h.title));
    title = ok ? ok.title : null;
  } catch { /* leave it out */ }
  await store.setJSON(key, { title });
  return title;
}

export default async () => {
  const store = getStore({ name: "trending", consistency: "strong" });
  const cached = await store.get("latest", { type: "json" });
  if (cached && Date.now() - cached.at < 3 * 3600e3) return json(cached.data);
  try {
    const [map, tr] = await Promise.all([players(store), fetch("https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=60").then((r) => (r.ok ? r.json() : []))]);
    const byPos = {};
    for (const t of tr) {
      const p = map[t.player_id];
      if (!p) continue;
      (byPos[p.p] = byPos[p.p] || []).push({ ...p, adds: t.count });
    }
    const matchups = [];
    for (const [pos, list] of Object.entries(byPos)) {
      for (let i = 0; i + 1 < list.length && i < 4; i += 2) matchups.push({ pos: POS[pos], a: list[i], b: list[i + 1], heat: list[i].adds + list[i + 1].adds });
    }
    matchups.sort((x, y) => y.heat - x.heat);
    const top = matchups.slice(0, 6);
    await Promise.all(top.flatMap((m) => ["a", "b"].map(async (s) => { const p = m[s]; m[s] = { name: p.n, team: p.t, adds: p.adds, wiki: await wikiTitle(store, p) }; })));
    const data = { updated: new Date().toISOString(), lookbackHours: 48, matchups: top.map(({ heat, ...m }) => m) };
    await store.setJSON("latest", { at: Date.now(), data });
    return json(data);
  } catch (e) {
    return json(cached ? cached.data : { matchups: [], error: e.message });
  }
};

export const config = { path: "/api/trending" };
