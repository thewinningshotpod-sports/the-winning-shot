// NFL headlines from ESPN's news feed (unofficial, no key), linked back to ESPN.
//   GET /api/news -> { items: [{ headline, description, published, link }] }
export default async () => {
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=12", { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    const items = ((await r.json()).articles || []).map((a) => ({
      headline: a.headline || "",
      description: a.description || "",
      published: a.published || "",
      link: (a.links && a.links.web && a.links.web.href) || "",
    })).filter((a) => a.headline && /^https:\/\/(www\.)?espn\.com\//.test(a.link)).slice(0, 10);
    return Response.json({ items }, { headers: { "Cache-Control": "public, max-age=300", "Netlify-CDN-Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800" } });
  } catch (e) {
    return Response.json({ items: [], error: e.message }, { status: 200, headers: { "Cache-Control": "public, max-age=60" } });
  }
};

export const config = { path: "/api/news" };
