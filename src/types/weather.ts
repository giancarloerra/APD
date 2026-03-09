export interface WeatherData {
  metadata: {
    modelrun_updatetime_utc: string;
    name: string;
    height: number;
    timezone_abbrevation: string;
    latitude: number;
    modelrun_utc: string;
    longitude: number;
    utc_timeoffset: number;
    generation_time_ms: number;
  };
  units: {
    [key: string]: string;
  };
  data_1h: {
    time: string[];
    totalcloudcover: number[];
    precipitation_probability: number[];
    isdaylight: number[];
    temperature: number[];
    windspeed: number[];
    relativehumidity: number[];
    nightskybrightness_actual: number[];
    moonlight_actual: number[];
    [key: string]: unknown[];
  };
  data_day: {
    time: string[];
    [key: string]: unknown[];
  };
}

export interface HourlyData {
  time: string;
  totalcloudcover: number;
  precipitation_probability: number;
  temperature: number;
  windspeed: number;
  relativehumidity: number;
  nightskybrightness_actual?: number;
  moonlight_actual?: number;
}

export interface DayData {
  date: string;
  dayName: string;
  nightHours: HourlyData[];
  referenceHours: {
    before: HourlyData[]; // 4 hours before night starts
    after: HourlyData[]; // 4 hours after night ends
  };
  astrophotographyScore: number;
  avgCloudCover: number;
  avgPrecipitation: number;
  avgMoonlight?: number; // Only for Meteoblue
  avgSkyBrightness?: number; // Only for Meteoblue
  avgWindspeed?: number; // Only for Meteoblue (in km/h)
  source?: "meteoblue" | "metoffice"; // Data source for display formatting
}

export interface DownloadStatus {
  isDownloading: boolean;
  lastDownload?: Date;
  error?: string;
  warning?: string;
}
