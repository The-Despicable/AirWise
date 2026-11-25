/**
 * Environmental data fetching
 * Fetches live weather, air quality, and precipitation data from Open-Meteo.
 * Supports arbitrary coordinates; Hyderabad (17.385, 78.4867) is the labelled default
 * for backward compatibility — it is never presented as the user's detected location.
 */

export interface EnvironmentalData {
  dayOfWeek: string;
  formattedDate: string;
  formattedTime: string;
  timezone: string;
  latitude: number;
  longitude: number;
  elevation: number | null;
  temperature: number;
  apparentTemperature: number | null;
  humidity: number;
  windSpeed: number;
  windDirection: number | null;
  windGusts: number | null;
  precipitationProbability: number;
  precipitation: number;
  isRaining: boolean;
  cloudCover: number | null;
  surfacePressure: number | null;
  weatherCode: number | null;
  isDay: number | null;
  pm25: number | null;
  pm10: number | null;
  aqiUs: number | null;
  airQualityAvailable: boolean;
  airQualityError: string | null;
  validTime: string | null;
  fetchedAt: string;
  source: string;
}

/**
 * Default Hyderabad coordinates (explicitly labelled as default, not user-detected).
 */
const HYDERABAD_LAT = 17.385;
const HYDERABAD_LON = 78.4867;

/**
 * WMO weather code interpretation.
 */
function weatherCodeToCondition(code: number | null): string {
  if (code === null || code === undefined) return "Unknown";
  // WMO weather codes (subset)
  const codes: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  };
  return codes[code] ?? `Weather code ${code}`;
}

/**
 * US AQI category from AQI value.
 */
function aqiCategory(aqi: number | null): { category: string; color: string } {
  if (aqi === null || aqi === undefined) {
    return { category: "Unavailable", color: "text-white/40" };
  }
  if (aqi <= 50) return { category: "Good", color: "text-emerald-400" };
  if (aqi <= 100) return { category: "Moderate", color: "text-amber-400" };
  if (aqi <= 150) return { category: "Unhealthy for Sensitive Groups", color: "text-rose-400" };
  if (aqi <= 200) return { category: "Unhealthy", color: "text-red-400" };
  if (aqi <= 300) return { category: "Very Unhealthy", color: "text-purple-400" };
  return { category: "Hazardous", color: "text-maroon-400" };
}

/**
 * Compass direction from degrees (meteorological: where wind comes FROM).
 */
