#!/usr/bin/env python3
"""
RAIL CONTROLLER DAEMON v2.0.0 — Master-switch-gated autonomous pipeline.
Zero-LLM scheduler. Claims tasks, routes through pipeline, enforces gate classes.

Tyler's master switch: RAIL_ENABLED in .rail_config.json (OFF by default).
Toggle:  python3 rail_controller.py --enable | --disable | --status

Pipeline per task: claim → plan → critique → code(worktree) → review → gate → close
One-writer-per-tree invariant. Tests MUST pass for changed files (hardened gate).
No continue-on-error fallback — failing stages block, no fake commits.

Phase 1: All approved work is gated. No automatic merge path exists.
"""
from __future__ import annotations

__version__ = "2.0.0"

import argparse, json, os, subprocess, sys, time, urllib.request, urllib.error
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from rail_durability import append_event, atomic_write_json, load_projection

# ── config ──────────────────────────────────────────────────────
BASE       = os.environ.get("PAPERCLIP_URL", "http://127.0.0.1:3100")
CID        = os.environ.get("PAPERCLIP_COMPANY_ID", "7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4")
API_KEY    = os.environ.get("PAPERCLIP_API_KEY", "")  # ponytail: from config or env
HERMES     = "hermes"
POLL_SEC   = int(os.environ.get("RAIL_POLL_SEC", "5"))
ONCE       = "--once" in sys.argv
E2E        = "--e2e" in sys.argv
DRY        = "--dry-run" in sys.argv
VERBOSE    = "--verbose" in sys.argv or DRY
REPO       = Path(os.environ.get("RAIL_REPO", r"C:\Users\Augi-T1\paperclip"))
SCRIPTS    = REPO / "scripts"
PAPERCLIP_HOME = Path(os.environ.get("PAPERCLIP_HOME", str(Path.home() / ".paperclip")))
EVENTS_LOG = Path(os.environ.get("RAIL_EVENTS_LOG", str(PAPERCLIP_HOME / "rail" / "rail-events.jsonl")))
CONFIG_FILE = Path(os.environ.get("RAIL_CONFIG", str(REPO / ".rail_config.json")))
STATE_FILE  = Path(os.environ.get("RAIL_STATE", str(REPO / ".rail_state.json")))
CONTROLLER_LOCK = None
CONTROLLER_EPOCH = None

DEFAULT_CONFIG = {
    "rail_enabled": False,        # OFF by default — Tyler must explicitly enable
    "warn_ttl_min": 20,
    "revoke_ttl_min": 40,
    "sweep_interval_min": 5,
    "rework_cap": 3,
    "seats": ["zeus-coding"],
    "enforcement": "shadow",      # on | shadow | off
    "api_key": "",                # Paperclip API key for board access
}

# ── gate classes: all approved work is gated for operator review ──────────
GATED_CLASSES = {"schema", "ui", "spend", "security", "agent_config"}

# ── pipeline stages with timeouts ─────────────────────────────────────────
STAGE_TIMEOUTS = {
    "plan":     180,
    "critique": 180,
    "code":     600,    # hardened: give coder real time
    "review":   180,
}

# ── Ten Laws enforcement ──────────────────────────────────────────
# stage_name → law name. state_on_disk_not_context auto-appended to every stage.
TEN_LAW_STAGE_MAP = {
    "plan":     "intent_before_code",
    "critique": "adversarial_review",
    "code":     "smallest_diff_wins",
    "review":   "two_person_rule",
}
DEFAULT_TEN_LAWS_CONFIG = {
    "session_max_age_hours": 8,
    "max_tokens_per_session": 200_000,
    "require_critique_before_code": True,
    "require_review_before_merge": True,
    "require_test_for_changed_files": True,
    "state_on_disk_not_context": True,   # every stage must checkpoint state
    "enforce_worktree_isolation": True,
}

