import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { createApiHarness } from "./test/apiHarness.js";
import { PROVIDERS, METRICS } from "./services/forecastProviders.js";

let app, cookie;
const keyPath = "/api/weather/metservice/key";
const statusPath = "/api/weather/metservice/key-status";
beforeAll(async () => {
  app = await createApiHarness();
  const date = new Date().toISOString().slice(0, 10);
  const location = { lat: 51.5, lon: -.1, alt: 25 };
  const sample = { ...Object.fromEntries(Object.keys(METRICS).map(key => [key, null])), time: `${date}T22:00:00.000Z`, isDay: 0, cloudCover: 0, temperature: 0 };
  app.values.set("weather:download_status", JSON.stringify({ isDownloading: false, lastDownload: new Date().toISOString() }));
  app.values.set("weather:meteoblue_data", JSON.stringify({ metadata: { latitude: 51.5, longitude: -.1 }, data_1h: { time: [], isdaylight: [], totalcloudcover: [], precipitation_probability: [], temperature: [] } }));
  for (const provider of PROVIDERS) app.values.set(`weather:provider:${provider.id}`, JSON.stringify({ ...provider, location, status: provider.id === "gfs" ? "ok" : "not_configured", samples: provider.id === "gfs" ? [sample] : [], timeZone: "UTC", error: null }));
  await app.start();
  cookie = await app.login();
});
afterAll(async () => { await app?.close(); });

