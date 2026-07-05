import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { socialPosts } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";

export function influencerStudioRoutes(db: Db, _opts?: Record<string, never>) {
  const router = Router();

  // GET /companies/:companyId/influencer/drafts
  // Returns draft social posts created by the Influencer Studio (Image Studio).
  // Optional ?personaId query filters to drafts for a specific persona.
  router.get("/companies/:companyId/influencer/drafts", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const filters = [
      eq(socialPosts.companyId, companyId),
      eq(socialPosts.status, "draft"),
    ];

    const personaId = req.query.personaId as string | undefined;
    if (personaId && personaId.length > 0) {
      filters.push(sql`${socialPosts.metadata}->>'personaId' = ${personaId}`);
    }

    const drafts = await db
      .select()
      .from(socialPosts)
      .where(and(...filters))
      .orderBy(desc(socialPosts.createdAt));

    res.json({ drafts });
  });

  return router;
}
