/**
 * Automated tests for chat request/response validation and edge cases.
 * Run with: npx jest (if jest configured) or npx tsx --test
 */

import {
  validateChatRequest,
  validateCoordinates,
  VALIDATION,
} from "../chat-schemas";

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

  // ===== validateCoordinates =====
  test("validateCoordinates: valid lat/lon", () => {
    const r = validateCoordinates(17.385, 78.4867);
    assert(r.ok === true && r.latitude === 17.385 && r.longitude === 78.4867);
  });

  test("validateCoordinates: zero coordinates (valid)", () => {
    const r = validateCoordinates(0, 0);
    assert(r.ok === true && r.latitude === 0 && r.longitude === 0);
  });

  test("validateCoordinates: negative coordinates (valid)", () => {
    const r = validateCoordinates(-33.8688, 151.2093);
    assert(r.ok === true);
  });

  test("validateCoordinates: latitude > 90", () => {
    const r = validateCoordinates(91, 0);
    assert(r.ok === false && r.error?.includes("Latitude"));
  });

  test("validateCoordinates: latitude < -90", () => {
    const r = validateCoordinates(-91, 0);
    assert(r.ok === false && r.error?.includes("Latitude"));
  });

  test("validateCoordinates: longitude > 180", () => {
    const r = validateCoordinates(0, 181);
    assert(r.ok === false && r.error?.includes("Longitude"));
  });

  test("validateCoordinates: longitude < -180", () => {
    const r = validateCoordinates(0, -181);
    assert(r.ok === false && r.error?.includes("Longitude"));
  });

  test("validateCoordinates: NaN latitude", () => {
    const r = validateCoordinates(NaN, 0);
    assert(r.ok === false && r.error?.includes("latitude"));
  });

  test("validateCoordinates: Infinity longitude", () => {
    const r = validateCoordinates(0, Infinity);
    assert(r.ok === false && r.error?.includes("longitude"));
  });

  test("validateCoordinates: string input", () => {
    const r = validateCoordinates("17.385" as unknown, 78.4867);
    assert(r.ok === false && r.error?.includes("latitude"));
  });

  // ===== validateChatRequest =====
  test("validateChatRequest: valid minimal request", () => {
    const r = validateChatRequest({
      message: "What's the weather?",
      latitude: 17.385,
      longitude: 78.4867,
    });
    assert(r.ok === true);
    assert(r.data?.message === "What's the weather?");
    assert(r.data?.latitude === 17.385);
    assert(r.data?.longitude === 78.4867);
    assert(r.data?.history?.length === 0);
  });

  test("validateChatRequest: valid with locationName and history", () => {
    const r = validateChatRequest({
      message: "Is it good for running?",
      latitude: 17.385,
      longitude: 78.4867,
      locationName: "Hyderabad, India",
      history: [
        { role: "user", content: "Where am I?" },
        { role: "assistant", content: "You're in Hyderabad." },
      ],
    });
    assert(r.ok === true);
    assert(r.data?.history.length === 2);
    assert(r.data?.history[0].role === "user");
    assert(r.data?.history[1].role === "assistant");
  });

  test("validateChatRequest: missing message", () => {
    const r = validateChatRequest({ latitude: 17.385, longitude: 78.4867 });
    assert(r.ok === false && r.error?.includes("message"));
  });

  test("validateChatRequest: empty message", () => {
    const r = validateChatRequest({ message: "", latitude: 17.385, longitude: 78.4867 });
    assert(r.ok === false && r.error?.includes("message"));
  });

  test("validateChatRequest: whitespace-only message", () => {
    const r = validateChatRequest({ message: "   ", latitude: 17.385, longitude: 78.4867 });
    assert(r.ok === false && r.error?.includes("message"));
  });

  test("validateChatRequest: message too long", () => {
    const longMsg = "a".repeat(VALIDATION.MESSAGE_MAX_LENGTH + 1);
    const r = validateChatRequest({ message: longMsg, latitude: 17.385, longitude: 78.4867 });
    assert(r.ok === false && r.error?.includes("maximum length"));
  });

  test("validateChatRequest: missing latitude", () => {
    const r = validateChatRequest({ message: "Hi", longitude: 78.4867 });
    assert(r.ok === false && r.error?.includes("latitude"));
  });

  test("validateChatRequest: invalid latitude type", () => {
    const r = validateChatRequest({ message: "Hi", latitude: "17.385" as unknown, longitude: 78.4867 });
    assert(r.ok === false && r.error?.includes("latitude"));
  });

  test("validateChatRequest: latitude out of range", () => {
    const r = validateChatRequest({ message: "Hi", latitude: 91, longitude: 78.4867 });
    assert(r.ok === false && r.error?.includes("Latitude"));
  });

  test("validateChatRequest: missing longitude", () => {
    const r = validateChatRequest({ message: "Hi", latitude: 17.385 });
    assert(r.ok === false && r.error?.includes("longitude"));
  });

  test("validateChatRequest: invalid longitude type", () => {
    const r = validateChatRequest({ message: "Hi", latitude: 17.385, longitude: "78.4867" as unknown });
    assert(r.ok === false && r.error?.includes("longitude"));
  });

  test("validateChatRequest: locationName too long", () => {
    const longName = "a".repeat(VALIDATION.LOCATION_NAME_MAX_LENGTH + 1);
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
      locationName: longName,
    });
    assert(r.ok === false && r.error?.includes("locationName"));
  });

  test("validateChatRequest: locationName not a string", () => {
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
      locationName: 123 as unknown,
    });
    assert(r.ok === false && r.error?.includes("string"));
  });

  test("validateChatRequest: history not an array", () => {
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
      history: "not array" as unknown,
    });
    assert(r.ok === false && r.error?.includes("array"));
  });

  test("validateChatRequest: history too many messages", () => {
    const manyMsgs = Array.from({ length: VALIDATION.HISTORY_MAX_MESSAGES + 1 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    }));
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
      history: manyMsgs,
    });
    assert(r.ok === false && r.error?.includes("maximum"));
  });

  test("validateChatRequest: history with system role rejected", () => {
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
      history: [{ role: "system", content: "You are a bot" }],
    });
    assert(r.ok === false && r.error?.includes('"user" or "assistant"'));
  });

  test("validateChatRequest: history with developer role rejected", () => {
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
      history: [{ role: "developer" as "user", content: "Instruction" }],
    });
    assert(r.ok === false && r.error?.includes('"user" or "assistant"'));
  });

  test("validateChatRequest: history with tool role rejected", () => {
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
      history: [{ role: "tool" as "user", content: "result" }],
    });
    assert(r.ok === false && r.error?.includes('"user" or "assistant"'));
  });

  test("validateChatRequest: history role not alternating", () => {
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
      history: [
        { role: "user", content: "Q1" },
        { role: "user", content: "Q2" }, // Should be assistant
      ],
    });
    assert(r.ok === false && r.error?.includes('role must be "assistant"'));
  });

  test("validateChatRequest: history must end with assistant", () => {
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
      history: [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "Q2" }, // Ends with user (incomplete)
      ],
    });
    assert(r.ok === false && r.error?.includes("end with an assistant message"));
  });

  test("validateChatRequest: history message content too long", () => {
    const longContent = "a".repeat(VALIDATION.MESSAGE_CONTENT_MAX_LENGTH + 1);
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
      history: [{ role: "user", content: longContent }],
    });
    assert(r.ok === false && r.error?.includes("maximum length"));
  });

  test("validateChatRequest: history missing content", () => {
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
      history: [{ role: "user", content: 123 as unknown }],
    });
    assert(r.ok === false && r.error?.includes("content must be a string"));
  });

  // ===== Edge cases =====
  test("validateChatRequest: trims message whitespace", () => {
    const r = validateChatRequest({
      message: "  What's the weather?  ",
      latitude: 17.385,
      longitude: 78.4867,
    });
    assert(r.ok === true && r.data?.message === "What's the weather?");
  });

  test("validateChatRequest: default history is empty array", () => {
    const r = validateChatRequest({
      message: "Hi",
      latitude: 17.385,
      longitude: 78.4867,
    });
    assert(r.ok === true && r.data?.history?.length === 0);
  });

  test("validateChatRequest: null body", () => {
    const r = validateChatRequest(null);
    assert(r.ok === false && r.error?.includes("JSON object"));
  });

  test("validateChatRequest: non-object body", () => {
    const r = validateChatRequest("not an object");
    assert(r.ok === false && r.error?.includes("JSON object"));
  });

  // Summary
  console.log(`\n--- Tests: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exit(1);
}

runTests();