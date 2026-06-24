/**
 * seed-prompts.ts — seeds the Prompts library (Prompts tab).
 *
 * Two sources, both data-honest:
 *  1. CURATED fleet prompts — authored for Paperclip (superpowers patterns,
 *     GitHub-research dev prompts, agent role prompts). source = "Paperclip fleet".
 *  2. f/prompts.chat (CC0) — the public-domain community prompt set. We do NOT
 *     fabricate these: this importer reads a REAL local prompts.csv. If the file
 *     is absent the import is skipped (and logged) — nothing is invented.
 *     Provide the file via:  PROMPTS_CSV=/path/to/prompts.csv pnpm db:seed:prompts
 *     or drop it at packages/db/src/seeds/prompts.chat.csv and re-run.
 *
 * Idempotent: rows conflict-match on (source, title), so re-running is safe.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "./client.js";
import { resolveMigrationConnection } from "./migration-runtime.js";
import { prompts as promptsTable } from "./schema/index.js";

const PROMPTS_CHAT_URL = "https://github.com/f/prompts.chat";

function parseVariables(body: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([\w.\- ]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) set.add(m[1].trim());
  return [...set];
}

type Curated = {
  title: string;
  body: string;
  category: string;
  tags: string[];
};

// --- Curated, fleet-relevant prompts (authored for Paperclip) ---------------
const CURATED: Curated[] = [
  // ---- Superpowers workflow patterns ----
  {
    title: "Brainstorming Partner",
    category: "patterns",
    tags: ["superpowers", "ideation", "thinking"],
    body:
      "You are my brainstorming partner. We are exploring: {{topic}}.\n\n" +
      "Rules:\n" +
      "1. Generate a wide range of distinct ideas before converging — quantity first, then quality.\n" +
      "2. After each batch, group ideas into themes and point out the non-obvious ones.\n" +
      "3. Challenge my assumptions and offer at least one contrarian angle.\n" +
      "4. End with the 3 ideas you'd pursue first and why.\n\n" +
      "Constraints/context: {{constraints}}",
  },
  {
    title: "Write an Implementation Plan",
    category: "patterns",
    tags: ["superpowers", "planning", "spec"],
    body:
      "Write a clear implementation plan for the following task before any code is written.\n\n" +
      "Task: {{task}}\n\n" +
      "Produce:\n" +
      "1. Goal & success criteria (how we'll know it's done).\n" +
      "2. Assumptions and open questions.\n" +
      "3. Step-by-step plan, each step small and independently verifiable.\n" +
      "4. Files/components likely to change.\n" +
      "5. Risks and how to de-risk them.\n" +
      "6. A final verification step.\n\n" +
      "Keep it concrete. Do not start implementing until the plan is approved.",
  },
  {
    title: "Test-Driven Development (TDD)",
    category: "patterns",
    tags: ["superpowers", "tdd", "testing"],
    body:
      "Implement {{feature}} using strict TDD. Follow red-green-refactor:\n\n" +
      "1. RED: write the smallest failing test that expresses the next bit of behavior. Show the test and the failing output.\n" +
      "2. GREEN: write the minimum code to make it pass. Show the passing output.\n" +
      "3. REFACTOR: clean up without changing behavior; keep tests green.\n\n" +
      "Repeat one behavior at a time. Never write production code without a failing test first. " +
      "List edge cases up front and turn each into a test.",
  },
  {
    title: "Root-Cause Debugging",
    category: "patterns",
    tags: ["superpowers", "debugging", "coding"],
    body:
      "Help me find the ROOT CAUSE of this bug — not a band-aid.\n\n" +
      "Symptom: {{symptom}}\n" +
      "What I've observed: {{observations}}\n\n" +
      "Process:\n" +
      "1. Restate the expected vs. actual behavior.\n" +
      "2. Form 2-3 hypotheses ranked by likelihood.\n" +
      "3. For each, state the cheapest experiment that would confirm or rule it out.\n" +
      "4. Once the cause is isolated, propose the minimal correct fix AND a regression test.\n" +
      "Do not suggest changes until a hypothesis is supported by evidence.",
  },
  {
    title: "Adversarial Self-Verification",
    category: "patterns",
    tags: ["superpowers", "verification", "quality"],
    body:
      "Review your own previous answer as a skeptical critic whose job is to find what's wrong.\n\n" +
      "Answer under review: {{answer}}\n\n" +
      "1. List every claim that is unverified, hand-wavy, or could be false.\n" +
      "2. Check the logic and math step by step.\n" +
      "3. Identify missing edge cases or counterexamples.\n" +
      "4. Give a corrected, verified version. If something can't be verified, say so explicitly.",
  },
  // ---- Agent role / system prompts ----
  {
    title: "Agent Role: Senior Researcher",
    category: "agents",
    tags: ["agent-role", "research", "system-prompt"],
    body:
      "You are a senior research analyst on an autonomous agent fleet. Your job is to investigate " +
      "questions thoroughly and report findings the team can act on.\n\n" +
      "Operating principles:\n" +
      "- Fan out across multiple independent sources; prefer primary sources.\n" +
      "- Separate established facts from inference, and cite every non-obvious claim.\n" +
      "- Surface disagreements between sources rather than papering over them.\n" +
      "- Flag what you could NOT verify.\n" +
      "- Deliver a tight synthesis: answer first, then evidence, then open questions.\n\n" +
      "Current assignment: {{assignment}}",
  },
  {
    title: "Agent Role: Code Reviewer",
    category: "agents",
    tags: ["agent-role", "review", "system-prompt"],
    body:
      "You are a meticulous code reviewer on an autonomous engineering fleet. Review the diff for: " +
      "correctness, security, performance, readability, and test coverage.\n\n" +
      "Rules:\n" +
      "- Prioritize issues: blockers first, then nits.\n" +
      "- For each issue: file/line, why it matters, and a concrete fix.\n" +
      "- Call out missing tests and unhandled edge cases.\n" +
      "- Praise genuinely good patterns briefly.\n" +
      "- If the change is safe to merge, say so explicitly; otherwise list the blockers.\n\n" +
      "Diff / PR context: {{diff}}",
  },
  {
    title: "Agent Role: Planner / Architect",
    category: "agents",
    tags: ["agent-role", "planning", "system-prompt"],
    body:
      "You are a software architect agent. Given a goal, design an implementation strategy before " +
      "any code is written.\n\n" +
      "Deliver: critical files to touch, the sequence of changes, architectural trade-offs with a " +
      "recommendation, and the riskiest unknowns to resolve first. Prefer the simplest design that " +
      "meets the goal. Do not write the implementation — produce the plan.\n\n" +
      "Goal: {{goal}}",
  },
  // ---- Coding / dev (incl. GitHub-research finds) ----
  {
    title: "Explain This Codebase",
    category: "coding",
    tags: ["onboarding", "code-comprehension"],
    body:
      "Act as a staff engineer onboarding me to this code. For the following code/repo, explain:\n" +
      "1. What it does and the problem it solves.\n" +
      "2. The high-level architecture and main components.\n" +
      "3. The key entry points and data flow.\n" +
      "4. Anything surprising, risky, or non-idiomatic.\n" +
      "Use plain language and concrete references.\n\n" +
      "Code / repo: {{code}}",
  },
  {
    title: "Refactor With a Safety Net",
    category: "coding",
    tags: ["refactor", "testing"],
    body:
      "Refactor the following code to improve {{goal}} (e.g. readability, performance) WITHOUT " +
      "changing behavior.\n\n" +
      "1. First, describe the current behavior and add/identify characterization tests that lock it in.\n" +
      "2. Make the refactor in small, reviewable steps.\n" +
      "3. Show that the tests still pass after each step.\n\n" +
      "Code:\n{{code}}",
  },
  {
    title: "Generate a PR Description",
    category: "coding",
    tags: ["git", "pr", "writing"],
    body:
      "Write a clear pull-request description from the following changes.\n\n" +
      "Changes / diff summary: {{changes}}\n\n" +
      "Include: a one-line summary, a 'What & why' section, notable implementation details, how it " +
      "was tested, and any follow-ups or risks. Keep it skimmable.",
  },
  {
    title: "Regex Builder & Explainer",
    category: "coding",
    tags: ["regex", "utility"],
    body:
      "Build a regular expression that matches: {{requirement}}.\n\n" +
      "Provide: (1) the regex, (2) a plain-English breakdown of each part, (3) 3 matching and 3 " +
      "non-matching example strings, and (4) any flags needed. Target flavor: {{flavor}}.",
  },
  // ---- Research / productivity / writing ----
  {
    title: "Deep Research Synthesis",
    category: "research",
    tags: ["research", "synthesis"],
    body:
      "Research the question below and synthesize a cited briefing.\n\n" +
      "Question: {{question}}\n\n" +
      "Structure: (1) Direct answer up front. (2) Key findings with evidence and sources. " +
      "(3) Points of disagreement or uncertainty. (4) What remains unknown. " +
      "Be explicit about source quality and flag any claim you couldn't verify.",
  },
  {
    title: "Decision Doc (ADR)",
    category: "productivity",
    tags: ["decision", "adr", "doc"],
    body:
      "Draft an Architecture/Decision Record for: {{decision}}.\n\n" +
      "Sections: Context (forces at play), Options considered (with pros/cons), Decision (what and " +
      "why), Consequences (positive and negative), and Status. Be specific and honest about trade-offs.",
  },
  {
    title: "Meeting Notes to Action Items",
    category: "productivity",
    tags: ["meetings", "summary"],
    body:
      "Turn these raw meeting notes into a clean summary.\n\n" +
      "Notes: {{notes}}\n\n" +
      "Output: a 3-sentence TL;DR, decisions made, and a table of action items with owner and due " +
      "date where stated. Flag anything left unresolved.",
  },
  {
    title: "Summarize for an Audience",
    category: "writing",
    tags: ["summary", "communication"],
    body:
      "Summarize the following content for {{audience}} at a {{length}} length.\n\n" +
      "Lead with the single most important takeaway, then supporting points. Match the tone to the " +
      "audience and avoid jargon they wouldn't use.\n\n" +
      "Content: {{content}}",
  },
  {
    title: "Rubber-Duck Explainer",
    category: "learning",
    tags: ["learning", "explain"],
    body:
      "Explain {{concept}} to me three times: once for a curious 12-year-old, once for a smart " +
      "non-expert, and once for a practitioner. End with the one mental model that best unlocks it.",
  },
  // ---- Personas / roleplay (authored examples in the prompts.chat style) ----
  {
    title: "Act as a Pragmatic Tech Interviewer",
    category: "roleplay",
    tags: ["persona", "interview"],
    body:
      "I want you to act as a pragmatic technical interviewer for a {{role}} position. Ask me one " +
      "question at a time, wait for my answer, and adapt the difficulty to my responses. Don't write " +
      "explanations during the interview. Begin with a warm-up question.",
  },
  {
    title: "Act as a Devil's Advocate",
    category: "roleplay",
    tags: ["persona", "critical-thinking"],
    body:
      "Act as a constructive devil's advocate for my plan: {{plan}}. Argue the strongest honest case " +
      "against it — surface failure modes, hidden costs, and unstated assumptions — then tell me which " +
      "objections are most worth taking seriously.",
  },
];

function buildRow(c: Curated) {
  const variables = parseVariables(c.body);
  return {
    companyId: null,
    title: c.title,
    body: c.body,
    category: c.category,
    tags: c.tags,
    variables,
    isTemplate: variables.length > 0,
    source: "Paperclip fleet",
    sourceUrl: null as string | null,
    license: null as string | null,
    createdBy: "seed",
  };
}

// --- Minimal RFC-4180-ish CSV parser (handles quotes, commas, newlines) -----
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else if (ch === "\r") {
      // ignore; handled by \n
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function categorizeImported(act: string, body: string): string {
  const t = (act + " " + body).toLowerCase();
  if (/\b(developer|programmer|code|javascript|python|sql|terminal|git|api|regex|devops|engineer)\b/.test(t)) return "coding";
  if (/\b(write|writer|copy|essay|poet|novelist|story|editor|proofread|blog)\b/.test(t)) return "writing";
  if (/\b(market|advertis|seo|sales|startup|business|brand|product manager|recruiter)\b/.test(t)) return "business";
  if (/\b(teacher|tutor|explain|coach|instructor|professor|language|learn)\b/.test(t)) return "learning";
  if (/\b(research|analy|scientist|statistic|investor|financial)\b/.test(t)) return "research";
  return "roleplay"; // most "Act as ..." persona prompts
}

async function importPromptsChatCsv(db: ReturnType<typeof createDb>): Promise<number> {
  const fromEnv = process.env.PROMPTS_CSV;
  const argPath = process.argv[2];
  const defaultPath = fileURLToPath(new URL("./seeds/prompts.chat.csv", import.meta.url));
  const path = fromEnv || argPath || (existsSync(defaultPath) ? defaultPath : null);
  if (!path || !existsSync(path)) {
    console.log(
      "[prompts.chat] No CC0 prompts.csv found — skipping that import (curated prompts still seeded).\n" +
      "             To import: PROMPTS_CSV=/path/to/prompts.csv pnpm db:seed:prompts",
    );
    return 0;
  }
  const text = await readFile(path, "utf8");
  const rows = parseCsv(text);
  if (!rows.length) return 0;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const actIdx = header.indexOf("act");
  const promptIdx = header.indexOf("prompt");
  const dataRows = actIdx >= 0 && promptIdx >= 0 ? rows.slice(1) : rows;
  const ai = actIdx >= 0 ? actIdx : 0;
  const pi = promptIdx >= 0 ? promptIdx : 1;
  let inserted = 0;
  for (const r of dataRows) {
    const act = (r[ai] || "").trim();
    const body = (r[pi] || "").trim();
    if (!act || !body) continue;
    const variables = parseVariables(body);
    const res = await db
      .insert(promptsTable)
      .values({
        companyId: null,
        title: act,
        body,
        category: categorizeImported(act, body),
        tags: ["prompts.chat", "community"],
        variables,
        isTemplate: variables.length > 0,
        source: "f/prompts.chat (CC0)",
        sourceUrl: PROMPTS_CHAT_URL,
        license: "CC0-1.0",
        createdBy: "seed",
      })
      .onConflictDoNothing({ target: [promptsTable.source, promptsTable.title] })
      .returning({ id: promptsTable.id });
    inserted += res.length;
  }
  console.log(`[prompts.chat] imported ${inserted} CC0 prompt(s) from ${path}`);
  return inserted;
}

async function main() {
  const resolved = await resolveMigrationConnection();
  const db = createDb(resolved.connectionString);
  try {
    let curatedInserted = 0;
    for (const c of CURATED) {
      const res = await db
        .insert(promptsTable)
        .values(buildRow(c))
        .onConflictDoNothing({ target: [promptsTable.source, promptsTable.title] })
        .returning({ id: promptsTable.id });
      curatedInserted += res.length;
    }
    console.log(`[curated] inserted ${curatedInserted} new fleet prompt(s) (of ${CURATED.length}).`);
    await importPromptsChatCsv(db);
    console.log("Prompt seeding complete.");
  } finally {
    await resolved.stop();
  }
}

await main();
