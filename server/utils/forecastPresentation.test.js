import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UnifiedDayRow, CompleteDayRow } from "../../src/components/UnifiedDayRow.tsx";
import { WeeklyHeatmap } from "../../src/components/WeeklyHeatmap.tsx";
import { ForecastHourlyCard } from "../../src/components/HourlyCard.tsx";
import { processWeatherData } from "../../src/utils/weatherUtils.ts";
import { processMetOfficeData } from "../../src/utils/metOfficeUtils.ts";
import { createCompleteForecast } from "./forecastProcessor.js";
import { normalizeMeteoblue, normalizeOpenMeteo } from "../services/forecastProviders.js";

const times = ["2026-01-01 22:00", "2026-01-01 23:00", "2026-01-02 00:00"];
const mb = { metadata: { utc_timeoffset: 0 }, data_1h: { time: times, isdaylight: [0, 0, 0], totalcloudcover: [18, 18, 18], temperature: [7, 7, 7], precipitation_probability: [5, 5, 5], windspeed: [2, 2, 2], relativehumidity: [80, 80, 80] } };
const mo = { timezone: "GMT", hourly: { time: times.map(t => t.replace(" ", "T")), is_day: [0, 0, 0], cloud_cover: [24, 24, 24], temperature_2m: [8, 8, 8], precipitation: [.1, .1, .1] } };
const records = [{ id: "meteoblue", name: "Meteoblue", status: "ok", error: null, ...normalizeMeteoblue(mb) }, { id: "metoffice", name: "Met Office · Global 10 km", status: "ok", error: null, ...normalizeOpenMeteo(mo) }, { id: "ecmwf", name: "ECMWF", status: "ok", timeZone: "Europe/London", samples: [], error: null }];
const forecast = createCompleteForecast(records, { lat: 51.5, lon: -.1, alt: 25 }, new Date("2026-01-01T12:00:00Z"));
const compact = html => html.replace(/<!--.*?-->/g, "");

describe("preserved weather presentation", () => {
  it.each([false, true])("displays averaged hourly and reference rain without floating-point noise (reference: %s)", isReference => {
    const sample = { ...forecast.providers.find(p => p.id === "metoffice").hourly[0], precipitationAmount: 0.6399999999999999 };
    const html = renderToStaticMarkup(createElement(ForecastHourlyCard, { sample, sourceId: "average", isReference }));
    expect(html).toContain("0.64mm");
    expect(html).not.toContain("0.6399999999999999");
  });

  it("keeps existing provider values, rain units, rounding and score badges for identical inputs", () => {
    const oldHtml = compact(renderToStaticMarkup(createElement(UnifiedDayRow, { meteoblueDay: processWeatherData(mb)[0], metOfficeDay: processMetOfficeData(mo)[0] })));
    const newHtml = compact(renderToStaticMarkup(createElement(CompleteDayRow, { session: forecast.nightSessions[0], providers: forecast.providers })));
    for (const text of ["18%", "5%", "7°C", "85/100", "24%", "0mm", "8°C", "81/100"]) {
      expect(oldHtml).toContain(text);
      expect(newHtml).toContain(text);
    }
    for (const classes of ["bg-slate-800 border border-slate-700 rounded-lg overflow-hidden", "text-xl font-semibold text-white", "flex items-center justify-between", "text-lg font-medium text-white", "flex items-center space-x-2 bg-slate-700 rounded-lg px-3 py-2"]) {
      expect(oldHtml).toContain(classes);
      expect(newHtml).toContain(classes);
    }
    expect(newHtml.indexOf("Average · All available")).toBeLessThan(newHtml.indexOf("🌤️"));
    expect(newHtml).toContain('width="100" height="16"');
  });

  it("keeps exact heatmap fills, geometry, label sizes, score strip and mobile scroll container", () => {
    const html = renderToStaticMarkup(createElement(WeeklyHeatmap, { sessions: forecast.nightSessions, providers: forecast.providers }));
    for (const fill of ["rgba(34,197,94,0.82)", "rgba(234,179,8,0.82)", "rgba(249,115,22,0.82)", "rgba(220,38,38,0.85)", "rgba(51,65,85,0.4)"]) expect(html).toContain(fill);
    expect(html).toContain("grid-template-columns:32px repeat(1, 440px)");
    expect(html).toContain("gap:1px");
    expect(html).toContain("height:12px");
    expect(html).toContain("border-radius:2px");
    expect(html).toContain("font-size:0.58rem");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("⭐");
    expect(html).toContain('<option value="average" selected="">');
  });

  it("keeps the original heatmap rendering available for existing callers", () => {
    const html = renderToStaticMarkup(createElement(WeeklyHeatmap, { mergedDays: [{ date: "2026-01-01", meteoblue: processWeatherData(mb)[0], metoffice: processMetOfficeData(mo)[0] }] }));
    expect(html).toContain("Meteoblue + Met Office averaged");
    expect(html).not.toContain("<select");
  });

  it("omits unconfigured optional sources but shows an actual provider failure", () => {
    const recordsWithFailure = [...records, { id: "metnorway", name: "MET Norway", status: "error", samples: [], error: { code: "timeout", message: "Upstream request timed out after 20 seconds" } }, { id: "metservice", name: "MetService", status: "not_configured", samples: [], error: null }];
    const f = createCompleteForecast(recordsWithFailure, { lat: 51.5, lon: -.1, alt: 25 }, new Date("2026-01-01T12:00:00Z"));
    const html = renderToStaticMarkup(createElement(CompleteDayRow, { session: f.nightSessions[0], providers: f.providers }));
    expect(html).toContain("Upstream request timed out after 20 seconds");
    expect(html).not.toContain("MetService");
  });
});
