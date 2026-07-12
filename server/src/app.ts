import { createAcpRouter } from "./acp/acp-router.js";
import express, { Router, type Request as ExpressRequest } from "express";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Db } from "@paperclipai/db";
import type { DeploymentExposure, DeploymentMode } from "@paperclipai/shared";
import type { StorageService } from "./storage/types.js";
import { httpLogger, errorHandler } from "./middleware/index.js";
import { actorMiddleware } from "./middleware/auth.js";
import { boardMutationGuard } from "./middleware/board-mutation-guard.js";
import { privateHostnameGuard, resolvePrivateHostnameAllowSet } from "./middleware/private-hostname-guard.js";
import { healthRoutes } from "./routes/health.js";
import { companyRoutes } from "./routes/companies.js";
import { companySkillRoutes } from "./routes/company-skills.js";
import { agentRoutes } from "./routes/agents.js";
import { projectRoutes } from "./routes/projects.js";
import { issueRoutes } from "./routes/issues.js";
import { issueTreeControlRoutes } from "./routes/issue-tree-control.js";
import { routineRoutes } from "./routes/routines.js";
import { environmentRoutes } from "./routes/environments.js";
import { executionWorkspaceRoutes } from "./routes/execution-workspaces.js";
import { goalRoutes } from "./routes/goals.js";
import { knowledgeGraphRoutes } from "./routes/knowledge-graph.js";
import { fleetKbRoutes } from "./routes/fleet-kb.js";
import { roomRoutes } from "./routes/rooms.js";
import { gateRoutes } from "./routes/gate.js";
import { gymObservabilityRoutes } from "./routes/gym-observability.js";
import { agentBridgeRoutes } from "./routes/agent-bridge.js";
import { socialRoutes } from "./routes/social.js";
import type { SocialScheduler } from "./workers/social-scheduler.js";
import type { SocialDmPoller } from "./workers/social-dm-poller.js";
import { approvalRoutes } from "./routes/approvals.js";
import { secretRoutes } from "./routes/secrets.js";
import { costRoutes } from "./routes/costs.js";
import { activityRoutes } from "./routes/activity.js";
import { mlflowRoutes } from "./routes/mlflow.js";
import { jarvisRoutes } from "./routes/jarvis.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { appDevRoutes } from "./routes/app-dev.js";
import { appdevControlRoutes } from "./routes/appdev-control.js";
import { promptsRoutes } from "./routes/prompts.js";
import { bookWritingRoutes } from "./routes/book-writing.js";
import { bookStudioRoutes } from "./routes/book-studio.js";
import { storyBibleGenerateRoutes } from "./routes/story-bible-generate.js";
import { bookStudioExportRoutes } from "./routes/book-studio-export.js";
import { bookStudioChapterGenRoutes } from "./routes/book-studio-chapter-gen.js";
import { bookStudioAutopilotRoutes } from "./routes/book-studio-autopilot.js";
import { bookStudioImageGenerateRoutes } from "./routes/book-studio-image-generate.js";
// Company import/export payloads can inline full portable packages.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { createServer: createViteServer } = await import("vite");
import { gymRoutes } from "./routes/gym.js";
import { creativeStudioRoutes } from "./routes/creative-studio.js";
import { bookMediaRoutes } from "./routes/book-media.js";
import { creativeStudioToolsRoutes } from "./routes/creative-studio-tools.js";
import { adStudioRoutes } from "./routes/ad-studio.js";
import { storyBibleRoutes } from "./routes/story-bible.js";
import { influencerStudioRoutes } from "./routes/influencer-studio.js";
import { userProfileRoutes } from "./routes/user-profiles.js";
import { sidebarBadgeRoutes } from "./routes/sidebar-badges.js";
import { sidebarPreferenceRoutes } from "./routes/sidebar-preferences.js";
import { inboxDismissalRoutes } from "./routes/inbox-dismissals.js";
import { instanceSettingsRoutes } from "./routes/instance-settings.js";
import {
  webhookReceiverRoutes,
  elevenlabsWebhookSecretRoutes,
} from "./routes/webhooks.js";
import { worldviewProxyRoutes } from "./routes/worldview.js";
import {
  instanceDatabaseBackupRoutes,
  type InstanceDatabaseBackupService,
} from "./routes/instance-database-backups.js";
import { llmRoutes } from "./routes/llms.js";
import { authRoutes } from "./routes/auth.js";
import { assetRoutes } from "./routes/assets.js";
import { issueService } from "./services/index.js";
import { bulkUploadRoutes } from "./routes/bulk-upload.js";
import { accessRoutes } from "./routes/access.js";
import { pluginRoutes } from "./routes/plugins.js";
import { adapterRoutes } from "./routes/adapters.js";
import { pluginUiStaticRoutes } from "./routes/plugin-ui-static.js";
import { designRoutes } from "./routes/design.js";
import { designAssetsRoutes } from "./routes/design-assets.js";
import { imageStudioRoutes } from "./routes/image-studio.js";
import { uploadsRoot } from "./services/image-studio/uploads.js";
import { credentialRoutes } from "./routes/credentials.js";
import { applyUiBranding } from "./ui-branding.js";
import { logger } from "./middleware/logger.js";
import { DEFAULT_LOCAL_PLUGIN_DIR, pluginLoader } from "./services/plugin-loader.js";
import { createPluginWorkerManager, type PluginWorkerManager } from "./services/plugin-worker-manager.js";
import { createPluginJobScheduler } from "./services/plugin-job-scheduler.js";
import { pluginJobStore } from "./services/plugin-job-store.js";
import { createPluginToolDispatcher } from "./services/plugin-tool-dispatcher.js";
import { pluginLifecycleManager } from "./services/plugin-lifecycle.js";
import { createPluginJobCoordinator } from "./services/plugin-job-coordinator.js";
import { buildHostServices, flushPluginLogBuffer } from "./services/plugin-host-services.js";
import { createPluginEventBus } from "./services/plugin-event-bus.js";
import { setPluginEventBus } from "./services/activity-log.js";
import { createPluginDevWatcher } from "./services/plugin-dev-watcher.js";
import { createPluginHostServiceCleanup } from "./services/plugin-host-service-cleanup.js";
import { pluginRegistryService } from "./services/plugin-registry.js";
import { createHostClientHandlers } from "@paperclipai/plugin-sdk";
import type { BetterAuthSessionResult } from "./auth/better-auth.js";
import { createCachedViteHtmlRenderer } from "./vite-html-renderer.js";

