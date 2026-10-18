// Push alerts sign-up.
//   GET  /api/push                       -> { key }  the public key the browser needs
//   POST /api/push {sub, pid?, topics?}  -> saves this browser's subscription
//   POST /api/push {remove: endpoint}    -> deletes it
import { vapid, pushStore, subKey, send } from "../lib/push.mjs";

const json = (d, status = 200) => Response.json(d, { status, headers: { "Cache-Control": "no-store" } });
const TOPICS = ["lock", "grading", "result"];

export default async (req) => {
  if (req.method === "GET") return json({ key: (await vapid()).publicKey });
  if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "Send JSON." }, 400); }
  const store = pushStore();
  if (b && b.remove) { await store.delete(subKey(b.remove)); return json({ ok: true }); }
  const sub = b && b.sub;
  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ error: "That isn't a push subscription." }, 400);
  const topics = Array.isArray(b.topics) ? b.topics.filter((t) => TOPICS.includes(t)) : TOPICS;
  const rec = { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, pid: /^[a-z0-9-]{16,64}$/i.test(b.pid || "") ? b.pid : null, topics, created: new Date().toISOString() };
  const key = subKey(sub.endpoint), isNew = !(await store.get(key));
  await store.setJSON(key, rec);
  if (isNew) await send({ key, ...rec }, { title: "Alerts are on", body: "You'll hear from us 30 minutes before kickoff, on Grading Night, and when your week is graded.", url: "/#sheet", tag: "welcome" });
  return json({ ok: true });
};

export const config = { path: "/api/push" };
