/**
 * Server-side message construction for NIM chat completions.
 * Builds: system prompt + bounded history + current user message with env context.
 */

import { SYSTEM_PROMPT } from "./persona";
import { NormalizedEnv, formatEnvForPrompt } from "./env-context";
import { ChatMessage, VALIDATION } from "./chat-schemas";

export interface BuiltMessages {
  messages: ChatMessage[];
  systemPrompt: string;
  boundedHistory: ChatMessage[];
  userMessage: string;
}

/**
 * Build the complete messages array for NIM API.
 * - System prompt is authoritative (server-built, never from client)
 * - History is bounded to last N complete user-assistant turns
 * - Current user message includes environmental context inline
 * - User question appears exactly once (as the last user message)
 */
export function buildChatMessages(
  userQuestion: string,
  env: NormalizedEnv,
  history: ChatMessage[],
  maxHistoryTurns: number = VALIDATION.HISTORY_MAX_TURNS,
  profileBlock?: string
): BuiltMessages {
  // 1. Authoritative system prompt (server-built)
  const systemPrompt = SYSTEM_PROMPT;

  // 2. Bound history to last N complete turns
  // History passed in should already be alternating user/assistant ending with assistant
  // Take last maxHistoryTurns * 2 messages
  const maxHistoryMessages = maxHistoryTurns * 2;
  const boundedHistory = history.slice(-maxHistoryMessages);

  // 3. Build current user message with environmental context and profile
  const envContext = formatEnvForPrompt(env);
  const profilePart = profileBlock ? ` ${profileBlock}` : "";
  const userMessage = `${envContext}${profilePart} ${userQuestion}`;

  // 4. Assemble messages: system + bounded history + current user
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...boundedHistory,
    { role: "user", content: userMessage },
  ];

  return {
    messages,
    systemPrompt,
    boundedHistory,
    userMessage,
  };
}

/**
 * Calculate approximate token count for messages (rough heuristic: 1 token ≈ 4 chars).
 * Used for diagnostics, not enforcement (NIM handles its own limits).
 */
export function estimateTokens(messages: ChatMessage[]): number {
  let totalChars = 0;
  for (const m of messages) {
    totalChars += m.content.length;
  }
  return Math.ceil(totalChars / 4);
}