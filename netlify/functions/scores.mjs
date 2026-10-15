// Serves the saved scores to the page at /api/scores.
// If nothing has been saved yet (the first visit after deploying), it runs one refresh.
import { getStore } from "@netlify/blobs";
import { refresh } from "../lib/sports.mjs";

export default async () => {
  let data = await getStore("scores").get("latest", { type: "json" });
  if (!data) {
    try {
      data = await refresh();
    } catch (e) {
      return Response.json({ updated: null, games: [], errors: [e.message] });
    }
  }
  return Response.json(data, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Netlify-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
};

export const config = { path: "/api/scores" };
