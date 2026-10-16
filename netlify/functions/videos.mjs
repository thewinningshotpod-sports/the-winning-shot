// Serves the channel's latest uploads to the page at /api/videos.
// Reads YouTube's public RSS feed for The Winning Shot Pod (newest 15 videos),
// so a new upload shows on the Watch page within about 10 minutes. No API key needed.
const CHANNEL_ID = "UCAl6bIUsXnVVBUrrWC841mg";
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

const unescape = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const pick = (xml, re) => {
  const m = xml.match(re);
  return m ? unescape(m[1].trim()) : "";
};

export default async () => {
  let videos = [];
  let error = null;
  try {
    const r = await fetch(FEED, { headers: { "User-Agent": "Mozilla/5.0 (TheWinningShot site)" } });
    if (!r.ok) throw new Error(`YouTube feed ${r.status}`);
    const xml = await r.text();
    videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
      .map(([, e]) => ({
        id: pick(e, /<yt:videoId>([^<]+)<\/yt:videoId>/),
        title: pick(e, /<title>([^<]*)<\/title>/),
        published: pick(e, /<published>([^<]+)<\/published>/),
        description: pick(e, /<media:description>([\s\S]*?)<\/media:description>/).slice(0, 400),
        views: Number(pick(e, /<media:statistics views="(\d+)"/)) || null,
        short: /\/shorts\//.test(pick(e, /<link rel="alternate" href="([^"]+)"/)),
      }))
      .filter((v) => /^[\w-]{11}$/.test(v.id));
  } catch (e) {
    error = e.message;
  }
  return Response.json(
    { channel: CHANNEL_ID, updated: new Date().toISOString(), videos, error },
    {
      headers: {
        "Cache-Control": "public, max-age=120",
        "Netlify-CDN-Cache-Control": error
          ? "public, s-maxage=60"
          : "public, s-maxage=600, stale-while-revalidate=3600",
      },
    }
  );
};

export const config = { path: "/api/videos" };
