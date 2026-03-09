import { WeatherData, DayData, HourlyData } from "../types/weather";

export function processWeatherData(data: WeatherData): DayData[] {
  const { data_1h } = data;
  const days: DayData[] = [];

  // Group hourly data by "night day" - night hours belong to the earlier day
  const nightGroups = new Map<string, HourlyData[]>();

  data_1h.time.forEach((timeStr, index) => {
    // Only process night hours
    if (data_1h.isdaylight[index] === 0) {
      // Parse the time string as local time to avoid timezone issues
      const [datePart, timePart] = timeStr.split(" ");
      const [year, month, day] = datePart.split("-").map(Number);
      const [hour] = timePart.split(":").map(Number);

      // Determine which "night day" this hour belongs to
      // Early morning hours (0-6) belong to the previous day's night
      // Evening hours (18-23) belong to the same day's night
      let nightDate: Date;
      if (hour >= 0 && hour <= 6) {
        // Early morning hours belong to previous day's night
        nightDate = new Date(year, month - 1, day - 1);
      } else {
        // Evening hours belong to same day's night
        nightDate = new Date(year, month - 1, day);
      }

      const dateKey = nightDate.toISOString().split("T")[0];

      if (!nightGroups.has(dateKey)) {
        nightGroups.set(dateKey, []);
      }

      nightGroups.get(dateKey)!.push({
        time: timeStr,
        totalcloudcover: data_1h.totalcloudcover[index],
        precipitation_probability: data_1h.precipitation_probability[index],
        temperature: data_1h.temperature[index],
        windspeed: data_1h.windspeed[index],
        relativehumidity: data_1h.relativehumidity[index],
        nightskybrightness_actual: data_1h.nightskybrightness_actual?.[index],
        moonlight_actual: data_1h.moonlight_actual?.[index],
      });
    }
  });

  // Process each night group
  nightGroups.forEach((nightHours, dateKey) => {
    if (nightHours.length > 0) {
      // Find the 00:00 hour in this night group to determine the correct day name
      const midnightHour = nightHours.find((hour) => {
        const [, timePart] = hour.time.split(" ");
        return timePart === "00:00";
      });

      let dayName: string;
      let displayDate: string;
      if (midnightHour) {
        // If we have a 00:00 hour, use that date minus 1 day for the day name and display
        const [datePart] = midnightHour.time.split(" ");
        const [year, month, day] = datePart.split("-").map(Number);

        // Calculate the previous day directly to avoid timezone issues
        const prevDay = day - 1;
        const prevMonth = month;
        const prevYear = year;

        // Handle month/year rollover if needed
        let finalYear = prevYear;
        let finalMonth = prevMonth;
        let finalDay = prevDay;

        if (prevDay < 1) {
          finalMonth = prevMonth - 1;
          if (finalMonth < 1) {
            finalMonth = 12;
            finalYear = prevYear - 1;
          }
          // Get last day of previous month (simplified - works for our use case)
          const daysInMonth = new Date(finalYear, finalMonth, 0).getDate();
          finalDay = daysInMonth;
        }

        // Create display date string
        displayDate = `${finalYear}-${String(finalMonth).padStart(
          2,
          "0"
        )}-${String(finalDay).padStart(2, "0")}`;

        // Create date for day name calculation (using noon to avoid timezone issues)
        const dayNameDate = new Date(displayDate + "T12:00:00");
        dayName = dayNameDate.toLocaleDateString("en-US", { weekday: "long" });
      } else {
        // Fallback to using the dateKey (shouldn't happen with our logic)
        const date = new Date(dateKey + "T12:00:00");
        dayName = date.toLocaleDateString("en-US", { weekday: "long" });
        displayDate = dateKey;
      }

      // Sort night hours properly (evening hours first, then early morning hours)
      const sortedNightHours = sortNightHours(nightHours);

      // Find reference hours (2 before night starts, 4 after night ends)
      const referenceHours = findReferenceHours(data_1h, sortedNightHours);

      // Calculate astrophotography score (only using night hours, not reference hours)
      const avgCloudCover =
        sortedNightHours.reduce((sum, h) => sum + h.totalcloudcover, 0) /
        sortedNightHours.length;
      const avgPrecipitation =
        sortedNightHours.reduce(
          (sum, h) => sum + h.precipitation_probability,
          0
        ) / sortedNightHours.length;

      // Calculate moonlight and sky brightness averages (only for night hours)
      const avgMoonlight = sortedNightHours.some(
        (h) => h.moonlight_actual !== undefined
      )
        ? sortedNightHours.reduce(
            (sum, h) => sum + (h.moonlight_actual || 0),
            0
          ) / sortedNightHours.length
        : undefined;

      const avgSkyBrightness = sortedNightHours.some(
        (h) => h.nightskybrightness_actual !== undefined
      )
        ? sortedNightHours.reduce(
            (sum, h) => sum + (h.nightskybrightness_actual || 0),
            0
          ) / sortedNightHours.length
        : undefined;

      // Calculate average windspeed in km/h (convert from m/s)
      const avgWindspeed =
        (sortedNightHours.reduce((sum, h) => sum + h.windspeed, 0) /
          sortedNightHours.length) *
        3.6;

      const astrophotographyScore = calculateAstrophotographyScore(
        avgCloudCover,
        avgPrecipitation
      );

      days.push({
        date: displayDate,
        dayName,
        nightHours: sortedNightHours,
        referenceHours,
        astrophotographyScore,
        avgCloudCover,
        avgPrecipitation,
        avgMoonlight,
        avgSkyBrightness,
        avgWindspeed,
        source: "meteoblue",
      });
    }
  });

  return days.sort((a, b) => a.date.localeCompare(b.date));
}

