# Fleet v2 release candidate checkpoint and activation bundle

## Frozen scope and lineage

- Repository: `https://github.com/tymines/paperclip.git`
- Worktree: `C:/Users/tyler/Documents/Codex/2026-08-05/fleet-v2-release-candidate/work/paperclip-fleet-v2-release-candidate`
- Branch: `codex/fleet-v2-release-candidate-20260805`
- Verified base: `origin/master` at `826238c0f5cb211c947001f0847f75d511edbb4f`
- Fleet source: the exact final net state of `826238c0f5cb211c947001f0847f75d511edbb4f..79692ca57d8ce08a47e3ed1fa32b183ebd13dd0d`
- Security source: only the single-commit delta `c9d43ac6c2f5b41333f336ea088cb69f0c812f8d^..c9d43ac6c2f5b41333f336ea088cb69f0c812f8d`
- Reviewed release-candidate base: `540c67652818fb9d22dd446872e95950d0919b9e`
- Corrected release candidate: the immutable commit containing this checkpoint; its direct parent must be the reviewed base above. Resolve it with `git rev-parse HEAD` in this worktree and use the SHA recorded in the handoff.

The security commit's parent, `46dc341998307bf072697a737f10d16027c6c1bb`, is deliberately absent from this branch. Book commits `f338eddf25a6a5b94cdcf457b7ad39bb6315e7c7` and `050d8a80fc1ef8d43ed93d5ed7815120de51355c`, Mobile work, Olympus work, and unrelated paths are excluded.

## Accepted result

The canonical Fleet contains exactly 16 ordered positions:

- Windows: Zeus, Athena
- Box 1: Hermes, Atlas, Artemis, Chronos, Achlys, Augi
- Box 2: Ares, Apollo, Hephaestus, Poseidon, Hades, Calliope, Book Keeper, August

The protected Fleet API behavior is:

- `companyId` is required; a missing value returns `400` before company or agent reads.
- An unauthenticated company read returns `401`.
- A cross-company read returns `403` before the agent roster is read.
- Only a company whose normalized `issuePrefix` is `AUG` receives the canonical 16-position reconciliation.
- An authorized non-AUG company receives only its registered database agents and no derived AUG host, relationship, pairing, model, or canonical-position metadata.
- A successful non-AUG response is handled explicitly as registered-only. Its registered agents remain visible and actionable in List and Org, even though every canonical host field is null.
- The Agents UI continues to pass the existing `selectedCompanyId`; no authentication or company-selection flow changes are included.

The registered-only Org presentation is intentionally a flat actionable card grid. The registered-only Fleet response does not provide canonical host or hierarchy metadata, so the UI does not invent AUG groups or relationships. Each card still opens the normal agent drawer; List retains configuration and pause/resume actions.

This release candidate changes source/configuration and tests only. It does not change database schema or data, agent records or runtime configuration, credentials, service definitions, Macs, or external systems.

## Verification evidence

- `pnpm install --frozen-lockfile` — pass. The existing Windows plugin SDK `.EXE` link warnings occurred before build outputs existed; subsequent tests, typechecks, and builds passed.
- `pnpm --filter @paperclipai/server exec vitest run src/acp/acp-router.test.ts src/acp/canonical-fleet.test.ts` — pass: 2 files, 9 tests.
- `pnpm --filter @paperclipai/ui exec vitest run src/pages/Agents.test.tsx` — pass: 1 file, 6 tests, including a successful registered-only response whose canonical metadata is null in both List and Org.
- `pnpm --filter @paperclipai/server typecheck` — pass.
- `pnpm --filter @paperclipai/ui typecheck` — pass.
- `pnpm typecheck` — pass across the repository workspace.
- `pnpm build` — pass across the repository workspace, including server and the Vite production UI. Existing dynamic-import and large-chunk warnings remain non-blocking.
- `git diff --check` — pass.
- Reviewed-base blob-equivalence audit — pass at `540c67652818fb9d22dd446872e95950d0919b9e`: the seven Fleet-only paths match `79692ca57d8ce08a47e3ed1fa32b183ebd13dd0d`; the three overlapping runtime/test paths plus the security checkpoint match the four-path delta from `c9d43ac6c2f5b41333f336ea088cb69f0c812f8d`. The correction changes only the two Fleet UI components, their focused test, and this checkpoint.
- Bounded added-line secret scan — pass: no private-key headers, AWS/GitHub/OpenAI/Slack token forms, JWTs, or quoted credential assignments found.
- Safe API check — pass through the focused tests using temporary HTTP servers bound to `127.0.0.1` on OS-assigned ports; no live endpoint was contacted.
- Safe UI check — pass through the focused jsdom Agents rendering tests, including the exact canonical 16 rows and host groups, registered/unregistered behavior, company ID request, fallback behavior, canonical Org, and successful registered-only List/Org behavior.

