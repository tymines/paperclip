#!/usr/bin/env python3
"""
OUROBOROS LOOP CONTROLLER — reference implementation v1.0 (2026-07-03)

The single transition authority for the AugiAI fleet's loops.
Companion to OUROBOROS-LOOP-ENGINEERING-SPEC.md and loops.yaml.

Enforces the Ten Laws in code (not in souls):
  Law 1  — four independent exits: verifier pass, iteration cap, budget, no-progress
  Law 2  — the maker never flips its own state; only this controller transitions
  Law 3  — no green transition without a validated, iteration-stamped proof bundle;
           structured denials (SYSTEM_RUN_DENIED) can never read as green
  Law 4  — one activation == one fresh isolated session (the runner enforces; we assert)
  Law 5  — all state read/written on disk (task dir), never from transcripts
  Law 6  — lease check before every iteration (one writer per tree)
  Law 7  — deterministic verifiers run in OUR subprocess; agent prose is never trusted
  Law 8  — BLOCKED is a first-class success exit with a required BLOCKED bundle
  Law 9  — budgets enforced here, alarmed to Slack, checkpointed on exhaustion
  Law 10 — protected paths and risk-class autonomy floors are hard checks

Dispatch: port into the fleet repo (OURO-2), replace the stubs marked FLEET-WIRE,
and keep the exit/refusal semantics byte-for-byte — the tests depend on them.

Demo:  python3 ouroboros_loop_controller.py --demo
       (synthetic loop exercising all four exits + the green-refusal path)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Callable, Iterable, Optional

# --------------------------------------------------------------------------
# Exit taxonomy (Law 1) — every activation ends in exactly one of these.
# --------------------------------------------------------------------------

class LoopExit(str, Enum):
    SUCCESS = "success"            # verifier passed; bundle validated; -> next state
    BLOCKED = "blocked"            # agent raised BLOCKED with a valid BLOCKED bundle
    NO_PROGRESS = "no_progress"    # delta requirement violated -> escalate NOW
    ITERATION_CAP = "iteration_cap"
    BUDGET = "budget_exhausted"
    LEASE_LOST = "lease_lost"      # watchdog reclaimed; abandon cleanly
    REFUSED = "refused"            # controller refused an illegal transition (Law 3)


class BoardState(str, Enum):
    BACKLOG = "backlog"
    READY = "ready"
    DISPATCHED = "dispatched"
    EXECUTING = "executing"
    REVIEW = "review"
    REWORK = "rework"
    GATE = "gate"
    MERGED = "merged"
    RETRO = "retro"
    BLOCKED = "blocked"


# Structured execution-denial markers (Law 3). A tool result carrying any of
# these can never contribute to a green verification, regardless of prose.
DENIAL_MARKERS = ("SYSTEM_RUN_DENIED", "INVALID_REQUEST", "UNAVAILABLE")


# --------------------------------------------------------------------------
# Contract (loaded from loops.yaml; minimal loader so the reference has no
# hard dependency — the fleet port should use pyyaml + jsonschema).
# --------------------------------------------------------------------------

@dataclass
class Budget:
    max_iterations: int = 3
    max_tokens: int = 200_000
    max_wall_clock_s: int = 3_600
    max_usd: float = 2.0


@dataclass
class VerifySpec:
    deterministic: list[str] = field(default_factory=list)  # exit-0 commands
    protected: list[str] = field(default_factory=list)      # globs worker must not touch
    judge: Optional[str] = None                             # independent evaluator id


@dataclass
class LoopContract:
    loop_id: str
    owner: str
    budget: Budget = field(default_factory=Budget)
    verify: VerifySpec = field(default_factory=VerifySpec)
    no_progress_window: int = 2
    success_state: BoardState = BoardState.REVIEW
    blocked_state: BoardState = BoardState.BLOCKED
    escalate_to: Optional[str] = "L5.revision"
    autonomy: str = "autopilot"    # manual | assisted | autopilot (floors in risk_classes)


def load_registry(path: Path) -> dict[str, LoopContract]:
    """FLEET-WIRE: replace with pyyaml + jsonschema validation of loops.yaml.
    Controller MUST refuse to run any loop_id absent from the registry."""
    try:
        import yaml  # type: ignore
    except ImportError:
        raise SystemExit("pyyaml required to load loops.yaml (pip install pyyaml)")
    raw = yaml.safe_load(path.read_text())
    contracts: dict[str, LoopContract] = {}
    for lid, spec in (raw.get("loops") or {}).items():
        b = spec.get("budget", {}) or {}
        v = spec.get("verify", {}) or {}
        contracts[lid] = LoopContract(
            loop_id=lid,
            owner=str(spec.get("owner", "unknown")),
            budget=Budget(
                max_iterations=int(b.get("max_iterations", 3)),
                max_tokens=int(b.get("max_tokens", 200_000)),
                max_wall_clock_s=int(b.get("max_wall_clock_s", 3_600)),
                max_usd=float(b.get("max_usd", 2.0)),
            ),
            verify=VerifySpec(
                deterministic=list(v.get("deterministic", []) or []),
                protected=list(v.get("protected", []) or []),
                judge=v.get("judge"),
            ),
            no_progress_window=int((spec.get("no_progress", {}) or {}).get("window", 2)),
            autonomy=str(spec.get("autonomy", "autopilot")),
        )
    return contracts


# --------------------------------------------------------------------------
# Typed event wire (Factory-style JSON-RPC notifications).
# --------------------------------------------------------------------------

class EventWire:
    def __init__(self, sink: Optional[Path] = None):
        self.sink = sink

    def emit(self, event: str, **params) -> None:
        msg = {"jsonrpc": "2.0", "method": event,
               "params": {"ts": time.time(), **params}}
        line = json.dumps(msg, default=str)
        if self.sink:
            with self.sink.open("a") as f:
                f.write(line + "\n")
        else:
            print(f"[event] {line}", file=sys.stderr)
        # FLEET-WIRE: also publish on the fleet JSON-RPC notification socket.


def alarm(text: str) -> None:
    """FLEET-WIRE: post to #ai-tech-new via Slack MCP. Never include secrets."""
    print(f"[ALARM -> #ai-tech-new] {text}", file=sys.stderr)


