"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "@/lib/location-context";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// CARTO Basemaps API key (from NEXT_PUBLIC_CARTO_API_KEY in .env.local)
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY || "";

// Basemap sources
const BASEMAP_SOURCES = {
  "osm-dark": {
    name: "OpenStreetMap Dark",
    tiles: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
    ],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  "osm-standard": {
    name: "OpenStreetMap Standard",
    tiles: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
    ],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  "carto-voyager": {
    name: "CARTO Voyager",
    tiles: [
      "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
    ],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  },
  "cartodb-dark": {
    name: "CartoDB Dark Matter",
    tiles: [
      `https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`,
      `https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`,
      `https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`,
      `https://d.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`,
    ],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  },
};

type WeatherLayer = "wind" | "thermal" | "aqi";

interface WeatherDataPoint {
  latitude: number;
  longitude: number;
  temperature: number;
  windSpeed: number;
  windDirection: number;
  aqi: number | null;
  elevation: number | null;
  placeName: string;
  timestamp: string;
  weatherCode: number | null;
}

interface ForecastData {
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
    time?: string[];
    temperature?: number[];
    precipitationProbability?: number[];
    precipitation?: number[];
    windSpeed?: number[];
    windDirection?: number[];
    cloudCover?: number[];
  };
  daily: {
    time?: string[];
    temperatureMax?: number[];
    temperatureMin?: number[];
    precipitationProbabilityMax?: number[];
    sunrise?: string[];
    sunset?: string[];
  };
  airQuality: {
    available?: boolean;
    error?: string | null;
    data?: {
      usAqi?: number | null;
      pm25?: number | null;
      pm10?: number | null;
      validTime?: string | null;
    } | null;
  };
}

interface WeatherMapProps {
  activePage: number;
}

