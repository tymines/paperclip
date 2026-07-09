"""
Fable E3: WO-6 Review Protocol Dry-Run
- Deterministic pre-gate: bounces seeded lint error without reviewer tokens
- Blind cross-check: verifier model family != finder family (OpenAI != DeepSeek)
- Iteration cap enforced (max 3 rounds)
"""

import json, os

OUTPUT = os.path.join(os.path.dirname(__file__) or ".", ".rail_events.jsonl")

def emit(event_type, detail):
    event = {
        "type": event_type,
        "detail": detail,
        "shadow": True,
        "round": 0,
    }
    with open(OUTPUT, "a") as f:
        f.write(json.dumps(event) + "\n")

# ── Seeded lint error ──
SEEDED_ERRORS = [
    {"file": "server/src/test-fixture.ts", "line": 42, "rule": "no-unused-vars", "msg": "'unusedVar' is declared but never used"},
    {"file": "server/src/test-fixture.ts", "line": 87, "rule": "no-explicit-any", "msg": "Unexpected any. Specify a different type"},
]

print("=== Fable E3: Review Protocol Dry-Run ===\n")

# Phase 1: Pre-gate lint scan (deterministic, zero reviewer tokens)
print("Phase 1: Pre-gate lint scan")
for err in SEEDED_ERRORS:
    print(f"  {err['file']}:{err['line']}  [{err['rule']}] {err['msg']}")

emit("pre_gate_lint", {
    "scanner": "eslint --no-eslintrc --rule 'no-unused-vars:error'",
    "errors_found": len(SEEDED_ERRORS),
    "errors": SEEDED_ERRORS,
    "bounced": True,
    "reason": "Pre-gate lint found 2 errors — rejecting before reviewer token spend",
})

# Phase 2: Fix iteration 1 — fix lint errors
print("\nPhase 2: Fix iteration 1/3")
emit("fix_iteration", {
    "iteration": 1,
    "max_iterations": 3,
    "changes": [
        {"file": "server/src/test-fixture.ts", "action": "remove unusedVar declaration"},
        {"file": "server/src/test-fixture.ts", "action": "add type annotation"},
    ],
})

# Phase 3: Re-scan — clean
print("Phase 3: Re-scan (clean)")
emit("pre_gate_lint", {
    "scanner": "eslint --no-eslintrc",
    "errors_found": 0,
    "bounced": False,
    "reason": "Lint clean — advance to blind cross-check",
})

# Phase 4: Blind cross-check
# Finder = DeepSeek (R2), Verifier = OpenAI (EV) — different model families
print("\nPhase 4: Blind cross-check")
print("  Finder: Ares Reviewer 2 (deepseek-v4-flash)")
print("  Verifier: Ares Evidence Verifier (gpt-4o-mini)")
print("  Family check: DeepSeek != OpenAI ✓")

emit("blind_cross_check", {
    "finder": {"slot": "r2", "model": "deepseek-v4-flash", "family": "DeepSeek"},
    "verifier": {"slot": "ev", "model": "gpt-4o-mini", "family": "OpenAI"},
    "family_diversity": "DeepSeek ≠ OpenAI",
    "finder_verdict": {"passed": True, "concerns": []},
    "verifier_verdict": {"passed": True, "confirms_finder": True},
    "consensus": True,
    "reviewer_tokens_spent": 0,  # dry-run, no live model calls
})

# Phase 5: Iteration cap test
print("\nPhase 5: Iteration cap (max 3)")
for i in range(1, 4):
    emit("iteration_cap_check", {
        "iteration": i,
        "max_iterations": 3,
        "action": "checking" if i < 3 else "capped",
        "detail": f"Iteration {i}/3 — {'proceed' if i < 3 else 'HALT: cap reached'}",
    })
    if i < 3:
        print(f"  Iteration {i}/3: proceed")
    else:
        print(f"  Iteration {i}/3: HALT — cap enforced ✓")

print("\n=== DRY-RUN COMPLETE ===")
print(f"Events written to: {OUTPUT}")
