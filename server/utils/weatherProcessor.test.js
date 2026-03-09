import { describe, it, expect } from "vitest";
import { createWeatherSummary } from "./weatherProcessor.js";

describe("createWeatherSummary", () => {
  it("returns a summary with current_time, location, and null forecasts when called with no data", () => {
    const result = createWeatherSummary(null, null);
    expect(result).toHaveProperty("current_time");
    expect(result).toHaveProperty("location");
    expect(result.meteoblue_forecast).toBeNull();
    expect(result.met_office_forecast).toBeNull();
  });

  it("uses metadata location from Meteoblue when provided", () => {
    const meteoblueData = {
      metadata: { latitude: 51.5, longitude: -0.1 },
      data_1h: {
        time: [],
        isdaylight: [],
        totalcloudcover: [],
        precipitation_probability: [],
        temperature: [],
      },
    };
    const result = createWeatherSummary(meteoblueData, null);
    expect(result.location.latitude).toBe(51.5);
    expect(result.location.longitude).toBe(-0.1);
  });

  it("falls back to Met Office location when Meteoblue has no metadata", () => {
    const metOfficeData = { latitude: 53.0, longitude: -1.5, hourly: { time: [], is_day: [], cloud_cover: [], precipitation: [], temperature_2m: [] } };
    const result = createWeatherSummary(null, metOfficeData);
    expect(result.location.latitude).toBe(53.0);
    expect(result.location.longitude).toBe(-1.5);
  });

  it("falls back to default coordinates when both sources are null", () => {
    const result = createWeatherSummary(null, null);
    expect(typeof result.location.latitude).toBe("number");
    expect(typeof result.location.longitude).toBe("number");
  });

  it("produces an ISO 8601 current_time string", () => {
    const result = createWeatherSummary(null, null);
    expect(() => new Date(result.current_time)).not.toThrow();
    expect(result.current_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
