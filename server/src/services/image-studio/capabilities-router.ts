import { Router } from "express";
import { assertCompanyAccess } from "../../routes/authz.js";
import type { ImageProvider } from "../image-providers/types.js";
import {
  CREATOR_OS_GENERATION_WORKER_UNAVAILABLE_REASON,
  type CreatorGenerationWorkerReadiness,
} from "@paperclipai/shared";
import {
  buildImageStudioCapabilityCatalog,
  type CapabilityPersonaContext,
} from "./capabilities.js";

export interface ImageStudioCapabilitiesRouterOptions {
  loadPersona: (
    companyId: string,
    personaId: string,
  ) => Promise<CapabilityPersonaContext | null>;
  inspectionDeadlineMs?: number;
  generationWorkerReadiness?: CreatorGenerationWorkerReadiness;
}

export function imageStudioCapabilitiesRouter(
  providers: ImageProvider[],
  options: ImageStudioCapabilitiesRouterOptions,
) {
  const router = Router();

  // Normalized, company-authorized generation truth. The response omits raw
  // provider errors, account details, balances, and credential material.
  router.get("/companies/:companyId/image-studio/capabilities", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const personaId = typeof req.query.personaId === "string" ? req.query.personaId.trim() : "";
    if (!personaId) {
      res.status(400).json({ error: "personaId is required" });
      return;
    }
    const persona = await options.loadPersona(companyId, personaId);
    if (!persona) {
      res.status(404).json({ error: "Persona not found" });
      return;
    }
    const catalog = await buildImageStudioCapabilityCatalog(providers, persona, new Date(), {
        inspectionDeadlineMs: options.inspectionDeadlineMs,
      });
    res.json({
      ...catalog,
      generationWorker: options.generationWorkerReadiness ?? {
        enabled: false,
        disabledReason: CREATOR_OS_GENERATION_WORKER_UNAVAILABLE_REASON,
      },
    });
  });

  return router;
}
