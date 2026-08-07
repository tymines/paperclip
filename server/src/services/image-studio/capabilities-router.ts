import { Router } from "express";
import { assertCompanyAccess } from "../../routes/authz.js";
import type { ImageProvider } from "../image-providers/types.js";
import { buildImageStudioCapabilityCatalog } from "./capabilities.js";

export function imageStudioCapabilitiesRouter(providers: ImageProvider[]) {
  const router = Router();

  // Normalized, company-authorized generation truth. The response omits raw
  // provider errors, account details, balances, and credential material.
  router.get("/companies/:companyId/image-studio/capabilities", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await buildImageStudioCapabilityCatalog(providers));
  });

  return router;
}
