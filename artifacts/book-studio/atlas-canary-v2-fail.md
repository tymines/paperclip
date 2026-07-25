# Book Studio Review+Locks — Atlas DeepSeek canary v2

**Version:** 2.0  
**Date:** 2026-07-25  
**Target branch:** `work/book-studio-review-locks-20260725`  
**Target worktree:** `/Users/augi/paperclip-worktrees/book-studio-review-locks-20260725`  
**Atlas binding:** profile `atlas`, provider `deepseek`, model `deepseek-v4-pro`  
**Verdict:** **FAIL**

## Why the lane merits dispatch

The remaining backend lane exceeds one session: it spans DB/shared/server contracts, eight AI write-path enforcement points, company-scoped lock and review routes, human-actor authorization, activity logging, a decision-card response, and six non-vacuous §7 RED→GREEN acceptance rows. Tyler explicitly selected Atlas for this lane after DeepSeek funding was restored.

## Mandatory scratch-repository canary

Invocation:

```sh
D=$(mktemp -d /tmp/atlas-book-studio-canary.XXXXXX)
git -C "$D" init -q
cd "$D"
hermes -p atlas -z 'In this scratch git repository, use your terminal tool to run exactly: printf CANARY_OK > canary.txt. Then read canary.txt and reply exactly CANARY_OK. Do not change anything else.' --accept-hooks
```

Observed scratch directory:

```text
/tmp/atlas-book-studio-canary.hDmKCV
```

Observed process/result:

```text
process rc=0
assistant reply=CANARY_OK
required canary.txt=MISSING
```

Live profile readback before the canary:

```yaml
model:
  provider: deepseek
  default: deepseek-v4-pro
approvals:
  mode: manual
```

No Atlas/aider/deepseek worker process remained after the earlier stale-wrapper probe timed out. The Book Studio worktree remained clean and no feature code was changed.

## Verdict and stop condition

**FAIL.** A model reply is not execution evidence. The provider is funded and responsive, but the profile did not perform the required terminal side effect. The live `approvals.mode: manual` setting is consistent with an unattended tool-execution block; it must not be silently worked around.

Atlas was **not dispatched** into the Book Studio worktree. Resume only after the Atlas profile's unattended approval policy is explicitly corrected and the same scratch side-effect canary produces a real `canary.txt` containing `CANARY_OK`.