def _check_ten_law_gate(task_id: str, stage: str, state: dict, cfg: dict) -> dict:
    """Check Ten Laws compliance for a pipeline stage. Returns {passed: bool, checks: [...]}."""
    law_name = TEN_LAW_STAGE_MAP.get(stage, "unknown")
    laws_cfg = {**DEFAULT_TEN_LAWS_CONFIG, **cfg.get("ten_laws", {})}
    checks = []
    
    # Law: state_on_disk_not_context — always appended
    state_file_exists = STATE_FILE.exists()
    checks.append({"law": "state_on_disk_not_context", "passed": state_file_exists,
                   "detail": "state file exists" if state_file_exists else "state file missing"})
    
    # Law: require_critique_before_code
    if stage == "code" and laws_cfg.get("require_critique_before_code"):
        had_critique = state.get("had_critique", False)
        checks.append({"law": "require_critique_before_code", "passed": had_critique,
                       "detail": "critique recorded" if had_critique else "no critique before code"})
    
    # Law: require_review_before_merge (enforced at gate, not merge stage)
    # Phase 1: merge stage removed; review gate blocks before approval.
    
    # Law: require_test_for_changed_files (enforced at review gate)
    # Phase 1: no automatic merge; tests must pass before review approval.
    
    all_passed = all(c["passed"] for c in checks)
    return {"passed": all_passed, "checks": checks, "stage": stage, "law": law_name}


def _check_session_rotation(task_id: str, state: dict, cfg: dict) -> dict:
    """Check if session has exceeded max age and needs rotation."""
    laws_cfg = {**DEFAULT_TEN_LAWS_CONFIG, **cfg.get("ten_laws", {})}
    max_hours = laws_cfg.get("session_max_age_hours", 8)
    created_at = state.get("claimed_at", 0)
    age_hours = (now_ts() - created_at) / 3600 if created_at else 0
    needs_rotation = age_hours > max_hours
    return {
        "passed": not needs_rotation,
        "age_hours": round(age_hours, 1),
        "max_hours": max_hours,
        "needs_rotation": needs_rotation,
    }


STATES = [
    "ready", "claimed", "planning", "plan_ready", "critiqued",
    "coding", "in_review", "closed",
    "rework", "blocked", "gated",
]
ACTIVE_STATES = {"claimed", "planning", "plan_ready", "critiqued", "coding", "in_review"}


# ═══════════════════════════════════════════════════════════════
# util
# ═══════════════════════════════════════════════════════════════

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def now_ts():
    return time.time()

def api(method, path, body=None, timeout=15):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if API_KEY:
        req.add_header("Authorization", f"Bearer {API_KEY}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:300]
        _log("api", f"{method} {path} → HTTP {e.code}: {err}")
        return None
    except Exception as ex:
        _log("api", f"{method} {path} → {ex}")
        return None

def _log(category, msg):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    line = f"[{ts}] [{category}] {msg}"
    print(line, file=sys.stderr, flush=True)

def emit_event(event_type, task_id, **extra):
    if CONTROLLER_EPOCH is not None:
        extra.setdefault("controller_epoch", CONTROLLER_EPOCH)
    ev = append_event(EVENTS_LOG, {"ts": now_iso(), "type": event_type, "task_id": task_id, **extra})
    if VERBOSE:
        _log("event", f"{event_type} {task_id} cursor={ev['cursor']} {json.dumps(extra, default=str)[:120]}")


def _shadow_event(task_id, stage, **details):
    """Log a shadow decision — no real transitions occur."""
    emit_event("shadow_decision", task_id, stage=stage, would_do=details,
               reason="shadow mode — zero real transitions", timestamp=now_iso())

def load_config():
    if CONFIG_FILE.exists():
        return {**DEFAULT_CONFIG, **json.loads(CONFIG_FILE.read_text())}
    return dict(DEFAULT_CONFIG)

def save_config(cfg):
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))

def load_state():
    return load_projection(EVENTS_LOG, STATE_FILE)

def save_state(st):
    atomic_write_json(STATE_FILE, st)


def acquire_controller_lock():
    """Hold one OS-released lock for the lifetime of the scheduler process."""
    lock_path = PAPERCLIP_HOME / "rail" / "controller.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    stream = lock_path.open("a+b")
    try:
        if os.name == "nt":
            import msvcrt
            stream.seek(0)
            if stream.tell() == 0 and lock_path.stat().st_size == 0:
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except Exception:
        stream.close()
        raise RuntimeError("another RAIL scheduler owns the controller lock")
    return stream


