import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, eq, or, isNull } from "drizzle-orm";
import { imageProviders } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";

export function imageStudioRoutes(db: Db) {
  const router = Router();

  // GET /api/companies/:companyId/image-studio/providers
  router.get("/companies/:companyId/image-studio/providers", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const providers = await db
      .select()
      .from(imageProviders)
      .where(
        and(
          or(
            eq(imageProviders.companyId, companyId),
            isNull(imageProviders.companyId),
          ),
        ),
      )
      .orderBy(imageProviders.sortOrder);

    res.json({ providers });
  });

  // POST /api/companies/:companyId/image-studio/providers
  router.post("/companies/:companyId/image-studio/providers", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const { name, type, providerKey, endpoint, model, defaultParams, costPerUnit, status, statusDetail } =
      req.body;

    const [inserted] = await db
      .insert(imageProviders)
      .values({
        companyId,
        name,
        type: type ?? "external_api",
        providerKey,
        endpoint,
        model,
        defaultParams: defaultParams ?? {},
        costPerUnit: costPerUnit ?? "0",
        status,
        statusDetail,
        sortOrder: 0,
      })
      .returning();

    res.status(201).json({ provider: inserted });
  });

  // PATCH /api/companies/:companyId/image-studio/providers/:providerId
  router.patch("/companies/:companyId/image-studio/providers/:providerId", async (req, res) => {
    const { companyId, providerId } = req.params;
    assertCompanyAccess(req, companyId);

    const { name, type, providerKey, endpoint, model, defaultParams, costPerUnit, status, statusDetail, sortOrder } =
      req.body;

    const [updated] = await db
      .update(imageProviders)
      .set({
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(providerKey !== undefined && { providerKey }),
        ...(endpoint !== undefined && { endpoint }),
        ...(model !== undefined && { model }),
        ...(defaultParams !== undefined && { defaultParams }),
        ...(costPerUnit !== undefined && { costPerUnit }),
        ...(status !== undefined && { status }),
        ...(statusDetail !== undefined && { statusDetail }),
        ...(sortOrder !== undefined && { sortOrder }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(imageProviders.id, providerId),
          eq(imageProviders.companyId, companyId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }

    res.json({ provider: updated });
  });

  // DELETE /api/companies/:companyId/image-studio/providers/:providerId
  router.delete("/companies/:companyId/image-studio/providers/:providerId", async (req, res) => {
    const { companyId, providerId } = req.params;
    assertCompanyAccess(req, companyId);

    const [deleted] = await db
      .delete(imageProviders)
      .where(
        and(
          eq(imageProviders.id, providerId),
          eq(imageProviders.companyId, companyId),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }

    res.json({ provider: deleted });
  });

  return router;
}
