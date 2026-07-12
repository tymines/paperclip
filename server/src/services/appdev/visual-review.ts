/**
 * VFG-2 — vision-model review of rendered screenshots against reference packs
 * (spec Part 4.4/4.5). Port of the root-level vision-reviewer.py prototype,
 * moved OFF OpenAI per Tyler's model rules:
 *
 *   - Reviewer runs on Claude vision (Anthropic API, direct fetch — same
 *     no-SDK pattern as design-chat.ts's Gemini calls).
 *   - Decorrelation rule (4.5): the reviewer model family must differ from the
 *     lane that generated the UI code. DeepSeek writes → Claude reviews. The
 *     caller passes generatorModelFamily and we hard-refuse a same-family
 *     review rather than let a lane grade its own homework.
 *   - Output is JSON-only against a fixed rubric schema; non-conforming output
 *     gets ONE retry, then hard fail (spec 4.4.4).
 *   - Thresholds (v1, tunable): any dimension ≤ 4 → fail; overall < 7 on any
 *     screen → fail; 7–7.9 → borderline; ≥ 8 everywhere → pass.
 *
 * vision-reviewer.py stays untouched on disk as provenance; nothing imports it.
 */

export const VFG_REVIEWER_MODEL_DEFAULT = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class VfgModelUnconfiguredError extends Error {
  constructor() {
    super("VFG reviewer model not configured — set ANTHROPIC_API_KEY (or CLAUDE_API_KEY).");
    this.name = "VfgModelUnconfiguredError";
  }
}

export class VfgDecorrelationError extends Error {
  constructor(family: string) {
    super(
      `VFG decorrelation rule (spec 4.5): reviewer family 'claude' must differ from generator family '${family}'. Never let a lane visually grade its own homework.`,
    );
    this.name = "VfgDecorrelationError";
  }
}

export function anthropicApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY || null;
}

export interface VfgScreenInput {
  screenTag: string;
  /** strict | layout | content — passed into the prompt (spec 4.6). */
  comparisonMode: string;
  /** ignore/floating regions so the reviewer knows what is legitimately dynamic. */
  regions: Array<Record<string, unknown>>;
  /** base64 PNG of the rendered build screenshot. */
  renderB64: string;
  /** base64 PNG reference(s): concept art or clickable-mock render. */
  referenceB64s: string[];
}

export interface VfgReviewInput {
  appName: string;
  screens: VfgScreenInput[];
  /** style_tokens JSON from the reference pack — palette checked against named hex values. */
  styleTokens?: Record<string, unknown>;
  /** Model family that produced the UI code (e.g. 'deepseek'). Enforces 4.5. */
  generatorModelFamily?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
}

export interface VfgRubricScore {
  layout_fidelity: number;
  palette_match: number;
  asset_quality: number;
  typography: number;
  spacing_polish: number;
  overall: number;
  notes: string;
}

export interface VfgReviewResult {
  verdict: "pass" | "fail" | "borderline";
  rubricScores: Record<string, VfgRubricScore>;
  worstScreen: string | null;
  summary: string;
  reviewerModel: string;
  /** Full request/response for the audit trail (proof, not summary). */
  raw: Record<string, unknown>;
}

const RUBRIC_DIMENSIONS = [
  "layout_fidelity",
  "palette_match",
  "asset_quality",
  "typography",
  "spacing_polish",
  "overall",
] as const;

/** Deterministic threshold application (spec 4.4) — never left to the model. */
export function applyThresholds(scores: Record<string, VfgRubricScore>): {
  verdict: "pass" | "fail" | "borderline";
  worstScreen: string | null;
} {
  let verdict: "pass" | "fail" | "borderline" = "pass";
  let worstScreen: string | null = null;
  let worstOverall = Infinity;
  for (const [tag, s] of Object.entries(scores)) {
    if (s.overall < worstOverall) {
      worstOverall = s.overall;
      worstScreen = tag;
    }
    for (const dim of RUBRIC_DIMENSIONS) {
      if (dim !== "overall" && s[dim] <= 4) verdict = "fail";
    }
    if (s.overall < 7) verdict = "fail";
    else if (s.overall < 8 && verdict !== "fail") verdict = "borderline";
  }
  return { verdict, worstScreen };
}

