import { useState } from "react";
import { ChevronDown, ChevronUp, Star, Moon } from "lucide-react";
import { DayData, HourlyData } from "../types/weather";
import {
  getScoreColor,
  getScoreLabel,
  formatDate,
} from "../utils/weatherUtils";
import { HourlyCard } from "./HourlyCard";

// ─── Inline helpers ───────────────────────────────────────────────────────────

/** Small bar-chart sparkline of hourly cloud cover */
function CloudSparkline({ hours }: { hours: HourlyData[] }) {
  if (hours.length === 0) return null;
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
      {hours.map((h, i) => {
        const x = (i / hours.length) * W;
        const w = Math.max(1.5, W / hours.length - 0.8);
        const barH = Math.max(1, (h.totalcloudcover / 100) * H);
        const fill =
          h.totalcloudcover <= 20
            ? "#4ade80"
            : h.totalcloudcover <= 50
            ? "#facc15"
            : h.totalcloudcover <= 80
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