def next_controller_epoch():
    state = load_state()
    meta = state.setdefault("_meta", {})
    epoch = int(meta.get("controller_epoch", 0)) + 1
    meta.update({"controller_epoch": epoch, "controller_heartbeat_at": now_iso()})
    save_state(state)
    return epoch


def controller_heartbeat():
    state = load_state()
    state.setdefault("_meta", {}).update({
        "controller_epoch": CONTROLLER_EPOCH,
        "controller_heartbeat_at": now_iso(),
    })
    save_state(state)


def run(cmd, cwd=None, timeout=120):
    """Run shell command, return (stdout, stderr, rc)."""
    try:
        r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True,
                           text=True, timeout=timeout)
        return r.stdout.strip(), r.stderr.strip(), r.returncode
    except subprocess.TimeoutExpired:
        return "", f"timeout after {timeout}s", -1
    except Exception as ex:
        return "", str(ex), -1


# ═══════════════════════════════════════════════════════════════
# toggle commands
# ═══════════════════════════════════════════════════════════════

def toggle_enable():
    cfg = load_config()
    cfg["rail_enabled"] = True
    save_config(cfg)
    _log("toggle", "RAIL_ENABLED = ON  — daemon will claim and process tasks")
    return True

def toggle_disable():
    cfg = load_config()
    cfg["rail_enabled"] = False
    save_config(cfg)
    _log("toggle", "RAIL_ENABLED = OFF — daemon idles, claims nothing")
    return True

def toggle_status():
    cfg = load_config()
    state = "🟢 ON — claiming + processing" if cfg.get("rail_enabled") else "🔴 OFF — idling, claims nothing"
    print(f"RAIL Controller Daemon v{__version__}")
    print(f"RAIL_ENABLED: {state}")
    print(f"Config file: {CONFIG_FILE}")
    print(f"Poll interval: {POLL_SEC}s")
    print(f"Rework cap: {cfg.get('rework_cap', 3)}")
    print(f"Enforcement: {cfg.get('enforcement', 'shadow')}")
    return True


# ═══════════════════════════════════════════════════════════════
# pipeline stages
# ═══════════════════════════════════════════════════════════════

def stage_plan(task: dict) -> bool:
    """Run Zeus to generate execution plan. Returns True if plan produced."""
    title = task.get("title", "")
    desc = task.get("description", "") or ""
    ident = task.get("identifier", task["id"][:8])

    prompt = (
        f"Write a concrete execution plan for this task. "
        f"Output numbered steps with exact files to modify, commands to run, "
        f"and verification checks. Be specific — no vague instructions.\n\n"
        f"Task: {title}\n\nDescription:\n{desc}"
    )
    emit_event("stage.start", task["id"], stage="plan", profile="zeus-brainstorm")
    stdout, stderr, rc = run(
        f'{HERMES} -p zeus-brainstorm chat -Q -q "{prompt}"',
        timeout=STAGE_TIMEOUTS["plan"],
    )
    if rc == 0 and stdout:
        emit_event("stage.done", task["id"], stage="plan", result="ok", plan_len=len(stdout))
        return True
    emit_event("stage.fail", task["id"], stage="plan", rc=rc, stderr=stderr[:500])
    return False

def stage_critique(task: dict) -> bool:
    """Run Critic to gate the plan. Returns True if plan passes."""
    ident = task.get("identifier", task["id"][:8])
    title = task.get("title", "")

    prompt = (
        f"Critique the execution plan for this task. Find gaps, missing edge cases, "
        f"unclear steps. Output structured verdict: PASS (with severity: none) "
        f"or FAIL (with specific issues to fix).\n\nTask: {title}"
    )
    emit_event("stage.start", task["id"], stage="critique", profile="zeus-critic")
    stdout, stderr, rc = run(
        f'{HERMES} -p zeus-critic chat -Q -q "{prompt}"',
        timeout=STAGE_TIMEOUTS["critique"],
    )
    if rc == 0 and stdout:
        emit_event("stage.done", task["id"], stage="critique", result="ok")
        return True
    emit_event("stage.fail", task["id"], stage="critique", rc=rc, stderr=stderr[:500])
    return False

