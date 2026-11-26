/**
 * Final-answer parser — extracts valid model output, never exposes reasoning.
 * Nemotron 3.5 Lightning uses `think` reasoning blocks by default.
 * Per verified contract: reasoning and visible output share max_tokens budget.
 * 
 * Required cases:
 * - Ordinary final text (no think tags)
 * - Complete reasoning block followed by final text
 * - Reasoning-only output
 * - Unfinished reasoning block (truncated)
 * - Empty content
 * - Whitespace-only content
 * - Malformed wrappers
 * 
 * An absent final answer is an inference failure — never manufacture an answer.
 */

export interface ParseResult {
  finalAnswer: string | null;
  hasReasoning: boolean;
  reasoningLength: number;
  wasTruncated: boolean;
  rawLength: number;
}

// Think tag markers used by Nemotron
const THINK_OPEN = "think";

/**
 * Parse model output into final answer and reasoning metadata.
 * Never returns reasoning text as final answer.
 * Returns null finalAnswer if no valid final text exists.
 */
export function parseFinalAnswer(rawOutput: string): ParseResult {
  const result: ParseResult = {
    finalAnswer: null,
    hasReasoning: false,
    reasoningLength: 0,
    wasTruncated: false,
    rawLength: rawOutput.length,
  };

  if (!rawOutput || rawOutput.trim().length === 0) {
    return result;
  }

  const text = rawOutput.trim();

  // Check for complete think blocks: think.../think
  const thinkOpenRegex = new RegExp(`<${THINK_OPEN}>`);
  const thinkCloseRegex = new RegExp(`</${THINK_OPEN}>`);
  const thinkOpenMatch = text.match(thinkOpenRegex);
  const thinkCloseMatch = text.match(thinkCloseRegex);

  if (thinkOpenMatch && thinkCloseMatch) {
    // Complete reasoning block present
    result.hasReasoning = true;
    const openIndex = thinkOpenMatch.index!;
    const closeIndex = thinkCloseMatch.index! + thinkCloseMatch[0].length;
    const reasoningBlock = text.slice(openIndex, closeIndex);
    result.reasoningLength = reasoningBlock.length;

    // Final answer is everything after the closing think tag
    const afterReasoning = text.slice(closeIndex).trim();
    if (afterReasoning.length > 0) {
      result.finalAnswer = afterReasoning;
    } else {
      // Reasoning-only output (no final text after think block)
      result.finalAnswer = null;
    }
    return result;
  }

  if (thinkOpenMatch && !thinkCloseMatch) {
    // Unfinished reasoning block — truncated generation
    result.hasReasoning = true;
    result.wasTruncated = true;
    const openIndex = thinkOpenMatch.index!;
    const reasoningBlock = text.slice(openIndex);
    result.reasoningLength = reasoningBlock.length;

    // Check if there's any content before the unclosed think tag
    const beforeReasoning = text.slice(0, openIndex).trim();
    if (beforeReasoning.length > 0) {
      // Some final text before reasoning started
      result.finalAnswer = beforeReasoning;
    } else {
      // Only unfinished reasoning — no final answer
      result.finalAnswer = null;
    }
    return result;
  }

  if (!thinkOpenMatch && thinkCloseMatch) {
    // Malformed: closing tag without opening — treat as plain text
    // Could strip the orphaned closing tag
    const cleaned = text.replace(thinkCloseRegex, "").trim();
    result.finalAnswer = cleaned.length > 0 ? cleaned : null;
    return result;
  }

  // No think tags — plain final text
  result.finalAnswer = text.length > 0 ? text : null;
  return result;
}

/**
 * Determine if a parse result constitutes a valid final answer for the user.
 * Criteria: non-null, non-empty after trim, reasonable minimum length.
 */
export function isValidFinalAnswer(result: ParseResult): boolean {
  return (
    result.finalAnswer !== null &&
    result.finalAnswer.trim().length >= 5 // Minimum meaningful content
  );
}

/**
 * Get categorized failure reason from parse result and finish_reason.
 */
export function getFailureReason(
  result: ParseResult,
  finishReason: "stop" | "length" | null
): "empty_content" | "empty_after_cleaning" | "upstream_truncated" {
  if (!result.rawLength || result.rawLength === 0) {
    return "empty_content";
  }
  if (result.wasTruncated || finishReason === "length") {
    return "upstream_truncated";
  }
  return "empty_after_cleaning";
}