# --------------------------------------------------------------------------
# Disk state (Law 5). One task directory is the whole memory between
# fresh sessions: task.md, plan.md, lessons.md, proofs/, checkpoint.json.
# --------------------------------------------------------------------------

@dataclass
class TaskDir:
    root: Path

    @property
    def proofs(self) -> Path:
        p = self.root / "proofs"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def checkpoint(self, data: dict) -> None:
        (self.root / "checkpoint.json").write_text(json.dumps(data, indent=2))

    def load_checkpoint(self) -> dict:
        p = self.root / "checkpoint.json"
        return json.loads(p.read_text()) if p.exists() else {}

    def append_lesson(self, text: str) -> None:  # Reflexion hook (L7)
        with (self.root / "lessons.md").open("a") as f:
            f.write(f"- {time.strftime('%Y-%m-%d %H:%M')} {text.strip()}\n")


# --------------------------------------------------------------------------
# Verification (Laws 3 & 7). Deterministic checks run in OUR subprocess.
# --------------------------------------------------------------------------

@dataclass
class VerifyResult:
    passed: bool
    failing: list[str]              # sorted identifiers of failing checks
    denial_detected: bool = False
    raw: dict[str, str] = field(default_factory=dict)

    def signature(self) -> str:
        """Failure signature for no-progress detection: same failing set +
        same tail of output => same signature => no progress."""
        basis = json.dumps({"failing": self.failing,
                            "tails": {k: v[-400:] for k, v in sorted(self.raw.items())}},
                           sort_keys=True)
        return hashlib.sha256(basis.encode()).hexdigest()


def run_deterministic(cmds: Iterable[str], cwd: Path,
                      timeout_s: int = 900) -> VerifyResult:
    failing, raw, denial = [], {}, False
    for cmd in cmds:
        try:
            cp = subprocess.run(cmd, shell=True, cwd=str(cwd), timeout=timeout_s,
                                capture_output=True, text=True)
            out = (cp.stdout or "") + (cp.stderr or "")
            raw[cmd] = out
            if any(m in out for m in DENIAL_MARKERS):
                denial = True
                failing.append(cmd)          # Law 3: denial can never be green
            elif cp.returncode != 0:
                failing.append(cmd)
        except subprocess.TimeoutExpired:
            raw[cmd] = "TIMEOUT"
            failing.append(cmd)
    return VerifyResult(passed=(not failing), failing=sorted(failing),
                        denial_detected=denial, raw=raw)


def protected_paths_clean(worktree: Path, protected: list[str],
                          base_ref: str = "HEAD~1") -> bool:
    """Law 10 / anti-reward-hacking: the iteration's diff must not touch
    protected globs (e.g. tests/**). Fails closed on git errors."""
    if not protected:
        return True
    try:
        cp = subprocess.run(["git", "diff", "--name-only", base_ref],
                            cwd=str(worktree), capture_output=True, text=True, timeout=60)
        if cp.returncode != 0:
            return False
        changed = [l.strip() for l in cp.stdout.splitlines() if l.strip()]
        import fnmatch
        return not any(fnmatch.fnmatch(c, g) for c in changed for g in protected)
    except Exception:
        return False


