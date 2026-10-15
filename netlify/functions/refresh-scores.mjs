// Runs every hour on Netlify's schedule and saves fresh scores.
import { refresh } from "../lib/sports.mjs";

export default async () => {
  const data = await refresh();
  console.log(`Saved ${data.games.length} games. Errors: ${data.errors.length}`);
};

export const config = { schedule: "@hourly" };