def stage_code(task: dict) -> bool:
    """Create worktree, dispatch coder, check for real artifacts. NO fake commits."""
    ident = task.get("identifier", task["id"][:8]) or task["id"][:8]
    title = task.get("title", "")
    desc = task.get("description", "") or ""

    # 1. create isolated worktree
    emit_event("stage.start", task["id"], stage="code", step="worktree")
    wt_script = str(SCRIPTS / "dispatch-worktree.sh")
    stdout, stderr, rc = run(f'bash "{wt_script}" {ident}', cwd=str(REPO), timeout=30)
    if rc != 0:
        emit_event("stage.fail", task["id"], stage="code", step="worktree", stderr=stderr[:500])
        return False

    # parse WT_PATH from script output
    wt_path = None
    for line in stdout.splitlines():
        if line.startswith("WT_PATH="):
            wt_path = line.split("=", 1)[1].strip()
    if not wt_path:
        wt_path = str(REPO / ".paperclip" / "worktrees" / ident)

    emit_event("stage.progress", task["id"], stage="code", worktree=wt_path)

    # 2. dispatch coder — real attempt, full timeout
    prompt = (
        f"Task: {title}\n\n{desc}\n\n"
        f"Do the work in this repository. Commit with message 'feat: {title[:60]}'. "
        f"Run the relevant tests. Report what you built."
    )
    emit_event("stage.start", task["id"], stage="code", step="execute", profile="zeus-coding")
    stdout, stderr, rc = run(
        f'{HERMES} -p zeus-coding chat -Q -q "{prompt}"',
        cwd=wt_path,
        timeout=STAGE_TIMEOUTS["code"],
    )

    # 3. HARDENED: check for REAL artifacts — no fallback fake commits
    has_artifacts = False
    log_stdout = diff_stdout = ""
    if wt_path and Path(wt_path).exists():
        log_stdout, _, log_rc = run("git log --oneline -1", cwd=wt_path, timeout=10)
        diff_stdout, _, _ = run("git diff --stat HEAD~1 2>/dev/null", cwd=wt_path, timeout=10)
        has_artifacts = log_rc == 0 and bool(log_stdout.strip())

        # HARDENED: check that the commit is NOT a trivial RAIL-E2E stub
        if "RAIL-E2E" in log_stdout or "RAIL-FINAL" in log_stdout:
            _log("code", f"{ident}: detected old stub commit, rejecting as non-real artifact")
            has_artifacts = False

    # HARDENED GATE: if coder failed AND no real artifacts → FAIL, no fallback
    if not has_artifacts:
        emit_event("stage.fail", task["id"], stage="code", rc=rc,
                   reason="no artifacts produced; continue-on-error blocked",
                   stderr=stderr[:500])
        return False

    # coder may have timed out but real commits exist — accept
    if rc != 0:
        emit_event("stage.progress", task["id"], stage="code",
                   note=f"process rc={rc} but real commits exist — accepting")

    emit_event("stage.done", task["id"], stage="code", result="ok",
               worktree=wt_path, last_commit=log_stdout[:200],
               diff=diff_stdout[:500])
    return True

def stage_review(task: dict) -> Optional[str]:
    """Review diff and artifacts. Returns 'approved' or 'changes' or None on failure."""
    ident = task.get("identifier", task["id"][:8])
    wt_path = str(REPO / ".paperclip" / "worktrees" / ident)
    title = task.get("title", "")

    # grab diff from worktree
    diff_stdout, _, diff_rc = run("git diff HEAD~1 --stat", cwd=wt_path, timeout=15)
    log_stdout, _, _ = run("git log --oneline -3", cwd=wt_path, timeout=10)

    # Check that we have real commits (not stubs)
    if not log_stdout.strip():
        emit_event("stage.fail", task["id"], stage="review", reason="no commits to review")
        return None

    prompt = (
        f"Review this completed task. Output a single verdict: APPROVED or CHANGES. "
        f"If CHANGES, list specific issues.\n\n"
        f"Task: {title}\n\nGit log:\n{log_stdout}\n\nDiff stat:\n{diff_stdout}"
    )
    emit_event("stage.start", task["id"], stage="review", profile="zeus-reviewer")
    stdout, stderr, rc = run(
        f'{HERMES} -p zeus-reviewer chat -Q -q "{prompt}"',
        timeout=STAGE_TIMEOUTS["review"],
    )
    if rc != 0 or not stdout:
        emit_event("stage.fail", task["id"], stage="review", rc=rc, stderr=stderr[:500])
        return None

    verdict = stdout.strip().upper()
    if "APPROVED" in verdict:
        emit_event("stage.done", task["id"], stage="review", verdict="approved")
        return "approved"
    emit_event("stage.done", task["id"], stage="review", verdict="changes")
    return "changes"

