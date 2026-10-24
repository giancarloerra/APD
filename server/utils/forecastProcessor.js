import { METRICS, numeric, ProviderError } from "../services/forecastProviders.js";

const HOUR = 3600000;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const iso = value => new Date(value).toISOString();

export function score(cloud, probability = 0) {
  if (numeric(cloud) === null || numeric(probability) === null) return null;
  return Math.round(Math.max(0, 100 - (cloud / 100) * 80 - (probability / 100) * 20));
}

export function localParts(time, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(time));
  const get = type => parts.find(part => part.type === type).value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: +get("hour"), time: `${get("hour")}:${get("minute")}` };
}

function previousDate(date) {
  return iso(Date.parse(`${date}T12:00:00Z`) - 86400000).slice(0, 10);
}

function sessionDate(parts, kind) {
  // Preserve APD's existing 00:00–06:00 assignment to the previous night.
  return kind === "night" && parts.hour <= 6 ? previousDate(parts.date) : parts.date;
}

function metric(value, unit, sourceIds, expected, covered, reason) {
  return { value, unit, sourceIds: [...new Set(sourceIds)], sampleCount: covered, expectedSampleCount: expected, coverage: expected ? covered / expected : 0, unavailableReason: reason ?? (value === null ? "not_provided" : null) };
}

function withLocal(sample, timeZone) {
  const parts = localParts(sample.time, timeZone);
  return { ...sample, localDate: parts.date, localTime: parts.time };
}

function hourlyScore(sample, source) {
  const probability = source.id === "meteoblue" ? sample.precipitationProbability : sample.precipitationProbability ?? 0;
  return score(sample.cloudCover, probability);
}

function sourceSummary(source, hours, expected) {
  const result = {};
  for (const [key, unit] of Object.entries(METRICS)) {
    const values = hours.map(h => h[key]).filter(value => value !== null);
    const value = key === "precipitationAmount" ? (values.length && values.length === expected ? values.reduce((a, b) => a + b, 0) : null) : mean(values);
    result[key] = metric(value, unit, values.length ? [source.id] : [], expected, values.length, key === "precipitationAmount" && values.length && values.length !== expected ? "incomplete_session" : undefined);
  }
  const cloud = result.cloudCover.value;
  const probability = result.precipitationProbability.value;
  const usesProbability = source.id === "meteoblue" || probability !== null;
  result.score = {
    value: source.id === "timer" ? null : score(cloud, usesProbability ? probability : 0), outOf: 100,
    basis: source.id === "timer" ? "categorical_cloud_not_scored" : usesProbability ? "cloud_and_precipitation_probability" : "cloud_only",
    sourceIds: cloud === null ? [] : [source.id],
  };
  return result;
}

function amountAt(source, start, end) {
  const interval = source.samples.find(sample => sample.precipitationInterval?.start === start && sample.precipitationInterval.end === end)?.precipitationInterval;
  return interval ? interval.amount : null;
}

function aggregateHour(time, sources, timeZone) {
  const parts = localParts(time, timeZone);
  const row = { time, localDate: parts.date, localTime: parts.time, hour: parts.hour };
  const matches = sources.map(source => ({ source, sample: source.samples.find(s => s.time === time) })).filter(pair => pair.sample);
  for (const [key, unit] of Object.entries(METRICS)) {
    const values = key === "precipitationAmount"
      ? sources.map(source => ({ id: source.id, value: amountAt(source, time, iso(Date.parse(time) + HOUR)) })).filter(pair => pair.value !== null)
      : matches.filter(({ sample }) => sample[key] !== null).map(({ source, sample }) => ({ id: source.id, value: sample[key] }));
    row[key] = metric(mean(values.map(pair => pair.value)), unit, values.map(pair => pair.id), 1, values.length ? 1 : 0, values.length ? null : "no_contributors");
  }
  row.precipitationInterval = { start: time, end: iso(Date.parse(time) + HOUR) };
  const scores = matches.filter(({ source }) => source.id !== "timer").map(({ source, sample }) => ({ id: source.id, value: hourlyScore(sample, source) })).filter(pair => pair.value !== null);
  row.score = { value: mean(scores.map(pair => pair.value)), outOf: 100, basis: "average_of_existing_provider_scores", sourceIds: scores.map(pair => pair.id) };
  return row;
}

function averageSummary(hours) {
  const result = {};
  for (const [key, unit] of Object.entries(METRICS)) {
    const metrics = hours.map(hour => hour[key]).filter(m => m.value !== null);
    const sum = key === "precipitationAmount";
    const complete = metrics.length === hours.length;
    const value = sum ? (complete ? metrics.reduce((total, m) => total + m.value, 0) : null) : mean(metrics.map(m => m.value));
    result[key] = metric(value, unit, metrics.flatMap(m => m.sourceIds), hours.length, metrics.length, sum && !complete ? "incomplete_session" : undefined);
  }
  const scores = hours.map(hour => hour.score.value).filter(value => value !== null);
  const average = mean(scores);
  result.score = { value: average === null ? null : Math.round(average), outOf: 100, basis: "average_of_existing_provider_scores", sourceIds: [...new Set(hours.flatMap(hour => hour.score.sourceIds))] };
  return result;
}

