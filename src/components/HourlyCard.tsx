import { Cloud, Droplets, Thermometer, Moon, Eye, Wind } from "lucide-react";
import { HourlyData } from "../types/weather";
import { formatTime } from "../utils/weatherUtils";

interface Props {
  hour: HourlyData;
  isReference?: boolean; // For smaller reference cards
  source?: "meteoblue" | "metoffice"; // Data source for display formatting
  isSolar?: boolean; // For solar hours (excludes lux and moon)
}

export function HourlyCard({
  hour,
  isReference = false,
  source = "meteoblue",
  isSolar = false,
}: Props) {
  const getCloudColor = (cloudCover: number) => {
    if (cloudCover <= 20) return "text-green-400";
    if (cloudCover <= 50) return "text-yellow-400";
    if (cloudCover <= 80) return "text-orange-400";
    return "text-red-400";
  };

  const getPrecipColor = (precip: number) => {
    if (precip <= 10) return "text-green-400";
    if (precip <= 30) return "text-yellow-400";
    if (precip <= 60) return "text-orange-400";
    return "text-red-400";
  };

  const getSkyBrightnessColor = (lux: number) => {
    if (lux <= 0.002) return "text-green-400"; // Moonless clear night
    if (lux <= 0.01) return "text-yellow-400"; // Quarter moon
    if (lux <= 0.3) return "text-orange-400"; // Full moon
    return "text-red-400"; // Very bright
  };

  const getWindspeedColor = (kmh: number) => {
    if (kmh <= 10) return "text-green-400"; // Calm
    if (kmh <= 20) return "text-yellow-400"; // Light breeze
    if (kmh <= 30) return "text-orange-400"; // Moderate breeze
    return "text-red-400"; // Strong wind
  };

  if (isReference) {
    // Smaller reference card
    return (
      <div className="bg-slate-800 border border-slate-600 rounded p-1.5 min-w-[60px] flex-shrink-0 opacity-60">
        <div className="text-center">
          <div className="text-xs font-medium text-slate-400 mb-1">
            {formatTime(hour.time)}
          </div>

          <div className="space-y-0.5">
            <div className="flex items-center justify-center space-x-0.5">
              <Cloud className="h-2.5 w-2.5 text-slate-500" />
              <span
                className={`text-xs ${getCloudColor(hour.totalcloudcover)}`}
              >
                {hour.totalcloudcover}%
              </span>
            </div>

            <div className="flex items-center justify-center space-x-0.5">
              <Droplets className="h-2.5 w-2.5 text-slate-500" />
              <span
                className={`text-xs ${
                  source === "metoffice"
                    ? "text-blue-300"
                    : getPrecipColor(hour.precipitation_probability)
                }`}
              >
                {source === "metoffice"
                  ? `${hour.precipitation_probability}mm`
                  : `${hour.precipitation_probability}%`}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Regular night hour card
  return (
    <div className="bg-slate-700 rounded-lg p-3 min-w-[120px] flex-shrink-0">
      <div className="text-center">
        <div className="text-sm font-medium text-slate-300 mb-2">
          {formatTime(hour.time)}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-center space-x-1">
            <Cloud className="h-4 w-4 text-slate-400" />
            <span
              className={`text-sm font-medium ${getCloudColor(
                hour.totalcloudcover
              )}`}
            >
              {hour.totalcloudcover}%
            </span>
          </div>

          <div className="flex items-center justify-center space-x-1">
            <Droplets className="h-4 w-4 text-slate-400" />
            <span
              className={`text-sm font-medium ${
                source === "metoffice"
                  ? "text-blue-300"
                  : getPrecipColor(hour.precipitation_probability)
              }`}
            >
              {source === "metoffice"
                ? `${hour.precipitation_probability}mm`
                : `${hour.precipitation_probability}%`}
            </span>
          </div>

          <div className="flex items-center justify-center space-x-1">
            <Thermometer className="h-4 w-4 text-slate-400" />
            <span className="text-sm text-slate-300">
              {Math.round(hour.temperature)}°C
            </span>
          </div>

          {/* Meteoblue-specific fields: Moonlight and Sky Brightness (only for night hours) */}
          {!isSolar &&
            source === "meteoblue" &&
            hour.moonlight_actual !== undefined && (
              <div className="flex items-center justify-center space-x-1">
                <Moon className="h-4 w-4 text-slate-400" />
                <span className="text-sm text-slate-300">
                  {Math.round(hour.moonlight_actual)}%
                </span>
              </div>
            )}

          {!isSolar &&
            source === "meteoblue" &&
            hour.nightskybrightness_actual !== undefined && (
              <div className="flex items-center justify-center space-x-1">
                <Eye className="h-4 w-4 text-slate-400" />
                <span
                  className={`text-sm ${getSkyBrightnessColor(
                    hour.nightskybrightness_actual
                  )}`}
                >
                  {hour.nightskybrightness_actual.toFixed(3)} lux
                </span>
              </div>
            )}

          {/* Meteoblue windspeed */}
          {source === "meteoblue" && (
            <div className="flex items-center justify-center space-x-1">
              <Wind className="h-4 w-4 text-slate-400" />
              <span
                className={`text-sm ${getWindspeedColor(hour.windspeed * 3.6)}`}
              >
                {Math.round(hour.windspeed * 3.6)} km/h
              </span>
            </div>
          )}
        </div>

        <div className="text-xs text-slate-500 mt-2 text-center">
          {hour.time}
        </div>
      </div>
    </div>
  );
}
