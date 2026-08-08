import type { NextFunction, Request, Response } from "express";
import { assertAuthenticated } from "../../routes/authz.js";

export function requireImageStudioAuthentication(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  assertAuthenticated(req);
  next();
}
