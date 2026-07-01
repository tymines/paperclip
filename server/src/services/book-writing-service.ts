/**
 * Book Writing Service — orchestrates the book-writing pipeline on the
 * paperclip-book-writer remote environment.
 *
 * Pipeline workflow:
 *   1. User submits concept, genre, length, tone, author name
 *   2. Service writes seed.txt to Box 1 (~/paperclip-book-writer/in/)
 *   3. Kicks off screenplay.sh on the remote environment
 *   4. Polls ~/paperclip-book-writer/novels/<pipelineId>/state.json for progress
 *   5. On completion, exposes artifacts (PDF, ePub, MP3, landing page)
 */

import { randomUUID } from "node:crypto";
import { resolveEnvironmentExecutionTarget } from "./environment-execution-target.js";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Types ──────────────────────────────────────────────────────────────────

export interface BookWritingSettings {
  concept: string;
  genre: Genre;
  length: Length;
  tone: Tone;
  authorName?: string;
}

export type Genre =
  | "Sci-Fi"
  | "Fantasy"
  | "Mystery"
  | "Romance"
  | "Thriller"
  | "Literary"
  | "Historical"
  | "Horror"
  | "Adventure"
  | "Other";

export type Length =
  | { label: "Short Story (~3k)"; targetWords: 3000 }
  | { label: "Novella (~20k)"; targetWords: 20000 }
  | { label: "Novel (~60k)"; targetWords: 60000 }
  | { label: "Epic (~100k)"; targetWords: 100000 };

export type Tone =
  | "Whimsical"
  | "Gritty"
  | "Academic"
  | "Lyrical"
  | "Minimalist"
  | "Cinematic";

export interface PipelineStatus {
  pipelineId: string;
  phase: Phase;
  stepLabel: string;
  iteration: number;
  estimatedMinutesRemaining: number;
  score: number | null;
  scoreHistory: number[];
  logLines: string[];
  error?: string;
  completedAt?: string;
}

export type Phase = "idle" | "foundation" | "drafting" | "revision" | "export" | "done" | "failed";

export interface PipelineArtifact {
  type: "pdf" | "epub" | "audiobook" | "landing-page" | "cover";
  label: string;
  url: string;
  fileSize: number;
}

