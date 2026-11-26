/**
 * NVIDIA NIM adapter — uses verified contract from NVIDIA API reference.
 * Model: nvidia/nemotron-3.5-lightning-30b-a3b
 * Endpoint: https://integrate.api.nvidia.com/v1/chat/completions
 * Context: 1,048,576 tokens (shared prompt + reasoning + output)
 * Reasoning: enabled by default; shares max_tokens budget.
 * Controls: reasoning_budget, chat_template_kwargs.enable_thinking
 * Response: ChatCompletion with choices[0].message.content, finish_reason, usage
 */
import OpenAI from "openai";
import { ChatMessage } from "./chat-schemas";

// NIM-specific extension fields not in standard OpenAI types
export interface NIMChatCompletionCreateParams extends OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  reasoning_budget?: number;
  chat_template_kwargs?: {
    enable_thinking?: boolean;
  };
}

export interface NIMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
  defaultMaxTokens: number;
  defaultReasoningBudget: number;
  enableThinking: boolean;
}

export interface NIMResponse {
  content: string;
  finishReason: "stop" | "length" | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  raw: unknown;
}

export interface NIMError extends Error {
  status?: number;
  code?: string;
}

/**
 * Create NIM adapter from environment configuration.
 * Model and parameters configurable via server-only env vars.
 */
export function createNIMAdapter(): { client: OpenAI | null; config: NIMConfig } {
  const apiKey = process.env.NVIDIA_NIM_API_KEY;
  const baseURL = process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
  const model = process.env.NIM_MODEL ?? "nvidia/nemotron-3.5-lightning-30b-a3b";
  const timeoutMs = Number(process.env.NIM_TIMEOUT_MS) || 30000;
  const defaultMaxTokens = Number(process.env.NIM_MAX_TOKENS) || 2048;
  const defaultReasoningBudget = Number(process.env.NIM_REASONING_BUDGET) ?? 1024;
  const enableThinking = process.env.NIM_ENABLE_THINKING !== "false"; // default true

  const config: NIMConfig = {
    apiKey: apiKey ?? "",
    baseURL,
    model,
    timeoutMs,
    defaultMaxTokens,
    defaultReasoningBudget,
    enableThinking,
  };

  const client = apiKey
    ? new OpenAI({
        baseURL: config.baseURL,
        apiKey: config.apiKey,
        timeout: config.timeoutMs,
        maxRetries: 0, // We handle retries explicitly if needed
      })
    : null;

  return { client, config };
}

/**
 * Execute chat completion with NIM adapter.
 * - Applies reasoning budget and thinking controls per verified contract
 * - Enforces request timeout via OpenAI SDK
 * - Returns parsed response with finish_reason and usage
 */
export async function nimChatComplete(
  client: OpenAI,
  config: NIMConfig,
  messages: ChatMessage[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _requestId: string
): Promise<NIMResponse> {
  if (!client) {
    const err = new Error("NIM client not configured") as NIMError;
    err.status = 503;
    err.code = "SERVICE_UNAVAILABLE";
    throw err;
  }
  // NIM-specific extensions via typed params (extends OpenAI base params)
  const params: NIMChatCompletionCreateParams = {
    model: config.model,
    messages,
    temperature: 0.2,
    max_tokens: config.defaultMaxTokens,
    reasoning_budget: config.defaultReasoningBudget,
    chat_template_kwargs: {
      enable_thinking: config.enableThinking,
    },
    stream: false,
  };
  const completion = await client.chat.completions.create(params);

  const choice = completion.choices[0];
  const content = choice?.message?.content ?? "";
  const finishReason = choice?.finish_reason ?? null;

  return {
    content,
    finishReason: finishReason as "stop" | "length" | null,
    usage: completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : null,
    raw: completion,
  };
}

/**
 * Classify NIM error into categorized reason for diagnostics and response.
 */
export function classifyNIMError(err: unknown): {
  status: number | undefined;
  reason: "upstream_timeout" | "upstream_rate_limit" | "upstream_error" | "upstream_auth" | "upstream_unavailable";
  message: string;
} {
  const nimErr = err as NIMError;

  // Timeout
  if (nimErr.code === "ECONNABORTED" || nimErr.message?.includes("timeout")) {
    return { status: 504, reason: "upstream_timeout", message: "NIM request timed out." };
  }

  // HTTP status from OpenAI SDK error
  const status = nimErr.status;

  if (status === 429) {
    return { status: 429, reason: "upstream_rate_limit", message: "NIM rate limit exceeded." };
  }
  if (status === 401 || status === 403) {
    return { status, reason: "upstream_auth", message: "NIM authentication failed." };
  }
  if (status && status >= 500) {
    return { status, reason: "upstream_error", message: `NIM upstream error: ${status}` };
  }
  if (status === 503 || nimErr.code === "SERVICE_UNAVAILABLE") {
    return { status: 503, reason: "upstream_unavailable", message: "NIM service unavailable." };
  }

  return {
    status,
    reason: "upstream_error",
    message: nimErr.message ?? "Unknown NIM error.",
  };
}