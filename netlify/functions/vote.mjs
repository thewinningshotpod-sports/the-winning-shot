// Who Better? votes. Saved in Netlify Blobs under the "whobetter" store, one entry per matchup.
//   GET  /api/vote?ids=a__b,c__d   -> vote totals for those matchups
//   POST /api/vote {id, q, pick}   -> adds one vote, returns the new totals
// A matchup id is two player slugs in alphabetical order joined by "__".
import { getStore } from "@netlify/blobs";

const ID = /^[a-z0-9-]{1,80}__[a-z0-9-]{1,80}$/;
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  const store = getStore({ name: "whobetter", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const ids = (url.searchParams.get("ids") || "").split(",").filter((s) => ID.test(s)).slice(0, 40);
    const out = {};
    await Promise.all(ids.map(async (id) => { out[id] = (await store.get(id, { type: "json" })) || { now: {}, all: {} }; }));
    return json(out);
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Send JSON." }, 400); }
    const { id, q, pick } = body || {};
    if (!ID.test(id || "") || !["now", "all"].includes(q) || !id.split("__").includes(pick)) {
      return json({ error: "That vote doesn't match a matchup." }, 400);
    }
    const cur = (await store.get(id, { type: "json" })) || { now: {}, all: {} };
    cur[q] = cur[q] || {};
    cur[q][pick] = (cur[q][pick] || 0) + 1;
    await store.setJSON(id, cur);
    return json(cur);
  }

  return json({ error: "Use GET or POST." }, 405);
};

export const config = { path: "/api/vote" };
