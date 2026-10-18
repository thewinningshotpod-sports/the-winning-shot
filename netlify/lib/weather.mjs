// Kickoff weather from Open-Meteo (free, no key). Venues are looked up by city with
// Open-Meteo's geocoder and saved, so each city is geocoded once.
import { getStore } from "@netlify/blobs";

const WMO = [[0, "Clear"], [1, "Mostly clear"], [2, "Partly cloudy"], [3, "Cloudy"], [45, "Fog"], [48, "Fog"], [51, "Drizzle"], [53, "Drizzle"], [55, "Drizzle"],
  [56, "Freezing drizzle"], [57, "Freezing drizzle"], [61, "Light rain"], [63, "Rain"], [65, "Heavy rain"], [66, "Freezing rain"], [67, "Freezing rain"],
  [71, "Light snow"], [73, "Snow"], [75, "Heavy snow"], [77, "Snow"], [80, "Showers"], [81, "Showers"], [82, "Heavy showers"], [85, "Snow showers"], [86, "Snow showers"],
  [95, "Thunderstorms"], [96, "Thunderstorms"], [99, "Thunderstorms"]];
const sky = (c) => (WMO.find(([k]) => k === c) || [0, ""])[1];

async function geocode(venue) {
  const store = getStore("geo");
  const key = `${venue.city}|${venue.state}|${venue.country}`.toLowerCase().replace(/[^a-z0-9|]+/g, "-");
  const hit = await store.get(key, { type: "json" });
  if (hit) return hit;
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(venue.city)}&count=10&language=en&format=json`);
  if (!r.ok) return null;
  const res = ((await r.json()).results || []);
  const usa = /^(usa|united states)/i.test(venue.country || "");
  const cands = usa ? res.filter((x) => x.country_code === "US") : res;
  const pick = (venue.state && cands.find((x) => stateMatch(x.admin1, venue.state))) || cands[0] || res[0];
  if (!pick) return null;
  const g = { lat: pick.latitude, lon: pick.longitude, place: [pick.name, pick.admin1, pick.country_code].filter(Boolean).join(", ") };
  await store.setJSON(key, g);
  return g;
}
const STATES = { AL: "Alabama", AZ: "Arizona", CA: "California", CO: "Colorado", FL: "Florida", GA: "Georgia", IL: "Illinois", IN: "Indiana", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", MI: "Michigan", MN: "Minnesota", MO: "Missouri", NC: "North Carolina", NJ: "New Jersey", NV: "Nevada", NY: "New York", OH: "Ohio", PA: "Pennsylvania", TN: "Tennessee", TX: "Texas", WA: "Washington", WI: "Wisconsin" };
const stateMatch = (admin1, st) => { const a = String(admin1 || "").toLowerCase(); return a === String(st).toLowerCase() || a === String(STATES[String(st).toUpperCase()] || "").toLowerCase(); };

const memo = new Map();
// Weather at kickoff for one outdoor venue, or { dome: true }.
export async function kickoffWeather(venue, kickoffISO) {
  if (!venue || !venue.city) return null;
  if (venue.indoor) return { dome: true, text: "Indoors" };
  const t = new Date(kickoffISO), hoursOut = (t - Date.now()) / 3600e3;
  if (hoursOut < -4 || hoursOut > 15 * 24) return null;
  const g = await geocode(venue);
  if (!g) return null;
  const mk = `${g.lat},${g.lon}`;
  let fc = memo.get(mk);
  if (!fc || Date.now() - fc.at > 3600e3) {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=16`);
    if (!r.ok) return null;
    fc = { at: Date.now(), data: await r.json() };
    memo.set(mk, fc);
  }
  const h = fc.data.hourly || {};
  const want = t.toISOString().slice(0, 13);
  const i = (h.time || []).findIndex((x) => x.slice(0, 13) === want);
  if (i < 0) return null;
  const temp = Math.round(h.temperature_2m[i]), wind = Math.round(h.wind_speed_10m[i]), rain = h.precipitation_probability ? h.precipitation_probability[i] : null, code = h.weather_code[i];
  const bits = [`${sky(code) || "Weather"}, ${temp}°F`];
  if (wind >= 10) bits.push(`wind ${wind} mph`);
  if (rain != null && rain >= 40 && code < 51) bits.push(`${rain}% rain`);
  return { temp, wind, rain, code, sky: sky(code), text: bits.join(", "), place: g.place };
}
