/**
 * Privacy-safe diagnostics and error mapping.
 * Logs operational metadata only — never keys, prompts, conversations, or PII.
 */

import { ChatResponseSuccess, ChatResponseDegraded, ChatResponseError } from "./chat-schemas";
import { buildDataSummary, NormalizedEnv } from "./env-context";

export type DataSummary = ReturnType<typeof buildDataSummary>;

export type DiagnosticReason =
  | "ok"
  | "empty_content"
  | "empty_after_cleaning"
  | "upstream_truncated"
  | "upstream_timeout"
  | "upstream_rate_limit"
  | "upstream_error"
  | "upstream_auth"
  | "upstream_unavailable"
  | "validation_error"
  | "unavailable";

export interface DiagnosticMeta {
  requestId: string;
  modelId: string;
  nimConfigured: boolean;
  durationMs: number;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  contentLength: number;
  reasoningLength: number;
  source: "model" | "data_only" | "error";
  reason: DiagnosticReason;
  httpStatus: number | null;
  // Location info: lat/lon rounded to 0.01° (~1km) for privacy
  locationHash: string;
}

/**
 * Generate a privacy-safe location hash (rounded coordinates).
 */
export function hashLocation(lat: number, lon: number): string {
  const rlat = Math.round(lat * 100) / 100;
  const rlon = Math.round(lon * 100) / 100;
  return `${rlat},${rlon}`;
}

/**
 * Log diagnostic metadata (server-side only).
 * Safe for production: no secrets, no prompts, no conversation content.
 */
export function logDiagnostics(meta: DiagnosticMeta): void {
  console.log(JSON.stringify(meta));
}

/**
 * Build diagnostics meta from request/response data.
 */
export function buildDiagnostics(
  requestId: string,
  modelId: string,
  nimConfigured: boolean,
  durationMs: number,
  finishReason: string | null,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null,
  contentLength: number,
  reasoningLength: number,
  source: "model" | "data_only" | "error",
  reason: DiagnosticReason,
  httpStatus: number | null,
  latitude: number,
  longitude: number
): DiagnosticMeta {
  return {
    requestId,
    modelId,
    nimConfigured,
    durationMs,
    finishReason,
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    contentLength,
    reasoningLength,
    source,
    reason,
    httpStatus,
    locationHash: hashLocation(latitude, longitude),
  };
}

/**
 * Map internal reason to user-facing safe message for degraded responses.
 */
export function getDegradedMessage(reason: DiagnosticReason, dataAvailable: boolean): string {
  switch (reason) {
    case "upstream_rate_limit":
      return "I have the weather readings, but the AI service is busy. Please try again in a moment.";
    case "upstream_timeout":
      return "I have the weather readings, but the AI service took too long to respond. Please try again.";
    case "upstream_auth":
    case "upstream_unavailable":
      return "I have the weather readings, but the AI service is currently unavailable. Please try again later.";
    case "upstream_error":
    case "upstream_truncated":
    case "empty_content":
    case "empty_after_cleaning":
      if (dataAvailable) {
        return "I have the weather readings, but I couldn't generate advice just now. Please try again.";
      }
      return "I couldn't generate advice, and weather data is also unavailable. Please try again.";
    case "validation_error":
      return "I couldn't process your request. Please check your input and try again.";
    default:
      if (dataAvailable) {
        return "I have the weather readings, but I couldn't generate advice just now. Please try again.";
      }
      return "I couldn't generate advice, and weather data is also unavailable. Please try again.";
  }
}

/**
 * Build success response (source = model).
 */
export function buildSuccessResponse(
  requestId: string,
  reply: string,
  location: { latitude: number; longitude: number; name: string; isDefault: boolean },
  dataSummary: DataSummary
): ChatResponseSuccess {
  return {
    status: "ok",
    source: "model",
    requestId,
    reply,
    location,
    dataSummary,
  };
}

/**
 * Build degraded response (source = data_only) — honest about failure.
 */
export function buildDegradedResponse(
  requestId: string,
  location: { latitude: number; longitude: number; name: string; isDefault: boolean },
  dataSummary: DataSummary,
  reason: DiagnosticReason,
  dataAvailable: boolean
): ChatResponseDegraded {
  return {
    status: "degraded",
    source: "data_only",
    requestId,
    reply: getDegradedMessage(reason, dataAvailable),
    location,
    dataSummary,
    reason,
  };
}

/**
 * Build error response (source = error) — request failed entirely.
 */
export function buildErrorResponse(
  requestId: string,
  code: DiagnosticReason,
  message: string
): ChatResponseError {
  return {
    status: "error",
    requestId,
    error: message,
    code,
  };
}

/**
 * HTTP status mapping for response types.
 */
export function getHTTPStatus(source: "model" | "data_only" | "error", reason?: DiagnosticReason): number {
  if (source === "model") return 200;
  if (source === "data_only") return 200; // Degraded but data available
  // Error responses
  switch (reason) {
    case "validation_error":
      return 400;
    case "upstream_auth":
      return 401;
    case "upstream_rate_limit":
      return 429;
    case "upstream_timeout":
      return 504;
    case "upstream_unavailable":
      return 503;
    default:
      return 502;
  }
}

/**
 * Check if environmental data is meaningfully available.
 */
export function hasData(env: NormalizedEnv): boolean {
  return (
    env.temperature !== null ||
    env.humidity !== null ||
    env.windSpeed !== null ||
    env.aqiUs !== null
  );
}