// The Winning Shot on Substack: the newest posts from the public RSS feed, for the Stories page.
//   GET /api/substack -> { url, posts: [{ title, subtitle, link, date, author }] }
const PUB = "https://thewinningshot.substack.com";

const unescape = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, " ").trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? unescape(m[1]) : ""; };

export default async () => {
  let posts = [], error = null;
  try {
    const r = await fetch(`${PUB}/feed`, { headers: { "User-Agent": "Mozilla/5.0 (TheWinningShot site)", accept: "application/rss+xml, application/xml" } });
    if (!r.ok) throw new Error(`Substack ${r.status}`);
    const xml = await r.text();
    posts = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
      title: tag(it, "title"),
      subtitle: tag(it, "description").replace(/<[^>]+>/g, "").slice(0, 240),
      link: tag(it, "link"),
      date: (() => { const d = new Date(tag(it, "pubDate")); return Number.isNaN(d.getTime()) ? "" : d.toISOString(); })(),
      author: tag(it, "dc:creator"),
    })).filter((p) => p.title && p.link.startsWith(PUB + "/p/")).slice(0, 12);
  } catch (e) { error = e.message; }
  return Response.json({ url: PUB, posts, error }, {
    headers: { "Cache-Control": "public, max-age=300", "Netlify-CDN-Cache-Control": error ? "public, s-maxage=60" : "public, s-maxage=1800, stale-while-revalidate=3600" },
  });
};

export const config = { path: "/api/substack" };
