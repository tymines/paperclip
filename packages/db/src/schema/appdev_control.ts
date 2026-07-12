/**
 * appdev_* — App Dev Control Center data model (Build Spec v1.1 CANONICAL, Part 2).
 *
 * Distinct from ./app_dev.js (the legacy feedback-origin registry that powers the
 * old /app-dev page). These tables are the phase-gate pipeline objects: apps as
 * pipeline objects, gates as records, work orders, reference packs, proof
 * bundles, visual reviews, screens/baselines, releases, skills, retros.
 *
 * MIGRATION GATING: the matching migration (0146_appdev_control_center.sql) is
 * written but NOT registered in the drizzle journal and NOT applied — same
 * holding pattern as Gym's 0145 (journal reconciliation + MIGRATION_PROMPT=never,
 * pending Tyler's go). Server routes that touch these tables catch
 * undefined-table errors and report { migrationPending: true } so the UI can
 * render amber "migration pending" states instead of crashing.
 *
 * Enums are text columns (matches app_dev.ts house style; avoids pg enum
 * migration churn). Canonical value sets live in the gatekeeper service.
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** 2.1 appdev_apps — every app as a pipeline object. */
export const appdevApps = pgTable(
  "appdev_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    iconAssetId: uuid("icon_asset_id"),
    /** idea | spec | design | build | qc | tyler_gate | implement | verify | retro | live */
    phase: text("phase").notNull().default("idea"),
    /** active | paused | killed | archived */
    status: text("status").notNull().default("active"),
    bundleId: text("bundle_id"),
    /** ios | web | other */
    platform: text("platform").notNull().default("web"),
    repoUrl: text("repo_url"),
    sentryProject: text("sentry_project"),
    posthogProject: text("posthog_project"),
    ascAppId: text("asc_app_id"),
    spendCapUsdMonth: numeric("spend_cap_usd_month"),
    /** Link back to the legacy app_dev_apps registry row, if this app was folded in. */
    legacyRegistryId: uuid("legacy_registry_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex("appdev_apps_company_slug_unique").on(t.companyId, t.slug),
    companyIdx: index("appdev_apps_company_idx").on(t.companyId),
    phaseIdx: index("appdev_apps_phase_idx").on(t.companyId, t.phase),
  }),
);

/** 2.2 appdev_gates — one row per gate passage ATTEMPT. Full audit trail. */
export const appdevGates = pgTable(
  "appdev_gates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    /** idea_to_spec | spec_to_design | design_to_build | build_to_qc | qc_to_tyler | tyler_to_implement | implement_to_verify | verify_to_retro | retro_to_live */
    gate: text("gate").notNull(),
    /** pending | passed | failed | changes_requested */
    verdict: text("verdict").notNull().default("pending"),
    /** agent name or 'tyler' */
    reviewer: text("reviewer").notNull(),
    /** { proof_bundle_ids, visual_review_ids, plan_ids, links, override_reason? } */
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    comments: text("comments"),
    decidedAt: ts("decided_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    appIdx: index("appdev_gates_app_idx").on(t.appId, t.createdAt),
    pendingIdx: index("appdev_gates_verdict_idx").on(t.companyId, t.verdict),
  }),
);

/** 2.3 appdev_work_orders. */
export const appdevWorkOrders = pgTable(
  "appdev_work_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    /** e.g. HH-WO-12 */
    code: text("code").notNull(),
    /** feature | bug | asset_gen | refactor | chore | spec | design */
    type: text("type").notNull(),
    /** design | code | review | utility */
    lane: text("lane").notNull(),
    objective: text("objective").notNull(),
    /** array of { criterion_id, text, kind?: 'visual', reference_pack_id? } */
    acceptanceCriteria: jsonb("acceptance_criteria").$type<Array<Record<string, unknown>>>(),
    referencePackId: uuid("reference_pack_id"),
    touchesUi: boolean("touches_ui").notNull().default(false),
    /** s | m | l — m and l require a plan artifact */
    sizeClass: text("size_class").notNull().default("s"),
    /** { steps[], confidence, risks[], critique_verdict } */
    plan: jsonb("plan").$type<Record<string, unknown>>(),
    /** not_required | pending | critiqued | approved | escalated */
    planStatus: text("plan_status").notNull().default("not_required"),
    branchPointSha: text("branch_point_sha"),
    proofRequirements: jsonb("proof_requirements").$type<string[]>(),
    /** draft | queued | planning | in_progress | awaiting_review | changes_requested | done | killed */
    status: text("status").notNull().default("draft"),
    assignedAgent: text("assigned_agent"),
    sourceFeedbackId: uuid("source_feedback_id"),
    costUsd: numeric("cost_usd").notNull().default("0"),
    maxSteps: integer("max_steps"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: uniqueIndex("appdev_wo_company_code_unique").on(t.companyId, t.code),
    appIdx: index("appdev_wo_app_idx").on(t.appId, t.status),
  }),
);

