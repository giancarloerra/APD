import { Fragment, useState } from "react";
import { DayData } from "../types/weather";
import { getScoreColor } from "../utils/weatherUtils";
import type { ForecastProvider, ForecastSession } from "../types/forecast";
import { formatBand } from "../utils/forecastUtils";

interface MergedDay {
  date: string;
  meteoblue?: DayData;
  metoffice?: DayData;
}

interface Props {
  mergedDays?: MergedDay[];
  isSolar?: boolean;
  sessions?: ForecastSession[];
  providers?: ForecastProvider[];
}

// Night hours in display order (evening → early morning)
const NIGHT_HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6];
// Solar hours (full daylight span)
const SOLAR_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

function findHourCover(day: DayData | undefined, hour: number): number | null {
  if (!day) return null;
  const found = day.nightHours.find((h) => {
    const timePart = h.time.includes(" ")
      ? h.time.split(" ")[1]
      : h.time.split("T")[1];
    return parseInt(timePart.split(":")[0]) === hour;
  });
  return found !== undefined ? found.totalcloudcover : null;
}

function getCloudCoverForHour(day: MergedDay, hour: number): number | null {
  const mbCover = findHourCover(day.meteoblue, hour);
  const moCover = findHourCover(day.metoffice, hour);
  if (mbCover !== null && moCover !== null) return Math.round((mbCover + moCover) / 2);
  return mbCover ?? moCover;
}

/** Determine which data sources are actually present across all days */
function describeDataSources(days: MergedDay[]): string {
  let hasMeteoblue = false;
  let hasMetOffice = false;
  for (const d of days) {
    if (d.meteoblue) hasMeteoblue = true;
    if (d.metoffice) hasMetOffice = true;
    if (hasMeteoblue && hasMetOffice) break;
  }
  if (hasMeteoblue && hasMetOffice) return "Cloud Cover · Meteoblue + Met Office averaged";
  if (hasMeteoblue) return "Cloud Cover · Meteoblue only";
  if (hasMetOffice) return "Cloud Cover · Met Office only";
  return "Cloud Cover";
}

function cellBg(cover: number | null): string {
  if (cover === null) return "rgba(51,65,85,0.4)"; // slate-700 faded
  if (cover <= 20) return "rgba(34,197,94,0.82)"; // green-500
  if (cover <= 50) return "rgba(234,179,8,0.82)"; // yellow-500
  if (cover <= 80) return "rgba(249,115,22,0.82)"; // orange-500
  return "rgba(220,38,38,0.85)"; // red-600
}

function shortDayLabel(date: string): string {
  const d = new Date(date + "T12:00:00");
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short" });
  return `${weekday} ${d.getDate()}`;
}

