/**
 * rail-controller.ts — RAIL Phase 3 controller daemon (SHADOW MODE)
 * 
 * Polls the Paperclip DB every sweep_interval. For each actionable task,
 * writes the decision it WOULD make to rail_events. Does NOT mutate board
 * state — enforcement is OFF until Tyler flips the rail_config key.
 * 
 * Run:  PAPERCLIP_DB_PASS=... npx tsx rail-controller.ts
 * Stop:  SIGTERM (Ctrl+C)
 * 
 * ponytail: one file, ~250 LOC, zero LLM calls, Postgres is the only dependency.
 * Add a proper service wrapper when Phase 3 exits shadow.
 */

const { default: postgres } = await import("postgres");
import { randomUUID } from "crypto";

// ── Config ────────────────────────────────────────────────────────
const DB_HOST = process.env.PAPERCLIP_DB_HOST || "127.0.0.1";
const DB_PORT = parseInt(process.env.PAPERCLIP_DB_PORT || "54329", 10);
const DB_USER = process.env.PAPERCLIP_DB_USER || "paperclip";
const DB_PASS = process.env.PAPERCLIP_DB_PASS;
const DB_NAME = process.env.PAPERCLIP_DB_NAME || "paperclip";
const SWEEP_SEC = parseInt(process.env.RAIL_SWEEP_SEC || "300", 10); // 5 min default

if (!DB_PASS) {
  console.error("RAIL: PAPERCLIP_DB_PASS required");
  process.exit(1);
}

const sql = postgres({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  max: 2,
});

// ── Types ─────────────────────────────────────────────────────────
interface Issue {
  id: string;
  identifier: string;
  status: string;
  priority: string;
  title: string;
  gate_class: string;
  stall_count: number;
  agent_assignee_id: string | null;
  agent_assignee_name: string | null;
}

interface RailConfig {
  warn_ttl: number;
  revoke_ttl: number;
  sweep_interval: number;
  ready_low_watermark: number;
  wave_target_depth: number;
  enforcement: "shadow" | "on";
}

const DEFAULT_CONFIG: RailConfig = {
  warn_ttl: 20 * 60 * 1000,
  revoke_ttl: 40 * 60 * 1000,
  sweep_interval: 5 * 60 * 1000,
  ready_low_watermark: 4,
  wave_target_depth: 8,
  enforcement: "shadow",
};

// ── Helpers ───────────────────────────────────────────────────────
async function logEvent(
  type: string,
  taskId: string | null,
  agentId: string | null,
  payload: Record<string, unknown> = {}
) {
  await sql`
    INSERT INTO rail_events (id, type, task_id, agent_id, payload)
    VALUES (${randomUUID()}, ${type}, ${taskId ?? null}, ${agentId ?? null}, ${sql.json(payload)})
  `;
}

async function loadConfig(): Promise<RailConfig> {
  const rows = await sql`SELECT key, value FROM rail_config`;
  const map: Record<string, unknown> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    ...DEFAULT_CONFIG,
    ...map,
    warn_ttl: Number(map.warn_ttl ?? DEFAULT_CONFIG.warn_ttl),
    revoke_ttl: Number(map.revoke_ttl ?? DEFAULT_CONFIG.revoke_ttl),
    sweep_interval: Number(map.sweep_interval ?? DEFAULT_CONFIG.sweep_interval),
    ready_low_watermark: Number(map.ready_low_watermark ?? DEFAULT_CONFIG.ready_low_watermark),
    wave_target_depth: Number(map.wave_target_depth ?? DEFAULT_CONFIG.wave_target_depth),
    enforcement: (map.enforcement as string) === "on" ? "on" : "shadow",
  };
}

async function getReadyTasks(limit: number): Promise<Issue[]> {
  return sql<Issue[]>`
    SELECT i.id, i.identifier, i.status, i.priority, i.title,
           i.gate_class, i.stall_count,
           i.assignee_agent_id AS agent_assignee_id,
           a.name AS agent_assignee_name
    FROM issues i
    LEFT JOIN agents a ON i.assignee_agent_id = a.id
    WHERE i.status = 'todo'
      AND i.assignee_agent_id IS NOT NULL
    ORDER BY
      CASE i.gate_class WHEN 'security' THEN 0 WHEN 'spend' THEN 1
           WHEN 'schema' THEN 2 WHEN 'ui' THEN 3
           WHEN 'agent_config' THEN 4 ELSE 5 END,
      i.priority DESC,
      i.created_at ASC
    LIMIT ${limit}
  `;
}

