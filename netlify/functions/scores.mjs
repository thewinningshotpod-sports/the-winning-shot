// Serves live scores to the page at /api/scores.
// If the saved scores are older than allowed (30 seconds during live games,
// 5 minutes otherwise), it pulls fresh ones from ESPN before answering.
import { getStore } from "@netlify/blobs";
import { refresh, maxAgeMs } from "../lib/sports.mjs";

export default async () => {
  let data = await getStore("scores").get("latest", { type: "json" });
  const age = data && data.updated ? Date.now() - new Date(data.updated).getTime() : Infinity;
  if (age > maxAgeMs(data)) {
    try {
      data = await refresh();
    } catch (e) {
      if (!data) return Response.json({ updated: null, games: [], errors: [e.message] });
    }
  }
  return Response.json(data, {
    headers: {
      "Cache-Control": "public, max-age=15",
      "Netlify-CDN-Cache-Control": "public, s-maxage=20, stale-while-revalidate=40",
    },
  });
};

export const config = { path: "/api/scores" };
