import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const DEFAULT_BASE_URL = process.env.OPENDESIGN_BASE_URL?.trim() || "http://127.0.0.1:18800";
const API_TOKEN = process.env.OPENDESIGN_API_TOKEN?.trim() || undefined;

export type OdSkill = {
  id: string;
  name: string;
  description: string;
  mode: string;
  surface?: string;
  scenario?: string | null;
  platform?: string | null;
  category?: string | null;
  previewType?: string | null;
  designSystemRequired?: boolean;
  examplePrompt?: string | null;
  triggers?: string[];
};

export type OdAgent = {
  id: string;
  name: string;
  available: boolean;
  path?: string;
  version?: string;
  models?: Array<{ id: string; label: string }>;
};

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_TOKEN) h.Authorization = `Bearer ${API_TOKEN}`;
  return h;
}

export async function odHealth(): Promise<{ ok: boolean; version?: string }> {
  const res = await fetch(`${DEFAULT_BASE_URL}/api/health`, { headers: authHeaders() });
  if (!res.ok) return { ok: false };
  return (await res.json()) as { ok: boolean; version?: string };
}

export async function odListSkills(): Promise<OdSkill[]> {
  const res = await fetch(`${DEFAULT_BASE_URL}/api/skills`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`opendesign /api/skills ${res.status}`);
  const body = (await res.json()) as OdSkill[] | { skills?: OdSkill[] };
  return Array.isArray(body) ? body : body.skills ?? [];
}

export async function odListAgents(): Promise<OdAgent[]> {
  const res = await fetch(`${DEFAULT_BASE_URL}/api/agents`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`opendesign /api/agents ${res.status}`);
  const body = (await res.json()) as { agents?: OdAgent[] };
  return body.agents ?? [];
}

export async function odCreateProject(
  projectId: string,
  name: string,
  skillId?: string,
  designSystemId?: string,
): Promise<void> {
  const res = await fetch(`${DEFAULT_BASE_URL}/api/projects`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      id: projectId,
      name,
      skillId: skillId ?? undefined,
      designSystemId: designSystemId ?? undefined,
      skipDiscoveryBrief: true,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`opendesign POST /api/projects ${res.status}: ${txt.slice(0, 200)}`);
  }
}

export type OdChatStartParams = {
  agentId: string;
  message: string;
  projectId: string;
  skillId?: string;
  designSystemId?: string;
  model?: string;
  conversationId?: string;
  clientRequestId?: string;
};

export type OdRunEvent = {
  type?: string;
  status?: string;
  artifact?: { id?: string; path?: string; url?: string; html?: string };
  usage?: { input_tokens?: number; output_tokens?: number; cost_usd?: number };
  cost?: { input_usd?: number; output_usd?: number; total_usd?: number };
  message?: string;
  toolName?: string;
  toolInput?: unknown;
  filesWritten?: string[];
  [k: string]: unknown;
};

export type OdRunResult = {
  runId: string;
  status: "completed" | "failed" | "cancelled";
  error?: string;
  artifactPath?: string;
  artifactHtml?: string;
  artifactUrl?: string;
  tokensIn?: number;
  tokensOut?: number;
  totalUsd?: number;
  raw: OdRunEvent[];
};

