import { Router } from "express";
import type { Db } from "@paperclipai/db";

/**
 * Legacy Story Bible compatibility router.
 *
 * Character and location CRUD is owned by the company/book-scoped routes in
 * book-studio.ts. The duplicate handlers previously declared here omitted
 * company/book authorization and could become reachable if route ordering
 * changed, so the compatibility router intentionally exposes no endpoints.
 */
export function storyBibleRoutes(_db: Db) {
  return Router();
}