// Process solar astrophotography data (day hours - opposite of night hours)
export function processSolarData(data: WeatherData): DayData[] {
  const { data_1h } = data;
  const days: DayData[] = [];

  // Group hourly data by day for solar hours (all daylight hours)
  const solarGroups = new Map<string, HourlyData[]>();

  data_1h.time.forEach((timeStr: string, index: number) => {
    const isDaylight = data_1h.isdaylight[index] === 1;

    // Include all daylight hours (opposite of night logic)
    if (isDaylight) {
      const date = timeStr.split(" ")[0];
      const dateKey = date;

      if (!solarGroups.has(dateKey)) {
        solarGroups.set(dateKey, []);
      }

      solarGroups.get(dateKey)!.push({
        time: timeStr,
        totalcloudcover: data_1h.totalcloudcover[index],
        precipitation_probability: data_1h.precipitation_probability[index],
        temperature: data_1h.temperature[index],
        windspeed: data_1h.windspeed[index],
        relativehumidity: data_1h.relativehumidity[index],
        nightskybrightness_actual: data_1h.nightskybrightness_actual?.[index],
        moonlight_actual: data_1h.moonlight_actual?.[index],
      });
    }
  });

  // Process each day's solar hours
  solarGroups.forEach((solarHours, dateKey) => {
    if (solarHours.length > 0) {
      const sortedSolarHours = solarHours.sort((a, b) => {
        const timeA = new Date(a.time);
        const timeB = new Date(b.time);
        return timeA.getTime() - timeB.getTime();
      });

      // Calculate day name and display date
      const date = new Date(dateKey + "T12:00:00");
      const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
      const displayDate = dateKey;

      // Calculate averages for solar conditions
      const avgCloudCover =
        sortedSolarHours.reduce((sum, h) => sum + h.totalcloudcover, 0) /
        sortedSolarHours.length;
      const avgPrecipitation =
        sortedSolarHours.reduce(
          (sum, h) => sum + h.precipitation_probability,
          0
        ) / sortedSolarHours.length;

      // Calculate average windspeed in km/h (convert from m/s)
      const avgWindspeed =
        (sortedSolarHours.reduce((sum, h) => sum + h.windspeed, 0) /
          sortedSolarHours.length) *
        3.6;

      const astrophotographyScore = calculateAstrophotographyScore(
        avgCloudCover,
        avgPrecipitation
      );

      days.push({
        date: displayDate,
        dayName,
        nightHours: sortedSolarHours, // Reusing nightHours field for solar hours
        referenceHours: { before: [], after: [] }, // No reference hours for solar
        astrophotographyScore,
        avgCloudCover,
        avgPrecipitation,
        avgWindspeed,
        source: "meteoblue",
      });
    }
  });

  return days.sort((a, b) => a.date.localeCompare(b.date));
}

export function sortNightHours(nightHours: HourlyData[]): HourlyData[] {
  return nightHours.sort((a, b) => {
    const timeA = new Date(a.time);
    const timeB = new Date(b.time);
    const hourA = timeA.getHours();
    const hourB = timeB.getHours();

    // Convert hours to a sortable format where evening hours (18-23) come first,
    // then early morning hours (0-6)
    const getSortableHour = (hour: number) => {
      if (hour >= 18) return hour - 18; // 18:00 becomes 0, 23:00 becomes 5
      if (hour <= 6) return hour + 6; // 0:00 becomes 6, 6:00 becomes 12
      return hour + 24; // This shouldn't happen for night hours, but just in case
    };

    const sortableA = getSortableHour(hourA);
    const sortableB = getSortableHour(hourB);

    if (sortableA !== sortableB) {
      return sortableA - sortableB;
    }

    // If same sortable hour, sort by actual time
    return timeA.getTime() - timeB.getTime();
  });
}

