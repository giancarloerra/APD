// URLs are now built dynamically — key and location come from server/index.js exports
const REDIS_KEY_WEATHER_DATA = "weather:meteoblue_data";
const REDIS_KEY_METOFFICE_DATA = "weather:metoffice_data";
const REDIS_KEY_DOWNLOAD_STATUS = "weather:download_status";

// Late-bind helpers from index.js to avoid circular import at module load time
let _getMeteoblueKey, _getObserverLocation, _redis;
export function bindHelpers(getMeteoblueKey, getObserverLocation, redis) {
  _getMeteoblueKey = getMeteoblueKey;
  _getObserverLocation = getObserverLocation;
  _redis = redis;
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

class WeatherService {
  constructor() {
    this.downloadStatus = { isDownloading: false };
    this.statusListeners = [];
    this.initialized = false;
    this._initPromise = null;
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

    // Try Meteoblue (requires API key)
    const meteoblueKey = _getMeteoblueKey ? await _getMeteoblueKey() : null;
    if (meteoblueKey) {
      try {
        console.log("📡 Downloading weather data from Meteoblue...");
        const resp = await fetch(buildMeteoblueUrl(meteoblueKey, loc.lat, loc.lon, loc.alt));
        if (!resp.ok) throw new Error(`Meteoblue HTTP error! status: ${resp.status}`);
        meteoblueData = await resp.json();
      } catch (e) {
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
      const resp = await fetch(buildMetOfficeUrl(loc.lat, loc.lon));
      if (!resp.ok) throw new Error(`Met Office HTTP error! status: ${resp.status}`);
      metofficeData = await resp.json();
    } catch (e) {
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

    this.downloadStatus.isDownloading = false;

    if (meteoblueData || metofficeData) {
      this.downloadStatus.lastDownload = new Date();
      // Key missing → yellow warning (non-fatal); actual API error counted as warning too
      this.downloadStatus.warning = (meteoblueError && !meteoblueData) ? meteoblueError : undefined;
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

  async getDownloadStatus() {
    await this.ensureInitialized();
    return { ...this.downloadStatus };
  }
}

export const weatherService = new WeatherService();
