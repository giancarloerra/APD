import { PROVIDERS, ProviderError, fetchAdditionalProvider, hasUnalignedHourlyClock, normalizeMeteoblue, normalizeOpenMeteo, requestProvider } from "./forecastProviders.js";
import { createCompleteForecast } from "../utils/forecastProcessor.js";
import { createWeatherSummary } from "../utils/weatherProcessor.js";

// URLs are now built dynamically — key and location come from server/index.js exports
const REDIS_KEY_WEATHER_DATA = "weather:meteoblue_data";
const REDIS_KEY_METOFFICE_DATA = "weather:metoffice_data";
const REDIS_KEY_DOWNLOAD_STATUS = "weather:download_status";
const providerKey = id => `weather:provider:${id}`;

// Late-bind helpers from index.js to avoid circular import at module load time
let _getMeteoblueKey, _getObserverLocation, _redis, _getMetServiceKey;
export function bindHelpers(getMeteoblueKey, getObserverLocation, redis, getMetServiceKey = async () => null) {
  _getMeteoblueKey = getMeteoblueKey;
  _getObserverLocation = getObserverLocation;
  _redis = redis;
  _getMetServiceKey = getMetServiceKey;
  weatherService._startInit();
}

function buildMeteoblueUrl(apiKey, lat, lon, alt) {
  const asl = alt != null ? alt : 25;
  return `https://my.meteoblue.com/packages/basic-1h_clouds-1h_sunmoon_moonlight-1h?apikey=${encodeURIComponent(apiKey)}&lat=${lat}&lon=${lon}&asl=${asl}&format=json`;
}

