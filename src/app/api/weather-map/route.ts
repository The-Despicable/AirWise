import { NextRequest, NextResponse } from "next/server";

// In-memory cache: key = "lat,lon", value = { data, timestamp }
interface CacheEntry {
  data: WeatherResponse;
  timestamp: number;
}
const WEATHER_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

function getCachedWeather(key: string): WeatherResponse | null {
  const entry = WEATHER_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    WEATHER_CACHE.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedWeather(key: string, data: WeatherResponse): void {
  WEATHER_CACHE.set(key, { data, timestamp: Date.now() });
}

// Type definitions for the weather API response
interface WeatherCurrent {
  temperature: number | null;
  apparentTemperature: number | null;
  relativeHumidity: number | null;
  weatherCode: number | null;
  isDay: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGusts: number | null;
  surfacePressure: number | null;
  cloudCover: number | null;
  precipitation: number | null;
}

interface WeatherHourly {
  time: string[];
  temperature: number[];
  precipitationProbability: number[];
  precipitation: number[];
  windSpeed: number[];
  windDirection: number[];
  cloudCover: number[];
}

interface WeatherDaily {
  time: string[];
  temperatureMax: number[];
  temperatureMin: number[];
  precipitationProbabilityMax: number[];
  sunrise: string[];
  sunset: string[];
}

interface AirQualityData {
  available: boolean;
  error: string | null;
  data: {
    usAqi: number | null;
    pm25: number | null;
    pm10: number | null;
    validTime: string | null;
  } | null;
}

interface WeatherResponse {
  requested: { latitude: number; longitude: number };
  grid: { latitude: number | null; longitude: number | null };
  timezone: string | null;
  utcOffsetSeconds: number | null;
  elevation: number | null;
  fetchedAt: string;
  validTime: string | null;
  units: Record<string, string>;
  current: WeatherCurrent;
  hourly: WeatherHourly;
  daily: WeatherDaily;
  airQuality: AirQualityData;
  source: {
    weather: string;
    airQuality: string;
    note: string;
  };
  fromCache: boolean;
}

// Open-Meteo API response types
interface OpenMeteoCurrent {
  temperature_2m?: number;
  apparent_temperature?: number;
  relative_humidity_2m?: number;
  weather_code?: number;
  is_day?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
  surface_pressure?: number;
  cloud_cover?: number;
  precipitation?: number;
  time?: string;
}

interface OpenMeteoHourly {
  time?: string[];
  temperature_2m?: number[];
  precipitation_probability?: number[];
  precipitation?: number[];
  wind_speed_10m?: number[];
  wind_direction_10m?: number[];
  cloud_cover?: number[];
}

interface OpenMeteoDaily {
  time?: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_probability_max?: number[];
  sunrise?: string[];
  sunset?: string[];
}

interface OpenMeteoWeatherResponse {
  current?: OpenMeteoCurrent;
  hourly?: OpenMeteoHourly;
  daily?: OpenMeteoDaily;
  current_units?: Record<string, string>;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  utc_offset_seconds?: number;
  elevation?: number;
}

interface OpenMeteoAirQualityCurrent {
  us_aqi?: number;
  pm2_5?: number;
  pm10?: number;
  time?: string;
}

interface OpenMeteoAirQualityResponse {
  current?: OpenMeteoAirQualityCurrent;
}

function validateCoordinate(
  value: string | null | undefined,
  name: string,
  min: number,
  max: number
): { valid: number | null; error: string | null } {
  if (value === null || value === undefined || value === "") {
    return { valid: null, error: `${name} is required.` };
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { valid: null, error: `${name} must be a finite number.` };
  }
  if (num < min || num > max) {
    return { valid: null, error: `${name} must be between ${min} and ${max}.` };
  }
  return { valid: num, error: null };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const latParam = searchParams.get("latitude");
  const lonParam = searchParams.get("longitude");

  const latValidation = validateCoordinate(latParam, "latitude", -90, 90);
  const lonValidation = validateCoordinate(lonParam, "longitude", -180, 180);

  if (latValidation.error || lonValidation.error) {
    return NextResponse.json(
      {
        error: "Invalid coordinates.",
        details: {
          latitude: latValidation.error,
          longitude: lonValidation.error,
        },
      },
      { status: 400 }
    );
  }

  const latitude = latValidation.valid!;
  const longitude = lonValidation.valid!;
  const cacheKey = getCacheKey(latitude, longitude);

  // Return cached data if available
  const cached = getCachedWeather(cacheKey);
  if (cached) {
    return NextResponse.json({ ...cached, fromCache: true });
  }

  const fetchWithTimeout = async (url: string, timeoutMs = 15000): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Fetch current weather + hourly + daily forecast from Open-Meteo
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
  weatherUrl.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "precipitation_probability",
      "precipitation",
      "wind_speed_10m",
      "wind_direction_10m",
      "cloud_cover",
    ].join(",")
  );
  weatherUrl.searchParams.set("forecast_days", "7");
  weatherUrl.searchParams.set(
    "daily",
    [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "sunrise",
      "sunset",
    ].join(",")
  );

  interface OpenMeteoWeatherResponse {
    current?: Record<string, unknown>;
    hourly?: Record<string, unknown>;
    daily?: Record<string, unknown>;
    current_units?: Record<string, string>;
    latitude?: number;
    longitude?: number;
    timezone?: string;
    utc_offset_seconds?: number;
    elevation?: number;
  }

  let weatherData: OpenMeteoWeatherResponse;
  let weatherRawTimestamp: string | null = null;

  try {
    const weatherResponse = await fetchWithTimeout(weatherUrl.toString());
    if (!weatherResponse.ok) {
      const errorBody = await weatherResponse.text();
      return NextResponse.json(
        { error: `Open-Meteo weather API error: ${weatherResponse.status}`, details: errorBody },
        { status: 502 }
      );
    }
    weatherData = await weatherResponse.json();
    weatherRawTimestamp = (weatherData.current?.time as string) ?? null;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Weather request timed out." }, { status: 504 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch weather data.", details: message },
      { status: 502 }
    );
  }

  interface OpenMeteoAirQualityResponse {
    current?: {
      us_aqi?: number;
      pm2_5?: number;
      pm10?: number;
      time?: string;
    };
  }

  // Fetch air quality from the separate Open-Meteo Air Quality API
  let airQualityData: OpenMeteoAirQualityResponse | null = null;
  let airQualityAvailable = false;
  let airQualityError: string | null = null;

  try {
    const aqUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    aqUrl.searchParams.set("latitude", latitude.toString());
    aqUrl.searchParams.set("longitude", longitude.toString());
    aqUrl.searchParams.set("timezone", "auto");
    aqUrl.searchParams.set("current", ["pm2_5", "pm10", "us_aqi"].join(","));

    const aqResponse = await fetchWithTimeout(aqUrl.toString());
    if (!aqResponse.ok) {
      airQualityError = `Air quality API error: ${aqResponse.status}`;
    } else {
      airQualityData = await aqResponse.json();
      airQualityAvailable = true;
    }
  } catch (err: unknown) {
    // Air-quality failure must not discard successful weather data
    airQualityError = err instanceof Error && err.name === "AbortError" ? "Air quality request timed out." : (err instanceof Error ? err.message : "Unknown error");
  }

  // Normalize the response
  const omWeather = weatherData as OpenMeteoWeatherResponse;
  const omCurrent: OpenMeteoCurrent = omWeather.current ?? {};
  const omHourly: OpenMeteoHourly = omWeather.hourly ?? {};
  const omDaily: OpenMeteoDaily = omWeather.daily ?? {};

  const response: WeatherResponse = {
    requested: { latitude, longitude },
    grid: {
      latitude: weatherData?.latitude ?? null,
      longitude: weatherData?.longitude ?? null,
    },
    timezone: weatherData?.timezone ?? null,
    utcOffsetSeconds: weatherData?.utc_offset_seconds ?? null,
    elevation: weatherData?.elevation ?? null,
    fetchedAt: new Date().toISOString(),
    validTime: weatherRawTimestamp,
    units: weatherData?.current_units ?? {},
    current: {
      temperature: omCurrent.temperature_2m ?? null,
      apparentTemperature: omCurrent.apparent_temperature ?? null,
      relativeHumidity: omCurrent.relative_humidity_2m ?? null,
      weatherCode: omCurrent.weather_code ?? null,
      isDay: omCurrent.is_day ?? null,
      windSpeed: omCurrent.wind_speed_10m ?? null,
      windDirection: omCurrent.wind_direction_10m ?? null,
      windGusts: omCurrent.wind_gusts_10m ?? null,
      surfacePressure: omCurrent.surface_pressure ?? null,
      cloudCover: omCurrent.cloud_cover ?? null,
      precipitation: omCurrent.precipitation ?? null,
    },
    hourly: {
      time: omHourly.time ?? [],
      temperature: omHourly.temperature_2m ?? [],
      precipitationProbability: omHourly.precipitation_probability ?? [],
      precipitation: omHourly.precipitation ?? [],
      windSpeed: omHourly.wind_speed_10m ?? [],
      windDirection: omHourly.wind_direction_10m ?? [],
      cloudCover: omHourly.cloud_cover ?? [],
    },
    daily: {
      time: omDaily.time ?? [],
      temperatureMax: omDaily.temperature_2m_max ?? [],
      temperatureMin: omDaily.temperature_2m_min ?? [],
      precipitationProbabilityMax: omDaily.precipitation_probability_max ?? [],
      sunrise: omDaily.sunrise ?? [],
      sunset: omDaily.sunset ?? [],
    },
    airQuality: {
      available: airQualityAvailable,
      error: airQualityError,
      data: airQualityAvailable
        ? {
            usAqi: airQualityData?.current?.us_aqi ?? null,
            pm25: airQualityData?.current?.pm2_5 ?? null,
            pm10: airQualityData?.current?.pm10 ?? null,
            validTime: airQualityData?.current?.time ?? null,
          }
        : null,
    },
    source: {
      weather: "Open-Meteo (api.open-meteo.com/v1/forecast)",
      airQuality: "Open-Meteo Air Quality (air-quality-api.open-meteo.com/v1/air-quality)",
      note: "Values are model-based estimates from Open-Meteo, not physical monitoring stations or live radar.",
    },
    fromCache: false,
  };

  setCachedWeather(cacheKey, response);

  return NextResponse.json(response);
}
