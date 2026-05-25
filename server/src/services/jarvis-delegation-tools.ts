import type { PeerAgentId } from "./jarvis-delegation.js";

/**
 * Anthropic-shape tool definitions for peer-agent delegation.
 *
 * Jarvis sees these as first-class verbs — "have Hermes research X",
 * "send August to dig into logs", "ask Codex to refactor Y" all map to
 * one of these tool calls. The brain runs the tool, persists a row to
 * jarvis_delegations, and replies with a natural acknowledgment.
 *
 * Shape matches Anthropic's `tools` array verbatim
 * (https://docs.anthropic.com/claude/docs/tool-use). OpenAI-compatible
 * providers (DeepSeek, OpenAI) get a converted view via
 * `toOpenAiTools()`.
 */

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: readonly string[];
        items?: { type: string };
      }
    >;
    required?: string[];
  };
}

export const DELEGATION_TOOLS: AnthropicToolDef[] = [
  {
    name: "delegate_to_hermes",
    description:
      "Hand a task off to Hermes (research, audits, parallel UI work, anything that benefits from a separate thinking pass). Use this when Tyler says 'have Hermes...', 'send Hermes to...', or when the task is a chunky research / audit job you'd otherwise hold the chat for. Returns immediately with a tracking id; Hermes posts the result back later. Brief acknowledgment first (\"On it — handing this to Hermes\"), then call this tool.",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "The full task for Hermes — phrase it as instructions Hermes can act on cold, not a reference to this conversation.",
        },
        urgency: {
          type: "string",
          enum: ["low", "normal", "high"],
          description: "How fast Hermes should prioritize this. Default normal.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "delegate_to_august",
    description:
      "Hand a task off to August (remote Mac mini over Tailscale). Use for parallel ops, remote-network work, or when local capacity is saturated. Note: August may be unreachable right now — check the daemon log if the tool returns reachable=false. If August is down, offer to route to Hermes instead.",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The full task for August. Self-contained instructions.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "delegate_to_codex",
    description:
      "Hand a task off to Codex (the codex-sidecar). Use for code execution, sandboxed builds, file operations on a repo. Specify cwd when the task should run in a specific repo.",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The coding task for Codex. Include file paths and acceptance criteria.",
        },
        cwd: {
          type: "string",
          description: "Absolute path to the repo Codex should work in. Defaults to ~/paperclip.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "delegate_to_content",
    description:
      "Hand a task off to the content desk. Use for copywriting, blog posts, captions, scripts. List platforms when the copy needs platform-specific shaping (X vs LinkedIn vs blog).",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The copywriting brief. Include audience, tone, and length target.",
        },
        platforms: {
          type: "array",
          items: { type: "string" },
          description: "Optional platforms the copy targets (twitter, linkedin, instagram, blog, etc).",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "delegate_to_social",
    description:
      "Hand a task off to the social desk. Use for posting, scheduling, social media operations. The social desk has the platform credentials wired — don't ask Tyler to log in.",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The social-media task (e.g. 'schedule this post for tomorrow 9am on LinkedIn').",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "delegate_to_researcher",
    description:
      "Hand a task off to the research desk. Use for deep dives, market research, competitive analysis. Depth controls how thorough the dig is — quick is a 5-minute scan, deep is a 30-minute writeup.",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The research question. Be specific — 'who are X's competitors and how do they price?' beats 'research X'.",
        },
        depth: {
          type: "string",
          enum: ["quick", "deep"],
          description: "quick = 5-min scan, deep = thorough writeup. Default quick.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "dispatch_claude_code",
    description:
      "Spawn a Claude Code subagent for a large coding task needing full repo access (multi-file refactors, large feature builds, things that don't fit in a sidecar). Always pass cwd. Use sparingly — it's the heaviest delegation.",
    input_schema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The coding task for the Claude Code subagent. Self-contained.",
        },
        cwd: {
          type: "string",
          description: "Absolute path to the repo. Required.",
        },
      },
      required: ["task", "cwd"],
    },
  },
];

/** Map an Anthropic tool name back to its peer identity. */
export const TOOL_NAME_TO_PEER: Record<string, PeerAgentId> = {
  delegate_to_hermes: "hermes",
  delegate_to_august: "august",
  delegate_to_codex: "codex",
  delegate_to_content: "content",
  delegate_to_social: "social",
  delegate_to_researcher: "researcher",
  dispatch_claude_code: "claude-code",
};

/** Convert to OpenAI / DeepSeek shape for those providers' chat-completion APIs. */
export function toOpenAiTools(): Array<{
  type: "function";
  function: { name: string; description: string; parameters: AnthropicToolDef["input_schema"] };
}> {
  return DELEGATION_TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}
