import { describe, it, expect } from "vitest";
import { createCompleteForecast, localParts, score } from "./forecastProcessor.js";
import { METRICS } from "../services/forecastProviders.js";

const location = { lat: 51.5, lon: -.1, alt: 25 };
const now = new Date("2026-01-01T12:00:00Z");
function sample(time, values = {}) {
  return { time, ...Object.fromEntries(Object.keys(METRICS).map(key => [key, null])), isDay: 0, ...values };
}
function provider(id, samples, overrides = {}) {
  return { id, name: id, location, status: "ok", timeZone: "Europe/London", samples, error: null, ...overrides };
}
const hours = ["2026-01-01T22:00:00.000Z", "2026-01-01T23:00:00.000Z", "2026-01-02T00:00:00.000Z"];

describe("complete forecast aggregation", () => {
  it("rejects overlapping hourly clock phases rather than counting the same hour twice", () => {
    const utc = [8, 9, 10].map(hour => `2026-01-01T${String(hour).padStart(2, "0")}:00:00.000Z`);
    const records = [provider("metoffice", utc.map(time => sample(time, { isDay: 1, cloudCover: 20 }))), provider("gfs", utc.map(time => sample(new Date(Date.parse(time) + 900000).toISOString(), { isDay: 1, cloudCover: 60 })), { timeZone: "Asia/Kathmandu" })];
    expect(() => createCompleteForecast(records, { lat: 27.7172, lon: 85.324, alt: 0 }, now)).toThrow("hourly clocks");
  });

  it("aligns added providers' session and reference rain with the declared forward intervals", () => {
    const times = [18, 19, 20, 21].map(hour => `2026-06-21T${hour}:00:00.000Z`);
    const samples = times.map((time, i) => sample(time, { isDay: i < 3 ? 1 : 0, cloudCover: 20, precipitationAmount: [1, 2, 4, 8][i], precipitationInterval: { start: new Date(Date.parse(time) - 3600000).toISOString(), end: time, amount: [1, 2, 4, 8][i] } }));
    const record = provider("gfs", samples);
    const f = createCompleteForecast([record], location, new Date("2026-06-21T12:00Z"));
    const day = f.daySessions[0];
    expect(day.sources.gfs.summary.precipitationAmount.value).toBe(14);
    expect(day.sources.gfs.summary.precipitationAmount.value).toBe(day.average.summary.precipitationAmount.value);
    expect(day.sources.gfs.hourly[0].precipitationInterval).toEqual({ start: times[0], end: times[1], amount: 2 });
    expect(f.providers[0].hourly[0].precipitationAmount).toBe(1);
    expect(f.nightSessions[0].sources.gfs.summary.precipitationAmount.value).toBeNull();
    expect(f.nightSessions[0].sources.gfs.hourly[0].precipitationInterval).toBeNull();
    expect(f.nightSessions[0].sources.gfs.referenceHours.before[0].precipitationAmount).toBe(2);
    const legacy = createCompleteForecast([record, { ...record, id: "metoffice", name: "Met Office" }], location, new Date("2026-06-21T12:00Z"));
    expect(legacy.daySessions[0].sources.metoffice.summary.precipitationAmount.value).toBe(7);
  });

  it("averages actual matching contributors, not provider summaries covering unequal hours", () => {
    const a = provider("meteoblue", hours.map(time => sample(time, { cloudCover: 10, temperature: 0, precipitationProbability: 0 })));
    const b = provider("gfs", [sample(hours[0], { cloudCover: 90, temperature: 10 })]);
    const result = createCompleteForecast([a, b], location, now);
    const night = result.nightSessions[0];
    expect(night.average.hourly.map(h => h.cloudCover.value)).toEqual([50, 10, 10]);
    expect(night.average.summary.cloudCover.value).toBeCloseTo(70 / 3);
    expect(night.average.hourly[1].cloudCover.sourceIds).toEqual(["meteoblue"]);
    expect(night.average.hourly[0].time).toBe(hours[0]);
    expect(night.average.hourly[0].localTime).toBe("22:00");
    expect(night.sources.meteoblue.summary.score.value).toBe(92);
    expect(night.sources.gfs.summary.score.value).toBe(28);
    expect(night.average.summary.score.value).toBe(81);
  });

  it("preserves legacy source score penalties and never treats millimetres as probability", () => {
    expect(score(50, 50)).toBe(50);
    expect(score(100, 0)).toBe(20);
    const records = [provider("meteoblue", [sample(hours[0], { cloudCover: 50, precipitationProbability: 50 })]), provider("metoffice", [sample(hours[0], { cloudCover: 50, precipitationAmount: 100 })])];
    const night = createCompleteForecast(records, location, now).nightSessions[0];
    expect(night.sources.meteoblue.summary.score.value).toBe(50);
    expect(night.sources.metoffice.summary.score.value).toBe(60);
    expect(night.average.summary.score.value).toBe(55);
  });

  it("keeps zero-valued measurements and reports each metric's actual source count", () => {
    const records = [provider("gfs", [sample(hours[0], { cloudCover: 0, temperature: 0 })]), provider("timer", [sample(hours[0], { temperature: 10, cloudBand: { range: [0, 6] } })])];
    const night = createCompleteForecast(records, { lat: 0, lon: 0, alt: 0 }, now).nightSessions[0];
    expect(night.average.summary.cloudCover.value).toBe(0);
    expect(night.average.summary.temperature.value).toBe(5);
    expect(night.average.summary.cloudCover.sourceIds).toEqual(["gfs"]);
    expect(night.average.summary.temperature.sourceIds).toEqual(["gfs", "timer"]);
    expect(night.atmosphere.samples).toHaveLength(1);
  });

  it("uses supplied day/night clocks to expose missing hours beyond a partial provider horizon", () => {
    const partial = provider("ukv", [sample(hours[0], { cloudCover: 10 })], { clock: hours.map(time => ({ time, isDay: 0 })) });
    const night = createCompleteForecast([partial], location, now).nightSessions[0];
    expect(night.expectedTimestamps).toEqual(hours);
    expect(night.average.summary.cloudCover.coverage).toBeCloseTo(1 / 3);
    expect(night.average.hourly[1].cloudCover).toMatchObject({ value: null, sourceIds: [], unavailableReason: "no_contributors" });
    expect(night.sources.ukv.summary.cloudCover.coverage).toBeCloseTo(1 / 3);
  });

  it("keeps legacy provider windows distinct without coverage over 100% or losing complete rain totals", () => {
    const base = provider("meteoblue", [sample(hours[0], { cloudCover: 10, precipitationProbability: 0 }), sample(hours[1], { cloudCover: 10, precipitationProbability: 0, isDay: 1 })]);
    const office = provider("metoffice", [sample(hours[0], { cloudCover: 20, precipitationAmount: 1 }), sample(hours[1], { cloudCover: 40, precipitationAmount: 2 })]);
    const added = provider("gfs", [sample(hours[0], { cloudCover: 50 }), sample(hours[1], { cloudCover: 90, isDay: 1 })]);
    const night = createCompleteForecast([base, office, added], location, now).nightSessions[0];
    expect(night.expectedTimestamps).toHaveLength(1);
    expect(night.sources.metoffice.expectedTimestamps).toHaveLength(2);
    expect(night.sources.metoffice.summary.cloudCover.coverage).toBe(1);
    expect(night.sources.metoffice.summary.precipitationAmount.value).toBe(3);
    for (const source of Object.values(night.sources)) for (const value of Object.values(source.summary)) if (value.coverage !== undefined) expect(value.coverage).toBeLessThanOrEqual(1);
  });

  it("excludes missing/categorical cloud values rather than inventing clear weather or midpoint scores", () => {
    const records = [provider("gfs", [sample(hours[0])]), provider("timer", [sample(hours[0], { temperature: 8, cloudBand: { range: [6, 19] } })])];
    const night = createCompleteForecast(records, location, now).nightSessions[0];
    expect(night.average.summary.cloudCover.value).toBeNull();
    expect(night.average.summary.score.value).toBeNull();
    expect(night.average.hourly[0].cloudCover.unavailableReason).toBe("no_contributors");
    expect(night.sources.timer).toBeUndefined();
    expect(night.atmosphere.samples[0].cloudBand.range).toEqual([6, 19]);
  });

  it("does not replace missing Meteoblue rain probability with zero or another source", () => {
    const records = [provider("meteoblue", [sample(hours[0], { cloudCover: 10 })]), provider("gfs", [sample(hours[0], { cloudCover: 50, precipitationProbability: 0 })])];
    const night = createCompleteForecast(records, location, now).nightSessions[0];
    expect(night.sources.meteoblue.summary.score.value).toBeNull();
    expect(night.average.hourly[0].score.sourceIds).toEqual(["gfs"]);
  });

  it("keeps failures explicit and distinguishes shorter horizons from outages", () => {
    const records = [provider("gfs", hours.map(time => sample(time, { cloudCover: 10 }))), provider("icon", [sample(hours[0], { cloudCover: 40 })]), provider("metnorway", [], { status: "error", error: { code: "timeout", message: "Timed out" } }), provider("meteoblue", [], { status: "not_configured" })];
    const result = createCompleteForecast(records, location, now);
    expect(result.providers.find(p => p.id === "metnorway").error.code).toBe("timeout");
    expect(result.nightSessions[0].sources.metnorway.unavailableReason).toBe("timeout");
    expect(result.nightSessions[0].sources.meteoblue).toBeUndefined();
    expect(result.nightSessions[0].average.hourly[2].cloudCover.sourceIds).toEqual(["gfs"]);
  });

  it("matches rain accumulation intervals and never repeats a six-hour amount", () => {
    const a = provider("gfs", hours.map((time, i) => sample(time, { cloudCover: 20, precipitationInterval: { start: time, end: new Date(Date.parse(time) + 3600000).toISOString(), amount: i + 1 } })));
    const b = provider("metnorway", [sample(hours[0], { cloudCover: 30, precipitationInterval: { start: hours[0], end: "2026-01-02T04:00:00.000Z", amount: 60 } })]);
    const night = createCompleteForecast([a, b], location, now).nightSessions[0];
    expect(night.average.hourly.map(h => h.precipitationAmount.value)).toEqual([1, 2, 3]);
    expect(night.average.summary.precipitationAmount.value).toBe(6);
    expect(night.average.summary.precipitationAmount.sourceIds).toEqual(["gfs"]);
  });

  it("reports incomplete session rain as unavailable instead of a complete total", () => {
    const samples = hours.map((time, i) => sample(time, { cloudCover: 10, precipitationInterval: i ? null : { start: time, end: hours[1], amount: .5 } }));
    const rain = createCompleteForecast([provider("gfs", samples)], location, now).nightSessions[0].average.summary.precipitationAmount;
    expect(rain.value).toBeNull();
    expect(rain.coverage).toBeCloseTo(1 / 3);
    expect(rain.unavailableReason).toBe("incomplete_session");
  });

  it("does not report zero rain when a legacy provider has no hours in a later session", () => {
    const old = provider("metoffice", [sample(hours[0], { cloudCover: 10, precipitationAmount: 0 })]);
    const extended = provider("gfs", [sample("2026-01-03T22:00:00.000Z", { cloudCover: 10 })]);
    const later = createCompleteForecast([old, extended], location, now).nightSessions[1].sources.metoffice;
    expect(later.unavailableReason).toBe("outside_forecast_range");
    expect(later.summary.precipitationAmount).toMatchObject({ value: null, sourceIds: [], coverage: 0, unavailableReason: "not_provided" });
  });

  it("includes day sessions and chooses best night/day from the same aggregate scores", () => {
    const samples = [sample(hours[0], { cloudCover: 80 }), sample("2026-01-02T12:00:00.000Z", { cloudCover: 10, isDay: 1 })];
    const result = createCompleteForecast([provider("gfs", samples)], location, now);
    expect(result.daySessions[0].average.summary.score.value).toBe(92);
    expect(result.summary.bestDay).toBe("day-2026-01-02");
    expect(result.summary.bestNight).toBe("night-2026-01-01");
    expect(result.providers[0].hourly).toHaveLength(2);
  });

  it("fails explicitly if timezone or day/night boundaries cannot be established", () => {
    expect(() => createCompleteForecast([provider("gfs", [], { timeZone: undefined })], location, now)).toThrow("IANA timezone");
    expect(() => createCompleteForecast([provider("timer", [sample(hours[0], { isDay: null })])], location, now)).toThrow("day/night flags");
  });

  it("uses observer timezone rather than server timezone at DST and date boundaries", () => {
    expect(localParts("2026-10-25T00:00:00Z", "Europe/London").time).toBe("01:00");
    expect(localParts("2026-10-25T01:00:00Z", "Europe/London").time).toBe("01:00");
    expect(localParts("2026-01-02T02:00:00Z", "America/Los_Angeles").date).toBe("2026-01-01");
    const old = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Auckland";
      expect(createCompleteForecast([provider("gfs", [sample(hours[0], { cloudCover: 10 })])], location, now).nightSessions[0].date).toBe("2026-01-01");
    } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
  });

  it("retains sparse native samples in half-hour-offset observing timezones without interpolation", () => {
    const base = provider("gfs", [sample("2026-01-01T18:30:00.000Z", { cloudCover: 10 })], { timeZone: "Asia/Kolkata" });
    const timer = provider("timer", [sample("2026-01-01T19:00:00.000Z", { isDay: null, temperature: 8 })], { timeZone: undefined });
    const night = createCompleteForecast([base, timer], location, now).nightSessions[0];
    expect(night.atmosphere.samples[0].localTime).toBe("00:30");
    expect(night.average.summary.temperature.value).toBeNull();
  });
});