export async function odStartChatAndWait(
  params: OdChatStartParams,
  opts: { timeoutMs?: number; onEvent?: (e: OdRunEvent) => void } = {},
): Promise<OdRunResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const clientRequestId = params.clientRequestId ?? randomUUID();
  const body = JSON.stringify({
    agentId: params.agentId,
    message: params.message,
    projectId: params.projectId,
    skillId: params.skillId,
    designSystemId: params.designSystemId,
    model: params.model,
    conversationId: params.conversationId,
    clientRequestId,
  });

  const controller = new AbortController();
  const tHandle = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${DEFAULT_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { ...authHeaders(), Accept: "text/event-stream" },
      body,
      signal: controller.signal,
    });
  } finally {
    // keep timer; we clear after stream drains
  }
  if (!res.ok || !res.body) {
    clearTimeout(tHandle);
    const txt = await res.text().catch(() => "");
    throw new Error(`opendesign POST /api/chat ${res.status}: ${txt.slice(0, 200)}`);
  }

  const events: OdRunEvent[] = [];
  let runId = clientRequestId;
  let artifactHtml: string | undefined;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  let totalUsd: number | undefined;
  let finalStatus: OdRunResult["status"] = "failed";
  let finalError: string | undefined;
  // The daemon emits the artifact inline as `text_delta` events bracketed
  // by `<artifact>...</artifact>`. We accumulate the deltas and slice out
  // the HTML block at end-of-stream.
  let textBuf = "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  while (!done) {
    const { value, done: rDone } = await reader.read();
    if (rDone) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const payload = dataLines.join("\n");
      if (!payload || payload === "[DONE]") continue;
      let evt: OdRunEvent;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      events.push(evt);
      opts.onEvent?.(evt);

      if (typeof (evt as any).runId === "string") runId = (evt as any).runId;

      // Daemon's `event: agent` stream carries thinking_delta / text_delta /
      // usage / tool_use frames. The artifact lives inside text_delta deltas
      // bracketed by <artifact>...</artifact>.
      if (eventName === "agent") {
        const inner = evt as any;
        if (inner.type === "text_delta" && typeof inner.delta === "string") {
          textBuf += inner.delta;
        } else if (inner.type === "usage" && inner.usage && typeof inner.usage === "object") {
          const u = inner.usage as Record<string, unknown>;
          if (typeof u.input_tokens === "number") tokensIn = (u.input_tokens as number) + (tokensIn ?? 0);
          if (typeof u.output_tokens === "number") tokensOut = (u.output_tokens as number) + (tokensOut ?? 0);
          if (typeof inner.costUsd === "number") totalUsd = (totalUsd ?? 0) + (inner.costUsd as number);
        }
      }

      if (eventName === "end") {
        const status = typeof (evt as any).status === "string" ? (evt as any).status : "";
        if (status === "succeeded" || status === "completed" || (evt as any).code === 0) {
          finalStatus = "completed";
        } else if (status === "cancelled") {
          finalStatus = "cancelled";
        } else {
          finalStatus = "failed";
          finalError = typeof (evt as any).error === "string" ? (evt as any).error : status;
        }
        done = true;
        break;
      }
      if (eventName === "error") {
        finalStatus = "failed";
        finalError = typeof (evt as any).message === "string" ? (evt as any).message : "run errored";
        done = true;
        break;
      }
    }
  }

  // Slice the artifact out of the accumulated text. The daemon's
  // skill-prompted agent wraps its final emission in <artifact>…</artifact>.
  if (textBuf) {
    const m = textBuf.match(/<artifact[^>]*>([\s\S]*?)<\/artifact>/);
    if (m && m[1]) artifactHtml = m[1].trim();
  }
  clearTimeout(tHandle);
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }

  return {
    runId,
    status: finalStatus,
    error: finalError,
    artifactPath: undefined,
    artifactHtml,
    artifactUrl: undefined,
    tokensIn,
    tokensOut,
    totalUsd,
    raw: events,
  };
}

/**
 * Pull the freshest HTML artifact a run produced. The daemon writes files
 * into <projectsRoot>/<projectId>/; we ask for the listing and pick the
 * most recently-modified .html file. Fallback for runs whose SSE never
 * surfaced an explicit `artifact.path` event.
 */
export async function odFetchLatestProjectArtifact(
  projectId: string,
): Promise<{ name: string; html: string } | null> {
  const res = await fetch(`${DEFAULT_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/files`, {
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { files?: Array<{ name: string; mtime?: number; modifiedAt?: string }> };
  const files = (body.files ?? []).filter((f) => f.name.toLowerCase().endsWith(".html"));
  if (files.length === 0) return null;
  files.sort((a, b) => {
    const am = a.mtime ?? (a.modifiedAt ? Date.parse(a.modifiedAt) : 0);
    const bm = b.mtime ?? (b.modifiedAt ? Date.parse(b.modifiedAt) : 0);
    return bm - am;
  });
  const top = files[0];
  // The daemon's `/preview` endpoint refuses non-image kinds; for HTML we
  // hit the raw splat-file route instead.
  const rawRes = await fetch(
    `${DEFAULT_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(top.name)}`,
    { headers: authHeaders() },
  );
  if (!rawRes.ok) return null;
  const html = await rawRes.text();
  return { name: top.name, html };
}

/**
 * Copy an HTML artifact from the OD project folder into Paperclip's
 * design-runs asset dir so the file outlives the daemon's project lifetime
 * and we serve it under our own URL space.
 */
export async function persistArtifactHtml(
  designRunId: string,
  html: string,
  filename = "artifact.html",
): Promise<{ path: string; url: string }> {
  const dir = path.join(process.env.HOME || "/Users/augi", ".paperclip", "design-runs", designRunId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, html, "utf8");
  return { path: filePath, url: `/api/design/runs/${designRunId}/asset` };
}

export async function waitForDaemonReady(timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const h = await odHealth();
      if (h.ok) return true;
    } catch {
      /* keep polling */
    }
    await delay(300);
  }
  return false;
}

export const opendesignClient = {
  baseUrl: DEFAULT_BASE_URL,
  health: odHealth,
  listSkills: odListSkills,
  listAgents: odListAgents,
  createProject: odCreateProject,
  startChatAndWait: odStartChatAndWait,
  fetchLatestProjectArtifact: odFetchLatestProjectArtifact,
  persistArtifactHtml,
  waitForDaemonReady,
};
