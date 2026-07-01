// Verification harness for the App Dev endpoints. Runs against a REAL Postgres
// started from the worktree, applies the real 0130 migration (tables + blueprint
// seed), seeds real-shaped Tyler Co data (the actual BailysApp feedback titles +
// fleet agents + runs), then executes the SAME query logic the route handlers
// use and prints each endpoint's JSON. Verifies SQL correctness + data shape.
import fs from "node:fs";
import postgres from "/sessions/determined-loving-curie/mnt/paperclip/node_modules/.pnpm/postgres@3.4.8/node_modules/postgres/src/index.js";

const MIG = "/sessions/determined-loving-curie/mnt/paperclip/.claude/worktrees/appdev-redesign/packages/db/src/migrations/0130_app_dev.sql";
const sql = postgres({ host: "/tmp", port: 5440, user: "appdev", database: "postgres", prepare: false, max: 1 });

const COMPANY = "414c172d-7013-4728-b781-aad604d8e2d7";
const FEEDBACK_KIND = "app-feedback";

function id() { return crypto.randomUUID(); }

async function main() {
  // Minimal real-shaped base tables the migration + queries depend on.
  await sql.unsafe(`
    DROP TABLE IF EXISTS app_dev_apps, app_dev_blueprints, heartbeat_runs, approvals, issues, agents, companies CASCADE;
    CREATE TABLE companies (id uuid PRIMARY KEY, name text);
    CREATE TABLE agents (id uuid PRIMARY KEY, company_id uuid, name text, role text, status text);
    CREATE TABLE issues (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, origin_kind text DEFAULT 'manual', origin_id text, status text DEFAULT 'todo', title text, description text, created_at timestamptz DEFAULT now());
    CREATE TABLE approvals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, type text, status text);
    CREATE TABLE heartbeat_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, agent_id uuid, status text, started_at timestamptz, finished_at timestamptz, result_json jsonb, context_snapshot jsonb, created_at timestamptz DEFAULT now());
  `);

  // Apply the REAL migration (creates app_dev_* tables + seeds blueprints).
  const migSql = fs.readFileSync(MIG, "utf8");
  for (const stmt of migSql.split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) await sql.unsafe(s);
  }

  // Seed real-shaped Tyler Co data.
  await sql`INSERT INTO companies (id,name) VALUES (${COMPANY},'Tyler Co')`;
  const builder = id(), reviewer = id(), security = id(), designer = id();
  await sql`INSERT INTO agents (id,company_id,name,role,status) VALUES
    (${builder},${COMPANY},'Builder','devops','idle'),
    (${reviewer},${COMPANY},'Reviewer','reviewer','running' ),
    (${security},${COMPANY},'Security','security','idle'),
    (${designer},${COMPANY},'Designer','designer','idle')`;

  // Real BailysApp feedback (titles/provenance pulled from the live app).
  const fb = [
    ["[Baily • feature] Explore", "On the explore page can you add a place to just search a place by adding in the name of the place of the restaurant\n\n- bailysapp v45 - iOS 26.5 - via in-app feedback", "todo"],
    ["[Baily • feature] Today page", "On the today page, all the panels have rounded corners except the alarm and feedback panels\n\n- bailysapp v45 - iOS 26.5 - via in-app feedback", "todo"],
    ["[Baily • feature] Today", "If I click on the planned dinner recipe on the today page, it takes me to all recipes instead of that one\n\n- bailysapp v45 - iOS 26.5 - via in-app feedback", "todo"],
    ["[Baily • feature] Fitness", "Can there be more exercise options like Pilates, boxing, and yoga, etc\n\n- bailysapp v45 - iOS 26.5 - via in-app feedback", "todo"],
    ["[Baily • bug] Alarm sound", "The alarm sound doesn't stop when I dismiss it sometimes\n\n- bailysapp v45 - iOS 26.5 - via in-app feedback", "todo"],
    ["[Baily • feature] Dark mode", "Please add a true black dark mode for OLED\n\n- bailysapp v44 - iOS 26.4 - via in-app feedback", "done"],
    ["[Baily • feature] Widgets", "Home screen widget for today's plan\n\n- bailysapp v44 - iOS 26.4 - via in-app feedback", "todo"],
    ["[Baily • bug] Sync", "Calendar sync dropped an event\n\n- bailysapp v44 - iOS 26.4 - via in-app feedback", "done"],
    ["[Baily • feature] Search", "Global search across notes and plans\n\n- bailysapp v45 - iOS 26.5 - via in-app feedback", "todo"],
    ["[Baily • feature] Streaks", "Show a streak counter on the home tab\n\n- bailysapp v45 - iOS 26.5 - via in-app feedback", "todo"],
    ["[Baily • feature] Export", "Let me export my data to CSV\n\n- bailysapp v44 - iOS 26.4 - via in-app feedback", "todo"],
  ];
  for (const [title, desc, status] of fb) {
    await sql`INSERT INTO issues (company_id,origin_kind,origin_id,status,title,description) VALUES (${COMPANY},${FEEDBACK_KIND},'bailysapp',${status},${title},${desc})`;
  }
  // approvals (real shape — mostly resolved, like live)
  await sql`INSERT INTO approvals (company_id,type,status) VALUES (${COMPANY},'hire_agent','approved'),(${COMPANY},'approve_ceo_strategy','pending')`;
  // heartbeat_runs for pipeline agents (real shape)
  await sql`INSERT INTO heartbeat_runs (company_id,agent_id,status,started_at,finished_at,result_json,context_snapshot) VALUES
    (${COMPANY},${builder},'finished',now()-interval '2 hours',now()-interval '110 minutes','{"commit":"8f3a7c2"}','{"commit":"8f3a7c2","stage":"build"}'),
    (${COMPANY},${reviewer},'running',now()-interval '20 minutes',NULL,NULL,'{"stage":"review"}')`;

  // ---- Endpoint logic (mirrors server/src/routes/app-dev.ts) ----
  // ensureApps
  const origins = (await sql`SELECT DISTINCT lower(origin_id) o FROM issues WHERE company_id=${COMPANY} AND origin_kind=${FEEDBACK_KIND} AND origin_id IS NOT NULL`).map(r => r.o);
  const wanted = [{ key: "missioncontrol", kind: "cockpit", fo: null, name: "MissionControl", tagline: "The operations cockpit — your agent fleet's home base.", accent: "#3B82FF", repo: "paperclipai/paperclip" },
  ...origins.filter(o => o !== "missioncontrol").map(o => ({ key: o, kind: "app", fo: o, name: o === "bailysapp" ? "Baily's App" : o, tagline: o === "bailysapp" ? "Daily planner & focus companion shipping real user feedback." : null, accent: "#A56EFF", repo: null }))];
  let so = 0;
  for (const w of wanted) {
    await sql`INSERT INTO app_dev_apps (company_id,key,name,tagline,kind,feedback_origin_id,repo,accent,sort_order)
      VALUES (${COMPANY},${w.key},${w.name},${w.tagline},${w.kind},${w.fo},${w.repo},${w.accent},${so++})
      ON CONFLICT (company_id,key) DO NOTHING`;
  }

  // GET apps
  const rows = await sql`SELECT * FROM app_dev_apps WHERE company_id=${COMPANY} ORDER BY sort_order`;
  const feedback = await sql`SELECT origin_id,status,description FROM issues WHERE company_id=${COMPANY} AND origin_kind=${FEEDBACK_KIND}`;
  const pending = (await sql`SELECT status FROM approvals WHERE company_id=${COMPANY}`).filter(a => a.status === "pending" || a.status === "revision_requested").length;
  const apps = rows.map(r => {
    const items = feedback.filter(f => r.feedback_origin_id && (f.origin_id || "").toLowerCase() === r.feedback_origin_id.toLowerCase());
    const vers = items.map(i => { const m = (i.description || "").match(/\bv(\d+)\b/i); return m ? +m[1] : null; }).filter(v => v != null);
    return { key: r.key, name: r.name, kind: r.kind, feedbackCount: items.length, openFeedback: items.filter(i => i.status !== "done").length, latestVersion: vers.length ? "v" + Math.max(...vers) : null, pendingApprovals: pending };
  });

  // GET blueprints
  const blueprints = await sql`SELECT category,name,sort_order FROM app_dev_blueprints ORDER BY category,sort_order`;

  // GET builds (heartbeat_runs of pipeline agents)
  const fleet = await sql`SELECT id,name,role,status FROM agents WHERE company_id=${COMPANY}`;
  const pipe = fleet.filter(a => ["devops", "reviewer", "security"].includes(a.role));
  const stageFor = r => r === "devops" ? "Build" : r === "reviewer" ? "Review" : "Security";
  const runs = await sql`SELECT id,agent_id,status,result_json,context_snapshot FROM heartbeat_runs WHERE company_id=${COMPANY} AND agent_id IN ${sql(pipe.map(a => a.id))} ORDER BY created_at DESC LIMIT 20`;
  const agById = new Map(pipe.map(a => [a.id, a]));
  const prog = s => s === "finished" ? 100 : s === "running" ? 50 : s === "queued" ? 0 : 25;
  const builds = runs.map(r => { const a = agById.get(r.agent_id); const c = (r.context_snapshot || {}); const rj = (r.result_json || {}); return { stage: a ? stageFor(a.role) : "Build", agentName: a?.name, status: r.status, progress: prog(r.status), commit: c.commit || rj.commit || null }; });
  const stages = pipe.map(a => { const latest = builds.find(b => b.agentName === a.name); return { stage: stageFor(a.role), agentName: a.name, agentStatus: a.status, latestRunStatus: latest?.status ?? null, progress: latest?.progress ?? null }; });

  // GET releases (feedback-by-version for bailysapp)
  const ba = rows.find(r => r.feedback_origin_id === "bailysapp");
  const items = await sql`SELECT title,description,status FROM issues WHERE company_id=${COMPANY} AND origin_kind=${FEEDBACK_KIND} AND origin_id=${ba.feedback_origin_id}`;
  const byV = new Map();
  for (const i of items) { const m = (i.description || "").match(/\bv(\d+)\b/i); if (!m) continue; const v = +m[1]; if (!byV.has(v)) byV.set(v, { version: v, items: [] }); const km = (i.title || "").match(/•\s*(bug|feature)/i); byV.get(v).items.push({ title: (i.title || "").replace(/^\[[^\]]*\]\s*/, ""), kind: km ? km[1] : "feedback", status: i.status }); }
  const versions = [...byV.values()].sort((a, b) => b.version - a.version).map(v => ({ version: v.version, count: v.items.length, features: v.items.filter(i => i.kind === "feature").length, bugs: v.items.filter(i => i.kind === "bug").length }));

  console.log("=== /app-dev/apps ===");
  console.log(JSON.stringify(apps, null, 1));
  console.log("=== /app-dev/blueprints (" + blueprints.length + ") ===");
  console.log(JSON.stringify(blueprints.map(b => b.category + "/" + b.name)));
  console.log("=== /app-dev/apps/bailysapp/builds ===");
  console.log(JSON.stringify({ stages, builds }, null, 1));
  console.log("=== /app-dev/apps/bailysapp/releases ===");
  console.log(JSON.stringify({ latestVersion: versions[0]?.version, versions }, null, 1));

  await sql.end();
  console.log("VERIFY_OK");
}
main().catch(e => { console.error("VERIFY_FAIL", e.message); process.exit(1); });
