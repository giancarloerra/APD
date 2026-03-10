// APD — Astrophotography Planning Dashboard
// Copyright © 2026 Giancarlo Erra — AGPL-3.0-or-later

import express from "express";
import cors from "cors";
import helmet from "helmet";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Redis } from "@upstash/redis";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { weatherService, bindHelpers } from "./services/weatherService.js";
import { createWeatherSummary } from "./utils/weatherProcessor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file if it exists (local dev & self-hosted).
// On cloud platforms (Render, Railway, …) env vars are injected directly.
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContents = fs.readFileSync(envPath, "utf-8");
  for (const line of envContents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    // Don't override vars already set by the platform
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

// ===== UPSTASH REDIS (required) =====
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error("❌ UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in .env");
  process.exit(1);
}
const redis = new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN });

// Master password for app-wide auth
const MASTER_PASSWORD = process.env.MASTER_PASSWORD;
if (!MASTER_PASSWORD) {
  console.warn("⚠️  MASTER_PASSWORD not set — all routes are unprotected!");
}

// Session secret for signing tokens (auto-generated if not set)
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

// ===== MIDDLEWARE =====
// Trust proxy so secure cookies work behind Render's load balancer
app.set("trust proxy", 1);

// Security headers (CSP disabled — skychart loads resources from many external CDNs)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — restrict to configured origin(s) in production; open in development
const corsOrigin = process.env.CORS_ORIGIN;
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? corsOrigin
          ? corsOrigin.split(",").map((o) => o.trim())
          : false
        : true,
    credentials: true,
  })
);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// HTTPS redirect in production
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.headers["x-forwarded-proto"] !== "https") {
      return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
    }
    next();
  });
}

// Rate limit Telescopius proxy routes
const telescopiusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: { error: "Too many requests, slow down" },
});

// Rate limit weather refresh (expensive external API call)
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  message: { error: "Too many refresh requests, please wait" },
});

// Rate limit cron trigger (stricter — cron services only need a few calls per day)
const triggerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: "Too many trigger requests" },
});

