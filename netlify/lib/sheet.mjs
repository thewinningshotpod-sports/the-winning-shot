// The Sheet, server side: reads picks.txt the same way the page does, grades games
// from typed results or live ESPN finals, and builds the Beat the Room boards.
// Pure functions only (no storage), so they can be tested on their own.

export const NFL_ABBR = {"Arizona Cardinals":"ARI","Atlanta Falcons":"ATL","Baltimore Ravens":"BAL","Buffalo Bills":"BUF","Carolina Panthers":"CAR","Chicago Bears":"CHI","Cincinnati Bengals":"CIN","Cleveland Browns":"CLE","Dallas Cowboys":"DAL","Denver Broncos":"DEN","Detroit Lions":"DET","Green Bay Packers":"GB","Houston Texans":"HOU","Indianapolis Colts":"IND","Jacksonville Jaguars":"JAX","Kansas City Chiefs":"KC","Las Vegas Raiders":"LV","Los Angeles Chargers":"LAC","Los Angeles Rams":"LAR","Miami Dolphins":"MIA","Minnesota Vikings":"MIN","New England Patriots":"NE","New Orleans Saints":"NO","New York Giants":"NYG","New York Jets":"NYJ","Philadelphia Eagles":"PHI","Pittsburgh Steelers":"PIT","San Francisco 49ers":"SF","Seattle Seahawks":"SEA","Tampa Bay Buccaneers":"TB","Tennessee Titans":"TEN","Washington Commanders":"WAS"};
const ALIAS = { LA: "LAR", JAC: "JAX", WSH: "WAS" };
export const code = (s) => { s = String(s || "").trim().toUpperCase(); return ALIAS[s] || s; };
export const weekKey = (label) => String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
export const gameKey = (g) => `${g.away}-${g.home}`;

export function parsePicks(text) {
  const out = { people: [], start: {}, weeks: [] };
  let wk = null;
  String(text).split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    let m;
    if (/^FACE:/i.test(line) || /^GRADING:/i.test(line)) return;
    if ((m = line.match(/^PICKERS:\s*(.+)$/i))) { out.people = m[1].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean); return; }
    if ((m = line.match(/^STARTING RECORDS:\s*(.+)$/i))) {
      m[1].split("|").forEach((p) => { const r = p.trim().match(/^(\S+)\s+(\d+)\s*[-–]\s*(\d+)/); if (r) out.start[r[1].toUpperCase()] = [+r[2], +r[3]]; });
      return;
    }
    if ((m = line.match(/^WEEK\s+(.+)$/i))) { wk = { label: m[1].trim(), key: weekKey(m[1].trim()), games: [] }; out.weeks.push(wk); return; }
    if (!wk) return;
    const segs = line.split("|").map((s) => s.trim());
    const mm = segs[0].match(/^(\S+)\s+(?:at|@)\s+(\S+)$/i);
    if (!mm) return;
    const g = { away: code(mm[1]), home: code(mm[2]), kick: "", picks: {}, winner: "", final: null };
    segs.slice(1).forEach((s) => {
      const kv = s.match(/^([A-Za-z]+)\s*:\s*(.*)$/);
      if (kv) {
        const k = kv[1].toUpperCase(), v = kv[2].trim();
        if (k === "WINNER") g.winner = code(v);
        else if (k === "FINAL") { const f = v.match(/(\d+)\s*[-–]\s*(\d+)/); if (f) g.final = [+f[1], +f[2]]; }
        else g.picks[k] = code(v);
      } else if (s) g.kick = s;
    });
    wk.games.push(g);
  });
  if (!out.people.length) out.people = ["HUNDO", "JON", "COLLIN"];
  return out;
}

// The live ESPN game for a sheet game, if the scores feed has it.
export function liveGame(g, live) {
  const ab = (t) => code(NFL_ABBR[t.name] || t.abbr || t.short);
  return ((live && live.games) || []).find((x) => x.league === "NFL" && ab(x.home) === g.home && ab(x.away) === g.away) || null;
}

export function resultOf(g, live) {
  if (g.final) return g.final[0] === g.final[1] ? "TIE" : g.final[0] > g.final[1] ? g.away : g.home;
  if (g.winner) return g.winner;
  const f = liveGame(g, live);
  if (!f || f.status !== "final" || f.home.score == null || f.away.score == null) return "";
  return f.home.score === f.away.score ? "TIE" : f.home.score > f.away.score ? g.home : g.away;
}