function windDirectionToCompass(degrees: number | null): string {
  if (degrees === null || degrees === undefined) return "--";
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

/**
 * Fetches environmental data for arbitrary coordinates from Open-Meteo.
 * Falls back to Hyderabad defaults only when no coordinates are provided.
 */
export async function getEnvironmentalData(
  latitude: number = HYDERABAD_LAT,
  longitude: number = HYDERABAD_LON,
  isDefaultLocation: boolean = false
): Promise<EnvironmentalData> {
  const displayLabel = isDefaultLocation
    ? `Hyderabad, Telangana, India (default: ${HYDERABAD_LAT}, ${HYDERABAD_LON})`
    : `(${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;

  try {
    // Fetch weather data
    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.searchParams.set("latitude", latitude.toString());
    weatherUrl.searchParams.set("longitude", longitude.toString());
    weatherUrl.searchParams.set("timezone", "auto");
    weatherUrl.searchParams.set("temperature_unit", "celsius");
    weatherUrl.searchParams.set("windspeed_unit", "kmh");
    weatherUrl.searchParams.set("precipitation_unit", "mm");
    weatherUrl.searchParams.set(
      "current",
      [
        "temperature_2m",
        "apparent_temperature",
        "relative_humidity_2m",
        "weather_code",
        "is_day",
        "wind_speed_10m",
        "wind_direction_10m",
        "wind_gusts_10m",
        "surface_pressure",
        "cloud_cover",
        "precipitation",
      ].join(",")
    );
    weatherUrl.searchParams.set("forecast_days", "1");

    const weatherResponse = await fetch(weatherUrl.toString());
    if (!weatherResponse.ok) {
      throw new Error(`Open-Meteo weather API error: ${weatherResponse.status}`);
    }
    const weatherData = await weatherResponse.json();
    const current = weatherData.current ?? {};

    // Fetch air quality data
    let pm25: number | null = null;
    let pm10: number | null = null;
    let aqiUs: number | null = null;
    let airQualityAvailable = false;
    let airQualityError: string | null = null;

    try {
      const aqUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
      aqUrl.searchParams.set("latitude", latitude.toString());
      aqUrl.searchParams.set("longitude", longitude.toString());
      aqUrl.searchParams.set("timezone", "auto");
      aqUrl.searchParams.set("current", ["pm2_5", "pm10", "us_aqi"].join(","));

      const aqResponse = await fetch(aqUrl.toString());
      if (aqResponse.ok) {
        const aqData = await aqResponse.json();
        pm25 = aqData.current?.pm2_5 ?? null;
        pm10 = aqData.current?.pm10 ?? null;
        aqiUs = aqData.current?.us_aqi ?? null;
        airQualityAvailable = true;
      } else {
        airQualityError = `Air quality API error: ${aqResponse.status}`;
      }
    } catch (aqErr) {
      airQualityError = aqErr instanceof Error ? aqErr.message : "Air quality request failed.";
    }

    // Compute temporal data in the API's timezone
    const tz = weatherData.timezone ?? "UTC";
    const now = new Date();

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const formattedDate = formatter.format(now);
    const formattedTime = timeFormatter.format(now) + " " + tz.replace(/_/g, " ");
    const dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now);

    const temperature = current.temperature_2m ?? null;
    const humidity = current.relative_humidity_2m ?? null;
    const windSpeed = current.wind_speed_10m ?? null;
    const windDirection = current.wind_direction_10m ?? null;
    const precipitation = current.precipitation ?? null;
    const precipitationProbability = current.precipitation_probability ?? null;

    return {
      dayOfWeek,
      formattedDate,
      formattedTime,
      timezone: tz,
      latitude,
      longitude,
      elevation: weatherData.elevation ?? null,
      temperature: temperature ?? 0,
      apparentTemperature: current.apparent_temperature ?? null,
      humidity: humidity ?? 0,
      windSpeed: windSpeed ?? 0,
      windDirection,
      windGusts: current.wind_gusts_10m ?? null,
      precipitationProbability: precipitationProbability ?? 0,
      precipitation: precipitation ?? 0,
      isRaining: (precipitation ?? 0) > 0,
      cloudCover: current.cloud_cover ?? null,
      surfacePressure: current.surface_pressure ?? null,
      weatherCode: current.weather_code ?? null,
      isDay: current.is_day ?? null,
      pm25,
      pm10,
      aqiUs,
      airQualityAvailable,
      airQualityError,
      validTime: current.time ?? null,
      fetchedAt: new Date().toISOString(),
      source: `Open-Meteo model estimate for ${displayLabel}`,
    };
  } catch (error) {
    console.error("Failed to fetch environmental data:", error);

    // Fallback: return a clearly-labelled default, not fake live data
    const tz = "Asia/Kolkata";
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    return {
      dayOfWeek: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now),
      formattedDate: formatter.format(now),
      formattedTime: timeFormatter.format(now) + " IST",
      timezone: tz,
      latitude: HYDERABAD_LAT,
      longitude: HYDERABAD_LON,
      elevation: null,
      temperature: 0,
      apparentTemperature: null,
      humidity: 0,
      windSpeed: 0,
      windDirection: null,
      windGusts: null,
      precipitationProbability: 0,
      precipitation: 0,
      isRaining: false,
      cloudCover: null,
      surfacePressure: null,
      weatherCode: null,
      isDay: null,
      pm25: null,
      pm10: null,
      aqiUs: null,
      airQualityAvailable: false,
      airQualityError: error instanceof Error ? error.message : "Unknown error.",
      validTime: null,
      fetchedAt: new Date().toISOString(),
      source: `Open-Meteo (fallback — data unavailable for ${displayLabel})`,
    };
  }
}

export { weatherCodeToCondition, aqiCategory, windDirectionToCompass };
