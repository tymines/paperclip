import type { RequestHandler } from "express";
import { assertAuthenticated } from "../routes/authz.js";

/**
 * Require an authenticated Paperclip actor before serving instance uploads.
 *
 * Image elements still use ordinary same-origin GETs, so this deliberately
 * relies on actorMiddleware having resolved the browser session first.
 */
export function uploadsAuthenticationGuard(): RequestHandler {
  return (req, _res, next) => {
    assertAuthenticated(req);
    next();
  };
}
