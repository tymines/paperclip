# Pre-existing TypeScript errors (discovered after removing @ts-nocheck)
# Date: 2026-06-27T05:14:09Z
# These errors are NOT introduced by the brain build; they exist in unrelated files.
# Do NOT mask them with @ts-nocheck. Fix them in a separate tech-debt pass.

## IssuesList.tsx (12 errors)
- TS2339: Property 'status' does not exist on type 'Agent' (x5)
- TS2339: Property 'lastHeartbeatAt' does not exist on type 'Agent' (x5)
- TS2339: Property 'adapterConfig' does not exist on type 'Agent' (x1)
- TS2339: Property 'runtimeConfig' does not exist on type 'Agent' (x1)

## NewReelDialog.tsx (3 errors)
- TS2339: Property 'id' does not exist on type 'CompanyContextValue' (x3)

## ReelDetail.tsx (6 errors)
- TS2339: Property 'id' does not exist on type 'CompanyContextValue' (x5)
- TS2339: Property 'reel' does not exist on type 'Query<...>' (x1)

## Reels.tsx (11 errors)
- TS2339: Property 'id' does not exist on type 'CompanyContextValue' (x5)
- TS2339: Property 'reels' does not exist on type 'Query<...>' (x1)
- TS2322: Type 'Element' is not assignable to type 'string' (x1)
- TS2322: Type '{ icon: ...; title: string; description: string; }' not assignable to 'EmptyStateProps' — Property 'title' does not exist (x2)
- TS2339: Property 'id' does not exist on type 'CompanyContextValue' (x2)

Total: 32 pre-existing errors across 4 files.
