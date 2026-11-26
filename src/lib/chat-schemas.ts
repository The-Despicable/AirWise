/**
 * Chat API contracts — runtime validation without external deps.
 * Zod not installed; using manual validation with explicit types.
 */

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  message: string;
  latitude: number;
  longitude: number;
  locationName?: string;
  history?: ChatMessage[];
  profile?: { name?: string; contexts?: string[] };
}

export interface ChatLocation {
  latitude: number;
  longitude: number;
  name: string;
  isDefault: boolean;
}

export interface EnvironmentalSummary {
  temperature: number | null;
  humidity: number | null;
  condition: string;
  windSpeed: number | null;
  windCompass: string;
  aqiUs: number | null;
  aqiCategory: string | null;
  pm25: number | null;
  pm10: number | null;
  fetchedAt: string;
  isDefault: boolean;
}

export type ResponseSource = "model" | "data_only" | "error";
export type ResponseReason =
  | "ok"
  | "empty_content"
  | "empty_after_cleaning"
  | "upstream_timeout"
  | "upstream_rate_limit"
  | "upstream_error"
  | "upstream_auth"
  | "upstream_unavailable"
  | "upstream_truncated"
  | "validation_error"
  | "unavailable";

export interface ChatResponseSuccess {
  status: "ok";
  source: "model";
  requestId: string;
  reply: string;
  location: ChatLocation;
  dataSummary: EnvironmentalSummary;
}

export interface ChatResponseDegraded {
  status: "degraded";
  source: "data_only";
  requestId: string;
  reply: string;
  location: ChatLocation;
  dataSummary: EnvironmentalSummary;
  reason: ResponseReason;
}

export interface ChatResponseError {
  status: "error";
  requestId: string;
  error: string;
  code: ResponseReason;
}

export type ChatResponse =
  | ChatResponseSuccess
  | ChatResponseDegraded
  | ChatResponseError;

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Validation constants
 */
export const VALIDATION = {
  MESSAGE_MAX_LENGTH: 2000,
  LOCATION_NAME_MAX_LENGTH: 100,
  HISTORY_MAX_TURNS: 3,
  HISTORY_MAX_MESSAGES: 6, // 3 user + 3 assistant
  MESSAGE_CONTENT_MAX_LENGTH: 4000,
} as const;

/**
 * Validate chat request — returns parsed data or error.
 */
export function validateChatRequest(
  body: unknown
): ValidationResult<ChatRequest> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const b = body as Record<string, unknown>;

  // message: required, non-empty string, length limit
  const message = b.message;
  if (typeof message !== "string" || message.trim().length === 0) {
    return { ok: false, error: "A valid message is required." };
  }
  if (message.length > VALIDATION.MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Message exceeds maximum length of ${VALIDATION.MESSAGE_MAX_LENGTH} characters.`,
    };
  }

  // latitude: required number, valid range
  const latitude = b.latitude;
  if (typeof latitude !== "number" || !Number.isFinite(latitude)) {
    return { ok: false, error: "Valid latitude is required." };
  }
  if (latitude < -90 || latitude > 90) {
    return { ok: false, error: "Latitude must be between -90 and 90." };
  }

  // longitude: required number, valid range
  const longitude = b.longitude;
  if (typeof longitude !== "number" || !Number.isFinite(longitude)) {
    return { ok: false, error: "Valid longitude is required." };
  }
  if (longitude < -180 || longitude > 180) {
    return { ok: false, error: "Longitude must be between -180 and 180." };
  }

  // locationName: optional string, length limit
  let locationName: string | undefined;
  if (b.locationName !== undefined) {
    if (typeof b.locationName !== "string") {
      return { ok: false, error: "locationName must be a string." };
    }
    if (b.locationName.length > VALIDATION.LOCATION_NAME_MAX_LENGTH) {
      return {
        ok: false,
        error: `locationName exceeds maximum length of ${VALIDATION.LOCATION_NAME_MAX_LENGTH} characters.`,
      };
    }
    locationName = b.locationName;
  }

  // history: optional array, bounded, no system/developer/tool roles
  let history: ChatMessage[] | undefined;
  if (b.history !== undefined) {
    if (!Array.isArray(b.history)) {
      return { ok: false, error: "history must be an array." };
    }
    if (b.history.length > VALIDATION.HISTORY_MAX_MESSAGES) {
      return {
        ok: false,
        error: `history exceeds maximum of ${VALIDATION.HISTORY_MAX_MESSAGES} messages (${VALIDATION.HISTORY_MAX_TURNS} turns).`,
      };
    }

    history = [];
    for (let i = 0; i < b.history.length; i++) {
      const msg = b.history[i];
      if (!msg || typeof msg !== "object") {
        return { ok: false, error: `history[${i}] must be an object.` };
      }
      const m = msg as Record<string, unknown>;
      if (typeof m.role !== "string" || !["user", "assistant"].includes(m.role)) {
        return {
          ok: false,
          error: `history[${i}].role must be "user" or "assistant" (system/developer roles not permitted).`,
        };
      }
      if (typeof m.content !== "string") {
        return { ok: false, error: `history[${i}].content must be a string.` };
      }
      if (m.content.length > VALIDATION.MESSAGE_CONTENT_MAX_LENGTH) {
        return {
          ok: false,
          error: `history[${i}].content exceeds maximum length.`,
        };
      }
      history.push({ role: m.role as "user" | "assistant", content: m.content });
    }

    // Must alternate user/assistant, ending with assistant (last user message is current, not in history)
    for (let i = 0; i < history.length; i++) {
      const expectedRole = i % 2 === 0 ? "user" : "assistant";
      if (history[i].role !== expectedRole) {
        return {
          ok: false,
          error: `history[${i}] role must be "${expectedRole}" (alternating user/assistant).`,
        };
      }
    }
    // Last message in history should be from assistant (complete turn)
    if (history.length > 0 && history[history.length - 1].role !== "assistant") {
      return { ok: false, error: "History must end with an assistant message (complete turns only)." };
    }
  }

  // profile: optional object with name and contexts
  let profile: ChatRequest["profile"] | undefined;
  if (b.profile !== undefined) {
    if (!b.profile || typeof b.profile !== "object") {
      return { ok: false, error: "profile must be an object." };
    }
    const p = b.profile as Record<string, unknown>;
    const name = typeof p.name === "string" ? p.name.trim().slice(0, 40) : undefined;
    let contexts: string[] | undefined;
    if (Array.isArray(p.contexts)) {
      contexts = p.contexts
        .filter((c) => typeof c === "string")
        .slice(0, 5);
    }
    if (name || contexts?.length) {
      profile = { name, contexts };
    }
  }

  return {
    ok: true,
    data: {
      message: message.trim(),
      latitude,
      longitude,
      locationName,
      history: history ?? [],
      profile,
    },
  };
}

/**
 * Validate coordinates only (for non-chat endpoints).
 */
export function validateCoordinates(lat: unknown, lon: unknown): {
  ok: boolean;
  latitude?: number;
  longitude?: number;
  error?: string;
} {
  if (typeof lat !== "number" || !Number.isFinite(lat)) {
    return { ok: false, error: "Valid latitude is required." };
  }
  if (lat < -90 || lat > 90) {
    return { ok: false, error: "Latitude must be between -90 and 90." };
  }
  if (typeof lon !== "number" || !Number.isFinite(lon)) {
    return { ok: false, error: "Valid longitude is required." };
  }
  if (lon < -180 || lon > 180) {
    return { ok: false, error: "Longitude must be between -180 and 180." };
  }
  return { ok: true, latitude: lat, longitude: lon };
}