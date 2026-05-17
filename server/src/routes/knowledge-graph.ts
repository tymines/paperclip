import { deflateRawSync } from "node:zlib";
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import type { ImportMarkdownResult } from "@paperclipai/shared";
import { knowledgeGraphService } from "../services/knowledge-graph.js";
import { assertCompanyAccess } from "./authz.js";

// ─── Minimal ZIP builder (pure Node.js, no dependencies) ─────────────────────

function crc32(buf: Buffer): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDate(): number {
  const d = new Date();
  return (
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f)
  );
}

function dosTime(): number {
  const d = new Date();
  return ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralDirs: Buffer[] = [];
  let offset = 0;

  const dt = dosDate();
  const tm = dosTime();

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const raw = entry.data;
    const compressed = deflateRawSync(raw, { level: 6 });
    const useDeflate = compressed.length < raw.length;
    const fileData = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.allocUnsafe(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(tm, 10);
    local.writeUInt16LE(dt, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(fileData.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const cd = Buffer.allocUnsafe(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(tm, 12);
    cd.writeUInt16LE(dt, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(fileData.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBytes.copy(cd, 46);

    localHeaders.push(local, fileData);
    centralDirs.push(cd);
    offset += local.length + fileData.length;
  }

  const cdStart = offset;
  const cdBuf = Buffer.concat(centralDirs);
  const eocd = Buffer.allocUnsafe(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, cdBuf, eocd]);
}

// ─── Obsidian markdown generators ────────────────────────────────────────────

function yamlFrontmatter(fields: Record<string, string | string[] | null | undefined>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - "${item.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${k}: "${String(v).replace(/"/g, '\\"')}"`);
    }
  }
  lines.push("---\n");
  return lines.join("\n");
}

function wikilink(label: string): string {
  return `[[${label}]]`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").slice(0, 200);
}

// ─── Route schemas ───────────────────────────────────────────────────────────

const ingestRunSchema = z.object({
  runId: z.string().uuid(),
});

const importMarkdownSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(500),
        content: z.string().max(500_000),
      }),
    )
    .min(1)
    .max(500),
});

// ─── Router ──────────────────────────────────────────────────────────────────

export function knowledgeGraphRoutes(db: Db) {
  const router = Router();
  const svc = knowledgeGraphService(db);

  // ── Phase 2: Hub clustering routes ─────────────────────────────────────────

  router.get("/companies/:companyId/knowledge-graph/hubs", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    const hubs = await svc.getHubs(companyId);
    res.json(hubs);
  });

  router.post("/companies/:companyId/knowledge-graph/generate-hubs", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    const k = typeof req.body?.k === "number" ? req.body.k : 5;
    const hubs = await svc.generateHubs(companyId, k);
    res.json(hubs);
  });

  router.get("/companies/:companyId/knowledge-graph/agent-skills", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    const edges = await svc.getAgentSkillEdges(companyId);
    res.json(edges);
  });

  // ── Phase 4: Entity/Edge CRUD + Obsidian export ────────────────────────────

  router.get("/companies/:companyId/knowledge-graph", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    const [entities, edges] = await Promise.all([svc.listEntities(companyId), svc.listEdges(companyId)]);
    res.json({ entities, edges });
  });

  router.post(
    "/companies/:companyId/knowledge-graph/ingest-run",
    validate(ingestRunSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const { runId } = req.body as { runId: string };
      const result = await svc.ingestRun(companyId, runId);
      res.status(200).json(result);
    },
  );

  router.post(
    "/companies/:companyId/knowledge-graph/import",
    validate(importMarkdownSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      assertCompanyAccess(req, companyId);
      const { files } = req.body as z.infer<typeof importMarkdownSchema>;
      const result: ImportMarkdownResult = await svc.importMarkdown(companyId, files);
      res.status(200).json(result);
    },
  );

  router.delete("/companies/:companyId/knowledge-graph", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    await svc.clearAll(companyId);
    res.status(204).end();
  });

  router.get("/companies/:companyId/knowledge-graph/export/obsidian", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);

    const [entities, edges] = await Promise.all([svc.listEntities(companyId), svc.listEdges(companyId)]);

    const entityLabelMap = new Map(entities.map((e) => [e.id, e.label]));

    const outbound = new Map<string, string[]>();
    for (const edge of edges) {
      const srcLabel = entityLabelMap.get(edge.sourceEntityId);
      const tgtLabel = entityLabelMap.get(edge.targetEntityId);
      if (!srcLabel || !tgtLabel) continue;
      if (!outbound.has(edge.sourceEntityId)) outbound.set(edge.sourceEntityId, []);
      outbound.get(edge.sourceEntityId)!.push(tgtLabel);
    }

    const zipEntries: ZipEntry[] = [];

    const indexLines = [
      "# Knowledge Graph Vault",
      "",
      `Exported from Paperclip — ${new Date().toISOString()}`,
      "",
      `## Summary`,
      `- **Entities:** ${entities.length}`,
      `- **Edges:** ${edges.length}`,
      "",
      "## Entity Types",
    ];
    const byType = new Map<string, typeof entities>();
    for (const e of entities) {
      if (!byType.has(e.type)) byType.set(e.type, []);
      byType.get(e.type)!.push(e);
    }
    for (const [type, items] of byType) {
      indexLines.push(`\n### ${type.charAt(0).toUpperCase() + type.slice(1)}s`);
      for (const item of items) indexLines.push(`- ${wikilink(item.label)}`);
    }

    zipEntries.push({
      name: "README.md",
      data: Buffer.from(indexLines.join("\n"), "utf8"),
    });

    for (const entity of entities) {
      const links = outbound.get(entity.id) ?? [];
      const fm = yamlFrontmatter({
        id: entity.id,
        type: entity.type,
        sourceRunId: entity.sourceRunId ?? undefined,
        created: entity.createdAt,
        tags: [entity.type, "knowledge-graph"],
      });

      const body = [
        fm,
        `# ${entity.label}`,
        "",
        `**Type:** ${entity.type}`,
        entity.sourceRunId ? `**Source Run:** ${entity.sourceRunId}` : null,
        "",
      ]
        .filter((l) => l !== null)
        .join("\n");

      const linksSection =
        links.length > 0
          ? `\n## Connections\n\n${links.map((l) => `- ${wikilink(l)}`).join("\n")}\n`
          : "";

      const propsSection =
        entity.properties && Object.keys(entity.properties).length > 0
          ? `\n## Properties\n\n\`\`\`json\n${JSON.stringify(entity.properties, null, 2)}\n\`\`\`\n`
          : "";

      const folder = entity.type + "s";
      zipEntries.push({
        name: `${folder}/${sanitizeFilename(entity.label)}.md`,
        data: Buffer.from(body + linksSection + propsSection, "utf8"),
      });
    }

    const zip = buildZip(zipEntries);

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="paperclip-knowledge-graph.zip"`,
      "Content-Length": zip.length,
    });
    res.end(zip);
  });

  return router;
}
