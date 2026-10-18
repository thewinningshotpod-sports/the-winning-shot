// Serves the channel's latest uploads to the page at /api/videos.
// Reads YouTube's public RSS feed for The Winning Shot Pod (newest 15 videos),
// so a new upload shows on the Watch page within about 10 minutes. No API key needed.
// Chapters ("14:32 Seahawks at Broncos") are read from each description.
// With YOUTUBE_API_KEY set (YouTube Data API, free daily quota), it also reports whether a video
// is live right now or scheduled, and real view counts: 1 quota unit per refresh.
const CHANNEL_ID = "UCAl6bIUsXnVVBUrrWC841mg";
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

const unescape = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const pick = (xml, re) => {
  const m = xml.match(re);
  return m ? unescape(m[1].trim()) : "";
};

// "0:00 Intro", "14:32 - Seahawks at Broncos", "(1:02:10) Who better?" -> [{ t: seconds, label }]
function chapters(desc) {
  const out = [];
  String(desc || "").split(/\r?\n/).forEach((line) => {
    const m = line.trim().match(/^[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|]?\s*(.{2,90})$/);
    if (!m) return;
    const t = m[1].split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
    out.push({ t, label: m[2].trim() });
  });
  return out.length >= 2 ? out.slice(0, 60) : [];
}

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
        description: pick(e, /<media:description>([\s\S]*?)<\/media:description>/).slice(0, 6000),
        views: Number(pick(e, /<media:statistics views="(\d+)"/)) || null,
        short: /\/shorts\//.test(pick(e, /<link rel="alternate" href="([^"]+)"/)),
      }))
      .filter((v) => /^[\w-]{11}$/.test(v.id));
  } catch (e) {
    error = e.message;
  }
  let live = null;
  const key = process.env.YOUTUBE_API_KEY;
  if (key && videos.length) {
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,liveStreamingDetails&id=${videos.map((v) => v.id).join(",")}&key=${encodeURIComponent(key)}`);
      if (!r.ok) throw new Error(`YouTube Data API ${r.status}`);
      const byId = Object.fromEntries(((await r.json()).items || []).map((x) => [x.id, x]));
      videos.forEach((v) => {
        const x = byId[v.id];
        if (!x) return;
        v.views = Number(x.statistics && x.statistics.viewCount) || v.views;
        v.state = (x.snippet && x.snippet.liveBroadcastContent) || "none"; // live | upcoming | none
        if (x.snippet && x.snippet.description) v.description = x.snippet.description.slice(0, 6000);
        if (x.liveStreamingDetails) v.liveAt = x.liveStreamingDetails.actualStartTime || x.liveStreamingDetails.scheduledStartTime || null;
      });
      live = videos.find((v) => v.state === "live") || null;
    } catch (e) { error = error || e.message; }
  }
  videos.forEach((v) => { v.chapters = chapters(v.description); v.description = v.description.slice(0, 400); });
  return Response.json(
    { channel: CHANNEL_ID, updated: new Date().toISOString(), live: live ? live.id : null, apiKey: !!key, videos, error },
    {
      headers: {
        "Cache-Control": "public, max-age=120",
        "Netlify-CDN-Cache-Control": error
          ? "public, s-maxage=60"
          : key ? "public, s-maxage=120, stale-while-revalidate=600" : "public, s-maxage=600, stale-while-revalidate=3600",
      },
    }
  );
};

export const config = { path: "/api/videos" };