function findReferenceHours(
  data_1h: WeatherData["data_1h"],
  nightHours: HourlyData[]
): { before: HourlyData[]; after: HourlyData[] } {
  if (nightHours.length === 0) {
    return { before: [], after: [] };
  }

  // Find the earliest and latest night hours
  const sortedByTime = [...nightHours].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
  );
  const firstNightHour = sortedByTime[0];
  const lastNightHour = sortedByTime[sortedByTime.length - 1];

  const beforeHours: HourlyData[] = [];
  const afterHours: HourlyData[] = [];

  // Find 4 hours before night starts using string manipulation to avoid timezone issues
  const [firstDatePart, firstTimePart] = firstNightHour.time.split(" ");
  const [firstYear, firstMonth, firstDay] = firstDatePart
    .split("-")
    .map(Number);
  const [firstHour] = firstTimePart.split(":").map(Number);

  // Get 4 hours before (e.g. 19:00-22:00 if night starts at 23:00)
  for (let i = 4; i >= 1; i--) {
    let targetHour = firstHour - i;
    let targetDay = firstDay;
    let targetMonth = firstMonth;
    let targetYear = firstYear;

    // Handle day rollover
    if (targetHour < 0) {
      targetHour += 24;
      targetDay -= 1;
      if (targetDay < 1) {
        targetMonth -= 1;
        if (targetMonth < 1) {
          targetMonth = 12;
          targetYear -= 1;
        }
        const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
        targetDay = daysInMonth;
      }
    }

    const targetTimeStr = `${targetYear}-${String(targetMonth).padStart(
      2,
      "0"
    )}-${String(targetDay).padStart(2, "0")} ${String(targetHour).padStart(
      2,
      "0"
    )}:00`;

    const index = data_1h.time.findIndex((t: string) => t === targetTimeStr);
    if (index !== -1) {
      beforeHours.push({
        time: data_1h.time[index],
        totalcloudcover: data_1h.totalcloudcover[index],
        precipitation_probability: data_1h.precipitation_probability[index],
        temperature: data_1h.temperature[index],
        windspeed: data_1h.windspeed[index],
        relativehumidity: data_1h.relativehumidity[index],
        nightskybrightness_actual: data_1h.nightskybrightness_actual?.[index],
        moonlight_actual: data_1h.moonlight_actual?.[index],
      });
    }
  }

  // Find hours after night ends until 10am using string manipulation
  const [lastDatePart, lastTimePart] = lastNightHour.time.split(" ");
  const [lastYear, lastMonth, lastDay] = lastDatePart.split("-").map(Number);
  const [lastHour] = lastTimePart.split(":").map(Number);

  let currentHour = lastHour + 1;
  let currentDay = lastDay;
  let currentMonth = lastMonth;
  let currentYear = lastYear;

  // Continue until we reach and include 10am
  while (true) {
    // Handle day rollover
    if (currentHour >= 24) {
      currentHour = 0;
      currentDay += 1;
      const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
      if (currentDay > daysInMonth) {
        currentDay = 1;
        currentMonth += 1;
        if (currentMonth > 12) {
          currentMonth = 1;
          currentYear += 1;
        }
      }
    }

    const targetTimeStr = `${currentYear}-${String(currentMonth).padStart(
      2,
      "0"
    )}-${String(currentDay).padStart(2, "0")} ${String(currentHour).padStart(
      2,
      "0"
    )}:00`;

    const index = data_1h.time.findIndex((t: string) => t === targetTimeStr);
    if (index !== -1) {
      afterHours.push({
        time: data_1h.time[index],
        totalcloudcover: data_1h.totalcloudcover[index],
        precipitation_probability: data_1h.precipitation_probability[index],
        temperature: data_1h.temperature[index],
        windspeed: data_1h.windspeed[index],
        relativehumidity: data_1h.relativehumidity[index],
        nightskybrightness_actual: data_1h.nightskybrightness_actual?.[index],
        moonlight_actual: data_1h.moonlight_actual?.[index],
      });
    } else {
      // If we can't find the hour in data, stop
      break;
    }

    // Stop after including 10am
    if (currentHour === 10) {
      break;
    }

    currentHour += 1;

    // Safety check to prevent infinite loop
    if (afterHours.length > 15) break;
  }

  return { before: beforeHours, after: afterHours };
}

export function calculateAstrophotographyScore(
  cloudCover: number,
  precipitationProb: number
): number {
  // Score from 0-100 where 100 is perfect conditions
  // Cloud cover penalty: 0% = no penalty, 100% = -80 points
  const cloudPenalty = (cloudCover / 100) * 80;

  // Precipitation penalty: 0% = no penalty, 100% = -20 points
  const precipPenalty = (precipitationProb / 100) * 20;

  const score = Math.max(0, 100 - cloudPenalty - precipPenalty);
  return Math.round(score);
}

export function getScoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Very Good";
  if (score >= 60) return "Good";
  if (score >= 45) return "Fair";
  if (score >= 30) return "Poor";
  return "Very Poor";
}

export function getScoreColor(score: number): string {
  if (score >= 90) return "text-emerald-400";
  if (score >= 75) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  if (score >= 45) return "text-orange-400";
  if (score >= 30) return "text-red-400";
  return "text-red-600";
}

export function formatTime(timeStr: string): string {
  const date = new Date(timeStr);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