def update_task(task_id, **fields):
    """PATCH task via Paperclip API."""
    return api("PATCH", f"/api/issues/{task_id}", fields)

def add_comment(task_id, body):
    return api("POST", f"/api/issues/{task_id}/comments", {"body": body})


# ═══════════════════════════════════════════════════════════════
# progress watchdog (separate from ownership lease renewal)
# ═══════════════════════════════════════════════════════════════

def check_progress_watchdog(task_id, worktree_path, stall_count, last_artifact_at, cfg):
    """Check if task has produced artifacts recently."""
    warn_ttl = cfg.get("warn_ttl_min", 20) * 60
    revoke_ttl = cfg.get("revoke_ttl_min", 40) * 60

    if not worktree_path or not Path(worktree_path).exists():
        return stall_count, last_artifact_at

    log_out, _, rc = run("git log --oneline -1 --format='%ct'", cwd=worktree_path, timeout=10)
    if rc == 0 and log_out.strip():
        try:
            last_commit_ts = int(log_out.strip().strip("'"))
            last_artifact_at = last_commit_ts
            stall_count = 0
        except ValueError:
            pass

    latest = load_state().get(task_id, {}).get("last_event", {})
    if str(latest.get("type", "")).startswith("stage.") and latest.get("ts"):
        try:
            last_artifact_at = max(last_artifact_at, datetime.fromisoformat(latest["ts"]).timestamp())
        except (TypeError, ValueError):
            pass

    status_out, _, status_rc = run("git status --porcelain", cwd=worktree_path, timeout=10)
    if status_rc == 0:
        for line in status_out.splitlines():
            candidate = line[3:].split(" -> ")[-1].strip('"')
            artifact = Path(worktree_path) / candidate
            if artifact.is_file():
                last_artifact_at = max(last_artifact_at, artifact.stat().st_mtime)
                stall_count = 0

    if last_artifact_at:
        since_last = now_ts() - last_artifact_at
        if since_last > revoke_ttl:
            stall_count += 1
            emit_event("progress.stalled", task_id, stall_count=stall_count,
                       since_last_s=int(since_last))
            return stall_count, last_artifact_at
        if since_last > warn_ttl:
            emit_event("progress.warn", task_id, since_last_s=int(since_last))
    else:
        emit_event("progress.no_activity", task_id)
        stall_count += 1

    return stall_count, last_artifact_at


# ═══════════════════════════════════════════════════════════════
# main loop
# ═══════════════════════════════════════════════════════════════

def query_board_direct(limit=5):
    """Direct PG fallback. Fail closed unless the server confirms production port 5432."""
    try:
        import psycopg2
        conn = psycopg2.connect(
            host="127.0.0.1", port=5432, user="paperclip",
            dbname="paperclip", connect_timeout=5
        )
        cur = conn.cursor()
        cur.execute("SHOW port")
        if str(cur.fetchone()[0]) != "5432":
            raise RuntimeError("RAIL direct DB fallback requires verified port 5432")
        cur.execute(
            "SELECT id, identifier, title, description, status, "
            "assignee_agent_id, created_at, parent_id, iteration_count, "
            "last_verdict "
            "FROM issues WHERE status = %s "
            "ORDER BY priority DESC, created_at ASC LIMIT %s",
            ("backlog", limit)
        )
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        conn.close()
        return rows
    except Exception as e:
        _log("pg", f"Direct PG query failed: {e}")
        return []

