/**
 * Batch-import Obsidian markdown files into the Paperclip Knowledge Graph.
 *
 * Usage:
 *   pnpm tsx scripts/import-kg-obsidian.ts --company-id <id> [options]
 *
 * Options:
 *   --company-id  <id>   (required) Paperclip company UUID
 *   --vault       <dir>  Obsidian vault path (default: ~/obsidian/second-brain)
 *   --api-url     <url>  API base URL (default: http://localhost:3100)
 *   --batch-size  <n>    Files per request (default: 50, max: 500)
 *   --dry-run            Print files without importing
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        result[key] = true;
      } else {
        result[key] = next;
        i++;
      }
    }
  }
  return result;
}

// ─── File collection ─────────────────────────────────────────────────────────

function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Skip Obsidian's hidden directories
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function postJson(url: string, body: unknown): Promise<unknown> {
  const payload = JSON.stringify(body);
  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === "https:";
  const { request } = await import(isHttps ? "node:https" : "node:http");

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch { resolve(data); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface ImportResult {
  filesProcessed: number;
  entitiesCreated: number;
  entitiesMerged: number;
  edgesCreated: number;
  errors: string[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const companyId = args["company-id"] as string | undefined;
  if (!companyId) {
    console.error("Error: --company-id is required");
    console.error("Usage: pnpm tsx scripts/import-kg-obsidian.ts --company-id <uuid>");
    process.exit(1);
  }

  const vaultDir = path.resolve(
    String(args["vault"] ?? path.join(os.homedir(), "obsidian", "second-brain")),
  );
  const apiUrl = String(args["api-url"] ?? "http://localhost:3100");
  const batchSize = Math.min(500, Math.max(1, parseInt(String(args["batch-size"] ?? "50"), 10)));
  const dryRun = args["dry-run"] === true;

  if (!fs.existsSync(vaultDir)) {
    console.error(`Error: vault directory not found: ${vaultDir}`);
    process.exit(1);
  }

  console.log(`Vault:      ${vaultDir}`);
  console.log(`API:        ${apiUrl}`);
  console.log(`Company:    ${companyId}`);
  console.log(`Batch size: ${batchSize}`);
  if (dryRun) console.log("Mode:       dry-run (no import)");
  console.log();

  const files = collectMarkdownFiles(vaultDir);
  console.log(`Found ${files.length} markdown file(s)`);

  if (files.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  if (dryRun) {
    for (const f of files) {
      console.log(" ", path.relative(vaultDir, f));
    }
    return;
  }

  const endpoint = `${apiUrl}/api/companies/${encodeURIComponent(companyId)}/knowledge-graph/import`;

  let totalCreated = 0;
  let totalMerged = 0;
  let totalEdges = 0;
  let totalErrors: string[] = [];
  let batchNum = 0;
  const totalBatches = Math.ceil(files.length / batchSize);

  for (let i = 0; i < files.length; i += batchSize) {
    batchNum++;
    const batch = files.slice(i, i + batchSize);
    const payload = batch.map((filePath) => ({
      filename: path.relative(vaultDir, filePath),
      content: fs.readFileSync(filePath, "utf8"),
    }));

    process.stdout.write(`Batch ${batchNum}/${totalBatches} (${batch.length} files)... `);

    try {
      const result = (await postJson(endpoint, { files: payload })) as ImportResult;
      totalCreated += result.entitiesCreated;
      totalMerged += result.entitiesMerged;
      totalEdges += result.edgesCreated;
      totalErrors = totalErrors.concat(result.errors ?? []);
      console.log(
        `+${result.entitiesCreated} entities, ` +
        `${result.entitiesMerged} merged, ` +
        `+${result.edgesCreated} edges`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED: ${msg}`);
      totalErrors.push(`Batch ${batchNum}: ${msg}`);
    }
  }

  console.log();
  console.log("─── Summary ───────────────────────────────────");
  console.log(`Files processed:  ${files.length}`);
  console.log(`Entities created: ${totalCreated}`);
  console.log(`Entities merged:  ${totalMerged}`);
  console.log(`Edges created:    ${totalEdges}`);
  if (totalErrors.length > 0) {
    console.log(`Errors (${totalErrors.length}):`);
    for (const e of totalErrors) console.log(`  - ${e}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