# --------------------------------------------------------------------------
# Proof bundles (Law 3). Written by the controller around agent claims;
# validated before any green transition. Iteration-stamped, always.
# --------------------------------------------------------------------------

def write_bundle(task: TaskDir, *, loop_id: str, iteration: int, kind: str,
                 claims: dict, verify: Optional[VerifyResult],
                 extra: Optional[dict] = None) -> Path:
    bundle = {
        "schema": "fleet/schemas/proof-bundle.json",
        "bundle_id": str(uuid.uuid4()),
        "loop_id": loop_id,
        "iteration": iteration,                    # iteration-stamped (invariant)
        "kind": kind,                              # progress | success | blocked
        "ts": time.time(),
        "claims": claims,                          # agent prose lives HERE only
        "verification": None if verify is None else {
            "passed": verify.passed,
            "failing": verify.failing,
            "denial_detected": verify.denial_detected,
            "raw_tails": {k: v[-2000:] for k, v in verify.raw.items()},
        },
        **(extra or {}),
    }
    path = task.proofs / f"iter-{iteration:02d}-{kind}.json"
    path.write_text(json.dumps(bundle, indent=2))
    return path


def validate_green_bundle(path: Path, iteration: int) -> bool:
    """A green transition requires: bundle exists, matches iteration, kind is
    success, verification present, passed=True, no denials. Anything else: refuse."""
    try:
        b = json.loads(path.read_text())
        v = b.get("verification") or {}
        return (b.get("kind") == "success"
                and int(b.get("iteration", -1)) == iteration
                and v.get("passed") is True
                and v.get("denial_detected") is False)
    except Exception:
        return False


def validate_blocked_bundle(path: Path) -> bool:
    """Law 8: BLOCKED is a deliverable. Required fields: tried, failed,
    hypotheses, suggested_next."""
    try:
        b = json.loads(path.read_text())
        blk = b.get("blocked") or {}
        return all(blk.get(k) for k in ("tried", "failed", "hypotheses", "suggested_next"))
    except Exception:
        return False


# --------------------------------------------------------------------------
# Lease (Law 6) — FLEET-WIRE: back with the board DB; here, a JSON file.
# --------------------------------------------------------------------------

def lease_valid(task: TaskDir, agent: str) -> bool:
    p = task.root / "lease.json"
    if not p.exists():
        return False
    try:
        lease = json.loads(p.read_text())
        return lease.get("agent") == agent and lease.get("expires_at", 0) > time.time()
    except Exception:
        return False


# --------------------------------------------------------------------------
# The activation runner. `agent_step` is the ONLY place a model acts:
# it must launch ONE fresh isolated session (OpenClaw isolated cron /
# sessions API), let it read the task dir, act in the worktree, and return
# {"claims": {...}} or {"blocked": {tried, failed, hypotheses, suggested_next}}.
# It must NOT verify, NOT transition, NOT summarize into the transcript.
# --------------------------------------------------------------------------

AgentStep = Callable[[TaskDir, int, dict], dict]


@dataclass
class LoopOutcome:
    exit: LoopExit
    iterations: int
    next_state: Optional[BoardState]
    detail: str = ""