type UiMode = "none" | "static" | "vite-dev";
const FEEDBACK_EXPORT_FLUSH_INTERVAL_MS = 5_000;
const VITE_DEV_ASSET_PREFIXES = [
  "/@fs/",
  "/@id/",
  "/@react-refresh",
  "/@vite/",
  "/assets/",
  "/node_modules/",
  "/src/",
];
const VITE_DEV_STATIC_PATHS = new Set([
  "/apple-touch-icon.png",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/favicon.ico",
  "/favicon.svg",
  "/site.webmanifest",
  "/sw.js",
]);

export function resolveViteHmrPort(serverPort: number): number {
  if (serverPort <= 55_535) {
    return serverPort + 10_000;
  }
  return Math.max(1_024, serverPort - 10_000);
}

export function shouldServeViteDevHtml(req: ExpressRequest): boolean {
  const pathname = req.path;
  if (VITE_DEV_STATIC_PATHS.has(pathname)) return false;
  if (VITE_DEV_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  return req.accepts(["html"]) === "html";
}

export function shouldEnablePrivateHostnameGuard(opts: {
  deploymentMode: DeploymentMode;
  deploymentExposure: DeploymentExposure;
}): boolean {
  return (
    opts.deploymentExposure === "private" &&
    (opts.deploymentMode === "local_trusted" || opts.deploymentMode === "authenticated")
  );
}

export async function createApp(
  db: Db,
  opts: {
    uiMode: UiMode;
    serverPort: number;
    storageService: StorageService;
    feedbackExportService?: {
      flushPendingFeedbackTraces(input?: {
        companyId?: string;
        traceId?: string;
        limit?: number;
        now?: Date;
      }): Promise<unknown>;
    };
    databaseBackupService?: InstanceDatabaseBackupService;
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    allowedHostnames: string[];
    bindHost: string;
    authReady: boolean;
    companyDeletionEnabled: boolean;
    instanceId?: string;
    hostVersion?: string;
    localPluginDir?: string;
    pluginMigrationDb?: Db;
    pluginWorkerManager?: PluginWorkerManager;
    socialScheduler?: SocialScheduler;
    socialDmPoller?: SocialDmPoller;
    betterAuthHandler?: express.RequestHandler;
    resolveSession?: (req: ExpressRequest) => Promise<BetterAuthSessionResult | null>;
  },
) {
  const app = express();

  app.use(express.json({
    // Company import/export payloads can inline full portable packages.
    limit: "10mb",
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody: Buffer }).rawBody = buf;
    },
  }));
  app.use(httpLogger);
  const privateHostnameGateEnabled = shouldEnablePrivateHostnameGuard({
    deploymentMode: opts.deploymentMode,
    deploymentExposure: opts.deploymentExposure,
  });
  const privateHostnameAllowSet = resolvePrivateHostnameAllowSet({
    allowedHostnames: opts.allowedHostnames,
    bindHost: opts.bindHost,
  });
  app.use(
    privateHostnameGuard({
      enabled: privateHostnameGateEnabled,
      allowedHostnames: opts.allowedHostnames,
      bindHost: opts.bindHost,
    }),
  );
  app.use(
    actorMiddleware(db, {
      deploymentMode: opts.deploymentMode,
      resolveSession: opts.resolveSession,
    }),
  );
  // Public webhook receivers are mounted OUTSIDE the `/api` router so
  // they skip the board-mutation guard — third-party services have no
  // Paperclip session/key to present. Auth comes from HMAC verification
  // inside the handler.
  app.use("/api/webhooks", webhookReceiverRoutes(db));
  // World View tab feed proxy (additive, read-only): browsers on the public
  // origin cannot reach the tailnet collector directly, so the server fetches
  // it over Tailscale and returns JSON same-origin. Mounted OUTSIDE the guarded
  // `/api` router so the passthrough needs no session/board handshake.
  app.use(worldviewProxyRoutes());
  app.use("/api/auth", authRoutes(db));
  if (opts.betterAuthHandler) {
    app.all("/api/auth/{*authPath}", opts.betterAuthHandler);
  }
  app.use(llmRoutes(db));

  const hostServicesDisposers = new Map<string, () => void>();
  const workerManager = opts.pluginWorkerManager ?? createPluginWorkerManager();

  // Mount API routes
  const api = Router();
  api.use(boardMutationGuard());
  api.use(
    "/health",
    healthRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      authReady: opts.authReady,
      companyDeletionEnabled: opts.companyDeletionEnabled,
    }),
  );
  api.use("/companies", companyRoutes(db, opts.storageService));
  api.use(companySkillRoutes(db));
  api.use(agentRoutes(db, { pluginWorkerManager: workerManager }));
  api.use(assetRoutes(db, opts.storageService));
  api.use(projectRoutes(db));
  api.use(issueRoutes(db, opts.storageService, {
    feedbackExportService: opts.feedbackExportService,
    pluginWorkerManager: workerManager,
  }));
  api.use(issueTreeControlRoutes(db));
  api.use(routineRoutes(db, { pluginWorkerManager: workerManager }));
  api.use(environmentRoutes(db, { pluginWorkerManager: workerManager }));
  api.use(executionWorkspaceRoutes(db));
  api.use(goalRoutes(db));
  api.use(approvalRoutes(db, { pluginWorkerManager: workerManager }));
  api.use(secretRoutes(db));
  api.use(costRoutes(db, { pluginWorkerManager: workerManager }));
  api.use(activityRoutes(db));
  api.use(mlflowRoutes());
  api.use(jarvisRoutes(db));
  api.use(dashboardRoutes(db));
  api.use(appDevRoutes(db));
  api.use(appdevControlRoutes(db));
  api.use(promptsRoutes(db));
  api.use(gymRoutes(db));
  api.use(creativeStudioRoutes(db));
  api.use(bookMediaRoutes(db));
  api.use(creativeStudioToolsRoutes(db));
  api.use(adStudioRoutes(db));
  api.use(knowledgeGraphRoutes(db));
  api.use(fleetKbRoutes());
  api.use(roomRoutes(db));
  api.use(gateRoutes(db));
  api.use(gymObservabilityRoutes(db));
  api.use(agentBridgeRoutes(db));
  api.use(socialRoutes(db, { scheduler: opts.socialScheduler, dmPoller: opts.socialDmPoller }));
  api.use(bulkUploadRoutes(db, opts.storageService));
  api.use(designRoutes(db));
  api.use(designAssetsRoutes(db));
  api.use(imageStudioRoutes(db, opts.storageService));
  api.use(credentialRoutes(db));
  api.use(userProfileRoutes(db));
  api.use(sidebarBadgeRoutes(db));
  api.use(sidebarPreferenceRoutes(db));
  api.use(inboxDismissalRoutes(db));
  api.use(instanceSettingsRoutes(db));
  api.use(elevenlabsWebhookSecretRoutes(db));
  api.use(bookWritingRoutes(db));
  api.use(bookStudioRoutes(db));
  api.use(storyBibleGenerateRoutes(db));
  api.use(bookStudioExportRoutes(db));
  api.use(bookStudioChapterGenRoutes(db));
  api.use(bookStudioAutopilotRoutes(db));
  api.use(bookStudioImageGenerateRoutes(db));
  // (dup gym mounts removed 2026-07-12 Fable — merge cruft; mounted above)
  api.use(storyBibleRoutes(db));
  api.use(influencerStudioRoutes(db, {}));
  if (opts.databaseBackupService) {
    api.use(instanceDatabaseBackupRoutes(opts.databaseBackupService));
  }
  const pluginRegistry = pluginRegistryService(db);
  const eventBus = createPluginEventBus();
  setPluginEventBus(eventBus);
  const jobStore = pluginJobStore(db);
  const lifecycle = pluginLifecycleManager(db, { workerManager });
  const scheduler = createPluginJobScheduler({
    db,
    jobStore,
    workerManager,
  });
  const toolDispatcher = createPluginToolDispatcher({
    workerManager,
    lifecycleManager: lifecycle,
    db,
  });
  const jobCoordinator = createPluginJobCoordinator({
    db,
    lifecycle,
    scheduler,
    jobStore,
  });
  const hostServiceCleanup = createPluginHostServiceCleanup(lifecycle, hostServicesDisposers);
  let viteHtmlRenderer: ReturnType<typeof createCachedViteHtmlRenderer> | null = null;
  const loader = pluginLoader(
    db,
    {
      localPluginDir: opts.localPluginDir ?? DEFAULT_LOCAL_PLUGIN_DIR,
      migrationDb: opts.pluginMigrationDb,
    },
    {
      workerManager,
      eventBus,
      jobScheduler: scheduler,
      jobStore,
      toolDispatcher,
      lifecycleManager: lifecycle,
      instanceInfo: {
        instanceId: opts.instanceId ?? "default",
        hostVersion: opts.hostVersion ?? "0.0.0",
        deploymentMode: opts.deploymentMode,
        deploymentExposure: opts.deploymentExposure,
      },
      buildHostHandlers: (pluginId, manifest) => {
        const notifyWorker = (method: string, params: unknown) => {
          const handle = workerManager.getWorker(pluginId);
          if (handle) handle.notify(method, params);
        };
        const services = buildHostServices(db, pluginId, manifest.id, eventBus, notifyWorker, {
          pluginWorkerManager: workerManager,
          manifest,
        });
        hostServicesDisposers.set(pluginId, () => services.dispose());
        return createHostClientHandlers({
          pluginId,
          capabilities: manifest.capabilities,
          services,
        });
      },
    },
  );
  api.use(
    pluginRoutes(
      db,
      loader,
      { scheduler, jobStore },
      { workerManager },
      { toolDispatcher },
      { workerManager },
    ),
  );
  api.use(adapterRoutes());
  api.use(
    accessRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      bindHost: opts.bindHost,
      allowedHostnames: opts.allowedHostnames,
    }),
  );
  // User-uploaded media (Image Studio persona gallery, etc.) is served
  // read-only from the instance uploads dir. Mounted ahead of the guarded
  // `/api` router so plain <img> GETs need no session/origin handshake.
  app.use(
    "/api/project-shots",
    express.static(process.env.HOME + "/.openclaw/project-shots", { index: false, maxAge: "30s", fallthrough: false }),
  );
  app.use(
    "/api/uploads",
    express.static(uploadsRoot(), {
      index: false,
      maxAge: "1h",
      fallthrough: false,
    }),
  );
  // ── Public app-feedback intake (Baily's App "Request a Feature") ──────────
  // Mounted ahead of the guarded /api router so the app can POST off-Tailnet
  // with no session. Defense-in-depth: single-purpose token (a speed bump, NOT
  // a secret — it ships in the IPA), a GENEROUS anti-flood guard (not a usage
  // cap), and create-issue-only scope. Worst case if the token leaks = spam issues.
  {
    const FEEDBACK_TOKEN = process.env.APP_FEEDBACK_TOKEN || "baily-feedback-7c4f2a9e";
    const FEEDBACK_COMPANY = process.env.APP_FEEDBACK_COMPANY || "414c172d-7013-4728-b781-aad604d8e2d7";
    const hits = new Map<string, number[]>();
    app.post("/api/app-feedback", async (req: any, res: any) => {
      const token = (req.headers["x-app-token"] as string) || req.body?.token;
      if (token !== FEEDBACK_TOKEN) { res.status(401).json({ error: "unauthorized" }); return; }
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "anon";
      const now = Date.now();
      const log = (hits.get(ip) || []).filter((t) => now - t < 60_000);
      if (log.length >= 120) { res.status(429).json({ error: "easy there - try again in a moment" }); return; }
      log.push(now); hits.set(ip, log);
      const kind = String(req.body?.kind || "feature").toLowerCase() === "bug" ? "bug" : "feature";
      const title = String(req.body?.title || "").trim().slice(0, 200);
      const bodyText = String(req.body?.body || "").trim().slice(0, 4000);
      const appName = String(req.body?.app || "bailysapp").slice(0, 40);
      const appVersion = String(req.body?.appVersion || "?").slice(0, 24);
      const device = String(req.body?.device || "").slice(0, 80);
      if (!title) { res.status(400).json({ error: "title is required" }); return; }

      // \u2500\u2500 Optional photo attachments \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      // Baily can attach screenshots/photos to her feedback. They arrive as
      // base64 strings (optionally a `data:image/...;base64,` data-URL) in an
      // `images` array. We persist them to the SAME read-only uploads store the
      // Image Studio uses (served at /api/uploads/<rel>), under feedback/<id>/,
      // and record the relative paths as an `[attachments] \u2026` marker line on
      // the issue description. Mission Control parses that marker and renders
      // the photos on the feedback item \u2014 no DB-schema change, no new bucket.
      const MAX_IMAGES = 4;
      const MAX_BYTES_PER_IMAGE = 4 * 1024 * 1024; // 4 MB decoded ceiling/image
      const rawImages: unknown[] = Array.isArray(req.body?.images) ? req.body.images : [];
      const attachId = randomUUID();
      const savedRelPaths: string[] = [];
      for (const entry of rawImages.slice(0, MAX_IMAGES)) {
        if (typeof entry !== "string" || !entry) continue;
        const comma = entry.indexOf(",");
        const b64 = entry.startsWith("data:") && comma >= 0 ? entry.slice(comma + 1) : entry;
        let buf: Buffer;
        try { buf = Buffer.from(b64, "base64"); } catch { continue; }
        if (buf.length === 0 || buf.length > MAX_BYTES_PER_IMAGE) continue;
        const rel = `feedback/${attachId}/${savedRelPaths.length}.jpg`;
        const abs = path.resolve(uploadsRoot(), rel);
        try {
          await fs.promises.mkdir(path.dirname(abs), { recursive: true });
          await fs.promises.writeFile(abs, buf);
          savedRelPaths.push(rel);
        } catch (e) {
          logger.error({ err: e }, "Failed to persist feedback attachment");
        }
      }
      const attachmentsLine = savedRelPaths.length
        ? `\n[attachments] ${savedRelPaths.join(" | ")}`
        : "";

      try {
        const svc = issueService(db);
        const issue: any = await svc.create(FEEDBACK_COMPANY, {
          title: `[Baily \u2022 ${kind}] ${title}`,
          description: `${bodyText}\n\n- ${appName} v${appVersion}${device ? " - " + device : ""} - via in-app feedback${attachmentsLine}`,
          status: "todo",
          priority: kind === "bug" ? "high" : "medium",
          // Structured, additive provenance so Mission Control can reliably
          // identify these as app feedback and GROUP them by app — instead of
          // sniffing the title prefix. The /companies/:id/issues list endpoint
          // already supports ?originKind= & ?originId= filters, and returns
          // these fields on each issue. Legacy feedback issues (created before
          // this) lack them; MC also recognizes the `[Baily \u2022 …]` /
          // `via in-app feedback` markers as a fallback, so nothing is missed.
          originKind: "app-feedback",
          originId: appName,
          originFingerprint: appVersion || "default",
          createdByAgentId: null,
          createdByUserId: null,
        } as any);
        res.json({ ok: true, issueId: issue?.id ?? null, attachments: savedRelPaths });
      } catch (e: any) {
        res.status(500).json({ error: "could not record feedback", detail: String(e?.message || e).slice(0, 200) });
      }
    });
  }

  // ACP Phase 1 (additive, read-only): mount the capabilities router so the
  // always-on Fleet ACP panel can reach /acp/fleet + /acp/handshake. Runs
  // alongside the existing Hermes<->Ares bridge (no cutover); routes are inert
  // (return a handshake error) unless a gateway url is supplied, so default
  // behaviour and the bridge are unaffected. (Was POC-gated behind
  // PAPERCLIP_ACP_POC=1, which left the shipped Phase-1 panel 404ing.)
  app.use("/api", createAcpRouter(db));
  app.use("/api", api);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });
  app.use(pluginUiStaticRoutes(db, {
    localPluginDir: opts.localPluginDir ?? DEFAULT_LOCAL_PLUGIN_DIR,
  }));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  if (opts.uiMode === "static") {
    // Try published location first (server/ui-dist/), then monorepo dev location (../../ui/dist)
    const candidates = [
      path.resolve(__dirname, "../ui-dist"),
      path.resolve(__dirname, "../../ui/dist"),
    ];
    const uiDist = candidates.find((p) => fs.existsSync(path.join(p, "index.html")));
    if (uiDist) {
      const indexHtml = applyUiBranding(fs.readFileSync(path.join(uiDist, "index.html"), "utf-8"));
      // Hashed asset files (Vite emits them under /assets/<name>.<hash>.<ext>)
      // never change once built, so they can be cached aggressively.
      app.use(
        "/assets",
        express.static(path.join(uiDist, "assets"), {
          maxAge: "1y",
          immutable: true,
        }),
      );
      // Non-hashed static files (favicon.ico, manifest, robots.txt, etc.):
      // short cache so operators who swap them out see the new version
      // reasonably fast. Override for `index.html` specifically — it is
      // served by this middleware for `/` and `/index.html`, and it must
      // never outlive the asset hashes it points at.
      app.use(
        express.static(uiDist, {
          maxAge: "1h",
          setHeaders(res, filePath) {
            const name = path.basename(filePath);
            // index.html must never outlive the asset hashes it points at, and
            // sw.js must always be revalidated so a browser holding a stale (or
            // broken) service worker detects the updated /sw.js on next load.
            if (name === "index.html" || name === "sw.js") {
              res.set("Cache-Control", "no-cache");
            }
          },
        }),
      );
      // SPA fallback. Only for non-asset routes — if the browser asks for
      // /assets/something.js that doesn't exist, we must NOT serve the HTML
      // shell: the browser would try to load it as a JavaScript module, fail
      // with a MIME-type error, and cache that broken response. Return 404
      // instead. The index.html response itself is no-cache so a subsequent
      // deploy's updated asset hashes are picked up on next load.
      app.get(/.*/, (req, res) => {
        if (req.path.startsWith("/assets/")) {
          res.status(404).end();
          return;
        }
        res
          .status(200)
          .set("Content-Type", "text/html")
          .set("Cache-Control", "no-cache")
          .end(indexHtml);
      });
    } else {
      console.warn("[paperclip] UI dist not found; running in API-only mode");
    }
  }

  if (opts.uiMode === "vite-dev") {
    const uiRoot = path.resolve(__dirname, "../../ui");
    const publicUiRoot = path.resolve(uiRoot, "public");
    const hmrPort = resolveViteHmrPort(opts.serverPort);
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: uiRoot,
      appType: "custom",
      server: {
        middlewareMode: true,
        hmr: {
          host: "127.0.0.1",
          port: hmrPort,
          clientPort: hmrPort,
        },
        allowedHosts: privateHostnameGateEnabled ? Array.from(privateHostnameAllowSet) : undefined,
      },
    });
    viteHtmlRenderer = createCachedViteHtmlRenderer({
      vite,
      uiRoot,
      brandHtml: applyUiBranding,
    });
    const renderViteHtml = viteHtmlRenderer;

    if (fs.existsSync(publicUiRoot)) {
      app.use(express.static(publicUiRoot, { index: false }));
    }
    app.get(/.*/, async (req, res, next) => {
      if (!shouldServeViteDevHtml(req)) {
        next();
        return;
      }
      try {
        const html = await renderViteHtml.render(req.originalUrl);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (err) {
        next(err);
      }
    });
    app.use(vite.middlewares);
  }

  app.use(errorHandler);

  jobCoordinator.start();
  scheduler.start();
  const feedbackExportTimer = opts.feedbackExportService
    ? setInterval(() => {
      void opts.feedbackExportService?.flushPendingFeedbackTraces().catch((err) => {
        logger.error({ err }, "Failed to flush pending feedback exports");
      });
    }, FEEDBACK_EXPORT_FLUSH_INTERVAL_MS)
    : null;
  feedbackExportTimer?.unref?.();
  if (opts.feedbackExportService) {
    void opts.feedbackExportService.flushPendingFeedbackTraces().catch((err) => {
      logger.error({ err }, "Failed to flush pending feedback exports");
    });
  }
  void toolDispatcher.initialize().catch((err) => {
    logger.error({ err }, "Failed to initialize plugin tool dispatcher");
  });
  const devWatcher = createPluginDevWatcher(
    lifecycle,
    async (pluginId) => (await pluginRegistry.getById(pluginId))?.packagePath ?? null,
  );
  void loader.loadAll().then((result) => {
    if (!result) return;
    for (const loaded of result.results) {
      if (devWatcher && loaded.success && loaded.plugin.packagePath) {
        devWatcher.watch(loaded.plugin.id, loaded.plugin.packagePath);
      }
    }
  }).catch((err) => {
    logger.error({ err }, "Failed to load ready plugins on startup");
  });
  process.once("exit", () => {
    if (feedbackExportTimer) clearInterval(feedbackExportTimer);
    devWatcher?.close();
    viteHtmlRenderer?.dispose();
    hostServiceCleanup.disposeAll();
    hostServiceCleanup.teardown();
  });
  process.once("beforeExit", () => {
    void flushPluginLogBuffer();
  });

  return app;
}