function buildMetOfficeUrl(lat, lon) {
  // Open-Meteo uses "longitude" (positive = East). The stored lon may be negative for West.
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation,cloud_cover,temperature_2m,is_day&models=ukmo_global_deterministic_10km`;
}

export class WeatherService {
  constructor() {
    this.downloadStatus = { isDownloading: false };
    this.statusListeners = [];
    this.initialized = false;
    this._initPromise = null;
    this._downloadPromise = null;
  }

  _startInit() {
    if (!this._initPromise) {
      this._initPromise = this._doInit();
    }
    return this._initPromise;
  }

  async _doInit() {
    await this.loadDownloadStatus();
    this.initialized = true;
  }

  async ensureInitialized() {
    if (!this.initialized) {
      if (!this._initPromise) {
        // Redis not yet bound — wait briefly for bindHelpers to be called
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (this._initPromise) {
        await this._initPromise;
      }
    }
  }

  subscribeToStatus(listener) {
    this.statusListeners.push(listener);
    listener(this.downloadStatus);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  notifyStatusChange() {
    this.statusListeners.forEach((listener) => listener(this.downloadStatus));
  }

  async loadDownloadStatus() {
    try {
      const status = await _redis.get(REDIS_KEY_DOWNLOAD_STATUS);
      if (status && typeof status === "object") {
        if (status.lastDownload) {
          status.lastDownload = new Date(status.lastDownload);
        }
        this.downloadStatus = { ...this.downloadStatus, ...status };
      }
    } catch (error) {
      console.log("Could not load download status from Redis, using defaults");
    }
  }

  async saveDownloadStatus() {
    try {
      await _redis.set(REDIS_KEY_DOWNLOAD_STATUS, this.downloadStatus);
    } catch (error) {
      console.error("Error saving download status to Redis:", error);
    }
  }

  shouldDownloadNewData() {
    if (!this.downloadStatus.lastDownload) return true;

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(14, 30, 0, 0); // 2:30 PM yesterday

    return this.downloadStatus.lastDownload < yesterday;
  }

  async getWeatherData(forceDownload = false) {
    await this.ensureInitialized();

    // Check if we need to download new data (automatic or forced)
    if (forceDownload || this.shouldDownloadNewData()) {
      return await this.downloadWeatherData();
    }

    // Try to load from Redis
    try {
      const data = await _redis.get(REDIS_KEY_WEATHER_DATA);
      if (data) return data;
    } catch (error) {
      console.error("Redis read error (weather data):", error);
    }

    console.log("No cached weather data found, downloading...");
    return await this.downloadWeatherData();
  }

  async getMetOfficeData() {
    await this.ensureInitialized();

    try {
      const data = await _redis.get(REDIS_KEY_METOFFICE_DATA);
      if (data) return data;
    } catch (error) {
      console.error("Redis read error (met office data):", error);
    }
    return null;
  }

  async downloadWeatherData() {
    // The complete API and legacy routes can request the same refresh together.
    if (this._downloadPromise) return this._downloadPromise;
    this._downloadPromise = this._downloadWeatherData();
    try { return await this._downloadPromise; }
    catch (error) {
      this.downloadStatus.isDownloading = false;
      this.downloadStatus.error = error.message;
      this.notifyStatusChange();
      await this.saveDownloadStatus();
      throw error;
    }
    finally { this._downloadPromise = null; }
  }

  async _downloadWeatherData() {
    this.downloadStatus.isDownloading = true;
    this.downloadStatus.error = undefined;
    this.notifyStatusChange();
    await this.saveDownloadStatus();

    const loc = _getObserverLocation
      ? await _getObserverLocation()
      : { lat: 52.6278, lon: -1.2983, alt: 25 };

    let meteoblueData = null;
    let metofficeData = null;
    let meteoblueError = null;
    let metofficeError = null;
    let meteoblueFailure = null;
    let metofficeFailure = null;

    // Try Meteoblue (requires API key)
    const meteoblueKey = _getMeteoblueKey ? await _getMeteoblueKey() : null;
    if (meteoblueKey) {
      try {
        console.log("📡 Downloading weather data from Meteoblue...");
        const result = await requestProvider(buildMeteoblueUrl(meteoblueKey, loc.lat, loc.lon, loc.alt), { secret: meteoblueKey });
        meteoblueData = result.data;
      } catch (e) {
        meteoblueFailure = e;
        meteoblueError = e.message;
        console.error("❌ Meteoblue download failed:", e.message);
      }
    } else {
      meteoblueError = "Meteoblue API key not configured. Set it in Settings or via METEOBLUE_API_KEY env var.";
      console.warn("⚠️  Meteoblue key missing — skipping Meteoblue download");
    }

    // Always try Met Office (free, no key required)
    try {
      console.log("📡 Downloading weather data from Met Office (Open-Meteo)...");
      const result = await requestProvider(buildMetOfficeUrl(loc.lat, loc.lon));
      metofficeData = result.data;
    } catch (e) {
      metofficeFailure = e;
      metofficeError = e.message;
      console.error("❌ Met Office download failed:", e.message);
    }

    // Save to Redis what we got — delete stale key if this source failed/missing
    if (meteoblueData) {
      try {
        await _redis.set(REDIS_KEY_WEATHER_DATA, meteoblueData);
      } catch (e) {
        console.error("Redis write error (meteoblue data):", e);
      }
    } else {
      try { await _redis.del(REDIS_KEY_WEATHER_DATA); } catch (_) {}
    }
    if (metofficeData) {
      try {
        await _redis.set(REDIS_KEY_METOFFICE_DATA, metofficeData);
      } catch (e) {
        console.error("Redis write error (metoffice data):", e);
      }
    } else {
      try { await _redis.del(REDIS_KEY_METOFFICE_DATA); } catch (_) {}
    }

    // Existing raw cache keys and response shapes remain unchanged.
    // New provider records carry their own errors, location and coverage.
    const previous = await Promise.all(PROVIDERS.map(provider => _redis.get(providerKey(provider.id))));
    const metserviceKey = await _getMetServiceKey();
    const results = await Promise.allSettled(PROVIDERS.map(async (provider, index) => {
      const old = previous[index];
      const sameLocation = old?.location?.lat === loc.lat && old?.location?.lon === loc.lon && old?.location?.alt === loc.alt;
      const cached = sameLocation ? old : null;
      let record;
      try {
        if ((provider.id === "meteoblue" && !meteoblueKey) || (provider.id === "metservice" && !metserviceKey)) {
          record = { ...provider, location: loc, status: "not_configured", samples: [], error: null };
        } else if (provider.id === "meteoblue" || provider.id === "metoffice") {
          const raw = provider.id === "meteoblue" ? meteoblueData : metofficeData;
          const error = provider.id === "meteoblue" ? meteoblueError : metofficeError;
          if (!raw) throw (provider.id === "meteoblue" ? meteoblueFailure : metofficeFailure) ?? new Error(error);
          const normalized = provider.id === "meteoblue" ? normalizeMeteoblue(raw) : normalizeOpenMeteo(raw);
          record = { ...provider, ...normalized, location: loc, status: "ok", fetchedAt: new Date().toISOString(), error: null };
        } else {
          record = await fetchAdditionalProvider(provider, loc, cached, fetch, metserviceKey);
        }
      } catch (error) {
        record = { ...provider, location: loc, status: error.code === "outside_geographic_coverage" ? "outside_coverage" : "error", samples: [], timeZone: error.timeZone ?? cached?.timeZone, fetchedAt: new Date().toISOString(), error: { code: error.code ?? "upstream_error", message: error.message, httpStatus: error.status ?? null } };
      }
      await _redis.set(providerKey(provider.id), record);
      return record;
    }));
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
    const records = results.map(result => result.value);

    this.downloadStatus.isDownloading = false;

    if (records.some(record => record.status === "ok")) {
      this.downloadStatus.lastDownload = new Date();
      // Key missing → yellow warning (non-fatal); actual API error counted as warning too
      const failures = records.filter(record => record.status === "error");
      this.downloadStatus.warning = failures.length ? failures.map(record => `${record.name}: ${record.error.message}`).join("; ") : undefined;
      this.downloadStatus.error = undefined;
    } else {
      const errors = [meteoblueError, metofficeError].filter(Boolean).join("; ");
      this.downloadStatus.error = errors || "Both downloads failed";
      this.downloadStatus.warning = undefined;
    }

    this.notifyStatusChange();
    await this.saveDownloadStatus();
    return meteoblueData;
  }

  async getForecastRecords() {
    await this.ensureInitialized();
    if (this._downloadPromise) await this._downloadPromise;
    let records = await Promise.all(PROVIDERS.map(provider => _redis.get(providerKey(provider.id))));
    if (records.some(record => !record || hasUnalignedHourlyClock(record)) || this.shouldDownloadNewData() || this.downloadStatus.error || this.downloadStatus.isDownloading) {
      await this.downloadWeatherData();
      records = await Promise.all(PROVIDERS.map(provider => _redis.get(providerKey(provider.id))));
    }
    const loc = await _getObserverLocation();
    if (records.some(record => !record)) throw new Error("Provider records were not persisted to Redis");
    const current = records.map(record => record.location?.lat === loc.lat && record.location?.lon === loc.lon && record.location?.alt === loc.alt ? record : { ...record, status: "error", samples: [], error: { code: "location_changed", message: "Location changed; refresh forecasts" } });
    return { records: current, location: loc };
  }

  async getWeatherSummary() {
    const { records, location } = await this.getForecastRecords();
    const [meteoblue, metoffice] = await Promise.all([
      _redis.get(REDIS_KEY_WEATHER_DATA), _redis.get(REDIS_KEY_METOFFICE_DATA),
    ]);
    if (!meteoblue && !metoffice && !records.some(record => record.status === "ok")) return null;
    // The original two lists do not depend on another provider's clock metadata.
    // Added lists need a known observer timezone and day/night boundaries.
    const hasTimeZone = records.some(record => record.id !== "metoffice" && record.timeZone);
    const hasBoundaries = records.some(record => record.status === "ok" && (record.clock ?? record.samples).some(sample => sample.isDay === 0 || sample.isDay === 1));
    const forecast = hasTimeZone && hasBoundaries
      ? createCompleteForecast(records, location)
      : { providers: records, location: { latitude: location.lat, longitude: location.lon }, nightSessions: null };
    if (!meteoblue && !metoffice && !forecast.nightSessions) return null;
    return createWeatherSummary(meteoblue, metoffice, forecast);
  }

  async getCompleteForecast() {
    const { records: current, location: loc } = await this.getForecastRecords();
    try {
      if (current.every(record => record.error?.code === "location_changed")) throw new ProviderError("Location changed; refresh forecasts", "location_changed");
      return createCompleteForecast(current, loc);
    }
    catch (error) {
      error.providers = current.map(({ samples, cache, ...metadata }) => metadata);
      throw error;
    }
  }

  async getDownloadStatus() {
    await this.ensureInitialized();
    return { ...this.downloadStatus };
  }
}

export const weatherService = new WeatherService();
