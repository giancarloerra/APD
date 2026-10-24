import type { AverageHour, ForecastBand, ForecastSample, MetricName } from "../types/forecast";

export function formatBand(band: ForecastBand | null | undefined, unit = band?.unit ?? ""): string {
  if (!band) return "—";
  const [low, high] = band.range;
  const suffix = unit === "arcsec" ? "″" : unit === "%" ? "%" : unit ? ` ${unit}` : "";
  return `${low === null ? `<${high}` : high === null ? `>${low}` : `${low}–${high}`}${suffix}`;
}

export function averageSample(hour: AverageHour): ForecastSample {
  const keys: MetricName[] = ["cloudCover", "temperature", "precipitationAmount", "precipitationProbability", "windSpeed", "relativeHumidity", "skyBrightness", "moonlight", "precipitationRate"];
  return { ...Object.fromEntries(keys.map(key => [key, hour[key].value])), time: hour.time, localDate: hour.localDate, localTime: hour.localTime, isDay: null } as ForecastSample;
}

export function unavailableLabel(reason: string | null): string {
  if (reason === "outside_forecast_range") return "Outside forecast range for this session";
  if (reason === "outside_geographic_coverage" || reason === "outside_coverage") return "Outside geographic coverage";
  if (reason === "location_changed") return "Location changed; refresh forecasts";
  if (reason === "incomplete_session") return "Incomplete session coverage";
  if (reason === "missing_sample") return "No samples for this session";
  return reason ? reason.replace(/_/g, " ") : "Not provided";
}
