// Newsletter sign-up. With BUTTONDOWN_API_KEY set, the address goes straight into Buttondown.
// Without it, this answers 501 and the page saves the address with Netlify Forms instead.
//   POST /api/subscribe {email}
const json = (d, status = 200) => Response.json(d, { status, headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const key = process.env.BUTTONDOWN_API_KEY;
  if (!key) return json({ error: "Newsletter service not connected." }, 501);
  let b;
  try { b = await req.json(); } catch { return json({ error: "Send JSON." }, 400); }
  const email = String((b && b.email) || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return json({ error: "That email address doesn't look right." }, 400);
  const r = await fetch("https://api.buttondown.com/v1/subscribers", {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json", "X-Buttondown-Collision-Behavior": "add" },
    body: JSON.stringify({ email_address: email, referrer_url: "https://thewinningshot.netlify.app/", tags: ["website"] }),
  });
  if (r.ok) return json({ ok: true });
  const t = await r.text();
  if (/already|exists|collision/i.test(t)) return json({ ok: true, already: true });
  console.warn("Buttondown subscribe failed", r.status, t.slice(0, 200));
  return json({ error: "That didn't go through. Try again in a minute." }, 502);
};

export const config = { path: "/api/subscribe" };
