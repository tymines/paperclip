#!/usr/bin/env node
import { runOlympusServer } from "./index.js";

void runOlympusServer().catch((error) => {
  console.error("Failed to start Olympus MCP server:", error);
  process.exit(1);
});
