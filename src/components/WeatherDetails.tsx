"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useLocation } from "@/lib/location-context";
import { useTTS } from "@/lib/use-tts";

interface WeatherData {
  current: {
    temperature?: number;
    apparentTemperature?: number;
    relativeHumidity?: number;
    weatherCode?: number;
    isDay?: number;
    windSpeed?: number;
    windDirection?: number;
    windGusts?: number;
    surfacePressure?: number;
    cloudCover?: number;
    precipitation?: number;
  };
  hourly: {
    time: string[];
    temperature: number[];
    precipitationProbability: number[];
    precipitation: number[];
    windSpeed: number[];
    windDirection: number[];
    cloudCover: number[];
  };
  daily: {
    time: string[];
    temperatureMax: number[];
    temperatureMin: number[];
    precipitationProbabilityMax: number[];
    sunrise: string[];
    sunset: string[];
  };
  airQuality: {
    available: boolean;
    data?: {
      usAqi?: number;
      pm25?: number;
      pm10?: number;
    };
    error?: string;
  };
}

export default function WeatherDetails() {
  const { state: locationState } = useLocation();
  const { speak, isSpeaking, isSupported } = useTTS();
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchWeather = async () => {
      if (!locationState.latitude || !locationState.longitude) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/weather-map?latitude=${locationState.latitude}&longitude=${locationState.longitude}`
        );
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || "Failed to fetch weather");
        }
        const data = await response.json();
        setWeatherData(data as WeatherData);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load weather data";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();

    // Refresh every 5 minutes
    const interval = setInterval(fetchWeather, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [locationState.latitude, locationState.longitude]);

  const locationLabel = locationState.displayName
    ? locationState.displayName.replace(/ \(default.*/, "")
    : "Selected location";

  const aqiCategory = (aqi: number | null | undefined) => {
    if (aqi === null || aqi === undefined) return { label: "Unavailable", color: "text-white/40" };
    if (aqi <= 50) return { label: "Good", color: "text-emerald-400" };
    if (aqi <= 100) return { label: "Moderate", color: "text-amber-400" };
    if (aqi <= 150) return { label: "Unhealthy for Sensitive Groups", color: "text-rose-400" };
    if (aqi <= 200) return { label: "Unhealthy", color: "text-red-400" };
    if (aqi <= 300) return { label: "Very Unhealthy", color: "text-purple-400" };
    return { label: "Hazardous", color: "text-maroon-400" };
  };

  const windDirectionToCompass = (degrees: number | null | undefined) => {
    if (degrees === null || degrees === undefined) return "--";
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return dirs[Math.round(degrees / 22.5) % 16];
  };

  const weatherCodeToCondition = (code: number | null | undefined) => {
    if (code === null || code === undefined) return "Unknown";
    const codes: Record<number, string> = {
      0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
      55: "Dense drizzle", 56: "Light freezing drizzle", 57: "Dense freezing drizzle",
      61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 66: "Light freezing rain",
      67: "Heavy freezing rain", 71: "Slight snow fall", 73: "Moderate snow fall",
      75: "Heavy snow fall", 77: "Snow grains", 80: "Slight rain showers",
      81: "Moderate rain showers", 82: "Violent rain showers", 85: "Slight snow showers",
      86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm with slight hail",
      99: "Thunderstorm with heavy hail",
    };
    return codes[code] ?? `Code ${code}`;
  };

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center text-rose-400">
        Failed to load weather: {error}
      </div>
    );
  }

  const current = weatherData?.current || {};
  const hourly = weatherData?.hourly || { time: [], temperature: [], precipitationProbability: [], precipitation: [], windSpeed: [], windDirection: [], cloudCover: [] };
  const daily = weatherData?.daily || { time: [], temperatureMax: [], temperatureMin: [], precipitationProbabilityMax: [], sunrise: [], sunset: [] };
  const aq = weatherData?.airQuality || { available: false, data: undefined, error: undefined };

  const metrics = [
    { label: "Wind Speed", value: `${current.windSpeed ?? "—"} km/h`, sub: windDirectionToCompass(current.windDirection), icon: "💨" },
    { label: "Humidity", value: `${current.relativeHumidity ?? "—"}%`, sub: "Relative", icon: "💧" },
    { label: "Sunrise", value: daily.sunrise[0] ? new Date(daily.sunrise[0].replace(" ", "T")).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—", sub: "First light", icon: "🌅" },
    { label: "Sunset", value: daily.sunset[0] ? new Date(daily.sunset[0].replace(" ", "T")).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—", sub: `${daily.sunrise[0] && daily.sunset[0] ? Math.round((new Date(daily.sunset[0].replace(" ", "T")).getTime() - new Date(daily.sunrise[0].replace(" ", "T")).getTime()) / 3.6e6) : "—"}h daylight`, icon: "🌇" },
    { label: "PM2.5", value: aq.available ? `${aq.data?.pm25 ?? "—"} µg/m³` : "Unavailable", sub: "Fine Particulate", icon: "🔬" },
    { label: "PM10", value: aq.available ? `${aq.data?.pm10 ?? "—"} µg/m³` : "Unavailable", sub: "Coarse Particulate", icon: "🌫️" },
  ];

  const aqiValue = aq.available ? aq.data?.usAqi ?? null : null;
  const aqiInfo = aqiCategory(aqiValue);

  return (
    <div className="w-full h-full flex flex-col justify-start max-w-6xl mx-auto px-4 sm:px-8 pt-8 pb-24 overflow-y-auto select-none pointer-events-auto scrollbar-none">
      {/* City Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 border-b border-white/10 gap-3">
        <div>
          <span className="text-[11px] font-semibold tracking-widest uppercase text-white/50 block">
            {locationState.source === "default" ? "Default location (not your detected location)" : `${locationState.source} location`}
          </span>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">
            {locationLabel} Climate & Air
          </h2>
        </div>

        {/* Primary AQI Pill Badge */}
        <div className="flex items-center gap-3 bg-[#111215]/75 border border-white/12 px-5 py-2.5 rounded-2xl backdrop-blur-xl shadow-xl">
          <div className="text-right">
            <div className="text-[10px] text-white/50 uppercase tracking-widest">Air Quality</div>
            <div className={`text-lg font-bold ${aqiInfo.color}`}>
              {aqiValue !== null ? `${aqiValue} • ${aqiInfo.label}` : "Unavailable"}
            </div>
          </div>
          <span className={`w-3.5 h-3.5 rounded-full ${aqiValue !== null ? `bg-${aqiInfo.color.replace("text-", "")} shadow-[0_0_12px_rgba(52,211,153,0.9)] animate-pulse` : "bg-white/20"}`} />
        </div>
      </div>

      {/* Listen to Briefing Button */}
      {isSupported && (
        <button
          type="button"
          onClick={() => {
            const temp = current.temperature ?? "unknown";
            const humidity = current.relativeHumidity ?? "unknown";
            const aqiVal = aqiValue ?? "unknown";
            const condition = weatherCodeToCondition(current.weatherCode);
            speak(
              `Current weather briefing for ${locationLabel}. The temperature is ${temp} degrees Celsius, condition is ${condition}, humidity is at ${humidity} percent, and the air quality index is ${aqiVal}, which is ${aqiInfo.label}. These are model-based estimates from Open-Meteo.`
            );
          }}
          aria-label={isSpeaking ? "Stop briefing" : "Listen to weather briefing"}
          className="w-full sm:w-auto px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/15 rounded-xl text-xs font-medium text-white transition-all flex items-center justify-center gap-2"
        >
          {isSpeaking ? "⏹ Stop Briefing" : "🔊 Listen to Briefing"}
        </button>
      )}

      {/* Grid: 6 Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5 my-6">
        {metrics.map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.35 }}
            className="bg-[#111215]/65 border border-white/10 backdrop-blur-xl p-4 sm:p-5 rounded-2xl flex flex-col justify-between shadow-lg hover:border-white/20 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50 font-medium tracking-wide">{m.label}</span>
              <span className="text-base">{m.icon}</span>
            </div>
            <div className="mt-3">
              <div className="text-xl sm:text-2xl font-bold text-white tracking-tight">{m.value}</div>
              <div className="text-[11px] text-white/40 mt-0.5">{m.sub}</div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Additional Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-6">
        <MetricCard label="Temperature" value={`${current.temperature ?? "—"}°C`} sub={`Feels like ${current.apparentTemperature ?? "—"}°C`} icon="🌡️" />
        <MetricCard label="Condition" value={weatherCodeToCondition(current.weatherCode)} icon="☁️" />
        <MetricCard label="Pressure" value={`${current.surfacePressure ?? "—"} hPa`} icon="📊" />
        <MetricCard label="Cloud Cover" value={`${current.cloudCover ?? "—"}%`} icon="☁️" />
        <MetricCard label="Precipitation" value={`${current.precipitation ?? "—"} mm`} sub={current.isDay === 1 ? "Day" : "Night"} icon="🌧️" />
        <MetricCard label="Wind Gusts" value={`${current.windGusts ?? "—"} km/h`} icon="🌬️" />
        <MetricCard label="US AQI" value={aqiValue?.toString() ?? "—"} sub={aqiInfo.label} icon="🌱" valueColor={aqiInfo.color} />
        <MetricCard label="Elevation" value={locationState.elevation ? `${locationState.elevation}m` : "Unavailable"} icon="⛰️" />
      </div>

      {/* Health & AQI Advisory Section */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold tracking-widest uppercase text-white/50 px-1">
          Health & Activity Guidance (Model Estimates)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <AdvisoryCard
            title="Ventilation"
            text="Open windows when particulate dispersion peaks midday."
            tag="Home"
            aqi={aqiValue}
          />
          <AdvisoryCard
            title="Outdoor Exercise"
            text={aqiValue !== null && aqiValue <= 100 ? "Generally safe; sensitive groups limit intense morning cardio." : "Check AQI before intense outdoor activity."}
            tag="Fitness"
            aqi={aqiValue}
          />
          <AdvisoryCard
            title="Protection"
            text={aqiValue !== null && aqiValue > 100 ? "Consider mask if commuting via main highways." : "Masks optional today."}
            tag="Health"
            aqi={aqiValue}
          />
        </div>
      </div>

      {/* 24-Hour Forecast Strip */}
      {hourly.time?.length && (
        <div className="mt-6 pt-6 border-t border-white/10">
          <h3 className="text-xs font-semibold tracking-widest uppercase text-white/50 mb-3">Next 24 Hours</h3>
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            {hourly.time.slice(0, 24).map((t: string, i: number) => {
              const temp = hourly.temperature[i];
              const precipProb = hourly.precipitationProbability[i];
              const windSpd = hourly.windSpeed[i];
              const windDir = hourly.windDirection[i];
              const date = new Date(t.replace(" ", "T"));
              return (
                <div key={t} className="flex-shrink-0 w-24 bg-white/5 rounded-xl p-3 text-center border border-white/10">
                  <div className="text-[10px] text-white/50 font-mono">{date.getHours()}:00</div>
                  <div className="text-lg font-bold text-white mt-1">{temp}°</div>
                  <div className="text-[10px] text-white/50 mt-1">
                    💧{precipProb}% 💨{windSpd} {windDirectionToCompass(windDir)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 7-Day Forecast */}
      {daily.time?.length && (
        <div className="mt-6 pt-6 border-t border-white/10">
          <h3 className="text-xs font-semibold tracking-widest uppercase text-white/50 mb-3">7-Day Forecast</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {daily.time.slice(0, 7).map((t: string, i: number) => {
              const date = new Date(t.replace(" ", "T"));
              const dayName = date.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
              return (
                <div key={t} className="bg-white/5 rounded-xl p-3 text-center border border-white/10">
                  <div className="text-[10px] text-white/50 font-mono">{dayName}</div>
                  <div className="text-sm font-bold text-white mt-1">
                    {daily.temperatureMax[i]}° / {daily.temperatureMin[i]}°
                  </div>
                  <div className="text-[10px] text-white/50 mt-1">💧{daily.precipitationProbabilityMax[i]}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Source Attribution */}
      <div className="mt-6 pt-4 border-t border-white/10 text-[10px] text-white/40 font-mono">
        Data source: Open-Meteo model estimates (api.open-meteo.com). Not physical monitoring stations or live radar.
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  icon,
  valueColor = "text-white",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-[#111215]/65 border border-white/10 backdrop-blur-xl p-4 rounded-2xl shadow-lg">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/50 font-medium tracking-wide">{label}</span>
        <span className="text-base">{icon}</span>
      </div>
      <div className="mt-2">
        <div className={`text-lg font-bold ${valueColor}`}>{value}</div>
        {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function AdvisoryCard({
  title,
  text,
  tag,
  aqi,
}: {
  title: string;
  text: string;
  tag: string;
  aqi: number | null;
}) {
  const isConcern = aqi !== null && aqi > 100;
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`bg-[#111215]/55 border border-white/10 backdrop-blur-xl p-4 rounded-2xl shadow-md flex flex-col justify-between ${isConcern ? "border-rose-500/30" : ""}`}
    >
      <div>
        <span className={`text-[10px] font-semibold tracking-wider uppercase ${isConcern ? "text-rose-400/90 bg-rose-500/10 border-rose-500/20" : "text-emerald-400/90 bg-emerald-500/10 border-emerald-500/20"} px-2.5 py-0.5 rounded-full border w-fit inline-block mb-2`}>
          {tag}
        </span>
        <h4 className="text-sm font-semibold text-white/95">{title}</h4>
        <p className="text-xs text-white/60 leading-relaxed mt-1">{text}</p>
      </div>
    </motion.div>
  );
}