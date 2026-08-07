import { describe, expect, it } from "vitest";
import { extractSingleJsonObject } from "../services/book-review-json.js";

describe("extractSingleJsonObject", () => {
  it("parses clean JSON", () => {
    expect(extractSingleJsonObject('{"summary":"clean"}')).toEqual({ summary: "clean" });
  });

  it("parses one valid final object after a noisy reasoning prefix", () => {
    const output = [
      "Reasoning: review the chapter against the rubric.",
      "Diagnostic template {scores go here} was considered.",
      '{"scores":{"pacing":8},"summary":"Solid chapter.","findings":[]}',
    ].join("\n");

    expect(extractSingleJsonObject(output)).toEqual({
      scores: { pacing: 8 },
      summary: "Solid chapter.",
      findings: [],
    });
  });

  it("does not treat braces inside JSON strings as object boundaries", () => {
    expect(
      extractSingleJsonObject('{"summary":"A literal {brace} and an escaped \\\"quote\\\".","findings":[]}'),
    ).toEqual({
      summary: 'A literal {brace} and an escaped "quote".',
      findings: [],
    });
  });

  it.each(["not JSON", "reasoning {not valid JSON}", '{"unterminated": true'])(
    "rejects malformed or missing JSON: %s",
    (output) => {
      expect(() => extractSingleJsonObject(output)).toThrow("no valid JSON object");
    },
  );

  it("rejects multiple valid outermost objects instead of guessing", () => {
    expect(() =>
      extractSingleJsonObject('{"diagnostic":"first"}\n{"scores":{},"summary":"second"}'),
    ).toThrow("ambiguous JSON objects");
  });
});
