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
import { bibleRelationships, bibleFacts, storyBibleCharacters, storyBibleWorldLocations, books } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../errors.js";
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

  async function requireCompanyBook(companyId: string, bookId: string) {
    const [book] = await db.select({ id: books.id }).from(books)
      .where(and(eq(books.id, bookId), eq(books.companyId, companyId))).limit(1);
    if (!book) throw notFound("Book not found");
  }

  function expectedRevision(body: Record<string, unknown>): number {
    if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
      throw badRequest("expectedRevision must be a positive integer");
    }
    return Number(body.expectedRevision);
  }

  function rejectUnsupported(body: Record<string, unknown>, allowed: readonly string[]) {
    const unsupported = Object.keys(body).filter((key) => !allowed.includes(key));
    if (unsupported.length > 0) throw badRequest(`Unsupported fields: ${unsupported.join(", ")}`);
  }

  function validateEntityPatch(entityType: string, body: Record<string, unknown>) {
    const common = ["name", "summary", "details", "locked", "expectedRevision"];
    const specific = entityType === "timeline" ? ["chapterNumber"]
      : entityType === "threads" ? ["payoffState", "payoffChapter"]
        : entityType === "glossary" ? ["term", "definition"] : [];
    rejectUnsupported(body, [...common, ...specific]);
    if ("name" in body && (typeof body.name !== "string" || !body.name.trim())) throw badRequest("name cannot be empty");
    if ("summary" in body && typeof body.summary !== "string") throw badRequest("summary must be a string");
    if ("details" in body && (!body.details || typeof body.details !== "object" || Array.isArray(body.details))) throw badRequest("details must be an object");
    if ("locked" in body && typeof body.locked !== "boolean") throw badRequest("locked must be a boolean");
    if ("chapterNumber" in body && body.chapterNumber !== null && (!Number.isInteger(body.chapterNumber) || Number(body.chapterNumber) < 1)) throw badRequest("chapterNumber must be an integer greater than or equal to 1");
    if ("payoffState" in body && !["open", "paid", "abandoned"].includes(String(body.payoffState))) throw badRequest("payoffState must be open, paid, or abandoned");
    if ("payoffChapter" in body && body.payoffChapter !== null && (!Number.isInteger(body.payoffChapter) || Number(body.payoffChapter) < 1)) throw badRequest("payoffChapter must be an integer greater than or equal to 1");
    if ("term" in body && (typeof body.term !== "string" || !body.term.trim())) throw badRequest("term cannot be empty");
    if ("definition" in body && typeof body.definition !== "string") throw badRequest("definition must be a string");
  }

  function validateEntityRefs(value: unknown): { entityType: string; entityId: string }[] {
    if (!Array.isArray(value)) throw badRequest("entityRefs must be an array");
    const refs = value as Array<Record<string, unknown>>;
    if (refs.some((ref) => !ref || typeof ref !== "object" || Array.isArray(ref)
      || !RELATIONSHIP_ENTITY_TYPES.includes(String(ref.entityType) as never)
      || typeof ref.entityId !== "string" || !ref.entityId.trim()
      || Object.keys(ref).some((key) => key !== "entityType" && key !== "entityId"))) {
      throw badRequest("entityRefs must contain only { entityType, entityId } references");
    }
    return refs.map((ref) => ({ entityType: String(ref.entityType), entityId: String(ref.entityId) }));
  }

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
      await requireCompanyBook(companyId, bookId);
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
      await requireCompanyBook(companyId, bookId);
      if (!isCodexEntityType(entityType)) throw badRequest(`Unknown codex entity type: ${entityType}`);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const createFields = ["name", "summary", "details", "source",
        ...(entityType === "timeline" ? ["chapterNumber", "orderIndex"] : []),
        ...(entityType === "threads" ? ["payoffState", "payoffChapter"] : []),
        ...(entityType === "glossary" ? ["term", "definition"] : [])];
      rejectUnsupported(body, createFields);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw badRequest("name is required");
      if ("summary" in body && typeof body.summary !== "string") throw badRequest("summary must be a string");
      if ("details" in body && (!body.details || typeof body.details !== "object" || Array.isArray(body.details))) throw badRequest("details must be an object");
      if ("source" in body && !["authored", "co-created", "imported", "auto-extracted"].includes(String(body.source))) throw badRequest("source is invalid");
      if (entityType === "timeline") {
        if ("chapterNumber" in body && body.chapterNumber !== null && (!Number.isInteger(body.chapterNumber) || Number(body.chapterNumber) < 1)) throw badRequest("chapterNumber must be an integer greater than or equal to 1");
        if ("orderIndex" in body && !Number.isInteger(body.orderIndex)) throw badRequest("orderIndex must be an integer");
      }
      if (entityType === "threads") {
        if ("payoffState" in body && !["open", "paid", "abandoned"].includes(String(body.payoffState))) throw badRequest("payoffState must be open, paid, or abandoned");
        if ("payoffChapter" in body && body.payoffChapter !== null && (!Number.isInteger(body.payoffChapter) || Number(body.payoffChapter) < 1)) throw badRequest("payoffChapter must be an integer greater than or equal to 1");
      }
      if (entityType === "glossary") {
        if ("term" in body && (typeof body.term !== "string" || !body.term.trim())) throw badRequest("term cannot be empty");
        if ("definition" in body && typeof body.definition !== "string") throw badRequest("definition must be a string");
      }
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
      await requireCompanyBook(companyId, bookId);
      if (!isCodexEntityType(entityType)) throw badRequest(`Unknown codex entity type: ${entityType}`);
      const table = CODEX_ENTITY_TABLES[entityType];
      const body = (req.body ?? {}) as Record<string, unknown>;
      validateEntityPatch(entityType, body);
      const expected = expectedRevision(body);
      const allowed = ["name", "summary", "details", "locked", "chapterNumber", "payoffState", "payoffChapter", "term", "definition"];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (k in body) patch[k] = body[k];
      if (Object.keys(patch).length === 0) throw badRequest("Nothing to update");
      try {
        const [existing] = await db.select().from(table).where(and(eq(table.id, id), eq(table.bookId, bookId)));
        if (!existing) throw notFound("Codex entry not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, patch, "This codex entry", "edit");
        patch.updatedAt = new Date();
        // Atomic for AI actors: the lock predicate rides on the UPDATE.
        const actor = getActorInfo(req);
        const [updated] = actor.actorType !== "user" && !("locked" in patch)
          ? await db.update(table).set(patch as never).where(and(eq(table.id, id), eq(table.bookId, bookId), eq(table.revision, expected), eq(table.locked, false))).returning()
          : await db.update(table).set(patch as never).where(and(eq(table.id, id), eq(table.bookId, bookId), eq(table.revision, expected))).returning();
        if (!updated) {
          if (actor.actorType !== "user") {
            const [current] = await db.select().from(table).where(and(eq(table.id, id), eq(table.bookId, bookId)));
            if ((current as Record<string, unknown> | undefined)?.locked === true) throw lockedError("bible-entry", "This codex entry was locked while editing — nothing was saved.");
          }
          throw conflict("This codex entry changed after editing began; reload it before saving.");
        }
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
      await requireCompanyBook(companyId, bookId);
      if (!isCodexEntityType(entityType)) throw badRequest(`Unknown codex entity type: ${entityType}`);
      const table = CODEX_ENTITY_TABLES[entityType];
      try {
        const [existing] = await db.select().from(table).where(and(eq(table.id, id), eq(table.bookId, bookId)));
        if (!existing) throw notFound("Codex entry not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, {}, "This codex entry", "delete");
        // Atomic for AI actors: lock predicate rides on the DELETE.
        const delActor = getActorInfo(req);
        if (delActor.actorType !== "user") {
          const deleted = await db.delete(table).where(and(eq(table.id, id), eq(table.bookId, bookId), eq(table.locked, false))).returning({ id: table.id });
          if (deleted.length === 0) throw lockedError("bible-entry", "This codex entry was locked while deleting — nothing was removed.");
        } else {
          await db.delete(table).where(and(eq(table.id, id), eq(table.bookId, bookId)));
        }
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
      await requireCompanyBook(companyId, bookId);
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
    for (const k of ["type", "arcStage"] as const) {
      if (k in body && typeof body[k] !== "string") errs.push(`${k} must be a string`);
    }
    if ("meter" in body && (typeof body.meter !== "number" || body.meter < -100 || body.meter > 100)) errs.push("meter must be −100…+100");
    if ("rules" in body && (!Array.isArray(body.rules) || body.rules.some((rule) => typeof rule !== "string"))) errs.push("rules must be an array of strings");
    if ("source" in body && (typeof body.source !== "string" || !["authored", "co-created", "imported", "auto-extracted"].includes(body.source))) errs.push("source is invalid");
    return errs;
  };

  async function relationshipEntityExists(entityType: string, entityId: string, bookId: string): Promise<boolean> {
    if (entityType === "character") {
      const rows = await db.select({ id: storyBibleCharacters.id }).from(storyBibleCharacters)
        .where(and(eq(storyBibleCharacters.id, entityId), eq(storyBibleCharacters.bookId, bookId)));
      return rows.some((row) => row.id === entityId);
    }
    if (entityType === "location") {
      const rows = await db.select({ id: storyBibleWorldLocations.id }).from(storyBibleWorldLocations)
        .where(and(eq(storyBibleWorldLocations.id, entityId), eq(storyBibleWorldLocations.bookId, bookId)));
      return rows.some((row) => row.id === entityId);
    }
    if (!isCodexEntityType(entityType)) return false;
    const table = CODEX_ENTITY_TABLES[entityType];
    const rows = await db.select({ id: table.id }).from(table)
      .where(and(eq(table.id, entityId), eq(table.bookId, bookId)));
    return rows.some((row) => row.id === entityId);
  }

  function assertDistinctRelationshipEndpoints(fromEntityType: string, fromEntityId: string, toEntityType: string, toEntityId: string) {
    if (fromEntityType === toEntityType && fromEntityId === toEntityId) {
      throw badRequest("Relationship endpoints must reference different entities");
    }
  }

  router.post(`${BASE}/codex-relationships`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      await requireCompanyBook(companyId, bookId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      rejectUnsupported(body, ["fromEntityType", "fromEntityId", "toEntityType", "toEntityId", "type", "arcStage", "meter", "rules", "source"]);
      const errs = validateRelBody(body, false);
      if (errs.length) throw badRequest(errs.join("; "));
      assertDistinctRelationshipEndpoints(
        String(body.fromEntityType),
        String(body.fromEntityId),
        String(body.toEntityType),
        String(body.toEntityId),
      );
      try {
        const [fromExists, toExists] = await Promise.all([
          relationshipEntityExists(String(body.fromEntityType), String(body.fromEntityId), bookId),
          relationshipEntityExists(String(body.toEntityType), String(body.toEntityId), bookId),
        ]);
        if (!fromExists || !toExists) throw badRequest("Relationship endpoints must reference existing entities in this book");
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
      await requireCompanyBook(companyId, bookId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      rejectUnsupported(body, ["fromEntityType", "fromEntityId", "toEntityType", "toEntityId", "type", "arcStage", "meter", "rules", "locked", "expectedRevision"]);
      const errs = validateRelBody(body, true);
      if (errs.length) throw badRequest(errs.join("; "));
      const expected = expectedRevision(body);
      const allowed = ["fromEntityType", "fromEntityId", "toEntityType", "toEntityId", "type", "arcStage", "meter", "rules", "locked"];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (k in body) patch[k] = body[k];
      if (Object.keys(patch).length === 0) throw badRequest("Nothing to update");
      try {
        const [existing] = await db.select().from(bibleRelationships)
          .where(and(eq(bibleRelationships.id, id), eq(bibleRelationships.bookId, bookId)));
        if (!existing) throw notFound("Relationship not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, patch, "This relationship", "edit");
        const fromEntityType = String(patch.fromEntityType ?? existing.fromEntityType);
        const fromEntityId = String(patch.fromEntityId ?? existing.fromEntityId);
        const toEntityType = String(patch.toEntityType ?? existing.toEntityType);
        const toEntityId = String(patch.toEntityId ?? existing.toEntityId);
        assertDistinctRelationshipEndpoints(fromEntityType, fromEntityId, toEntityType, toEntityId);
        if ("fromEntityType" in patch || "fromEntityId" in patch || "toEntityType" in patch || "toEntityId" in patch) {
          const [fromExists, toExists] = await Promise.all([
            relationshipEntityExists(fromEntityType, fromEntityId, bookId),
            relationshipEntityExists(toEntityType, toEntityId, bookId),
          ]);
          if (!fromExists || !toExists) throw badRequest("Relationship endpoints must reference existing entities in this book");
        }
        patch.updatedAt = new Date();
        const relActor = getActorInfo(req);
        const [updated] = relActor.actorType !== "user" && !("locked" in patch)
          ? await db.update(bibleRelationships).set(patch as never).where(and(eq(bibleRelationships.id, id), eq(bibleRelationships.bookId, bookId), eq(bibleRelationships.revision, expected), eq(bibleRelationships.locked, false))).returning()
          : await db.update(bibleRelationships).set(patch as never).where(and(eq(bibleRelationships.id, id), eq(bibleRelationships.bookId, bookId), eq(bibleRelationships.revision, expected))).returning();
        if (!updated) {
          if (relActor.actorType !== "user") {
            const [current] = await db.select().from(bibleRelationships).where(and(eq(bibleRelationships.id, id), eq(bibleRelationships.bookId, bookId)));
            if (current?.locked === true) throw lockedError("bible-entry", "This relationship was locked while editing — nothing was saved.");
          }
          throw conflict("This relationship changed after editing began; reload it before saving.");
        }
        await logActivity(db, {
          companyId, actorType: relActor.actorType, actorId: relActor.actorId, agentId: relActor.agentId, runId: relActor.runId,
          action: "codex.relationship.updated", entityType: "bible_relationship", entityId: id,
          details: { bookId, fields: Object.keys(patch).filter((key) => key !== "updatedAt") },
        }).catch(() => {});
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
      await requireCompanyBook(companyId, bookId);
      try {
        const [existing] = await db.select().from(bibleRelationships)
          .where(and(eq(bibleRelationships.id, id), eq(bibleRelationships.bookId, bookId)));
        if (!existing) throw notFound("Relationship not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, {}, "This relationship", "delete");
        const relDelActor = getActorInfo(req);
        if (relDelActor.actorType !== "user") {
          const deleted = await db.delete(bibleRelationships).where(and(eq(bibleRelationships.id, id), eq(bibleRelationships.bookId, bookId), eq(bibleRelationships.locked, false))).returning({ id: bibleRelationships.id });
          if (deleted.length === 0) throw lockedError("bible-entry", "This relationship was locked while deleting — nothing was removed.");
        } else {
          await db.delete(bibleRelationships).where(and(eq(bibleRelationships.id, id), eq(bibleRelationships.bookId, bookId)));
        }
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
      await requireCompanyBook(companyId, bookId);
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
      await requireCompanyBook(companyId, bookId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      rejectUnsupported(body, ["statement", "entityRefs", "knownAsOf", "sourceChapter", "sourceScene", "provenance"]);
      const statement = typeof body.statement === "string" ? body.statement.trim() : "";
      if (!statement) throw badRequest("statement is required — a fact is an atomic record, not a prose blob");
      const knownAsOf = Number(body.knownAsOf);
      if (!Number.isInteger(knownAsOf) || knownAsOf < 1) throw badRequest("knownAsOf (chapter, ≥1) is required — spoiler gating is mandatory");
      if ("sourceChapter" in body && body.sourceChapter !== null && (!Number.isInteger(body.sourceChapter) || Number(body.sourceChapter) < 1)) throw badRequest("sourceChapter must be an integer greater than or equal to 1");
      if ("sourceScene" in body && typeof body.sourceScene !== "string") throw badRequest("sourceScene must be a string");
      if ("provenance" in body && !["authored", "co-created", "auto-extracted"].includes(String(body.provenance))) throw badRequest("provenance is invalid");
      try {
        const [row] = await db.insert(bibleFacts).values({
          id: randomUUID(),
          bookId,
          statement,
          entityRefs: body.entityRefs === undefined ? [] : validateEntityRefs(body.entityRefs),
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

  // Board-human-only full fact read for editing. Writer-facing lists above
  // remain spoiler-gated and never include withheld statements.
  router.get(`${BASE}/codex-facts/:id`, async (req, res, next) => {
    try {
      const { companyId, bookId, id } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      assertHumanActor(req);
      await requireCompanyBook(companyId, bookId);
      const [fact] = await db.select().from(bibleFacts)
        .where(and(eq(bibleFacts.id, id), eq(bibleFacts.bookId, bookId)));
      if (!fact) throw notFound("Fact not found");
      res.json({ available: true, fact });
    } catch (err) { next(err); }
  });

  router.patch(`${BASE}/codex-facts/:id`, async (req, res, next) => {
    try {
      const { companyId, bookId, id } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      assertHumanActor(req);
      await requireCompanyBook(companyId, bookId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      rejectUnsupported(body, ["statement", "entityRefs", "knownAsOf", "sourceChapter", "sourceScene", "locked", "expectedRevision"]);
      const expected = expectedRevision(body);
      if ("statement" in body && (typeof body.statement !== "string" || !body.statement.trim())) throw badRequest("statement is required — a fact is an atomic record, not a prose blob");
      if ("knownAsOf" in body && (!Number.isInteger(body.knownAsOf) || Number(body.knownAsOf) < 1)) throw badRequest("knownAsOf must be an integer greater than or equal to 1");
      if ("sourceChapter" in body && body.sourceChapter !== null && (!Number.isInteger(body.sourceChapter) || Number(body.sourceChapter) < 1)) throw badRequest("sourceChapter must be an integer greater than or equal to 1");
      if ("sourceScene" in body && typeof body.sourceScene !== "string") throw badRequest("sourceScene must be a string");
      if ("locked" in body && typeof body.locked !== "boolean") throw badRequest("locked must be a boolean");
      if ("entityRefs" in body) body.entityRefs = validateEntityRefs(body.entityRefs);
      const allowed = ["statement", "entityRefs", "knownAsOf", "sourceChapter", "sourceScene", "locked"];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (k in body) patch[k] = body[k];
      if (Object.keys(patch).length === 0) throw badRequest("Nothing to update");
      try {
        const [existing] = await db.select().from(bibleFacts)
          .where(and(eq(bibleFacts.id, id), eq(bibleFacts.bookId, bookId)));
        if (!existing) throw notFound("Fact not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, patch, "This fact", "edit");
        patch.updatedAt = new Date();
        const factActor = getActorInfo(req);
        const [updated] = factActor.actorType !== "user" && !("locked" in patch)
          ? await db.update(bibleFacts).set(patch as never).where(and(eq(bibleFacts.id, id), eq(bibleFacts.bookId, bookId), eq(bibleFacts.revision, expected), eq(bibleFacts.locked, false))).returning()
          : await db.update(bibleFacts).set(patch as never).where(and(eq(bibleFacts.id, id), eq(bibleFacts.bookId, bookId), eq(bibleFacts.revision, expected))).returning();
        if (!updated) {
          if (factActor.actorType !== "user") {
            const [current] = await db.select().from(bibleFacts).where(and(eq(bibleFacts.id, id), eq(bibleFacts.bookId, bookId)));
            if (current?.locked === true) throw lockedError("bible-entry", "This fact was locked while editing — nothing was saved.");
          }
          throw conflict("This fact changed after editing began; reload it before saving.");
        }
        await logActivity(db, {
          companyId, actorType: factActor.actorType, actorId: factActor.actorId, agentId: factActor.agentId, runId: factActor.runId,
          action: "codex.fact.updated", entityType: "bible_fact", entityId: id,
          details: { bookId, fields: Object.keys(patch).filter((key) => key !== "updatedAt") },
        }).catch(() => {});
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
      await requireCompanyBook(companyId, bookId);
      try {
        const [existing] = await db.select().from(bibleFacts)
          .where(and(eq(bibleFacts.id, id), eq(bibleFacts.bookId, bookId)));
        if (!existing) throw notFound("Fact not found");
        enforceCodexLocks(req, existing as Record<string, unknown>, {}, "This fact", "delete");
        const factDelActor = getActorInfo(req);
        if (factDelActor.actorType !== "user") {
          const deleted = await db.delete(bibleFacts).where(and(eq(bibleFacts.id, id), eq(bibleFacts.bookId, bookId), eq(bibleFacts.locked, false))).returning({ id: bibleFacts.id });
          if (deleted.length === 0) throw lockedError("bible-entry", "This fact was locked while deleting — nothing was removed.");
        } else {
          await db.delete(bibleFacts).where(and(eq(bibleFacts.id, id), eq(bibleFacts.bookId, bookId)));
        }
        res.status(204).send();
      } catch (err) {
        if (!isMissingCodexTable(err)) throw err;
        throw codex503();
      }
    } catch (err) { next(err); }
  });

  // ── Context packet audit (§2 "what the writer saw") ──────────────────
  // Returns the compiled packet METADATA for chapter N: consulted entities,
  // the facts that entered (usedFacts) and the withheld facts as author-only
  // audit metadata. Read-only; never triggers generation.
  router.get(`${BASE}/chapters/:chapterNumber/context-packet`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      await requireCompanyBook(companyId, bookId);
      const chapterNumber = Number(req.params.chapterNumber);
      if (!Number.isFinite(chapterNumber) || chapterNumber < 1) throw badRequest("Invalid chapter number");
      const { compileChapterContext } = await import("../services/book-context-compiler.js");
      const ctx = await compileChapterContext(db, bookId, chapterNumber);
      res.json({
        chapterNumber,
        usedCharacters: ctx.usedCharacters,
        usedLocations: ctx.usedLocations,
        hasStyle: ctx.hasStyle,
        hasBeat: ctx.hasBeat,
        usedFacts: ctx.usedFacts,
        withheldFacts: ctx.withheldFacts,
      });
    } catch (err) { next(err); }
  });

  return router;
}
