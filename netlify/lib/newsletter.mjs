// The weekly newsletter, drafted in Buttondown on Grading Night for the hosts to review and send.
// Only facts from the graded sheet go in; nothing is sent automatically.
import { getStore } from "@netlify/blobs";
import { resultOf, gameKey, liveGame, buildBoard } from "./sheet.mjs";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen"];
const word = (n) => WORDS[n] ?? String(n);
const nameCase = (n) => n[0] + n.slice(1).toLowerCase();
const list = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);

export async function draftWeek(P, wk, live, site, players = null) {
  const people = P.people, rec = Object.fromEntries(people.map((p) => [p, [0, 0]]));
  const season = Object.fromEntries(people.map((p) => [p, [...(P.start[p] || [0, 0])]]));
  P.weeks.forEach((w) => w.games.forEach((g) => { const win = resultOf(g, live); if (!win || win === "TIE") return;
    people.forEach((p) => { const pk = g.picks[p]; if (!pk) return; season[p][pk === win ? 0 : 1]++; if (w === wk) rec[p][pk === win ? 0 : 1]++; }); }));
  let lines = {};
  try { lines = ((await getStore("odds").get("lines", { type: "json" })) || {}).lines || {}; } catch { /* no saved lines */ }
  let vegas = [0, 0];
  const rows = wk.games.map((g) => {
    const win = resultOf(g, live), f = liveGame(g, live);
    const score = g.final ? `${g.final[0]}–${g.final[1]}` : f && f.status === "final" ? `${f.away.score}–${f.home.score}` : win ? "Final" : "—";
    const mark = (pk) => (!pk ? "—" : !win ? pk : win === "TIE" ? `${pk} (tie)` : pk === win ? `${pk} ✓` : `~~${pk}~~`);
    const v = lines[gameKey(g)];
    if (v && win && win !== "TIE") vegas[v.fav === win ? 0 : 1]++;
    return `| ${g.away} at ${g.home} | ${score} | ${people.map((p) => mark(g.picks[p])).join(" | ")} | ${v ? mark(v.fav) : "—"} |`;
  });
  const net = (r) => r[0] - r[1], best = Math.max(...people.map((p) => net(rec[p]))), leaders = people.filter((p) => net(rec[p]) === best);
  const r = rec[leaders[0]];
  const headline = leaders.length === 1 ? `${nameCase(leaders[0])} went ${word(r[0])} and ${word(r[1])}` : `${list(leaders.map(nameCase))} tied at ${word(r[0])} and ${word(r[1])}`;
  const rest = people.filter((p) => !leaders.includes(p)).map((p) => `${nameCase(p)} went ${word(rec[p][0])} and ${word(rec[p][1])}.`).join(" ");
  const vegasLine = vegas[0] + vegas[1] ? ` Vegas went ${vegas[0]}–${vegas[1]}.` : "";

  let roomLine = "";
  try {
    if (players) {
      const W = buildBoard(P, players, live).weeks.find((w) => w.key === wk.key);
      if (W && W.pickers) roomLine = `\n\n**Beat the Room:** ${W.pickers} ${W.pickers === 1 ? "person" : "people"} picked against us. The room went ${W.room[0]}–${W.room[1]}.`;
    }
  } catch { /* leave it out */ }

  const hasV = wk.games.some((g) => lines[gameKey(g)]);
  const table = [
    `| Game | Final | ${people.join(" | ")}${hasV ? " | Vegas" : ""} |`,
    `| --- | --- | ${people.map(() => "---").join(" | ")}${hasV ? " | ---" : ""} |`,
    ...rows.map((r) => (hasV ? r : r.replace(/ \| [^|]*\|$/, " |"))),
  ];
  const body = [
    `**${headline}.** ${rest}${vegasLine}`,
    ...(roomLine ? [roomLine.trim()] : []),
    table.join("\n"),
    `**Season:** ${people.map((p) => `${nameCase(p)} ${season[p][0]}–${season[p][1]}`).join(" · ")}`,
    `[Watch the grading and make next week's picks](${site}/#sheet)`,
    "Every sheet graded Tuesday.",
  ].join("\n\n");

  const res = await fetch("https://api.buttondown.com/v1/emails", {
    method: "POST",
    headers: { Authorization: `Token ${process.env.BUTTONDOWN_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ subject: `The Sheet, graded: ${wk.label}`, body, status: "draft" }),
  });
  if (!res.ok) throw new Error(`Buttondown ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
