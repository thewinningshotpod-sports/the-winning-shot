// Beat the Room: visitors pick every game against Hundo, Jon and Collin.
// Saved in Netlify Blobs, store "room":
//   p/<player id>   {nick, th (hash of the player's secret), leagues[], picks{week:{game:TEAM}}}
//   n/<name key>    {pid}           one name per player
//   l/<CODE>        {name, created} a private league
//
//   GET  /api/room                 public board (counts, the room's picks, records, season table)
//   GET  /api/room?league=CODE     the same board for one league's members, plus the league's name
//   GET  /api/room?me=<id>         that player's name, picks and leagues
//   POST /api/room {action, pid, token, ...}
//        hello  {nick}             create the player or change the name
//        pick   {week, game, pick} pick a team (pick:null clears it); closes at kickoff
//        league {name}             start a league, returns its code
//        join   {code}             join a league
import { getStore } from "@netlify/blobs";
import { createHash, randomInt } from "node:crypto";
import { refresh, maxAgeMs } from "../lib/sports.mjs";
import { parsePicks, buildBoard, isLocked, gameKey, cleanNick } from "../lib/sheet.mjs";

const json = (data, status = 200, cache = "no-store") =>
  Response.json(data, { status, headers: { "Cache-Control": cache } });
const PUBLIC = "public, max-age=10";
const ID = /^[a-z0-9-]{16,64}$/i;
const hash = (s) => createHash("sha256").update(String(s)).digest("hex");