function referenceHours(source, hours, kind, timeZone, toHour) {
  if (kind !== "night" || !hours.length) return { before: [], after: [] };
  const first = Date.parse(hours[0].time);
  const last = Date.parse(hours[hours.length - 1].time);
  const afterDate = localParts(iso(last + HOUR), timeZone).date;
  return {
    before: source.samples.filter(s => Date.parse(s.time) >= first - 4 * HOUR && Date.parse(s.time) < first).map(toHour),
    after: source.samples.filter(s => {
      const parts = localParts(s.time, timeZone);
      return Date.parse(s.time) > last && parts.date === afterDate && parts.hour <= 10;
    }).map(toHour),
  };
}

function unavailableReason(source, times) {
  if (source.status !== "ok") return source.error?.code ?? source.status;
  if (!source.samples.length) return "not_provided";
  return times.every(time => time < source.samples[0].time || time > source.samples[source.samples.length - 1].time) ? "outside_forecast_range" : "missing_sample";
}

function makeSession(date, kind, times, sources, canonical, timeZone) {
  const hourly = times.map(time => aggregateHour(time, sources.filter(s => s.status === "ok"), timeZone));
  const bySource = {};
  for (const source of sources) {
    if (source.status === "not_configured" || source.id === "timer") continue;
    // Keep the two existing providers' own day/night windows and score inputs.
    // Added providers compare on the shared session's actual UTC intervals.
    const legacy = source.id === "meteoblue" || source.id === "metoffice";
    const native = source.status === "ok" ? source.samples.filter(sample => {
      if (!legacy) return times.some(time => Date.parse(sample.time) >= Date.parse(time) && Date.parse(sample.time) < Date.parse(time) + HOUR);
      const isDay = sample.isDay ?? canonical.get(sample.time) ?? [...canonical].find(([time]) => Date.parse(sample.time) >= Date.parse(time) && Date.parse(sample.time) < Date.parse(time) + HOUR)?.[1];
      return isDay === (kind === "day" ? 1 : 0) && sessionDate(localParts(sample.time, timeZone), kind) === date;
    }) : [];
    const toHour = sample => {
      if (legacy) return withLocal(sample, timeZone);
      const end = iso(Date.parse(sample.time) + HOUR);
      const amount = amountAt(source, sample.time, end);
      return withLocal({ ...sample, precipitationAmount: amount, precipitationInterval: amount !== null ? { start: sample.time, end, amount } : sample.precipitationInterval?.start === sample.time ? sample.precipitationInterval : null }, timeZone);
    };
    const hours = native.map(toHour);
    const expectedTimes = legacy && source.status === "ok" ? (source.clock ?? source.samples).filter(sample => sample.isDay === (kind === "day" ? 1 : 0) && sessionDate(localParts(sample.time, timeZone), kind) === date).map(sample => sample.time) : times;
    const reason = hours.length ? null : unavailableReason(source, times);
    bySource[source.id] = { id: source.id, name: source.name, status: source.status, expectedTimestamps: expectedTimes, summary: sourceSummary(source, hours, expectedTimes.length), hourly: hours, referenceHours: referenceHours(source, hours, kind, timeZone, toHour), unavailableReason: reason };
  }
  const timer = sources.find(s => s.id === "timer");
  const native = timer?.status === "ok" ? timer.samples.filter(sample => times.some(time => Date.parse(sample.time) >= Date.parse(time) && Date.parse(sample.time) < Date.parse(time) + HOUR)).map(s => withLocal(s, timeZone)) : [];
  const bandSummary = key => {
    const bands = native.map(s => s[key]).filter(Boolean);
    if (!bands.length) return null;
    return { category: null, range: [bands.some(b => b.range[0] === null) ? null : Math.min(...bands.map(b => b.range[0])), bands.some(b => b.range[1] === null) ? null : Math.max(...bands.map(b => b.range[1]))], unit: bands[0].unit };
  };
  const first = Date.parse(times[0]);
  const last = Date.parse(times[times.length - 1]);
  const afterDate = localParts(iso(last + HOUR), timeZone).date;
  const usable = sources.filter(s => s.status === "ok");
  const reference = kind === "day" ? { before: [], after: [] } : {
    before: [...canonical.keys()].filter(time => Date.parse(time) >= first - 4 * HOUR && Date.parse(time) < first).sort().map(time => aggregateHour(time, usable, timeZone)),
    after: [...canonical.keys()].filter(time => { const parts = localParts(time, timeZone); return Date.parse(time) > last && parts.date === afterDate && parts.hour <= 10; }).sort().map(time => aggregateHour(time, usable, timeZone)),
  };
  return {
    id: `${kind}-${date}`, date, kind, dayName: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)),
    start: times[0], end: iso(Date.parse(times[times.length - 1]) + HOUR), durationHours: times.length, expectedTimestamps: times,
    average: { summary: averageSummary(hourly), hourly, referenceHours: reference },
    sources: bySource,
    atmosphere: { sourceId: "timer", nativeStepMinutes: 180, samples: native, summary: { cloudBand: bandSummary("cloudBand"), seeing: bandSummary("seeing"), transparency: bandSummary("transparency"), temperature: metric(mean(native.map(s => s.temperature).filter(v => v !== null)), "°C", native.length ? ["timer"] : [], native.length, native.filter(s => s.temperature !== null).length) }, unavailableReason: native.length ? null : timer ? unavailableReason(timer, times) : "not_provided" },
  };
}

