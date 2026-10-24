import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { bindHelpers, weatherService } from "./weatherService.js";

const location = { lat: 51.5, lon: -.1, alt: 25 };
const times = ["2026-01-01T22:00", "2026-01-01T23:00", "2026-01-02T00:00"];
const mb = { metadata: { utc_timeoffset: 0 }, data_1h: { time: times.map(t => t.replace("T", " ")), totalcloudcover: [10, 20, 30], precipitation_probability: [0, 0, 0], temperature: [0, 1, 2], windspeed: [2, 2, 2], isdaylight: [0, 0, 0] } };
const mo = { timezone: "GMT", hourly: { time: times, cloud_cover: [20, 30, 40], temperature_2m: [1, 2, 3], precipitation: [0, 0, 0], is_day: [0, 0, 0] } };
let values, redis, fetchMock;
function responseFor(url) {
  if (url.includes("my.meteoblue.com")) return new Response(JSON.stringify(mb));
  if (url.includes("api.open-meteo.com")) return new Response(JSON.stringify(url.includes("timeformat=unixtime") ? { ...mo, timezone: "Europe/London", hourly: { ...mo.hourly, time: times.map(t => Date.parse(t + "Z") / 1000) } } : mo));
  if (url.includes("api.met.no")) return new Response(JSON.stringify({ properties: { meta: {}, timeseries: times.map(time => ({ time: time + ":00Z", data: { instant: { details: { cloud_area_fraction: 30, air_temperature: 1 } }, next_1_hours: { details: { precipitation_amount: 0 } } } })) } }));
  if (url.includes("7timer.info")) return new Response(JSON.stringify({ init: "2026010118", dataseries: [{ timepoint: 6, temp2m: 0, cloudcover: 1, seeing: 2, transparency: 2 }] }));
  throw new Error("Unexpected test request");
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  values = new Map();
  redis = { get: vi.fn(async key => values.get(key) ?? null), set: vi.fn(async (key, value) => { values.set(key, structuredClone(value)); return "OK"; }), del: vi.fn(async key => values.delete(key)) };
  weatherService.initialized = false;
  weatherService._initPromise = null;
  weatherService._downloadPromise = null;
  weatherService.downloadStatus = { isDownloading: false };
  fetchMock = vi.fn(async url => responseFor(String(url)));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  bindHelpers(async () => "synthetic-key", async () => location, redis);
  await weatherService.ensureInitialized();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("independent provider refresh and compatibility", () => {
  it("preserves legacy raw cache shapes while adding complete independently cached records", async () => {
    expect(await weatherService.downloadWeatherData()).toEqual(mb);
    expect(values.get("weather:meteoblue_data")).toEqual(mb);
    expect(values.get("weather:metoffice_data")).toEqual(mo);
    const complete = await weatherService.getCompleteForecast();
    expect(complete.schemaVersion).toBe(2);
    expect(complete.providers).toHaveLength(9);
    expect(complete.providers.filter(p => p.id !== "metservice").every(p => p.status === "ok")).toBe(true);
    expect(complete.providers.find(p => p.id === "metservice").status).toBe("not_configured");
    expect(fetchMock).toHaveBeenCalledTimes(8);
    await weatherService.getCompleteForecast();
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("deduplicates concurrent first reads without duplicate provider charges", async () => {
    const [a, b] = await Promise.all([weatherService.getCompleteForecast(), weatherService.getCompleteForecast()]);
    expect(a.summary).toEqual(b.summary);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("supports existing installations without a Meteoblue key", async () => {
    bindHelpers(async () => null, async () => location, redis);
    const complete = await weatherService.getCompleteForecast();
    expect(complete.providers.find(p => p.id === "meteoblue").status).toBe("not_configured");
    expect(complete.nightSessions[0].sources.meteoblue).toBeUndefined();
    expect(complete.nightSessions[0].average.summary.cloudCover.sourceIds).not.toContain("meteoblue");
    expect(await weatherService.getMetOfficeData()).toEqual(mo);
  });

  it("retains successful providers, exposes the real failure and recovers on refresh", async () => {
    fetchMock.mockImplementation(async url => String(url).includes("api.met.no") ? new Response(JSON.stringify({ reason: "Quota exceeded" }), { status: 429 }) : responseFor(String(url)));
    const partial = await weatherService.getCompleteForecast();
    expect(partial.providers.find(p => p.id === "metnorway").error.httpStatus).toBe(429);
    expect(partial.nightSessions[0].average.summary.cloudCover.sourceIds).not.toContain("metnorway");
    expect(values.get("weather:provider:metnorway").samples).toEqual([]);
    fetchMock.mockImplementation(async url => responseFor(String(url)));
    await weatherService.downloadWeatherData();
    expect((await weatherService.getCompleteForecast()).providers.find(p => p.id === "metnorway").status).toBe("ok");
  });

  it.each([["meteoblue", "my.meteoblue.com"], ["metoffice", "ukmo_global_deterministic_10km"]])("retains typed HTTP causes for the existing %s provider", async (id, urlPart) => {
    fetchMock.mockImplementation(async url => String(url).includes(urlPart) ? new Response(JSON.stringify({ reason: "Quota exceeded" }), { status: 429 }) : responseFor(String(url)));
    const complete = await weatherService.getCompleteForecast();
    expect(complete.providers.find(p => p.id === id)).toMatchObject({ status: "error", error: { code: "upstream_error", httpStatus: 429, message: "HTTP 429: Quota exceeded" } });
    expect(complete.nightSessions[0].average.summary.cloudCover.sourceIds).not.toContain(id);
  });

  it("does not silently return previous weather after a required Redis write fails", async () => {
    redis.set.mockImplementation(async (key, value) => { if (key === "weather:provider:ecmwf") throw new Error("Redis write denied"); values.set(key, value); });
    await expect(weatherService.getCompleteForecast()).rejects.toThrow("Redis write denied");
    expect(weatherService.downloadStatus.isDownloading).toBe(false);
    expect(weatherService.downloadStatus.error).toBe("Redis write denied");
  });

  it("does not reuse an old provider record after a failed refresh, and retries recovery", async () => {
    await weatherService.downloadWeatherData();
    redis.set.mockImplementation(async (key, value) => { if (key === "weather:provider:ecmwf") throw new Error("Redis write denied"); values.set(key, structuredClone(value)); });
    await expect(weatherService.downloadWeatherData()).rejects.toThrow("Redis write denied");
    await expect(weatherService.getCompleteForecast()).rejects.toThrow("Redis write denied");
    weatherService.initialized = false;
    weatherService._initPromise = null;
    weatherService.downloadStatus = { isDownloading: false };
    await weatherService._startInit();
    await expect(weatherService.getCompleteForecast()).rejects.toThrow("Redis write denied");
    redis.set.mockImplementation(async (key, value) => { values.set(key, structuredClone(value)); return "OK"; });
    expect((await weatherService.getCompleteForecast()).providers.find(provider => provider.id === "ecmwf").status).toBe("ok");
    expect(weatherService.downloadStatus.error).toBeUndefined();
  });

  it("keeps a failed refresh in flight until the other provider writes finish", async () => {
    let release, failed;
    const slow = new Promise(resolve => { release = resolve; });
    const failedWrite = new Promise(resolve => { failed = resolve; });
    fetchMock.mockImplementation(async url => String(url).includes("api.met.no") ? slow : responseFor(String(url)));
    redis.set.mockImplementation(async (key, value) => { if (key === "weather:provider:ecmwf") { failed(); throw new Error("Redis write denied"); } values.set(key, structuredClone(value)); });
    let settled = false;
    const download = weatherService.downloadWeatherData().catch(error => { settled = true; return error; });
    await failedWrite;
    await vi.advanceTimersByTimeAsync(0);
    const endedBeforeOtherProviders = settled;
    release(responseFor("https://api.met.no"));
    const error = await download;
    await vi.advanceTimersByTimeAsync(0);
    expect(error.message).toBe("Redis write denied");
    expect(endedBeforeOtherProviders).toBe(false);
    expect(values.get("weather:provider:metnorway").status).toBe("ok");
  });

  it("never serves another location's cached complete forecast", async () => {
    await weatherService.downloadWeatherData();
    bindHelpers(async () => "synthetic-key", async () => ({ lat: 0, lon: 0, alt: 0 }), redis);
    await expect(weatherService.getCompleteForecast()).rejects.toMatchObject({ code: "location_changed", message: "Location changed; refresh forecasts" });
  });
});