// Disable caching for API routes
app.use("/api/*", (req, res, next) => {
  res.set({
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
  next();
});

// ===== AUTH HELPERS =====
function createSessionToken() {
  const payload = { ts: Date.now() };
  const data = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
  return Buffer.from(JSON.stringify({ data, hmac })).toString("base64");
}

function verifySessionToken(token) {
  try {
    const { data, hmac } = JSON.parse(Buffer.from(token, "base64").toString());
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return false;
    const payload = JSON.parse(data);
    // Check session age
    if (Date.now() - payload.ts > SESSION_MAX_AGE) return false;
    return true;
  } catch {
    return false;
  }
}

function isAuthenticated(req) {
  if (!MASTER_PASSWORD) return true; // no password set = open access
  const token = req.cookies?.session;
  return token ? verifySessionToken(token) : false;
}

// Auth middleware — protects routes that need it
function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  // For API requests, return 401 JSON
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  // For page requests, redirect to login
  return res.redirect("/login");
}

// ===== AUTH ROUTES (always public) =====
app.post("/api/auth/login", (req, res) => {
  const { password } = req.body;
  if (!MASTER_PASSWORD) {
    return res.json({ ok: true });
  }
  // Constant-time comparison — hash both values so lengths are always equal,
  // preventing timing-based password-length leakage.
  const pwHash = crypto.createHash("sha256").update(String(password)).digest();
  const masterHash = crypto.createHash("sha256").update(MASTER_PASSWORD).digest();
  if (!crypto.timingSafeEqual(pwHash, masterHash)) {
    return res.status(401).json({ error: "Invalid password" });
  }
  const token = createSessionToken();
  res.cookie("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
  });
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

app.get("/api/auth/check", (req, res) => {
  if (isAuthenticated(req)) return res.json({ authenticated: true });
  return res.status(401).json({ authenticated: false });
});

// ===== LOGIN PAGE =====
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login — Astrophotography Dashboard</title>
<link rel="stylesheet" href="/theme.css">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#0f172a,#1e293b,#0f172a);font-family:'Segoe UI',system-ui,sans-serif;color:#e2e8f0}
  .card{background:rgba(30,41,59,.85);border:1px solid rgba(148,163,184,.15);border-radius:12px;
    padding:40px;width:320px;text-align:center;backdrop-filter:blur(12px)}
  h1{font-size:1.4rem;margin:0 0 8px}
  .sub{font-size:.85rem;color:#94a3b8;margin-bottom:24px}
  input{width:100%;box-sizing:border-box;padding:10px 14px;border-radius:6px;border:1px solid #475569;
    background:#0f172a;color:#fff;font-size:.95rem;margin-bottom:16px;outline:none}
  input:focus{border-color:var(--accent)}
  button{width:100%;padding:10px;border:none;border-radius:6px;background:var(--accent);color:#0f172a;
    font-weight:bold;font-size:.95rem;cursor:pointer}
  button:hover{background:var(--accent-hover)}
  .err{color:#f87171;font-size:.82rem;margin-top:8px;min-height:1.2em}
</style></head><body>
<div class="card">
  <h1>🔭 Astrophotography Dashboard</h1>
  <p class="sub">Enter password to continue</p>
  <form id="f"><input type="password" id="pw" placeholder="Password" autofocus autocomplete="current-password">
  <button type="submit">Login</button></form>
  <div class="err" id="err"></div>
  <div style="margin-top:24px;color:#475569;font-size:0.6rem;letter-spacing:0.3px">© 2026 Giancarlo Erra</div>
</div>
<script>
document.getElementById('f').addEventListener('submit',async e=>{
  e.preventDefault();
  const pw=document.getElementById('pw').value;
  const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
  if(r.ok){
    const raw=new URLSearchParams(window.location.search).get('r')||'/';
    // Only allow relative paths to prevent open-redirect attacks
    const dest=(raw.startsWith('/')&&!raw.startsWith('//'))? raw:'/';
    window.location.href=dest;
  }else{document.getElementById('err').textContent='Invalid password';document.getElementById('pw').select();}
});
</script></body></html>`;

// Serve login page (always public)
app.get("/login", (req, res) => {
  if (isAuthenticated(req)) return res.redirect("/");
  res.type("html").send(LOGIN_HTML);
});

// Serve static files from the dist directory (if it exists)
const distPath = path.join(__dirname, "../dist");
if (fs.existsSync(distPath)) {
  // Static assets (JS/CSS/images) are public — no auth needed
  // Exclude skychart.html and settings.html so they go through auth-protected routes
  app.use((req, res, next) => {
    if (req.path === "/skychart.html" || req.path === "/settings.html") return next();
    express.static(distPath)(req, res, next);
  });
  console.log("✅ Serving static files from dist directory");
} else {
  console.log("⚠️  dist directory not found. Run 'npm run build' first.");
}

// ===== PUBLIC API: health check =====
app.get("/api/health", async (req, res) => {
  try {
    await redis.ping();
    res.json({ ok: true, db: "connected" });
  } catch (error) {
    res.status(503).json({ ok: false, db: "unavailable", error: error.message });
  }
});

// ===== PUBLIC API: weather summary (for AI) =====
app.get("/api/weather/summary", async (req, res) => {
  try {
    const meteoblueData = await weatherService.getWeatherData();
    const metOfficeData = await weatherService.getMetOfficeData();
    if (!meteoblueData && !metOfficeData) {
      return res.status(404).json({ error: "No weather data available" });
    }
    const summary = createWeatherSummary(meteoblueData, metOfficeData);
    res.json(summary);
  } catch (error) {
    console.error("Error creating weather summary:", error);
    res.status(500).json({ error: "Failed to create weather summary" });
  }
});

// ===== PUBLIC API: auth check =====
// (already defined above)

// ===== CRON TRIGGER (public — token-authenticated, not session-authenticated) =====
const REDIS_KEY_CRON_TOKEN = "app:cron_trigger_token";

async function getCronTokenData() {
  try {
    const stored = await redis.get(REDIS_KEY_CRON_TOKEN);
    if (stored) return stored;
  } catch (_) {}
  return null;
}

app.get("/api/weather/refresh/trigger", triggerLimiter, async (req, res) => {
  const key = typeof req.query.key === "string" ? req.query.key : "";
  if (!key) {
    return res.status(401).json({ error: "Missing trigger key" });
  }

  // Env var takes priority (consistent with other API keys)
  const envToken = process.env.CRON_TRIGGER_TOKEN;
  if (envToken) {
    const a = crypto.createHash("sha256").update(key).digest();
    const b = crypto.createHash("sha256").update(envToken).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "Invalid trigger key" });
    }
  } else {
    // Check Redis-stored hash
    const tokenData = await getCronTokenData();
    if (!tokenData || !tokenData.hash) {
      return res.status(401).json({ error: "No trigger key configured" });
    }
    const providedHash = crypto.createHash("sha256").update(key).digest("hex");
    if (providedHash.length !== tokenData.hash.length ||
        !crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(tokenData.hash))) {
      return res.status(401).json({ error: "Invalid trigger key" });
    }
    // Update lastUsedAt
    try {
      await redis.set(REDIS_KEY_CRON_TOKEN, { ...tokenData, lastUsedAt: new Date().toISOString() });
    } catch (_) {}
  }

  try {
    await weatherService.getWeatherData(true);
    res.json({ ok: true });
  } catch (error) {
    console.error("Cron trigger refresh error:", error);
    res.status(500).json({ error: "Refresh failed" });
  }
});

// ===== PROTECTED ROUTES — everything below requires auth =====
app.use("/api/*", requireAuth);

// Protect skychart.html page access
app.get("/skychart.html", requireAuth, (req, res, next) => {
  res.sendFile(path.join(__dirname, "../public/skychart.html"));
});

// Protect settings page access
app.get("/settings", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/settings.html"));
});

// ===== WEATHER API ROUTES (protected by middleware above) =====
app.get("/api/weather", async (req, res) => {
  try {
    const data = await weatherService.getWeatherData();
    const status = await weatherService.getDownloadStatus();
    res.json({ data, status });
  } catch (error) {
    console.error("Error getting weather data:", error);
    res.status(500).json({
      error: "Failed to get weather data",
      status: await weatherService.getDownloadStatus(),
    });
  }
});

app.post("/api/weather/refresh", refreshLimiter, async (req, res) => {
  try {
    const data = await weatherService.getWeatherData(true);
    const status = await weatherService.getDownloadStatus();
    res.json({ data, status });
  } catch (error) {
    console.error("Error refreshing weather data:", error);
    res.status(500).json({
      error: "Failed to refresh weather data",
      status: await weatherService.getDownloadStatus(),
    });
  }
});

app.get("/api/weather/status", async (req, res) => {
  try {
    const status = await weatherService.getDownloadStatus();
    res.json(status);
  } catch (error) {
    console.error("Error getting download status:", error);
    res.status(500).json({ error: "Failed to get download status" });
  }
});

app.get("/api/weather/metoffice", async (req, res) => {
  try {
    const data = await weatherService.getMetOfficeData();
    res.json(data);
  } catch (error) {
    console.error("Error getting Met Office data:", error);
    res.status(500).json({ error: "Failed to get Met Office data" });
  }
});

// ===== METEOBLUE API KEY MANAGEMENT =====
const REDIS_KEY_METEOBLUE_KEY = "weather:meteoblue_api_key";

async function getMeteoblueKey() {
  if (process.env.METEOBLUE_API_KEY) return process.env.METEOBLUE_API_KEY;
  try {
    const stored = await redis.get(REDIS_KEY_METEOBLUE_KEY);
    if (stored) return stored;
  } catch (_) {}
  return null;
}

app.get("/api/weather/meteoblue/key-status", async (req, res) => {
  try {
    const key = await getMeteoblueKey();
    res.json({ configured: !!key, source: process.env.METEOBLUE_API_KEY ? "env" : (key ? "redis" : "none") });
  } catch (error) {
    res.json({ configured: false, source: "none" });
  }
});

app.put("/api/weather/meteoblue/key", async (req, res) => {
  try {
    const { key } = req.body;
    if (!key || typeof key !== "string") {
      return res.status(400).json({ error: "Invalid API key" });
    }
    const trimmed = key.trim();
    if (trimmed.length < 5 || trimmed.length > 256 || !/^[\x20-\x7E]+$/.test(trimmed)) {
      return res.status(400).json({ error: "Invalid API key format" });
    }
    await redis.set(REDIS_KEY_METEOBLUE_KEY, trimmed);
    res.json({ ok: true });
  } catch (error) {
    console.error("Error saving Meteoblue key:", error);
    res.status(500).json({ error: "Failed to save API key" });
  }
});

// ===== SHARED OBSERVER LOCATION =====
const REDIS_KEY_LOCATION = "app:observer_location";
const DEFAULT_LAT = parseFloat(process.env.OBSERVER_LAT || "52.6278");
const DEFAULT_LON = parseFloat(process.env.OBSERVER_LON || "-1.2983");
const DEFAULT_ALT = parseFloat(process.env.OBSERVER_ALT || "25");

async function getObserverLocation() {
  try {
    const stored = await redis.get(REDIS_KEY_LOCATION);
    if (stored && typeof stored === "object" && stored.lat != null) {
      return { lat: stored.lat, lon: stored.lon, alt: stored.alt ?? DEFAULT_ALT };
    }
  } catch (_) {}
  return { lat: DEFAULT_LAT, lon: DEFAULT_LON, alt: DEFAULT_ALT };
}

app.get("/api/location", async (req, res) => {
  try {
    const loc = await getObserverLocation();
    res.json(loc);
  } catch (error) {
    console.error("Error getting location:", error);
    res.status(500).json({ error: "Failed to get location" });
  }
});

app.put("/api/location", async (req, res) => {
  try {
    const { lat, lon, alt } = req.body;
    if (typeof lat !== "number" || typeof lon !== "number" || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: "Invalid coordinates" });
    }
    // Preserve existing altitude if not provided
    let altitude;
    if (typeof alt === "number" && alt >= 0 && alt <= 9000) {
      altitude = alt;
    } else {
      const current = await getObserverLocation();
      altitude = current.alt;
    }
    await redis.set(REDIS_KEY_LOCATION, { lat, lon, alt: altitude });
    res.json({ ok: true, lat, lon, alt: altitude });
  } catch (error) {
    console.error("Error saving location:", error);
    res.status(500).json({ error: "Failed to save location" });
  }
});

// Export helpers for weatherService to use
export { getMeteoblueKey, getObserverLocation, redis };

// Wire helpers into weatherService (avoids circular import)
bindHelpers(getMeteoblueKey, getObserverLocation, redis);

// ===== TELESCOPIUS API PROXY =====
const TELESCOPIUS_BASE = "https://api.telescopius.com/v2.0";
const REDIS_KEY_TELESCOPIUS_KEY = "skychart:telescopius_api_key";

async function getTelescopiusKey() {
  if (process.env.TELESCOPIUS_API_KEY) return process.env.TELESCOPIUS_API_KEY;
  try {
    const stored = await redis.get(REDIS_KEY_TELESCOPIUS_KEY);
    if (stored) return stored;
  } catch (_) {}
  return null;
}

// ===== AGGREGATE SETTINGS API =====
app.get("/api/settings", async (req, res) => {
  try {
    const [loc, meteoblueKey, telescopiusKey, downloadStatus, cronTokenData] = await Promise.all([
      getObserverLocation(),
      getMeteoblueKey(),
      getTelescopiusKey(),
      weatherService.getDownloadStatus(),
      getCronTokenData(),
    ]);
    const cronSource = process.env.CRON_TRIGGER_TOKEN ? "env" : (cronTokenData ? "redis" : "none");
    res.json({
      location: loc,
      apiKeys: {
        meteoblue: { configured: !!meteoblueKey, source: process.env.METEOBLUE_API_KEY ? "env" : (meteoblueKey ? "redis" : "none") },
        telescopius: { configured: !!telescopiusKey, source: process.env.TELESCOPIUS_API_KEY ? "env" : (telescopiusKey ? "redis" : "none") },
      },
      auth: { enabled: !!MASTER_PASSWORD },
      download: downloadStatus,
      cronTrigger: {
        configured: !!process.env.CRON_TRIGGER_TOKEN || !!cronTokenData,
        source: cronSource,
        createdAt: cronTokenData?.createdAt || null,
        lastUsedAt: cronTokenData?.lastUsedAt || null,
      },
    });
  } catch (error) {
    console.error("Error getting settings:", error);
    res.status(500).json({ error: "Failed to get settings" });
  }
});

// ===== CRON TOKEN MANAGEMENT =====
app.get("/api/settings/cron-token", async (req, res) => {
  try {
    if (process.env.CRON_TRIGGER_TOKEN) {
      return res.json({ configured: true, source: "env", createdAt: null, lastUsedAt: null });
    }
    const data = await getCronTokenData();
    if (data) {
      return res.json({ configured: true, source: "redis", createdAt: data.createdAt, lastUsedAt: data.lastUsedAt });
    }
    res.json({ configured: false, source: "none" });
  } catch (error) {
    res.json({ configured: false, source: "none" });
  }
});

app.post("/api/settings/cron-token", async (req, res) => {
  try {
    if (process.env.CRON_TRIGGER_TOKEN) {
      return res.status(400).json({ error: "Token is managed via CRON_TRIGGER_TOKEN environment variable — cannot rotate from Settings" });
    }
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await redis.set(REDIS_KEY_CRON_TOKEN, {
      hash,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    });
    // Return raw token ONCE — it cannot be retrieved again
    res.json({ ok: true, token: rawToken });
  } catch (error) {
    console.error("Error generating cron token:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

app.delete("/api/settings/cron-token", async (req, res) => {
  try {
    if (process.env.CRON_TRIGGER_TOKEN) {
      return res.status(400).json({ error: "Token is managed via CRON_TRIGGER_TOKEN environment variable — cannot revoke from Settings" });
    }
    await redis.del(REDIS_KEY_CRON_TOKEN);
    res.json({ ok: true });
  } catch (error) {
    console.error("Error revoking cron token:", error);
    res.status(500).json({ error: "Failed to revoke token" });
  }
});

async function telescopiusFetch(endpoint, params) {
  const apiKey = await getTelescopiusKey();
  if (!apiKey) {
    throw new Error("Telescopius API key not configured. Set it in Settings or via TELESCOPIUS_API_KEY env var.");
  }
  const url = new URL(TELESCOPIUS_BASE + endpoint);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    });
  }
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Key ${apiKey}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Telescopius ${resp.status}: ${body}`);
  }
  return resp.json();
}

app.get("/api/skychart/telescopius/key-status", async (req, res) => {
  try {
    const key = await getTelescopiusKey();
    res.json({ configured: !!key, source: process.env.TELESCOPIUS_API_KEY ? "env" : (key ? "redis" : "none") });
  } catch (error) {
    res.json({ configured: false, source: "none" });
  }
});

app.put("/api/skychart/telescopius/key", async (req, res) => {
  try {
    const { key } = req.body;
    if (!key || typeof key !== "string") {
      return res.status(400).json({ error: "Invalid API key" });
    }
    const trimmed = key.trim();
    if (trimmed.length < 10 || trimmed.length > 256 || !/^[\x20-\x7E]+$/.test(trimmed)) {
      return res.status(400).json({ error: "Invalid API key format" });
    }
    await redis.set(REDIS_KEY_TELESCOPIUS_KEY, trimmed);
    res.json({ ok: true });
  } catch (error) {
    console.error("Error saving Telescopius key:", error);
    res.status(500).json({ error: "Failed to save API key" });
  }
});

async function telescopiusCached(cacheKey, ttlSec, endpoint, params, forceRefresh = false) {
  if (!forceRefresh) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return cached;
    } catch (_) { /* cache miss */ }
  }
  const data = await telescopiusFetch(endpoint, params);
  try { await redis.set(cacheKey, data, { ex: ttlSec }); } catch (_) { /* ignore cache write errors */ }
  return data;
}

