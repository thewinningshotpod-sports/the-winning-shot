// Web push, sent straight from the site (no outside service). The site's VAPID key pair is made
// the first time it's needed and kept in Netlify Blobs, so there's nothing to configure.
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { createHash } from "node:crypto";

export const pushStore = () => getStore({ name: "push", consistency: "strong" });
export const subKey = (endpoint) => "s/" + createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 40);

export async function vapid() {
  const store = pushStore();
  let k = await store.get("vapid", { type: "json" });
  if (!k) { k = webpush.generateVAPIDKeys(); await store.setJSON("vapid", k); }
  return k;
}

export async function allSubs() {
  const store = pushStore(), keys = [];
  for await (const page of store.list({ prefix: "s/", paginate: true })) page.blobs.forEach((b) => keys.push(b.key));
  const out = [];
  for (let i = 0; i < keys.length; i += 50) {
    const got = await Promise.all(keys.slice(i, i + 50).map((k) => store.get(k, { type: "json" }).catch(() => null)));
    got.forEach((s, j) => { if (s && s.sub) out.push({ key: keys[i + j], ...s }); });
  }
  return out;
}

// Send one message; subscriptions the browser has dropped are removed.
export async function send(sub, msg) {
  const k = await vapid();
  webpush.setVapidDetails("https://thewinningshot.netlify.app", k.publicKey, k.privateKey);
  try {
    await webpush.sendNotification(sub.sub, JSON.stringify(msg), { TTL: 3600, urgency: "normal", topic: (msg.tag || "tws").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) });
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) await pushStore().delete(sub.key);
    return false;
  }
}

// Each alert goes out once: a marker blob per event.
export async function once(id) {
  const store = pushStore(), k = "sent/" + id.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 120);
  if (await store.get(k)) return false;
  await store.setJSON(k, { at: new Date().toISOString() });
  return true;
}