/** 2.4 appdev_reference_packs — immutable once attached (new versions = new rows). */
export const appdevReferencePacks = pgTable(
  "appdev_reference_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    name: text("name").notNull(),
    supersedesId: uuid("supersedes_id"),
    /** array of { asset_id, kind: concept_art|competitor_screenshot|clickable_mock|style_tokens|flow_diagram, screen_tag, notes } */
    items: jsonb("items").$type<Array<Record<string, unknown>>>(),
    /** { palette: string[], type_scale, corner_radii, spacing_scale, mood_keywords } */
    styleTokens: jsonb("style_tokens").$type<Record<string, unknown>>(),
    approvedBy: text("approved_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ appIdx: index("appdev_refpacks_app_idx").on(t.appId) }),
);

/** 2.5 appdev_assets. */
export const appdevAssets = pgTable(
  "appdev_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    kind: text("kind").notNull(),
    storagePath: text("storage_path").notNull(),
    mime: text("mime"),
    sha256: text("sha256"),
    /** upload | fal_ai | chat_pin | screenshot | mock_render */
    source: text("source").notNull().default("upload"),
    chatMessageId: uuid("chat_message_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ appIdx: index("appdev_assets_app_idx").on(t.appId) }),
);

/** 2.6 appdev_proof_bundles — verbatim payloads, never summarized. */
export const appdevProofBundles = pgTable(
  "appdev_proof_bundles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    workOrderId: uuid("work_order_id").references(() => appdevWorkOrders.id),
    /** build | test | deploy | screenshot_set | release | misc */
    kind: text("kind").notNull(),
    /** raw terminal output, git log, file listing — verbatim text blobs */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    screenshotAssetIds: jsonb("screenshot_asset_ids").$type<string[]>(),
    /** code lane's own pre-submission comparison vs the reference pack */
    selfCheck: jsonb("self_check").$type<Record<string, unknown>>(),
    submittedBy: text("submitted_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ woIdx: index("appdev_proof_wo_idx").on(t.workOrderId) }),
);

/** 2.7 appdev_visual_reviews — VFG-2 VLM verdicts (Part 4.4). */
export const appdevVisualReviews = pgTable(
  "appdev_visual_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    workOrderId: uuid("work_order_id").references(() => appdevWorkOrders.id),
    proofBundleId: uuid("proof_bundle_id").references(() => appdevProofBundles.id),
    referencePackId: uuid("reference_pack_id").references(() => appdevReferencePacks.id),
    reviewerLane: text("reviewer_lane").notNull(),
    reviewerModel: text("reviewer_model"),
    /** per screen_tag: { layout_fidelity, palette_match, asset_quality, typography, spacing_polish, overall, notes } */
    rubricScores: jsonb("rubric_scores").$type<Record<string, Record<string, unknown>>>(),
    /** pass | fail | borderline */
    verdict: text("verdict").notNull(),
    worstScreen: text("worst_screen"),
    summary: text("summary"),
    /** full request/response JSON for audit (proof, not summary) */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ woIdx: index("appdev_vreview_wo_idx").on(t.workOrderId) }),
);

/** 2.8 appdev_feedback_items. */
export const appdevFeedbackItems = pgTable(
  "appdev_feedback_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    /** testflight | sentry | appstore_review | in_app | manual */
    source: text("source").notNull(),
    externalId: text("external_id"),
    /** p0 | p1 | p2 | p3 */
    severity: text("severity").notNull().default("p2"),
    title: text("title").notNull(),
    body: text("body"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    /** new | auto_drafted | triaged | converted | dismissed */
    status: text("status").notNull().default("new"),
    convertedWorkOrderId: uuid("converted_work_order_id"),
    clusterKey: text("cluster_key"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    appIdx: index("appdev_feedback_app_idx").on(t.appId, t.status),
    dedupIdx: uniqueIndex("appdev_feedback_dedup_unique").on(t.appId, t.source, t.externalId),
  }),
);

/** 2.9 appdev_chat_threads / appdev_chat_messages — persistent designer chat. */
export const appdevChatThreads = pgTable(
  "appdev_chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    title: text("title").notNull(),
    forkedFromMessageId: uuid("forked_from_message_id"),
    lane: text("lane").notNull().default("design"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ appIdx: index("appdev_chat_threads_app_idx").on(t.appId) }),
);

