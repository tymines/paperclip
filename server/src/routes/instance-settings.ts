import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  issueGraphLivenessAutoRecoveryRequestSchema,
  patchInstanceExperimentalSettingsSchema,
  patchInstanceGeneralSettingsSchema,
} from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { heartbeatService, instanceSettingsService, logActivity } from "../services/index.js";
import {
  isProviderKey,
  listRedactedKeys,
  setKey as setProviderApiKey,
} from "../services/provider-api-keys/index.js";
import { getProviderCreditAdapter } from "../services/provider-credits/index.js";
import { assertBoardOrgAccess, getActorInfo } from "./authz.js";
import { badRequest } from "../errors.js";

function assertCanManageInstanceSettings(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

export function instanceSettingsRoutes(db: Db) {
  const router = Router();
  const svc = instanceSettingsService(db);
  const heartbeat = heartbeatService(db);

  router.get("/instance/settings/general", async (req, res) => {
    // General settings (e.g. keyboardShortcuts) are readable by any
    // authenticated org member or instance admin. Only PATCH requires instance-admin.
    assertBoardOrgAccess(req);
    res.json(await svc.getGeneral());
  });

  router.patch(
    "/instance/settings/general",
    validate(patchInstanceGeneralSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const updated = await svc.updateGeneral(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.general_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              general: updated.general,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.general);
    },
  );

  router.get("/instance/settings/experimental", async (req, res) => {
    // Experimental settings are readable by any authenticated org member
    // or instance admin. Only PATCH requires instance-admin.
    assertBoardOrgAccess(req);
    res.json(await svc.getExperimental());
  });

  router.patch(
    "/instance/settings/experimental",
    validate(patchInstanceExperimentalSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const updated = await svc.updateExperimental(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.experimental_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              experimental: updated.experimental,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.experimental);
    },
  );

  router.post(
    "/instance/settings/experimental/issue-graph-liveness-auto-recovery/preview",
    validate(issueGraphLivenessAutoRecoveryRequestSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      res.json(await heartbeat.buildIssueGraphLivenessAutoRecoveryPreview({
        lookbackHours: req.body.lookbackHours,
      }));
    },
  );

  router.post(
    "/instance/settings/experimental/issue-graph-liveness-auto-recovery/run",
    validate(issueGraphLivenessAutoRecoveryRequestSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const actor = getActorInfo(req);
      const result = await heartbeat.reconcileIssueGraphLiveness({
        runId: actor.runId,
        force: true,
        lookbackHours: req.body.lookbackHours,
      });
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.issue_graph_liveness_auto_recovery_run",
            entityType: "instance_settings",
            entityId: "default",
            details: {
              lookbackHours: result.lookbackHours,
              escalationsCreated: result.escalationsCreated,
              existingEscalations: result.existingEscalations,
              skippedOutsideLookback: result.skippedOutsideLookback,
              escalationIssueIds: result.escalationIssueIds,
            },
          }),
        ),
      );
      res.json(result);
    },
  );

  // ── Provider API Keys ─────────────────────────────────────────────────
  // GET → returns a list of providers with last-4 + lastUpdated (no
  //       full secret ever leaves the server).
  router.get("/instance/settings/provider-keys", async (req, res) => {
    assertBoardOrgAccess(req);
    const keys = await listRedactedKeys();
    res.json(keys);
  });

  // PATCH → upsert a single provider's API key (or clear with empty body).
  // Body: { provider: ProviderKey, value: string }
  router.patch("/instance/settings/provider-keys", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const provider = req.body?.provider;
    const value = typeof req.body?.value === "string" ? req.body.value : "";
    if (!isProviderKey(provider)) {
      throw badRequest(`unknown provider: ${String(provider)}`);
    }
    const updated = await setProviderApiKey(provider, value);
    const actor = getActorInfo(req);
    const companyIds = await svc.listCompanyIds();
    await Promise.all(
      companyIds.map((companyId) =>
        logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "instance.provider_api_key_updated",
          entityType: "instance",
          entityId: "default",
          details: { provider, cleared: value.length === 0 },
        }),
      ),
    );
    res.json(updated);
  });

  // POST → test the stored key by attempting a live balance fetch.
  // Returns { ok, balance, currency, error? } so the UI can show
  // green/red feedback inline.
  router.post("/instance/settings/provider-keys/:provider/test", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const provider = req.params.provider;
    if (!isProviderKey(provider)) throw badRequest(`unknown provider: ${provider}`);
    const adapter = getProviderCreditAdapter(provider);
    if (!adapter) throw badRequest(`no adapter registered for ${provider}`);
    if (!adapter.meta.balanceSupported) {
      res.json({
        ok: false,
        balance: null,
        currency: adapter.meta.currency,
        error: `${adapter.meta.name} does not expose balance via API.`,
      });
      return;
    }
    // Pull the stored raw key for the test — avoids needing the caller
    // to repost the value just to verify it.
    const { getRawKey } = await import("../services/provider-api-keys/index.js");
    const apiKey = await getRawKey(provider);
    if (!apiKey) {
      res.json({ ok: false, balance: null, currency: adapter.meta.currency, error: "No key saved yet." });
      return;
    }
    try {
      const snapshot = await adapter.fetchBalance({ apiKey });
      res.json({
        ok: true,
        balance: snapshot.balance,
        currency: snapshot.currency,
      });
    } catch (err) {
      res.json({
        ok: false,
        balance: null,
        currency: adapter.meta.currency,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
