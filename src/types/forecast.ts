export type MetricName = "cloudCover" | "temperature" | "precipitationAmount" | "precipitationProbability" | "windSpeed" | "relativeHumidity" | "skyBrightness" | "moonlight" | "precipitationRate";

export interface ForecastMetric {
  value: number | null;
  unit: string;
  sourceIds: string[];
  sampleCount: number;
  expectedSampleCount: number;
  coverage: number;
  unavailableReason: string | null;
}

export interface ForecastScore {
  value: number | null;
  outOf: number;
  basis: string;
  sourceIds: string[];
}

export type ForecastSummary = Record<MetricName, ForecastMetric> & { score: ForecastScore };
export interface ForecastBand { category: number | null; range: [number | null, number | null]; unit: string }
export type ForecastSample = Record<MetricName, number | null> & {
  time: string;
  localDate: string;
  localTime: string;
  isDay: number | null;
  precipitationInterval?: { start: string; end: string; amount: number } | null;
  cloudBand?: ForecastBand | null;
  seeing?: ForecastBand | null;
  transparency?: ForecastBand | null;
  fields?: Record<string, unknown>;
};
export type AverageHour = Record<MetricName, ForecastMetric> & { time: string; localDate: string; localTime: string; hour: number; score: ForecastScore };

export interface ProviderForecast {
  id: string;
  name: string;
  status: string;
  summary: ForecastSummary;
  hourly: ForecastSample[];
  expectedTimestamps: string[];
  referenceHours: { before: ForecastSample[]; after: ForecastSample[] };
  unavailableReason: string | null;
}

export interface ForecastSession {
  id: string;
  date: string;
  kind: "night" | "day";
  dayName: string;
  start: string;
  end: string;
  durationHours: number;
  expectedTimestamps: string[];
  average: { summary: ForecastSummary; hourly: AverageHour[]; referenceHours: { before: AverageHour[]; after: AverageHour[] } };
  sources: Record<string, ProviderForecast>;
  atmosphere: { sourceId: string; nativeStepMinutes: number; samples: ForecastSample[]; summary: { cloudBand: ForecastBand | null; seeing: ForecastBand | null; transparency: ForecastBand | null; temperature: ForecastMetric }; unavailableReason: string | null };
}

export interface ForecastProvider {
  id: string;
  name: string;
  model: string;
  optional?: boolean;
  status: string;
  fetchedAt?: string;
  forecastRun?: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
  outputStepMinutes?: number | null;
  nativeStepMinutes?: number | null;
  error: { code: string; message: string; httpStatus: number | null } | null;
}

export interface CompleteForecast {
  schemaVersion: 2;
  generatedAt: string;
  timeZone: string;
  location: { latitude: number; longitude: number; elevation: number };
  providers: ForecastProvider[];
  nightSessions: ForecastSession[];
  daySessions: ForecastSession[];
  summary: { overallNightScore: number | null; bestNight: string | null; bestDay: string | null };
}
