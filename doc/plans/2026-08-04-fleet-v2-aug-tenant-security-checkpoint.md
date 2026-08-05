# Fleet v2 AUG tenant binding and authorization correction

## Scope and lineage

- Worktree: `C:/Users/tyler/Documents/Codex/2026-08-04/fleet-v2-aug-tenant-security/work/paperclip-fleet-v2-aug-tenant-security`
- Branch: `codex/fleet-v2-aug-tenant-security-20260804`
- Parent checkpoint: `46dc341998307bf072697a737f10d16027c6c1bb`
- Source merge retained in lineage: `78c56de2fcddfeae010a356597847b0030205f35`
- Verified `origin/master` at execution: `826238c0f5cb211c947001f0847f75d511edbb4f`

## Correction

`GET /api/acp/fleet` now requires `companyId` and calls the existing company authorization guard before company or agent reads. It resolves the requested company through `companies.issuePrefix`; only a case-insensitive `AUG` prefix receives the preserved 16-position canonical Fleet reconciliation. Authorized non-AUG companies receive only their own registered database agents, with no canonical definitions or derived Olympus/AUG host, pairing, or model metadata.

The response contract is deterministic for the protected cases: missing `companyId` is `400`, unauthenticated company reads are `401`, and cross-company reads are `403`. The existing authenticated Agents UI already sends `selectedCompanyId`; no additional login flow was introduced.

## Verification

- `pnpm --filter @paperclipai/server exec vitest run src/acp/acp-router.test.ts src/acp/canonical-fleet.test.ts` — pass, 9 tests.
- `pnpm --filter @paperclipai/server typecheck` — pass.
- `pnpm --filter @paperclipai/ui typecheck` — pass.
- `pnpm --filter @paperclipai/ui build` — pass (existing chunk-size warnings only).
- `git diff --check` — pass.

## Limits and rollback

No database, agent runtime, service, credential, UI source, or production changes were made. The correction is local only and is rollbackable by reverting its single commit. A fresh Windows dependency install emitted existing plugin SDK binary-link warnings; they did not affect the focused ACP suite, typechecks, or UI build.