No production-authenticated browser session or live API was used. The repository has no Fleet-specific Playwright fixture with an isolated seeded authentication/company environment, so a Chromium end-to-end Fleet check remains an activation-time gate.

## Approval-gated activation bundle

Do not run this section until release/production authority is explicit. Use a clean, non-live integration checkout; never use the production installation as a development worktree.

1. Record the approved release-candidate SHA from the handoff as `RC_SHA` and the currently deployed immutable SHA as `ROLLBACK_SHA`. Do not infer either value from a branch name.
2. Fetch and verify that `RC_SHA` is a commit, that its direct parent is `540c67652818fb9d22dd446872e95950d0919b9e`, that the reviewed base's direct parent is `826238c0f5cb211c947001f0847f75d511edbb4f`, and that neither blocked Book commit is its ancestor.
3. Require a clean integration checkout and inspect `git diff --name-status 826238c0f5cb211c947001f0847f75d511edbb4f..RC_SHA`. Stop if any path is outside this checkpoint's committed path list.
4. Re-run the focused tests, repository typecheck, production build, `git diff --check`, and the bounded secret scan against `RC_SHA`.
5. If the approved integration base is still `826238c0f5cb211c947001f0847f75d511edbb4f`, integrate with a fast-forward-only operation. If the base has advanced, stop and create a new isolated candidate from the new base; do not force, merge blocked lineage, or deploy this stale candidate.
6. Deploy the exact approved `RC_SHA` using the environment's existing verified release procedure. This repository does not contain the Windows production activation procedure, so no guessed service-copy or restart command is supplied here.
7. Run authenticated, read-only activation checks:
   - AUG company: `GET /api/acp/fleet?companyId=<AUG_COMPANY_ID>` returns `200`, exactly 16 canonical positions, and the roster above in order.
   - Missing `companyId`: returns `400`.
   - Unauthenticated company request: returns `401`.
   - Authorized user requesting another company: returns `403`.
   - Authorized non-AUG company: returns only that company's registered agents and no canonical Zeus row unless Zeus is actually registered there.
   - AUG Agents UI: selected company remains unchanged, the Fleet summary reports 16 positions, Windows/Box 1/Box 2 groups match this checkpoint, and no pause/resume control is used during the check.
   - Non-AUG Agents UI: List shows every registered agent with its drawer/configuration actions; Org shows every registered agent as an actionable card; neither view claims canonical AUG host groups or metadata.
8. Observe existing service health and error logs for the agreed canary window. Do not mutate agents, credentials, databases, or company settings to make a check pass.

Stop activation on any SHA, ancestry, dirty-tree, path-scope, test, build, authorization-status, roster, UI, service-health, or secret-scan mismatch.

## Rollback bundle

Because this candidate has no migration or data mutation, application rollback does not require a database rollback.

1. Stop the rollout if any activation gate fails.
2. Redeploy the captured `ROLLBACK_SHA` through the same verified release procedure used for activation. Do not manufacture a rollback by editing production files or force-resetting a live checkout.
3. Confirm the service is healthy and the pre-release Agents/Fleet behavior is restored.
4. Preserve the failed `RC_SHA`, logs, and check results for diagnosis. Do not delete or rewrite history.

## Known limits

- The release candidate is local until separately authorized for push, PR, merge, or deployment.
- The exact Windows production release/restart mechanism was not present in the verified repository and was not inferred from live installations.
- Production identity, AUG company ID, authentication, service health, and deployed SHA must be re-verified at activation time.