export const appdevChatMessages = pgTable(
  "appdev_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id").notNull().references(() => appdevChatThreads.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    attachments: jsonb("attachments").$type<Array<Record<string, unknown>>>(),
    pinned: boolean("pinned").notNull().default(false),
    /** spec | reference_pack | work_order | skill */
    promotedTo: text("promoted_to"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ threadIdx: index("appdev_chat_msgs_thread_idx").on(t.threadId, t.createdAt) }),
);

/** 2.10 appdev_screens — canonical screen inventory for harness/VFG/baselines. */
export const appdevScreens = pgTable(
  "appdev_screens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    screenTag: text("screen_tag").notNull(),
    description: text("description"),
    launchRoute: text("launch_route"),
    baselineAssetId: uuid("baseline_asset_id"),
    /** strict | layout | content */
    comparisonMode: text("comparison_mode").notNull().default("strict"),
    /** array of { rect: {x,y,w,h}, kind: ignore|floating, note } */
    regions: jsonb("regions").$type<Array<Record<string, unknown>>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    tagUnique: uniqueIndex("appdev_screens_app_tag_unique").on(t.appId, t.screenTag),
  }),
);

/** 2.11 appdev_sessions — live agent work sessions. DORMANT until a real agent
 * runtime emits session streams; schema lands now so dispatch plugs in later. */
export const appdevSessions = pgTable(
  "appdev_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    workOrderId: uuid("work_order_id").references(() => appdevWorkOrders.id),
    agent: text("agent").notNull(),
    /** planning | working | waiting_on_tyler | done | killed */
    state: text("state").notNull().default("planning"),
    transcriptRef: text("transcript_ref"),
    stepCount: integer("step_count").notNull().default(0),
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
  },
  (t) => ({ appIdx: index("appdev_sessions_app_idx").on(t.appId, t.state) }),
);

/** 2.12 appdev_releases — the release train object (deploy ≠ release). */
export const appdevReleases = pgTable(
  "appdev_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    version: text("version").notNull(),
    buildNumber: integer("build_number"),
    /** planned | frozen | building | submitted | in_review | phased_rollout | released | halted */
    status: text("status").notNull().default("planned"),
    codeFreezeAt: ts("code_freeze_at"),
    /** array of { item, done, by, at } */
    checklist: jsonb("checklist").$type<Array<Record<string, unknown>>>(),
    rolloutPct: integer("rollout_pct").notNull().default(0),
    rolloutHealth: jsonb("rollout_health").$type<Record<string, unknown>>(),
    linkedFlagKeys: jsonb("linked_flag_keys").$type<string[]>(),
    deploymentId: uuid("deployment_id"),
    proofBundleId: uuid("proof_bundle_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({ appIdx: index("appdev_releases_app_idx").on(t.appId, t.status) }),
);

/** 2.13 appdev_skills — reusable saved workflows. */
export const appdevSkills = pgTable(
  "appdev_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: text("name").notNull(),
    slashCommand: text("slash_command").notNull(),
    description: text("description"),
    sourceThreadId: uuid("source_thread_id"),
    /** { lane, prompt_template, expected_inputs, output_action: draft_wo|generate_assets|run_report|custom } */
    definition: jsonb("definition").$type<Record<string, unknown>>(),
    runCount: integer("run_count").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    slashUnique: uniqueIndex("appdev_skills_slash_unique").on(t.companyId, t.slashCommand),
  }),
);

/** 2.14 appdev_deployments + appdev_retros. */
export const appdevDeployments = pgTable(
  "appdev_deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    appId: uuid("app_id").notNull().references(() => appdevApps.id),
    version: text("version").notNull(),
    buildNumber: integer("build_number"),
    /** testflight | appstore | web */
    channel: text("channel").notNull(),
    ascStatus: text("asc_status"),
    deployedAt: ts("deployed_at"),
    proofBundleId: uuid("proof_bundle_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ appIdx: index("appdev_deployments_app_idx").on(t.appId) }),
);

/** 4.6 appdev_screen_baselines — versioned baselines for VFG-R (migration 0151).
 * Latest approved is the default; merge-base selection prefers an exact
 * branch_point_sha match, else the newest baseline approved before the work
 * order started (temporal approximation of branch ancestry — the server has
 * no git; documented in visual-diff.ts). Superseded baselines are retained
 * for the history scrubber. */
export const appdevScreenBaselines = pgTable(
  "appdev_screen_baselines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    screenId: uuid("scre