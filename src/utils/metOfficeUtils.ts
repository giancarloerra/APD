import { WeatherData, DayData, HourlyData } from "../types/weather";
import { sortNightHours, calculateAstrophotographyScore } from "./weatherUtils";

export interface MetOfficeData {
  latitude: number;
  longitude: number;
  hourly: {
    time: string[];
    precipitation: number[];
    cloud_cover: number[];
    temperature_2m: number[];
    is_day: number[];
  };
}

export function processMetOfficeData(
  metOfficeData: MetOfficeData
): DayData[] {
  if (!metOfficeData) {
    return [];
  }

  const days: DayData[] = [];

  // Group hourly data by "night day" - using Met Office's own is_day field
  const nightGroups = new Map<string, HourlyData[]>();

  metOfficeData.hourly.time.forEach((isoTimeStr, index) => {
    // Use Met Office's own is_day for night detection (no Meteoblue dependency)
    if (metOfficeData.hourly.is_day[index] === 0) {
      // Convert ISO "2026-03-08T22:00" → space format "2026-03-08 22:00" for
      // internal consistency with sortNightHours / findMetOfficeReferenceHours
      const timeStr = isoTimeStr.replace("T", " ");
      const [datePart, timePart] = timeStr.split(" ");
      const [year, month, day] = datePart.split("-").map(Number);
      const [hour] = timePart.split(":").map(Number);

      let nightDate: Date;
      if (hour >= 0 && hour <= 6) {
        nightDate = new Date(year, month - 1, day - 1);
      } else {
        nightDate = new Date(year, month - 1, day);
      }

      const dateKey = nightDate.toISOString().split("T")[0];

      if (!nightGroups.has(dateKey)) {
        nightGroups.set(dateKey, []);
      }

      const cloudCover = metOfficeData.hourly.cloud_cover[index];
      const precipitation = metOfficeData.hourly.precipitation[index];
      const temperature = metOfficeData.hourly.temperature_2m[index];

      if (cloudCover !== null && cloudCover !== undefined) {
        nightGroups.get(dateKey)!.push({
          time: timeStr,
          totalcloudcover: cloudCover,
          precipitation_probability: precipitation || 0,
          temperature: temperature || 0,
          windspeed: 0, // Not available in Met Office data
          relativehumidity: 0, // Not available in Met Office data
        });
      }
    }
  });

  // Process each night group (same logic as Meteoblue processing)
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

      // Find reference hours (4 h before / after night) from Met Office data
      const referenceHours = findMetOfficeReferenceHours(
        metOfficeData,
        sortedNightHours
      );

      // Calculate astrophotography score (only using night hours, not reference hours)
      const avgCloudCover =
        sortedNightHours.reduce((sum, h) => sum + h.totalcloudcover, 0) /
        sortedNightHours.length;
      // For Met Office: calculate total precipitation (mm), not average
      const avgPrecipitation = sortedNightHours.reduce(
        (sum, h) => sum + h.precipitation_probability,
        0
      ); // No division - we want total mm, not average

      // Met Office: Only use cloud cover for scoring, exclude precipitation (mm vs %)
      const astrophotographyScore = calculateAstrophotographyScore(
        avgCloudCover,
        0 // Exclude precipitation from Met Office scoring
      );

      days.push({
        date: displayDate,
        dayName,
        nightHours: sortedNightHours,
        referenceHours,
        astrophotographyScore,
        avgCloudCover,
        avgPrecipitation,
        source: "metoffice",
      });
    }
  });

  return days.sort((a, b) => a.date.localeCompare(b.date));
}

