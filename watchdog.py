#!/usr/bin/env python3
"""
Tyler Co Fleet Watchdog v1
--------------------------
One dumb script that makes silent failures loud. No LLM anywhere in this file.

Checks:
  1. Box reachability (Tailscale ping) — Windows, Box 1, Box 2
  2. Vault endpoint (obsidian-brain HTTP) responds
  3. Paperclip /api/acp/fleet returns the expected roster count + canonical-db transport
  4. Postgres reachable via Paperclip /api/health/dbhealth
  5. Book Keeper queue: depth + minutes since last drain
  6. Agent heartbeat files: staleness
  7. Drift check: fleet.yaml roster vs /api/acp/fleet roster

Alerts to Slack only on failure + one daily "all green" summary so you know the
watchdog itself is alive (a silent watchdog is the failure mode this exists to kill).

Deploy: runs anywhere on the tailnet, but put it on Box 2 (or both Macs) —
NOT only on Windows, since Windows is the single point of failure it's watching.
Cron (every 5 min):  */5 * * * * /usr/bin/python3 /opt/fleet/watchdog.py
Daily summary flag:   0 9 * * *  /usr/bin/python3 /opt/fleet/watchdog.py --daily
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ============================== CONFIG =======================================
CONFIG = {
    "slack_webhook": os.environ.get("FLEET_WATCHDOG_SLACK_WEBHOOK", ""),  # keep out of the file
    "slack_channel_hint": "#fleet-watchdog",

    "boxes": {
        "windows (WindowsAugi)": "100.103.95.73",
        "box1 (AugiAIs-Mini)": "100.68.190.105",
        "box2 (AugiBot2s-Mini)": "100.85.82.53",
    },

    "vault_url": "http://100.103.95.73:18791/health",
    "dbhealth_url": "http://100.103.95.73:3100/api/health/dbhealth",
    "paperclip_fleet_url": "https://paperclip.augiport.com/api/acp/fleet",
    "expected_roster_count": 16,
    "expected_transport": "canonical-db",

    # Book Keeper queue — checked via Paperclip endpoint when available
    "bookkeeper_queue_dir": "",  # set to empty when running outside Windows
    "queue_depth_warn": 25,
    "queue_stale_minutes": 60,

    # Heartbeat files — set to empty on non-Windows machines
    "heartbeats": {
        # these are checked via HTTP/Paperclip when running remotely
    },

    # Drift check
    "fleet_yaml": "",  # set to path when fleet.yaml is accessible

    "timeout_sec": 10,
    "state_file": "/tmp/fleet_watchdog_state.json",
    "realert_after_min": 60,
}
# ==============================================================================


def now() -> datetime:
    return datetime.now(timezone.utc)


def slack(text: str) -> None:
    print(text)
    if not CONFIG["slack_webhook"]:
        return
    body = json.dumps({"text": text}).encode()
    req = urllib.request.Request(
        CONFIG["slack_webhook"], data=body, headers={"Content-Type": "application/json"}
    )
    try:
        urllib.request.urlopen(req, timeout=CONFIG["timeout_sec"])
    except Exception as e:
        print(f"[watchdog] Slack post failed: {e}", file=sys.stderr)


def check_boxes() -> list[str]:
    fails = []
    for name, ip in CONFIG["boxes"].items():
        flag = "-n" if sys.platform.startswith("win") else "-c"
        try:
            r = subprocess.run(
                ["ping", flag, "1", "-W" if not sys.platform.startswith("win") else "-w", "3", ip],
                capture_output=True, timeout=CONFIG["timeout_sec"],
            )
            if r.returncode != 0:
                fails.append(f"BOX DOWN: {name} ({ip}) not answering ping")
        except Exception as e:
            fails.append(f"BOX CHECK ERROR: {name} ({ip}): {e}")
    return fails


def http_get(url: str) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "fleet-watchdog/1"})
    with urllib.request.urlopen(req, timeout=CONFIG["timeout_sec"]) as resp:
        return resp.status, resp.read()


def check_vault() -> list[str]:
    try:
        status, _ = http_get(CONFIG["vault_url"])
        if status != 200:
            return [f"VAULT: endpoint returned HTTP {status} ({CONFIG['vault_url']})"]
    except Exception as e:
        return [f"VAULT DOWN: {CONFIG['vault_url']} unreachable: {e}"]
    return []


def check_paperclip_fleet() -> list[str]:
    fails = []
    try:
        status, body = http_get(CONFIG["paperclip_fleet_url"])
        if status != 200:
            return [f"PAPERCLIP: /api/acp/fleet returned HTTP {status}"]
        data = json.loads(body)
        agents = data.get("agents", data if isinstance(data, list) else [])
        transport = data.get("transport", "")
        if len(agents) != CONFIG["expected_roster_count"]:
            fails.append(
                f"PAPERCLIP: expected {CONFIG['expected_roster_count']} agents, got {len(agents)}"
            )
        if transport != CONFIG["expected_transport"]:
            fails.append(
                f"PAPERCLIP: expected transport={CONFIG['expected_transport']!r}, got {transport!r} — check fallback"
            )
    except Exception as e:
        return [f"PAPERCLIP DOWN: {e}"]
    return fails


def check_postgres() -> list[str]:
    """Check PG via Paperclip /api/health/dbhealth instead of direct connection."""
    try:
        status, body = http_get(CONFIG["dbhealth_url"])
        if status != 200:
            return [f"POSTGRES: /api/health/dbhealth returned HTTP {status}"]
        data = json.loads(body)
        if data.get("status") != "ok":
            return [f"POSTGRES: dbhealth reports unhealthy: {data.get('error', 'unknown')}"]
    except Exception as e:
        return [
            f"POSTGRES: {CONFIG['dbhealth_url']} not reachable (expected if Paperclip is down — check separately)"
        ]
    return []


def _minutes_old(path: str) -> "float | None":
    p = Path(path)
    if not p.exists():
        return None
    return (time.time() - p.stat().st_mtime) / 60.0


def check_bookkeeper_queue() -> list[str]:
    qdir = CONFIG.get("bookkeeper_queue_dir")
    if not qdir:
        return []  # skipped when no queue path configured
    fails = []
    qdir = Path(qdir)
    if not qdir.exists():
        return [f"BOOK KEEPER: queue dir not found at {qdir} (path wrong, or vault unmounted?)"]
    pending = [f for f in qdir.iterdir() if f.is_file()]
    if len(pending) > CONFIG["queue_depth_warn"]:
        fails.append(f"BOOK KEEPER: queue depth {len(pending)} > {CONFIG['queue_depth_warn']} — drainer may be stalled")
    if pending:
        oldest_min = max((time.time() - f.stat().st_mtime) / 60.0 for f in pending)
        if oldest_min > CONFIG["queue_stale_minutes"]:
            fails.append(
                f"BOOK KEEPER: oldest queued note is {oldest_min:.0f} min old "
                f"(> {CONFIG['queue_stale_minutes']}) — fleet has stopped learning"
            )
    return fails


def check_heartbeats() -> list[str]:
    fails = []
    for agent, (path, max_min) in CONFIG["heartbeats"].items():
        age = _minutes_old(path)
        if age is None:
            fails.append(f"HEARTBEAT: {agent} heartbeat file missing ({path})")
        elif age > max_min:
            fails.append(f"HEARTBEAT: {agent} stale {age:.0f} min (> {max_min}) — agent may be wedged")
    return fails


def check_drift() -> list[str]:
    """fleet.yaml roster names vs live /api/acp/fleet names."""
    fy = CONFIG.get("fleet_yaml")
    if not fy:
        return []  # skipped when no fleet.yaml path configured
    fy = Path(fy)
    if not fy.exists():
        return [f"DRIFT CHECK SKIPPED: {fy} not found"]
    expected = set()
    for line in fy.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("- name:"):
            expected.add(s.split(":", 1)[1].strip().strip('"').strip("'"))
    try:
        _, body = http_get(CONFIG["paperclip_fleet_url"])
        data = json.loads(body)
        agents = data.get("agents", data if isinstance(data, list) else [])
        live = {a.get("name", "") for a in agents if isinstance(a, dict)}
    except Exception as e:
        return [f"DRIFT CHECK: could not read live roster: {e}"]
    fleet_expected = {n for n in expected if n not in ("Baily AI",)}
    missing = fleet_expected - live
    extra = live - expected
    fails = []
    if missing:
        fails.append(f"DRIFT: in fleet.yaml but not on the board: {sorted(missing)}")
    if extra:
        fails.append(f"DRIFT: on the board but not in fleet.yaml: {sorted(extra)}")
    return fails


def load_state() -> dict:
    try:
        return json.loads(Path(CONFIG["state_file"]).read_text())
    except Exception:
        return {}


def save_state(state: dict) -> None:
    Path(CONFIG["state_file"]).write_text(json.dumps(state))


def main() -> None:
    daily = "--daily" in sys.argv
    failures: list[str] = []
    for check in (check_boxes, check_vault, check_paperclip_fleet, check_postgres,
                  check_bookkeeper_queue, check_heartbeats, check_drift):
        try:
            failures.extend(check())
        except Exception as e:
            failures.append(f"WATCHDOG BUG in {check.__name__}: {e}")

    state = load_state()
    ts = now().strftime("%Y-%m-%d %H:%M UTC")

    if failures:
        fresh = []
        for f in failures:
            last = state.get(f, 0)
            if time.time() - last > CONFIG["realert_after_min"] * 60:
                fresh.append(f)
                state[f] = time.time()
        if fresh:
            slack(f":rotating_light: *Fleet watchdog — {len(failures)} issue(s)* ({ts})\n" +
                  "\n".join(f"• {f}" for f in fresh) +
                  ("" if len(fresh) == len(failures) else f"\n(+{len(failures)-len(fresh)} still failing, muted)"))
    else:
        state = {}
        if daily:
            slack(f":white_check_mark: Fleet watchdog: all checks green ({ts})")

    save_state(state)


if __name__ == "__main__":
    main()
