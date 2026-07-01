import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { badRequest } from "../errors.js";
import {
  listRedactedKeys,
  setKey as setProviderApiKey,
} from "../services/provider-api-keys/index.js";
import { verifyReplicateToken } from "../services/replicate/index.js";
import { assertInstanceAdmin } from "./authz.js";

/**
 * Third-party credential setters that don't fit the generic
 * /instance/settings/provider-keys shape (they verify the token against the
 * provider before storing). Today: Replicate.
 *
 * Tokens land in the same provider-api-keys store as the elevenlabs key.
 */
export function credentialRoutes(_db: Db) {
  const router = Router();

  // GET /api/credentials/replicate → redacted status for the UI.
  router.get("/credentials/replicate", async (req, res) => {
    assertInstanceAdmin(req);
    const keys = await listRedactedKeys();
    const entry = keys.find((k) => k.provider === "replicate");
    res.json(entry ?? { provider: "replicate", hasKey: false, last4: null, updatedAt: null });
  });

  // POST /api/credentials/replicate
  // Body: { token: string }
  // Verifies the token against Replicate's account endpoint, then stores it
  // encrypted-at-rest alongside the other provider keys. Pass an empty token
  // to clear the stored credential.
  router.post("/credentials/replicate", async (req, res) => {
    assertInstanceAdmin(req);
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";

    if (token.length === 0) {
      // Treat empty as a clear.
      const cleared = await setProviderApiKey("replicate", "");
      res.json({ ...cleared, verified: false });
      return;
    }

    // Verify before persisting so a bad token never gets stored and silently
    // fails a $3 training run later.
    const verify = await verifyReplicateToken(token);
    if (!verify.ok) {
      throw badRequest(`Replicate token rejected: ${verify.error ?? "verification failed"}`);
    }

    const saved = await setProviderApiKey("replicate", token);
    res.status(201).json({ ...saved, verified: true, username: verify.username ?? null });
  });

  return router;
}