app.get("/api/skychart/telescopius/highlights", telescopiusLimiter, async (req, res) => {
  try {
    const { lat, lon, timezone, datetime, types, min_alt, min_alt_minutes, moon_dist_min, moon_dist_max, results_per_page, page, refresh } = req.query;
    const forceRefresh = refresh === 'true';
    const dateKey = (datetime || "now").replace(/[^a-zA-Z0-9]/g, "");
    const pg = page || 1;
    const rpp = results_per_page || 20;
    const cacheKey = `telescopius:highlights:${lat}:${lon}:${dateKey}:p${pg}:n${rpp}`;
    const data = await telescopiusCached(cacheKey, 21600, "/targets/highlights", {
      lat, lon, timezone, datetime, types, min_alt, min_alt_minutes, moon_dist_min, moon_dist_max, results_per_page: rpp, page: pg,
    }, forceRefresh);
    res.json(data);
  } catch (error) {
    console.error("Telescopius highlights error:", error.message);
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/skychart/telescopius/search", telescopiusLimiter, async (req, res) => {
  try {
    const data = await telescopiusFetch("/targets/search", req.query);
    res.json(data);
  } catch (error) {
    console.error("Telescopius search error:", error.message);
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/skychart/telescopius/solar-system", telescopiusLimiter, async (req, res) => {
  try {
    const { lat, lon, timezone, datetime } = req.query;
    const dateKey = (datetime || "now").replace(/[^a-zA-Z0-9]/g, "");
    const cacheKey = `telescopius:solar:${lat}:${lon}:${dateKey}`;
    const data = await telescopiusCached(cacheKey, 43200, "/solar-system/times", {
      lat, lon, timezone, datetime,
    });
    res.json(data);
  } catch (error) {
    console.error("Telescopius solar-system error:", error.message);
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/skychart/telescopius/lists", telescopiusLimiter, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const cacheKey = "telescopius:lists:index";
    const data = await telescopiusCached(cacheKey, 86400, "/targets/lists", {}, forceRefresh);
    res.json(data);
  } catch (error) {
    console.error("Telescopius lists error:", error.message);
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/skychart/telescopius/lists/:id", telescopiusLimiter, async (req, res) => {
  try {
    const { lat, lon, timezone, datetime, refresh } = req.query;
    const forceRefresh = refresh === 'true';
    const listId = req.params.id;
    const cacheKey = `telescopius:list:${listId}`;
    const data = await telescopiusCached(cacheKey, 43200, `/targets/lists/${encodeURIComponent(listId)}`, {
      lat, lon, timezone, datetime,
    }, forceRefresh);
    res.json(data);
  } catch (error) {
    console.error("Telescopius list error:", error.message);
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/skychart/telescopius/pictures", telescopiusLimiter, async (req, res) => {
  try {
    const data = await telescopiusFetch("/pictures/search", req.query);
    res.json(data);
  } catch (error) {
    console.error("Telescopius pictures error:", error.message);
    res.status(502).json({ error: error.message });
  }
});

// ===== SKYCHART SETTINGS (Upstash Redis) =====
const REDIS_KEY_FOVS = "skychart:fovs";
const REDIS_KEY_FAVORITES = "skychart:favorites";

app.get("/api/skychart/fovs", async (req, res) => {
  try {
    const data = await redis.get(REDIS_KEY_FOVS);
    res.json(data || []);
  } catch (error) {
    console.error("Error getting FOVs:", error);
    res.status(500).json({ error: "Failed to get FOVs" });
  }
});

app.put("/api/skychart/fovs", async (req, res) => {
  try {
    const fovs = req.body;
    if (!Array.isArray(fovs)) {
      return res.status(400).json({ error: "Body must be an array" });
    }
    if (fovs.length > 50) {
      return res.status(400).json({ error: "Too many FOVs (max 50)" });
    }
    await redis.set(REDIS_KEY_FOVS, fovs);
    res.json({ ok: true });
  } catch (error) {
    console.error("Error saving FOVs:", error);
    res.status(500).json({ error: "Failed to save FOVs" });
  }
});

app.get("/api/skychart/favorites", async (req, res) => {
  try {
    const data = await redis.get(REDIS_KEY_FAVORITES);
    res.json(data || []);
  } catch (error) {
    console.error("Error getting favorites:", error);
    res.status(500).json({ error: "Failed to get favorites" });
  }
});

app.put("/api/skychart/favorites", async (req, res) => {
  try {
    const favorites = req.body;
    if (!Array.isArray(favorites)) {
      return res.status(400).json({ error: "Body must be an array" });
    }
    if (favorites.length > 200) {
      return res.status(400).json({ error: "Too many favorites (max 200)" });
    }
    await redis.set(REDIS_KEY_FAVORITES, favorites);
    res.json({ ok: true });
  } catch (error) {
    console.error("Error saving favorites:", error);
    res.status(500).json({ error: "Failed to save favorites" });
  }
});

// ===== CATCH-ALL: Serve React app =====
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }
  // Landing page is public
  if (req.path === "/") {
    return res.sendFile(path.join(__dirname, "../dist/index.html"));
  }
  // All other pages require auth
  if (!isAuthenticated(req)) {
    return res.redirect(`/login?r=${encodeURIComponent(req.originalUrl)}`);
  }
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Frontend available at http://localhost:${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api/weather`);
  if (MASTER_PASSWORD) {
    console.log("🔒 Authentication enabled");
  } else {
    console.log("⚠️  No MASTER_PASSWORD set — running without auth");
  }
});
