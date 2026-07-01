import { describe, expect, it } from "vitest";
import { testCredentialFormat } from "../services/social-scheduler/credential-tester.js";

describe("testCredentialFormat", () => {
  it("rejects missing fields", () => {
    expect(testCredentialFormat("instagram", "", "abc")).toMatchObject({ ok: false });
    expect(testCredentialFormat("instagram", "1234567890123456", "")).toMatchObject({
      ok: false,
    });
  });

  it("accepts a well-formed Meta App ID + secret", () => {
    const result = testCredentialFormat(
      "instagram",
      "123456789012345",
      "abcdef0123456789abcdef0123456789",
    );
    expect(result.ok).toBe(true);
  });

  it("rejects malformed Meta App IDs", () => {
    const result = testCredentialFormat(
      "instagram",
      "not-a-number",
      "abcdef0123456789abcdef0123456789",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/format/i);
  });

  it("validates X Client IDs with longer alphanumeric tokens", () => {
    const good = testCredentialFormat(
      "x",
      "QkVKQVdaYTJoNFlsNjYzOGFLLXc",
      "thisisasecretofatleastthirty-charsXX",
    );
    expect(good.ok).toBe(true);
    const bad = testCredentialFormat("x", "short", "thisisasecretofatleastthirty-charsXX");
    expect(bad.ok).toBe(false);
  });

  it("validates Reddit Client IDs", () => {
    const good = testCredentialFormat(
      "reddit",
      "abcdefghijklmno",
      "12345678901234567890abcdef",
    );
    expect(good.ok).toBe(true);
  });

  it("refuses platforms outside the wizard scope", () => {
    const result = testCredentialFormat(
      "linkedin",
      "anything",
      "anything-anything-anything-anything",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not yet supported/i);
  });
});