// Picks close at kickoff. A game the live feed can't place is treated as closed,
// so nobody can pick a game that may already be over.
export function isLocked(g, live, now = Date.now()) {
  if (g.final || g.winner) return true;
  const f = liveGame(g, live);
  if (!f) return true;
  return f.status !== "scheduled" || new Date(f.date).getTime() <= now;
}

const grade = (pick, win) => (!pick || !win || win === "TIE" ? null : pick === win);
const add = (rec, ok) => { if (ok === true) rec[0]++; else if (ok === false) rec[1]++; };

// Majority pick of the visitors; an even split leaves the room without a pick.
export function roomPick(counts, g) {
  const a = counts[g.away] || 0, h = counts[g.home] || 0;
  return a === h ? "" : a > h ? g.away : g.home;
}

/**
 * players: [{nick, picks:{[weekKey]:{[gameKey]:TEAM}}}]
 * Returns the public board: per-week counts, the room's pick and every record,
 * plus a season table that starts with the first week anyone picked.
 */
export function buildBoard(P, players, live, now = Date.now()) {
  const people = P.people;
  const weeks = P.weeks.map((wk) => {
    const games = {};
    const hostRec = Object.fromEntries(people.map((p) => [p, [0, 0]]));
    const roomRec = [0, 0];
    const fanRec = new Map();
    let graded = 0, pickers = 0;
    players.forEach((pl) => { const mine = (pl.picks || {})[wk.key]; if (mine && Object.values(mine).some(Boolean)) { pickers++; fanRec.set(pl.nick, [0, 0]); } });
    wk.games.forEach((g) => {
      const gk = gameKey(g), counts = {};
      players.forEach((pl) => { const pk = ((pl.picks || {})[wk.key] || {})[gk]; if (pk === g.away || pk === g.home) counts[pk] = (counts[pk] || 0) + 1; });
      const room = roomPick(counts, g), win = resultOf(g, live);
      if (win) graded++;
      people.forEach((p) => add(hostRec[p], grade(g.picks[p], win)));
      add(roomRec, grade(room, win));
      players.forEach((pl) => { const r = fanRec.get(pl.nick); if (r) add(r, grade(((pl.picks || {})[wk.key] || {})[gk], win)); });
      games[gk] = { counts, room, win, locked: isLocked(g, live, now) };
    });
    const fans = [...fanRec].map(([nick, r]) => ({ nick, w: r[0], l: r[1] }));
    return { key: wk.key, label: wk.label, pickers, graded, games, hosts: hostRec, room: roomRec, fans };
  });

  // The Beat the Room season covers every week since the first one with visitor picks.
  const active = weeks.filter((w) => w.pickers > 0);
  const season = new Map();
  const bump = (name, kind, r) => { const s = season.get(name) || { name, kind, w: 0, l: 0 }; s.w += r[0]; s.l += r[1]; season.set(name, s); };
  active.forEach((w) => {
    people.forEach((p) => bump(p, "host", w.hosts[p]));
    bump("THE ROOM", "room", w.room);
    w.fans.forEach((f) => bump(f.nick, "fan", [f.w, f.l]));
  });
  const order = (a, b) => (b.w - b.l) - (a.w - a.l) || b.w - a.w || a.name.localeCompare(b.name);
  return {
    updated: new Date(now).toISOString(),
    since: active.length ? active[active.length - 1].label : null,
    players: players.length,
    weeks: weeks.map((w) => ({ ...w, fans: w.fans.sort((a, b) => order({ name: a.nick, ...a }, { name: b.nick, ...b })).slice(0, 100) })),
    season: [...season.values()].sort(order).slice(0, 200),
  };
}

const RESERVED = /^(the ?room|room|hundo|jon|collin|admin|moderator|the ?winning ?shot|winning ?shot|tws|you|me)$/i;
const BLOCKED = /(fuck|shit|cunt|nigg|fag|bitch|whore|slut|rape|nazi|hitler|kike|spic|chink|retard|dick|pussy|cock)/i;
export function cleanNick(s) {
  const n = String(s || "").replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 18) return { error: "Use 2 to 18 characters." };
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._'-]*$/.test(n)) return { error: "Letters, numbers, spaces and . _ ' - only." };
  if (RESERVED.test(n.replace(/[^A-Za-z ]/g, ""))) return { error: "That name is taken." };
  if (BLOCKED.test(n.replace(/[^A-Za-z]/g, ""))) return { error: "Pick a different name." };
  return { nick: n, key: n.toLowerCase().replace(/[^a-z0-9]/g, "") };
}
