import { describe, it, expect, vi } from "vitest";
import { PROVIDERS, METRICS, normalizeMeteoblue, normalizeOpenMeteo, normalizeMetNorway, normalizeSevenTimer, normalizeMetService, requestProvider, fetchAdditionalProvider } from "./forecastProviders.js";

describe("provider adapters", () => {
  it.each([["Asia/Kathmandu", 15], ["Asia/Kolkata", 30]])("fetches real UTC-aligned model values while retaining %s", async (timeZone, minutes) => {
    const times = [8, 9, 10].map(hour => Date.parse(`2026-01-01T${String(hour).padStart(2, "0")}:00:00Z`) / 1000);
    const body = (utc = false) => ({ timezone: utc ? "GMT" : timeZone, hourly: { time: (utc ? [...times, times.at(-1) + 3600] : times).map(t => t + (utc ? 0 : minutes * 60)), cloud_cover: utc ? [20, 30, 40, 50] : [80, 30, 40], temperature_2m: utc ? [8, 9, 10, 11] : [8, 9, 10], precipitation: utc ? [0, 0, 0, 0] : [0, 0, 0], is_day: utc ? [1, 1, 1, 1] : [1, 1, 1] } });
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body()))).mockResolvedValueOnce(new Response(JSON.stringify(body(true))));
    const loc = timeZone === "Asia/Kolkata" ? { lat: 19.076, lon: 72.8777, alt: 0 } : { lat: 27.7172, lon: 85.324, alt: 0 };
    const result = await fetchAdditionalProvider(PROVIDERS.find(p => p.id === "gfs"), loc, null, fetchImpl);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("timezone"))).toEqual(["auto", "GMT"]);
    const aligned = new URL(String(fetchImpl.mock.calls[1][0]));
    expect(aligned.searchParams.get("start_hour")).toBe("2026-01-01T08:00");
    expect(aligned.searchParams.get("end_hour")).toBe("2026-01-01T11:00");
    expect(result.timeZone).toBe(timeZone);
    expect(result.samples[0].time).toBe("2026-01-01T08:00:00.000Z");
    expect(result.samples[0].cloudCover).toBe(20);
  });

  it("keeps one request when the model's native UTC clock is already aligned", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ timezone: "Europe/London", hourly: { time: [1767304800], cloud_cover: [10], is_day: [0] } })));
    expect((await fetchAdditionalProvider(PROVIDERS.find(p => p.id === "gfs"), { lat: 51.5, lon: -.1, alt: 25 }, null, fetchImpl)).samples[0].cloudCover).toBe(10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not substitute an unaligned series when its UTC request fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ timezone: "Asia/Kathmandu", hourly: { time: [1767255300], cloud_cover: [80], is_day: [1] } }))).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 }));
    await expect(fetchAdditionalProvider(PROVIDERS.find(p => p.id === "gfs"), { lat: 27.7172, lon: 85.324, alt: 0 }, null, fetchImpl)).rejects.toMatchObject({ code: "upstream_error", status: 503, timeZone: "Asia/Kathmandu" });
  });

  it("preserves Meteoblue probability and sky fields, with explicit UTC and wind units", () => {
    const data = { metadata: { utc_timeoffset: 1 }, units: {}, data_1h: { time: ["2026-01-01 22:00"], totalcloudcover: [0], temperature: [0], precipitation_probability: [5], windspeed: [2], moonlight_actual: [.01], nightskybrightness_actual: [.004], isdaylight: [0] } };
    const sample = normalizeMeteoblue(data).samples[0];
    expect(sample.time).toBe("2026-01-01T21:00:00.000Z");
    expect(sample.windSpeed).toBe(7.2);
    expect(sample.precipitationProbability).toBe(5);
    expect(sample.moonlight).toBe(.01);
    expect(METRICS.moonlight).toBe("%");
    expect(METRICS.skyBrightness).toBe("lux");
    expect(sample.temperature).toBe(0);
    // Meteoblue uses the request-time offset throughout the forecast, including
    // across DST: https://my.meteoblue.com/packages/openapi.json
    const transition = normalizeMeteoblue({ metadata: { utc_timeoffset: 1 }, data_1h: { time: ["2026-10-25 01:00", "2026-10-25 02:00"] } });
    expect(transition.samples.map(hour => hour.time)).toEqual(["2026-10-25T00:00:00.000Z", "2026-10-25T01:00:00.000Z"]);
  });

  it("never converts Open-Meteo nulls to zeros and trims all-null horizon padding", () => {
    const data = { timezone: "UTC", hourly: { time: [1767304800, 1767308400], cloud_cover: [10, null], temperature_2m: [0, null], precipitation: [null, null], is_day: [0, 0] } };
    const result = normalizeOpenMeteo(data);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].temperature).toBe(0);
    expect(result.samples[0].precipitationAmount).toBeNull();
    expect(result.nativeStepMinutes).toBeNull();
  });

  it("labels Open-Meteo rain as preceding-hour and Norway rain as forward accumulation", () => {
    const time = "2026-01-01T22:00:00.000Z";
    const open = normalizeOpenMeteo({ hourly: { time: [time.slice(0, 16)], cloud_cover: [10], precipitation: [1] } }).samples[0];
    expect(open.precipitationInterval.start).toBe("2026-01-01T21:00:00.000Z");
    const norway = normalizeMetNorway({ properties: { meta: {}, timeseries: [{ time, data: { instant: { details: { cloud_area_fraction: 10, wind_speed: 2 } }, next_6_hours: { details: { precipitation_amount: 6 } } } }] } }).samples[0];
    expect(norway.precipitationInterval.end).toBe("2026-01-02T04:00:00.000Z");
    expect(norway.precipitationAmount).toBeNull();
    expect(norway.windSpeed).toBe(7.2);
    const oneHour = normalizeMetNorway({ properties: { meta: {}, timeseries: [{ time: "2026-01-01T22:00:00Z", data: { instant: { details: { cloud_area_fraction: 10 } }, next_1_hours: { details: { precipitation_amount: 1 } } } }] } }).samples[0];
    expect(oneHour.precipitationInterval).toEqual({ start: oneHour.time, end: "2026-01-01T23:00:00.000Z", amount: 1 });
  });

  it("keeps 7Timer categories/ranges and three-hour samples, with no invented cloud percentage", () => {
    const data = { init: "2026010118", dataseries: [3, 6].map(timepoint => ({ timepoint, cloudcover: 3, seeing: 8, transparency: 2, temp2m: 0, wind10m: { speed: 2 } })) };
    const result = normalizeSevenTimer(data);
    expect(result.nativeStepMinutes).toBe(180);
    expect(result.samples[0].time).toBe("2026-01-01T21:00:00.000Z");
    expect(result.samples[0].cloudCover).toBeNull();
    expect(result.samples[0].cloudBand.range).toEqual([19, 31]);
    expect(result.samples[0].seeing.range).toEqual([2.5, null]);
    expect(result.samples[0].fields.wind10m.speed).toBe(2);
  });

  it("rejects malformed schemas rather than returning an empty successful forecast", () => {
    expect(() => normalizeMeteoblue({})).toThrow("data_1h.time");
    expect(() => normalizeOpenMeteo({})).toThrow("hourly cloud");
    expect(() => normalizeMetNorway({})).toThrow("timeseries");
    expect(() => normalizeSevenTimer({})).toThrow("init/dataseries");
    expect(() => normalizeMetService({})).toThrow("single-point cloud");
    expect(() => normalizeOpenMeteo({ hourly: { time: [], cloud_cover: [] } })).toThrow("no forecast samples");
  });

  it("normalizes MetService's documented units, masks and rain rates without fabricating accumulations", () => {
    const variable = (units, values, noData = values.map(() => 0)) => ({ units, data: values, noData, dimensions: ["time", "point"] });
    const data = { dimensions: { time: { data: ["2026-01-01T22:00:00Z", "2026-01-01T23:00:00Z"] }, point: { data: [{ lat: 51.5, lon: -.1 }] } }, noDataReasons: { GOOD: 0, GAP: 7 }, variables: { "cloud.cover": variable("percent", [10, 90], [0, 7]), "air.temperature.at-2m": variable("degreeK", [273.15, 280.15]), "precipitation.rate": variable("millimeterPerHour", [1.5, 0]), "wind.speed.at-10m": variable("meterPerSecond", [2, 0]) } };
    const result = normalizeMetService(data);
    expect(result.samples[0].temperature).toBe(0);
    expect(result.samples[0].windSpeed).toBe(7.2);
    expect(result.samples[0].precipitationRate).toBe(1.5);
    expect(result.samples[0].precipitationAmount).toBeNull();
    expect(result.samples[1].cloudCover).toBeNull();
    expect(result.samples[1].fields["cloud.cover"].noDataReason).toBe("GAP");
    data.variables["cloud.cover"].units = "fraction";
    expect(() => normalizeMetService(data)).toThrow("Unexpected MetService units");
  });

  it("keeps actionable HTTP causes but redacts keys and upstream request URLs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Invalid apikey=secret-token at https://upstream.invalid?apikey=secret-token" }), { status: 429 }));
    await expect(requestProvider("https://upstream.invalid", { secret: "secret-token", fetchImpl })).rejects.toMatchObject({ status: 429, code: "upstream_error" });
    try { await requestProvider("https://upstream.invalid", { secret: "secret-token", fetchImpl }); } catch (error) {
      expect(error.message).not.toContain("secret-token");
      expect(error.message).not.toContain("https://");
    }
  });

  it("distinguishes outside-coverage responses, timeouts and invalid JSON", async () => {
    await expect(requestProvider("https://example.invalid", { fetchImpl: async () => new Response("Bad gateway", { status: 502, statusText: "Bad Gateway" }) })).rejects.toMatchObject({ code: "upstream_error", status: 502, message: "HTTP 502: Bad Gateway" });
    await expect(requestProvider("https://example.invalid", { fetchImpl: async () => new Response(JSON.stringify({ reason: "No data is available for this location" }), { status: 400 }) })).rejects.toMatchObject({ code: "outside_geographic_coverage" });
    await expect(requestProvider("https://example.invalid", { fetchImpl: async () => { throw new DOMException("timeout", "TimeoutError"); } })).rejects.toMatchObject({ code: "timeout" });
    await expect(requestProvider("https://example.invalid", { fetchImpl: async () => ({ status: 200, text: async () => { throw new DOMException("timeout", "TimeoutError"); } }) })).rejects.toMatchObject({ code: "timeout" });
    await expect(requestProvider("https://example.invalid", { fetchImpl: async () => new Response("null", { status: 500, statusText: "Server failure" }) })).rejects.toMatchObject({ code: "upstream_error", status: 500, message: "HTTP 500: Server failure" });
    await expect(requestProvider("https://example.invalid", { fetchImpl: async () => new Response("not JSON") })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("honours Norway's Expires and Last-Modified/304 caching contract without hiding errors", async () => {
    const p = PROVIDERS.find(p => p.id === "metnorway");
    const expires = new Date(Date.now() + 3600000).toUTCString();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { Expires: expires } }));
    const loc = { lat: 51.5, lon: -.1, alt: 25 };
    const cached = { status: "ok", samples: [{ time: "2026-01-01T22:00:00.000Z" }], cache: { expires, lastModified: "Thu, 01 Jan 2026 00:00:00 GMT" } };
    expect(await fetchAdditionalProvider(p, loc, cached, fetchImpl)).toBe(cached);
    expect(fetchImpl).not.toHaveBeenCalled();
    const result = await fetchAdditionalProvider(p, loc, { ...cached, cache: { ...cached.cache, expires: new Date(Date.now() - 3600000).toUTCString() } }, fetchImpl);
    expect(result.samples).toEqual(cached.samples);
    expect(result.cache.lastModified).toBe(cached.cache.lastModified);
    expect(fetchImpl.mock.calls[0][1].headers["If-Modified-Since"]).toBe(cached.cache.lastModified);
    expect(fetchImpl.mock.calls[0][1].headers["User-Agent"]).toContain("github.com/giancarloerra/APD");
    await expect(fetchAdditionalProvider(p, loc, { ...cached, cache: {} }, async () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }))).rejects.toMatchObject({ status: 403 });
  });
});
