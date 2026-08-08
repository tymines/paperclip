import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Play, RotateCcw } from "lucide-react";
import type {
  CreatorCampaignRecord,
  CreatorContentSourceOption,
  CreatorFlowRecord,
  CreatorFlowRunRecord,
  CreatorFlowStepConfig,
  CreatorReviewRequestRecord,
  SocialPlatform,
} from "@paperclipai/shared";
import { SOCIAL_PLATFORMS } from "@paperclipai/shared";
import { creatorOsApi } from "@/api/creatorOs";
import { imageStudioApi } from "@/api/imageStudio";
import { ApiError } from "@/api/client";
import type { CreatorOsDestination } from "./CreatorOsNavigation";

const fieldClass = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-violet-400";
const primaryClass = "min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryClass = "min-h-11 rounded-xl border border-slate-700 px-3 text-sm text-slate-200 hover:border-slate-500 disabled:opacity-50";

function errorCopy(error: unknown) {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return "You are not authorized to access this company lane.";
  if ((typeof navigator !== "undefined" && !navigator.onLine) || error instanceof TypeError) return "This lane is offline. Current records could not be loaded.";
  if (error instanceof Error) return error.message;
  return "This lane is unavailable. No empty or success state is being inferred.";
}

function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-200" role="alert">{errorCopy(error)}</div>;
}

function LaneState({ loading, error, empty, children }: { loading: boolean; error: unknown; empty?: string; children: React.ReactNode }) {
  if (loading) return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading current records…</div>;
  if (error) return <ErrorNotice error={error} />;
  if (empty) return <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">{empty}</div>;
  return <>{children}</>;
}