// Process Met Office solar data (day hours - opposite of night hours)
export function processMetOfficeSolarData(
  metOfficeData: MetOfficeData,
  meteoblueData?: WeatherData
): DayData[] {
  if (!metOfficeData) return [];

  const days: DayData[] = [];

  // Group hourly data by day for solar hours using Met Office's own is_day
  const solarGroups = new Map<string, HourlyData[]>();

  metOfficeData.hourly.time.forEach((isoTimeStr: string, index: number) => {
    if (metOfficeData.hourly.is_day[index] === 1) {
      // Convert ISO to space format for internal consistency
      const timeStr = isoTimeStr.replace("T", " ");
      const dateKey = timeStr.split(" ")[0];

      // Optionally enrich with Meteoblue wind/humidity when available
      let windspeed = 0;
      let relativehumidity = 0;
      if (meteoblueData) {
        const mbIndex = meteoblueData.data_1h.time.indexOf(timeStr);
        if (mbIndex !== -1) {
          windspeed = meteoblueData.data_1h.windspeed[mbIndex];
          relativehumidity = meteoblueData.data_1h.relativehumidity[mbIndex];
        }
      }

      if (!solarGroups.has(dateKey)) {
        solarGroups.set(dateKey, []);
      }

      solarGroups.get(dateKey)!.push({
        time: timeStr,
        totalcloudcover: metOfficeData.hourly.cloud_cover[index] || 0,
        precipitation_probability: metOfficeData.hourly.precipitation[index] || 0,
        temperature: metOfficeData.hourly.temperature_2m[index] || 0,
        windspeed,
        relativehumidity,
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

      // For Met Office: calculate total precipitation (mm), not average
      const totalPrecipitation = sortedSolarHours.reduce(
        (sum, h) => sum + h.precipitation_probability,
        0
      );

      // Calculate average windspeed in km/h (convert from m/s)
      const avgWindspeed =
        (sortedSolarHours.reduce((sum, h) => sum + h.windspeed, 0) /
          sortedSolarHours.length) *
        3.6;

      // Met Office: Only use cloud cover for scoring, exclude precipitation (mm vs %)
      const astrophotographyScore = calculateAstrophotographyScore(
        avgCloudCover,
        0 // Exclude precipitation from Met Office scoring
      );

      days.push({
        date: displayDate,
        dayName,
        nightHours: sortedSolarHours, // Reusing nightHours field for solar hours
        referenceHours: { before: [], after: [] }, // No reference hours for solar
        astrophotographyScore,
        avgCloudCover,
        avgPrecipitation: totalPrecipitation,
        avgWindspeed,
        source: "metoffice",
      });
    }
  });

  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function findMetOfficeIndex(
  metOfficeData: MetOfficeData,
  meteoblueTimeStr: string
): number {
  // Convert Meteoblue time format "2025-06-25 22:00" to Met Office format "2025-06-25T22:00"
  const metOfficeTimeStr = meteoblueTimeStr.replace(" ", "T");
  const index = metOfficeData.hourly.time.findIndex(
    (time) => time === metOfficeTimeStr
  );



  return index;
}

function findMetOfficeReferenceHours(
  metOfficeData: MetOfficeData,
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

    const metOfficeIndex = findMetOfficeIndex(metOfficeData, targetTimeStr);
    if (metOfficeIndex !== -1) {
      beforeHours.push({
        time: targetTimeStr,
        totalcloudcover: metOfficeData.hourly.cloud_cover[metOfficeIndex] || 0,
        precipitation_probability:
          metOfficeData.hourly.precipitation[metOfficeIndex] || 0,
        temperature: metOfficeData.hourly.temperature_2m[metOfficeIndex] || 0,
        windspeed: 0,
        relativehumidity: 0,
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

    const metOfficeIndex = findMetOfficeIndex(metOfficeData, targetTimeStr);
    if (metOfficeIndex !== -1) {
      afterHours.push({
        time: targetTimeStr,
        totalcloudcover: metOfficeData.hourly.cloud_cover[metOfficeIndex] || 0,
        precipitation_probability:
          metOfficeData.hourly.precipitation[metOfficeIndex] || 0,
        temperature: metOfficeData.hourly.temperature_2m[metOfficeIndex] || 0,
        windspeed: 0,
        relativehumidity: 0,
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
