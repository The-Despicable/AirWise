/**
 * Tests for final-answer parser (handle think tags).
 */

import { parseFinalAnswer, isValidFinalAnswer, getFailureReason, ParseResult } from "../answer-parser";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`✗ ${name}: ${(e as Error).message}`);
      failed++;
    }
  }

  // Test cases for parseFinalAnswer
  test("parseFinalAnswer: ordinary final text (no think tags)", () => {
    const result = parseFinalAnswer("It's 23°C and clear in Hyderabad.");
    assert(result.finalAnswer === "It's 23°C and clear in Hyderabad.");
    assert(result.hasReasoning === false);
    assert(result.reasoningLength === 0);
    assert(result.wasTruncated === false);
  });

  test("parseFinalAnswer: empty content", () => {
    const result = parseFinalAnswer("");
    assert(result.finalAnswer === null);
    assert(result.rawLength === 0);
  });

  test("parseFinalAnswer: whitespace only", () => {
    const result = parseFinalAnswer("   \n\t  ");
    assert(result.finalAnswer === null);
  });

  test("parseFinalAnswer: complete reasoning block followed by final text", () => {
    const input = "<think>Reasoning about the weather conditions...</think>\n\nIt's 23°C with clear skies.";
    const result = parseFinalAnswer(input);
    assert(result.finalAnswer === "It's 23°C with clear skies.");
    assert(result.hasReasoning === true);
    assert(result.reasoningLength > 0);
    assert(result.wasTruncated === false);
  });

  test("parseFinalAnswer: reasoning-only output (no final text)", () => {
    const input = "<think>Let me think about the humidity... The humidity is 86%.</think>";
    const result = parseFinalAnswer(input);
    assert(result.finalAnswer === null);
    assert(result.hasReasoning === true);
    assert(result.wasTruncated === false);
  });

  test("parseFinalAnswer: unfinished reasoning block (truncated)", () => {
    const input = "<think>Let me analyze the wind patterns and then";
    const result = parseFinalAnswer(input);
    assert(result.finalAnswer === null);
    assert(result.hasReasoning === true);
    assert(result.wasTruncated === true);
  });

  test("parseFinalAnswer: text before unclosed think tag", () => {
    const input = "The temperature is 23°C. <think>Now let me check humidity...";
    const result = parseFinalAnswer(input);
    assert(result.finalAnswer === "The temperature is 23°C.");
    assert(result.hasReasoning === true);
    assert(result.wasTruncated === true);
  });

  test("parseFinalAnswer: malformed closing tag only", () => {
    const input = "It's 23°C.</think>";
    const result = parseFinalAnswer(input);
    // Should treat as plain text after stripping orphaned closing tag
    assert(result.finalAnswer !== null);
    assert(result.finalAnswer!.includes("23°C"));
  });

  test("parseFinalAnswer: multiple think blocks (uses first complete)", () => {
    const input = "<think>First reasoning</think>Answer 1<think>Second reasoning</think>Answer 2";
    const result = parseFinalAnswer(input);
    // First complete block ends, then text, then another block starts
    assert(result.finalAnswer !== null);
  });

  test("parseFinalAnswer: reasoning with newlines", () => {
    const input = "<think>\n  Step 1: Check temperature\n  Step 2: Check humidity\n</think>\n\nIt's pleasant at 23°C.";
    const result = parseFinalAnswer(input);
    assert(result.finalAnswer === "It's pleasant at 23°C.");
    assert(result.hasReasoning === true);
  });

  test("isValidFinalAnswer: valid answer returns true", () => {
    const result: ParseResult = {
      finalAnswer: "It's 23°C in Hyderabad.",
      hasReasoning: false,
      reasoningLength: 0,
      wasTruncated: false,
      rawLength: 25,
    };
    assert(isValidFinalAnswer(result) === true);
  });

  test("isValidFinalAnswer: null answer returns false", () => {
    const result: ParseResult = {
      finalAnswer: null,
      hasReasoning: false,
      reasoningLength: 0,
      wasTruncated: false,
      rawLength: 0,
    };
    assert(isValidFinalAnswer(result) === false);
  });

  test("isValidFinalAnswer: too short answer returns false", () => {
    const result: ParseResult = {
      finalAnswer: "OK",
      hasReasoning: false,
      reasoningLength: 0,
      wasTruncated: false,
      rawLength: 2,
    };
    assert(isValidFinalAnswer(result) === false);
  });

  test("isValidFinalAnswer: whitespace-only answer returns false", () => {
    const result: ParseResult = {
      finalAnswer: "   ",
      hasReasoning: false,
      reasoningLength: 0,
      wasTruncated: false,
      rawLength: 3,
    };
    assert(isValidFinalAnswer(result) === false);
  });

  test("isValidFinalAnswer: reasoning-only (wasTruncated=false, no final) returns false", () => {
    const result: ParseResult = {
      finalAnswer: null,
      hasReasoning: true,
      reasoningLength: 50,
      wasTruncated: false,
      rawLength: 50,
    };
    assert(isValidFinalAnswer(result) === false);
  });

  test("getFailureReason: empty_content for zero raw length", () => {
    const result: ParseResult = { finalAnswer: null, hasReasoning: false, reasoningLength: 0, wasTruncated: false, rawLength: 0 };
    assert(getFailureReason(result, "stop") === "empty_content");
  });

  test("getFailureReason: upstream_truncated when wasTruncated true", () => {
    const result: ParseResult = { finalAnswer: null, hasReasoning: true, reasoningLength: 50, wasTruncated: true, rawLength: 50 };
    assert(getFailureReason(result, "stop") === "upstream_truncated");
  });

  test("getFailureReason: upstream_truncated when finishReason=length", () => {
    const result: ParseResult = { finalAnswer: null, hasReasoning: false, reasoningLength: 0, wasTruncated: false, rawLength: 100 };
    assert(getFailureReason(result, "length") === "upstream_truncated");
  });

  test("getFailureReason: empty_after_cleaning for non-truncated empty final", () => {
    const result: ParseResult = { finalAnswer: null, hasReasoning: true, reasoningLength: 50, wasTruncated: false, rawLength: 50 };
    assert(getFailureReason(result, "stop") === "empty_after_cleaning");
  });

  console.log(`\n--- Tests: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exit(1);
}

runTests();