<p align="center">
  <img src="public/logo.png" alt="APD logo" width="250" />
</p>

# 🌟 APD — Astrophotography Planning Dashboard

[![CI](https://github.com/giancarloerra/apd/actions/workflows/ci.yml/badge.svg)](https://github.com/giancarloerra/apd/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Node ≥ 18](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](package.json)

After two decades of astrophotography, and using pretty much every weather and sky chart tool out there, I grew frustrated as the tools were either too complex or simplistic.

So I made APD, Astrophotography Planning Dashboard, a unified web application for astrophotography planning. Combines weather forecasts from multiple sources (Meteoblue and Met Office via Open-Meteo) with an interactive visual sky chart (Aladin Lite + Telescopius) for framing and planning, and an endpoint dedicated to LLM-friendly weather summaries for AI integrations.

Two years ago I started building this for myself, and it evolved into my one-stop-shop for all my planning needs, from night & day (deep sky and solar) weather forecasts to a sky chart highly focused on visual framing and planning.

All packed into a universal web based app, easy to access from any device, with centralised data.

I've decided to open source it as I think it could be useful to other astrophotographers, and maybe build it into something even better. It will always be "An Opinionated Dashboard for Planning Astrophotography" — my personal vision of the perfect tool, but I'm excited to open it to contributions and suggestions from the community!

---

> **🌟 Like what you see?** This app is all about chasing stars — so why not give it one?
> A [GitHub star](https://github.com/giancarloerra/apd/stargazers) helps others discover APD and keeps the motivation going. Cheers! ⭐

---

## Table of Contents

- [✨ Features](#-features)
- [📸 Screenshots](#-screenshots)
- [🌍 Self-hosting overview](#-self-hosting-overview)
- [🔑 Required services and API keys](#-required-services-and-api-keys)
- [🌐 Quick Deployment (on Render.com)](#-quick-deployment-on-rendercom)
- [🚀 Deployment Guide](#-deployment-guide)
- [⏰ Automated Weather Refresh](#-automated-weather-refresh)
- [🆘 Support / hosting help](#-support--hosting-help)
- [🏗️ Architecture](#️-architecture)
- [🔐 Authentication](#-authentication)
- [⚙️ Environment Variables](#️-environment-variables)
- [🚀 Local Development](#-local-development)
- [🌤️ Weather Data Sources](#️-weather-data-sources)
- [🔭 Shared Observer Location](#-shared-observer-location)
- [📊 API Endpoints](#-api-endpoints)
- [📁 File Structure](#-file-structure)
- [🤝 Contributing](#-contributing)
- [📝 License](#-license)

---

## ✨ Features

### 🌙 Weather Dashboard

- **Dual-source forecasts** — Meteoblue (primary) + Met Office via Open-Meteo, shown side-by-side for cross-validation
- **Night-only filtering** — displays only astronomically relevant hours (4 h before night → 10 AM after)
- **Astrophotography score** — 0–100 composite score per night per source, weighted from cloud cover (80%) and precipitation (20%); labels: Excellent / Very Good / Good / Fair / Poor / Very Poor
- **7-day expandable forecast** — per-day rows with hourly cards showing cloud cover, temperature, precipitation, wind, humidity
- **Cloud cover sparkline** — at-a-glance bar chart of the night's cloud variation per row
- **Weekly cloud cover heatmap** — colour-coded grid of every night hour across the forecast week, with per-day score row
- **Best night banner** — highlights the highest-scoring night at a glance
- **Moonlight** — per-night average luminance (lux) and display percentage, colour-coded by impact
- **Sky brightness & wind** — shown inline per night row
- **Solar astrophotography section** — daytime cloud forecasts for H-alpha / solar imaging, with live SDO/HMI solar imagery and sunspot region images
- **Weekly solar heatmap** — same heatmap layout applied to daytime hours
- **Auto / manual weather refresh** — data downloads automatically on demand if stale; optional cron job pre-fetches twice daily; manual refresh also available from the header
- **Download status indicator** — shows last download time or in-progress state
- **LLM-friendly summary endpoint** — returns structured JSON optimised for AI/LLM consumption; always public (no auth), perfect for daily automation workflows — e.g. a scheduled job that reads the forecast and emails you if tonight or tomorrow night look promising

### 🔭 Sky Dashboard

- **Interactive sky map** — Aladin Lite v3 with 17+ selectable surveys across **Optical** (DSS2, PanSTARRS, SDSS9, Mellinger, DECaPS, DESI Legacy), **H-Alpha** (VTSS, Fink, SHASSA), **Infrared** (2MASS, AllWISE, AKARI), **UV / X-Ray / Gamma** (GALEX UV, XMM, Fermi, ROSAT), and **Radio** (NVSS, GLEAM)
- **Two modes** — *Framing* (camera overlay tools) and *Sky Chart* (pure sky exploration)
- **Camera FOV overlay** — define sensor FOVs by width × height (degrees), saved to Redis; lock to any target
- **Mosaic planner** — overlay a configurable N × M tile grid with adjustable overlap percentage
- **Camera angle offset** — rotation slider for precise framing alignment
- **Equatorial & Alt-Az mount support** — FOV box aligned to RA/Dec or horizon depending on mount type
- **Favorite targets** — save and recall objects, synced to Redis; import directly from Telescopius lists
- **Target search** — jump to any object by name (e.g. M 42, IC 434)
- **Time travel** — step the sky forward/backward by hours, days, or months; reset to now
- **Celestial overlays** — constellation lines, names, star dots, star names, Moon (with phase info), planets
- **Red night mode** — full-screen red overlay for preserving dark adaptation
- **Horizon line** — with optional ground darkening and configurable opacity
- **Alt-Az and equatorial grids** — toggleable with shared opacity slider
- **Deep Sky Objects** — Messier, NGC, IC, LDN/B catalogs; filterable by type (galaxies, nebulae, dark nebulae, globular + open clusters, planetary nebulae); magnitude limit slider
- **Star density & opacity** — magnitude-limit and name-density sliders, plus separate constellation and star opacity controls
- **Discover panel (Telescopius)** — tonight's DSO highlights (filterable by type), target search with type/sort filters, personal Telescopius observing lists, solar system rise/set/transit times
- **Live RA / Dec display** — equatorial coordinates at map centre, updated in real time

---

## 📸 Screenshots

<table>
  <tr>
    <td align="center"><img src="screenshots/screenshot_home.png" alt="Home / Landing Page" /><br/><sub>Home / Landing Page</sub></td>
    <td align="center"><img src="screenshots/screenshot_weather1.png" alt="Weather Dashboard" /><br/><sub>Weather Dashboard</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="screenshots/screenshot_weather2.png" alt="Weekly Heatmap" /><br/><sub>Weekly Heatmap</sub></td>
    <td align="center"><img src="screenshots/screenshot_weather3.png" alt="Solar Forecast" /><br/><sub>Solar Forecast</sub></td>
  </tr>
  <tr>
   <td align="center"><img src="screenshots/screenshot_sky1.png" alt="Sky Dashboard" /><br/><sub>Sky Dashboard</sub></td>
   <td align="center"><img src="screenshots/screenshot_sky2.png" alt="Sky Dashboard" /><br/><sub>Sky Dashboard</sub></td>
  </tr>
  <tr>
   <td align="center"><img src="screenshots/screenshot_sky3.png" alt="Sky Dashboard" /><br/><sub>Sky Dashboard</sub></td>
   <td align="center"><img src="screenshots/screenshot_sky4.png" alt="Sky Dashboard" /><br/><sub>Sky Dashboard</sub></td>
  </tr>
  <tr>
   <td align="center"><img src="screenshots/screenshot_sky5.png" alt="Sky Dashboard" /><br/><sub>Sky Dashboard</sub></td>
   <td align="center"><img src="screenshots/screenshot_sky6.png" alt="Sky Dashboard" /><br/><sub>Sky Dashboard</sub></td>
  </tr>
</table>

---

## 🌍 Self-hosting overview

APD is a **self-hosted** app (you can run it locally or privately host it for yourself for remote access). Instead of signing up on a hosted service, you spin up your own private copy of the app — on a free or cheap cloud platform — and get your own URL to access it.

You don't need to own a server or know how to manage infrastructure. Platforms like [Render](https://render.com) make it as simple as linking your GitHub account (another simple and free service), setting a few variables, set the password to protect it (so only you can access it), and clicking Deploy. Your data stays private, you control updates, and there are no subscription fees for the app itself.

### What you'll need

| Service | What it's for | Cost |
|---------|---------------|------|
| **GitHub** | Hosts your copy of the code; cloud platforms deploy from it | Free |
| **Render** (or similar) | Runs the APD server in the cloud | Free tier available |
| **Upstash Redis** | Stores your settings: location, camera profiles, favourites, API keys | Free tier available |
| **Meteoblue API** | Weather forecast data (cloud cover, temperature, wind, etc.) | Free 1-year trial for personal use |
| **Telescopius API** | Sky Dashboard Discover panel — DSO highlights, target search, observing lists | Patron-only; optional |
| **cron-job.org** | Triggers weather downloads twice daily (optional but recommended) | Free |

The next section walks through each service and how to get started.

---

## 🔑 Required services and API keys

Before you deploy, create accounts at the services below and gather the credentials you'll need.

### Upstash Redis — free, required

APD stores your observer location, camera FOVs, favourite targets, and runtime-configured API keys in a Redis database. Upstash provides a serverless Redis with a permanently free tier — no credit card required.

1. Sign up at [upstash.com](https://upstash.com)
2. Click **Create Database** → choose **Redis** → pick any region close to you
3. On the database detail page, copy:
   - **REST URL** → this becomes `UPSTASH_REDIS_REST_URL`
   - **REST Token** → this becomes `UPSTASH_REDIS_REST_TOKEN`

Free tier: 256 MB storage, 500,000 commands/month — well within personal use.

### Meteoblue API — free 1-year trial, then paid (required for weather)

Meteoblue provides the primary weather forecast data. They offer a **free 1-year API trial** for non-commercial / personal use, with 5,000 API calls per year. APD uses roughly 2 calls per download run, so ~2,500 downloads before the limit is reached — enough for many years of twice-daily downloads.

1. Create a free account at [meteoblue.com](https://www.meteoblue.com)
2. Click your account icon (top right) → **Account Overview**
3. Click the **Weather API** box and confirm non-commercial use to activate the free year
4. Your API key appears in the API section of your account

After the free year you can purchase credit packages from the same page. Without a key the weather dashboard shows a placeholder message; no forecast data will load.

### Telescopius API — patron-only, optional

Used for the Sky Dashboard's **Discover panel** — tonight's DSO highlights, object search, and personal observing lists. All other sky dashboard features (sky map, FOV overlay, mosaic planner, star charts, etc.) work without it.

The Telescopius API is available to patrons and sponsors of the project. If you already support [Telescopius](https://telescopius.com):

1. Log in at [telescopius.com](https://telescopius.com) → account **Settings** → **API Keys**
2. Generate a new key
3. Enter the key in APD's Settings page at any time (saved to Redis — no redeploy needed)

If you don't have a Telescopius key, the sky dashboard still works fully — only the Discover panel stays hidden.

### cron-job.org — optional, free

APD fetches fresh weather data automatically when you open the dashboard, but for proactive twice-daily updates (so the forecast is always ready when you need it), point a free HTTP cron job at your deployed URL. See [Automated Weather Refresh](#-automated-weather-refresh) for the full setup.

---

## 🌐 Quick Deployment (on Render.com)

For a detailed deployment guide covering Railway, Fly.io, and self-hosting, see the [Deployment Guide](#-deployment-guide) section below.

### Easiest and quickest: deploy directly from this repo

Render.com lets you deploy straight from this public repository URL — just point it at the address below, set your environment variables, and you're done.

1. Create a free account at [render.com](https://render.com)
2. Click **New → Web Service**, choose **Connect a repository**, and when prompted paste or search for:
   `https://github.com/giancarloerra/apd`
3. Set the following:
   - **Build command**: `npm ci --include=dev && npm run build`
   - **Start command**: `npm start`
4. In the **Environment** tab, add these variables (enter each as a key-value pair, or click **Add from .env** to bulk-import from your local file):
   - `UPSTASH_REDIS_REST_URL` — from your Upstash dashboard
   - `UPSTASH_REDIS_REST_TOKEN` — from your Upstash dashboard
   - `MASTER_PASSWORD` — a password to protect your dashboard (recommended)
   - `METEOBLUE_API_KEY` — from your Meteoblue account
   - `TELESCOPIUS_API_KEY` — from your Telescopius account (optional)
   - `NODE_ENV=production`
5. Click **Create Web Service** — Render builds and deploys automatically.

> **⚠️ Security:** If the app is exposed to the internet, **always set `MASTER_PASSWORD`** to a strong, unique password. Without it, anyone who discovers your URL can view your weather data and sky chart, change your API keys, and modify your stored settings. This is the only access control the app has — treat it like the master key to your dashboard.

> **Updates:** Render can auto-deploy whenever this repository releases an update if you authorised the Render GitHub App to access it during setup. Otherwise a one-click manual redeploy is always available from the Render dashboard.

### For developers: fork first, then deploy your fork

If you want to customise the code or prevent your instance from auto-updating with upstream changes, fork this repository to your own GitHub account first and connect your fork instead. Clone locally, fill in `.env` from `.env.example`, and run `npm run dev` to develop (see [Local Development](#-local-development)). Every push to your fork's `main` triggers an automatic redeploy. When this repo releases an update, merge it into your fork with a single pull request.

---

## 🚀 Deployment Guide

### Choosing a hosting platform

APD is a Node.js Express app that serves both the API and the built React frontend from a single process. Any platform that can run a persistent Node.js process and set environment variables will work.

| Platform | Notes | Cost |
|----------|-------|------|
| **Render** (recommended) | Zero-config, auto-deploy on push | Free tier (spins down after 15 min idle); ~$7/mo for always-on |
| **Railway** | Slightly faster cold starts | $5/mo Hobby plan (includes $5 usage credits) |
| **Fly.io** | More control, Docker-based, global regions | Free tier (limited); pay-as-you-go |
| **DigitalOcean App Platform** | Solid, predictable pricing | From ~$5/mo |
| **Self-hosted VPS** | Full control, cheapest at scale | Depends on provider |

### Deploy to Render (step by step)

1. Create a new **Web Service** on [render.com](https://render.com).
   - **No GitHub account / no fork:** choose **Connect a repository** and paste `https://github.com/giancarloerra/apd` directly.
   - **Fork first (for developers):** fork this repo to your GitHub account (see [Installing / using APD](#-installing--using-apd)) and connect your fork.
2. Connect your chosen repository.
3. Set the following:
   - **Environment**: `Node`
   - **Build command**: `npm ci --include=dev && npm run build`
   - **Start command**: `npm start`
   - **Node version**: `22` (or `20`+)
4. Add environment variables under the **Environment** tab:
   - Add each variable as a **key-value pair**, **or** click **"Add from .env"** to paste / import your local `.env` file in bulk (this is a Render dashboard feature, not a file upload — the variables are stored securely by Render).
   - Do **not** use Render's *Secret Files* for this — secret files are mounted at `/etc/secrets/` and are not automatically loaded as environment variables.
5. Click **Create Web Service** — Render builds and deploys automatically.

> **⚠️ Security:** If your instance is accessible from the internet (e.g. deployed on Render, Railway, Fly.io, or any public host), you **must set `MASTER_PASSWORD`** to a strong, unique password. Without it every route is open — anyone who discovers your URL can access your dashboard, change API keys, and modify stored settings. The password is the only access control the app provides. Use a randomly generated password of at least 16 characters and store it safely. Leaving the password unset is only appropriate when the app runs on a private/local network you fully trust.

On every push to `main`, Render will redeploy automatically.

### Deploy to Railway

1. Create a new project on [railway.app](https://railway.app) and choose **Deploy from GitHub repo**.
2. Select your fork, or connect the upstream repo (`giancarloerra/apd`) directly if you don't want to fork. Let Railway detect the Node.js service.
3. Set the same environment variables in the Railway **Variables** panel.
4. Railway sets `PORT` automatically — no action needed.

### Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | **Yes** | Upstash Redis REST URL (free tier at [upstash.com](https://upstash.com)) |
| `UPSTASH_REDIS_REST_TOKEN` | **Yes** | Upstash Redis REST token |
| `MASTER_PASSWORD` | No | Master password — if unset, all routes are open (fine for private/personal use behind a trusted network) |
| `SESSION_SECRET` | No | Secret for signing session tokens — auto-generated if unset, but set it explicitly in production so sessions survive restarts |
| `METEOBLUE_API_KEY` | No* | Meteoblue API key — without it, only Met Office data is shown; can also be set at runtime via Settings UI |
| `TELESCOPIUS_API_KEY` | No* | Telescopius API key — without it, sky chart DSO features are disabled; can also be set at runtime via Settings UI |
| `OBSERVER_LAT` | No | Default observer latitude (e.g. `52.6278`) |
| `OBSERVER_LON` | No | Default observer longitude (e.g. `-1.2983`) |
| `OBSERVER_ALT` | No | Default observer altitude in metres (e.g. `25`) |
| `PORT` | No | Server port — platforms set this automatically; default `3001` |
| `NODE_ENV` | No | Set to `production` to enable HTTPS redirect and secure cookies |
| `CORS_ORIGIN` | No | Comma-separated list of allowed origins in production (e.g. `https://apd.example.com`). Defaults to open in development, closed in production if not set. |

\* API keys can be set via environment variable **or** through the Settings UI (where they are stored in Redis). The environment variable takes priority.

### Setting up automated weather downloads

When you open the dashboard and the weather data is stale (older than 2:30 PM the previous day), APD will download fresh data automatically within that request — but you'll wait a few seconds while it fetches. A cron job pre-fetches the data on a fixed schedule so it's always ready the moment you open the app.

**Step 1 — Generate a trigger key**

Go to **Settings → Automated Weather Refresh** and click **Generate Key**. A unique URL will appear — copy it immediately (the key is only shown once). The URL looks like:

```
https://your-app.example.com/api/weather/refresh/trigger?key=<random-64-char-hex>
```

You can rotate or revoke the key at any time from the same Settings card.

**Step 2 — Set up a cron service**

**Option A — cron-job.org (free, recommended)**

1. Sign up at [cron-job.org](https://cron-job.org).
2. Create two jobs using the trigger URL you copied above.
3. Suggested schedule: `30 9 * * *` (09:30) and `35 13 * * *` (13:35).

**Option B — GitHub Actions scheduled workflow**

Add a workflow that calls the trigger URL on a schedule:

```yaml
- run: curl -sf "${{ secrets.APD_TRIGGER_URL }}"
```

**Alternative — environment variable**

If you prefer to manage the token outside the UI, set `CRON_TRIGGER_TOKEN` in your `.env` or hosting dashboard. The trigger URL is then: `https://<your-app-url>/api/weather/refresh/trigger?key=<your-token-value>`.

---

## ⏰ Automated Weather Refresh

### Scheduled Downloads

A cron service calls the trigger endpoint on a schedule to pre-fetch fresh data before you open the dashboard. Without it the app still works — it downloads on demand when you visit — but you wait a few seconds. With it, data is always ready instantly.

- **Service**: any free HTTP cron service (e.g. [cron-job.org](https://cron-job.org), GitHub Actions scheduled workflows, Render cron jobs)
- **Endpoint**: `<your-app-url>/api/weather/refresh/trigger?key=<your-key>` (shown in Settings after you generate the key)
- **Key management**: generate, rotate, or revoke from **Settings → Automated Weather Refresh** (or set `CRON_TRIGGER_TOKEN` env var)
- **Rate limit**: 3 requests/minute (separate from the manual refresh limit of 5/min)
- **Recommended schedule**: once ~10:30 and once ~14:35 local time
- **Timezone handling**: the staleness check uses your server's local time — no extra config needed

### Email Notifications

You can pair APD with an automation platform (e.g. [Make.com](https://make.com), [n8n](https://n8n.io), Zapier) to send an email digest after each scheduled refresh:

- **Trigger**: schedule a second HTTP call ~5 minutes after the cron refresh
- **Content**: fetch the forecast from `<your-app-url>/api/weather/refresh/trigger?key=<your-key>` (shown in Settings after you generate the key)
- **Smart Email**: construct it from the `astrophotography_score` field to highlight clear nights (simple AI can be very effective here — e.g. "Tonight looks excellent for astrophotography with only 10% cloud cover, while tomorrow is poor with 80% clouds.")

---

## 🆘 Support / hosting help

APD requires a few third-party accounts and some technical setup. If you need help, you can reach out at **giancarloerra@gmail.com** (I won't be able to help deploying this for free, but I can answer questions and point you in the right direction, or provide guidance for paid assistance).

- **GitHub Issues** — [open a bug report or question](https://github.com/giancarloerra/apd/issues) for anything related to the app itself.
- **GitHub Discussions** — for general help, deployment questions, and ideas.

---

## 🏗️ Architecture

### Frontend

- **Weather Dashboard**: React 18 + TypeScript + Tailwind CSS (Vite build)
- **Sky Dashboard**: Self-contained HTML page with Aladin Lite v3.6.5 sky viewer, jQuery 3.7.1 (Aladin dependency)
- **Icons**: Lucide React
- **Celestial data**: Star, constellation, and DSO data from [d3-celestial](https://github.com/ofrohn/d3-celestial) (bundled locally in `public/data/celestial/`)
- **Astronomy calculations**: Simplified VSOP87/Meeus for planet positions, moon position and phase — approximate, optimised for visual display rather than astrometric precision
- **Sky Dashboard persistence**: UI settings (panel state, sliders, toggles) stored in `localStorage` (`astro-sky-dashboard-v1`); FOVs and favorites stored in Redis via the API

### Backend

- **Runtime**: Node.js with ES modules
- **Framework**: Express.js
- **Persistent Storage**: Upstash Redis (weather data, FOVs, favorites, API keys, observer location)
- **Auth**: HMAC-SHA256 session tokens in httpOnly cookies

### Key Services

| Service | Purpose |
|---------|---------|
| **Upstash Redis** | Stores weather data, FOVs, favorites, API keys, observer location — shared across deploys |
| **Meteoblue API** | Primary weather data (cloud cover, precipitation, temperature, wind, humidity, day/night) |
| **Open-Meteo** | Met Office UK model data (cloud cover, precipitation, temperature) |
| **Telescopius API** | DSO highlights, search, solar system data for the sky dashboard |

### Data Flow

1. Client requests weather data from the Express API
2. Backend checks if cached data is fresh (< 24 hours old, after 2:30 PM yesterday)
3. If stale, fetches from Meteoblue + Met Office APIs using the shared observer location
4. Both datasets are cached to Redis and returned
5. Frontend processes both datasets using Meteoblue's night/day detection for consistency
6. All users share the same cached data

---

## 🔐 Authentication

The app uses a single **master password** for access control.

- When `MASTER_PASSWORD` is set in `.env`, all routes require authentication (except `/api/health`, `/api/weather/summary`, and `/api/weather/refresh/trigger`)
- When `MASTER_PASSWORD` is **not set** (or empty), auth is completely disabled — all routes are open
- Sessions use HMAC-SHA256 signed tokens stored in httpOnly cookies (30-day expiry)
- The cron trigger endpoint uses a separate token-based auth (not session cookies) — see [Automated Weather Refresh](#-automated-weather-refresh)
- Login page served at `/login`

### Public Endpoints (always accessible, no auth required)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Health check — also confirms Redis connectivity |
| `GET /api/weather/summary` | LLM-friendly weather forecast JSON (for AI integrations) |
| `GET/POST /api/weather/refresh/trigger?key=…` | Cron trigger — token-authenticated weather refresh (see Settings) |
| `GET /api/auth/check` | Check authentication status |
| `POST /api/auth/login` | Login with master password |
| `POST /api/auth/logout` | Clear session |
| `GET /login` | Login page |

### Protected Endpoints (require auth when `MASTER_PASSWORD` is set)

All other `/api/*` routes, the weather dashboard (`/weather`), sky dashboard (`/skychart.html`), settings page (`/settings`), about page (`/about`), and all other non-root app paths.

### Disabling Auth

To run without authentication (e.g., local development or future Electron app), simply leave `MASTER_PASSWORD` unset or empty in `.env`. The auth system is completely bypassed — no login page, no redirects, no cookie checks.

---

## ⚙️ Environment Variables

All configuration is via a `.env` file (see `.env.example`). The server loads it automatically when present; on cloud platforms, set env vars in the hosting dashboard instead.

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | **Yes** | Upstash Redis REST URL — used for FOVs, favorites, API keys, location |
| `UPSTASH_REDIS_REST_TOKEN` | **Yes** | Upstash Redis REST token |
| `MASTER_PASSWORD` | No | Master password — if unset, auth is disabled |
| `SESSION_SECRET` | No | Secret for signing session tokens — auto-generated if unset |
| `CRON_TRIGGER_TOKEN` | No | Cron trigger token — if set, the trigger endpoint accepts this value; otherwise manage via Settings UI → Redis |
| `METEOBLUE_API_KEY` | No* | Meteoblue API key — without it, only Met Office data is shown; can also be set via UI → Redis |
| `TELESCOPIUS_API_KEY` | No* | Telescopius API key — without it, sky chart DSO features are disabled; can also be set via UI → Redis |
| `OBSERVER_LAT` | No | Default observer latitude (default: 52.6278) |
| `OBSERVER_LON` | No | Default observer longitude (default: -1.2983) |
| `OBSERVER_ALT` | No | Default observer altitude in metres (default: 25) |
| `PORT` | No | Server port (default: 3001) |
| `NODE_ENV` | No | Set to `production` for HTTPS redirect and secure cookies |
| `CORS_ORIGIN` | No | Comma-separated allowed origins in production (e.g. `https://apd.example.com`) |

\* API keys can be provided via `.env` or stored in Redis through the UI. The `.env` value takes priority.

---

## 🚀 Local Development

### Prerequisites

- Node.js 18+
- npm
- Upstash Redis account (free tier works)

### Setup

```bash
git clone <repository-url>
cd apd
npm install
cp .env.example .env
# Edit .env with your credentials
```

### Run

```bash
npm run dev
```

This starts both:
- **Frontend** dev server on `http://localhost:5173` (Vite, with HMR)
- **Backend** server on `http://localhost:3001` (nodemon, auto-restarts on changes)

Vite proxies `/api` requests to `localhost:3001` automatically.

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start frontend + backend in development |
| `npm run client:dev` | Start only the Vite frontend dev server |
| `npm run server:dev` | Start only the backend with nodemon |
| `npm run build` | Build frontend for production (outputs to `dist/`) |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type-check (no emit) |
| `npm test` | Run unit tests with Vitest |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run release` | Bump version, update CHANGELOG, create GitHub release |

### Testing & CI

Unit tests run with [Vitest](https://vitest.dev/) and cover both server utilities and frontend logic:

- `src/utils/weatherUtils.test.ts` — Meteoblue data processing, scoring, and night detection
- `server/utils/weatherProcessor.test.js` — weather summary generation for the LLM endpoint

```bash
npm test              # run tests
npm run test:coverage # run with coverage report
```

The CI workflow (`.github/workflows/ci.yml`) runs on every push and pull request to `main` — it lints, type-checks, tests, and builds against **Node.js 18, 20, and 22** in parallel.

### Releases

Releases are automated via [`release-it`](https://github.com/release-it/release-it). A GitHub Actions workflow (`.github/workflows/release.yml`) is triggered manually from the Actions tab — choose `patch`, `minor`, or `major`. It bumps `package.json`, updates `CHANGELOG.md`, tags the commit, and publishes a GitHub Release.

---

## 🤝 Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, commit conventions, and pull request guidelines.

---

## 🌤️ Weather Data Sources

### Primary: Meteoblue

- **Package**: `basic-1h_clouds-1h_sunmoon_moonlight-1h`
- **Strengths**: Complete dataset with night/day detection, temperature, wind, humidity
- **Usage**: Primary calculations, night/day filtering, reference hours, statistics

### Secondary: Met Office (via Open-Meteo)

- **Model**: `ukmo_global_deterministic_10km`
- **Strengths**: High-quality UK-specific forecasts
- **Usage**: Comparative forecasting, cross-validation
- **Note**: Used by Scope Nights — less precise but more optimistic than the 2km model

### Integration

- **Time Structure**: Uses Meteoblue's time structure and night/day detection for consistency
- **Display**: Two separate sections showing identical layouts with different data sources
- **Reference Hours**: Both sources show 4 hours before night + hours until 10am after night
- **Statistics**: Each source calculates independent astrophotography scores
- **Scoring difference**: Meteoblue score uses cloud cover (80%) + precipitation (20%). Met Office score uses cloud cover only (Met Office reports precipitation in mm rather than %, so the precipitation penalty is not applied). Both are scaled 0–100.

---

## 🔭 Shared Observer Location

Both the weather dashboard and sky dashboard share a single observer location stored in Redis.

- **Default**: Loaded from `OBSERVER_LAT`/`OBSERVER_LON` env vars
- **Runtime override**: Set via UI in either dashboard → saved to Redis; the Settings page also provides a “Use my location” geolocation button
- **API**: `GET /PUT /api/location` — shared by both dashboards
- Weather API calls (Meteoblue and Open-Meteo) use the shared location dynamically

---

## 📊 API Endpoints

### General

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/health` | **No** | Health check — confirms Redis connectivity |
| `GET` | `/api/settings` | Yes | Aggregate settings: location, API key states, auth config, download status |

### Weather

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/weather` | Yes | Cached weather data (auto-downloads if stale) |
| `POST` | `/api/weather/refresh` | Yes | Force fresh download (manual/UI use) |
| `GET/POST` | `/api/weather/refresh/trigger?key=…` | **Token** | Cron trigger — public, token-authenticated (3 req/min) |
| `GET` | `/api/weather/status` | Yes | Download status only |
| `GET` | `/api/weather/metoffice` | Yes | Cached Met Office data |
| `GET` | `/api/weather/summary` | **No** | LLM-friendly processed forecast |
| `GET` | `/api/weather/meteoblue/key-status` | Yes | Check if Meteoblue key is configured |
| `PUT` | `/api/weather/meteoblue/key` | Yes | Save Meteoblue API key to Redis |

### Cron Trigger Token

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/settings/cron-token` | Yes | Get trigger key status (configured, source, timestamps) |
| `POST` | `/api/settings/cron-token` | Yes | Generate or rotate trigger key (returns raw key once) |
| `DELETE` | `/api/settings/cron-token` | Yes | Revoke trigger key |

### Location

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/location` | Yes | Get shared observer location |
| `PUT` | `/api/location` | Yes | Update shared observer location |

### Sky Dashboard (Telescopius proxy)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/skychart/telescopius/highlights` | Yes | DSO highlights (cached 6h) |
| `GET` | `/api/skychart/telescopius/search` | Yes | Target search |
| `GET` | `/api/skychart/telescopius/solar-system` | Yes | Solar system times (cached 12h) |
| `GET` | `/api/skychart/telescopius/lists` | Yes | Observing lists (cached 24h) |
| `GET` | `/api/skychart/telescopius/lists/:id` | Yes | Single list details (cached 12h) |
| `GET` | `/api/skychart/telescopius/pictures` | Yes | Astrophotography pictures search |
| `GET` | `/api/skychart/telescopius/key-status` | Yes | Check Telescopius key status |
| `PUT` | `/api/skychart/telescopius/key` | Yes | Save Telescopius API key to Redis |

### Sky Dashboard (Settings)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/skychart/fovs` | Yes | Get saved FOV list |
| `PUT` | `/api/skychart/fovs` | Yes | Save FOV list |
| `GET` | `/api/skychart/favorites` | Yes | Get saved favorites |
| `PUT` | `/api/skychart/favorites` | Yes | Save favorites |

Telescopius proxy routes are rate-limited to 30 requests/minute.

---

## 📁 File Structure

```
apd/
├── server/                         # Backend
│   ├── index.js                    # Express server, auth, routes, Redis
│   ├── services/
│   │   └── weatherService.js       # Weather fetching & caching
│   └── utils/
│       ├── weatherProcessor.js     # /api/weather/summary processing
│       └── weatherProcessor.test.js
├── src/                            # Frontend (React + TypeScript)
│   ├── main.tsx                    # React entry point
│   ├── App.tsx                     # Root component (routing + auth check)
│   ├── index.css                   # Global styles (Tailwind base)
│   ├── vite-env.d.ts               # Vite client type declarations
│   ├── components/
│   │   ├── Dashboard.tsx           # Main weather dashboard
│   │   ├── LandingPage.tsx         # Home / entry page with animated star field
│   │   ├── AboutPage.tsx           # Feature guide and usage reference
│   │   ├── UnifiedDayRow.tsx       # Day row with Meteoblue + Met Office side-by-side
│   │   ├── HourlyCard.tsx          # Hourly forecast card
│   │   ├── WeeklyHeatmap.tsx       # Weekly cloud cover heatmap grid
│   │   └── DownloadStatus.tsx      # Download status indicator
│   ├── services/
│   │   └── weatherService.ts       # API client
│   ├── types/
│   │   └── weather.ts              # TypeScript interfaces
│   └── utils/
│       ├── weatherUtils.ts         # Meteoblue data processing & scoring
│       ├── weatherUtils.test.ts    # Frontend unit tests
│       └── metOfficeUtils.ts       # Met Office data processing & scoring
├── public/
│   ├── skychart.html               # Sky dashboard (self-contained, Aladin Lite)
│   ├── settings.html               # Settings page (location, API keys, system status)
│   ├── theme.css                   # Shared CSS theme (accent colour tokens)
│   ├── logo.png                    # App logo / favicon
│   └── data/celestial/             # Star, constellation & DSO data (from d3-celestial)
├── screenshots/                    # README screenshots
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # Lint, typecheck, test, build · Node 18/20/22
│   │   └── release.yml             # Automated release via release-it
│   ├── ISSUE_TEMPLATE/             # Bug report & feature request templates
│   └── PULL_REQUEST_TEMPLATE.md
├── .env.example                    # Template for .env
├── .release-it.json                # release-it config (conventional changelog)
├── index.html                      # Vite entry HTML
├── package.json
├── vite.config.ts                  # Vite + Vitest configuration & dev proxy
├── tsconfig.json                   # TypeScript project references root
├── tsconfig.app.json               # TypeScript config for the app source
├── tsconfig.node.json              # TypeScript config for Node/Vite tooling
├── eslint.config.js                # ESLint flat config
├── tailwind.config.js              # Tailwind CSS config
├── postcss.config.js               # PostCSS config (Tailwind + autoprefixer)
├── CONTRIBUTING.md                 # Contribution guidelines
├── CODE_OF_CONDUCT.md              # Community code of conduct
├── CHANGELOG.md                    # Auto-generated changelog (release-it)
├── LICENSE                         # AGPL-3.0-or-later
└── README.md
```

---

## 📝 License

Copyright © 2026 Giancarlo Erra.

This program is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License** as published by the Free Software Foundation, either **version 3 of the License, or (at your option) any later version**.

See [LICENSE](LICENSE) for the full license text.

This means:
- You can use, copy, modify, and distribute this software freely.
- If you run a modified version on a server and users interact with it over a network, you **must** make the modified source code available to those users.
- Any project that incorporates this code **must** also be released under AGPL-3.0-or-later.
