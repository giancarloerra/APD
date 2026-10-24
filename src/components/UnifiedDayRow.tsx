import { useState } from "react";
import { ChevronDown, ChevronUp, Star, Moon, Layers, Cloud, Eye } from "lucide-react";
import { DayData, HourlyData } from "../types/weather";
import {
  getScoreColor,
  getScoreLabel,
  formatDate,
} from "../utils/weatherUtils";
import { HourlyCard, ForecastHourlyCard } from "./HourlyCard";
import type { ForecastProvider, ForecastSession, ForecastSummary, ProviderForecast } from "../types/forecast";
import { averageSample, formatBand, unavailableLabel } from "../utils/forecastUtils";

// ─── Inline helpers ───────────────────────────────────────────────────────────

/** Small bar-chart sparkline of hourly cloud cover */
function CloudSparkline({ hours = [], values }: { hours?: HourlyData[]; values?: (number | null)[] }) {
  const covers = values ?? hours.map(hour => hour.totalcloudcover);
  if (covers.length === 0) return null;
  const W = 100;
  const H = 16;
  return (
    <svg
      width={W}
      height={H}
      className="flex-shrink-0"
      aria-hidden="true"
      style={{ verticalAlign: "middle" }}
    >
      {covers.map((cover, i) => {
        const x = (i / covers.length) * W;
        const w = Math.max(1.5, W / covers.length - 0.8);
        const barH = cover === null ? 1 : Math.max(1, (cover / 100) * H);
        const fill =
          cover === null ? "#334155" : cover <= 20
            ? "#4ade80"
            : cover <= 50
            ? "#facc15"
            : cover <= 80
            ? "#fb923c"
            : "#f87171";
        return (
          <rect
            key={i}
            x={x}
            y={H - barH}
            width={w}
            height={barH}
            fill={fill}
            opacity="0.82"
          />
        );
      })}
    </svg>
  );
}

function ForecastStats({ summary, id }: { summary: ForecastSummary; id: string }) {
  const average = id === "average";
  const probability = id === "meteoblue";
  const rate = id === "metservice";
  const rain = probability ? summary.precipitationProbability : rate ? summary.precipitationRate : summary.precipitationAmount;
  const score = summary.score.value;
  return (
    <div className="flex items-center justify-between">
      <div className="text-center" title={`${summary.cloudCover.sampleCount}/${summary.cloudCover.expectedSampleCount} source hours`}><div className="text-sm text-slate-400">Cloud Cover</div><div className="text-lg font-medium text-white">{summary.cloudCover.value === null ? "—" : `${Math.round(summary.cloudCover.value)}%`}</div>{average && <div className="text-xs text-slate-500">{summary.cloudCover.sourceIds.length} forecasts</div>}{summary.cloudCover.coverage < 1 && <div className="text-xs text-slate-500">{summary.cloudCover.sampleCount}/{summary.cloudCover.expectedSampleCount} hours</div>}</div>
      <div className="text-center" title={rain.unavailableReason ? unavailableLabel(rain.unavailableReason) : undefined}>
        <div className="text-sm text-slate-400">{probability ? "Precipitation" : rate ? "Avg Rain Rate" : "Total Rain"}</div>
        <div className="text-lg font-medium text-white">{rain.value === null ? "—" : `${(average || rate) && !probability ? Number(rain.value.toFixed(2)) : Math.round(rain.value)}${probability ? "%" : rate ? "mm/h" : "mm"}`}</div>
        {!probability && summary.precipitationProbability.value !== null && <div className="text-xs text-slate-500">Mean chance: {Math.round(summary.precipitationProbability.value)}%{average ? ` · ${summary.precipitationProbability.sourceIds.length} sources` : ""}</div>}
      </div>
      <div className="text-center"><div className="text-sm text-slate-400">Avg Temp</div><div className="text-lg font-medium text-white">{summary.temperature.value === null ? "—" : `${Math.round(summary.temperature.value)}°C`}</div>{average && <div className="text-xs text-slate-500">{summary.temperature.sourceIds.length} contributing sources</div>}</div>
      <div className="flex items-center space-x-2 bg-slate-700 rounded-lg px-3 py-2">
        <Star className="h-5 w-5 text-amber-400" /><div className="text-right">
          <div className={`text-lg font-bold ${score === null ? "text-slate-500" : getScoreColor(score)}`}>{score === null ? "—" : `${score}/100`}</div>
          <div className={`text-xs ${score === null ? "text-slate-500" : getScoreColor(score)}`}>{score === null ? "Unavailable" : getScoreLabel(score)}</div>
        </div>
      </div>
    </div>
  );
}

