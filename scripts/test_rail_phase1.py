"""
RAIL Phase 1 — Kill Auto-Merge canonical tests.

Proves:
  1. unlabeled/default and label-auto reviewed tasks cannot reach merge
  2. approved review always moves to gated/needs_approval
  3. legacy persisted states "merging" or "merged" fail-safe to gated/needs_approval
  4. shadow plan has no merge stage
  5. scheduled controller tick has no merge call
  6. merge-queue.sh remains as operator helper but rail_controller has no auto caller
  7. unknown labels default unlabeled/manual and all approved work is gated
"""
import json, os, pathlib, sys

sys.path.insert(0, "scripts")
import rail_controller as rc

# ── patching side-effects ──────────────────────────────────────
events = []
rc.emit_event = lambda *a, **kw: events.append((a, kw))

updates = []
rc.update_task = lambda tid, **kw: updates.append((tid, kw))

comments = []
rc.add_comment = lambda tid, text: comments.append((tid, text))

rc.STATE_FILE = pathlib.Path("/tmp/_test_rail_phase1_state.json")
rc.CONFIG_FILE = pathlib.Path("/tmp/_test_rail_phase1_config.json")
rc.CONFIG_FILE.write_text(json.dumps({"rail_enabled": False}))

# Mock stage functions so we can drive the state machine deterministically
rc.stage_plan = lambda t: True
rc.stage_critique = lambda t: True
rc.stage_code = lambda t: True
rc.stage_review = lambda t: "approved"

# Ensure Ten Laws always pass (we are testing gate logic, not ten-law logic)
_orig_check = rc._check_ten_law_gate
rc._check_ten_law_gate = lambda tid, stage, state, cfg: {
    "passed": True, "checks": [{"passed": True}], "stage": stage, "law": "test"
}

CFG_ON = {"enforcement": "on", "rework_cap": 3}


def _fresh_state():
    rc.STATE_FILE.write_text(json.dumps({}))
    events.clear()
    updates.clear()
    comments.clear()


def _inject_state(tid, state, gate_class="auto"):
    st = json.loads(rc.STATE_FILE.read_text())
    st[tid] = {
        "state": state,
        "stall_count": 0,
        "last_artifact_at": 0,
        "rework_count": 0,
        "gate_class": gate_class,
        "claimed_at": 0,
        "updated": "2024-01-01T00:00:00Z",
    }
    rc.STATE_FILE.write_text(json.dumps(st))


def _drive_task(task, cfg, max_iter=10):
    """Drive a task through process_task until it stabilises or hits a terminal state."""
    for _ in range(max_iter):
        result = rc.process_task(task, cfg)
        if result in ("gated", "closed", "blocked", "off", "shadow_complete"):
            return result
    return result


# ═══════════════════════════════════════════════════════════════
# 1. unlabeled/default reviewed task → gated (never merging)
# ═══════════════════════════════════════════════════════════════
def test_unlabeled_approved_to_gated():
    _fresh_state()
    task = {"id": "t-unlabeled", "identifier": "TST-U", "title": "U", "labels": []}
    result = _drive_task(task, CFG_ON)
    assert result == "gated", f"unlabeled approved must land in gated, got {result}"
    assert any(u[1].get("status") == "needs_approval" for u in updates), \
        "unlabeled approved must update task status to needs_approval"
    print("✓ test_unlabeled_approved_to_gated")


# ═══════════════════════════════════════════════════════════════
# 2. label "auto" reviewed task → gated (never merging)
# ══════════════════════════════════════════════════════════─═════════
def test_auto_label_approved_to_gated():
    _fresh_state()
    task = {"id": "t-auto", "identifier": "TST-A", "title": "A", "labels": ["auto"]}
    result = _drive_task(task, CFG_ON)
    assert result == "gated", f"auto-label approved must land in gated, got {result}"
    assert any(u[1].get("status") == "needs_approval" for u in updates), \
        "auto-label approved must update task status to needs_approval"
    print("✓ test_auto_label_approved_to_gated")


# ═══════════════════════════════════════════════════════════════
# 3. known gated label (schema) reviewed task → gated
# ═══════════════════════════════════════════════════════════════
def test_schema_label_approved_to_gated():
    _fresh_state()
    task = {"id": "t-schema", "identifier": "TST-S", "title": "S", "labels": ["schema"]}
    result = _drive_task(task, CFG_ON)
    assert result == "gated", f"schema-label approved must land in gated, got {result}"
    assert any(u[1].get("status") == "needs_approval" for u in updates), \
        "schema-label approved must update task status to needs_approval"
    print("✓ test_schema_label_approved_to_gated")


# ═══════════════════════════════════════════════════════════════
# 4. unknown label defaults manual/unlabeled and still gates
# ═══════════════════════════════════════════════════════════════
def test_unknown_label_defaults_manual_and_gates():
    _fresh_state()
    task = {"id": "t-unknown", "identifier": "TST-X", "title": "X", "labels": ["foobar"]}
    result = _drive_task(task, CFG_ON)
    assert result == "gated", f"unknown-label approved must land in gated, got {result}"
    # Verify gate_class stored is manual/unlabeled, not auto
    st = json.loads(rc.STATE_FILE.read_text())
    saved_class = st.get("t-unknown", {}).get("gate_class", "")
    assert saved_class != "auto", f"unknown label must NOT default to auto, got {saved_class}"
    assert any(u[1].get("status") == "needs_approval" for u in updates), \
        "unknown-label approved must update task status to needs_approval"
    print("✓ test_unknown_label_defaults_manual_and_gates")