function reviewPrompt(input: VfgReviewInput): string {
  const screenList = input.screens
    .map(
      (s) =>
        `- "${s.screenTag}" (comparison_mode=${s.comparisonMode}; dynamic regions: ${
          s.regions.length ? JSON.stringify(s.regions) : "none declared"
        })`,
    )
    .join("\n");
  return [
    `You are the Visual Fidelity Gate reviewer for the app "${input.appName}".`,
    `You are shown, per screen, the RENDERED BUILD screenshot followed by its REFERENCE image(s) (concept art / clickable-mock render).`,
    ``,
    `Screens under review:`,
    screenList,
    ``,
    input.styleTokens
      ? `Style tokens (contract — palette_match is scored against these NAMED hex values, not vibes):\n${JSON.stringify(input.styleTokens)}`
      : `No style tokens provided — score palette_match against the reference images.`,
    ``,
    `First answer the blunt question for each screen: "Would a user shown the concept and this build believe they are the same app?"`,
    `Ignore differences inside declared ignore-regions; tolerate position shifts inside floating regions.`,
    `comparison_mode=strict → pixel-faithful expectations; layout → structure over exact pixels; content → text presence/correctness over pixels.`,
    ``,
    `Return STRICT JSON only (no markdown fences, no prose outside JSON):`,
    `{`,
    `  "screens": {`,
    `    "<screen_tag>": {`,
    `      "layout_fidelity": 1-10, "palette_match": 1-10, "asset_quality": 1-10,`,
    `      "typography": 1-10, "spacing_polish": 1-10, "overall": 1-10,`,
    `      "notes": "specific, actionable gaps"`,
    `    }, ...`,
    `  },`,
    `  "summary": "one paragraph, brutally honest"`,
    `}`,
    ``,
    `Be brutally honest. Do not assume features exist; look carefully. A build can pass every unit test and still look wrong.`,
  ].join("\n");
}

function parseRubric(text: string, expectedTags: string[]): {
  scores: Record<string, VfgRubricScore>;
  summary: string;
} | null {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return null;
  }
  const obj = parsed as { screens?: Record<string, Record<string, unknown>>; summary?: string };
  if (!obj || typeof obj !== "object" || !obj.screens) return null;
  const scores: Record<string, VfgRubricScore> = {};
  for (const tag of expectedTags) {
    const s = obj.screens[tag];
    if (!s) return null;
    const num = (k: string): number | null => {
      const v = s[k];
      return typeof v === "number" && v >= 1 && v <= 10 ? v : null;
    };
    const dims = {
      layout_fidelity: num("layout_fidelity"),
      palette_match: num("palette_match"),
      asset_quality: num("asset_quality"),
      typography: num("typography"),
      spacing_polish: num("spacing_polish"),
      overall: num("overall"),
    };
    if (Object.values(dims).some((v) => v === null)) return null;
    scores[tag] = {
      ...(dims as Record<keyof typeof dims, number>),
      notes: typeof s.notes === "string" ? s.notes : "",
    };
  }
  return { scores, summary: typeof obj.summary === "string" ? obj.summary : "" };
}

async function callClaude(
  model: string,
  key: string,
  prompt: string,
  screens: VfgScreenInput[],
): Promise<string> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  for (const s of screens) {
    content.push({ type: "text", text: `SCREEN "${s.screenTag}" — RENDERED BUILD:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: s.renderB64 },
    });
    s.referenceB64s.forEach((ref, i) => {
      content.push({ type: "text", text: `SCREEN "${s.screenTag}" — REFERENCE ${i + 1}:` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: ref },
      });
    });
  }

  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      temperature: 0,
      system:
        "You are a strict visual fidelity reviewer. Respond only with valid JSON matching the requested schema.",
      messages: [{ role: "user", content }],
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`VFG reviewer request failed (${resp.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
  return (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

/**
 * Run a VFG-2 review. Deterministic thresholds applied in code; the model only
 * scores. One retry on schema-nonconforming output, then hard fail (spec 4.4).
 */
export async function runVisualReview(input: VfgReviewInput): Promise<VfgReviewResult> {
  const env = input.env ?? process.env;
  const key = anthropicApiKey(env);
  if (!key) throw new VfgModelUnconfiguredError();

  const family = (input.generatorModelFamily ?? "").toLowerCase();
  if (family.includes("claude") || family.includes("anthropic")) {
    throw new VfgDecorrelationError(input.generatorModelFamily ?? "claude");
  }

  const model = input.model?.trim() || env.VFG_REVIEW_MODEL || VFG_REVIEWER_MODEL_DEFAULT;
  const prompt = reviewPrompt(input);
  const expectedTags = input.screens.map((s) => s.screenTag);

  let text = await callClaude(model, key, prompt, input.screens);
  let parsed = parseRubric(text, expectedTags);
  let retried = false;
  if (!parsed) {
    retried = true;
    text = await callClaude(
      model,
      key,
      prompt + "\n\nREMINDER: your previous output did not validate. Return ONLY the JSON object, every screen_tag present, every score a number 1-10.",
      input.screens,
    );
    parsed = parseRubric(text, expectedTags);
  }
  if (!parsed) {
    throw new Error(
      "VFG review hard-failed: reviewer output did not conform to the rubric schema after one retry (spec 4.4.4).",
    );
  }

  const { verdict, worstScreen } = applyThresholds(parsed.scores);
  return {
    verdict,
    rubricScores: parsed.scores,
    worstScreen,
    summary: parsed.summary,
    reviewerModel: model,
    raw: {
      model,
      retried,
      prompt_chars: prompt.length,
      screens: expectedTags,
      response_text: text,
    },
  };
}
