import { describe, it, expect } from "vitest";
import { createWeatherSummary } from "./weatherProcessor.js";
import { createCompleteForecast } from "./forecastProcessor.js";
import { METRICS, PROVIDERS } from "../services/forecastProviders.js";

describe("createWeatherSummary", () => {
  it("returns a summary with current_time, location, and null forecasts when called with no data", () => {
    const result = createWeatherSummary(null, null);
    expect(result).toHaveProperty("current_time");
    expect(result).toHaveProperty("location");
    expect(result.meteoblue_forecast).toBeNull();
    expect(result.met_office_forecast).toBeNull();
  });

  it("uses metadata location from Meteoblue when provided", () => {
    const meteoblueData = {
      metadata: { latitude: 51.5, longitude: -0.1 },
      data_1h: {
        time: [],
        isdaylight: [],
        totalcloudcover: [],
        precipitation_probability: [],
        temperature: [],
      },
    };
    const result = createWeatherSummary(meteoblueData, null);
    expect(result.location.latitude).toBe(51.5);
    expect(result.location.longitude).toBe(-0.1);
  });

  it("falls back to Met Office location when Meteoblue has no metadata", () => {
    const metOfficeData = { latitude: 53.0, longitude: -1.5, hourly: { time: [], is_day: [], cloud_cover: [], precipitation: [], temperature_2m: [] } };
    const result = createWeatherSummary(null, metOfficeData);
    expect(result.location.latitude).toBe(53.0);
    expect(result.location.longitude).toBe(-1.5);
  });

  it("falls back to default coordinates when both sources are null", () => {
    const result = createWeatherSummary(null, null);
    expect(typeof result.location.latitude).toBe("number");
    expect(typeof result.location.longitude).toBe("number");
  });

  it("produces an ISO 8601 current_time string", () => {
    const result = createWeatherSummary(null, null);
    expect(() => new Date(result.current_time)).not.toThrow();
    expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("compact additional-provider night summaries", () => {
  const times = ["2026-01-01T22:00:00.000Z", "2026-01-01T23:00:00.000Z", "2026-01-02T00:00:00.000Z"];
  const location = { lat: 51.5, lon: -.1, alt: 25 };
  const meteoblue = { metadata: { latitude: 51.5, longitude: -.1 }, data_1h: {
    time: times.map(time => time.slice(0, 16).replace("T", " ")),
    isdaylight: [0, 0, 0], totalcloudcover: [20, 20, 20],
    precipitation_probability: [10, 10, 10], temperature: [0, 0, 0],
  } };
  const metoffice = { latitude: 51.5, longitude: -.1, hourly: {
    time: times.map(time => time.slice(0, 16)), is_day: [0, 0, 0],
    cloud_cover: [20, 20, 20], precipitation: [.4, .4, .4], temperature_2m: [0, 0, 0],
  } };
  function forecast(overrides = {}) {
    return createCompleteForecast(PROVIDERS.map(provider => ({
      ...provider, location, timeZone: "Europe/London", status: "ok", error: null,
      samples: times.filter((_, index) => provider.id !== "timer" || index === 2).map(time => ({
        ...Object.fromEntries(Object.keys(METRICS).map(key => [key, null])), time, isDay: 0,
        cloudCover: provider.id === "timer" ? null : 20,
        precipitationProbability: provider.id === "gfs" ? 10 : null,
        precipitationAmount: provider.id === "timer" || provider.id === "metservice" ? null : .4,
        precipitationRate: provider.id === "metservice" ? 2 : null,
        ...(provider.id !== "timer" && provider.id !== "metservice" ? { precipitationInterval: { start: time, end: new Date(Date.parse(time) + 3600000).toISOString(), amount: .4 } } : {}),
      })), ...overrides[provider.id],
    })), location, new Date("2026-01-01T12:00:00Z"));
  }

  it("preserves the original records and appends only seven compact provider lists", () => {
    const result = createWeatherSummary(meteoblue, metoffice, forecast());
    const original = createWeatherSummary(meteoblue, metoffice);
    expect(result.meteoblue_forecast).toEqual(original.meteoblue_forecast);
    expect(result.met_office_forecast).toEqual(original.met_office_forecast);
    expect(result.meteoblue_forecast[0]).toEqual({
      date: "2026-01-01", day_name: "Thursday",
      night_duration: { hours: 3, start_time: "22:00", end_time: "00:00" },
      conditions: { astrophotography_score: 82, avg_cloud_cover: 20, avg_precipitation_percent: 10, quality: "Very Good" }, source: "Meteoblue",
    });
    expect(result.met_office_forecast[0].conditions).toEqual({ astrophotography_score: 84, avg_cloud_cover: 20, total_precipitation_mm: 1, quality: "Very Good" });
    expect(Object.keys(result)).toEqual(["current_time", "location", "meteoblue_forecast", "met_office_forecast", "ukv_forecast", "ecmwf_forecast", "gfs_forecast", "icon_forecast", "met_norway_forecast", "metservice_forecast", "seven_timer_forecast"]);
    for (const key of Object.keys(result).filter(key => key.endsWith("_forecast"))) {
      expect(result[key]).toHaveLength(1);
      expect(Object.keys(result[key][0])).toEqual(["date", "day_name", "night_duration", "conditions", "source"]);
    }
    expect(result.gfs_forecast[0].conditions).toEqual({ astrophotography_score: 82, avg_cloud_cover: 20, avg_precipitation_percent: 10, quality: "Very Good" });
    expect(result.ecmwf_forecast[0].conditions).toEqual({ astrophotography_score: 84, avg_cloud_cover: 20, total_precipitation_mm: 1, quality: "Very Good" });
    expect(result.ecmwf_forecast[0].night_duration).toEqual(original.met_office_forecast[0].night_duration);
  });

  it("does not manufacture a 7Timer percentage/score or an accumulated MetService rain amount", () => {
    const result = createWeatherSummary(null, null, forecast());
    expect(result.location).toEqual({ latitude: 51.5, longitude: -.1 });
    expect(result.seven_timer_forecast[0].conditions).toEqual({ astrophotography_score: null, avg_cloud_cover: null, total_precipitation_mm: null, quality: null });
    expect(result.seven_timer_forecast[0].night_duration.hours).toBe(3);
    expect(result.metservice_forecast[0].conditions.total_precipitation_mm).toBeNull();
    expect(result.metservice_forecast[0].conditions.astrophotography_score).toBe(84);
  });

  it("retains null unavailable sources and omits nights beyond a source's horizon", () => {
    const result = createWeatherSummary(null, null, forecast({ metservice: { status: "not_configured", samples: [] }, icon: { status: "error", samples: [] }, gfs: { samples: [] } }));
    expect(result.metservice_forecast).toBeNull();
    expect(result.icon_forecast).toBeNull();
    expect(result.gfs_forecast).toEqual([]);
    expect(result.ecmwf_forecast).toHaveLength(1);
  });

  it("keeps an hourly provider's duration and times limited to its own available night hours", () => {
    const records = forecast().providers.map(provider => ({ ...provider, samples: provider.id === "gfs" ? provider.hourly.slice(1) : provider.hourly }));
    const complete = createCompleteForecast(records, location, new Date("2026-01-01T12:00:00Z"));
    const result = createWeatherSummary(null, null, complete);
    expect(result.gfs_forecast[0].night_duration).toEqual({ hours: 2, start_time: "23:00", end_time: "00:00" });
    expect(result.ecmwf_forecast[0].night_duration).toEqual({ hours: 3, start_time: "22:00", end_time: "00:00" });
  });
});