describe("real HTTP/auth and Redis-client route contracts", () => {
  it("keeps legacy and v2 summaries public while key controls remain protected", async () => {
    const legacy = await fetch(app.base + "/api/weather/summary");
    expect(legacy.status).toBe(200);
    expect(Object.keys(await legacy.json()).sort()).toEqual(["current_time", "location", "met_office_forecast", "meteoblue_forecast"]);
    const complete = await fetch(app.base + "/api/weather/summary?v=2");
    expect(complete.status).toBe(200);
    expect((await complete.json()).schemaVersion).toBe(2);
    // The existing /api/* auth mount redirects unauthenticated requests to login.
    // Do not follow that redirect and mistake the login page's 200 for access.
    const status = await fetch(app.base + statusPath, { redirect: "manual" });
    expect(status.status).toBe(302);
    expect(status.headers.get("location")).toBe("/login");
    expect((await fetch(app.base + keyPath, { method: "PUT", redirect: "manual", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "synthetic-key" }) })).status).toBe(302);
    expect(app.values.has("weather:metservice_api_key")).toBe(false);
  });

  it("saves only valid keys and returns configured/source metadata, never the key", async () => {
    const getStatus = () => fetch(app.base + statusPath, { headers: { Cookie: cookie } }).then(r => r.json());
    expect(await getStatus()).toEqual({ configured: false, source: "none" });
    const put = key => fetch(app.base + keyPath, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ key }) });
    for (const invalid of ["", "x", "a\nbcd", "x".repeat(257), 123]) expect((await put(invalid)).status).toBe(400);
    const response = await put("synthetic-valid-metservice-key");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await getStatus()).toEqual({ configured: true, source: "redis" });
    const settings = await fetch(app.base + "/api/settings", { headers: { Cookie: cookie } }).then(r => r.json());
    expect(settings.apiKeys.metservice).toEqual({ configured: true, source: "redis" });
    expect(JSON.stringify(settings)).not.toContain("synthetic-valid-metservice-key");
    expect(settings.apiKeys).toHaveProperty("meteoblue");
    expect(settings.apiKeys).toHaveProperty("telescopius");
  });

  it("keeps storage exception details out of public forecasts and key responses", async () => {
    const marker = "synthetic-internal-only-detail";
    const get = app.values.get.bind(app.values);
    const read = vi.spyOn(app.values, "get").mockImplementation(key => {
      if (["weather:provider:gfs", "weather:metservice_api_key"].includes(key)) throw new Error(marker);
      return get(key);
    });
    try {
      const response = await fetch(app.base + "/api/weather/summary?v=2");
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.code).toBe("forecast_unavailable");
      expect(JSON.stringify(body)).not.toContain(marker);
      const status = await fetch(app.base + statusPath, { headers: { Cookie: cookie } });
      expect(status.status).toBe(503);
      expect(await status.text()).not.toContain(marker);
    } finally { read.mockRestore(); }
    const set = app.values.set.bind(app.values);
    const write = vi.spyOn(app.values, "set").mockImplementation((key, value) => {
      if (key === "weather:metservice_api_key") throw new Error(marker);
      return set(key, value);
    });
    try {
      const response = await fetch(app.base + keyPath, { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ key: "synthetic-valid-key" }) });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(marker);
    } finally { write.mockRestore(); }
  });

  it("returns an explicit unavailable response when no forecast can define sessions", async () => {
    const key = "weather:provider:gfs";
    const original = app.values.get(key);
    try {
      app.values.set(key, JSON.stringify({ ...JSON.parse(original), status: "error", samples: [], error: { code: "timeout", message: "Upstream request timed out after 20 seconds" } }));
      const response = await fetch(app.base + "/api/weather/summary?v=2");
      expect(response.status).toBe(503);
      const result = await response.json();
      expect(result.code).toBe("session_boundaries_unavailable");
      expect(result.providers.find(provider => provider.id === "gfs").error.code).toBe("timeout");
      expect(result).not.toHaveProperty("nightSessions");
    } finally { app.values.set(key, original); }
    expect((await fetch(app.base + "/api/weather/summary?v=2")).status).toBe(200);
  });

  it("rejects object/array datetime queries before proxying and preserves valid scalar cache reads", async () => {
    for (const path of ["highlights", "solar-system"]) {
      for (const query of ["datetime[x]=value", "datetime=a&datetime=b", "datetime[replace]=value"]) {
        const response = await fetch(`${app.base}/api/skychart/telescopius/${path}?${query}`, { headers: { Cookie: cookie } });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "datetime must be a string" });
      }
    }
    const payload = { synthetic: true };
    app.values.set("telescopius:solar:51.5:-0.1:20260101T1200", JSON.stringify(payload));
    const response = await fetch(app.base + "/api/skychart/telescopius/solar-system?lat=51.5&lon=-0.1&datetime=2026-01-01T12:00", { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });

  it("retains JSON-only key writes and blocks cross-origin production preflight", async () => {
    await app.start({ NODE_ENV: "production" });
    const preflight = await fetch(app.base + keyPath, { method: "OPTIONS", headers: { "X-Forwarded-Proto": "https", Origin: "https://untrusted.example", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" } });
    expect(preflight.headers.has("access-control-allow-origin")).toBe(false);
    const login = await fetch(app.base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" }, body: JSON.stringify({ password: "synthetic-password" }) });
    expect(login.headers.get("set-cookie")).toMatch(/; SameSite=Lax/i);
    const session = login.headers.get("set-cookie").split(";")[0];
    const stored = app.values.get("weather:metservice_api_key");
    const response = await fetch(app.base + keyPath, { method: "PUT", headers: { "X-Forwarded-Proto": "https", Cookie: session, "Content-Type": "text/plain", Origin: "https://untrusted.example" }, body: JSON.stringify({ key: "synthetic-cross-site-value" }) });
    expect(response.status).toBe(403);
    expect(app.values.get("weather:metservice_api_key")).toBe(stored);
    const plain = await fetch(app.base + keyPath, { method: "PUT", headers: { "X-Forwarded-Proto": "https", Cookie: session, "Content-Type": "text/plain", Origin: app.base.replace("http:", "https:") }, body: JSON.stringify({ key: "synthetic-cross-site-value" }) });
    expect(plain.status).toBe(400);
    const forgedLogout = await fetch(app.base + "/api/auth/logout", { method: "POST", headers: { "X-Forwarded-Proto": "https", Cookie: session, Origin: "https://untrusted.example" } });
    expect(forgedLogout.status).toBe(403);
    expect(forgedLogout.headers.has("set-cookie")).toBe(false);
    await app.start();
  });

  it("preserves same-origin, configured-origin, development-proxy and command-line authentication", async () => {
    const logout = origin => fetch(app.base + "/api/auth/logout", { method: "POST", headers: origin ? { Origin: origin } : {} });
    expect((await logout(app.base)).status).toBe(200);
    expect((await logout("http://localhost:5173")).status).toBe(200);
    expect((await logout()).status).toBe(200);
    expect((await logout("null")).status).toBe(403);
    expect((await logout("http://evil.localhost:5173")).status).toBe(403);
    await app.start({ CORS_ORIGIN: "https://frontend.example", CRON_TRIGGER_TOKEN: "synthetic-cron-token" });
    expect((await logout("https://frontend.example")).status).toBe(200);
    // A public trigger still reaches its existing token validation.
    const trigger = await fetch(app.base + "/api/weather/refresh/trigger?key=wrong", { method: "POST", headers: { Origin: "https://untrusted.example" } });
    expect(trigger.status).toBe(401);
    expect(await trigger.json()).toEqual({ error: "Invalid trigger key" });
    await app.start({ MASTER_PASSWORD: "" });
    expect((await logout("https://untrusted.example")).status).toBe(200);
    await app.start();
  });

  it("preserves saved-key persistence across restart and environment precedence without rewriting storage", async () => {
    const saved = await fetch(app.base + keyPath, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ key: "synthetic-valid-metservice-key" }) });
    expect(saved.status).toBe(200);
    await app.stop();
    await app.stop();
    await app.start();
    cookie = await app.login();
    expect(await fetch(app.base + statusPath, { headers: { Cookie: cookie } }).then(r => r.json())).toEqual({ configured: true, source: "redis" });
    const stored = app.values.get("weather:metservice_api_key");
    await app.start({ METSERVICE_API_KEY: "synthetic-environment-key" });
    cookie = await app.login();
    expect(await fetch(app.base + statusPath, { headers: { Cookie: cookie } }).then(r => r.json())).toEqual({ configured: true, source: "env" });
    expect(app.values.get("weather:metservice_api_key")).toBe(stored);
  });

  it("keeps production HTTPS redirects and secure session cookies", async () => {
    await app.start({ NODE_ENV: "production" });
    const redirect = await fetch(app.base + "/api/health", { redirect: "manual" });
    expect(redirect.status).toBe(301);
    const login = await fetch(app.base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" }, body: JSON.stringify({ password: "synthetic-password" }) });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toMatch(/; Secure/i);
    expect((await fetch(app.base + "/api/settings", { redirect: "manual", headers: { "X-Forwarded-Proto": "https" } })).status).toBe(302);
  });
});
