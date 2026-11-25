"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useReducer,
  type ReactNode,
} from "react";

export type LocationSource = "device" | "manual" | "default";

export interface LocationState {
  latitude: number | null;
  longitude: number | null;
  displayName: string | null;
  source: LocationSource;
  loading: boolean;
  error: string | null;
  permissionDenied: boolean;
  elevation: number | null;
}

const DEFAULT_LOCATION = {
  latitude: 17.385,
  longitude: 78.4867,
  displayName: "Hyderabad, Telangana, India (default)",
  source: "default" as LocationSource,
};

type LocationAction =
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_LOCATION"; payload: { latitude: number; longitude: number; displayName: string; source: LocationSource; elevation?: number | null } }
  | { type: "SET_ERROR"; payload: string }
  | { type: "SET_PERMISSION_DENIED"; payload: boolean }
  | { type: "RESET_ERROR" };

function locationReducer(state: LocationState, action: LocationAction): LocationState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_LOCATION":
      return {
        ...state,
        latitude: action.payload.latitude,
        longitude: action.payload.longitude,
        displayName: action.payload.displayName,
        source: action.payload.source,
        elevation: action.payload.elevation ?? null,
        loading: false,
        error: null,
        permissionDenied: false,
      };
    case "SET_ERROR":
      return { ...state, error: action.payload, loading: false };
    case "SET_PERMISSION_DENIED":
      return { ...state, permissionDenied: action.payload };
    case "RESET_ERROR":
      return { ...state, error: null };
    default:
      return state;
  }
}

const LocationContext = createContext<{
  state: LocationState;
  setLocationFromDevice: () => Promise<void>;
  searchCity: (query: string) => Promise<void>;
  setManualLocation: (lat: number, lon: number, name: string, elevation?: number | null) => void;
  clearError: () => void;
} | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(locationReducer, {
    latitude: null,
    longitude: null,
    displayName: null,
    source: "default",
    loading: false,
    error: null,
    permissionDenied: false,
    elevation: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const setManualLocation = useCallback((lat: number, lon: number, name: string, elevation?: number | null) => {
    dispatch({ type: "SET_LOCATION", payload: { latitude: lat, longitude: lon, displayName: name, source: "manual", elevation } });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "RESET_ERROR" });
  }, []);

  const setLocationFromDevice = useCallback(async () => {
    if (!("geolocation" in navigator)) {
      dispatch({ type: "SET_ERROR", payload: "Geolocation is not supported by this browser." });
      return;
    }

    if (state.permissionDenied) {
      return;
    }

    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "RESET_ERROR" });

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          (err) => {
            reject(err);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          }
        );
      });

      const { latitude, longitude, altitude } = position.coords;
      const displayName = await reverseGeocode(latitude, longitude);

      dispatch({
        type: "SET_LOCATION",
        payload: { latitude, longitude, displayName: displayName || `(${latitude.toFixed(4)}, ${longitude.toFixed(4)})`, source: "device", elevation: altitude ?? null },
      });
    } catch (err: any) {
      let message = "Failed to get your location.";
      let permissionDenied = false;

      switch (err.code) {
        case 1: // PERMISSION_DENIED
          message = "Location access was denied. You can search for a city manually.";
          permissionDenied = true;
          break;
        case 2: // POSITION_UNAVAILABLE
          message = "Location information is unavailable.";
          break;
        case 3: // TIMEOUT
          message = "Location request timed out. Please try again or search manually.";
          break;
        default:
          message = err.message || "Unknown location error.";
      }

      dispatch({ type: "SET_ERROR", payload: message });
      if (permissionDenied) {
        dispatch({ type: "SET_PERMISSION_DENIED", payload: true });
      }
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, [state.permissionDenied]);

  const searchCity = useCallback(async (query: string) => {
    if (!query || query.trim().length < 2) return;

    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "RESET_ERROR" });

    // Cancel any obsolete request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
      geocodingUrl.searchParams.set("name", query.trim());
      geocodingUrl.searchParams.set("count", "5");
      geocodingUrl.searchParams.set("language", "en");
      geocodingUrl.searchParams.set("format", "json");

      const response = await fetch(geocodingUrl.toString(), {
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Geocoding request failed: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      if (results.length === 0) {
        dispatch({ type: "SET_ERROR", payload: `No results found for "${query}".` });
        dispatch({ type: "SET_LOADING", payload: false });
        return;
      }

      // Show the first match; in a fuller UI we'd let the user pick.
      const top = results[0];
      const nameParts = [top.name, top.admin1, top.country].filter(Boolean);
      const displayName = nameParts.join(", ");

      dispatch({
        type: "SET_LOCATION",
        payload: {
          latitude: top.latitude,
          longitude: top.longitude,
          displayName,
          source: "manual",
          elevation: top.elevation ?? null,
        },
      });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      dispatch({ type: "SET_ERROR", payload: err.message || "City search failed." });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, []);

  useEffect(() => {
    // Initialize with default Hyderabad location on mount
    dispatch({
      type: "SET_LOCATION",
      payload: {
        latitude: DEFAULT_LOCATION.latitude,
        longitude: DEFAULT_LOCATION.longitude,
        displayName: DEFAULT_LOCATION.displayName,
        source: "default",
        elevation: null,
      },
    });
  }, []);

  const value = {
    state,
    setLocationFromDevice,
    searchCity,
    setManualLocation,
    clearError,
  };

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) {
    throw new Error("useLocation must be used within a LocationProvider");
  }
  return ctx;
}

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/reverse");
    url.searchParams.set("latitude", lat.toString());
    url.searchParams.set("longitude", lon.toString());
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");

    const response = await fetch(url.toString());
    if (!response.ok) return null;
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const r = data.results[0];
      const parts = [r.name, r.admin1, r.country].filter(Boolean);
      return parts.join(", ") || null;
    }
    return null;
  } catch {
    return null;
  }
}