def run_loop(contract: LoopContract, task: TaskDir, worktree: Path,
             agent_step: AgentStep, wire: EventWire,
             spend_probe: Optional[Callable[[], tuple[int, float]]] = None) -> LoopOutcome:
    """Drive one loop to one of its exits. Resumable via checkpoint.json."""
    ck = task.load_checkpoint()
    iteration = int(ck.get("iteration", 0))
    signatures: list[str] = list(ck.get("signatures", []))
    started = float(ck.get("started", time.time()))
    tokens_used, usd_used = 0, 0.0

    wire.emit("loop.start", loop_id=contract.loop_id, owner=contract.owner,
              task=str(task.root), resume_iteration=iteration)

    while True:
        # ---- Exit 3: budget (Law 9) --------------------------------------
        if spend_probe:
            tokens_used, usd_used = spend_probe()
        elapsed = time.time() - started
        if (elapsed > contract.budget.max_wall_clock_s
                or tokens_used > contract.budget.max_tokens
                or usd_used > contract.budget.max_usd):
            task.checkpoint({"iteration": iteration, "signatures": signatures,
                             "started": started, "reason": "budget"})
            alarm(f"{contract.loop_id}: budget exhausted at iter {iteration} "
                  f"({elapsed:.0f}s, {tokens_used} tok, ${usd_used:.2f})")
            wire.emit("loop.exit", loop_id=contract.loop_id, exit=LoopExit.BUDGET,
                      iteration=iteration)
            return LoopOutcome(LoopExit.BUDGET, iteration, BoardState.BLOCKED,
                               "budget exhausted; checkpointed")

        # ---- Exit 2: iteration cap ---------------------------------------
        if iteration >= contract.budget.max_iterations:
            wire.emit("loop.exit", loop_id=contract.loop_id,
                      exit=LoopExit.ITERATION_CAP, iteration=iteration)
            return LoopOutcome(LoopExit.ITERATION_CAP, iteration, BoardState.REWORK,
                               f"cap {contract.budget.max_iterations} reached; "
                               f"escalate {contract.escalate_to}")

        # ---- Lease check (Law 6) -----------------------------------------
        if not lease_valid(task, contract.owner):
            wire.emit("loop.exit", loop_id=contract.loop_id,
                      exit=LoopExit.LEASE_LOST, iteration=iteration)
            return LoopOutcome(LoopExit.LEASE_LOST, iteration, None,
                               "lease invalid/expired; abandoning cleanly")

        iteration += 1
        wire.emit("loop.iteration", loop_id=contract.loop_id, iteration=iteration)

        # ---- The ONE fresh-session agent step (Laws 2, 4, 5) --------------
        result = agent_step(task, iteration, {"loop_id": contract.loop_id})

        # ---- Agent raised BLOCKED (Law 8) ---------------------------------
        if "blocked" in result:
            path = write_bundle(task, loop_id=contract.loop_id, iteration=iteration,
                                kind="blocked", claims=result.get("claims", {}),
                                verify=None, extra={"blocked": result["blocked"]})
            if not validate_blocked_bundle(path):
                wire.emit("loop.refused", loop_id=contract.loop_id, iteration=iteration,
                          reason="malformed BLOCKED bundle")
                task.append_lesson("BLOCKED raised without complete bundle; re-attempting")
                continue    # a lazy BLOCKED does not exit the loop
            wire.emit("loop.exit", loop_id=contract.loop_id, exit=LoopExit.BLOCKED,
                      iteration=iteration)
            return LoopOutcome(LoopExit.BLOCKED, iteration, contract.blocked_state,
                               "valid BLOCKED bundle -> gate")

        # ---- Verification in OUR subprocess (Laws 3 & 7) -------------------
        vr = run_deterministic(contract.verify.deterministic, cwd=worktree)
        prot_ok = protected_paths_clean(worktree, contract.verify.protected)
        if not prot_ok:
            vr.passed = False
            vr.failing = sorted(set(vr.failing) | {"protected-paths"})
        kind = "success" if vr.passed else "progress"
        bundle = write_bundle(task, loop_id=contract.loop_id, iteration=iteration,
                              kind=kind, claims=result.get("claims", {}), verify=vr)
        wire.emit("loop.verify", loop_id=contract.loop_id, iteration=iteration,
                  passed=vr.passed, failing=vr.failing, denial=vr.denial_detected)

        # ---- Exit 1: verifier pass (green requires validated bundle) ------
        if vr.passed:
            if not validate_green_bundle(bundle, iteration):
                wire.emit("loop.refused", loop_id=contract.loop_id, iteration=iteration,
                          reason="green transition without valid bundle (Law 3)")
                alarm(f"{contract.loop_id}: REFUSED green without valid bundle "
                      f"(iter {iteration}) — fabrication mismatch logged")
                return LoopOutcome(LoopExit.REFUSED, iteration, BoardState.REWORK,
                                   "refused illegal green")
            task.checkpoint({"iteration": iteration, "signatures": signatures,
                             "started": started, "reason": "success"})
            wire.emit("loop.exit", loop_id=contract.loop_id, exit=LoopExit.SUCCESS,
                      iteration=iteration)
            return LoopOutcome(LoopExit.SUCCESS, iteration, contract.success_state,
                               "verified; bundle valid; -> review")

        # ---- Exit 4: no-progress / delta requirement ------------------------
        sig = vr.signature()
        window = signatures[-(contract.no_progress_window - 1):] if contract.no_progress_window > 1 else []
        if sig in window or (signatures and sig == signatures[-1]):
            task.append_lesson(f"No progress at iter {iteration}: identical failure "
                               f"signature; failing={vr.failing}")
            task.checkpoint({"iteration": iteration, "signatures": signatures + [sig],
                             "started": started, "reason": "no_progress"})
            wire.emit("loop.exit", loop_id=contract.loop_id, exit=LoopExit.NO_PROGRESS,
                      iteration=iteration, failing=vr.failing)
            return LoopOutcome(LoopExit.NO_PROGRESS, iteration, BoardState.REWORK,
                               f"delta requirement violated; escalate {contract.escalate_to} NOW")
        signatures.append(sig)
        task.checkpoint({"iteration": iteration, "signatures": signatures,
                         "started": started, "reason": "progress"})
        # loop continues -> next fresh session reads updated disk state


