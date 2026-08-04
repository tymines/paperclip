# Book Studio Calliope-only execution v2

Status: accepted decision, 2026-08-03  
Base: `tymines/paperclip` `4bd4eec3da41d2ae9a79a2d9a36f607c7b1bdb55`

## Decision

Calliope is the only creative-generation execution path for Book Studio. This v2 decision supersedes the model-fallback portion of the 2026-08-01 Book Studio Calliope continuity v1 packet.

The affected operations are brainstorm chat, assisted-mode `suggest-next`, and story-bible generation for characters, locations, world rules, style, and outline beats. If Calliope cannot complete an operation, Paperclip returns an honest 502 or 503 response with `via: "none"`; it does not call a replacement model or represent a replacement response as Calliope.

Brainstorm chat retains the submitted user turn before reporting Calliope's failure. Successful chat replies retain `via: "calliope"`. Structured-generation success responses retain their existing JSON shapes and normalization.

## Runtime boundary

Calliope is the `calliope` profile in the Hermes Harness on Box 2. The Box 2 Book Lanes executor satisfies Paperclip's existing `callAgentLane` dispatch/callback contract. Calliope is not an OpenClaw bridge identity.

Runtime addresses, credentials, SSH access, service management, and deployment are operational configuration outside this code change. A mocked lane contract proves route behavior but is not evidence that the Box 2 runtime is configured or reachable.

## Unchanged scope

- The Ares critic degradation behavior is unchanged.
- Generic Gemini adapters, catalogs, evaluations, and non-Book-Studio integrations are unchanged.
- No schema, migration, vault, fleet configuration, or production change is authorized by this decision file.
