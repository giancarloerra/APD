// Simple weather processing for JSON API endpoint
// Reuses the same logic as the frontend but in plain JavaScript

function isYesterday(dateString) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const yesterdayString = yesterday.toISOString().split("T")[0]; // "YYYY-MM-DD"
  return dateString === yesterdayString;
}

export function createWeatherSummary(meteoblueData, metOfficeData, forecast) {
  // Location from whichever source is available
  const latitude =
    meteoblueData?.metadata?.latitude ||
    metOfficeData?.latitude ||
    52.6308;
  const longitude =
    meteoblueData?.metadata?.longitude ||
    metOfficeData?.longitude ||
    -1.2973;

  const summary = {
    current_time: new Date().toISOString(),
    location: { latitude, longitude },
    meteoblue_forecast: null,
    met_office_forecast: null,
  };

  // Process Meteoblue data
  if (meteoblueData && meteoblueData.data_1h) {
    const allNights = processNightForecast(meteoblueData.data_1h, "Meteoblue");
    summary.meteoblue_forecast = allNights.filter(
      (night) => !isYesterday(night.date)
    );
  }

  // Process Met Office data independently (no Meteoblue dependency)
  if (metOfficeData && metOfficeData.hourly) {
    const allNights = processMetOfficeNightForecast(metOfficeData);
    summary.met_office_forecast = allNights.filter(
      (night) => !isYesterday(night.date)
    );
  }

  if (forecast) {
    if (!meteoblueData && !metOfficeData && forecast.location) {
      summary.location = { latitude: forecast.location.latitude, longitude: forecast.location.longitude };
    }
    const additional = {
      ukv: "ukv_forecast", ecmwf: "ecmwf_forecast", gfs: "gfs_forecast",
      icon: "icon_forecast", metnorway: "met_norway_forecast",
      metservice: "metservice_forecast", timer: "seven_timer_forecast",
    };
    const rounded = value => value === null ? null : Math.round(value);
    for (const [id, key] of Object.entries(additional)) {
      const provider = forecast.providers.find(source => source.id === id);
      if (provider?.status !== "ok" || !forecast.nightSessions) {
        summary[key] = null;
        continue;
      }
      summary[key] = forecast.nightSessions.flatMap(night => {
        const source = night.sources[id];
        const hours = id === "timer" ? night.atmosphere.samples : source?.hourly;
        if (!hours?.length) return [];
        const conditions = source?.summary;
        const score = conditions?.score.value ?? null;
        const probability = conditions?.precipitationProbability.value ?? null;
        return [{
          date: night.date,
          day_name: night.dayName,
          night_duration: {
            hours: id === "timer" ? night.durationHours : hours.length,
            start_time: hours[0].localTime,
            end_time: hours.at(-1).localTime,
          },
          conditions: {
            astrophotography_score: score,
            avg_cloud_cover: rounded(conditions?.cloudCover.value ?? null),
            ...(probability === null
              ? { total_precipitation_mm: rounded(conditions?.precipitationAmount.value ?? null) }
              : { avg_precipitation_percent: rounded(probability) }),
            quality: score === null ? null : getQualityDescription(score),
          },
          source: provider.name,
        }];
      });
    }
  }
  return summary;
}

function processNightForecast(data_1h, source) {
  const nightGroups = new Map();

  // Group night hours by day (same logic as frontend)
  data_1h.time.forEach((timeStr, index) => {
    if (data_1h.isdaylight[index] === 0) {
      const [datePart, timePart] = timeStr.split(" ");
      const [year, month, day] = datePart.split("-").map(Number);
      const [hour] = timePart.split(":").map(Number);

      // Determine which "night day" this hour belongs to
      let nightDate;
      if (hour >= 0 && hour <= 6) {
        nightDate = new Date(year, month - 1, day - 1);
      } else {
        nightDate = new Date(year, month - 1, day);
      }

      const dateKey = nightDate.toISOString().split("T")[0];

      if (!nightGroups.has(dateKey)) {
        nightGroups.set(dateKey, []);
      }

      nightGroups.get(dateKey).push({
        time: timeStr,
        cloud_cover: data_1h.totalcloudcover[index],
        precipitation_probability: data_1h.precipitation_probability[index],
        temperature: data_1h.temperature[index],
      });
    }
  });

  // Convert to array and calculate summaries
  const nights = [];
  nightGroups.forEach((nightHours, dateKey) => {
    if (nightHours.length > 0) {
      // Find midnight hour to determine correct day name
      const midnightHour = nightHours.find((hour) => {
        const [, timePart] = hour.time.split(" ");
        return timePart === "00:00";
      });

      let dayName = "Unknown";
      let displayDate = dateKey;

      if (midnightHour) {
        const [datePart] = midnightHour.time.split(" ");
        const [year, month, day] = datePart.split("-").map(Number);

        const prevDay = day - 1;
        let finalYear = year;
        let finalMonth = month;
        let finalDay = prevDay;

        if (prevDay < 1) {
          finalMonth = month - 1;
          if (finalMonth < 1) {
            finalMonth = 12;
            finalYear = year - 1;
          }
          const daysInMonth = new Date(finalYear, finalMonth, 0).getDate();
          finalDay = daysInMonth;
        }

        displayDate = `${finalYear}-${String(finalMonth).padStart(
          2,
          "0"
        )}-${String(finalDay).padStart(2, "0")}`;
        const dayNameDate = new Date(displayDate + "T12:00:00");
        dayName = dayNameDate.toLocaleDateString("en-US", { weekday: "long" });
      }

      // Calculate averages
      const avgCloudCover =
        nightHours.reduce((sum, h) => sum + h.cloud_cover, 0) /
        nightHours.length;
      const avgPrecipitation =
        nightHours.reduce((sum, h) => sum + h.precipitation_probability, 0) /
        nightHours.length;

      // Calculate astrophotography score
      const cloudPenalty = (avgCloudCover / 100) * 80;
      const precipPenalty = (avgPrecipitation / 100) * 20;
      const astrophotographyScore = Math.max(
        0,
        Math.round(100 - cloudPenalty - precipPenalty)
      );

      // Get night duration
      const sortedHours = nightHours.sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );
      const startTime = sortedHours[0].time.split(" ")[1];
      const endTime = sortedHours[sortedHours.length - 1].time.split(" ")[1];

      nights.push({
        date: displayDate,
        day_name: dayName,
        night_duration: {
          hours: nightHours.length,
          start_time: startTime,
          end_time: endTime,
        },
        conditions: {
          astrophotography_score: astrophotographyScore,
          avg_cloud_cover: Math.round(avgCloudCover),
          avg_precipitation_percent: Math.round(avgPrecipitation),
          quality: getQualityDescription(astrophotographyScore),
        },
        source: source,
      });
    }
  });

  return nights.sort((a, b) => a.date.localeCompare(b.date));
}