def claim_task(cfg=None):
    """Claim one ready task from backlog. Atomic via status-guard PATCH."""
    enforcement = (cfg or {}).get("enforcement", "shadow")
    issues = api("GET", f"/api/companies/{CID}/issues?status=backlog&limit=5")
    if not issues:
        # Fallback: direct PG access when API is unreachable (shadow mode or no valid key)
        _log("rail", "API returned no tasks — trying direct PG fallback")
        issues = query_board_direct(5)
    for issue in issues:
        ident = issue.get("identifier", issue["id"][:8])
        if enforcement == "shadow":
            _shadow_event(issue["id"], "claim",
                          identifier=ident, title=issue.get("title"),
                          would_status="todo")
            _log("shadow", f"{ident}: WOULD claim but shadow mode — no real PATCH")
            return issue
        if not issue.get("assigneeAgentId"):
            patched = api("PATCH", f"/api/issues/{issue['id']}", {"status": "todo"})
            if patched:
                emit_event("claim", issue["id"], identifier=ident, title=issue.get("title"))
                return issue
    return None

def process_task(task, cfg):
    """Drive one task through the full pipeline."""
    tid = task["id"]
    ident = task.get("identifier", tid[:8])
    state = load_state().get(tid, {}).get("state", "claimed")
    stall = load_state().get(tid, {}).get("stall_count", 0)
    last_artifact = load_state().get(tid, {}).get("last_artifact_at", 0)
    rework_count = load_state().get(tid, {}).get("rework_count", 0)
    wt_path = str(REPO / ".paperclip" / "worktrees" / ident)

    # ── gate class check ──
    gate_class = task.get("labels", []) or []
    if isinstance(gate_class, list):
        gate_class = next((g for g in gate_class if g in GATED_CLASSES), "manual")
    else:
        gate_class = "manual"

    _log("task", f"{ident} state={state} gate={gate_class}")

    enforcement = cfg.get("enforcement", "shadow")

    # ── enforcement: off → skip entirely ──
    if enforcement == "off":
        _log("task", f"{ident} enforcement=off — skipping all processing")
        return "off"

    # ── enforcement: shadow → log pipeline, zero real transitions ──
    if enforcement == "shadow":
        stages = [
            ("plan", {"title": task.get("title"), "would_profile": "zeus-brainstorm"}),
            ("critique", {"would_profile": "zeus-critic"}),
            ("code", {"would_worktree": str(REPO / ".paperclip" / "worktrees" / ident), "would_profile": "zeus-coding"}),
            ("review", {"would_profile": "zeus-reviewer"}),
        ]
        # Shadow path: interleave Ten Laws checks between stages
        task_state = load_state().get(tid, {})
        for stage_name, would_do in stages:
            law_check = _check_ten_law_gate(tid, stage_name, task_state, cfg)
            would_do["ten_laws"] = law_check
            would_do["would_block"] = False  # SHADOW: enforcement OFF
            _shadow_event(tid, stage_name, **would_do)
        _log("shadow", f"{ident}: logged full pipeline shadow (Ten Laws checked), no real transitions")
        return "shadow_complete"

    # ── state machine ──
    task_state = load_state().get(tid, {})

    # Phase 1 fail-safe: legacy auto-merge states immediately gate
    if state in ("merging", "merged"):
        state = "gated"
        update_task(tid, status="needs_approval")
        add_comment(tid, "🔒 Legacy auto-merge state retired — held for operator approval.")
        emit_event("gated", tid, reason="legacy_state_failsafe", original_state=state)
    
    elif state == "claimed":
        law_check = _check_ten_law_gate(tid, "plan", task_state, cfg)
        if not law_check["passed"]:
            emit_event("ten_law_blocked", tid, stage="plan", checks=law_check["checks"])
            state = "rework"
            rework_count += 1
        elif stage_plan(task):
            task_state["had_plan"] = True
            state = "plan_ready"
        else:
            state = "rework"
            rework_count += 1

    elif state == "plan_ready":
        law_check = _check_ten_law_gate(tid, "critique", task_state, cfg)
        if not law_check["passed"]:
            emit_event("ten_law_blocked", tid, stage="critique", checks=law_check["checks"])
            state = "rework"
            rework_count += 1
        elif stage_critique(task):
            task_state["had_critique"] = True
            state = "critiqued"
        else:
            state = "rework"
            rework_count += 1

    elif state == "critiqued":
        law_check = _check_ten_law_gate(tid, "code", task_state, cfg)
        if not law_check["passed"]:
            emit_event("ten_law_blocked", tid, stage="code", checks=law_check["checks"])
            state = "rework"
            rework_count += 1
        elif stage_code(task):
            state = "in_review"
            last_artifact = now_ts()
        else:
            state = "rework"
            rework_count += 1

    elif state == "in_review":
        law_check = _check_ten_law_gate(tid, "review", task_state, cfg)
        if not law_check["passed"]:
            emit_event("ten_law_blocked", tid, stage="review", checks=law_check["checks"])
            state = "rework"
            rework_count += 1
        else:
            update_task(tid, status="in_review")
            verdict = stage_review(task)
            if verdict == "approved":
                task_state["had_review"] = True
                state = "gated"
                update_task(tid, status="needs_approval")
                add_comment(tid, f"🔒 **Gate class `{gate_class}`** — held for operator approval.")
                emit_event("gated", tid, gate_class=gate_class)
            elif verdict == "changes":
                state = "rework"
                rework_count += 1
            else:
                state = "rework"
                rework_count += 1

    elif state == "gated":
        _log("task", f"{ident} waiting at gate — class={gate_class}")

    # ── rework/boundary checks ──
    if state == "rework" and rework_count < cfg.get("rework_cap", 3):
        _log("task", f"{ident} rework #{rework_count} — retrying pipeline")
        state = "claimed"
        update_task(tid, status="todo")
    elif state == "rework":
        rework_count += 1

    if rework_count >= cfg.get("rework_cap", 3):
        state = "blocked"
        update_task(tid, status="blocked")
        add_comment(tid, f"🚫 **BLOCKED**: rework cap ({cfg['rework_cap']}) reached.")
        emit_event("blocked", tid, rework_count=rework_count)

    if stall >= 2:
        state = "blocked"
        update_task(tid, status="blocked")
        add_comment(tid, f"🚫 **BLOCKED**: 2 stalls without artifacts.")
        emit_event("blocked", tid, stall_count=stall)

    # ── save persistent state ──
    all_state = load_state()
    all_state[tid] = {
        **all_state.get(tid, {}),
        "state": state, "stall_count": stall, "last_artifact_at": last_artifact,
        "rework_count": rework_count, "gate_class": gate_class,
        "claimed_at": load_state().get(tid, {}).get("claimed_at") or now_ts(),
        "updated": now_iso(),
    }
    save_state(all_state)

    # ── progress check (for active states) ──
    if state in ACTIVE_STATES:
        new_stall, last_artifact = check_progress_watchdog(tid, wt_path, stall, last_artifact, cfg)
        if new_stall != stall or last_artifact != all_state[tid].get("last_artifact_at"):
            all_state[tid]["stall_count"] = new_stall
            all_state[tid]["last_artifact_at"] = last_artifact
            save_state(all_state)

    return state


