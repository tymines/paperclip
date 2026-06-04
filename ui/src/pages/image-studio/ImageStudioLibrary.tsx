/**
 * /image-studio/library — the centralized template library across every tool.
 * Browse + filter all templates (tool · rating · persona · search); clicking one
 * opens the model picker, then routes to the chosen tool with the assembled
 * prompt handed off via sessionStorage (read by the target tool's composer).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Library, Loader2 } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useNavigate } from "@/lib/router";
import { applyCompanyPrefix } from "@/lib/company-routes";
import { imageStudioApi, type PromptTemplate } from "@/api/imageStudio";
import { UnifiedLibrary } from "@/components/image-studio/UnifiedLibrary";
import { type TemplateApply } from "@/components/image-studio/UseTemplatePicker";
import { toolDef, toolLabel } from "@/components/image-studio/tools";

export const APPLIED_TEMPLATE_KEY = "image-studio-applied-template";

export function ImageStudioLibrary() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const navigate = useNavigate();
  const prefix = selectedCompany?.issuePrefix ?? null;
  const [notice, setNotice] = useState<string | null>(null);

  const providersQ = useQuery({
    queryKey: ["image-studio", "providers", selectedCompanyId],
    queryFn: () => imageStudioApi.listProviders(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const personas = useMemo(
    () => (providersQ.data?.providers ?? []).filter((p) => p.type === "local_lora"),
    [providersQ.data],
  );

  async function onApply(template: PromptTemplate, apply: TemplateApply) {
    const def = toolDef(apply.tool);
    let res;
    try {
      res = await imageStudioApi.applyTemplate(template.id, {
        tool: apply.tool,
        model: apply.model,
        persona_id: apply.personaId,
      });
    } catch {
      setNotice("Failed to apply template.");
      return;
    }
    if (!def?.built) {
      setNotice(`${toolLabel(apply.tool)} isn't built yet — prompt is ready and will load once it ships.`);
      return;
    }
    // Hand off to the target tool's composer.
    sessionStorage.setItem(APPLIED_TEMPLATE_KEY, JSON.stringify({ ...res, templateId: template.id }));
    const route = def.route ?? "/image-studio";
    navigate(applyCompanyPrefix(route, prefix));
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center gap-2">
        <Library className="h-6 w-6 text-indigo-500" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Template Library</h1>
          <p className="text-sm text-muted-foreground">
            Every template across all tools · pick a tool + model on click
          </p>
        </div>
      </div>

      {notice && (
        <div className="mb-3 rounded-md border border-amber-300/60 bg-amber-50/60 p-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" data-testid="library-notice">
          {notice}
        </div>
      )}

      {providersQ.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <UnifiedLibrary personas={personas} onApply={(t, a) => void onApply(t, a)} />
      )}
    </div>
  );
}
