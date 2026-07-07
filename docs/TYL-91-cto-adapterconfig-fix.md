# TYL-91: Fix CTO adapterConfig for Paperclip Routing

## Problem
CTO agent (`3228cdb1`) has empty `adapterConfig` with `adapterType: "codex_local"`, status: error. This blocks 8 issues: TYL-46-51, TYL-59, TYL-72, TYL-75.

## Root Cause
The CTO agent was configured with `codex_local` adapter but no valid adapter configuration, causing routing failures.

## Solution
Migrate CTO agent to `openclaw_gateway` adapter with proper `sessionKey=cto` configuration (same pattern as COO fix TYL-69).

## Required Changes

### Database Update (via Paperclip API or Admin UI)

**Agent ID:** `3228cdb1`

**Current (Broken):**
```json
{
  "adapterType": "codex_local",
  "adapterConfig": {}
}
```

**Fixed:**
```json
{
  "adapterType": "openclaw_gateway",
  "adapterConfig": {
    "sessionKey": "cto",
    "sessionKeyStrategy": "fixed",
    "role": "operator",
    "scopes": ["operator.admin"],
    "headers": {
      "x-openclaw-token": "<GATEWAY_TOKEN>"
    }
  }
}
```

## Implementation Options

### Option 1: Paperclip Admin UI (Recommended)
1. Navigate to Agent Management → CTO agent (3228cdb1)
2. Change Adapter Type from `codex_local` to `OpenClaw Gateway`
3. Set Session Key to `cto`
4. Set Session Key Strategy to `fixed`
5. Add Gateway auth token
6. Save

### Option 2: Direct API Call
```bash
curl -X PATCH "https://paperclip-api.example.com/agents/3228cdb1" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "adapterType": "openclaw_gateway",
    "adapterConfig": {
      "sessionKey": "cto",
      "sessionKeyStrategy": "fixed",
      "role": "operator",
      "scopes": ["operator.admin"]
    }
  }'
```

## Verification
After fix:
1. CTO agent status should change from `error` to `active`
2. Blocked issues (TYL-46-51, TYL-59, TYL-72, TYL-75) should become unblocked
3. CTO agent should be able to receive and process tasks

## Related
- TYL-69: COO adapterConfig fix (same pattern)
- TYL-68: Context issue
