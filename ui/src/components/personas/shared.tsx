/**
 * Shared building blocks for the Personas CMS (list page, detail page, pickers):
 * the avatar (cover image or initials), the status pill, and small helpers for
 * trigger words + the cross-tool quick-action deep-links into Image Studio.
 */
import { Loader2, TriangleAlert, CheckCircle2, XCircle, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { uploadUrl, type ImageProvider } from "@/api/imageStudio";

/** Trigger word the LoRA was trained with (lives in attributes.trigger_word). */
export function personaTriggerWord(persona: ImageProvider): string {
  const tw = persona.attributes?.["trigger_word"];
  if (typeof tw === "string" && tw.trim()) return tw.trim();
  return persona.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Whether a persona can be used in the generation tools. Legacy personas carry
 * assorted statuses ("training", "needs_photos") yet have installed LoRAs and
 * generate fine in Image Studio, so the only state that truly gates the tools is
 * the wizard's freshly-created "untrained" — those get a "Start training" CTA.
 */
export function isPersonaTrained(persona: ImageProvider): boolean {
  return persona.status !== "untrained";
}

/**
 * Resolve an avatar/cover path to a <img src>. Two storage schemes coexist:
 * backfilled gallery covers are uploads-relative ("personas/…"), while wizard
 * uploads come back as absolute asset URLs ("/api/assets/…/content"). Pass the
 * latter through untouched; prefix the former with the uploads mount.
 */
export function personaImageSrc(path: string): string {
  return /^(https?:)?\/\//.test(path) || path.startsWith("/") ? path : uploadUrl(path);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function PersonaAvatar({
  persona,
  className,
}: {
  persona: ImageProvider;
  className?: string;
}) {
  return (
    <Avatar className={cn("h-12 w-12 rounded-xl", className)}>
      {persona.avatarPath && <AvatarImage src={personaImageSrc(persona.avatarPath)} alt={persona.name} className="object-cover" />}
      <AvatarFallback className="rounded-xl bg-gradient-to-br from-indigo-500/80 to-fuchsia-500/80 text-sm font-semibold text-white">
        {initials(persona.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Status pill for a persona row, including the CMS-only "untrained" state. */
export function PersonaStatusBadge({ persona }: { persona: ImageProvider }) {
  const { status, statusDetail } = persona;
  if (!status || status === "ready") {
    return (
      <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
        <CheckCircle2 className="mr-1 h-3 w-3" /> ready
      </Badge>
    );
  }
  if (status === "training") {
    return (
      <Badge variant="outline" className="border-yellow-200 bg-yellow-50 text-yellow-700">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> {statusDetail ?? "training…"}
      </Badge>
    );
  }
  if (status === "untrained" || status === "needs_photos") {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
        <TriangleAlert className="mr-1 h-3 w-3" /> {status === "untrained" ? "untrained" : "needs photos"}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
        <XCircle className="mr-1 h-3 w-3" /> failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
      <Cloud className="mr-1 h-3 w-3" /> {status}
    </Badge>
  );
}

/** The Image Studio tool a quick action opens, keyed to the workbench ?tab=. */
export type PersonaQuickTool = "generate" | "photoshoot" | "undresser";

/** Build the cross-tool deep-link: Image Studio with this persona pre-selected
    and the matching tab open. Company prefix is applied by the caller. */
export function imageStudioToolPath(personaId: string, tab: PersonaQuickTool): string {
  return `/image-studio?persona=${personaId}&tab=${tab}`;
}