export function CompleteDayRow({ session, providers }: { session: ForecastSession; providers: ForecastProvider[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [source, setSource] = useState("average");
  const isSolar = session.kind === "day";
  const mb = session.sources.meteoblue;
  const choices = providers.filter(p => p.status !== "not_configured" && p.status !== "outside_coverage");
  const selectedSource = choices.some(p => p.id === source) || source === "average" ? source : "average";
  const current = session.sources[selectedSource];
  const hours = selectedSource === "average" ? session.average.hourly.map(averageSample) : selectedSource === "timer" ? session.atmosphere.samples : current?.hourly ?? [];
  const reference = selectedSource === "average" ? { before: session.average.referenceHours.before.map(averageSample), after: session.average.referenceHours.after.map(averageSample) } : selectedSource === "timer" ? { before: [], after: [] } : current?.referenceHours ?? { before: [], after: [] };
  const selectedProvider = providers.find(p => p.id === selectedSource);
  const selectedReason = selectedSource === "timer" ? session.atmosphere.unavailableReason : current?.unavailableReason;
  const timer = session.atmosphere.samples;
  const rows: (ProviderForecast | { id: string; name: string; summary: ForecastSummary; hourly: typeof session.average.hourly })[] = [{ id: "average", name: "Average · All available", ...session.average }, ...Object.values(session.sources)];
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden" data-session-id={session.id}>
      <div className="p-4 cursor-pointer hover:bg-slate-750 transition-colors" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <h3 className="text-xl font-semibold text-white">{session.dayName} {formatDate(session.date)}</h3>
            <span className="text-sm text-slate-400">({session.durationHours} {isSolar ? "solar" : "night"} hours{!isSolar && mb?.summary.moonlight.value !== null && mb?.summary.moonlight.value !== undefined ? `, Moon ${Math.round(mb.summary.moonlight.value)}%` : ""}{!isSolar && mb?.summary.skyBrightness.value !== null && mb?.summary.skyBrightness.value !== undefined ? `, Sky Brightness ${mb.summary.skyBrightness.value.toFixed(3)} lux` : ""}{mb?.summary.windSpeed.value !== null && mb?.summary.windSpeed.value !== undefined ? `, Wind ${Math.round(mb.summary.windSpeed.value)} km/h` : ""})</span>
          </div>
          {isExpanded ? <ChevronUp className="h-5 w-5 text-slate-400" /> : <ChevronDown className="h-5 w-5 text-slate-400" />}
        </div>
        {rows.map(row => {
          const average = row.id === "average";
          const failed = !average && "unavailableReason" in row ? row.unavailableReason : null;
          const error = providers.find(p => p.id === row.id)?.error;
          return <section className="mb-3" key={row.id} data-provider-id={row.id}>
            <div className="text-sm text-slate-400 mb-2 flex items-center gap-1">{average ? <Layers className="h-4 w-4" /> : row.id === "meteoblue" ? "🌤️ " : row.id === "metoffice" ? "🏢 " : <Cloud className="h-4 w-4" />}{row.name}</div>
            {failed ? <div className="text-sm text-slate-400">{error?.message ?? unavailableLabel(failed)}</div> : <>
              <ForecastStats summary={row.summary} id={row.id} />
              <div className="flex items-center gap-3 mt-2"><CloudSparkline values={row.hourly.map(h => typeof h.cloudCover === "object" && h.cloudCover !== null ? h.cloudCover.value : h.cloudCover)} />
                {average && <span className="text-xs text-slate-500">{session.durationHours} hours · Average of available forecasts</span>}
                {!isSolar && row.id === "meteoblue" && row.summary.moonlight.value !== null && <div className={`flex items-center gap-1 ${moonColor(row.summary.moonlight.value)}`} title={`Avg moonlight ≈ ${moonPct(row.summary.moonlight.value)}%`}><Moon className="h-3 w-3" /><span className="text-xs font-medium">{moonPct(row.summary.moonlight.value)}%</span></div>}
              </div>
            </>}
          </section>;
        })}
        {providers.some(p => p.id === "timer") && <section data-provider-id="timer">
          <div className="text-sm text-slate-400 mb-2 flex items-center gap-1"><Eye className="h-4 w-4" />7Timer · Atmosphere <span className="text-xs text-slate-500">Native 3-hour samples</span></div>
          {timer.length ? <><div className="flex items-center justify-between">
            {[["Cloud Bands", formatBand(session.atmosphere.summary.cloudBand)], ["Seeing", formatBand(session.atmosphere.summary.seeing)], ["Transparency", formatBand(session.atmosphere.summary.transparency)], ["Avg Temp", session.atmosphere.summary.temperature.value === null ? "—" : `${Math.round(session.atmosphere.summary.temperature.value)}°C`]].map(([label, value]) => <div className="text-center" key={label}><div className="text-sm text-slate-400">{label}</div><div className="text-lg font-medium text-white">{value}</div></div>)}
          </div><p className="text-xs text-slate-500 mt-2">{timer.length} native samples. Ranges are not converted to exact cloud percentages or a score.</p></> : <p className="text-sm text-slate-400">{providers.find(p => p.id === "timer")?.error?.message ?? unavailableLabel(session.atmosphere.unavailableReason)}</p>}
        </section>}
      </div>
      {isExpanded && <div className="border-t border-slate-700 bg-slate-850">
        <div className="p-4">
          <div className="flex items-center justify-between gap-3 mb-4"><h4 className="text-lg font-medium text-white">{isSolar ? "Daytime" : "Nighttime"} Hours</h4><label className="text-sm text-slate-400">Source <select aria-label={`${session.id} hourly source`} className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-300 text-sm max-w-full" value={selectedSource} onChange={event => setSource(event.target.value)}><option value="average">Average · All available</option>{choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
          {reference.before.length > 0 && <div className="mb-4"><h5 className="text-xs font-normal text-slate-400 mb-2">Reference Hours Before Night ({reference.before.length} hours)</h5><div className="flex space-x-1 overflow-x-auto pb-2">{reference.before.map(h => <ForecastHourlyCard key={h.time} sample={h} sourceId={selectedSource} isReference isSolar={isSolar} />)}</div></div>}
          {hours.length ? <div className="flex space-x-3 overflow-x-auto pb-2">{hours.map(h => <ForecastHourlyCard key={h.time} sample={h} sourceId={selectedSource} isSolar={isSolar} />)}</div> : <p className="text-sm text-slate-400">{selectedProvider?.error?.message ?? unavailableLabel(selectedReason ?? null)}</p>}
          {reference.after.length > 0 && <div className="mt-4"><h5 className="text-xs font-normal text-slate-400 mb-2">Reference Hours After Night ({reference.after.length} hours)</h5><div className="flex space-x-1 overflow-x-auto pb-2">{reference.after.map(h => <ForecastHourlyCard key={h.time} sample={h} sourceId={selectedSource} isReference isSolar={isSolar} />)}</div></div>}
        </div>
        <div className="flex items-center justify-center py-3 cursor-pointer hover:bg-slate-700 transition-colors border-t border-slate-700 text-slate-400 hover:text-white gap-1 text-sm" onClick={() => setIsExpanded(false)}><ChevronUp className="h-4 w-4" /><span>Collapse</span></div>
      </div>}
    </div>
  );
}

/**
 * moonlight_actual is in lux (~0 dark → ~0.27 full moon).
 * Convert to a 0-100 display percentage and pick a colour.
 */
function moonPct(lux: number): number {
  return Math.min(100, Math.round((lux / 0.27) * 100));
}
function moonColor(lux: number): string {
  if (lux <= 0.002) return "text-green-400";
  if (lux <= 0.01) return "text-yellow-400";
  if (lux <= 0.135) return "text-orange-400";
  return "text-red-400";
}

interface Props {
  meteoblueDay?: DayData;
  metOfficeDay?: DayData;
  isSolar?: boolean; // For solar hours (excludes lux and moon)
}

export function UnifiedDayRow({
  meteoblueDay,
  metOfficeDay,
  isSolar = false,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Use the day with data for basic info (date, night hours count)
  const primaryDay = meteoblueDay || metOfficeDay;
  if (!primaryDay) return null;

  // Calculate average temperatures for each provider
  const getMeteoblueAvgTemp = () => {
    if (!meteoblueDay) return null;
    const totalTemp = meteoblueDay.nightHours.reduce(
      (sum, h) => sum + h.temperature,
      0
    );
    return Math.round(totalTemp / meteoblueDay.nightHours.length);
  };

  const getMetOfficeAvgTemp = () => {
    if (!metOfficeDay) return null;
    const totalTemp = metOfficeDay.nightHours.reduce(
      (sum, h) => sum + h.temperature,
      0
    );
    return Math.round(totalTemp / metOfficeDay.nightHours.length);
  };

  const meteoblueAvgTemp = getMeteoblueAvgTemp();
  const metOfficeAvgTemp = getMetOfficeAvgTemp();

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      <div
        className="p-4 cursor-pointer hover:bg-slate-750 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Title Section */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <h3 className="text-xl font-semibold text-white">
              {primaryDay.dayName} {formatDate(primaryDay.date)}
            </h3>
            <span className="text-sm text-slate-400">
              ({primaryDay.nightHours.length} {isSolar ? "solar" : "night"}{" "}
              hours
              {!isSolar &&
                meteoblueDay?.avgMoonlight !== undefined &&
                `, Moon ${Math.round(meteoblueDay.avgMoonlight)}%`}
              {!isSolar &&
                meteoblueDay?.avgSkyBrightness !== undefined &&
                `, Sky Brightness ${meteoblueDay.avgSkyBrightness.toFixed(
                  3
                )} lux`}
              {meteoblueDay?.avgWindspeed !== undefined &&
                `, Wind ${Math.round(meteoblueDay.avgWindspeed)} km/h`}
              )
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-slate-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-slate-400" />
          )}
        </div>

        {/* Meteoblue Stats */}
        {meteoblueDay && (
          <div className="mb-3">
            <div className="text-sm text-slate-400 mb-2">🌤️ Meteoblue</div>
            <div className="flex items-center justify-between">
              <div className="text-center">
                <div className="text-sm text-slate-400">Cloud Cover</div>
                <div className="text-lg font-medium text-white">
                  {Math.round(meteoblueDay.avgCloudCover)}%
                </div>
              </div>

              <div className="text-center">
                <div className="text-sm text-slate-400">Precipitation</div>
                <div className="text-lg font-medium text-white">
                  {Math.round(meteoblueDay.avgPrecipitation)}%
                </div>
              </div>

              {meteoblueAvgTemp !== null && (
                <div className="text-center">
                  <div className="text-sm text-slate-400">Avg Temp</div>
                  <div className="text-lg font-medium text-white">
                    {meteoblueAvgTemp}°C
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-2 bg-slate-700 rounded-lg px-3 py-2">
                <Star className="h-5 w-5 text-amber-400" />
                <div className="text-right">
                  <div
                    className={`text-lg font-bold ${getScoreColor(
                      meteoblueDay.astrophotographyScore
                    )}`}
                  >
                    {meteoblueDay.astrophotographyScore}/100
                  </div>
                  <div
                    className={`text-xs ${getScoreColor(
                      meteoblueDay.astrophotographyScore
                    )}`}
                  >
                    {getScoreLabel(meteoblueDay.astrophotographyScore)}
                  </div>
                </div>
              </div>
            </div>

            {/* Sparkline + moon (collapsed only – no score impact) */}
            <div className="flex items-center gap-3 mt-2">
              <CloudSparkline hours={meteoblueDay.nightHours} />
              {!isSolar && meteoblueDay.avgMoonlight !== undefined && (
                <div
                  className={`flex items-center gap-1 ${moonColor(
                    meteoblueDay.avgMoonlight
                  )}`}
                  title={`Avg moonlight ≈ ${moonPct(meteoblueDay.avgMoonlight)}%`}
                >
                  <Moon className="h-3 w-3" />
                  <span className="text-xs font-medium">
                    {moonPct(meteoblueDay.avgMoonlight)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Met Office Stats */}
        {metOfficeDay && (
          <div>
            <div className="text-sm text-slate-400 mb-2">🏢 Met Office</div>
            <div className="flex items-center justify-between">
              <div className="text-center">
                <div className="text-sm text-slate-400">Cloud Cover</div>
                <div className="text-lg font-medium text-white">
                  {Math.round(metOfficeDay.avgCloudCover)}%
                </div>
              </div>

              <div className="text-center">
                <div className="text-sm text-slate-400">Total Rain</div>
                <div className="text-lg font-medium text-white">
                  {Math.round(metOfficeDay.avgPrecipitation)}mm
                </div>
              </div>

              {metOfficeAvgTemp !== null && (
                <div className="text-center">
                  <div className="text-sm text-slate-400">Avg Temp</div>
                  <div className="text-lg font-medium text-white">
                    {metOfficeAvgTemp}°C
                  </div>
                </div>
              )}

              <div className="flex items-center space-x-2 bg-slate-700 rounded-lg px-3 py-2">
                <Star className="h-5 w-5 text-amber-400" />
                <div className="text-right">
                  <div
                    className={`text-lg font-bold ${getScoreColor(
                      metOfficeDay.astrophotographyScore
                    )}`}
                  >
                    {metOfficeDay.astrophotographyScore}/100
                  </div>
                  <div
                    className={`text-xs ${getScoreColor(
                      metOfficeDay.astrophotographyScore
                    )}`}
                  >
                    {getScoreLabel(metOfficeDay.astrophotographyScore)}
                  </div>
                </div>
              </div>
            </div>

            {/* Sparkline */}
            <div className="mt-2">
              <CloudSparkline hours={metOfficeDay.nightHours} />
            </div>
          </div>
        )}
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-slate-700 bg-slate-850">
          {/* Meteoblue Data Section */}
          {meteoblueDay && (
            <div className="p-4 border-b border-slate-700">
              <h4 className="text-lg font-medium text-white mb-4 flex items-center space-x-2">
                <span>{isSolar ? "☀️" : "🌤️"} Meteoblue Data</span>
              </h4>

              {/* Reference hours before night */}
              {meteoblueDay.referenceHours.before.length > 0 && (
                <div className="mb-4">
                  <h5 className="text-xs font-normal text-slate-400 mb-2">
                    Reference Hours Before Night (
                    {meteoblueDay.referenceHours.before.length} hours)
                  </h5>
                  <div className="flex space-x-1 overflow-x-auto pb-2">
                    {meteoblueDay.referenceHours.before.map((hour, index) => (
                      <HourlyCard
                        key={`meteoblue-before-${index}`}
                        hour={hour}
                        isReference={true}
                        source={meteoblueDay.source}
                        isSolar={isSolar}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Night hours */}
              <div className="mb-4">
                <h4 className="text-sm font-medium text-slate-300 mb-2">
                  {isSolar ? "Daytime" : "Nighttime"} Hours (
                  {meteoblueDay.nightHours.length} hours)
                </h4>
                <div className="flex space-x-3 overflow-x-auto pb-2">
                  {meteoblueDay.nightHours.map((hour, index) => (
                    <HourlyCard
                      key={`meteoblue-night-${index}`}
                      hour={hour}
                      source={meteoblueDay.source}
                      isSolar={isSolar}
                    />
                  ))}
                </div>
              </div>

              {/* Reference hours after night */}
              {meteoblueDay.referenceHours.after.length > 0 && (
                <div>
                  <h5 className="text-xs font-normal text-slate-400 mb-2">
                    Reference Hours After Night (
                    {meteoblueDay.referenceHours.after.length} hours)
                  </h5>
                  <div className="flex space-x-1 overflow-x-auto pb-2">
                    {meteoblueDay.referenceHours.after.map((hour, index) => (
                      <HourlyCard
                        key={`meteoblue-after-${index}`}
                        hour={hour}
                        isReference={true}
                        source={meteoblueDay.source}
                        isSolar={isSolar}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Met Office Data Section */}
          {metOfficeDay && (
            <div className="p-4">
              <h4 className="text-lg font-medium text-white mb-4 flex items-center space-x-2">
                <span>{isSolar ? "☀️" : "🏢"} Met Office Data</span>
              </h4>

              {/* Reference hours before night */}
              {metOfficeDay.referenceHours.before.length > 0 && (
                <div className="mb-4">
                  <h5 className="text-xs font-normal text-slate-400 mb-2">
                    Reference Hours Before Night (
                    {metOfficeDay.referenceHours.before.length} hours)
                  </h5>
                  <div className="flex space-x-1 overflow-x-auto pb-2">
                    {metOfficeDay.referenceHours.before.map((hour, index) => (
                      <HourlyCard
                        key={`metoffice-before-${index}`}
                        hour={hour}
                        isReference={true}
                        source={metOfficeDay.source}
                        isSolar={isSolar}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Night hours */}
              <div className="mb-4">
                <h4 className="text-sm font-medium text-slate-300 mb-2">
                  {isSolar ? "Daytime" : "Nighttime"} Hours (
                  {metOfficeDay.nightHours.length} hours)
                </h4>
                <div className="flex space-x-3 overflow-x-auto pb-2">
                  {metOfficeDay.nightHours.map((hour, index) => (
                    <HourlyCard
                      key={`metoffice-night-${index}`}
                      hour={hour}
                      source={metOfficeDay.source}
                      isSolar={isSolar}
                    />
                  ))}
                </div>
              </div>

              {/* Reference hours after night */}
              {metOfficeDay.referenceHours.after.length > 0 && (
                <div>
                  <h5 className="text-xs font-normal text-slate-400 mb-2">
                    Reference Hours After Night (
                    {metOfficeDay.referenceHours.after.length} hours)
                  </h5>
                  <div className="flex space-x-1 overflow-x-auto pb-2">
                    {metOfficeDay.referenceHours.after.map((hour, index) => (
                      <HourlyCard
                        key={`metoffice-after-${index}`}
                        hour={hour}
                        isReference={true}
                        source={metOfficeDay.source}
                        isSolar={isSolar}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
      {/* Collapse button */}
          <div
            className="flex items-center justify-center py-3 cursor-pointer hover:bg-slate-700 transition-colors border-t border-slate-700 text-slate-400 hover:text-white gap-1 text-sm"
            onClick={() => setIsExpanded(false)}
          >
            <ChevronUp className="h-4 w-4" />
            <span>Collapse</span>
          </div>
        </div>
      )}
    </div>
  );
}
