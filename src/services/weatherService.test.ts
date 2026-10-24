import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", { setInterval: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("complete forecast client", () => {
  it("refreshes once and consumes the complete server result without recomputing it", async () => {
    const forecast = { schemaVersion: 2, summary: { overallNightScore: 61 } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null, status: { isDownloading: false } })))
      .mockResolvedValueOnce(new Response(JSON.stringify(forecast)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ isDownloading: false, lastDownload: "2026-01-01T12:00:00Z" })));
    vi.stubGlobal("fetch", fetchMock);
    const { weatherService } = await import("./weatherService");
    expect(await weatherService.getCompleteForecast(true)).toEqual(forecast);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/weather/refresh", "/api/weather/summary?v=2", "/api/weather/status"]);
    expect(weatherService.getDownloadStatus().isDownloading).toBe(false);
  });

  it.each([[503, false], [200, true]])("clears the completed local refresh while retaining a successful status response (%i)", async (status, downloading) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null, status: { isDownloading: false } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 2 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ isDownloading: true }), { status }));
    vi.stubGlobal("fetch", fetchMock);
    const { weatherService } = await import("./weatherService");
    const listener = vi.fn();
    weatherService.subscribeToStatus(listener);
    await weatherService.getCompleteForecast(true);
    expect(weatherService.getDownloadStatus().isDownloading).toBe(downloading);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ isDownloading: downloading }));
  });

  it.each([
    ["non-JSON response", () => new Response("gateway failure", { status: 503 }), "Refresh HTTP 503: invalid JSON response"],
    ["required-store failure", () => new Response(JSON.stringify({ error: "Failed to refresh weather data", status: { error: "Redis write denied" } }), { status: 500 }), "Redis write denied"],
  ])("stops polling and reports a failed refresh with its %s", async (_name, response, message) => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    const { weatherService } = await import("./weatherService");
    await expect(weatherService.getCompleteForecast(true)).rejects.toThrow(message);
    expect(weatherService.getDownloadStatus()).toMatchObject({ isDownloading: false, error: message });
  });

  it("preserves HTTP status when the complete response is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gateway failure", { status: 502 })));
    const { weatherService } = await import("./weatherService");
    await expect(weatherService.getCompleteForecast()).rejects.toThrow("Forecast HTTP 502: invalid JSON response");
  });
});
