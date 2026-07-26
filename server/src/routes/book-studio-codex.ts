// Story Bible codex routes (Spec v1 §4.1) — migration 0160-gated.
//   GET/POST        .../codex/:entityType            — list / create
//   PATCH/DELETE    .../codex/:entityType/:id        — update / delete
//   GET/POST        .../codex-relationships          — list / create
//   PATCH/DELETE    .../codex-relationships/:id      — update / delete
//   GET             .../codex-facts?chapter=N        — spoiler-gated view
//   POST            .../codex-facts                  — create
//   PATCH/DELETE    .../codex-facts/:id              — update / delete
// §7 enforcement mirrors the bible routes: lock toggles are human-only; a
// locked entity/relationship/fact refuses AI edits + deletion (409 LOCKED).
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { bibleRelationships, bibleFacts } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound, serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { assertHumanActor, lockedError } from "../services/book-locks.js";
import {
  CODEX_ENTITY_TABLES,
  RELATIONSHIP_ENTITY_TYPES,
  isCodexEntityType,
  isMissingCodexTable,
  PENDING_0160,
  factsForChapter,
} from "../services/book-bible-codex.js";

export function bookStudioCodexRoutes(db: Db) {
  const router = Router();
  const BASE = "/companies/:companyId/book-studio/books/:bookId";

  const codex503 = () => serviceUnavailable(PENDING_0160);

  /** §7: human-only lock toggle; locked rows refuse AI edits/deletes. */
  function enforceCodexLocks(req: Parameters<typeof assertHumanActor>[0], existing: Record<string, unknown>, patch: Record<string, unknown>, label: string, verb: "edit" | "delete") {
    if (verb === "edit" && "locked" in patch) assertHumanActor(req);
    const actor = getActorInfo(req);
    if (existing.locked === true && actor.actorType !== "user" && !(verb === "edit" && "locked" in patch)) {
      throw lockedError("bible-entry", `${label} is locked — AI ${verb === "edit" ? "edits" : "deletion"} refused. A human must unlock it first.`);
    }
  }

  // ── Entity CRUD (8 codex types) ──────────────────────────────────────

  router.get(`${BASE}/codex/:entityType`, async (req, res, next) => {
    try {
      const { companyId, bookId, entityType } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      if (!isCodexEntityType(entityType)) throw badRequest(`Unknown codex entity type: ${entityType}`);
      try {
        const rows = await db.select().from(CODEX_ENTITY_TABLES[entityType])
          .where(eq(CODEX_ENTITY_TABLES[entityType].bookId, bookId));
        res.json({ available: true, entityType, entities: rows });
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        res.json({ available: false, pendingMigration: "0160", entityType, entities: [] });
      }
    } catch (err) { next(err); }
  });

  router.post(`${BASE}/codex/:entityType`, async (req, res, next) => {
    try {
      const { companyId, bookId, entityType } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      if (!isCodexEntityType(entityType)) throw badRequest(`Unknown codex entity type: ${entityType}`);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw badRequest("name is required");
      const values: Record<string, unknown> = {
        id: randomUUID(),
        bookId,
        name,
        summary: typeof body.summary === "string" ? body.summary : "",
        details: body.details && typeof body.details === "object" ? body.details : {},
        source: typeof body.source === "string" ? body.source : "authored",
      };
      // Type-specific extras (uniform columns only — validated per type).
      if (entityType === "timeline") {
        values.chapterNumber = typeof body.chapterNumber === "number" ? body.chapterNumber : null;
        values.orderIndex = typeof body.orderIndex === "number" ? body.orderIndex : 0;
      }
      if (entityType === "threads") {
        values.payoffState = ["open", "paid", "abandoned"].includes(String(body.payoffState)) ? body.payoffState : "open";
        values.payoffChapter = typeof body.payoffChapter === "number" ? body.payoffChapter : null;
      }
      if (entityType === "glossary") {
        values.term = typeof body.term === "string" ? body.term : name;
        values.definition = typeof body.definition === "string" ? body.definition : "";
      }
      try {
        const [row] = await db.insert(CODEX_ENTITY_TABLES[entityType]).values(values as never).returning();
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId, runId: actor.runId,
          action: `codex.${entityType}.created`, entityType: `bible_${entityType}`, entityId: (row as { id: string }).id,
          details: { bookId },
        }).catch(() => {});
        res.status(201).json({ available: true, entity: row });
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        throw codex503();
      }
    } catch (err) { next(err); }
  });

  router.patch(`${BASE}/codex/:entityType/:id`, async (req, res, next) => {
    try {
      const { companyId, bookId, entityType, id } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      if (!isCodexEntityType(entityType)) throw badRequest(`Unknown codex entity type: ${entityType}`);
      const table = CODEX_ENTITY_TABLES[entityType];
      const body = (req.body ?? {}) as Record<string, unknown>;
      const allowed = ["name", "summary", "details", "source", "locked", "chapterNumber", "orderIndex", "payoffState", "payoffChapter", "term", "definition"];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (k in body) patch[k] = body[k];
      if (Object.keys(patch).length === 0) throw badRequest("Nothing to update");
      try {
        const [existing] = await db.select().from(table).where(and(eq(table.id, id), eq(table.bookId, bookId)));
        if (!existing) throw notFound("Codex entry not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, patch, "This codex entry", "edit");
        patch.updatedAt = new Date();
        const [updated] = await db.update(table).set(patch as never).where(eq(table.id, id)).returning();
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId, runId: actor.runId,
          action: `codex.${entityType}.updated`, entityType: `bible_${entityType}`, entityId: id,
          details: { bookId, fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
        }).catch(() => {});
        res.json({ available: true, entity: updated });
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        throw codex503();
      }
    } catch (err) { next(err); }
  });

  router.delete(`${BASE}/codex/:entityType/:id`, async (req, res, next) => {
    try {
      const { companyId, bookId, entityType, id } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      if (!isCodexEntityType(entityType)) throw badRequest(`Unknown codex entity type: ${entityType}`);
      const table = CODEX_ENTITY_TABLES[entityType];
      try {
        const [existing] = await db.select().from(table).where(and(eq(table.id, id), eq(table.bookId, bookId)));
        if (!existing) throw notFound("Codex entry not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, {}, "This codex entry", "delete");
        await db.delete(table).where(eq(table.id, id));
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId, runId: actor.runId,
          action: `codex.${entityType}.deleted`, entityType: `bible_${entityType}`, entityId: id,
          details: { bookId },
        }).catch(() => {});
        res.status(204).send();
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        throw codex503();
      }
    } catch (err) { next(err); }
  });

  // ── Relationships (② typed, metered, rules as gate constraints) ──────

  router.get(`${BASE}/codex-relationships`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      try {
        const rows = await db.select().from(bibleRelationships).where(eq(bibleRelationships.bookId, bookId));
        res.json({ available: true, relationships: rows });
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        res.json({ available: false, pendingMigration: "0160", relationships: [] });
      }
    } catch (err) { next(err); }
  });

  const validateRelBody = (body: Record<string, unknown>, partial: boolean) => {
    const errs: string[] = [];
    const need = (k: string) => !partial || k in body;
    for (const k of ["fromEntityType", "toEntityType"] as const) {
      if (need(k) && !RELATIONSHIP_ENTITY_TYPES.includes(String(body[k]) as never)) errs.push(`${k} must be one of ${RELATIONSHIP_ENTITY_TYPES.join("/")}`);
    }
    for (const k of ["fromEntityId", "toEntityId"] as const) {
      if (need(k) && typeof body[k] !== "string") errs.push(`${k} is required`);
    }
    if ("meter" in body && (typeof body.meter !== "number" || body.meter < -100 || body.meter > 100)) errs.push("meter must be −100…+100");
    if ("rules" in body && !Array.isArray(body.rules)) errs.push("rules must be an array of strings");
    return errs;
  };

  router.post(`${BASE}/codex-relationships`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const errs = validateRelBody(body, false);
      if (errs.length) throw badRequest(errs.join("; "));
      try {
        const [row] = await db.insert(bibleRelationships).values({
          id: randomUUID(),
          bookId,
          fromEntityType: String(body.fromEntityType),
          fromEntityId: String(body.fromEntityId),
          toEntityType: String(body.toEntityType),
          toEntityId: String(body.toEntityId),
          type: typeof body.type === "string" ? body.type : "",
          arcStage: typeof body.arcStage === "string" ? body.arcStage : "",
          meter: typeof body.meter === "number" ? body.meter : 0,
          rules: Array.isArray(body.rules) ? body.rules.map(String) : [],
          source: typeof body.source === "string" ? body.source : "authored",
        }).returning();
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId, runId: actor.runId,
          action: "codex.relationship.created", entityType: "bible_relationship", entityId: row.id,
          details: { bookId, from: `${body.fromEntityType}:${body.fromEntityId}`, to: `${body.toEntityType}:${body.toEntityId}` },
        }).catch(() => {});
        res.status(201).json({ available: true, relationship: row });
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        throw codex503();
      }
    } catch (err) { next(err); }
  });

  router.patch(`${BASE}/codex-relationships/:id`, async (req, res, next) => {
    try {
      const { companyId, bookId, id } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const errs = validateRelBody(body, true);
      if (errs.length) throw badRequest(errs.join("; "));
      const allowed = ["fromEntityType", "fromEntityId", "toEntityType", "toEntityId", "type", "arcStage", "meter", "rules", "locked"];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (k in body) patch[k] = body[k];
      if (Object.keys(patch).length === 0) throw badRequest("Nothing to update");
      try {
        const [existing] = await db.select().from(bibleRelationships)
          .where(and(eq(bibleRelationships.id, id), eq(bibleRelationships.bookId, bookId)));
        if (!existing) throw notFound("Relationship not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, patch, "This relationship", "edit");
        patch.updatedAt = new Date();
        const [updated] = await db.update(bibleRelationships).set(patch as never).where(eq(bibleRelationships.id, id)).returning();
        res.json({ available: true, relationship: updated });
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        throw codex503();
      }
    } catch (err) { next(err); }
  });

  router.delete(`${BASE}/codex-relationships/:id`, async (req, res, next) => {
    try {
      const { companyId, bookId, id } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      try {
        const [existing] = await db.select().from(bibleRelationships)
          .where(and(eq(bibleRelationships.id, id), eq(bibleRelationships.bookId, bookId)));
        if (!existing) throw notFound("Relationship not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, {}, "This relationship", "delete");
        await db.delete(bibleRelationships).where(eq(bibleRelationships.id, id));
        res.status(204).send();
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        throw codex503();
      }
    } catch (err) { next(err); }
  });

  // ── Facts (③ atomic records · ④ spoiler gating) ──────────────────────

  // ④ The audit view: what the writer may see for chapter N vs what is
  // withheld (author-only). The Context view renders withheld chips from this.
  router.get(`${BASE}/codex-facts`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      const chapter = Number(req.query.chapter);
      if (!Number.isFinite(chapter) || chapter < 1) throw badRequest("?chapter=N (1-based) is required — facts are spoiler-gated per chapter");
      const { known, withheld } = await factsForChapter(db, bookId, chapter);
      res.json({
        available: true,
        chapter,
        known,
        // Withheld facts are metadata-only here (id + reveal chapter + entity
        // refs) — the statement itself is author-only until reveal. Baily's
        // own UI can fetch the full row by id when she audits.
        withheld: withheld.map((f) => ({ id: f.id, knownAsOf: f.knownAsOf, entityRefs: f.entityRefs, provenance: f.provenance, locked: f.locked })),
      });
    } catch (err) { next(err); }
  });

  router.post(`${BASE}/codex-facts`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const statement = typeof body.statement === "string" ? body.statement.trim() : "";
      if (!statement) throw badRequest("statement is required — a fact is an atomic record, not a prose blob");
      const knownAsOf = Number(body.knownAsOf);
      if (!Number.isInteger(knownAsOf) || knownAsOf < 1) throw badRequest("knownAsOf (chapter, ≥1) is required — spoiler gating is mandatory");
      try {
        const [row] = await db.insert(bibleFacts).values({
          id: randomUUID(),
          bookId,
          statement,
          entityRefs: Array.isArray(body.entityRefs) ? body.entityRefs : [],
          knownAsOf,
          sourceChapter: typeof body.sourceChapter === "number" ? body.sourceChapter : null,
          sourceScene: typeof body.sourceScene === "string" ? body.sourceScene : "",
          provenance: ["authored", "co-created", "auto-extracted"].includes(String(body.provenance)) ? String(body.provenance) : "authored",
        }).returning();
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId, runId: actor.runId,
          action: "codex.fact.created", entityType: "bible_fact", entityId: row.id,
          details: { bookId, knownAsOf, provenance: row.provenance },
        }).catch(() => {});
        res.status(201).json({ available: true, fact: row });
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        throw codex503();
      }
    } catch (err) { next(err); }
  });

  router.patch(`${BASE}/codex-facts/:id`, async (req, res, next) => {
    try {
      const { companyId, bookId, id } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const allowed = ["statement", "entityRefs", "knownAsOf", "sourceChapter", "sourceScene", "provenance", "locked"];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (k in body) patch[k] = body[k];
      if (Object.keys(patch).length === 0) throw badRequest("Nothing to update");
      try {
        const [existing] = await db.select().from(bibleFacts)
          .where(and(eq(bibleFacts.id, id), eq(bibleFacts.bookId, bookId)));
        if (!existing) throw notFound("Fact not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, patch, "This fact", "edit");
        patch.updatedAt = new Date();
        const [updated] = await db.update(bibleFacts).set(patch as never).where(eq(bibleFacts.id, id)).returning();
        res.json({ available: true, fact: updated });
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        throw codex503();
      }
    } catch (err) { next(err); }
  });

  router.delete(`${BASE}/codex-facts/:id`, async (req, res, next) => {
    try {
      const { companyId, bookId, id } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      try {
        const [existing] = await db.select().from(bibleFacts)
          .where(and(eq(bibleFacts.id, id), eq(bibleFacts.bookId, bookId)));
        if (!existing) throw notFound("Fact not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, {}, "This fact", "delete");
        await db.delete(bibleFacts).where(eq(bibleFacts.id, id));
        res.status(204).send();
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        throw codex503();
      }
    } catch (err) { next(err); }
  });

  return router;
}