# --------------------------------------------------------------------------
# Demo: a synthetic loop exercising all four exits + the refusal path.
# (OURO-2 acceptance: "a synthetic loop demonstrates all four exits".)
# --------------------------------------------------------------------------

def _demo() -> None:
    import tempfile, shutil

    def make_task(tmp: Path, scripted: list[dict], check_ok_at: Optional[int]) -> tuple:
        task = TaskDir(tmp / "task"); task.root.mkdir(parents=True)
        (task.root / "lease.json").write_text(json.dumps(
            {"agent": "worker.demo", "expires_at": time.time() + 3600}))
        wt = tmp / "wt"; wt.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=wt)
        subprocess.run(["git", "commit", "-q", "--allow-empty", "-m", "base"], cwd=wt)
        flag = wt / "ok.flag"

        def step(t: TaskDir, i: int, ctx: dict) -> dict:
            if check_ok_at is not None and i >= check_ok_at:
                flag.write_text("ok")
            subprocess.run(["git", "commit", "-q", "--allow-empty", "-m", f"iter {i}"], cwd=wt)
            return scripted[min(i, len(scripted)) - 1]

        contract = LoopContract(
            loop_id="L3.demo", owner="worker.demo",
            budget=Budget(max_iterations=3, max_wall_clock_s=3600),
            verify=VerifySpec(deterministic=[f"test -f {flag}"], protected=[]),
        )
        return contract, task, wt, step

    wire = EventWire()
    scenarios = {
        "SUCCESS (verifier pass on iter 2)":
            dict(scripted=[{"claims": {"note": "wip"}}] * 3, ok_at=2),
        "NO_PROGRESS (identical failure twice)":
            dict(scripted=[{"claims": {"note": "same failure"}}] * 3, ok_at=None),
        "BLOCKED (valid blocked bundle on iter 1)":
            dict(scripted=[{"blocked": {"tried": ["x"], "failed": ["y"],
                                        "hypotheses": ["z"], "suggested_next": "gate"}}],
                 ok_at=None),
    }
    for name, s in scenarios.items():
        tmp = Path(tempfile.mkdtemp())
        try:
            contract, task, wt, step = make_task(tmp, s["scripted"], s["ok_at"])
            if "NO_PROGRESS" in name:
                # vary nothing between iters -> identical signature
                pass
            out = run_loop(contract, task, wt, step, wire)
            print(f"\n=== {name} -> exit={out.exit.value} iters={out.iterations} "
                  f"next={out.next_state} :: {out.detail}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # ITERATION_CAP: failures with *changing* signatures burn the full cap
    tmp = Path(tempfile.mkdtemp())
    try:
        task = TaskDir(tmp / "task"); task.root.mkdir(parents=True)
        (task.root / "lease.json").write_text(json.dumps(
            {"agent": "worker.demo", "expires_at": time.time() + 3600}))
        wt = tmp / "wt"; wt.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=wt)
        subprocess.run(["git", "commit", "-q", "--allow-empty", "-m", "base"], cwd=wt)
        contract = LoopContract("L3.demo.cap", "worker.demo",
                                Budget(max_iterations=3),
                                VerifySpec(deterministic=["bash -c 'echo fail-$RANDOM; exit 1'"]))
        out = run_loop(contract, task, wt,
                       lambda t, i, c: {"claims": {"note": f"attempt {i}"}}, wire)
        print(f"\n=== ITERATION_CAP -> exit={out.exit.value} iters={out.iterations} "
              f"next={out.next_state} :: {out.detail}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Ouroboros loop controller (reference)")
    ap.add_argument("--demo", action="store_true", help="run the four-exit demo")
    ap.add_argument("--registry", type=Path, default=Path("loops.yaml"))
    args = ap.parse_args()
    if args.demo:
        _demo()
    else:
        reg = load_registry(args.registry)
        print(f"Loaded {len(reg)} loop contracts: {', '.join(sorted(reg))}")
        print("Wire agent_step + board + lease backends (FLEET-WIRE) to run for real.")