export interface PipelineResult {
  pipelineId: string;
  artifacts: PipelineArtifact[];
  wordCount: number;
  coverThumbnail?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const NOVELS_BASE = path.join(os.homedir(), "paperclip-book-writer", "novels");
const SEED_PATH = path.join(os.homedir(), "paperclip-book-writer", "seed.txt");
const POLL_INTERVAL_MS = 2000;

// ── In-memory pipeline registry ────────────────────────────────────────────
// In production this would be a DB; for now track running pipelines.

interface PipelineRecord {
  pipelineId: string;
  companyId: string;
  settings: BookWritingSettings;
  startedAt: string;
  phase: Phase;
  stepLabel: string;
  iteration: number;
  estimatedMinutesRemaining: number;
  score: number | null;
  scoreHistory: number[];
  logLines: string[];
  error?: string;
  completedAt?: string;
  processPid?: number;
}

const pipelines = new Map<string, PipelineRecord>();

// ── Helpers ────────────────────────────────────────────────────────────────

function getNovelDir(pipelineId: string): string {
  return path.join(NOVELS_BASE, pipelineId);
}

function getStatePath(pipelineId: string): string {
  return path.join(getNovelDir(pipelineId), "state.json");
}

function getResultsTsvPath(pipelineId: string): string {
  return path.join(getNovelDir(pipelineId), "results.tsv");
}

function readStateFile(pipelineId: string): Record<string, unknown> | null {
  const statePath = getStatePath(pipelineId);
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readScoreHistory(pipelineId: string): number[] {
  const tsvPath = getResultsTsvPath(pipelineId);
  try {
    const raw = fs.readFileSync(tsvPath, "utf-8");
    const lines = raw.trim().split("\n").slice(1); // skip header
    return lines
      .map((line) => {
        const cols = line.split("\t");
        return parseFloat(cols[cols.length - 1]); // last column = score
      })
      .filter((n) => !isNaN(n));
  } catch {
    return [];
  }
}

function listArtifacts(pipelineId: string): PipelineArtifact[] {
  const novelDir = getNovelDir(pipelineId);
  const artifacts: PipelineArtifact[] = [];

  const patterns: Array<{ glob: string; type: PipelineArtifact["type"]; label: string }> = [
    { glob: "*.pdf", type: "pdf", label: "PDF" },
    { glob: "*.epub", type: "epub", label: "ePub" },
    { glob: "*.mp3", type: "audiobook", label: "Audiobook (MP3)" },
    { glob: "index.html", type: "landing-page", label: "Landing Page" },
    { glob: "cover.*", type: "cover", label: "Cover Art" },
  ];

  for (const pattern of patterns) {
    try {
      const files = fs.readdirSync(novelDir).filter((f) => {
        // Simple glob matching
        if (pattern.glob.includes("*")) {
          const ext = pattern.glob.replace("*", "");
          return f.endsWith(ext);
        }
        return f === pattern.glob;
      });

      for (const file of files) {
        const filePath = path.join(novelDir, file);
        const stat = fs.statSync(filePath);
        artifacts.push({
          type: pattern.type,
          label: pattern.label,
          url: `/api/companies/_/book-writing/artifacts/${pipelineId}/${file}`,
          fileSize: stat.size,
        });
      }
    } catch {
      // directory doesn't exist yet or can't be read
    }
  }

  return artifacts;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Start a book-writing pipeline.
 * 1. Validates settings
 * 2. Writes seed.txt to Box 1
 * 3. Forks the screenplay.sh script
 * 4. Returns the pipeline ID for status polling
 */
export async function startPipeline(
  companyId: string,
  concept: string,
  settings: BookWritingSettings,
): Promise<{ pipelineId: string }> {
  const pipelineId = randomUUID();

  // Build seed content
  const seedContent = [
    `# Book Writing Pipeline Seed`,
    `# Generated: ${new Date().toISOString()}`,
    `# Pipeline: ${pipelineId}`,
    ``,
    `## Concept`,
    settings.concept,
    ``,
    `## Settings`,
    `Genre: ${settings.genre}`,
    `Length: ${settings.length}`,
    `Tone: ${settings.tone}`,
    settings.authorName ? `Author: ${settings.authorName}` : null,
    ``,
    `## Target Words`,
    String(settings.length?.targetWords ?? 60000),
  ]
    .filter(Boolean)
    .join("\n");

  // Ensure the novels directory exists
  fs.mkdirSync(getNovelDir(pipelineId), { recursive: true });

  // Write seed.txt
  fs.writeFileSync(SEED_PATH, seedContent, "utf-8");

  // Create pipeline record
  const record: PipelineRecord = {
    pipelineId,
    companyId,
    settings,
    startedAt: new Date().toISOString(),
    phase: "foundation",
    stepLabel: "Generating world bible...",
    iteration: 0,
    estimatedMinutesRemaining: 45,
    score: null,
    scoreHistory: [],
    logLines: ["Pipeline initialized", "Seed file written", "Starting screenplay.sh..."],
  };
  pipelines.set(pipelineId, record);

  // Run pipeline locally (remote execution deferred until env-target plumbing is wired)
  const scriptPath = path.join(os.homedir(), "paperclip-book-writer", "screenplay.sh");
  const logPath = path.join(getNovelDir(pipelineId), "pipeline.log");
  try {
    const child = require("child_process").spawn("bash", [scriptPath, pipelineId], {
      cwd: path.join(os.homedir(), "paperclip-book-writer"),
      stdio: ["ignore", fs.openSync(logPath, "a"), fs.openSync(logPath, "a")],
      detached: true,
    });
    child.unref();
    record.processPid = child.pid;
  } catch (e) {
    record.logLines.push(`Warning: screenplay.sh not found or failed to start: ${e}`);
  }

  return { pipelineId };
}

/**
 * Get the current status of a pipeline.
 * Polls the state.json file on disk and the results.tsv for score history.
 */
export async function getPipelineStatus(
  pipelineId: string,
): Promise<PipelineStatus | null> {
  const record = pipelines.get(pipelineId);
  if (!record) return null;

  // Read state.json from disk if it exists
  const state = readStateFile(pipelineId);
  if (state) {
    record.phase = (state.phase as Phase) ?? record.phase;
    record.stepLabel = (state.step as string) ?? record.stepLabel;
    record.iteration = (state.iteration as number) ?? record.iteration;
    record.estimatedMinutesRemaining =
      (state.estimatedMinutesRemaining as number) ?? record.estimatedMinutesRemaining;
    record.score = (state.score as number) ?? record.score;

    if (state.logLines && Array.isArray(state.logLines)) {
      record.logLines = state.logLines as string[];
    }

    if (state.error) {
      record.error = state.error as string;
      record.phase = "failed";
    }

    if (state.completed) {
      record.phase = "done";
      record.completedAt = new Date().toISOString();
    }
  }

  // Read score history from results.tsv
  record.scoreHistory = readScoreHistory(pipelineId);

  return {
    pipelineId: record.pipelineId,
    phase: record.phase,
    stepLabel: record.stepLabel,
    iteration: record.iteration,
    estimatedMinutesRemaining: record.estimatedMinutesRemaining,
    score: record.score,
    scoreHistory: record.scoreHistory,
    logLines: record.logLines,
    error: record.error,
    completedAt: record.completedAt,
  };
}

/**
 * List all available artifacts for a completed pipeline.
 */
export async function getPipelineArtifacts(
  pipelineId: string,
): Promise<PipelineResult | null> {
  const record = pipelines.get(pipelineId);
  if (!record) return null;

  const artifacts = listArtifacts(pipelineId);

  // Count words from the manuscript if available
  let wordCount = 0;
  const manuscriptPath = path.join(getNovelDir(pipelineId), "manuscript.md");
  try {
    const content = fs.readFileSync(manuscriptPath, "utf-8");
    wordCount = content.split(/\s+/).filter(Boolean).length;
  } catch {
    // manuscript not yet available
  }

  // Pick the cover thumbnail
  const coverArtifact = artifacts.find((a) => a.type === "cover");
  const coverThumbnail = coverArtifact?.url;

  return {
    pipelineId,
    artifacts,
    wordCount,
    coverThumbnail,
  };
}

/**
 * Cancel a running pipeline.
 */
export async function cancelPipeline(pipelineId: string): Promise<boolean> {
  const record = pipelines.get(pipelineId);
  if (!record) return false;

  // Kill the process if we have a PID
  if (record.processPid) {
    try {
      process.kill(record.processPid, "SIGTERM");
    } catch {
      // process may already be dead
    }
  }

  // Note: remote-kill via SSH deferred (env-target wiring TBD)

  // Write cancellation to state
  const statePath = getStatePath(pipelineId);
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    state.phase = "failed";
    state.error = "Pipeline cancelled by user";
    state.completed = true;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch {
    // state file doesn't exist — write one
    const state = {
      phase: "failed",
      error: "Pipeline cancelled by user",
      completed: true,
      step: "Cancelled",
      iteration: record.iteration,
      estimatedMinutesRemaining: 0,
    };
    fs.mkdirSync(getNovelDir(pipelineId), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  record.phase = "failed";
  record.error = "Pipeline cancelled by user";
  record.logLines.push("Pipeline cancelled by user");

  return true;
}
