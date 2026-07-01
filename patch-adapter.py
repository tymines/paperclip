#!/usr/bin/env python3
"""Patch the hermes-paperclip-adapter to read state.db for token usage and cost."""
import re

EXECUTE_PATH = "node_modules/.pnpm/hermes-paperclip-adapter@0.2.0/node_modules/hermes-paperclip-adapter/dist/server/execute.js"

with open(EXECUTE_PATH) as f:
    content = f.read()

# ── 1. Replace session-id logging block with state.db lookup ──────────
old_session_block = re.escape("""    if (parsed.sessionId) {
        await ctx.onLog("stdout", `[hermes] Session: ${parsed.sessionId}\\n`);
    }""")

new_session_block = r"""    let stateDbUsage = null;
    let stateDbCostUsd = null;
    if (parsed.sessionId) {
        await ctx.onLog("stdout", "[hermes] Session: " + parsed.sessionId + "\n");
        // Read Hermes state.db for authoritative token usage and cost
        try {
            const hermesHome = process.env.HERMES_HOME || require("path").join(require("os").homedir(), ".hermes");
            const stateDbPath = require("path").join(hermesHome, "state.db");
            const { execFileSync } = require("node:child_process");
            const sessionRow = execFileSync("sqlite3", [
                stateDbPath,
                "-separator", "|",
                "SELECT input_tokens, cache_read_tokens, output_tokens, estimated_cost_usd, actual_cost_usd, model, billing_provider FROM sessions WHERE id = '" + parsed.sessionId + "'"
            ], { encoding: "utf8", timeout: 5000 }).trim();
            if (sessionRow) {
                const parts = sessionRow.split("|");
                const inTok = parseInt(parts[0], 10) || 0;
                const cachedTok = parseInt(parts[1], 10) || 0;
                const outTok = parseInt(parts[2], 10) || 0;
                const estCost = parseFloat(parts[3]);
                const actCost = parseFloat(parts[4]);
                const dbModel = (parts[5] || "").trim() || null;
                const dbProvider = (parts[6] || "").trim() || null;
                if (inTok > 0 || outTok > 0) {
                    stateDbUsage = { inputTokens: inTok, outputTokens: outTok, cachedInputTokens: cachedTok };
                }
                if (!isNaN(actCost) && actCost > 0) {
                    stateDbCostUsd = actCost;
                } else if (!isNaN(estCost) && estCost > 0) {
                    stateDbCostUsd = estCost;
                }
                if (dbModel) parsed.dbModel = dbModel;
                if (dbProvider) parsed.dbProvider = dbProvider;
                const costStr = (stateDbCostUsd !== null && stateDbCostUsd !== undefined) ? stateDbCostUsd.toFixed(4) : "0";
                await ctx.onLog("stdout", "[hermes] StateDB: " + inTok + " in, " + cachedTok + " cached, " + outTok + " out, cost $" + costStr + "\n");
            }
        } catch (dbErr) {
            await ctx.onLog("stdout", "[hermes] StateDB lookup skipped: " + dbErr.message + "\n");
        }
    }"""

content = re.sub(old_session_block, new_session_block, content)

# ── 2. Update executionResult to use db-derived provider/model ──────────
old_result_block = re.escape("""    const executionResult = {
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        provider: provider || null,
        model: model || null,
    };""")

new_result_block = """    const executionResult = {
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        provider: parsed.dbProvider || provider || null,
        model: parsed.dbModel || model || null,
    };"""

content = re.sub(old_result_block, new_result_block, content)

# ── 3. Prefer state.db usage/cost over stdout-parsed ──────────
old_usage_block = re.escape("""    if (parsed.usage) {
        executionResult.usage = parsed.usage;
    }
    if (parsed.costUsd !== undefined) {
        executionResult.costUsd = parsed.costUsd;
    }""")

new_usage_block = """    // Prefer state.db data over stdout-parsed values
    if (stateDbUsage) {
        executionResult.usage = stateDbUsage;
    } else if (parsed.usage) {
        executionResult.usage = parsed.usage;
    }
    if (stateDbCostUsd !== null) {
        executionResult.costUsd = stateDbCostUsd;
    } else if (parsed.costUsd !== undefined) {
        executionResult.costUsd = parsed.costUsd;
    }"""

content = re.sub(old_usage_block, new_usage_block, content)

# ── 4. Write back ──────────
with open(EXECUTE_PATH, "w") as f:
    f.write(content)

print("DONE - patched " + EXECUTE_PATH)
