/**
 * Location name resolution — independent of conversation history.
 * Uses Nominatim (OpenStreetMap) for reverse geocoding.
 * Does not silently substitute defaults; returns "(default)" label when falling back.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "AirWise-App/1.0";

export async function resolveLocationName(
  latitude: number,
  longitude: number,
  currentName?: string
): Promise<string> {
  // If a display name was provided and doesn't look like a default, use it
  if (currentName && !currentName.startsWith("(") && currentName !== "Selected Location") {
    return currentName;
  }

  try {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set("lat", latitude.toString());
    url.searchParams.set("lon", longitude.toString());
    url.searchParams.set("format", "json");
    url.searchParams.set("zoom", "10");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return formatDefaultName(latitude, longitude);
    }

    const data = await response.json();
    const city =
      data.address?.city ||
      data.address?.town ||
      data.address?.county ||
      data.address?.state_district;
    const state = data.address?.state;
    const country = data.address?.country;

    const parts = [city, state, country].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(", ");
    }

    return formatDefaultName(latitude, longitude);
  } catch {
    return formatDefaultName(latitude, longitude);
  }
}

function formatDefaultName(latitude: number, longitude: number): string {
  return `Lat ${latitude.toFixed(4)}, Lon ${longitude.toFixed(4)} (default)`;
}