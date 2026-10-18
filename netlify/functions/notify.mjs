// Runs every 5 minutes. Sends each push alert once:
//   lock     30 minutes before a kickoff slot ("You haven't picked ARI at LAR")
//   grading  10 minutes before Grading Night
//   result   at Grading Night, each player's week ("You went 9-5 and beat Jon")
// and, on Grading Night, drafts that week's newsletter in Buttondown when BUTTONDOWN_API_KEY is set.
import { getStore } from "@netlify/blobs";
import { parsePicks, buildBoard, gameKey, liveGame, gradingAt, gradingSpec } from "../lib/sheet.mjs";
import { allSubs, send, once } from "../lib/push.mjs";
import { draftWeek } from "../lib/newsletter.mjs";

const TZ = "America/New_York";
const SITE = process.env.URL || "https://thewinningshot.netlify.app";
const clock = (d) => new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const nameCase = (n) => n[0] + n.slice(1).toLowerCase();
const list = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);

async function roomPlayers() {
  const store = getStore({ name: "room", consistency: "strong" }), keys = [];
  for await (const page of store.list({ prefix: "p/", paginate: true })) page.blobs.forEach((b) => keys.push(b.key));
  const out = [];
  for (let i = 0; i < keys.length; i += 50) {
    const got = await Promise.all(keys.slice(i, i + 50).map((k) => store.get(k, { type: "json" }).catch(() => null)));
    got.forEach((p, j) => { if (p && p.nick) out.push({ pid: keys[i + j].slice(2), nick: p.nick, picks: p.picks || {} }); });
  }
  return out;
}

export default async () => {
  const now = Date.now();
  const text = await fetch(new URL("/picks.txt", SITE), { headers: { "Cache-Control": "no-cache" } }).then((r) => (r.ok ? r.text() : ""));
  if (!text) return;
  const P = parsePicks(text), wk = P.weeks[0];
  if (!wk) return;
  const live = (await getStore("scores").get("latest", { type: "json" })) || { games: [] };
  const subs = await allSubs();
  const log = [];

  // 1. Picks lock in 30 minutes.
  const slots = new Map();
  wk.games.forEach((g) => {
    const f = liveGame(g, live);
    if (!f || f.status !== "scheduled") return;
    const t = new Date(f.date).getTime();
    if (t > now + 20 * 60e3 && t <= now + 35 * 60e3) { const k = f.date; (slots.get(k) || slots.set(k, []).get(k)).push(g); }
  });
  let players = null;
  for (const [iso, games] of slots) {
    if (!(await once(`lock-${wk.key}-${iso}`))) continue;
    players = players || await roomPlayers();
    const byPid = new Map(players.map((p) => [p.pid, p]));
    const names = list(games.map((g) => `${g.away} at ${g.home}`));
    await Promise.all(subs.filter((s) => s.topics.includes("lock")).map((s) => {
      const p = s.pid && byPid.get(s.pid);
      if (p) {
        const mine = p.picks[wk.key] || {}, open = games.filter((g) => !mine[gameKey(g)]);
        if (!open.length) return null;
        return send(s, { title: "Picks lock in 30 minutes", body: `${list(open.map((g) => `${g.away} at ${g.home}`))} ${open.length === 1 ? "kicks" : "kick"} off at ${clock(iso)} ET. You haven't picked ${open.length === 1 ? "it" : "them"} yet.`, url: "/#sheet", tag: `lock-${iso}` });
      }
      return send(s, { title: "Kickoff in 30 minutes", body: `${names} at ${clock(iso)} ET. Picks lock at kickoff.`, url: "/#sheet", tag: `lock-${iso}` });
    }));
    log.push(`lock ${iso} ${games.length}`);
  }

  // 2 and 3. Grading Night.
  const t = gradingAt(wk, live, gradingSpec(text));
  const short = wk.label.split(" · ")[0];
  if (t && now >= t - 15 * 60e3 && now < t - 3 * 60e3 && await once(`grading-${wk.key}`)) {
    await Promise.all(subs.filter((s) => s.topics.includes("grading")).map((s) => send(s, { title: "Grading Night starts in 10 minutes", body: `${short} gets graded live at ${clock(t)} ET. Who beat the room?`, url: "/", tag: "grading" })));
    log.push("grading");
  }
  if (t && now >= t && now < t + 60 * 60e3) {
    if (await once(`result-${wk.key}`)) {
      players = players || await roomPlayers();
      const B = buildBoard(P, players, live, now), W = B.weeks.find((w) => w.key === wk.key);
      const byPid = new Map(players.map((p) => [p.pid, p])), net = (r) => r[0] - r[1];
      await Promise.all(subs.filter((s) => s.topics.includes("result") && s.pid && byPid.get(s.pid)).map((s) => {
        const f = W && W.fans.find((x) => x.nick === byPid.get(s.pid).nick);
        if (!f || f.w + f.l === 0) return null;
        const beat = P.people.filter((p) => net([f.w, f.l]) > net(W.hosts[p])).map(nameCase);
        const body = `You went ${f.w}–${f.l}. ` + (beat.length === P.people.length ? "You beat all three of us." : beat.length ? `You beat ${list(beat)}.` : `${list(P.people.map(nameCase))} all beat you this week.`) + (net(W.room) < net([f.w, f.l]) ? " And you beat the room." : "");
        return send(s, { title: `${short}, graded`, body, url: "/#sheet", tag: `result-${wk.key}` });
      }));
      log.push("results");
    }
    if (process.env.BUTTONDOWN_API_KEY && await once(`draft-${wk.key}`)) {
      try { players = players || await roomPlayers(); await draftWeek(P, wk, live, SITE, players); log.push("newsletter draft"); } catch (e) { log.push("draft failed: " + e.message); }
    }
  }
  if (log.length) console.log("notify:", log.join(", "));
};

export const config = { schedule: "*/5 * * * *" };
