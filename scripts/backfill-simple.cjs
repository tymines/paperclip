#!/usr/bin/env node
const { Client } = require('/Users/augi/paperclip/node_modules/.pnpm/pg@8.18.0/node_modules/pg');
const { readFileSync, existsSync, readdirSync, statSync } = require('fs');
const { execSync } = require('child_process');
const path = require('path');

async function main() {
  const client = new Client({ host: '127.0.0.1', port: 54329, user: 'paperclip', password: 'paperclip', database: 'paperclip' });
  await client.connect();
  console.log('Connected to PG');

  // Find the actual company ID from the database
  const { rows: companyRows } = await client.query(`SELECT id FROM companies LIMIT 1`);
  const COMPANY_ID = companyRows.length > 0 ? companyRows[0].id : null;
  if (!COMPANY_ID) { console.log('No company found'); await client.end(); return; }
  console.log('Using company_id:', COMPANY_ID);

  // Create design_assets table
  await client.query(`
    CREATE TABLE IF NOT EXISTS "design_assets" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
      "run_id" uuid NOT NULL REFERENCES "design_runs"("id") ON DELETE CASCADE,
      "kind" text NOT NULL DEFAULT 'image',
      "path" text NOT NULL,
      "url" text,
      "width" integer,
      "height" integer,
      "duration_ms" integer,
      "slide_index" integer NOT NULL DEFAULT 0,
      "skill" text,
      "prompt" text,
      "agent_id" text,
      "persona" text,
      "favorited" boolean NOT NULL DEFAULT false,
      "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS "design_assets_company_created_idx" ON "design_assets" ("company_id", "created_at" DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS "design_assets_run_id_idx" ON "design_assets" ("run_id")`);
  await client.query(`CREATE INDEX IF NOT EXISTS "design_assets_kind_idx" ON "design_assets" ("kind")`);
  await client.query(`CREATE INDEX IF NOT EXISTS "design_assets_favorited_idx" ON "design_assets" ("favorited")`);
  await client.query(`CREATE INDEX IF NOT EXISTS "design_assets_skill_idx" ON "design_assets" ("skill")`);
  console.log('Table ready');

  // Get runs with assets
  const { rows: runs } = await client.query(`
    SELECT id, company_id, skill, prompt, agent_id, png_paths, mp4_path, created_at
    FROM design_runs
    WHERE status = 'completed'
      AND (png_paths IS NOT NULL OR mp4_path IS NOT NULL)
    ORDER BY created_at DESC
  `);
  console.log(`Found ${runs.length} runs with assets`);

  let inserted = 0;
  for (const run of runs) {
    const base = `/Users/augi/.paperclip/design-runs/${run.id}`;

    // PNGs
    let pngs = [];
    if (run.png_paths) {
      try { pngs = typeof run.png_paths === 'string' ? JSON.parse(run.png_paths) : run.png_paths; }
      catch { pngs = []; }
    }
    if (!Array.isArray(pngs)) pngs = [];

    for (let si = 0; si < pngs.length; si++) {
      const p = pngs[si];
      if (!p || !existsSync(p)) continue;

      let w = null, h = null;
      try {
        const out = execSync(`identify -format "%w %h" "${p}" 2>/dev/null || echo "0 0"`, { encoding: 'utf8', timeout: 5000 });
        const parts = out.trim().split(' ');
        const pw = parseInt(parts[0]), ph = parseInt(parts[1]);
        if (Number.isFinite(pw) && Number.isFinite(ph) && pw > 0 && ph > 0) { w = pw; h = ph; }
      } catch {}

      const url = `/api/design/runs/${run.id}/asset.png?slide=${si}`;
      await client.query(
        `INSERT INTO design_assets (company_id, run_id, kind, path, url, width, height, slide_index, skill, prompt, agent_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [COMPANY_ID, run.id, 'image', p, url, w, h, si, run.skill, run.prompt, run.agent_id, run.created_at]
      );
      inserted++;
    }

    // MP4
    if (run.mp4_path && existsSync(run.mp4_path)) {
      let w = null, h = null, dur = null;
      try {
        const out = execSync(`ffprobe -v error -show_entries stream=width,height -show_entries format=duration -of csv=p=0 "${run.mp4_path}" 2>/dev/null || echo "0,0,0"`, { encoding: 'utf8', timeout: 10000 });
        const parts = out.trim().split(',');
        w = parseInt(parts[0]); h = parseInt(parts[1]); dur = Math.round(parseFloat(parts[2]) * 1000);
        if (!Number.isFinite(w) || w <= 0) w = null;
        if (!Number.isFinite(h) || h <= 0) h = null;
        if (!Number.isFinite(dur) || dur <= 0) dur = null;
      } catch {}

      const url = `/api/design/runs/${run.id}/asset.mp4`;
      await client.query(
        `INSERT INTO design_assets (company_id, run_id, kind, path, url, width, height, duration_ms, slide_index, skill, prompt, agent_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12)`,
        [COMPANY_ID, run.id, 'video', run.mp4_path, url, w, h, dur, run.skill, run.prompt, run.agent_id, run.created_at]
      );
      inserted++;
    }
  }

  console.log(`Inserted: ${inserted}`);
  const { rows: [total] } = await client.query('SELECT count(*)::int as c FROM design_assets');
  console.log(`Total design_assets rows: ${total.c}`);
  await client.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
