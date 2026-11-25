import { NextRequest, NextResponse } from "next/server";

// In-memory cache: key = "lat,lon", value = { data, timestamp }
const WEATHER_CACHE = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

function getCachedWeather(key: string): any | null {
  const entry = WEATHER_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    WEATHER_CACHE.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedWeather(key: string, data: any): void {
  WEATHER_CACHE.set(key, { data, timestamp: Date.now() });
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

  let weatherData: any;
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
    weatherRawTimestamp = weatherData?.current?.time ?? null;
  } catch (err: any) {
    if (err.name === "AbortError") {
      return NextResponse.json({ error: "Weather request timed out." }, { status: 504 });
    }
    return NextResponse.json(
      { error: "Failed to fetch weather data.", details: err.message },
      { status: 502 }
    );
  }

  // Fetch air quality from the separate Open-Meteo Air Quality API
  let airQualityData: any = null;
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
  } catch (err: any) {
    // Air-quality failure must not discard successful weather data
    airQualityError = err.name === "AbortError" ? "Air quality request timed out." : err.message;
  }

  // Normalize the response
  const current = weatherData?.current ?? {};
  const hourly = weatherData?.hourly ?? {};
  const daily = weatherData?.daily ?? {};

  const response: any = {
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
      temperature: current.temperature_2m ?? null,
      apparentTemperature: current.apparent_temperature ?? null,
      relativeHumidity: current.relative_humidity_2m ?? null,
      weatherCode: current.weather_code ?? null,
      isDay: current.is_day ?? null,
      windSpeed: current.wind_speed_10m ?? null,
      windDirection: current.wind_direction_10m ?? null,
      windGusts: current.wind_gusts_10m ?? null,
      surfacePressure: current.surface_pressure ?? null,
      cloudCover: current.cloud_cover ?? null,
      precipitation: current.precipitation ?? null,
    },
    hourly: {
      time: hourly.time ?? [],
      temperature: hourly.temperature_2m ?? [],
      precipitationProbability: hourly.precipitation_probability ?? [],
      precipitation: hourly.precipitation ?? [],
      windSpeed: hourly.wind_speed_10m ?? [],
      windDirection: hourly.wind_direction_10m ?? [],
      cloudCover: hourly.cloud_cover ?? [],
    },
    daily: {
      time: daily.time ?? [],
      temperatureMax: daily.temperature_2m_max ?? [],
      temperatureMin: daily.temperature_2m_min ?? [],
      precipitationProbabilityMax: daily.precipitation_probability_max ?? [],
      sunrise: daily.sunrise ?? [],
      sunset: daily.sunset ?? [],
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