export default function WeatherMap({ activePage }: WeatherMapProps) {
  const { state: locationState, setLocationFromDevice, setManualLocation } = useLocation();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const canvasOverlayRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [activeLayer, setActiveLayer] = useState<WeatherLayer>("wind");
  const [basemap, setBasemap] = useState<keyof typeof BASEMAP_SOURCES>("cartodb-dark");
  const [selectedPoint, setSelectedPoint] = useState<WeatherDataPoint | null>(null);
  const [forecastData, setForecastData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [showCitySearch, setShowCitySearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<Record<string, unknown>>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [mapInitialized, setMapInitialized] = useState(false);
  const mapLoadedRef = useRef(false);

  // Fetch weather for coordinates
  const fetchWeather = useCallback(async (lat: number, lon: number, placeName: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/weather-map?latitude=${lat}&longitude=${lon}`);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to fetch weather");
      }
      const data = await response.json();

      const current = data.current || {};
      const hourly = data.hourly || {};
      const daily = data.daily || {};
      const aq = data.airQuality || {};

      const pointData: WeatherDataPoint = {
        latitude: lat,
        longitude: lon,
        temperature: current.temperature ?? 0,
        windSpeed: current.windSpeed ?? 0,
        windDirection: current.windDirection ?? 0,
        aqi: aq.available ? aq.data?.usAqi ?? null : null,
        elevation: data.elevation,
        placeName,
        timestamp: data.fetchedAt,
        weatherCode: current.weatherCode ?? null,
      };

      setSelectedPoint(pointData);
      setForecastData({ current, hourly, daily, airQuality: aq });
    } catch (err: unknown) {
      console.error("Weather fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Helper functions (defined before useEffects that reference them)
  function getMarkerColor(layer: WeatherLayer): string {
    switch (layer) {
      case "wind": return "#60a5fa";
      case "thermal": return "#fb923c";
      case "aqi": return "#34d399";
    }
  }

  function getAqiCategory(aqi: number | null): { label: string; color: string } {
    if (aqi === null) return { label: "Unavailable", color: "text-white/40" };
    if (aqi <= 50) return { label: "Good", color: "text-emerald-400" };
    if (aqi <= 100) return { label: "Moderate", color: "text-amber-400" };
    if (aqi <= 150) return { label: "Unhealthy for Sensitive Groups", color: "text-rose-400" };
    if (aqi <= 200) return { label: "Unhealthy", color: "text-red-400" };
    if (aqi <= 300) return { label: "Very Unhealthy", color: "text-purple-400" };
    return { label: "Hazardous", color: "text-maroon-400" };
  }

  function windDirectionToCompass(degrees: number | null): string {
    if (degrees === null) return "--";
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return dirs[Math.round(degrees / 22.5) % 16];
  }

  function weatherCodeToCondition(code: number | null): string {
    if (code === null) return "Unknown";
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
  }

  function getPopupContent(point: WeatherDataPoint): string {
    const aqiCat = getAqiCategory(point.aqi);
    const condition = weatherCodeToCondition(point.weatherCode);
    const windCompass = windDirectionToCompass(point.windDirection);
    return `
      <div style="min-width: 200px; font-family: system-ui, sans-serif;">
        <div style="font-weight: 600; margin-bottom: 4px;">${point.placeName}</div>
        <div style="font-size: 12px; color: #888; margin-bottom: 8px;">
          ${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)} ${point.elevation ? `• ${point.elevation}m` : ""}
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 12px;">
          <div>Temp: <b>${point.temperature}°C</b></div>
          <div>Wind: <b>${point.windSpeed} km/h ${windCompass}</b></div>
          <div>Condition: <b>${condition}</b></div>
          <div>AQI: <b style="color: ${aqiCat.color}">${point.aqi ?? "—"} ${aqiCat.label}</b></div>
        </div>
      </div>
    `;
  }

  async function reverseGeocode(lng: number, lat: number): Promise<string | null> {
    try {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/reverse");
      url.searchParams.set("latitude", lat.toString());
      url.searchParams.set("longitude", lng.toString());
      url.searchParams.set("language", "en");
      url.searchParams.set("format", "json");
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data.results?.length) {
        const r = data.results[0];
        return [r.name, r.admin1, r.country].filter(Boolean).join(", ");
      }
      return null;
    } catch {
      return null;
    }
  }

  // Update marker position
  const updateMarker = (lng: number, lat: number) => {
    if (!mapRef.current) return;

    if (markerRef.current) {
      markerRef.current.setLngLat([lng, lat]);
    } else {
      markerRef.current = new maplibregl.Marker({ color: getMarkerColor(activeLayer), scale: 1.2 })
        .setLngLat([lng, lat])
        .addTo(mapRef.current);
    }

    // Update popup
    if (selectedPoint) {
      if (popupRef.current) {
        popupRef.current.setLngLat([lng, lat]).setHTML(getPopupContent(selectedPoint));
      } else {
        popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
          .setLngLat([lng, lat])
          .setHTML(getPopupContent(selectedPoint))
          .addTo(mapRef.current);
      }
    }
  };

  // Initialize map - runs ONCE on mount
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const source = BASEMAP_SOURCES[basemap];

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: source.tiles,
            tileSize: 256,
            attribution: source.attribution,
            maxzoom: source.maxZoom,
          },
        },
        layers: [
          {
            id: "basemap",
            type: "raster",
            source: "basemap",
            minzoom: 0,
            maxzoom: source.maxZoom,
          },
        ],
      },
      center: [
        locationState.longitude ?? 78.4867,
        locationState.latitude ?? 17.385,
      ],
      zoom: 9,
      pitch: 0,
      bearing: 0,
      attributionControl: { compact: true },
      // Disable web worker to avoid Turbopack "Worker failed to load" error
      // Raster tiles don't require worker thread
      // @ts-expect-error workerUrl is valid but not in MapOptions type
      workerUrl: "",
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "top-right"
    );

    map.on("load", () => {
      mapLoadedRef.current = true;
      setMapInitialized(true);
      setLoading(false);
      setMapError(null);
      map.resize();

      // Add selected location marker
      if (locationState.latitude != null && locationState.longitude != null) {
        updateMarker(locationState.longitude, locationState.latitude);
        fetchWeather(locationState.latitude, locationState.longitude, locationState.displayName || "Selected location");
      }
    });

    map.on("click", async (e) => {
      const { lng, lat } = e.lngLat;
      updateMarker(lng, lat);

      const placeName =
        (await reverseGeocode(lng, lat)) ||
        `(${lat.toFixed(4)}°, ${lng.toFixed(4)}°)`;

      // Update global app state so Home Dashboard, Weather Details, and AI Chat update
      setManualLocation(lat, lng, placeName);

      // Fetch local map forecast
      fetchWeather(lat, lng, placeName);
    });

    map.on("error", (e: { error?: { status?: number; message?: string } }) => {
      // Only show error banner if the primary style failed to load entirely
      if (e?.error?.status === 401 || e?.error?.message?.includes("Style")) {
        setMapError("Failed to load map style. Check your connection.");
      }
    });

    map.on("style.load", () => {
      // Ensure canvas overlay is synced
      if (canvasOverlayRef.current) {
        const canvas = canvasOverlayRef.current;
        if (canvas) {
          const container = map.getContainer();
          const bounds = container.getBoundingClientRect();
          canvas.width = bounds.width * window.devicePixelRatio;
          canvas.height = bounds.height * window.devicePixelRatio;
          canvas.style.width = bounds.width + "px";
          canvas.style.height = bounds.height + "px";
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        }
      }
    });

    mapRef.current = map;

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
    };
  }, []);

  // Handle basemap switching without destroying the map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const source = BASEMAP_SOURCES[basemap];
    const mapSource = map.getSource("basemap") as maplibregl.RasterTileSource;
    if (mapSource && mapSource.setTiles) {
      mapSource.setTiles(source.tiles);
    }
  }, [basemap]);

  // Fly to coordinates when locationState changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || locationState.latitude == null || locationState.longitude == null) return;

    map.flyTo({
      center: [locationState.longitude, locationState.latitude],
      zoom: 10,
      essential: true,
    });
    updateMarker(locationState.longitude, locationState.latitude);
    fetchWeather(locationState.latitude, locationState.longitude, locationState.displayName || "Selected location");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationState.latitude, locationState.longitude]);


  // Trigger map.resize() when the map page becomes active (page 2)
  useEffect(() => {
    if (activePage === 2 && mapRef.current && mapLoadedRef.current) {
      // Small delay to ensure the carousel animation completes
      const timer = setTimeout(() => {
        mapRef.current?.resize();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [activePage]);

  // Sync canvas overlay on map move/zoom
  useEffect(() => {
    if (!mapRef.current || !canvasOverlayRef.current) return;

    const map = mapRef.current;
    const canvas = canvasOverlayRef.current;

    const sync = () => {
      if (!map || !canvas) return;
      const container = map.getContainer();
      const bounds = container.getBoundingClientRect();
      canvas.width = bounds.width * window.devicePixelRatio;
      canvas.height = bounds.height * window.devicePixelRatio;
      canvas.style.width = bounds.width + "px";
      canvas.style.height = bounds.height + "px";
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    sync();
    map.on("move", sync);
    map.on("resize", sync);
    map.on("zoom", sync);
    map.on("rotate", sync);

    return () => {
      map.off("move", sync);
      map.off("resize", sync);
      map.off("zoom", sync);
      map.off("rotate", sync);
    };
  }, []);

  // Wind animation on canvas overlay
  useEffect(() => {
    const canvas = canvasOverlayRef.current;
    if (!canvas || !mapRef.current || activeLayer !== "wind") return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const particles = Array.from({ length: 50 }, () => ({
      x: Math.random() * canvas.width / window.devicePixelRatio,
      y: Math.random() * canvas.height / window.devicePixelRatio,
      speed: 0.8 + Math.random() * 1.5,
      length: 15 + Math.random() * 20,
      alpha: 0.2 + Math.random() * 0.4,
    }));

    const render = () => {
      if (!mapRef.current || activeLayer !== "wind") return;

      ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);

      const windDir = selectedPoint?.windDirection ?? 115;
      // Meteorological: degrees = where wind comes FROM
      // Screen: dx = -sin(dir) * speed, dy = cos(dir) * speed
      const rad = (windDir * Math.PI) / 180;
      const dx = -Math.sin(rad);
      const dy = Math.cos(rad);

      particles.forEach((p) => {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(96, 165, 250, ${p.alpha})`;
        ctx.lineWidth = 1.5;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + dx * p.length, p.y + dy * p.length);
        ctx.stroke();

        p.x += dx * p.speed;
        p.y += dy * p.speed;

        // Wrap
        const w = canvas.width / window.devicePixelRatio;
        const h = canvas.height / window.devicePixelRatio;
        if (p.x > w) p.x = 0;
        if (p.x < 0) p.x = w;
        if (p.y > h) p.y = 0;
        if (p.y < 0) p.y = h;
      });

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [activeLayer, selectedPoint?.windDirection]);

  // Search city
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearchLoading(true);
    try {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.searchParams.set("name", searchQuery.trim());
      url.searchParams.set("count", "5");
      url.searchParams.set("language", "en");
      url.searchParams.set("format", "json");

      const res = await fetch(url.toString());
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setSearchLoading(false);
    }
  };

  const selectResult = (result: Record<string, unknown>) => {
    const nameParts = [(result.name as string), (result.admin1 as string), (result.country as string)].filter(Boolean);
    const displayName = nameParts.join(", ");
    setManualLocation(result.latitude as number, result.longitude as number, displayName, result.elevation as number | null ?? null);
    setShowCitySearch(false);
    setSearchQuery("");
    setSearchResults([]);
  };

  // Handle location change from context (device/manual)
  useEffect(() => {
    if (mapRef.current && locationState.latitude !== null && locationState.longitude !== null) {
      mapRef.current.flyTo({
        center: [locationState.longitude, locationState.latitude],
        zoom: 9,
        duration: 1000,
      });
      updateMarker(locationState.longitude, locationState.latitude);
      fetchWeather(locationState.latitude, locationState.longitude, locationState.displayName || "Selected location");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationState.latitude, locationState.longitude, locationState.source]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      mapRef.current?.remove();
    };
  }, []);

  return (
    <div className="w-full min-h-screen overflow-y-auto px-4 sm:px-8 pt-20 pb-36 max-w-6xl mx-auto flex flex-col gap-6 select-none pointer-events-auto">
      {/* Top Header & Controls - with pt-16 to clear top pagination bubbles */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-white/10 gap-3 pt-6">
        <div>
          <span className="text-[11px] font-semibold tracking-widest uppercase text-white/50 block">
            Open-Meteo Model Estimates • Not Physical Station Data
          </span>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
            {selectedPoint?.placeName || locationState.displayName || "Weather Map"}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Basemap selector */}
          <select
            value={basemap}
            onChange={(e) => setBasemap(e.target.value as keyof typeof BASEMAP_SOURCES)}
            className="text-xs px-2 py-1 rounded-lg bg-[#111215]/80 border border-white/15 text-white/90"
            aria-label="Select basemap"
          >
            {Object.entries(BASEMAP_SOURCES).map(([key, val]) => (
              <option key={key} value={key}>{val.name}</option>
            ))}
          </select>

          {/* Layer selector pills */}
          <div className="flex items-center gap-1.5 bg-[#111215]/70 border border-white/12 backdrop-blur-xl p-1 rounded-xl shadow-lg">
            {([
              { id: "wind", label: "💨 Wind", unit: selectedPoint ? `${selectedPoint.windSpeed} km/h` : "" },
              { id: "thermal", label: "🌡️ Temp", unit: selectedPoint ? `${selectedPoint.temperature}°C` : "" },
              { id: "aqi", label: "🌱 AQI", unit: selectedPoint && selectedPoint.aqi ? `AQI ${selectedPoint.aqi}` : "" },
            ] as const).map((layer) => (
              <button
                key={layer.id}
                onClick={() => setActiveLayer(layer.id)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeLayer === layer.id
                    ? "bg-white text-neutral-900 shadow-md font-semibold"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {layer.label} {layer.unit && <span className="text-white/70 ml-1">{layer.unit}</span>}
              </button>
            ))}
          </div>

          {/* Use My Location button */}
          {!locationState.permissionDenied && (
            <button
              onClick={setLocationFromDevice}
              disabled={locationState.loading}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#111215]/80 border border-white/15 text-white/90 hover:border-white/30 transition-all cursor-pointer disabled:opacity-50"
            >
              {locationState.loading ? "Locating…" : "Use My Location"}
            </button>
          )}

          {/* City Search toggle */}
          <button
            onClick={() => setShowCitySearch(!showCitySearch)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#111215]/80 border border-white/15 text-white/90 hover:border-white/30 transition-all cursor-pointer"
          >
            Search City
          </button>
        </div>
      </div>

      {/* City Search Dropdown */}
      {showCitySearch && (
        <div className="mb-4 bg-[#111215]/80 border border-white/12 backdrop-blur-xl p-3 rounded-xl shadow-lg">
          <form onSubmit={handleSearch} className="flex gap-2 mb-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for a city…"
              className="flex-1 bg-white/10 border border-white/15 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/50 outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={searchLoading}
              className="px-4 py-1.5 bg-white/10 border border-white/15 text-white/90 rounded-lg hover:bg-white/20 disabled:opacity-50"
            >
              {searchLoading ? "Searching…" : "Search"}
            </button>
          </form>
          {searchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {searchResults.map((r: Record<string, unknown>) => (
                <button
                  key={(r.place_id as string) || `${r.latitude as number},${r.longitude as number}`}
                  onClick={() => selectResult(r)}
                  className="w-full text-left px-3 py-2 text-sm text-white/90 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <div className="font-medium">{r.name as string}</div>
                  <div className="text-[10px] text-white/50">{[r.admin1, r.country].filter(Boolean).join(", ")}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Map Error */}
      {mapError && (
        <div className="mb-4 p-3 bg-rose-500/20 border border-rose-500/40 text-rose-300 rounded-lg text-sm">
          {mapError}
        </div>
      )}

      {/* Main Map Viewport */}
      <div className="relative w-full h-[400px] sm:h-[480px] rounded-3xl overflow-hidden border border-white/12 bg-[#0c0d10] shadow-[0_20px_60px_rgba(0,0,0,0.7)] flex-shrink-0">
        {/* MapLibre Container */}
        <div
          ref={mapContainerRef}
          className="absolute inset-0 w-full h-full"
        />

        {/* Canvas Overlay for Wind Animation */}
        <canvas
          ref={canvasOverlayRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ display: activeLayer === "wind" ? "block" : "none" }}
        />

        {/* Loading Indicator */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Map not initialized message */}
        {!mapInitialized && !loading && !mapError && (
          <div className="absolute inset-0 flex items-center justify-center text-white/50">
            Initializing map…
          </div>
        )}

        {/* Attribution is handled by MapLibre control */}
      </div>

      {/* Detail Panel */}
      {selectedPoint && (
        <div className="relative z-20 mx-4 sm:mx-6 mb-6 w-full max-w-4xl bg-[#111215]/85 border border-white/12 backdrop-blur-2xl p-5 rounded-2xl shadow-2xl">
          {/* Current Conditions Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
            <div>
              <span className="text-[10px] text-emerald-400 font-mono tracking-wider uppercase">
                Model Forecast Point
              </span>
              <h4 className="text-lg font-semibold text-white tracking-tight mt-1">{selectedPoint.placeName}</h4>
              <p className="text-xs text-white/50 mt-0.5 font-mono">
                {selectedPoint.latitude.toFixed(4)}°N, {selectedPoint.longitude.toFixed(4)}°E • {selectedPoint.elevation ? `${selectedPoint.elevation}m elevation` : "Elevation unavailable"}
              </p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-white">{selectedPoint.temperature}°C</div>
              <div className="text-xs text-white/50">
                {weatherCodeToCondition(selectedPoint.weatherCode)} • Feels like {forecastData?.current?.apparentTemperature ?? "—"}°C
              </div>
              <div className="text-[10px] text-white/40 mt-1">
                Data: {new Date(selectedPoint.timestamp).toLocaleString()} • Source: Open-Meteo model estimate
              </div>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-4">
            <MetricCard
              label="Humidity"
              value={`${forecastData?.current?.relativeHumidity ?? "—"}%`}
              icon="💧"
            />
            <MetricCard
              label="Wind"
              value={`${selectedPoint.windSpeed} km/h`}
              sub={windDirectionToCompass(selectedPoint.windDirection)}
              icon="💨"
            />
            <MetricCard
              label="Gusts"
              value={`${forecastData?.current?.windGusts ?? "—"} km/h`}
              icon="🌬️"
            />
            <MetricCard
              label="Pressure"
              value={`${forecastData?.current?.surfacePressure ?? "—"} hPa`}
              icon="📊"
            />
            <MetricCard
              label="Cloud Cover"
              value={`${forecastData?.current?.cloudCover ?? "—"}%`}
              icon="☁️"
            />
            <MetricCard
              label="Precipitation"
              value={`${forecastData?.current?.precipitation ?? "—"} mm`}
              sub={forecastData?.current?.isDay ? "Day" : "Night"}
              icon="🌧️"
            />
            <MetricCard
              label="US AQI"
              value={selectedPoint.aqi?.toString() ?? "—"}
              sub={
                selectedPoint.aqi !== null
                  ? getAqiCategory(selectedPoint.aqi).label
                  : "Unavailable"
              }
              icon="🌱"
              valueColor={selectedPoint.aqi !== null ? getAqiCategory(selectedPoint.aqi).color : "text-white/40"}
            />
            <MetricCard
              label="PM2.5 / PM10"
              value={
                forecastData?.airQuality?.available
                  ? `${forecastData.airQuality.data?.pm25 ?? "—"} / ${forecastData.airQuality.data?.pm10 ?? "—"} µg/m³`
                  : "Unavailable"
              }
              icon="🔬"
            />
          </div>

          {/* 24-Hour Forecast Strip */}
          {forecastData?.hourly?.time?.length && (
            <div className="pt-4 border-t border-white/10">
              <h5 className="text-xs font-semibold tracking-wider uppercase text-white/50 mb-3">Next 24 Hours</h5>
              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {forecastData.hourly.time?.slice(0, 24).map((t: string, i: number) => {
                  const temp = forecastData.hourly.temperature?.[i];
                  const precipProb = forecastData.hourly.precipitationProbability?.[i];
                  const windSpd = forecastData.hourly.windSpeed?.[i];
                  const windDir = forecastData.hourly.windDirection?.[i];
                  const date = new Date(t.replace(" ", "T"));
                  return (
                    <div
                      key={t}
                      className="flex-shrink-0 w-24 bg-white/5 rounded-xl p-3 text-center border border-white/10"
                    >
                      <div className="text-[10px] text-white/50 font-mono">{date.getHours()}:00</div>
                      <div className="text-lg font-bold text-white mt-1">{temp}°</div>
                      <div className="text-[10px] text-white/50 mt-1">
                        💧{precipProb}% 💨{windSpd} {windDirectionToCompass(windDir ?? null)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 7-Day Forecast */}
          {forecastData?.daily?.time?.length && (
            <div className="pt-4 border-t border-white/10">
              <h5 className="text-xs font-semibold tracking-wider uppercase text-white/50 mb-3">7-Day Forecast</h5>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {forecastData.daily.time?.slice(0, 7).map((t: string, i: number) => {
                  const date = new Date(t.replace(" ", "T"));
                  const dayName = date.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
                  return (
                    <div key={t} className="bg-white/5 rounded-xl p-3 text-center border border-white/10">
                      <div className="text-[10px] text-white/50 font-mono">{dayName}</div>
                      <div className="text-sm font-bold text-white mt-1">
                        {forecastData.daily.temperatureMax?.[i]}° / {forecastData.daily.temperatureMin?.[i]}°
                      </div>
                      <div className="text-[10px] text-white/50 mt-1">💧{forecastData.daily.precipitationProbabilityMax?.[i]}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="relative z-20 mx-4 sm:mx-6 mb-4 w-full max-w-xs bg-[#111215]/85 border border-white/12 backdrop-blur-2xl px-3 py-2 rounded-xl text-[10px] text-white/60 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>AQI Good (≤50)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span>Moderate (51–100)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-400" />
          <span>USG (101–150)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-400" />
          <span>Unhealthy (151–200)</span>
        </div>
        <div className="flex items-center gap-1.5 pl-2 border-l border-white/10 font-mono text-white/80">
          Wind: {selectedPoint ? `${selectedPoint.windSpeed} km/h ${windDirectionToCompass(selectedPoint.windDirection)}` : "—"}
        </div>
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
    <div className="bg-white/5 p-3 rounded-xl border border-white/10">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/50 font-medium">{label}</span>
        <span className="text-base">{icon}</span>
      </div>
      <div className="mt-2">
        <div className={`text-lg font-bold ${valueColor}`}>{value}</div>
        {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}