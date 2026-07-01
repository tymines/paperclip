/**
 * Knowledge Graph service — combines:
 *  1. TF-IDF hub clustering (Phase 2: smart connections)
 *  2. GraphRAG entity extraction pipeline (Phase 4: second brain)
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companySkills,
  issues,
  knowledgeHubs,
  knowledgeEntities,
  knowledgeEdges,
  heartbeatRuns,
  heartbeatRunEvents,
} from "@paperclipai/db";
import type { KnowledgeEntity, KnowledgeEdge, IngestRunResult, ImportMarkdownResult } from "@paperclipai/shared";
import { readPaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";
import { publishLiveEvent } from "./live-events.js";
import { logger } from "../middleware/logger.js";

// ─── TF-IDF clustering ─────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","up","is","are","was","were","be","been","being","have",
  "has","had","do","does","did","will","would","could","should","may",
  "might","shall","can","not","it","its","this","that","these","those",
  "we","i","you","he","she","they","them","our","your","his","her","their",
  "as","if","so","but","than","then","when","where","which","who","how",
  "all","each","every","any","some","no","more","also","into","about",
  "after","before","during","while","because","since","though","although",
  "add","fix","update","remove","change","use","make","get","set","new",
  "improve","refactor","support","implement","create","delete","allow",
  "enable","disable","handle","check","return","provide","include",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function buildTfIdf(docs: string[][]): number[][] {
  const n = docs.length;
  if (n === 0) return [];

  const df = new Map<string, number>();
  for (const tokens of docs) {
    const unique = new Set(tokens);
    for (const t of unique) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const vocab: string[] = [];
  for (const [term, count] of df) {
    if (count >= 2 && count / n <= 0.8) vocab.push(term);
  }
  if (vocab.length === 0) return docs.map(() => []);

  const vocabIndex = new Map(vocab.map((t, i) => [t, i]));

  return docs.map((tokens) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    const vec = new Array(vocab.length).fill(0) as number[];
    for (const [term, count] of tf) {
      const idx = vocabIndex.get(term);
      if (idx === undefined) continue;
      const idf = Math.log(n / (df.get(term) ?? 1));
      vec[idx] = (count / tokens.length) * idf;
    }
    return vec;
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function kMeans(vectors: number[][], k: number, maxIter = 20): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n <= k) return vectors.map((_, i) => i % k);

  const step = Math.floor(n / k);
  let centroids = Array.from({ length: k }, (_, i) => [...vectors[i * step]]);
  let assignments = new Array<number>(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    const prev = [...assignments];

    for (let i = 0; i < n; i++) {
      let best = 0, bestSim = -1;
      for (let c = 0; c < k; c++) {
        const sim = cosineSimilarity(vectors[i], centroids[c]);
        if (sim > bestSim) { bestSim = sim; best = c; }
      }
      assignments[i] = best;
    }

    const dim = vectors[0].length;
    const sums = Array.from({ length: k }, () => new Array<number>(dim).fill(0));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < dim; d++) sums[c][d] += vectors[i][d];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centroids[c] = sums[c].map((s) => s / counts[c]);
      }
    }

    if (assignments.every((a, i) => a === prev[i])) break;
  }

  return assignments;
}

function topTermsForCluster(
  docs: string[][],
  vectors: number[][],
  assignments: number[],
  clusterId: number,
  vocab: string[],
  n: number,
): string[] {
  const dim = vectors[0]?.length ?? 0;
  if (dim === 0) return [];
  const sum = new Array<number>(dim).fill(0);
  let count = 0;
  for (let i = 0; i < assignments.length; i++) {
    if (assignments[i] === clusterId) {
      for (let d = 0; d < dim; d++) sum[d] += vectors[i][d];
      count++;
    }
  }
  if (count === 0) return [];
  const avg = sum.map((s) => s / count);

  const scored = avg.map((score, i) => ({ term: vocab[i], score }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((x) => x.term);
}

function nameCluster(topTerms: string[]): string {
  if (topTerms.length === 0) return "General";
  const parts = topTerms.slice(0, 3).map((t) => t.charAt(0).toUpperCase() + t.slice(1));
  return parts.join(" & ");
}

// ─── Entity extraction helpers (Phase 4: second brain) ────────────────────

function toEntity(row: typeof knowledgeEntities.$inferSelect): KnowledgeEntity {
  return {
    id: row.id,
    companyId: row.companyId,
    type: row.type as KnowledgeEntity["type"],
    label: row.label,
    properties: (row.properties as Record<string, unknown>) ?? null,
    sourceRunId: row.sourceRunId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEdge(row: typeof knowledgeEdges.$inferSelect): KnowledgeEdge {
  return {
    id: row.id,
    companyId: row.companyId,
    sourceEntityId: row.sourceEntityId,
    targetEntityId: row.targetEntityId,
    relationType: row.relationType as KnowledgeEdge["relationType"],
    sourceRunId: row.sourceRunId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

interface ExtractedEntity {
  type: KnowledgeEntity["type"];
  label: string;
  properties?: Record<string, unknown>;
}

interface ExtractedEdge {
  sourceLabel: string;
  targetLabel: string;
  relationType: KnowledgeEdge["relationType"];
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  edges: ExtractedEdge[];
}

const FILE_REGEX = /(?:^|\s)((?:\.{0,2}\/)?[\w\-./]+\.(?:ts|tsx|js|jsx|py|go|rs|rb|sh|json|yaml|yml|md|sql|css|html|env))\b/gm;
const ERROR_REGEX = /(?:Error|Exception|FAILED|fatal|panic)[\s:]+([^\n]{3,120})/gi;
const TOOL_REGEX = /\b((?:read|write|edit|bash|grep|glob|search|create|delete|move|copy|run|execute|install|deploy|build|test|lint|format)(?:_file|_dir|_code|Tool|Fn)?)\b/gi;
const DECISION_REGEX = /(?:decided?|choosing?|selected?|will use|going with|switched? to|migrated? to)\s+([^\n.,;]{3,80})/gi;

function heuristicExtract(text: string): ExtractionResult {
  const entities: ExtractedEntity[] = [];
  const edges: ExtractedEdge[] = [];
  const seen = new Set<string>();

  const addEntity = (type: ExtractedEntity["type"], label: string, props?: Record<string, unknown>) => {
    const key = `${type}:${label.toLowerCase()}`;
    if (!seen.has(key) && label.length >= 2) {
      seen.add(key);
      entities.push({ type, label: label.trim(), properties: props });
    }
  };

  for (const match of text.matchAll(FILE_REGEX)) {
    const path = match[1];
    if (path && !path.startsWith(".git") && path.length < 200) {
      addEntity("file", path);
    }
  }

  for (const match of text.matchAll(ERROR_REGEX)) {
    const msg = match[1]?.trim();
    if (msg) addEntity("error", msg.slice(0, 120));
  }

  const toolSeen = new Set<string>();
  for (const match of text.matchAll(TOOL_REGEX)) {
    const name = match[1]?.toLowerCase();
    if (name && !toolSeen.has(name)) {
      toolSeen.add(name);
      addEntity("tool", match[1] as string);
    }
  }

  for (const match of text.matchAll(DECISION_REGEX)) {
    const desc = match[1]?.trim();
    if (desc && desc.length > 5) addEntity("decision", desc.slice(0, 100));
  }

  const files = entities.filter((e) => e.type === "file");
  const tools = entities.filter((e) => e.type === "tool");
  for (const tool of tools.slice(0, 5)) {
    for (const file of files.slice(0, 8)) {
      edges.push({ sourceLabel: tool.label, targetLabel: file.label, relationType: "modifies" });
    }
  }

  const errors = entities.filter((e) => e.type === "error");
  for (const err of errors.slice(0, 3)) {
    if (tools[0]) {
      edges.push({ sourceLabel: tools[0].label, targetLabel: err.label, relationType: "caused" });
    }
  }

  return { entities, edges };
}

async function llmExtract(text: string): Promise<ExtractionResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk" as string) as {
      default: new (opts: { apiKey: string }) => {
        messages: {
          create: (opts: {
            model: string;
            max_tokens: number;
            messages: Array<{ role: string; content: string }>;
          }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
        };
      };
    };

    const client = new Anthropic({ apiKey });
    const prompt = `You are a knowledge graph builder. Extract entities and relationships from this agent run output.

Return ONLY valid JSON matching this schema:
{
  "entities": [{"type": "tool|file|error|decision|concept", "label": "string", "properties": {}}],
  "edges": [{"sourceLabel": "string", "targetLabel": "string", "relationType": "uses|modifies|caused|decided|references"}]
}

Rules:
- labels must be concise (< 100 chars)
- extract at most 20 entities and 15 edges
- type "tool" = CLI tools or functions called
- type "file" = file paths modified or read
- type "error" = error messages encountered
- type "decision" = architectural or implementation decisions made
- type "concept" = important technical concepts discussed

Agent run output (truncated to 4000 chars):
${text.slice(0, 4000)}`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content.find((c) => c.type === "text")?.text ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as ExtractionResult;
    return parsed;
  } catch (err) {
    logger.warn({ err }, "LLM entity extraction failed, using heuristics");
    return null;
  }
}

// ─── Combined service ─────────────────────────────────────────────────────────

export function knowledgeGraphService(db: Db) {
  return {
    // ── Hubs (Phase 2: smart connections) ────────────────────────────────────

    async getHubs(companyId: string) {
      return db
        .select()
        .from(knowledgeHubs)
        .where(eq(knowledgeHubs.companyId, companyId))
        .orderBy(knowledgeHubs.createdAt);
    },

    async generateHubs(companyId: string, k = 5) {
      const issueRows = await db
        .select({ id: issues.id, title: issues.title, description: issues.description })
        .from(issues)
        .where(and(eq(issues.companyId, companyId)));

      const eligible = issueRows.filter((r) => r.title?.trim());
      if (eligible.length === 0) return [];

      const clusterCount = Math.max(2, Math.min(k, Math.floor(eligible.length / 2), 8));

      const tokenized = eligible.map((r) =>
        tokenize(`${r.title} ${r.description ?? ""}`),
      );

      const vectors = buildTfIdf(tokenized);

      const dim = vectors[0]?.length ?? 0;
      const vocab: string[] = [];
      if (dim > 0) {
        const df = new Map<string, number>();
        for (const tokens of tokenized) {
          const unique = new Set(tokens);
          for (const t of unique) df.set(t, (df.get(t) ?? 0) + 1);
        }
        const n = tokenized.length;
        for (const [term, count] of df) {
          if (count >= 2 && count / n <= 0.8) vocab.push(term);
        }
      }

      const assignments = dim > 0 ? kMeans(vectors, clusterCount) : eligible.map((_, i) => i % clusterCount);

      const clusterIssueIds = new Map<number, string[]>();
      for (let i = 0; i < eligible.length; i++) {
        const c = assignments[i];
        if (!clusterIssueIds.has(c)) clusterIssueIds.set(c, []);
        clusterIssueIds.get(c)!.push(eligible[i].id);
      }

      await db.delete(knowledgeHubs).where(eq(knowledgeHubs.companyId, companyId));

      const hubs = [];
      for (const [clusterId, issueIdList] of clusterIssueIds) {
        const topTerms =
          dim > 0
            ? topTermsForCluster(tokenized, vectors, assignments, clusterId, vocab, eligible.length)
            : [];
        const name = nameCluster(topTerms);
        const [hub] = await db
          .insert(knowledgeHubs)
          .values({
            companyId,
            name,
            description: topTerms.length > 0 ? `Top themes: ${topTerms.join(", ")}` : null,
            issueIds: issueIdList,
            topTerms,
          })
          .returning();
        hubs.push(hub);
      }

      return hubs;
    },

    async getAgentSkillEdges(companyId: string) {
      const [agentRows, skillRows] = await Promise.all([
        db
          .select({ id: agents.id, adapterConfig: agents.adapterConfig })
          .from(agents)
          .where(eq(agents.companyId, companyId)),
        db
          .select({ id: companySkills.id, key: companySkills.key })
          .from(companySkills)
          .where(eq(companySkills.companyId, companyId)),
      ]);

      const skillByKey = new Map(skillRows.map((s) => [s.key, s.id]));

      const edges: Array<{ agentId: string; skillId: string }> = [];
      for (const agent of agentRows) {
        let desiredSkills: string[] = [];
        try {
          const pref = readPaperclipSkillSyncPreference(agent.adapterConfig ?? {});
          desiredSkills = pref.desiredSkills ?? [];
        } catch {
          // adapterConfig may not have skill preferences
        }
        for (const key of desiredSkills) {
          const skillId = skillByKey.get(key);
          if (skillId) edges.push({ agentId: agent.id, skillId });
        }
      }

      return edges;
    },

    // ── Entity/Edge CRUD (Phase 4: second brain) ──────────────────────────────

    listEntities: async (companyId: string): Promise<KnowledgeEntity[]> => {
      const rows = await db
        .select()
        .from(knowledgeEntities)
        .where(eq(knowledgeEntities.companyId, companyId))
        .orderBy(knowledgeEntities.createdAt);
      return rows.map(toEntity);
    },

    listEdges: async (companyId: string): Promise<KnowledgeEdge[]> => {
      const rows = await db
        .select()
        .from(knowledgeEdges)
        .where(eq(knowledgeEdges.companyId, companyId))
        .orderBy(knowledgeEdges.createdAt);
      return rows.map(toEdge);
    },

    ingestRun: async (companyId: string, runId: string): Promise<IngestRunResult> => {
      const run = await db
        .select()
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.companyId, companyId)))
        .then((rows) => rows[0] ?? null);

      if (!run) throw new Error("Run not found");

      const events = await db
        .select({ message: heartbeatRunEvents.message, eventType: heartbeatRunEvents.eventType })
        .from(heartbeatRunEvents)
        .where(and(eq(heartbeatRunEvents.runId, runId), eq(heartbeatRunEvents.companyId, companyId)))
        .orderBy(heartbeatRunEvents.seq)
        .limit(500);

      const corpus = [
        run.stdoutExcerpt ?? "",
        run.stderrExcerpt ?? "",
        run.error ?? "",
        events.map((e) => e.message ?? "").join("\n"),
      ]
        .filter(Boolean)
        .join("\n");

      if (!corpus.trim()) {
        return { entitiesCreated: 0, entitiesMerged: 0, edgesCreated: 0 };
      }

      const extracted = (await llmExtract(corpus)) ?? heuristicExtract(corpus);

      if (extracted.entities.length === 0) {
        return { entitiesCreated: 0, entitiesMerged: 0, edgesCreated: 0 };
      }

      const existingRows = await db
        .select({ id: knowledgeEntities.id, type: knowledgeEntities.type, label: knowledgeEntities.label })
        .from(knowledgeEntities)
        .where(eq(knowledgeEntities.companyId, companyId));

      const existingMap = new Map(
        existingRows.map((r) => [`${r.type}:${r.label.toLowerCase().trim()}`, r.id]),
      );

      let entitiesCreated = 0;
      let entitiesMerged = 0;
      const labelToId = new Map<string, string>();

      for (const ext of extracted.entities) {
        const key = `${ext.type}:${ext.label.toLowerCase().trim()}`;
        const existingId = existingMap.get(key);

        if (existingId) {
          labelToId.set(ext.label.toLowerCase(), existingId);
          entitiesMerged++;
        } else {
          const [inserted] = await db
            .insert(knowledgeEntities)
            .values({
              companyId,
              type: ext.type,
              label: ext.label,
              properties: ext.properties ?? {},
              sourceRunId: runId,
            })
            .returning({ id: knowledgeEntities.id });
          if (inserted) {
            labelToId.set(ext.label.toLowerCase(), inserted.id);
            existingMap.set(key, inserted.id);
            entitiesCreated++;
          }
        }
      }

      let edgesCreated = 0;
      for (const ext of extracted.edges) {
        const srcId = labelToId.get(ext.sourceLabel.toLowerCase());
        const tgtId = labelToId.get(ext.targetLabel.toLowerCase());
        if (!srcId || !tgtId || srcId === tgtId) continue;

        const existing = await db
          .select({ id: knowledgeEdges.id })
          .from(knowledgeEdges)
          .where(
            and(
              eq(knowledgeEdges.companyId, companyId),
              eq(knowledgeEdges.sourceEntityId, srcId),
              eq(knowledgeEdges.targetEntityId, tgtId),
              eq(knowledgeEdges.relationType, ext.relationType),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (!existing) {
          await db.insert(knowledgeEdges).values({
            companyId,
            sourceEntityId: srcId,
            targetEntityId: tgtId,
            relationType: ext.relationType,
            sourceRunId: runId,
          });
          edgesCreated++;
        }
      }

      if (entitiesCreated > 0 || edgesCreated > 0) {
        publishLiveEvent({
          companyId,
          type: "knowledge_graph.updated",
          payload: {
            runId,
            entitiesCreated,
            entitiesMerged,
            edgesCreated,
          },
        });
      }

      return { entitiesCreated, entitiesMerged, edgesCreated };
    },

    importMarkdown: async (
      companyId: string,
      files: Array<{ filename: string; content: string }>,
    ): Promise<ImportMarkdownResult> => {
      let totalCreated = 0;
      let totalMerged = 0;
      let totalEdges = 0;
      const errors: string[] = [];

      // Load existing entities once, update incrementally
      const existingRows = await db
        .select({ id: knowledgeEntities.id, type: knowledgeEntities.type, label: knowledgeEntities.label })
        .from(knowledgeEntities)
        .where(eq(knowledgeEntities.companyId, companyId));

      const existingMap = new Map(
        existingRows.map((r) => [`${r.type}:${r.label.toLowerCase().trim()}`, r.id]),
      );

      for (const file of files) {
        try {
          const corpus = file.content.trim();
          if (!corpus) continue;

          const extracted = (await llmExtract(corpus)) ?? heuristicExtract(corpus);
          if (extracted.entities.length === 0) continue;

          const labelToId = new Map<string, string>();

          for (const ext of extracted.entities) {
            const key = `${ext.type}:${ext.label.toLowerCase().trim()}`;
            const existingId = existingMap.get(key);

            if (existingId) {
              labelToId.set(ext.label.toLowerCase(), existingId);
              totalMerged++;
            } else {
              const [inserted] = await db
                .insert(knowledgeEntities)
                .values({
                  companyId,
                  type: ext.type,
                  label: ext.label,
                  properties: { ...(ext.properties ?? {}), sourceFile: file.filename },
                  sourceRunId: null,
                })
                .returning({ id: knowledgeEntities.id });
              if (inserted) {
                labelToId.set(ext.label.toLowerCase(), inserted.id);
                existingMap.set(key, inserted.id);
                totalCreated++;
              }
            }
          }

          for (const ext of extracted.edges) {
            const srcId = labelToId.get(ext.sourceLabel.toLowerCase());
            const tgtId = labelToId.get(ext.targetLabel.toLowerCase());
            if (!srcId || !tgtId || srcId === tgtId) continue;

            const existing = await db
              .select({ id: knowledgeEdges.id })
              .from(knowledgeEdges)
              .where(
                and(
                  eq(knowledgeEdges.companyId, companyId),
                  eq(knowledgeEdges.sourceEntityId, srcId),
                  eq(knowledgeEdges.targetEntityId, tgtId),
                  eq(knowledgeEdges.relationType, ext.relationType),
                ),
              )
              .limit(1)
              .then((rows) => rows[0] ?? null);

            if (!existing) {
              await db.insert(knowledgeEdges).values({
                companyId,
                sourceEntityId: srcId,
                targetEntityId: tgtId,
                relationType: ext.relationType,
                sourceRunId: null,
              });
              totalEdges++;
            }
          }
        } catch (err) {
          errors.push(`${file.filename}: ${err instanceof Error ? err.message : String(err)}`);
          logger.warn({ err, filename: file.filename }, "Failed to import markdown file");
        }
      }

      if (totalCreated > 0 || totalEdges > 0) {
        publishLiveEvent({
          companyId,
          type: "knowledge_graph.updated",
          payload: {
            entitiesCreated: totalCreated,
            entitiesMerged: totalMerged,
            edgesCreated: totalEdges,
            source: "markdown_import",
          },
        });
      }

      return {
        filesProcessed: files.length,
        entitiesCreated: totalCreated,
        entitiesMerged: totalMerged,
        edgesCreated: totalEdges,
        errors,
      };
    },

    deleteEntity: async (companyId: string, entityId: string): Promise<boolean> => {
      const result = await db
        .delete(knowledgeEntities)
        .where(and(eq(knowledgeEntities.id, entityId), eq(knowledgeEntities.companyId, companyId)))
        .returning({ id: knowledgeEntities.id });
      return result.length > 0;
    },

    clearAll: async (companyId: string): Promise<void> => {
      const entityIds = await db
        .select({ id: knowledgeEntities.id })
        .from(knowledgeEntities)
        .where(eq(knowledgeEntities.companyId, companyId))
        .then((rows) => rows.map((r) => r.id));

      if (entityIds.length > 0) {
        await db
          .delete(knowledgeEntities)
          .where(inArray(knowledgeEntities.id, entityIds));
      }
    },
  };
}