export function WeeklyHeatmap({ mergedDays = [], isSolar = false, sessions, providers = [] }: Props) {
  const [source, setSource] = useState("average");
  const days = sessions ?? mergedDays;
  if (days.length === 0) return null;
  const choices = providers.filter(p => p.status !== "not_configured" && p.status !== "outside_coverage");
  const selected = source === "average" || choices.some(p => p.id === source) ? source : "average";

  const allHours = isSolar ? SOLAR_HOURS : NIGHT_HOURS;
  const hours = selected === "timer" && sessions ? allHours.filter(hour => sessions.some(s => s.atmosphere.samples.some(h => +h.localTime.slice(0, 2) === hour))) : allHours;
  const cellH = 12;
  const cellW = Math.max(22, Math.floor(440 / days.length));
  const coverAt = (date: string, hour: number) => {
    const session = sessions?.find(s => s.date === date);
    if (!session) return { value: getCloudCoverForHour(mergedDays.find(d => d.date === date)!, hour), label: "" };
    if (selected === "timer") {
      const band = session.atmosphere.samples.find(h => +h.localTime.slice(0, 2) === hour)?.cloudBand;
      // Only the colour bucket uses a representative midpoint. The data and
      // tooltip retain the native band; this never enters an average or score.
      return { value: band && band.range[0] !== null && band.range[1] !== null ? (band.range[0] + band.range[1]) / 2 : null, label: band ? `${formatBand(band)} cloud band · native 3-hour sample` : "No native sample" };
    }
    if (selected === "average") {
      const metric = session.average.hourly.find(h => +h.localTime.slice(0, 2) === hour)?.cloudCover;
      return { value: metric?.value == null ? null : Math.round(metric.value), label: metric?.value == null ? "No data" : `${Math.round(metric.value)}% cloud cover · ${metric.sourceIds.length} sources` };
    }
    const entry = session.sources[selected]?.hourly.find(h => +h.localTime.slice(0, 2) === hour);
    return { value: entry?.cloudCover ?? null, label: entry?.cloudCover == null ? "No data" : `${entry.cloudCover}% cloud cover` };
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-slate-300 mb-3">
        {isSolar ? "☀️" : "🌙"} Weekly {isSolar ? "Daytime" : "Night"} Cloud
        Cover Overview
      </h3>

      {sessions && <label className="text-sm text-slate-400 flex items-center gap-2 mb-3">Source <select aria-label={`${isSolar ? "Day" : "Night"} heatmap source`} className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-300 text-sm" value={selected} onChange={event => setSource(event.target.value)}><option value="average">Average · All available</option>{choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}

      <div className="overflow-x-auto">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `32px repeat(${days.length}, ${cellW}px)`,
            gap: "1px",
            width: "fit-content",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {/* Header row */}
          <div />
          {days.map((d) => (
            <div
              key={d.date}
              className="text-center font-medium text-slate-300"
              style={{ fontSize: "0.58rem", lineHeight: 1.3, paddingBottom: 4 }}
            >
              {shortDayLabel(d.date)}
            </div>
          ))}

          {/* Hour rows */}
          {hours.map((hour) => (
            <Fragment key={hour}>
              <div
                className="text-right pr-1 text-slate-500 flex items-center justify-end"
                style={{ fontSize: "0.58rem" }}
              >
                {String(hour).padStart(2, "0")}h
              </div>
              {days.map((d) => {
                const cell = coverAt(d.date, hour);
                const cover = cell.value;
                return (
                  <div
                    key={`${d.date}-${hour}`}
                    title={
                      cell.label || (cover !== null ? `${cover}% cloud cover` : "No data")
                    }
                    style={{
                      height: cellH,
                      background: cellBg(cover),
                      borderRadius: 2,
                    }}
                  />
                );
              })}
            </Fragment>
          ))}

          {/* Score row */}
          <div
            className="text-right pr-1 text-slate-400 flex items-center justify-end border-t border-slate-600"
            style={{ fontSize: "0.58rem", marginTop: 3, paddingTop: 2 }}
          >
            ⭐
          </div>
          {days.map((d) => {
            const session = sessions?.find(s => s.date === d.date);
            const legacy = mergedDays.find(day => day.date === d.date);
            const score = session ? selected === "average" ? session.average.summary.score.value : selected === "timer" ? null : session.sources[selected]?.summary.score.value : legacy?.meteoblue?.astrophotographyScore ?? legacy?.metoffice?.astrophotographyScore;
            return (
              <div
                key={`score-${d.date}`}
                className={`text-center font-bold border-t border-slate-600 flex items-center justify-center ${
                  score != null ? getScoreColor(score) : "text-slate-600"
                }`}
                style={{ fontSize: "0.58rem", marginTop: 3, paddingTop: 2 }}
              >
                {score ?? "—"}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        {[
          { label: "0–20%", bg: "rgba(34,197,94,0.82)" },
          { label: "21–50%", bg: "rgba(234,179,8,0.82)" },
          { label: "51–80%", bg: "rgba(249,115,22,0.82)" },
          { label: "81–100%", bg: "rgba(220,38,38,0.85)" },
        ].map(({ label, bg }) => (
          <div key={label} className="flex items-center gap-1">
            <div
              style={{ width: 12, height: 9, background: bg, borderRadius: 2 }}
            />
            <span className="text-slate-500" style={{ fontSize: "0.6rem" }}>
              {label}
            </span>
          </div>
        ))}
        <span className="text-slate-600" style={{ fontSize: "0.6rem" }}>
          {sessions ? selected === "average" ? "Cloud Cover · All available forecasts averaged" : selected === "timer" ? "Cloud Cover · Native 3-hour bands" : `${choices.find(p => p.id === selected)?.name} · Individual forecast` : describeDataSources(mergedDays)}
        </span>
      </div>
    </div>
  );
}
