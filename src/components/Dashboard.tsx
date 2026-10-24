// APD — Astrophotography Planning Dashboard
// Copyright © 2026 Giancarlo Erra — AGPL-3.0-or-later

import { useState, useEffect } from "react";
import { Star, Cloud, CloudSnow, Telescope, Globe, Settings, Home, HelpCircle, AlertTriangle } from "lucide-react";
import { weatherService } from "../services/weatherService";
import { getScoreColor, getScoreLabel } from "../utils/weatherUtils";
import { DownloadStatus as IDownloadStatus } from "../types/weather";
import type { CompleteForecast, ForecastSession } from "../types/forecast";
import { DownloadStatus } from "./DownloadStatus";
import { CompleteDayRow } from "./UnifiedDayRow";
import { WeeklyHeatmap } from "./WeeklyHeatmap";

export function Dashboard() {
  const [forecast, setForecast] = useState<CompleteForecast | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<IDownloadStatus>({ isDownloading: false });
  const [isLoading, setIsLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [configuredLocation, setConfiguredLocation] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    const unsubscribe = weatherService.subscribeToStatus(setDownloadStatus);
    loadWeatherData();
    fetch('/api/location').then(r => r.json()).then(loc => {
      if (loc && typeof loc.lat === 'number') setConfiguredLocation(loc);
    }).catch(() => {});
    return unsubscribe;
  }, []);

  const loadWeatherData = async (forceDownload = false) => {
    try {
      setIsLoading(true);
      setForecast(await weatherService.getCompleteForecast(forceDownload));
    } catch (error) {
      setForecast(null);
      setDownloadStatus(previous => ({ ...previous, isDownloading: false, error: error instanceof Error ? error.message : "Failed to load forecasts" }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = () => { loadWeatherData(true); };
  const mergedDayData = forecast?.nightSessions ?? [];
  const mergedSolarData = forecast?.daySessions ?? [];
  const getBestDay = (sessions: ForecastSession[], id: string | null) => {
    const session = sessions.find(s => s.id === id);
    const value = session?.average.summary.score.value;
    return session && value != null ? { dayName: session.dayName, score: value, source: "All available forecasts" } : null;
  };
  const locationMismatch = forecast && configuredLocation
    ? Math.abs(forecast.location.latitude - configuredLocation.lat) > 0.01 ||
      Math.abs(forecast.location.longitude - configuredLocation.lon) > 0.01
    : false;

  if (isLoading && !forecast) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin mb-4">
            <Cloud className="h-12 w-12 text-accent mx-auto" />
          </div>
          <p className="text-slate-300">Loading astrophotography forecast...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Sticky header */}
      <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-700/60 shadow-md">
        <div className="container mx-auto px-4 max-w-6xl flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Cloud className="h-7 w-7 text-accent" />
              <Star className="h-3 w-3 text-amber-400 absolute -top-0.5 -right-0.5 animate-pulse" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Weather Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-accent/[0.08] hover:bg-accent/[0.18] border border-accent/20 text-accent text-sm rounded-md transition-colors"
            >
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">Home</span>
            </a>
            <a
              href="/skychart.html"
              rel="noopener noreferrer"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-accent/[0.08] hover:bg-accent/[0.18] border border-accent/20 text-accent text-sm rounded-md transition-colors"
            >
              <Telescope className="h-4 w-4" />
              <span className="hidden sm:inline">Sky Dashboard</span>
            </a>
            <a
              href="/settings"
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-accent/[0.08] hover:bg-accent/[0.18] border border-accent/20 text-accent text-sm rounded-md transition-colors"
            >
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </a>
            <button
              onClick={() => setShowHelp(h => !h)}
              title="Quick reference"
              className={`flex items-center space-x-1.5 px-3 py-1.5 border text-sm rounded-md transition-colors ${
                showHelp
                  ? 'bg-accent/[0.22] border-accent/40 text-accent'
                  : 'bg-accent/[0.08] hover:bg-accent/[0.18] border border-accent/20 text-accent'
              }`}
            >
              <HelpCircle className="h-4 w-4" />
              <span className="hidden sm:inline">{showHelp ? 'Close' : 'Help'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Collapsible quick-reference help panel */}
      {showHelp && (
        <div className="bg-slate-800/98 border-b border-slate-700/60 backdrop-blur">
          <div className="container mx-auto px-4 max-w-6xl py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 text-xs">
              <div>
                <h4 className="font-semibold text-white mb-2 uppercase tracking-wider text-[0.68rem]">Cloud Cover</h4>
                <div className="space-y-1 text-slate-400">
                  <div><span className="text-green-400">●</span> 0–20% — Excellent</div>
                  <div><span className="text-yellow-400">●</span> 21–50% — Good</div>
                  <div><span className="text-orange-400">●</span> 51–80% — Fair</div>
                  <div><span className="text-red-400">●</span> 81–100% — Poor</div>
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-white mb-2 uppercase tracking-wider text-[0.68rem]">Astrophotography Score</h4>
                <div className="space-y-1 text-slate-400">
                  <div><span className="text-emerald-400">●</span> 90–100 — Excellent</div>
                  <div><span className="text-green-400">●</span> 75–89 — Very good</div>
                  <div><span className="text-yellow-400">●</span> 60–74 — Good</div>
                  <div><span className="text-orange-400">●</span> 45–59 — Fair</div>
                  <div><span className="text-red-400">●</span> Below 45 — Poor</div>
                </div>
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <h4 className="font-semibold text-white mb-2 uppercase tracking-wider text-[0.68rem]">Data Sources</h4>
                <div className="space-y-2 text-slate-400">
                  <p><span className="text-accent font-medium">Average</span> — Available forecasts averaged per hour and metric. Sources can overlap and are not independent votes.</p>
                  <p><span className="text-blue-400 font-medium">Providers</span> — Compare each source individually. Native ranges, geographic limits and missing data remain explicit.</p>
                  <p><span className="text-slate-300 font-medium">LLM endpoint</span>: <code className="text-xs bg-slate-700 px-1 rounded">/api/weather/summary</code>. Compact public nightly JSON for scripts and AI tools, with all available providers.</p>
                </div>
                <a href="/about" className="inline-flex items-center gap-1 mt-3 text-accent hover:text-accent/80 transition-colors text-xs font-medium">
                  Full feature guide →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 pt-6 pb-8 max-w-6xl">

        {/* Download Status */}
        <DownloadStatus status={downloadStatus} onRefresh={handleRefresh} />

        {forecast && (
          <>
            {/* Overall summary uses the same aggregate as the complete API. */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                <div className="flex items-center space-x-3 mb-2">
                  <Star className="h-6 w-6 text-amber-400" />
                  <h3 className="text-lg font-semibold text-white">
                    Overall Forecast
                  </h3>
                </div>
                <div className="text-3xl font-bold text-accent">
                  {forecast.summary.overallNightScore ?? "—"}/100
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Average conditions for the week
                </p>
              </div>

              <div className={`bg-slate-800 border rounded-lg p-6 ${locationMismatch ? 'border-amber-500/60' : 'border-slate-700'}`}>
                <div className="flex items-center space-x-3 mb-2">
                  <Globe className={`h-6 w-6 ${locationMismatch ? 'text-amber-400' : 'text-blue-400'}`} />
                  <h3 className="text-lg font-semibold text-white">Location</h3>
                </div>
                <div className="text-lg font-medium text-white">
                  {Math.abs(forecast.location.latitude).toFixed(2)}°{forecast.location.latitude >= 0 ? 'N' : 'S'},{" "}
                  {Math.abs(forecast.location.longitude).toFixed(2)}°{forecast.location.longitude >= 0 ? 'E' : 'W'}
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Elevation: {forecast.location.elevation}m
                </p>
                {locationMismatch && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>Location changed — <button onClick={handleRefresh} className="underline hover:text-amber-300">refresh</button> to update</span>
                  </div>
                )}
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                <div className="flex items-center space-x-3 mb-2">
                  <Telescope className="h-6 w-6 text-purple-400" />
                  <h3 className="text-lg font-semibold text-white">
                    Night Hours
                  </h3>
                </div>
                <div className="text-lg font-medium text-white">
                  {mergedDayData.reduce((sum, day) => sum + day.durationHours, 0)}{" "}
                  total
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Across {mergedDayData.length} days
                </p>
              </div>
            </div>

            {/* Unified Daily Forecasts */}
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-white mb-4">
                Daily Night Forecasts
              </h2>

              {mergedDayData.length === 0 ? (
                <div className="text-center py-12">
                  <CloudSnow className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-400">No nighttime data available</p>
                </div>
              ) : (
                <>
                  {/* Best night banner */}
                  {(() => {
                    const best = getBestDay(mergedDayData, forecast.summary.bestNight);
                    if (!best || best.score < 30) return null;
                    return (
                      <div
                        className={`flex items-center gap-3 p-3 rounded-lg border mb-4 mx-auto max-w-2xl ${
                          best.score >= 75
                            ? "bg-emerald-900/30 border-emerald-700/50"
                            : best.score >= 45
                            ? "bg-yellow-900/30 border-yellow-700/50"
                            : "bg-slate-800 border-slate-700"
                        }`}
                      >
                        <Star
                          className={`h-5 w-5 flex-shrink-0 ${getScoreColor(best.score)}`}
                        />
                        <div>
                          <span className="text-sm font-semibold text-white">
                            Best night:{" "}
                          </span>
                          <span
                            className={`text-sm font-bold ${getScoreColor(best.score)}`}
                          >
                            {best.dayName}
                          </span>
                          <span className="text-sm text-slate-400">
                            {" "}— score {best.score}/100 ({
                              getScoreLabel(best.score)
                            })
                          </span>
                          <span className="text-xs text-slate-500 ml-2">
                            ({best.source})
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Weekly cloud cover heatmap */}
                  <div className="mb-6">
                    <WeeklyHeatmap sessions={mergedDayData} providers={forecast.providers} isSolar={false} />
                  </div>

                  {mergedDayData.map((mergedDay) => (
                    <CompleteDayRow
                      key={mergedDay.date}
                      session={mergedDay}
                      providers={forecast.providers}
                    />
                  ))}
                </>
              )}
            </div>

            {/* Legend */}
            <div className="mt-8 bg-slate-800 border border-slate-700 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Legend</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <h4 className="font-medium text-slate-300 mb-2">
                    Cloud Cover
                  </h4>
                  <div className="space-y-1 text-slate-400">
                    <div>
                      <span className="text-green-400">●</span> 0-20%: Excellent
                    </div>
                    <div>
                      <span className="text-yellow-400">●</span> 21-50%: Good
                    </div>
                    <div>
                      <span className="text-orange-400">●</span> 51-80%: Fair
                    </div>
                    <div>
                      <span className="text-red-400">●</span> 81-100%: Poor
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium text-slate-300 mb-2">
                    Astrophotography Score
                  </h4>
                  <div className="space-y-1 text-slate-400">
                    <div>
                      <span className="text-emerald-400">●</span> 90-100:
                      Excellent conditions
                    </div>
                    <div>
                      <span className="text-green-400">●</span> 75-89: Very good
                      conditions
                    </div>
                    <div>
                      <span className="text-yellow-400">●</span> 60-74: Good
                      conditions
                    </div>
                    <div>
                      <span className="text-orange-400">●</span> 45-59: Fair
                      conditions
                    </div>
                    <div>
                      <span className="text-red-400">●</span> Below 45: Poor
                      conditions
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Solar Astrophotography Section */}
            <div className="mt-12">
              <h2 className="text-2xl font-bold text-white mb-4">
                Solar Astrophotography
              </h2>
              <p className="text-slate-400 mb-6">
                Solar conditions and sunspot activity for Hydrogen-alpha solar
                imaging
              </p>

              {/* Sunspot Images */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold text-white mb-4">
                  Current Solar Activity
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-slate-300 mb-2">
                      SDO/HMI Continuum
                    </h4>
                    <img
                      src="https://jsoc1.stanford.edu/data/hmi/images/latest/HMI_latest_colInt_1024x1024.jpg"
                      alt="Solar Disk - SDO/HMI Continuum"
                      className="w-full h-auto rounded"
                      loading="lazy"
                    />
                  </div>
                  <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-slate-300 mb-2">
                      Sunspot Regions
                    </h4>
                    <img
                      src="https://theskylive.com/objects/sun/sunspots/sunspots.jpg"
                      alt="Sunspot Regions"
                      className="w-full h-auto rounded"
                      loading="lazy"
                    />
                  </div>
                </div>
              </div>

              {/* Solar Forecasts */}
              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-white mb-4">
                  Daily Solar Forecasts
                </h2>

                {mergedSolarData.length === 0 ? (
                  <div className="text-center py-12">
                    <CloudSnow className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                    <p className="text-slate-400">No solar data available</p>
                  </div>
                ) : (
                  <>
                    {/* Best solar day banner */}
                    {(() => {
                      const best = getBestDay(mergedSolarData, forecast.summary.bestDay);
                      if (!best || best.score < 30) return null;
                      return (
                        <div
                          className={`flex items-center gap-3 p-3 rounded-lg border mb-4 mx-auto max-w-2xl ${
                            best.score >= 75
                              ? "bg-amber-900/30 border-amber-700/50"
                              : best.score >= 45
                              ? "bg-yellow-900/30 border-yellow-700/50"
                              : "bg-slate-800 border-slate-700"
                          }`}
                        >
                          <Star
                            className={`h-5 w-5 flex-shrink-0 ${getScoreColor(best.score)}`}
                          />
                          <div>
                            <span className="text-sm font-semibold text-white">
                              Best solar day:{" "}
                            </span>
                            <span
                              className={`text-sm font-bold ${getScoreColor(best.score)}`}
                            >
                              {best.dayName}
                            </span>
                            <span className="text-sm text-slate-400">
                              {" "}— score {best.score}/100 ({
                                getScoreLabel(best.score)
                              })
                            </span>
                            <span className="text-xs text-slate-500 ml-2">
                              ({best.source})
                            </span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Weekly solar cloud cover heatmap */}
                    <div className="mb-6">
                      <WeeklyHeatmap sessions={mergedSolarData} providers={forecast.providers} isSolar={true} />
                    </div>

                    {mergedSolarData.map((mergedDay) => (
                      <CompleteDayRow
                        key={`solar-${mergedDay.date}`}
                        session={mergedDay}
                        providers={forecast.providers}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {!forecast && !isLoading && (
          <div className="text-center py-12">
            <CloudSnow className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-400 mb-4">No weather data available</p>
            <p className="text-sm text-slate-500">
              Click the Refresh button above to download weather data
            </p>
          </div>
        )}

        <div className="text-center pt-8 pb-4 text-[0.65rem] text-slate-600 tracking-wide">
          © 2026 Giancarlo Erra
        </div>
      </div>
    </div>
  );
}
