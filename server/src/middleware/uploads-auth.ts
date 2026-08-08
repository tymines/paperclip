import type { RequestHandler } from "express";
import { assertAuthenticated } from "../routes/authz.js";

/**
 * Require an authenticated Paperclip actor before serving instance uploads.
 *
 * Image elements still use ordinary same-origin GETs, so this deliberately
 * relies on actorMiddleware having resolved the browser session first.
 */
export function uploadsAuthenticationGuard(): RequestHandler {
  return (req, res, next) => {
    assertAuthenticated(req);
    // Authenticated media must never enter a shared CDN or reverse-proxy cache.
    // Keep a short private browser cache for gallery performance.
    res.setHeader("Cache-Control", "private, max-age=3600");
    next();
  };
}
