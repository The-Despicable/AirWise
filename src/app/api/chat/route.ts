import { NextRequest, NextResponse } from "next/server";

// Modules
import {
  validateChatRequest,
  ChatRequest,
  ChatResponse,
  VALIDATION,
} from "@/lib/chat-schemas";
import { buildEnvContext, NormalizedEnv } from "@/lib/env-context";
import { buildChatMessages } from "@/lib/message-builder";
import {
  createNIMAdapter,
  nimChatComplete,
  classifyNIMError,
} from "@/lib/nim-adapter";
import { parseFinalAnswer, isValidFinalAnswer, getFailureReason } from "@/lib/answer-parser";
import {
  buildDiagnostics,
  logDiagnostics,
  buildSuccessResponse,
  buildDegradedResponse,
  buildErrorResponse,
  getHTTPStatus,
  hasData,
  DiagnosticReason,
} from "@/lib/diagnostics";
import { resolveLocationName } from "@/lib/geocode";

// In-memory rate limiter (per IP, sliding window)
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const requests = rateLimitMap.get(ip) ?? [];
  // Remove old entries outside window
  const recent = requests.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return true;
}

function getClientIP(req: NextRequest): string {
  // In production, use proper proxy headers
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

// Request body size limit (1 MB)
const MAX_BODY_SIZE = 1024 * 1024;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startMs = Date.now();

  // Rate limiting
  const clientIP = getClientIP(req);
  if (!checkRateLimit(clientIP)) {
    const durationMs = Date.now() - startMs;
    logDiagnostics(
      buildDiagnostics(
        requestId,
        process.env.NIM_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
        !!process.env.NVIDIA_NIM_API_KEY,
        durationMs,
        null,
        null,
        0,
        0,
        "error",
        "upstream_rate_limit",
        429,
        0,
        0
      )
    );
    return NextResponse.json(
      buildErrorResponse(requestId, "upstream_rate_limit", "Rate limit exceeded. Please try again."),
      { status: 429 }
    );
  }

  // Read body with size limit
  let bodyText: string;
  try {
    const contentLength = req.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BODY_SIZE) {
      throw new Error("Body too large");
    }
    bodyText = await req.text();
    if (bodyText.length > MAX_BODY_SIZE) {
      throw new Error("Body too large");
    }
  } catch {
    const durationMs = Date.now() - startMs;
    logDiagnostics(
      buildDiagnostics(
        requestId,
        process.env.NIM_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
        !!process.env.NVIDIA_NIM_API_KEY,
        durationMs,
        null,
        null,
        0,
        0,
        "error",
        "validation_error",
        413,
        0,
        0
      )
    );
    return NextResponse.json(
      buildErrorResponse(requestId, "validation_error", "Request body too large."),
      { status: 413 }
    );
  }

  // Parse and validate request
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    const durationMs = Date.now() - startMs;
    logDiagnostics(
      buildDiagnostics(
        requestId,
        process.env.NIM_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
        !!process.env.NVIDIA_NIM_API_KEY,
        durationMs,
        null,
        null,
        0,
        0,
        "error",
        "validation_error",
        400,
        0,
        0
      )
    );
    return NextResponse.json(
      buildErrorResponse(requestId, "validation_error", "Invalid JSON body."),
      { status: 400 }
    );
  }

  const validation = validateChatRequest(body);
  if (!validation.ok) {
    const durationMs = Date.now() - startMs;
    logDiagnostics(
      buildDiagnostics(
        requestId,
        process.env.NIM_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b",
        !!process.env.NVIDIA_NIM_API_KEY,
        durationMs,
        null,
        null,
        0,
        0,
        "error",
        "validation_error",
        400,
        0,
        0
      )
    );
    return NextResponse.json(
      buildErrorResponse(requestId, "validation_error", validation.error!),
      { status: 400 }
    );
  }

  const chatReq: ChatRequest = validation.data!;

  // Resolve location name (independent of conversation history)
  let resolvedName: string;
  let isDefault = false;

  if (chatReq.locationName) {
    resolvedName = chatReq.locationName;
    isDefault = chatReq.locationName.includes("(default)");
  } else {
    resolvedName = await resolveLocationName(chatReq.latitude, chatReq.longitude);
    isDefault = resolvedName.includes("(default)");
  }
  // Build authoritative environmental snapshot
  const env: NormalizedEnv = await buildEnvContext(
    chatReq.latitude,
    chatReq.longitude,
    resolvedName,
    isDefault
  );

  // Build messages: system + bounded history + current user with context
  const { messages } = buildChatMessages(
    chatReq.message,
    env,
    chatReq.history ?? [],
    VALIDATION.HISTORY_MAX_TURNS
  );

  // NIM adapter
  const { client, config } = createNIMAdapter();
  const modelId = config.model;

  let source: "model" | "data_only" | "error" = "error";
  let reason: DiagnosticReason = "upstream_error";
  let finishReason: string | null = null;
  let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null = null;
  let contentLength = 0;
  let reasoningLength = 0;
  let reply: string | null = null;
  let httpStatus = 502;
  try {
    if (!client) {
      source = "data_only";
      reason = "unavailable";
    } else {
      const nimResult = await nimChatComplete(client, config, messages, requestId);

      contentLength = nimResult.content.length;
      finishReason = nimResult.finishReason;
      usage = nimResult.usage;
      reasoningLength = 0; // Will be set by parser

      // Parse final answer
      const parseResult = parseFinalAnswer(nimResult.content);
      reasoningLength = parseResult.reasoningLength;

      if (isValidFinalAnswer(parseResult)) {
        source = "model";
        reason = "ok";
        reply = parseResult.finalAnswer!;
      } else {
        source = "data_only";
        reason = getFailureReason(parseResult, finishReason as "stop" | "length" | null);
        reply = null;
      }
    }
  } catch (err) {
    const classified = classifyNIMError(err);
    httpStatus = classified.status ?? 502;
    reason = classified.reason;
    source = "data_only";
    reply = null;
  }

  const durationMs = Date.now() - startMs;

  // Build response based on source
  const location = {
    latitude: chatReq.latitude,
    longitude: chatReq.longitude,
    name: resolvedName,
    isDefault,
  };

  const dataSummary = {
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

  const dataAvailable = hasData(env);

  // Diagnostics
  const diagMeta = buildDiagnostics(
    requestId,
    modelId,
    !!client,
    durationMs,
    finishReason,
    usage,
    contentLength,
    reasoningLength,
    source,
    reason,
    httpStatus,
    chatReq.latitude,
    chatReq.longitude
  );
  logDiagnostics(diagMeta);

  // Build appropriate response
  let response: ChatResponse;
  if (source === "model" && reply) {
    response = buildSuccessResponse(requestId, reply, location, dataSummary);
    httpStatus = 200;
  } else if (source === "data_only") {
    response = buildDegradedResponse(requestId, location, dataSummary, reason, dataAvailable);
    httpStatus = getHTTPStatus("data_only", reason);
  } else {
    response = buildErrorResponse(requestId, reason, "NVIDIA NIM inference service encountered an error.");
    httpStatus = getHTTPStatus("error", reason);
  }

  return NextResponse.json(response, { status: httpStatus });
}