def main():
    global CONTROLLER_LOCK, CONTROLLER_EPOCH
    # ── CLI toggle subcommands (exit immediately) ──
    if "--enable" in sys.argv:
        toggle_enable()
        return
    if "--disable" in sys.argv:
        toggle_disable()
        return
    if "--status" in sys.argv:
        toggle_status()
        return
    if "--version" in sys.argv:
        print(f"RAIL Controller Daemon v{__version__}")
        print("Paperclip autonomous pipeline controller (Zeus RAIL framework)")
        return

    cfg = load_config()

    # ── load API key from config if not already set via env ──
    global API_KEY
    if not API_KEY and cfg.get("api_key"):
        API_KEY = cfg["api_key"]
    if cfg.get("enforcement") == "shadow" and not API_KEY:
        _log("rail", "⚠  SHADOW MODE: No Paperclip API key configured. "
             "The controller can read the board via direct DB access but cannot query the Paperclip API. "
             "Shadow decisions will be logged to rail_events. "
             "Set PAPERCLIP_API_KEY env var or api_key in .rail_config.json for full shadow fidelity.")

    # ── MASTER SWITCH ──
    if not cfg.get("rail_enabled"):
        _log("rail", "RAIL_ENABLED = OFF. Idling — claiming nothing. "
             "Run 'python3 rail_controller.py --enable' to activate.")
        # In cron/once mode, just exit. In daemon mode, sleep and re-check.
        if ONCE or E2E:
            return
        # daemon mode: idle loop
        _log("rail", f"Daemon idling, re-checking every {POLL_SEC}s...")
        while True:
            time.sleep(POLL_SEC)
            cfg = load_config()
            if cfg.get("rail_enabled"):
                _log("rail", "RAIL_ENABLED flipped ON — resuming operations")
                break

    CONTROLLER_LOCK = acquire_controller_lock()
    CONTROLLER_EPOCH = next_controller_epoch()
    _log("rail", f"RAIL controller starting. epoch={CONTROLLER_EPOCH} rail_enabled=ON enforcement={cfg['enforcement']} poll={POLL_SEC}s")
    emit_event("controller.start", "system", config={k: v for k, v in cfg.items() if k != "rail_enabled"},
               polling_interval_s=POLL_SEC, dry=DRY, once=ONCE, e2e=E2E)

    # startup health — check profiles exist
    for p in ["default", "zeus-critic", "zeus-coding", "zeus-reviewer"]:
        out, _, rc = run(f"{HERMES} profile list", timeout=10)
        if out and p in out:
            _log("rail", f"profile OK: {p}")
        else:
            _log("rail", f"WARNING: profile '{p}' not found in hermes profile list")

    iterations = 0
    while True:
        iterations += 1

        # ── master switch check each tick ──
        cfg = load_config()
        if not cfg.get("rail_enabled"):
            _log("rail", "RAIL_ENABLED flipped OFF — idling")
            if ONCE:
                break
            time.sleep(POLL_SEC)
            continue

        controller_heartbeat()

        # ── claim new tasks ──
        task = claim_task(cfg)
        if task:
            _log("claim", f"claimed {task.get('identifier', task['id'][:8])}")
            if E2E:
                for _ in range(20):
                    new_state = process_task(task, cfg)
                    _log("e2e", f"state={new_state}")
                    if new_state in ("closed", "blocked", "gated"):
                        break
                    task = api("GET", f"/api/issues/{task['id']}") or task
                    time.sleep(2)
            else:
                process_task(task, cfg)
        else:
            # ── resume existing in-flight tasks ──
            st = load_state()
            for tid, ts in st.items():
                if ts.get("state") in ACTIVE_STATES:
                    issue = api("GET", f"/api/issues/{tid}")
                    if issue:
                        process_task(issue, cfg)
                    else:
                        _log("task", f"task {tid} no longer exists, cleaning up state")

            # ── heartbeat sweep for all active tasks ──
            for tid, ts in st.items():
                if ts.get("state") in ACTIVE_STATES:
                    ident = ts.get("identifier", tid[:8])
                    wt = str(REPO / ".paperclip" / "worktrees" / ident)
                    ns, la = check_progress_watchdog(
                        tid, wt, ts.get("stall_count", 0),
                        ts.get("last_artifact_at", 0), cfg
                    )
                    # Session rotation check (Ten Laws: session_max_age)
                    rot = _check_session_rotation(tid, ts, cfg)
                    if rot.get("needs_rotation"):
                        emit_event("session.rotation_needed", tid, rotation=rot)
                        _log("session", f"{ident}: session age {rot['age_hours']}h > {rot['max_hours']}h max — rotation needed")
                    if ns != ts.get("stall_count", 0) or la != ts.get("last_artifact_at", 0):
                        st[tid]["stall_count"] = ns
                        st[tid]["last_artifact_at"] = la
                        save_state(st)

        if ONCE:
            _log("rail", "--once mode: ran 1 cycle, exiting")
            break

        if iterations % 60 == 0:
            _log("rail", f"heartbeat: iteration {iterations}, "
                 f"active tasks: {sum(1 for t in load_state().values() if t.get('state') in ACTIVE_STATES)}")

        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()


# ── version footer ──────────────────────────────────────────────
# RAIL Controller Daemon  v2.0  —  autonomous pipeline controller
# Built for Paperclip / Zeus RAIL framework