export function createCompleteForecast(records, location, now = new Date()) {
  const sources = records.map(record => ({ ...record, samples: record.status === "ok" ? record.samples : [] }));
  const timeZone = sources.find(source => source.timeZone && source.id !== "metoffice")?.timeZone;
  if (!timeZone) throw new ProviderError("No provider supplied the observer's IANA timezone; refresh forecasts", "timezone_unavailable");
  // A timezone supplied by Open-Meteo applies to this exact observing location.
  new Intl.DateTimeFormat("en", { timeZone });
  const canonical = new Map();
  for (const source of sources.filter(s => s.status === "ok")) {
    for (const sample of source.clock ?? source.samples) if (!canonical.has(sample.time) && (sample.isDay === 0 || sample.isDay === 1)) canonical.set(sample.time, sample.isDay);
  }
  if (!canonical.size) throw new ProviderError("No available forecast supplied day/night flags", "session_boundaries_unavailable");
  if (new Set([...canonical.keys()].map(time => Date.parse(time) % HOUR)).size > 1) throw new ProviderError("Forecast providers have incompatible hourly clocks; refresh forecasts", "hourly_alignment_unavailable");
  const today = localParts(now.toISOString(), timeZone).date;
  const groups = { night: new Map(), day: new Map() };
  for (const [time, isDay] of [...canonical].sort(([a], [b]) => a.localeCompare(b))) {
    const kind = isDay === 1 ? "day" : "night";
    const date = sessionDate(localParts(time, timeZone), kind);
    if (date < today) continue;
    if (!groups[kind].has(date)) groups[kind].set(date, []);
    groups[kind].get(date).push(time);
  }
  const sessions = kind => [...groups[kind]].map(([date, times]) => makeSession(date, kind, times, sources, canonical, timeZone));
  const nightSessions = sessions("night");
  const daySessions = sessions("day");
  const best = list => list.filter(s => s.average.summary.score.value !== null).reduce((a, b) => !a || b.average.summary.score.value > a.average.summary.score.value ? b : a, null)?.id ?? null;
  const scores = nightSessions.flatMap(s => s.average.hourly).map(h => h.score.value).filter(value => value !== null);
  const overall = mean(scores);
  return {
    schemaVersion: 2, generatedAt: now.toISOString(), timeZone,
    location: { latitude: location.lat, longitude: location.lon, elevation: location.alt }, units: { ...METRICS, seeing: "arcsec", transparency: "mag/airmass" },
    providers: sources.map(({ samples, cache, clock, units, ...metadata }) => ({ ...metadata, availableFrom: samples[0]?.time ?? null, availableUntil: samples[samples.length - 1]?.time ?? null, sampleCount: samples.length, units, hourly: samples.map(s => withLocal(s, timeZone)) })),
    scoreDefinition: { meteoblue: "round(max(0, 100 - 0.8*meanCloud - 0.2*meanProbability))", cloudOnly: "round(max(0, 100 - 0.8*meanCloud))", average: "mean of available provider scores per timestamp, then mean across session timestamps", categorical: "not converted to numeric cloud cover or scored", qualityThresholds: { Excellent: 90, "Very Good": 75, Good: 60, Fair: 45, Poor: 30, "Very Poor": 0 } },
    aggregation: { method: "unweighted arithmetic mean per timestamp and metric", sessionBoundaries: "existing provider day/night flags on a uniform hourly clock; 00:00–06:00 belongs to previous night", precipitation: "average and added-provider session hours use matching forward one-hour accumulations; providers.hourly retains native intervals and fields; legacy per-source calculations remain unchanged; never repeat a multi-hour total", sourceOverlap: "MET Norway global uses ECMWF; 7Timer is GFS-derived. Sources are not independent votes.", missing: "null plus contributors, coverage and reason; never zero or stale substitution" },
    summary: { overallNightScore: overall === null ? null : Math.round(overall), bestNight: best(nightSessions), bestDay: best(daySessions) },
    nightSessions, daySessions,
  };
}
