// Runs every 10 minutes on Netlify's schedule so scores stay current even when nobody is on the site.
// While people are visiting, /api/scores refreshes more often on its own.
import { refresh } from "../lib/sports.mjs";

export default async () => {
  const data = await refresh();
  console.log(`Saved ${data.games.length} games. Errors: ${data.errors.length}`);
};

export const config = { schedule: "*/10 * * * *" };
