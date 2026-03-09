// APD — Astrophotography Planning Dashboard
// Copyright © 2026 Giancarlo Erra — AGPL-3.0-or-later

import { Cloud, Star, Telescope, Home, Settings } from "lucide-react";

const WEATHER_FEATURES = [
  "Night-only hourly filtering (4 h before dark → 10 AM)",
  "Dual-source forecasts: Meteoblue + Met Office side-by-side",
  "Astrophotography score 0–100 per night per source",
  "7-day expandable forecast rows with click-to-expand hourly cards",
  "Hourly cards: cloud cover, temperature, precipitation, wind, humidity",
  "Cloud cover sparkline bar chart per night row",
  "Weekly cloud cover heatmap with per-day score row",
  "Best night of the week banner (highest score highlighted)",
  "Moonlight % and sky brightness (lux), colour-coded by impact",
  "Solar astrophotography section — daytime cloud forecasts",
  "Live SDO/HMI solar imagery + sunspot region images",
  "Auto twice-daily weather refresh + manual trigger from header",
  "Download status indicator with last-download timestamp",
  "LLM-friendly summary endpoint — GET /api/weather/summary (always public, no auth) — structured JSON for AI/LLM automation: daily email summaries, chatbot integrations, scheduled forecast alerts",
];

const SKY_FEATURES = [
  "Interactive sky map powered by Aladin Lite v3",
  "17+ sky survey layers: DSS2, PanSTARRS, 2MASS, AllWISE, GALEX UV, XMM X-ray, Fermi gamma-ray, NVSS radio, and more",
  "Framing mode and Sky Chart mode",
  "Camera FOV overlay — define sensor width × height in degrees",
  "FOV lock to target with re-centre button",
  "Mosaic planner — N×M tile grid with configurable overlap %",
  "Camera rotation / angle offset slider",
  "Equatorial and Alt-Az mount support",
  "Saved FOV presets and favorite targets — synced to Redis",
  "Import targets from Telescopius observing lists into Favorites",
  "Target search by name (e.g. M 42, IC 434, Andromeda…)",
  "Time travel — step sky forward/backward by ±h / ±d / ±month",
  "Constellation lines, names, star dots, star name labels",
  "Moon marker with phase info, planet positions",
  "Red night mode — full-screen red overlay for dark adaptation",
  "Horizon line with optional ground darkening",
  "Alt-Az and equatorial grids with shared opacity slider",
  "Deep Sky Objects: Messier, NGC, IC, LDN/B catalogs",
  "DSO filtering by type: galaxies, nebulae, dark neb., globular/open clusters, planetary neb.",
  "DSO magnitude limit slider + unknown-magnitude toggle",
  "Star density, name density, constellation & star opacity sliders",
  "Discover panel: tonight's DSO highlights filterable by type",
  "Telescopius target search with type and sort filters",
  "Personal Telescopius observing lists",
  "Solar system rise/set/transit times (Telescopius API)",
  "Live RA / Dec display at map centre",
];

const NAV_LINK_CLASS =
  "flex items-center gap-1.5 px-3 py-1.5 bg-accent/[0.08] hover:bg-accent/[0.18] border border-accent/20 text-accent text-sm rounded-md transition-colors";

export function AboutPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-700/60 shadow-md">
        <div className="container mx-auto px-4 max-w-5xl flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Cloud className="h-6 w-6 text-accent" />
              <Star className="h-2.5 w-2.5 text-amber-400 absolute -top-0.5 -right-0.5 animate-pulse" />
            </div>
            <h1 className="text-lg font-bold text-white tracking-tight">About APD</h1>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className={NAV_LINK_CLASS}>
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">Home</span>
            </a>
            <a href="/weather" className={NAV_LINK_CLASS}>
              <Cloud className="h-4 w-4" />
              <span className="hidden sm:inline">Weather</span>
            </a>
            <a href="/skychart.html" className={NAV_LINK_CLASS}>
              <Telescope className="h-4 w-4" />
              <span className="hidden sm:inline">Sky</span>
            </a>
            <a href="/settings" className={NAV_LINK_CLASS}>
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </a>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 pt-10 pb-14 max-w-5xl">
        {/* Hero */}
        <div className="text-center mb-12">
          <img src="/logo.png" alt="APD" className="w-16 h-16 mx-auto mb-4 rounded-xl" />
          <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
            Astrophotography Planning Dashboard
          </h2>
          <p className="text-slate-400 text-sm max-w-xl mx-auto">
            A unified app combining weather forecasts from multiple sources with an interactive sky
            chart — built for planning astrophotography sessions.
          </p>
        </div>

        {/* Feature columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Weather Dashboard */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 flex flex-col">
            <div className="flex items-center gap-3 mb-5">
              <div className="relative flex-shrink-0">
                <Cloud className="h-6 w-6 text-accent" />
                <Star className="h-2.5 w-2.5 text-amber-400 absolute -top-0.5 -right-0.5" />
              </div>
              <h3 className="text-lg font-semibold text-white">Weather Dashboard</h3>
            </div>
            <ul className="space-y-2 flex-1">
              {WEATHER_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="text-accent/70 mt-[3px] flex-shrink-0 text-xs">✦</span>
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="/weather"
              className="mt-6 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent/[0.1] hover:bg-accent/[0.22] border border-accent/25 text-accent text-sm font-medium transition-colors"
            >
              Open Weather Dashboard →
            </a>
          </div>

          {/* Sky Dashboard */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 flex flex-col">
            <div className="flex items-center gap-3 mb-5">
              <Telescope className="h-6 w-6 text-accent flex-shrink-0" />
              <h3 className="text-lg font-semibold text-white">Sky Dashboard</h3>
            </div>
            <ul className="space-y-2 flex-1">
              {SKY_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="text-accent/70 mt-[3px] flex-shrink-0 text-xs">✦</span>
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="/skychart.html"
              className="mt-6 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent/[0.1] hover:bg-accent/[0.22] border border-accent/25 text-accent text-sm font-medium transition-colors"
            >
              Open Sky Dashboard →
            </a>
          </div>
        </div>

        <p className="text-center mt-12 text-xs text-slate-700 tracking-wide">
          © 2026 Giancarlo Erra
        </p>
      </div>
    </div>
  );
}
