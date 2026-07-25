# Book Studio Review+Locks — Forge dispatch blocker

**Version:** 1.0  
**Branch:** `work/book-studio-review-locks-20260725`  
**Resume base:** `2a644ecbdddf2008bd8ee6eb9fb1906e377c55d6`  
**Verdict:** **NO_VERDICT**

## Intended dispatch

Forge (`kimi-k2.7-code`) was selected for the remaining backend lane after Gate 1:

- enforcement across all eight AI write paths;
- lock PATCH and passage-lock endpoints;
- review/revision create, accept, and reject routes;
- human-only lock actor guard;
- mutation activity logging;
- Locked Content decision-card response;
- strict RED→GREEN evidence for all six §7 acceptance rows.

This exceeds one session because it spans DB/shared/server contracts, eight write-path enforcement points, multiple company-scoped mutation routes, actor authorization, activity logs, and a non-vacuous acceptance matrix.

## Mandatory unattended-execution canary

A fresh temporary git repository was initialized and the Forge wrapper was instructed to create `canary.txt` containing `CANARY_OK`, then read it back.

Observed result:

```text
wrapper rejected Hermes-style `-z`
Aider started non-interactively
provider returned RateLimitError: account suspended due to insufficient balance
process returned rc=0
required canary.txt was absent
```

The raw log remains local at `/tmp/forge-book-studio-canary.log`; it is not committed because the provider error included credential-identifying material. No secret value is reproduced here.

## Stop condition

Per Fleet Core and the CLI-agent canary requirement, Forge was **not dispatched** into the Book Studio worktree. A clean process exit without the required side effect is not execution evidence. No feature code was changed after the failed canary.

Resume point: fund either the authorized Coder 3 or Forge Kimi account, confirm the correct non-interactive wrapper invocation, rerun the canary, then dispatch into `/Users/augi/paperclip-worktrees/book-studio-review-locks-20260725` from `2a644ecbd`.
