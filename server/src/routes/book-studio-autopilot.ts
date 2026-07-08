import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { books } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound, conflict } from "../errors.js";
import { logActivity } from "../services/index.js";
import {
  startAutopilot,
  pauseAutopilot,
  resumeAutopilot,
  steerAutopilot,
  getAutopilotState,
} from "../services/autopilot-orchestrator.js";

export function bookStudioAutopilotRoutes(db: Db) {
  const router = Router();

  // GET /companies/:companyId/book-studio/books/:bookId/autopilot/status
  router.get(
    "/companies/:companyId/book-studio/books/:bookId/autopilot/status",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params;
        assertCompanyAccess(req, companyId);
        const state = getAutopilotState(bookId);
        if (!state) throw notFound("No autopilot loop found for this book");
        const { abortController: _, ...serializable } = state;
        res.json({ autopilot: serializable });
      } catch (err) { next(err); }
    },
  );

  // POST /companies/:companyId/book-studio/books/:bookId/autopilot/start
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/autopilot/start",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params;
        assertCompanyAccess(req, companyId);

        const book = await db
          .select({ id: books.id, title: books.title })
          .from(books)
          .where(eq(books.id, bookId))
          .then((r) => r[0]);
        if (!book) throw notFound("Book not found");

        const existing = getAutopilotState(bookId);
        if (existing && existing.status === "running") {
          throw conflict("Autopilot loop already running for this book");
        }

        const { budgetCents, iterationCapPerChapter } = req.body ?? {};
        const actor = getActorInfo(req);

        const state = startAutopilot(bookId, companyId, book.title, { budgetCents, iterationCapPerChapter }, db, actor);

        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "autopilot.started",
          entityType: "book",
          entityId: bookId,
          details: { budgetCents, iterationCapPerChapter },
        });

        const { abortController: _, ...serializable } = state;
        res.status(201).json({ autopilot: serializable });
      } catch (err) { next(err); }
    },
  );

  // POST /pause
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/autopilot/pause",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params;
        assertCompanyAccess(req, companyId);

        const state = getAutopilotState(bookId);
        if (!state) throw notFound("No autopilot loop found for this book");
        if (state.status !== "running") throw conflict("Autopilot is not running");

        const updated = pauseAutopilot(bookId);
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "autopilot.paused",
          entityType: "book",
          entityId: bookId,
          details: { spendCents: updated.spendCents },
        });

        const { abortController: _, ...serializable } = updated;
        res.json({ autopilot: serializable });
      } catch (err) { next(err); }
    },
  );

  // POST /resume
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/autopilot/resume",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params;
        assertCompanyAccess(req, companyId);

        const state = getAutopilotState(bookId);
        if (!state) throw notFound("No autopilot loop found for this book");
        if (state.status !== "paused") throw conflict("Autopilot is not paused");

        const { newBudgetCents } = req.body ?? {};
        const actor = getActorInfo(req);

        const updated = resumeAutopilot(bookId, newBudgetCents, db, actor);

        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "autopilot.resumed",
          entityType: "book",
          entityId: bookId,
          details: { newBudgetCents },
        });

        const { abortController: _, ...serializable } = updated;
        res.json({ autopilot: serializable });
      } catch (err) { next(err); }
    },
  );

  // POST /steer
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/autopilot/steer",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params;
        assertCompanyAccess(req, companyId);

        const { guidance } = req.body ?? {};
        if (!guidance || typeof guidance !== "string" || guidance.trim().length === 0) {
          throw badRequest("guidance is required");
        }

        const state = getAutopilotState(bookId);
        if (!state) throw notFound("No autopilot loop found for this book");

        const updated = steerAutopilot(bookId, guidance.trim());
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "autopilot.steered",
          entityType: "book",
          entityId: bookId,
          details: { guidance: guidance.trim() },
        });

        const { abortController: _, ...serializable } = updated;
        res.json({ autopilot: serializable });
      } catch (err) { next(err); }
    },
  );

  return router;
}
