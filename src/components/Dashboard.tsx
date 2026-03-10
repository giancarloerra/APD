// APD — Astrophotography Planning Dashboard
// Copyright © 2026 Giancarlo Erra — AGPL-3.0-or-later

import { useState, useEffect, useMemo } from "react";
import { Star, Cloud, CloudSnow, Telescope, Globe, Settings, Home, HelpCircle, AlertTriangle } from "lucide-react";
import { weatherService } from "../services/weatherService";
import { processWeatherData, processSolarData, getScoreColor, getScoreLabel } from "../utils/weatherUtils";
import {
  processMetOfficeData,
  processMetOfficeSolarData,
} from "../utils/metOfficeUtils";
import {
  WeatherData,
  DayData,
  DownloadStatus as IDownloadStatus,
} from "../types/weather";
import { DownloadStatus } from "./DownloadStatus";
import { UnifiedDayRow } from "./UnifiedDayRow";
import { WeeklyHeatmap } from "./WeeklyHeatmap";

export function Dashboard() {
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [dayData, setDayData] = useState<DayData[]>([]);
  const [metOfficeDayData, setMetOfficeDayData] = useState<DayData[]>([]);
  const [solarData, setSolarData] = useState<DayData[]>([]);
  const [metOfficeSolarData, setMetOfficeSolarData] = useState<DayData[]>([]);
  const [downloadStatus, setDownloadStatus] = useState<IDownloadStatus>({
    isDownloading: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [configuredLocation, setConfiguredLocation] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    // Subscribe to download status updates
    const unsubscribe = weatherService.subscribeToStatus(setDownloadStatus);

    // Load initial data (with automatic download check)
    loadWeatherData();

    // Fetch configured location to detect mismatches
    fetch('/api/location').then(r => r.json()).then(loc => {
      if (loc && typeof loc.lat === 'number') setConfiguredLocation(loc);
    }).catch(() => {});

    return unsubscribe;
  }, []);

  const loadWeatherData = async (forceDownload = false) => {
    try {
      setIsLoading(true);

      // Load Meteoblue data
      const data = await weatherService.getWeatherData(forceDownload);

      // Load Met Office data
      const metOfficeDataResult = await weatherService.getMetOfficeData();

      if (data) {
        setWeatherData(data);
        const processedDays = processWeatherData(data);
        setDayData(processedDays);

        // Process solar data
        const processedSolarDays = processSolarData(data);
        setSolarData(processedSolarDays);
      } else {
        // Meteoblue unavailable — clear any stale Meteoblue data
        setWeatherData(null);
        setDayData([]);
        setSolarData([]);
      }

      // Met Office is independent — process it with or without Meteoblue
      if (metOfficeDataResult) {
        const metOfficeProcessedDays = processMetOfficeData(
          metOfficeDataResult
        );
        setMetOfficeDayData(metOfficeProcessedDays);

        // Process Met Office solar data
        const processedMetOfficeSolarDays = processMetOfficeSolarData(
          metOfficeDataResult,
          data ?? undefined
        );
        setMetOfficeSolarData(processedMetOfficeSolarDays);
      } else {
        // Met Office unavailable — clear any stale Met Office data
        setMetOfficeDayData([]);
        setMetOfficeSolarData([]);
      }
    } catch (error) {
      console.error("Error loading weather data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = () => {
    loadWeatherData(true);
  };

  const isYesterday = (dateString: string) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const yesterdayString = yesterday.toISOString().split("T")[0]; // "YYYY-MM-DD"
    return dateString === yesterdayString;
  };

  const getOverallScore = () => {
    if (dayData.length === 0) return 0;
    const avgScore =
      dayData.reduce((sum, day) => sum + day.astrophotographyScore, 0) /
      dayData.length;
    return Math.round(avgScore);
  };

  // Merge day data from both providers for unified display
  const mergedDayData = useMemo(() => {
    const mergedDays = new Map<
      string,
      { meteoblue?: DayData; metoffice?: DayData }
    >();

    // Add Meteoblue days
    dayData
      .filter((day) => !isYesterday(day.date))
      .forEach((day) => {
        if (!mergedDays.has(day.date)) {
          mergedDays.set(day.date, {});
        }
        mergedDays.get(day.date)!.meteoblue = day;
      });

    // Add Met Office days
    metOfficeDayData
      .filter((day) => !isYesterday(day.date))
      .forEach((day) => {
        if (!mergedDays.has(day.date)) {
          mergedDays.set(day.date, {});
        }
        mergedDays.get(day.date)!.metoffice = day;
      });

    // Convert to array and sort by date
    return Array.from(mergedDays.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [dayData, metOfficeDayData]);

  // Return the merged day with the highest astrophotography score
  const getBestDay = (
    mergedDays: Array<{ date: string; meteoblue?: DayData; metoffice?: DayData }>
  ) => {
    let best: { dayName: string; score: number; source: string } | null = null;
    for (const d of mergedDays) {
      const mb = d.meteoblue;
      const mo = d.metoffice;
      let score: number;
      let source: string;
      if (mb && mo) {
        score = Math.round((mb.astrophotographyScore + mo.astrophotographyScore) / 2);
        source = "Meteoblue + Met Office";
      } else if (mb) {
        score = mb.astrophotographyScore;
        source = "Meteoblue";
      } else if (mo) {
        score = mo.astrophotographyScore;
        source = "Met Office";
      } else {
        continue;
      }
      const dayName = (mb || mo)?.dayName ?? "";
      if (!best || score > best.score) {
        best = { dayName, score, source };
      }
    }
    return best;
  };

  // Merge solar day data from both providers for unified display
  const mergedSolarData = useMemo(() => {
    const mergedDays = new Map<
      string,
      { meteoblue?: DayData; metoffice?: DayData }
    >();

    // Add Meteoblue solar days
    solarData
      .filter((day) => !isYesterday(day.date))
      .forEach((day) => {
        if (!mergedDays.has(day.date)) {
          mergedDays.set(day.date, {});
        }
        mergedDays.get(day.date)!.meteoblue = day;
      });

    // Add Met Office solar days
    metOfficeSolarData
      .filter((day) => !isYesterday(day.date))
      .forEach((day) => {
        if (!mergedDays.has(day.date)) {
          mergedDays.set(day.date, {});
        }
        mergedDays.get(day.date)!.metoffice = day;
      });

    // Convert to array and sort by date
    return Array.from(mergedDays.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [solarData, metOfficeSolarData]);

  const locationMismatch = weatherData && configuredLocation
    ? Math.abs(weatherData.metadata.latitude - configuredLocation.lat) > 0.01 ||
      Math.abs(weatherData.metadata.longitude - configuredLocation.lon) > 0.01
    : false;

  if (isLoading && !weatherData && metOfficeDayData.length === 0) {
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
                  <p><span className="text-accent font-medium">Meteoblue</span> — Primary source. Night/day detection, moonlight, wind, humidity. Score is based on this.</p>
                  <p><span className="text-blue-400 font-medium">Met Office</span> — UK model via Open-Meteo. Good cross-validation reference.</p>
                  <p><span className="text-slate-300 font-medium">LLM endpoint</span> — <code className="text-xs bg-slate-700 px-1 rounded">/api/weather/summary</code> — public JSON for AI automations (daily email alerts, chatbots…)</p>
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

        {(weatherData || metOfficeDayData.length > 0) && (
          <>
            {/* Overall Summary — Meteoblue-only (has richer metadata) */}
            {weatherData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                <div className="flex items-center space-x-3 mb-2">
                  <Star className="h-6 w-6 text-amber-400" />
                  <h3 className="text-lg font-semibold text-white">
                    Overall Forecast
                  </h3>
                </div>
                <div className="text-3xl font-bold text-accent">
                  {getOverallScore()}/100
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
                  {Math.abs(weatherData.metadata.latitude).toFixed(2)}°{weatherData.metadata.latitude >= 0 ? 'N' : 'S'},{" "}
                  {Math.abs(weatherData.metadata.longitude).toFixed(2)}°{weatherData.metadata.longitude >= 0 ? 'E' : 'W'}
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Elevation: {weatherData.metadata.height}m
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
                  {dayData.reduce((sum, day) => sum + day.nightHours.length, 0)}{" "}
                  total
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Across {dayData.length} days
                </p>
              </div>
            </div>
            )}

            {/* Unified Daily Forecasts */}
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-white mb-4">
                Daily Night Forecasts
              </h2>

              {dayData.length === 0 && metOfficeDayData.length === 0 ? (
                <div className="text-center py-12">
                  <CloudSnow className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                  <p className="text-slate-400">No nighttime data available</p>
                </div>
              ) : (
                <>
                  {/* Best night banner */}
                  {(() => {
                    const best = getBestDay(mergedDayData);
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
                    <WeeklyHeatmap mergedDays={mergedDayData} isSolar={false} />
                  </div>

                  {mergedDayData.map((mergedDay) => (
                    <UnifiedDayRow
                      key={mergedDay.date}
                      meteoblueDay={mergedDay.meteoblue}
                      metOfficeDay={mergedDay.metoffice}
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

                {solarData.length === 0 && metOfficeSolarData.length === 0 ? (
                  <div className="text-center py-12">
                    <CloudSnow className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                    <p className="text-slate-400">No solar data available</p>
                  </div>
                ) : (
                  <>
                    {/* Best solar day banner */}
                    {(() => {
                      const best = getBestDay(mergedSolarData);
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
                      <WeeklyHeatmap mergedDays={mergedSolarData} isSolar={true} />
                    </div>

                    {mergedSolarData.map((mergedDay) => (
                      <UnifiedDayRow
                        key={`solar-${mergedDay.date}`}
                        meteoblueDay={mergedDay.meteoblue}
                        metOfficeDay={mergedDay.metoffice}
                        isSolar={true}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {!weatherData && metOfficeDayData.length === 0 && !isLoading && (
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
