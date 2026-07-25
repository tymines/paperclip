# Book Studio Review+Locks — Coder 3 dispatch blocker

**Version:** 1.0  
**Branch:** `work/book-studio-review-locks-20260725`  
**Resume base:** `7eb954dc9b29a3a555fb076b90c6159e0e423e95`  
**Feature baseline:** `2a644ecbdddf2008bd8ee6eb9fb1906e377c55d6`  
**Verdict:** **NO_VERDICT**

## Intended dispatch

Coder 3 (`hermes-coder-3`, `kimi-k3` through `kimi-coding`) was selected for the remaining backend lane after Gate 1:

- enforcement across all eight AI write paths;
- lock PATCH and passage-lock endpoints;
- review/revision create, accept, and reject routes;
- human-only lock actor guard;
- mutation activity logging;
- Locked Content decision-card response;
- strict RED→GREEN evidence for all six §7 acceptance rows.

This exceeds one session because it spans DB/shared/server contracts, eight write-path enforcement points, multiple company-scoped mutation routes, actor authorization, activity logs, and a non-vacuous acceptance matrix.

## Mandatory unattended-execution canary

A fresh temporary git repository was initialized at `/tmp/coder3-book-studio-canary.69wpJY`. Coder 3 was launched with:

```sh
hermes -p hermes-coder-3 -z '<scratch-repo canary instruction>' --accept-hooks
```

The instruction required the worker to use its terminal tool to create `canary.txt` containing `CANARY_OK`, read it back, and reply exactly `CANARY_OK`.

Observed result:

```text
profile: hermes-coder-3
model: kimi-k3 (kimi-coding)
process rc: 0
provider response: HTTP 401: Invalid Authentication
required canary.txt: absent
```

A clean process exit without the required side effect is not execution evidence.

## Stop condition

Per Fleet Core and the unattended-worker canary requirement, Coder 3 was **not dispatched** into the Book Studio worktree. No feature code was changed.

Resume point: repair the `kimi-coding` authentication available to `/Users/augi/.hermes/profiles/hermes-coder-3`, rerun the scratch-repository canary, then dispatch into `/Users/augi/paperclip-worktrees/book-studio-review-locks-20260725`. The feature baseline remains `2a644ecbd`; commits after it are evidence-only blocker records.
