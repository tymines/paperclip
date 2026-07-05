/**
 * Gym Studio evaluator — uses Gemini 2.5 Flash to score agent responses.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GymEvalUnconfiguredError extends Error {
  constructor() {
    super("Gemini API key not configured (GEMINI_API_KEY / GOOGLE_API_KEY)");
    this.name = "GymEvalUnconfiguredError";
  }
}

interface GymEvalSuite {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  testCases: Array<{
    id: string;
    prompt: string;
    expectedResponse: string;
    rubric: string;
    weight: number;
  }>;
  createdBy: string;
}

interface RunEvalResult {
  scores: Array<{
    testCaseId: string;
    score: number;
    reasoning: string;
    latencyMs: number;
  }>;
}

function geminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

/**
 * Run evaluation on a suite using Gemini 2.5 Flash.
 * Evaluates up to 5 test cases sequentially.
 */
export async function runEvaluation(params: {
  suite: GymEvalSuite;
  promptCandidate?: { id: string };
}): Promise<RunEvalResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) {
    throw new GymEvalUnconfiguredError();
  }

  const sysPrompt =
    "You are an expert AI evaluation judge. Your task is to score an AI agent's " +
    "response to a given prompt against an expected (ideal) response. " +
    `You evaluate against a provided rubric. Score each response from 0 to 100 ` +
    `where 0 is completely wrong and 100 is perfect. Provide a brief reasoning ` +
    `for your score. Be objective and consistent.`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: sysPrompt,
  });

  const scores: RunEvalResult["scores"] = [];
  const testCases = params.suite.testCases.slice(0, 5); // v1 limit

  for (const tc of testCases) {
    const startTime = Date.now();
    const evalPrompt =
      `## Test Case\n\n` +
      `**Prompt:**\n${tc.prompt}\n\n` +
      `**Expected Response:**\n${tc.expectedResponse}\n\n` +
      `**Rubric:**\n${tc.rubric}\n\n` +
      `Evaluate the expected response against the rubric above. ` +
      `Respond with ONLY a JSON object in this exact format:\n` +
      `{"score": <0-100 integer>, "reasoning": "<brief explanation>"}`;

    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: evalPrompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 500,
        },
      });

      const latencyMs = Date.now() - startTime;
      const text = result.response.text().trim();

      // Parse the JSON response
      let score = 50;
      let reasoning = "Could not parse evaluation response";
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.score === "number") {
          score = Math.round(Math.max(0, Math.min(100, parsed.score)));
        }
        if (typeof parsed.reasoning === "string") {
          reasoning = parsed.reasoning;
        }
      } catch {
        // Try to extract score from raw text
        const scoreMatch = text.match(/["']?score["']?\s*[:=]\s*(\d+)/i);
        if (scoreMatch) {
          score = Math.round(Math.max(0, Math.min(100, parseInt(scoreMatch[1], 10))));
        }
        reasoning = text.slice(0, 200);
      }

      scores.push({ testCaseId: tc.id, score, reasoning, latencyMs });
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      scores.push({
        testCaseId: tc.id,
        score: 0,
        reasoning: `Evaluation error: ${err.message || String(err)}`,
        latencyMs,
      });
    }
  }

  return { scores };
}
