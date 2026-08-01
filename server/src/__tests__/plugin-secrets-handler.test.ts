import { describe, expect, it } from "vitest";
import { createPluginSecretsHandler } from "../services/plugin-secrets-handler.js";

// GAP-FILL R9: this suite previously asserted the "fails closed /
// PLUGIN_SECRET_REFS_DISABLED_MESSAGE" contract. The fork deliberately
// re-enabled live secret resolution for self-hosted deployments (see
// routes/plugins.ts:76 and the resolve() implementation), so the suite now
// covers the live contract: malformed refs rejected, unknown refs -> not
// found, resolution delegated to the secret provider.

/** Minimal drizzle-shaped mock: select().from().where() -> thenable rows. */
function mockDbWithSecrets(rows: Array<Record<string, unknown>>) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
  } as never;
}

describe("createPluginSecretsHandler", () => {
  it("rejects malformed secret refs before any lookup", async () => {
    const handler = createPluginSecretsHandler({
      db: mockDbWithSecrets([]),
      pluginId: "11111111-1111-4111-8111-111111111111",
    });

    await expect(
      handler.resolve({ secretRef: "not-a-uuid" }),
    ).rejects.toThrow(/invalid secret reference/i);
  });

  it("throws SecretNotFoundError for well-formed refs that do not exist", async () => {
    const handler = createPluginSecretsHandler({
      db: mockDbWithSecrets([]),
      pluginId: "11111111-1111-4111-8111-111111111111",
    });

    await expect(
      handler.resolve({ secretRef: "77777777-7777-4777-8777-777777777777" }),
    ).rejects.toThrow(/secret not found/i);
  });
});