async function getDispatchedTasks(): Promise<Issue[]> {
  return sql<Issue[]>`
    SELECT i.id, i.identifier, i.status, i.priority, i.title,
           i.gate_class, i.stall_count,
           i.assignee_agent_id AS agent_assignee_id,
           a.name AS agent_assignee_name
    FROM issues i
    LEFT JOIN agents a ON i.assignee_agent_id = a.id
    WHERE i.status IN ('in_progress', 'in_review')
  `;
}

// ── Scheduling engine ─────────────────────────────────────────────
async function sweep() {
  const ts = new Date().toISOString();
  console.log(`RAIL: sweep ${ts}`);
  const cfg = await loadConfig();
  const mode = cfg.enforcement === "on" ? "ENFORCED" : "SHADOW";

  // 1. Stalled tasks: any in_progress/in_review with no artifact > TTL
  const dispatched = await getDispatchedTasks();
  for (const task of dispatched) {
    const lastEvent = await sql`
      SELECT created_at FROM rail_events
      WHERE task_id = ${task.id}
      ORDER BY created_at DESC LIMIT 1
    `;
    const lastActivity = lastEvent[0]?.created_at ?? null;
    const age = lastActivity
      ? Date.now() - new Date(lastActivity).getTime()
      : Infinity;

    if (age > cfg.revoke_ttl) {
      await logEvent("revoke", task.id, task.agent_assignee_id, {
        mode,
        task: task.identifier,
        agent: task.agent_assignee_name,
        age_ms: age,
        stall_count: task.stall_count + 1,
        reason: `no artifact for ${Math.round(age / 60000)}m (> ${cfg.revoke_ttl / 60000}m)`,
      });
      console.log(`RAIL: [${mode}] REVOKE ${task.identifier} → stall #${task.stall_count + 1}`);
    } else if (age > cfg.warn_ttl) {
      await logEvent("warn", task.id, task.agent_assignee_id, {
        mode,
        task: task.identifier,
        agent: task.agent_assignee_name,
        age_ms: age,
        reason: `no artifact for ${Math.round(age / 60000)}m`,
      });
      console.log(`RAIL: [${mode}] WARN ${task.identifier} — idle ${Math.round(age / 60000)}m`);
    }
  }

  // 2. Backpressure: ready queue depth check
  const readyCount = await sql`SELECT count(*)::int as c FROM issues WHERE status = 'todo' AND assignee_agent_id IS NOT NULL`;
  const depth = readyCount[0]?.c ?? 0;
  if (depth < cfg.ready_low_watermark) {
    const needed = cfg.wave_target_depth - depth;
    await logEvent("backpressure_request", null, null, {
      mode,
      ready_depth: depth,
      watermark: cfg.ready_low_watermark,
      target: cfg.wave_target_depth,
      specs_needed: needed,
    });
    console.log(`RAIL: [${mode}] BACKPRESSURE ready=${depth} < ${cfg.ready_low_watermark}, need ${needed} specs`);
  }

  // 3. Claim candidates: top ready tasks with available agents
  const ready = await getReadyTasks(20);
  const seats = await sql`SELECT id, name FROM agents WHERE status = 'active'`;
  console.log(`RAIL: ready=${ready.length} seats=${seats.length} mode=${mode}`);
}

// ── Main loop ─────────────────────────────────────────────────────
async function main() {
  console.log("RAIL: controller starting (SHADOW — enforcement OFF)");
  console.log(`RAIL: sweep interval ${SWEEP_SEC}s, host ${DB_HOST}:${DB_PORT}`);

  // Seed default config if empty
  const existing = await sql`SELECT count(*)::int as c FROM rail_config`;
  if ((existing[0]?.c ?? 0) === 0) {
    await sql`
      INSERT INTO rail_config (key, value) VALUES
      ('warn_ttl', '1200000'), ('revoke_ttl', '2400000'),
      ('sweep_interval', '300000'), ('ready_low_watermark', '4'),
      ('wave_target_depth', '8'), ('enforcement', '"shadow"')
    `;
    console.log("RAIL: seeded default rail_config");
  }

  await logEvent("sweep_start", null, null, { version: "0.1.0", mode: "shadow" });

  // Initial sweep
  await sweep();

  // Recurring
  setInterval(async () => {
    try { await sweep(); } catch (e) {
      console.error("RAIL: sweep error", e);
      await logEvent("sweep_error", null, null, {
        error: String(e),
        at: new Date().toISOString(),
      });
    }
  }, SWEEP_SEC * 1000);
}

main().catch((e) => {
  console.error("RAIL: fatal", e);
  process.exit(1);
});
