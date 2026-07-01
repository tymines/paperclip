import type {
  InstanceExperimentalSettings,
  InstanceGeneralSettings,
  IssueGraphLivenessAutoRecoveryPreview,
  PatchInstanceGeneralSettings,
  PatchInstanceExperimentalSettings,
} from "@paperclipai/shared";
import { api } from "./client";

export const instanceSettingsApi = {
  getGeneral: () =>
    api.get<InstanceGeneralSettings>("/instance/settings/general"),
  updateGeneral: (patch: PatchInstanceGeneralSettings) =>
    api.patch<InstanceGeneralSettings>("/instance/settings/general", patch),
  getExperimental: () =>
    api.get<InstanceExperimentalSettings>("/instance/settings/experimental"),
  updateExperimental: (patch: PatchInstanceExperimentalSettings) =>
    api.patch<InstanceExperimentalSettings>("/instance/settings/experimental", patch),
  previewIssueGraphLivenessAutoRecovery: (input: { lookbackHours?: number }) =>
    api.post<IssueGraphLivenessAutoRecoveryPreview>(
      "/instance/settings/experimental/issue-graph-liveness-auto-recovery/preview",
      input,
    ),
  runIssueGraphLivenessAutoRecovery: (input: { lookbackHours?: number }) =>
    api.post<{
      findings: number;
      autoRecoveryEnabled: boolean;
      lookbackHours: number;
      cutoff: string;
      escalationsCreated: number;
      existingEscalations: number;
      skipped: number;
      skippedAutoRecoveryDisabled: number;
      skippedOutsideLookback: number;
      escalationIssueIds: string[];
    }>(
      "/instance/settings/experimental/issue-graph-liveness-auto-recovery/run",
      input,
    ),

  // ── Provider API Keys ────────────────────────────────────────────────
  listProviderKeys: () =>
    api.get<Array<{ provider: string; hasKey: boolean; last4: string | null; updatedAt: string | null }>>(
      "/instance/settings/provider-keys",
    ),
  setProviderKey: (provider: string, value: string) =>
    api.patch<{ provider: string; hasKey: boolean; last4: string | null; updatedAt: string | null }>(
      "/instance/settings/provider-keys",
      { provider, value },
    ),
  testProviderKey: (provider: string) =>
    api.post<{ ok: boolean; balance: number | null; currency: string; error?: string }>(
      `/instance/settings/provider-keys/${provider}/test`,
      {},
    ),

  // ── ElevenLabs Webhook ───────────────────────────────────────────────
  // GET returns presence + last4 + URL; the raw secret is only returned
  // by the generate call (once).
  getElevenLabsWebhook: () =>
    api.get<{ url: string; configured: boolean; last4: string | null; updatedAt: string | null }>(
      "/instance/settings/elevenlabs-webhook",
    ),
  generateElevenLabsWebhookSecret: () =>
    api.post<{ url: string; secret: string; last4: string; updatedAt: string }>(
      "/instance/settings/elevenlabs-webhook/generate",
      {},
    ),
};
