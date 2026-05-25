/**
 * Mock data for the Jarvis HUD. Commit 1 ships the visual independent
 * of real data wiring — replaced in Commit 3 (Augi-as-brain) with live
 * queries against /api/companies/{id}/cost-watcher, /agents, /issues, etc.
 */

export interface JarvisCapability {
  label: string;
  value: number; // 0-100
}

export interface JarvisFleetAgent {
  name: string;
  task: string;
  status: "online" | "busy" | "idle" | "alert";
}

export interface JarvisChatMessage {
  id: string;
  author: "user" | "agent";
  authorLabel: string;
  text: string;
  timestamp: string;
  /**
   * Set when this turn dispatched a peer-agent delegation. The chat
   * panel renders a "Delegated" chip on the bubble; the polling loop
   * watches `delegationId` to know when to append a follow-up result.
   */
  delegationId?: string | null;
  delegationAgent?: string | null;
  delegationStatus?: "queued" | "running" | "completed" | "failed" | null;
}

export const MOCK_CAPABILITIES: JarvisCapability[] = [
  { label: "Advanced Reasoning", value: 98 },
  { label: "Web Intelligence", value: 87 },
  { label: "Code Generation", value: 93 },
  { label: "Memory & Recall", value: 82 },
  { label: "Predictive Analysis", value: 79 },
  { label: "Multilingual Support", value: 95 },
];

export const MOCK_FLEET: JarvisFleetAgent[] = [
  { name: "Augi", task: "briefing tyler", status: "online" },
  { name: "Hermes", task: "research · 3 active", status: "busy" },
  { name: "August", task: "remote · paperclip-ui", status: "busy" },
  { name: "Codex", task: "PR #214 open", status: "online" },
  { name: "Intake", task: "2 in queue", status: "online" },
  { name: "Luke", task: "standby", status: "idle" },
  { name: "Cost-W", task: "2 alerts · openai", status: "alert" },
  { name: "Council", task: "quorum 4/5", status: "online" },
];

export const MOCK_INITIAL_CHAT: JarvisChatMessage[] = [
  {
    id: "m1",
    author: "agent",
    authorLabel: "Jarvis · 23:42",
    text:
      "Good evening, Tyler. Pulling up today's stats.\n• Revenue MTD +12.4% to $84.2k\n• 5 blocked tasks · 2 need you\n• Top burn agent: hermes ($18.40 / hr)\n\nWhat would you like me to handle first?",
    timestamp: "23:42",
  },
  {
    id: "m2",
    author: "user",
    authorLabel: "You · 23:43",
    text: "Show me the latest data and summarize key insights.",
    timestamp: "23:43",
  },
  {
    id: "m3",
    author: "agent",
    authorLabel: "Jarvis · 23:43",
    text:
      "Analyzing 27 sources across 4 regions, customer feedback, sentiment, and social signals…\n• Sentiment +8.2pp WoW\n• Customer satisfaction 92%\n• Enterprise segment growth +24.7%\n• Retention dipped slightly to 89%\n\nWould you like a detailed breakdown by region or product category?",
    timestamp: "23:43",
  },
];

export const MOCK_BRIEFING = {
  revenueMtd: "$84.2k",
  revenueDelta: "↑ 12.4% vs Apr",
  activeRuns: 37,
  activeRunsNote: "9 long-running",
  blockedTasks: 5,
  blockedNote: "2 on you",
  fleetUp: "8/9",
  fleetNote: "↑ 99.4% uptime 7d",
  uptime: "1.03h",
  contextSize: "128K",
  agentFocus: "Quantum Analysis",
  voiceTierLabel: "Tier 3 · Browser",
  agentModel: "Augi · opus-4-7",
};