function processMetOfficeNightForecast(metOfficeData) {
  // Use Met Office's own is_day field for night detection — no Meteoblue dependency
  const nightGroups = new Map();

  metOfficeData.hourly.time.forEach((isoTimeStr, index) => {
    if (metOfficeData.hourly.is_day[index] === 0) {
      // Convert ISO "2026-03-08T22:00" to space format "2026-03-08 22:00"
      const timeStr = isoTimeStr.replace("T", " ");
      const [datePart, timePart] = timeStr.split(" ");
      const [year, month, day] = datePart.split("-").map(Number);
      const [hour] = timePart.split(":").map(Number);

      let nightDate;
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
        nightGroups.get(dateKey).push({
          time: timeStr,
          cloud_cover: cloudCover,
          precipitation_probability: precipitation || 0,
          temperature: temperature || 0,
        });
      }
    }
  });

  // Use same processing logic as Meteoblue
  const nights = [];
  nightGroups.forEach((nightHours, dateKey) => {
    if (nightHours.length > 0) {
      // Same day name calculation logic
      const midnightHour = nightHours.find((hour) => {
        const [, timePart] = hour.time.split(" ");
        return timePart === "00:00";
      });

      let dayName = "Unknown";
      let displayDate = dateKey;

      if (midnightHour) {
        const [datePart] = midnightHour.time.split(" ");
        const [year, month, day] = datePart.split("-").map(Number);

        const prevDay = day - 1;
        let finalYear = year;
        let finalMonth = month;
        let finalDay = prevDay;

        if (prevDay < 1) {
          finalMonth = month - 1;
          if (finalMonth < 1) {
            finalMonth = 12;
            finalYear = year - 1;
          }
          const daysInMonth = new Date(finalYear, finalMonth, 0).getDate();
          finalDay = daysInMonth;
        }

        displayDate = `${finalYear}-${String(finalMonth).padStart(
          2,
          "0"
        )}-${String(finalDay).padStart(2, "0")}`;
        const dayNameDate = new Date(displayDate + "T12:00:00");
        dayName = dayNameDate.toLocaleDateString("en-US", { weekday: "long" });
      }

      // Calculate averages and score
      const avgCloudCover =
        nightHours.reduce((sum, h) => sum + h.cloud_cover, 0) /
        nightHours.length;
      // For Met Office: calculate total precipitation (mm), not average
      const totalPrecipitation = nightHours.reduce(
        (sum, h) => sum + h.precipitation_probability,
        0
      );

      // Met Office: Only use cloud cover for scoring, exclude precipitation (mm vs %)
      const cloudPenalty = (avgCloudCover / 100) * 80;
      const astrophotographyScore = Math.max(0, Math.round(100 - cloudPenalty));

      const sortedHours = nightHours.sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );
      const startTime = sortedHours[0].time.split(" ")[1];
      const endTime = sortedHours[sortedHours.length - 1].time.split(" ")[1];

      nights.push({
        date: displayDate,
        day_name: dayName,
        night_duration: {
          hours: nightHours.length,
          start_time: startTime,
          end_time: endTime,
        },
        conditions: {
          astrophotography_score: astrophotographyScore,
          avg_cloud_cover: Math.round(avgCloudCover),
          total_precipitation_mm: Math.round(totalPrecipitation),
          quality: getQualityDescription(astrophotographyScore),
        },
        source: "Met Office",
      });
    }
  });

  return nights.sort((a, b) => a.date.localeCompare(b.date));
}

function getQualityDescription(score) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Very Good";
  if (score >= 60) return "Good";
  if (score >= 45) return "Fair";
  if (score >= 30) return "Poor";
  return "Very Poor";
}