# ═══════════════════════════════════════════════════════════════
# 5. legacy persisted state "merging" fail-safes to gated/needs_approval
# ═══════════════════════════════════════════════════════════════
def test_legacy_merging_failsafe_to_gated():
    _fresh_state()
    _inject_state("t-legacy-merge", "merging", gate_class="auto")
    task = {"id": "t-legacy-merge", "identifier": "TST-LM", "title": "LM", "labels": ["auto"]}
    result = rc.process_task(task, CFG_ON)
    assert result == "gated", f"legacy merging must fail-safe to gated, got {result}"
    assert any(u[1].get("status") == "needs_approval" for u in updates), \
        "legacy merging must update task status to needs_approval"
    print("✓ test_legacy_merging_failsafe_to_gated")


# ═══════════════════════════════════════════════════════════════
# 6. legacy persisted state "merged" fail-safes to gated/needs_approval
# ═══════════════════════════════════════════════════════════════
def test_legacy_merged_failsafe_to_gated():
    _fresh_state()
    _inject_state("t-legacy-merged", "merged", gate_class="auto")
    task = {"id": "t-legacy-merged", "identifier": "TST-LD", "title": "LD", "labels": ["auto"]}
    result = rc.process_task(task, CFG_ON)
    assert result == "gated", f"legacy merged must fail-safe to gated, got {result}"
    assert any(u[1].get("status") == "needs_approval" for u in updates), \
        "legacy merged must update task status to needs_approval"
    print("✓ test_legacy_merged_failsafe_to_gated")


# ═══════════════════════════════════════════════════════════════
# 7. shadow plan has no merge stage
# ═══════════════════════════════════════════════════════════════
def test_shadow_plan_has_no_merge_stage():
    _fresh_state()
    task = {"id": "t-shadow", "identifier": "TST-SH", "title": "SH", "labels": []}
    cfg_shadow = {"enforcement": "shadow", "rework_cap": 3}
    rc.process_task(task, cfg_shadow)
    shadow_stages = [e for e in events if e[0][0] == "shadow_decision"]
    stage_names = [e[1].get("stage") for e in shadow_stages]
    assert "merge" not in stage_names, f"shadow plan must not contain merge stage, got {stage_names}"
    print("✓ test_shadow_plan_has_no_merge_stage")


# ═══════════════════════════════════════════════════════════════
# 8. scheduled controller tick never calls stage_merge
# ═══════════════════════════════════════════════════════════════
def test_no_stage_merge_called_in_tick():
    _fresh_state()
    merge_calls = []
    def capturing_stage_merge(t):
        merge_calls.append(t)
        return True
    rc.stage_merge = capturing_stage_merge
    task = {"id": "t-nomerge", "identifier": "TST-NM", "title": "NM", "labels": ["auto"]}
    _drive_task(task, CFG_ON)
    assert len(merge_calls) == 0, f"stage_merge must never be called in production tick, called {len(merge_calls)} times"
    print("✓ test_no_stage_merge_called_in_tick")


# ═══════════════════════════════════════════════════════════════
# 9. merge-queue.sh exists but rail_controller.py has no auto caller
# ═══════════════════════════════════════════════════════════════
def test_merge_queue_sh_remains_no_auto_caller():
    repo_root = pathlib.Path(__file__).parent.parent
    merge_script = repo_root / "scripts" / "merge-queue.sh"
    assert merge_script.exists(), "merge-queue.sh must remain as explicit operator helper"
    ctrl_src = (repo_root / "scripts" / "rail_controller.py").read_text()
    assert "merge-queue.sh" not in ctrl_src, "rail_controller.py must not reference merge-queue.sh"
    assert "stage_merge(" not in ctrl_src, "rail_controller.py must not contain stage_merge call"
    # Also ensure AUTO_MERGE_CLASSES is gone
    assert "AUTO_MERGE_CLASSES" not in ctrl_src, "AUTO_MERGE_CLASSES must be removed"
    print("✓ test_merge_queue_sh_remains_no_auto_caller")


# ═══════════════════════════════════════════════════════════════
# 10. STATES / ACTIVE_STATES do not contain merging or merged
# ═══════════════════════════════════════════════════════════════
def test_no_merging_merged_in_state_constants():
    assert "merging" not in rc.STATES, "STATES must not contain 'merging'"
    assert "merged" not in rc.STATES, "STATES must not contain 'merged'"
    assert "merging" not in rc.ACTIVE_STATES, "ACTIVE_STATES must not contain 'merging'"
    assert "merged" not in rc.ACTIVE_STATES, "ACTIVE_STATES must not contain 'merged'"
    print("✓ test_no_merging_merged_in_state_constants")


# ═══════════════════════════════════════════════════════════════
# 11. No merge timeout in STAGE_TIMEOUTS and no merge Ten-Law stage
# ═══════════════════════════════════════════════════════════════
def test_no_merge_timeout_or_ten_law_stage():
    assert "merge" not in rc.STAGE_TIMEOUTS, "STAGE_TIMEOUTS must not contain 'merge'"
    assert "merge" not in rc.TEN_LAW_STAGE_MAP, "TEN_LAW_STAGE_MAP must not contain 'merge'"
    print("✓ test_no_merge_timeout_or_ten_law_stage")


if __name__ == "__main__":
    test_unlabeled_approved_to_gated()
    test_auto_label_approved_to_gated()
    test_schema_label_approved_to_gated()
    test_unknown_label_defaults_manual_and_gates()
    test_legacy_merging_failsafe_to_gated()
    test_legacy_merged_failsafe_to_gated()
    test_shadow_plan_has_no_merge_stage()
    test_no_stage_merge_called_in_tick()
    test_merge_queue_sh_remains_no_auto_caller()
    test_no_merging_merged_in_state_constants()
    test_no_merge_timeout_or_ten_law_stage()
    print("\n=== ALL PHASE 1 TESTS PASSED ===")