function RunList({ runs, onRetry, retryUnavailableReason }: { runs: CreatorFlowRunRecord[]; onRetry: (run: CreatorFlowRunRecord, stepId: string) => void; retryUnavailableReason: string | null }) {
  return (
    <div className="space-y-2">
      {runs.map((run) => (
        <div key={run.id} className="rounded-xl border border-slate-800 bg-black/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold uppercase text-slate-300">Run {run.id.slice(0, 8)}</span><span className="text-xs capitalize text-violet-300">{run.status}</span></div>
          {run.errorMessage ? <p className="mt-1 text-xs text-red-300">{run.errorMessage}</p> : null}
          <div className="mt-2 space-y-1">
            {run.steps.map((step) => (
              <div key={step.id} className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
                <span className="w-5 shrink-0 text-right">{step.position + 1}.</span><span className="min-w-0 flex-1 truncate">{step.stepName}</span><span className="capitalize">{step.status}</span>
                {step.generationJobId ? <a className="text-violet-300 underline" href={`/jobs?generationJob=${step.generationJobId}`}>job</a> : null}
                {step.retryEligible ? <button type="button" className="rounded p-1 text-violet-300 disabled:text-slate-600" aria-label={`Retry ${step.stepName}`} title={retryUnavailableReason ?? undefined} disabled={Boolean(retryUnavailableReason)} onClick={() => onRetry(run, step.id)}><RotateCcw className="h-3.5 w-3.5" /></button> : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FlowsLane({ companyId, personaId }: { companyId: string; personaId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<CreatorFlowRecord | null>(null);
  const [steps, setSteps] = useState<Array<{ key: string; name: string; config: CreatorFlowStepConfig; capabilityId: string }>>([
    { key: crypto.randomUUID(), name: "Generate content", config: { prompt: "" }, capabilityId: "" },
  ]);
  const flowsQ = useQuery({ queryKey: ["creator-os", "flows", companyId, personaId], queryFn: () => creatorOsApi.listFlows(companyId, personaId) });
  const capabilitiesQ = useQuery({ queryKey: ["image-studio", "capabilities", companyId, personaId], queryFn: () => imageStudioApi.getCapabilities(companyId, personaId) });
  const enabledCapabilities = (capabilitiesQ.data?.capabilities ?? []).filter((capability) => capability.enabled && capability.mediaKind === "image");
  const workerUnavailableReason = capabilitiesQ.data?.generationWorker.enabled === false
    ? capabilitiesQ.data.generationWorker.disabledReason
    : null;
  const runQueries = useQueries({ queries: (flowsQ.data?.flows ?? []).map((flow) => ({ queryKey: ["creator-os", "runs", companyId, flow.id], queryFn: () => creatorOsApi.listRuns(companyId, flow.id), refetchInterval: 5_000 })) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["creator-os"] });
  const save = useMutation({ mutationFn: async () => {
    const orderedSteps = steps.map((step) => {
      const selectedCapability = enabledCapabilities.find((capability) => capability.id === step.capabilityId);
      const config = { ...step.config };
      if (selectedCapability) {
        config.providerHost = selectedCapability.providerHost;
        if (selectedCapability.nativeModel) config.model = selectedCapability.nativeModel;
        else delete config.model;
      }
      return { name: step.name, config };
    });
    return editing
      ? creatorOsApi.updateFlow(companyId, editing.id, { name, steps: orderedSteps })
      : creatorOsApi.createFlow(companyId, { personaId, name, status: "active", steps: orderedSteps });
  }, onSuccess: () => {
    setName("");
    setEditing(null);
    setSteps([{ key: crypto.randomUUID(), name: "Generate content", config: { prompt: "" }, capabilityId: "" }]);
    invalidate();
  } });
  const archive = useMutation({ mutationFn: (flowId: string) => creatorOsApi.archiveFlow(companyId, flowId), onSuccess: invalidate });
  const run = useMutation({ mutationFn: (flowId: string) => creatorOsApi.runFlow(companyId, flowId, crypto.randomUUID()), onSuccess: invalidate });
  const retry = useMutation({ mutationFn: ({ runId, stepId }: { runId: string; stepId: string }) => creatorOsApi.retryStep(companyId, runId, stepId, crypto.randomUUID()), onSuccess: invalidate });
  const updateStep = (key: string, patch: Partial<{ name: string; config: CreatorFlowStepConfig; capabilityId: string }>) => setSteps((current) => current.map((step) => step.key === key ? { ...step, ...patch } : step));
  const moveStep = (index: number, direction: -1 | 1) => setSteps((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const beginEdit = (flow: CreatorFlowRecord) => {
    setEditing(flow);
    setName(flow.name);
    setSteps([...flow.steps].sort((left, right) => left.position - right.position).map((step) => {
      const capability = enabledCapabilities.find((entry) => entry.providerHost === (step.config.providerHost ?? "replicate") && entry.nativeModel === (step.config.model ?? null));
      return { key: step.id, name: step.name, config: { ...step.config }, capabilityId: capability?.id ?? "" };
    }));
  };

  return (
    <section className="space-y-4" data-testid="creator-flows">
      <div><p className="text-xs uppercase tracking-widest text-violet-300">Durable workflows</p><h2 className="text-xl font-semibold text-white">Flows</h2><p className="text-sm text-slate-400">Saving never generates. Run requires a separate paid-work confirmation.</p></div>
      <form className="space-y-3 rounded-2xl border border-slate-800 bg-[#0c1019] p-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <input className={fieldClass} aria-label="Flow name" placeholder="Flow name" value={name} onChange={(event) => setName(event.target.value)} required />
        <div className="space-y-2">
          {steps.map((step, index) => (
            <div key={step.key} className="grid gap-2 rounded-xl border border-slate-800 p-3 lg:grid-cols-[auto_minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto]">
              <span className="self-center text-xs font-semibold text-slate-400">{index + 1}.</span>
              <input className={fieldClass} aria-label={`Step ${index + 1} name`} value={step.name} onChange={(event) => updateStep(step.key, { name: event.target.value })} placeholder="Step name" required />
              <input className={fieldClass} aria-label={`Step ${index + 1} prompt`} value={step.config.prompt} onChange={(event) => updateStep(step.key, { config: { ...step.config, prompt: event.target.value } })} placeholder="Ordered step prompt" required />
              <select className={fieldClass} aria-label={`Step ${index + 1} capability`} value={step.capabilityId} onChange={(event) => updateStep(step.key, { capabilityId: event.target.value })} disabled={enabledCapabilities.length === 0}>
                {enabledCapabilities.length === 0 ? <option value="">No verified image capability</option> : <><option value="">Keep saved capability</option>{enabledCapabilities.map((capability) => <option key={capability.id} value={capability.id}>{capability.providerName} · {capability.name}</option>)}</>}
              </select>
              <div className="flex flex-wrap gap-1">
                <button type="button" className={secondaryClass} aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => moveStep(index, -1)}>Up</button>
                <button type="button" className={secondaryClass} aria-label={`Move step ${index + 1} down`} disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)}>Down</button>
                <button type="button" className={secondaryClass} aria-label={`Remove step ${index + 1}`} disabled={steps.length === 1} onClick={() => setSteps((current) => current.filter((candidate) => candidate.key !== step.key))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-between gap-2"><button type="button" className={secondaryClass} onClick={() => setSteps((current) => [...current, { key: crypto.randomUUID(), name: `Step ${current.length + 1}`, config: { prompt: "" }, capabilityId: "" }])}>Add step</button><button className={primaryClass} disabled={save.isPending}>{editing ? "Save edit" : "Save flow"}</button></div>
      </form>
      {capabilitiesQ.isError || (!capabilitiesQ.isLoading && enabledCapabilities.length === 0) ? <p className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100" role="status">No credential-verified image capability is available. Flows can be saved, but Run stays disabled until the server capability contract is ready.</p> : null}
      {workerUnavailableReason ? <p className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100" role="status">{workerUnavailableReason}</p> : null}
      <ErrorNotice error={save.error ?? archive.error ?? run.error ?? retry.error} />
      <LaneState loading={flowsQ.isLoading} error={flowsQ.error} empty={flowsQ.data?.flows.length === 0 ? "No flows yet. Save a definition; it will not start paid work." : undefined}>
        <div className="grid gap-3 xl:grid-cols-2">
          {(flowsQ.data?.flows ?? []).map((flow, index) => (
            <article key={flow.id} className="min-w-0 rounded-2xl border border-slate-800 bg-[#0c1019] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate font-semibold text-white">{flow.name}</h3><p className="text-xs capitalize text-slate-400">{flow.status} · {flow.steps.length} ordered step{flow.steps.length === 1 ? "" : "s"}</p></div><div className="flex flex-wrap gap-2"><button className={secondaryClass} onClick={() => beginEdit(flow)}>Edit</button><button className={secondaryClass} onClick={() => archive.mutate(flow.id)} disabled={flow.status === "archived"}>Archive</button><button className={primaryClass} title={workerUnavailableReason ?? (!flow.steps.every((step) => enabledCapabilities.some((capability) => capability.providerHost === (step.config.providerHost ?? "replicate") && capability.nativeModel === (step.config.model ?? null))) ? "The saved generation capability is not currently verified by the server." : undefined)} disabled={flow.status !== "active" || run.isPending || Boolean(workerUnavailableReason) || !flow.steps.every((step) => enabledCapabilities.some((capability) => capability.providerHost === (step.config.providerHost ?? "replicate") && capability.nativeModel === (step.config.model ?? null)))} onClick={() => { if (window.confirm(`Run ${flow.name}? This may start paid hosted generation.`)) run.mutate(flow.id); }}><Play className="mr-1 inline h-3.5 w-3.5" />Run</button></div></div>
              <div className="mt-3"><RunList runs={runQueries[index]?.data?.runs ?? []} retryUnavailableReason={workerUnavailableReason} onRetry={(runRecord, stepId) => { if (window.confirm("Retry this failed step? This may start paid hosted generation.")) retry.mutate({ runId: runRecord.id, stepId }); }} /></div>
            </article>
          ))}
        </div>
      </LaneState>
    </section>
  );
}

function CampaignsLane({ companyId, personaId }: { companyId: string; personaId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [channels, setChannels] = useState<SocialPlatform[]>([]);
  const [editing, setEditing] = useState<CreatorCampaignRecord | null>(null);
  const [linkSources, setLinkSources] = useState<Record<string, string>>({});
  const campaignsQ = useQuery({ queryKey: ["creator-os", "campaigns", companyId, personaId], queryFn: () => creatorOsApi.listCampaigns(companyId, personaId) });
  const sourcesQ = useQuery({ queryKey: ["creator-os", "sources", companyId, personaId], queryFn: () => creatorOsApi.listSources(companyId, personaId) });
  const contentSources = sourcesQ.data?.sources ?? [];
  const sourceMap = new Map(contentSources.map((source) => [sourceKey(source), source]));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["creator-os", "campaigns", companyId, personaId] });
  const save = useMutation({ mutationFn: () => editing
    ? creatorOsApi.updateCampaign(companyId, editing.id, { name, channels })
    : creatorOsApi.createCampaign(companyId, { personaId, name, channels, status: "draft" }),
  onSuccess: () => { setName(""); setChannels([]); setEditing(null); invalidate(); } });
  const update = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => creatorOsApi.updateCampaign(companyId, id, { status: active ? "active" : "draft" }), onSuccess: invalidate });
  const archive = useMutation({ mutationFn: (id: string) => creatorOsApi.archiveCampaign(companyId, id), onSuccess: invalidate });
  const link = useMutation({
    mutationFn: (campaignId: string) => {
      const source = sourceMap.get(linkSources[campaignId] ?? "");
      if (!source) throw new Error("Select visible content to link to this campaign.");
      return creatorOsApi.addCampaignItem(companyId, campaignId, { kind: source.kind, referenceId: source.id });
    },
    onSuccess: (_result, campaignId) => {
      setLinkSources((current) => ({ ...current, [campaignId]: "" }));
      invalidate();
    },
  });

  return (
    <section className="space-y-4" data-testid="creator-campaigns">
      <div><p className="text-xs uppercase tracking-widest text-violet-300">Single-persona planning</p><h2 className="text-xl font-semibold text-white">Campaigns</h2><p className="text-sm text-slate-400">Campaigns link existing work without copying it. V1 intentionally has no deadline.</p></div>
      <form className="grid gap-2 rounded-2xl border border-slate-800 bg-[#0c1019] p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <input className={fieldClass} aria-label="Campaign name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Campaign name" required />
        <select multiple className={`${fieldClass} min-h-20 py-2`} aria-label="Campaign channels" value={channels} onChange={(event) => setChannels([...event.currentTarget.selectedOptions].map((option) => option.value as SocialPlatform))}>
          {SOCIAL_PLATFORMS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
        </select>
        <button className={primaryClass} disabled={save.isPending}>{editing ? "Save campaign" : "Create campaign"}</button>
      </form>
      <ErrorNotice error={save.error ?? update.error ?? archive.error ?? link.error ?? sourcesQ.error} />
      <LaneState loading={campaignsQ.isLoading} error={campaignsQ.error} empty={campaignsQ.data?.campaigns.length === 0 ? "No campaigns for this persona." : undefined}>
        <div className="grid gap-3 md:grid-cols-2">
          {(campaignsQ.data?.campaigns ?? []).map((campaign) => (
            <article key={campaign.id} className="rounded-2xl border border-slate-800 bg-[#0c1019] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h3 className="font-semibold text-white">{campaign.name}</h3><p className="text-xs capitalize text-slate-400">{campaign.status} · {campaign.items.length} linked items</p></div>
                <div className="flex flex-wrap gap-2"><button className={secondaryClass} disabled={campaign.status === "archived"} onClick={() => { setEditing(campaign); setName(campaign.name); setChannels(campaign.channels ?? []); }}>Edit</button><button className={secondaryClass} disabled={campaign.status === "archived"} onClick={() => update.mutate({ id: campaign.id, active: campaign.status !== "active" })}>{campaign.status === "active" ? "Return to draft" : "Activate"}</button><button className={secondaryClass} disabled={campaign.status === "archived"} onClick={() => archive.mutate(campaign.id)}>Archive</button></div>
              </div>
              <p className="mt-2 text-xs text-slate-400">Channels: {campaign.channels?.length ? campaign.channels.join(", ") : "none selected"}</p>
              {campaign.items.length > 0 ? <ul className="mt-3 space-y-1 text-xs text-slate-400">{campaign.items.map((item) => <li key={item.id}><span className="capitalize text-slate-300">{item.kind.replace("_", " ")}</span> · {sourceMap.get(`${item.kind}:${item.referenceId}`)?.label ?? "Unavailable linked content"}</li>)}</ul> : null}
              {campaign.status !== "archived" ? (
                <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); link.mutate(campaign.id); }}>
                  <div className="flex flex-col gap-2 sm:flex-row"><select className={fieldClass} aria-label={`Visible content for ${campaign.name}`} value={linkSources[campaign.id] ?? ""} onChange={(event) => setLinkSources((current) => ({ ...current, [campaign.id]: event.target.value }))} disabled={sourcesQ.isLoading || contentSources.length === 0} required>
                    <option value="">{sourcesQ.isLoading ? "Loading visible content..." : contentSources.length === 0 ? "No visible content available" : "Select visible content"}</option>
                    {contentSources.map((source) => <option key={sourceKey(source)} value={sourceKey(source)}>{source.kind.replace("_", " ")} · {source.label}</option>)}
                  </select><button className={secondaryClass} disabled={link.isPending || !linkSources[campaign.id]}>Add to campaign</button></div>
                  {sourcePreview(sourceMap.get(linkSources[campaign.id] ?? ""))}
                </form>
              ) : null}
            </article>
          ))}
        </div>
      </LaneState>
    </section>
  );
}

function ReviewsLane({ companyId, personaId }: { companyId: string; personaId: string }) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [selectedSourceKey, setSelectedSourceKey] = useState("");
  const [handoffContent, setHandoffContent] = useState<Record<string, string>>({});
  const reviewsQ = useQuery({ queryKey: ["creator-os", "reviews", companyId, personaId], queryFn: () => creatorOsApi.listReviews(companyId, personaId) });
  const sourcesQ = useQuery({ queryKey: ["creator-os", "sources", companyId, personaId], queryFn: () => creatorOsApi.listSources(companyId, personaId) });
  const reviewSources = (sourcesQ.data?.sources ?? []).filter((source) => source.reviewEligible);
  const selectedSource = reviewSources.find((source) => sourceKey(source) === selectedSourceKey);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["creator-os"] });
  const create = useMutation({
    mutationFn: () => {
      if (!selectedSource || !selectedSource.reviewEligible || !["generation", "asset", "social_draft"].includes(selectedSource.kind)) throw new Error("Select visible content to request review.");
      return creatorOsApi.createReview(companyId, { personaId, sourceType: selectedSource.kind as "generation" | "asset" | "social_draft", sourceId: selectedSource.id });
    },
    onSuccess: () => { setSelectedSourceKey(""); invalidate(); },
  });
  const decide = useMutation({ mutationFn: ({ review, decision }: { review: CreatorReviewRequestRecord; decision: "approved" | "rejected" }) => creatorOsApi.decideReview(companyId, review.id, decision, feedback[review.id]), onSuccess: invalidate });
  const rereview = useMutation({ mutationFn: (id: string) => creatorOsApi.rereview(companyId, id), onSuccess: invalidate });
  const handoff = useMutation({ mutationFn: (reviewId: string) => creatorOsApi.handoff(companyId, reviewId, handoffContent[reviewId] ?? ""), onSuccess: invalidate });

  return (
    <section className="space-y-4" data-testid="creator-review">
      <div><p className="text-xs uppercase tracking-widest text-violet-300">Board content gate</p><h2 className="text-xl font-semibold text-white">Review</h2><p className="text-sm text-slate-400">Terminal decisions retain actor and time. Re-review always creates a new request.</p></div>
      <form className="space-y-2 rounded-2xl border border-slate-800 bg-[#0c1019] p-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <div className="flex flex-col gap-2 sm:flex-row"><select className={fieldClass} aria-label="Visible content for review" value={selectedSourceKey} onChange={(event) => setSelectedSourceKey(event.target.value)} disabled={sourcesQ.isLoading || reviewSources.length === 0} required>
          <option value="">{sourcesQ.isLoading ? "Loading visible content..." : reviewSources.length === 0 ? "No reviewable content available" : "Select visible content"}</option>
          {reviewSources.map((source) => <option key={sourceKey(source)} value={sourceKey(source)}>{source.kind.replace("_", " ")} · {source.label}</option>)}
        </select><button className={primaryClass} disabled={create.isPending || !selectedSource}>Request review</button></div>
        {sourcePreview(selectedSource)}
      </form>
      <ErrorNotice error={create.error ?? decide.error ?? rereview.error ?? handoff.error ?? sourcesQ.error} />
      <LaneState loading={reviewsQ.isLoading} error={reviewsQ.error} empty={reviewsQ.data?.reviews.length === 0 ? "No content is waiting for review." : undefined}>
        <div className="space-y-3">
          {(reviewsQ.data?.reviews ?? []).map((review) => (
            <article key={review.id} className="rounded-2xl border border-slate-800 bg-[#0c1019] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h3 className="font-semibold capitalize text-white">{review.sourceType.replace("_", " ")}</h3><p className="text-xs text-slate-400">{review.sourceId.slice(0, 8)} · <span className="capitalize">{review.status}</span>{review.decidedBy ? ` · ${review.decidedBy}` : ""}</p></div>
                {review.status === "pending" ? <div className="flex flex-wrap gap-2"><button className={primaryClass} onClick={() => decide.mutate({ review, decision: "approved" })}>Approve</button><button className={secondaryClass} disabled={!feedback[review.id]?.trim()} onClick={() => decide.mutate({ review, decision: "rejected" })}>Request changes</button></div> : <button className={secondaryClass} onClick={() => rereview.mutate(review.id)}>Request re-review</button>}
              </div>
              {review.preview?.mediaUrl ? <img className="mt-3 max-h-72 w-full rounded-xl object-contain" src={review.preview.mediaUrl} alt="Content under review" /> : null}
              {review.preview?.content ? <p className="mt-3 whitespace-pre-wrap rounded-xl bg-black/20 p-3 text-sm text-slate-200">{review.preview.content}</p> : null}
              {review.supersedesRequestId ? <p className="mt-2 text-xs text-slate-500">History: follows review {review.supersedesRequestId.slice(0, 8)}</p> : null}
              {review.status === "pending" ? <textarea className={`${fieldClass} mt-3 py-2`} aria-label={`Feedback for ${review.sourceId}`} placeholder="Required change request" value={feedback[review.id] ?? ""} onChange={(event) => setFeedback((current) => ({ ...current, [review.id]: event.target.value }))} /> : review.feedback ? <p className="mt-2 text-sm text-slate-300">{review.feedback}</p> : null}
              {review.status === "approved" ? <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); handoff.mutate(review.id); }}><textarea className={`${fieldClass} py-2`} aria-label={`Social content for ${review.sourceId}`} placeholder="Approved caption for a targetless Social draft" value={handoffContent[review.id] ?? ""} onChange={(event) => setHandoffContent((current) => ({ ...current, [review.id]: event.target.value }))} required /><button className={secondaryClass} disabled={handoff.isPending}>Hand off to Social</button></form> : null}
            </article>
          ))}
        </div>
      </LaneState>
    </section>
  );
}

function SocialLane({ companyId, personaId }: { companyId: string; personaId: string }) {
  const queryClient = useQueryClient();
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, string[]>>({});
  const [scheduledAt, setScheduledAt] = useState<Record<string, string>>({});
  const socialQ = useQuery({ queryKey: ["creator-os", "social", companyId, personaId], queryFn: () => creatorOsApi.getSocial(companyId, personaId) });
  const schedule = useMutation({ mutationFn: ({ postId }: { postId: string }) => creatorOsApi.schedule(companyId, personaId, postId, selectedAccounts[postId] ?? [], new Date(scheduledAt[postId]).toISOString()), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["creator-os", "social", companyId, personaId] }) });
  const publishableAccounts = (socialQ.data?.accounts ?? []).filter((account) => account.publishCapability.available);
  const unavailableReasons = [...new Set((socialQ.data?.accounts ?? []).filter((account) => !account.publishCapability.available).map((account) => account.publishCapability.reason).filter((reason): reason is string => Boolean(reason)))];
  return (
    <section className="space-y-4" data-testid="creator-social">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs uppercase tracking-widest text-violet-300">Persona-tagged handoff</p><h2 className="text-xl font-semibold text-white">Social</h2><p className="text-sm text-slate-400">Approved handoffs are drafts. Account selection and time require a second, server-recorded publish confirmation.</p></div><a className={secondaryClass} href="/social">Open full Social <ExternalLink className="ml-1 inline h-3.5 w-3.5" /></a></div>
      {socialQ.data && publishableAccounts.length === 0 ? <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100" role="status"><p>No publish-capable Social account is available for this company.</p>{unavailableReasons.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-5">{unavailableReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="mt-1">Connect an account in Social before scheduling; no publish will be fabricated.</p>}</div> : null}
      <ErrorNotice error={schedule.error} />
      <LaneState loading={socialQ.isLoading} error={socialQ.error} empty={socialQ.data?.drafts.length === 0 ? "No persona-tagged Social drafts yet. Hand off approved content from Review." : undefined}>
        <div className="space-y-3">{(socialQ.data?.drafts ?? []).map((draft) => (
          <article key={draft.id} className="rounded-2xl border border-slate-800 bg-[#0c1019] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 flex-1 text-sm text-slate-200">{draft.content}</p><span className="text-xs capitalize text-violet-300">{draft.status}</span></div>
            {draft.status === "draft" ? <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><select multiple className={`${fieldClass} min-h-20 py-2`} aria-label="Target accounts" value={selectedAccounts[draft.id] ?? []} disabled={publishableAccounts.length === 0} onChange={(event) => setSelectedAccounts((current) => ({ ...current, [draft.id]: [...event.currentTarget.selectedOptions].map((option) => option.value) }))}>{publishableAccounts.length === 0 ? <option>No publish-capable accounts</option> : publishableAccounts.map((account) => <option key={account.id} value={account.id}>{account.displayName} · {account.platform}</option>)}</select><input className={fieldClass} type="datetime-local" aria-label="Schedule time" value={scheduledAt[draft.id] ?? ""} onChange={(event) => setScheduledAt((current) => ({ ...current, [draft.id]: event.target.value }))} /><button className={primaryClass} disabled={!scheduledAt[draft.id] || (selectedAccounts[draft.id]?.length ?? 0) === 0} onClick={() => { if (window.confirm("Confirm external publishing to these accounts at the selected time?")) schedule.mutate({ postId: draft.id }); }}>Confirm publish schedule</button></div> : null}
          </article>
        ))}</div>
      </LaneState>
    </section>
  );
}

const sourceKey = (source: Pick<CreatorContentSourceOption, "kind" | "id">) => `${source.kind}:${source.id}`;

function sourcePreview(source: CreatorContentSourceOption | undefined) {
  if (!source) return null;
  return <div className="rounded-xl border border-slate-800 bg-black/20 p-3" data-testid="selected-content-preview">
    <p className="text-sm font-medium text-slate-200">{source.label}</p>
    {source.detail ? <p className="text-xs capitalize text-slate-500">{source.detail}</p> : null}
    {source.preview.mediaUrl ? <img className="mt-2 max-h-48 w-full rounded-lg object-contain" src={source.preview.mediaUrl} alt={`Preview of ${source.label}`} /> : null}
    {source.preview.content ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-slate-300">{source.preview.content}</p> : null}
  </div>;
}

export function CreatorOperationalLanes({ destination, companyId, personaId }: { destination: CreatorOsDestination; companyId: string; personaId: string }) {
  if (destination === "flows") return <FlowsLane companyId={companyId} personaId={personaId} />;
  if (destination === "campaigns") return <CampaignsLane companyId={companyId} personaId={personaId} />;
  if (destination === "review") return <ReviewsLane companyId={companyId} personaId={personaId} />;
  if (destination === "social") return <SocialLane companyId={companyId} personaId={personaId} />;
  return null;
}