let picksCache = { at: 0, P: null };
async function sheet(origin) {
  if (picksCache.P && Date.now() - picksCache.at < 30e3) return picksCache.P;
  const r = await fetch(new URL("/picks.txt", origin), { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`picks.txt ${r.status}`);
  picksCache = { at: Date.now(), P: parsePicks(await r.text()) };
  return picksCache.P;
}

async function scores() {
  let data = await getStore("scores").get("latest", { type: "json" });
  const age = data && data.updated ? Date.now() - new Date(data.updated).getTime() : Infinity;
  if (age > maxAgeMs(data)) { try { data = await refresh(); } catch { /* keep what we have */ } }
  return data || { games: [] };
}

let playersCache = { at: 0, list: null };
async function allPlayers(store) {
  if (playersCache.list && Date.now() - playersCache.at < 15e3) return playersCache.list;
  const keys = [];
  for await (const page of store.list({ prefix: "p/", paginate: true })) page.blobs.forEach((b) => keys.push(b.key));
  const list = [];
  for (let i = 0; i < keys.length; i += 50) {
    const got = await Promise.all(keys.slice(i, i + 50).map((k) => store.get(k, { type: "json" }).catch(() => null)));
    got.forEach((p, j) => { if (p && p.nick) list.push({ pid: keys[i + j].slice(2), nick: p.nick, picks: p.picks || {}, leagues: p.leagues || [], ref: p.ref || null }); });
  }
  playersCache = { at: Date.now(), list };
  return list;
}

async function player(store, pid, token) {
  if (!ID.test(pid || "") || !token || String(token).length < 16) return { error: "Missing player id." };
  const p = await store.get(`p/${pid}`, { type: "json" });
  if (p && p.th !== hash(token)) return { error: "That player belongs to another device." };
  return { p };
}

export default async (req) => {
  const store = getStore({ name: "room", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const me = url.searchParams.get("me");
    if (me) {
      if (!ID.test(me)) return json({ error: "Bad id." }, 400);
      const p = await store.get(`p/${me}`, { type: "json" });
      const leagues = p ? (await Promise.all((p.leagues || []).map(async (c) => {
        const l = await store.get(`l/${c}`, { type: "json" });
        return l ? { code: c, name: l.name } : null;
      }))).filter(Boolean) : [];
      let refs = 0;
      if (p) { const mk = cleanNick(p.nick).key; refs = (await allPlayers(store)).filter((x) => x.ref === mk).length; }
      return json(p ? { nick: p.nick, picks: p.picks || {}, leagues, refs, refKey: cleanNick(p.nick).key } : { nick: null, picks: {}, leagues: [], refs: 0 });
    }
    // Who has brought in 3 or more friends (their name gets read on Grading Night).
    if (url.searchParams.get("refs") != null) {
      const players = await allPlayers(store), byKey = new Map(players.map((x) => [cleanNick(x.nick).key, x.nick])), n = {};
      players.forEach((x) => { if (x.ref) n[x.ref] = (n[x.ref] || 0) + 1; });
      return json({ earned: Object.entries(n).filter(([, c]) => c >= 3).map(([k, c]) => ({ nick: byKey.get(k) || k, friends: c })).sort((a, b) => b.friends - a.friends) }, 200, PUBLIC);
    }
    const league = (url.searchParams.get("league") || "").toUpperCase();
    try {
      const [P, live, players] = await Promise.all([sheet(req.url), scores(), allPlayers(store)]);
      if (league) {
        if (!/^[A-Z2-9]{6}$/.test(league)) return json({ error: "Bad league code." }, 400);
        const l = await store.get(`l/${league}`, { type: "json" });
        if (!l) return json({ error: "No league with that code." }, 404);
        const members = players.filter((p) => p.leagues.includes(league));
        return json({ ...buildBoard(P, members, live), league: { code: league, name: l.name, members: members.length } }, 200, PUBLIC);
      }
      return json(buildBoard(P, players, live), 200, PUBLIC);
    } catch (e) {
      return json({ error: "The board is unavailable right now.", detail: e.message }, 503);
    }
  }

  if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Send JSON." }, 400); }
  const { action, pid, token } = body || {};
  const got = await player(store, pid, token);
  if (got.error) return json({ error: got.error }, 403);
  let p = got.p;

  if (action === "hello") {
    const n = cleanNick(body.nick);
    if (n.error) return json({ error: n.error }, 400);
    const owner = await store.get(`n/${n.key}`, { type: "json" });
    if (owner && owner.pid !== pid) return json({ error: "Someone already has that name." }, 409);
    if (p && p.nick) {
      const oldKey = cleanNick(p.nick).key;
      if (oldKey && oldKey !== n.key) await store.delete(`n/${oldKey}`);
    }
    await store.setJSON(`n/${n.key}`, { pid });
    const isNew = !p;
    p = { ...(p || { th: hash(token), created: new Date().toISOString(), leagues: [], picks: {} }), nick: n.nick };
    // A friend's invite link (?ref=name) is credited once, when the player is created.
    if (isNew && body.ref) {
      const rk = String(body.ref).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18);
      if (rk && rk !== n.key && (await store.get(`n/${rk}`))) p.ref = rk;
    }
    await store.setJSON(`p/${pid}`, p);
    playersCache.at = 0;
    return json({ nick: p.nick });
  }

  if (!p || !p.nick) return json({ error: "Choose a name first." }, 400);

  if (action === "pick") {
    const P = await sheet(req.url);
    const wk = P.weeks.find((w) => w.key === body.week);
    const g = wk && wk.games.find((x) => gameKey(x) === body.game);
    if (!g) return json({ error: "That game isn't on the sheet." }, 400);
    const pick = body.pick == null ? null : String(body.pick).toUpperCase();
    if (pick && pick !== g.away && pick !== g.home) return json({ error: "Pick one of the two teams." }, 400);
    if (isLocked(g, await scores())) return json({ error: "Picks for this game closed at kickoff.", locked: true }, 409);
    p.picks = p.picks || {};
    p.picks[wk.key] = p.picks[wk.key] || {};
    if (pick) p.picks[wk.key][body.game] = pick; else delete p.picks[wk.key][body.game];
    await store.setJSON(`p/${pid}`, p);
    playersCache.at = 0;
    return json({ ok: true, week: wk.key, game: body.game, pick });
  }

  if (action === "league") {
    const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 32);
    if (name.length < 2) return json({ error: "Give the league a name." }, 400);
    if (cleanNick(name.slice(0, 18)).error === "Pick a different name.") return json({ error: "Pick a different name." }, 400);
    if ((p.leagues || []).length >= 10) return json({ error: "You're in ten leagues already." }, 400);
    const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let c = "";
    for (let tries = 0; tries < 5; tries++) {
      c = Array.from({ length: 6 }, () => ABC[randomInt(ABC.length)]).join("");
      if (!(await store.get(`l/${c}`))) break;
    }
    await store.setJSON(`l/${c}`, { name, created: new Date().toISOString() });
    p.leagues = [...new Set([...(p.leagues || []), c])];
    await store.setJSON(`p/${pid}`, p);
    playersCache.at = 0;
    return json({ code: c, name });
  }

  if (action === "join") {
    const c = String(body.code || "").toUpperCase();
    const l = /^[A-Z2-9]{6}$/.test(c) && (await store.get(`l/${c}`, { type: "json" }));
    if (!l) return json({ error: "No league with that code." }, 404);
    if (!(p.leagues || []).includes(c)) {
      if ((p.leagues || []).length >= 10) return json({ error: "You're in ten leagues already." }, 400);
      p.leagues = [...(p.leagues || []), c];
      await store.setJSON(`p/${pid}`, p);
      playersCache.at = 0;
    }
    return json({ code: c, name: l.name });
  }

  return json({ error: "Unknown action." }, 400);
};

export const config = { path: "/api/room" };
