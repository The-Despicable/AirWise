/**
 * Environmental context normalization — authoritative snapshot per request.
 * Reuses Open-Meteo helpers; represents missing values explicitly as null.
 * Does not substitute defaults for missing data.
 */

import {
  getEnvironmentalData,
  weatherCodeToCondition,
  aqiCategory,
  windDirectionToCompass,
} from "@/lib/environmental";

export interface NormalizedEnv {
  // Coordinates & location
  latitude: number;
  longitude: number;
  displayName: string;
  isDefault: boolean;
  timezone: string | null;

  // Current weather
  temperature: number | null;
  apparentTemperature: number | null;
  humidity: number | null;
  weatherCode: number | null;
  condition: string;
  isDay: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGusts: number | null;
  windCompass: string;
  precipitation: number | null;
  surfacePressure: number | null;
  cloudCover: number | null;

  // Air quality (may be unavailable independently)
  aqiUs: number | null;
  aqiCategory: string | null;
  pm25: number | null;
  pm10: number | null;
  airQualityAvailable: boolean;
  airQualityError: string | null;

  // Metadata
  fetchedAt: string;
  validTime: string | null;
  source: string;
}

/**
 * Build normalized environmental snapshot for a given location.
 * - Preserves zero as valid reading
 * - Represents missing as null
 * - Does not fabricate clean air when AQI unavailable
 * - Handles weather/AQI/geocoding failures independently
 */
export async function buildEnvContext(
  latitude: number,
  longitude: number,
  displayName: string,
  isDefault: boolean
): Promise<NormalizedEnv> {
  // Fetch raw environmental data (uses Open-Meteo under the hood)
  const env = await getEnvironmentalData(latitude, longitude, isDefault);

  // Weather condition from code
  const condition =
    env.weatherCode !== null ? weatherCodeToCondition(env.weatherCode) : "Unknown";

  // Wind compass
  const windCompass =
    env.windDirection !== null
      ? windDirectionToCompass(env.windDirection)
      : "--";

  // AQI category
  let aqiCategoryLabel: string | null = null;
  if (env.aqiUs !== null) {
    aqiCategoryLabel = aqiCategory(env.aqiUs).category;
  }

  return {
    latitude,
    longitude,
    displayName,
    isDefault,
    timezone: env.timezone,

    temperature: env.temperature ?? null,
    apparentTemperature: env.apparentTemperature ?? null,
    humidity: env.humidity ?? null,
    weatherCode: env.weatherCode ?? null,
    condition,
    isDay: env.isDay ?? null,
    windSpeed: env.windSpeed ?? null,
    windDirection: env.windDirection ?? null,
    windGusts: env.windGusts ?? null,
    windCompass,
    precipitation: env.precipitation ?? null,
    surfacePressure: env.surfacePressure ?? null,
    cloudCover: env.cloudCover ?? null,

    aqiUs: env.aqiUs ?? null,
    aqiCategory: aqiCategoryLabel,
    pm25: env.pm25 ?? null,
    pm10: env.pm10 ?? null,
    airQualityAvailable: env.airQualityAvailable,
    airQualityError: env.airQualityError,

    fetchedAt: env.fetchedAt,
    validTime: env.validTime,
    source: env.source,
  };
}

/**
 * Format a concise context string for the user message.
 * Missing values shown as "?" — never substituted.
 */
export function formatEnvForPrompt(env: NormalizedEnv): string {
  const aqiPart =
    env.aqiUs !== null
      ? `US AQI ${env.aqiUs} (${env.aqiCategory})`
      : env.airQualityAvailable
        ? "AQI unavailable"
        : "AQI error: " + (env.airQualityError ?? "unavailable");

  return (
    `[Location: ${env.displayName} | ` +
    `Temp: ${env.temperature !== null ? env.temperature + "°C" : "?"} | ` +
    `Feels: ${env.apparentTemperature !== null ? env.apparentTemperature + "°C" : "?"} | ` +
    `Humidity: ${env.humidity !== null ? env.humidity + "%" : "?"} | ` +
    `Conditions: ${env.condition} | ` +
    `Wind: ${env.windSpeed !== null ? env.windSpeed + " km/h from " + env.windCompass : "?"} | ` +
    `${aqiPart}]`
  );
}

/**
 * Build data summary for API response — labeled as data, not model output.
 */
export function buildDataSummary(env: NormalizedEnv) {
  return {
    location: env.displayName,
    temperature: env.temperature,
    apparentTemperature: env.apparentTemperature,
    humidity: env.humidity,
    condition: env.condition,
    windSpeed: env.windSpeed,
    windCompass: env.windCompass,
    aqiUs: env.aqiUs,
    aqiCategory: env.aqiCategory,
    pm25: env.pm25,
    pm10: env.pm10,
    isDefault: env.isDefault,
    fetchedAt: env.fetchedAt,
    validTime: env.validTime,
    airQualityAvailable: env.airQualityAvailable,
    airQualityError: env.airQualityError,
  };
}