// Provider adapters keep upstream fields and native timestamps distinct.
export const PROVIDERS = [
  { id: "meteoblue", name: "Meteoblue", model: "meteoblue", optional: true },
  { id: "metoffice", name: "Met Office · Global 10 km", model: "ukmo_global_deterministic_10km" },
  { id: "ukv", name: "Met Office · UKV 2 km", model: "ukmo_uk_deterministic_2km", region: "UK and Ireland" },
  { id: "ecmwf", name: "ECMWF", model: "ecmwf_ifs" },
  { id: "gfs", name: "GFS", model: "gfs_global" },
  { id: "icon", name: "ICON Global", model: "icon_global" },
  { id: "metnorway", name: "MET Norway", model: "Locationforecast 2.0" },
  { id: "metservice", name: "MetService", model: "Point Forecast automatic model selection", optional: true },
  { id: "timer", name: "7Timer · Atmosphere", model: "ASTRO", nativeStepMinutes: 180 },
];

export const METRICS = {
  cloudCover: "%", temperature: "°C", precipitationAmount: "mm",
  precipitationProbability: "%", windSpeed: "km/h", relativeHumidity: "%",
  skyBrightness: "lux", moonlight: "%", precipitationRate: "mm/h",
};

export const numeric = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;

export class ProviderError extends Error {
  constructor(message, code = "upstream_error", status = null) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

function redact(message, secret) {
  let text = String(message).replace(/https?:\/\/\S+/g, "[upstream URL]");
  if (secret) text = text.split(secret).join("[redacted]");
  return text.replace(/(apikey|api[_-]?key|token|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 300);
}

export async function requestProvider(url, { headers = {}, secret, fetchImpl = fetch, method = "GET", body } = {}) {
  let response, text;
  try {
    response = await fetchImpl(url, { headers, method, body, signal: AbortSignal.timeout(20000) });
    if (response.status === 304) return { notModified: true, response };
    text = await response.text();
  } catch (error) {
    const timeout = error.name === "TimeoutError" || error.name === "AbortError";
    throw new ProviderError(timeout ? "Upstream request timed out after 20 seconds" : redact(error.message, secret), timeout ? "timeout" : "connection_error");
  }
  let data;
  try { data = JSON.parse(text); } catch {
    throw new ProviderError(`Upstream HTTP ${response.status}: response is not valid JSON`, "invalid_response", response.status);
  }
  if (!response.ok) {
    const reason = data?.reason ?? data?.error?.message ?? data?.error ?? data?.message ?? response.statusText;
    const outside = response.status === 400 && reason === "No data is available for this location";
    throw new ProviderError(`HTTP ${response.status}: ${redact(typeof reason === "string" ? reason : JSON.stringify(reason), secret)}`, outside ? "outside_geographic_coverage" : "upstream_error", response.status);
  }
  return { data, response };
}

function sample(time, values, additional = {}) {
  if (!Number.isFinite(Date.parse(time))) throw new ProviderError("Invalid forecast timestamp", "invalid_response");
  return { time: new Date(time).toISOString(), ...Object.fromEntries(Object.keys(METRICS).map(key => [key, numeric(values[key])])), isDay: values.isDay === 0 || values.isDay === 1 ? values.isDay : null, ...additional };
}

function assertSamples(samples) {
  if (!samples.length) throw new ProviderError("Response contains no forecast samples", "invalid_response");
  if (new Set(samples.map(s => s.time)).size !== samples.length) throw new ProviderError("Response contains duplicate forecast timestamps", "invalid_response");
  return samples;
}

export function normalizeMeteoblue(data) {
  const hourly = data?.data_1h;
  if (!Array.isArray(hourly?.time)) throw new ProviderError("Meteoblue response has no data_1h.time", "invalid_response");
  const offset = numeric(data.metadata?.utc_timeoffset);
  if (offset === null) throw new ProviderError("Meteoblue response has no UTC offset", "invalid_response");
  const samples = hourly.time.map((time, i) => {
    const epoch = Date.parse(time.replace(" ", "T") + "Z") - offset * 3600000;
    return sample(new Date(epoch).toISOString(), {
      cloudCover: hourly.totalcloudcover?.[i], temperature: hourly.temperature?.[i],
      precipitationProbability: hourly.precipitation_probability?.[i],
      windSpeed: numeric(hourly.windspeed?.[i]) === null ? null : hourly.windspeed[i] * 3.6,
      relativeHumidity: hourly.relativehumidity?.[i], skyBrightness: hourly.nightskybrightness_actual?.[i],
      moonlight: hourly.moonlight_actual?.[i], isDay: hourly.isdaylight?.[i],
    }, { fields: Object.fromEntries(Object.entries(hourly).filter(([, v]) => Array.isArray(v)).map(([key, v]) => [key, v[i] ?? null])) });
  });
  return { samples: assertSamples(samples), clock: samples.map(({ time, isDay }) => ({ time, isDay })), forecastRun: data.metadata?.modelrun_utc ?? null, units: data.units, outputStepMinutes: 60, nativeStepMinutes: null };
}

export function normalizeOpenMeteo(data) {
  const hourly = data?.hourly;
  if (!Array.isArray(hourly?.time) || !Array.isArray(hourly.cloud_cover)) throw new ProviderError("Open-Meteo response has no hourly cloud forecast", "invalid_response");
  const samples = hourly.time.map((time, i) => {
    const iso = typeof time === "number" ? new Date(time * 1000).toISOString() : `${time}Z`;
    return sample(iso, {
      cloudCover: hourly.cloud_cover[i], temperature: hourly.temperature_2m?.[i],
      precipitationAmount: hourly.precipitation?.[i], precipitationProbability: hourly.precipitation_probability?.[i],
      windSpeed: hourly.wind_speed_10m?.[i], relativeHumidity: hourly.relative_humidity_2m?.[i], isDay: hourly.is_day?.[i],
    }, {
      precipitationInterval: numeric(hourly.precipitation?.[i]) === null ? null : { start: new Date(Date.parse(iso) - 3600000).toISOString(), end: iso, amount: hourly.precipitation[i] },
      fields: Object.fromEntries(Object.entries(hourly).filter(([, v]) => Array.isArray(v)).map(([key, v]) => [key, v[i] ?? null])),
    });
  }).filter(s => Object.keys(METRICS).some(key => s[key] !== null));
  const clock = hourly.time.map((time, i) => ({ time: typeof time === "number" ? new Date(time * 1000).toISOString() : new Date(`${time}Z`).toISOString(), isDay: hourly.is_day?.[i] ?? null }));
  return { samples: assertSamples(samples), clock, timeZone: data.timezone, forecastRun: null, units: data.hourly_units, outputStepMinutes: 60, nativeStepMinutes: null };
}

export function normalizeMetNorway(data) {
  const timeseries = data?.properties?.timeseries;
  if (!Array.isArray(timeseries)) throw new ProviderError("MET Norway response has no timeseries", "invalid_response");
  const samples = timeseries.map(entry => {
    const instant = entry.data?.instant?.details;
    if (!instant) throw new ProviderError("MET Norway sample has no instant details", "invalid_response");
    // Rain is a forward accumulation, unlike Open-Meteo's preceding-hour amount.
    const span = entry.data.next_1_hours ? 1 : entry.data.next_6_hours ? 6 : null;
    const amount = span === null ? null : numeric(entry.data[`next_${span}_hours`]?.details?.precipitation_amount);
    return sample(entry.time, {
      cloudCover: instant.cloud_area_fraction, temperature: instant.air_temperature,
      precipitationAmount: span === 1 ? amount : null,
      windSpeed: numeric(instant.wind_speed) === null ? null : instant.wind_speed * 3.6,
      relativeHumidity: instant.relative_humidity,
    }, {
      precipitationInterval: amount === null ? null : { start: new Date(entry.time).toISOString(), end: new Date(Date.parse(entry.time) + span * 3600000).toISOString(), amount },
      fields: entry.data,
    });
  });
  return { samples: assertSamples(samples), forecastRun: data.properties.meta?.updated_at ?? null, units: data.properties.meta?.units, outputStepMinutes: null, nativeStepMinutes: null };
}

const CLOUD_BANDS = [[0, 6], [6, 19], [19, 31], [31, 44], [44, 56], [56, 69], [69, 81], [81, 94], [94, 100]];
const SEEING_BANDS = [[null, .5], [.5, .75], [.75, 1], [1, 1.25], [1.25, 1.5], [1.5, 2], [2, 2.5], [2.5, null]];
const TRANSPARENCY_BANDS = [[null, .3], [.3, .4], [.4, .5], [.5, .6], [.6, .7], [.7, .85], [.85, 1], [1, null]];
function band(code, bands, unit) {
  return Number.isInteger(code) && bands[code - 1] ? { category: code, range: bands[code - 1], unit } : null;
}

export function normalizeSevenTimer(data) {
  if (!/^\d{10,12}$/.test(String(data?.init)) || !Array.isArray(data.dataseries)) throw new ProviderError("7Timer response has no valid init/dataseries", "invalid_response");
  const init = String(data.init);
  const start = Date.UTC(+init.slice(0, 4), +init.slice(4, 6) - 1, +init.slice(6, 8), +init.slice(8, 10));
  const samples = data.dataseries.map(entry => {
    if (!Number.isFinite(entry.timepoint)) throw new ProviderError("7Timer sample has no timepoint", "invalid_response");
    return sample(new Date(start + entry.timepoint * 3600000).toISOString(), { temperature: entry.temp2m }, {
      cloudBand: band(entry.cloudcover, CLOUD_BANDS, "%"), seeing: band(entry.seeing, SEEING_BANDS, "arcsec"),
      transparency: band(entry.transparency, TRANSPARENCY_BANDS, "mag/airmass"), fields: entry,
    });
  });
  return { samples: assertSamples(samples), forecastRun: new Date(start).toISOString(), units: { temperature: "°C", seeing: "arcsec", transparency: "mag/airmass" }, outputStepMinutes: 180, nativeStepMinutes: 180 };
}

export function normalizeMetService(data) {
  const times = data?.dimensions?.time?.data;
  if (!Array.isArray(times) || data.dimensions?.point?.data?.length !== 1 || !data.variables?.["cloud.cover"]) throw new ProviderError("MetService response has no single-point cloud time series", "invalid_response");
  const unitMap = { "cloud.cover": "percent", "air.temperature.at-2m": "degreeK", "precipitation.rate": "millimeterPerHour", "wind.speed.at-10m": "meterPerSecond", "air.humidity.at-2m": "percent" };
  for (const [name, variable] of Object.entries(data.variables)) {
    if (unitMap[name] && variable.units !== unitMap[name]) throw new ProviderError(`Unexpected MetService units for ${name}: ${variable.units}`, "invalid_response");
    if (!Array.isArray(variable.data) || variable.data.length !== times.length || !Array.isArray(variable.noData) || variable.noData.length !== times.length) throw new ProviderError(`Invalid MetService data/noData shape for ${name}`, "invalid_response");
  }
  const value = (key, i) => data.variables[key]?.noData?.[i] === 0 ? numeric(data.variables[key].data[i]) : null;
  const samples = times.map((time, i) => {
    const kelvin = value("air.temperature.at-2m", i);
    const wind = value("wind.speed.at-10m", i);
    return sample(time, {
      cloudCover: value("cloud.cover", i), temperature: kelvin === null ? null : kelvin - 273.15,
      windSpeed: wind === null ? null : wind * 3.6, relativeHumidity: value("air.humidity.at-2m", i),
      // The contract supplies a rate, not an interval accumulation. Do not
      // manufacture hourly/session millimetre totals from instantaneous rates.
      precipitationRate: value("precipitation.rate", i),
    }, { fields: Object.fromEntries(Object.entries(data.variables).map(([name, variable]) => [name, { value: value(name, i), unit: variable.units, noData: variable.noData[i], noDataReason: Object.entries(data.noDataReasons ?? {}).find(([, code]) => code === variable.noData[i])?.[0] ?? null }])) });
  });
  return { samples: assertSamples(samples), forecastRun: null, units: Object.fromEntries(Object.entries(data.variables).map(([name, variable]) => [name, variable.units])), outputStepMinutes: 60, nativeStepMinutes: null };
}

export async function fetchAdditionalProvider(provider, location, previous, fetchImpl = fetch, apiKey) {
  let url;
  const headers = {};
  if (["ukv", "ecmwf", "gfs", "icon"].includes(provider.id)) {
    const hourly = "precipitation,cloud_cover,temperature_2m,is_day,wind_speed_10m,relative_humidity_2m" + (provider.id === "gfs" ? ",precipitation_probability" : "");
    const query = new URLSearchParams({ latitude: String(location.lat), longitude: String(location.lon), hourly, models: provider.model, timezone: "auto", timeformat: "unixtime" });
    url = `https://api.open-meteo.com/v1/forecast?${query}`;
  } else if (provider.id === "metnorway") {
    // https://api.met.no/doc/locationforecast/HowTO requires both cache headers.
    if (previous?.status === "ok" && previous.cache?.expires && Date.parse(previous.cache.expires) > Date.now()) return previous;
    headers["User-Agent"] = "APD (+https://github.com/giancarloerra/APD)";
    if (previous?.cache?.lastModified && previous.status === "ok") headers["If-Modified-Since"] = previous.cache.lastModified;
    url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${location.lat.toFixed(4)}&lon=${location.lon.toFixed(4)}&altitude=${Math.round(location.alt ?? 0)}`;
  } else if (provider.id === "timer") {
    url = `https://www.7timer.info/bin/api.pl?lon=${location.lon}&lat=${location.lat}&product=astro&output=json`;
  } else if (provider.id === "metservice") {
    if (!apiKey) throw new ProviderError("MetService API key not configured", "not_configured");
    const start = new Date();
    start.setUTCMinutes(0, 0, 0);
    const body = JSON.stringify({ points: [{ lat: location.lat, lon: location.lon }], variables: ["cloud.cover", "air.temperature.at-2m", "precipitation.rate", "wind.speed.at-10m", "air.humidity.at-2m"], time: { from: start.toISOString(), interval: "1h", repeat: 167 } });
    const result = await requestProvider("https://forecast-v2.metoceanapi.com/point/time", { method: "POST", body, headers: { "Content-Type": "application/json", "x-api-key": apiKey }, secret: apiKey, fetchImpl });
    return { ...provider, ...normalizeMetService(result.data), location, status: "ok", fetchedAt: new Date().toISOString(), error: null };
  } else throw new ProviderError("Unknown additional provider", "configuration_error");
  const result = await requestProvider(url, { headers, fetchImpl });
  const cache = { expires: result.response.headers.get("expires"), lastModified: result.response.headers.get("last-modified") ?? (result.notModified ? previous?.cache?.lastModified : null) };
  if (result.notModified) {
    if (!previous?.samples?.length) throw new ProviderError("304 without a cached forecast", "invalid_response", 304);
    return { ...previous, cache, checkedAt: new Date().toISOString() };
  }
  const normalized = provider.id === "timer" ? normalizeSevenTimer(result.data) : provider.id === "metnorway" ? normalizeMetNorway(result.data) : normalizeOpenMeteo(result.data);
  return { ...provider, ...normalized, location, status: "ok", fetchedAt: new Date().toISOString(), cache, error: null };
}
