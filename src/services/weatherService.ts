import { WeatherData, DownloadStatus } from "../types/weather";
import type { MetOfficeData } from "../utils/metOfficeUtils";
import type { CompleteForecast } from "../types/forecast";

const API_BASE_URL = ""; // Always use relative URLs - same origin as frontend

class WeatherService {
  private downloadStatus: DownloadStatus = { isDownloading: false };
  private statusListeners: ((status: DownloadStatus) => void)[] = [];

  constructor() {
    this.startStatusPolling();
  }

  subscribeToStatus(listener: (status: DownloadStatus) => void) {
    this.statusListeners.push(listener);
    listener(this.downloadStatus);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private notifyStatusChange() {
    this.statusListeners.forEach((listener) => listener(this.downloadStatus));
  }

  private startStatusPolling() {
    // Poll status every 2 seconds when downloading
    window.setInterval(async () => {
      if (this.downloadStatus.isDownloading) {
        await this.fetchStatus();
      }
    }, 2000);
  }

  private async fetchStatus() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/weather/status`);
      if (response.ok) {
        const status = await response.json();
        if (status.lastDownload) {
          status.lastDownload = new Date(status.lastDownload);
        }
        this.downloadStatus = status;
        this.notifyStatusChange();
      }
    } catch (error) {
      console.error("Error fetching status:", error);
    }
  }

  async getWeatherData(
    forceDownload: boolean = false
  ): Promise<WeatherData | null> {
    try {
      const endpoint = forceDownload ? "/api/weather/refresh" : "/api/weather";
      const method = forceDownload ? "POST" : "GET";

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      // Update local status with server status
      if (result.status) {
        if (result.status.lastDownload) {
          result.status.lastDownload = new Date(result.status.lastDownload);
        }
        this.downloadStatus = result.status;
        this.notifyStatusChange();
      }

      return result.data;
    } catch (error) {
      console.error("Error fetching weather data:", error);

      // Update error status
      this.downloadStatus.error =
        error instanceof Error ? error.message : "Failed to fetch data";
      this.downloadStatus.isDownloading = false;
      this.notifyStatusChange();

      return null;
    }
  }

  getDownloadStatus(): DownloadStatus {
    return { ...this.downloadStatus };
  }

  async getCompleteForecast(forceDownload = false): Promise<CompleteForecast> {
    try {
      if (forceDownload) {
        this.downloadStatus = { ...this.downloadStatus, isDownloading: true, error: undefined };
        this.notifyStatusChange();
        const refresh = await fetch(`${API_BASE_URL}/api/weather/refresh`, { method: "POST", headers: { "Content-Type": "application/json" } });
        if (!refresh.ok) {
          let failure;
          try { failure = await refresh.json(); }
          catch { throw new Error(`Refresh HTTP ${refresh.status}: invalid JSON response`); }
          throw new Error(failure?.status?.error ?? failure?.error ?? `Refresh HTTP ${refresh.status}`);
        }
      }
      const response = await fetch(`${API_BASE_URL}/api/weather/forecast`);
      let result;
      try { result = await response.json(); }
      catch { throw new Error(`Forecast HTTP ${response.status}: invalid JSON response`); }
      if (!response.ok) throw new Error(result?.error ?? `Forecast HTTP ${response.status}`);
      if (result?.schemaVersion !== 2) throw new Error("Unsupported complete forecast schema");
      if (forceDownload) {
        this.downloadStatus = { ...this.downloadStatus, isDownloading: false };
        this.notifyStatusChange();
      }
      await this.fetchStatus();
      return result;
    } catch (error) {
      this.downloadStatus = { ...this.downloadStatus, isDownloading: false, error: error instanceof Error ? error.message : "Failed to load forecasts" };
      this.notifyStatusChange();
      throw error;
    }
  }

  async getMetOfficeData(): Promise<MetOfficeData | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/weather/metoffice`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching Met Office data:", error);
      return null;
    }
  }
}

export const weatherService = new WeatherService();
