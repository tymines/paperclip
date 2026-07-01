#!/usr/bin/env python3
"""
OpenRouter -> MLflow usage importer for BailysApp's Qwen personal assistant.

Background
----------
BailysApp's assistant agent calls qwen/qwen3-vl-8b-instruct directly against
OpenRouter from the iOS app (BailysApp/Services/AIService.swift). Those calls
never touch the litellm proxy, so MLflow / the Costs tab never saw them.

What this does
--------------
Reads the REAL cumulative spend recorded by OpenRouter for the BailysApp API
key (GET /api/v1/key -> data.usage, in USD) and upserts a SINGLE MLflow run for
qwen/qwen3-vl-8b-instruct into the shared fleet-llm-calls experiment, so the
Qwen assistant appears as a per-model row in the Costs tab with a real number.

Idempotency
-----------
The run is tagged import_id=openrouter-qwen-cumulative. On every run we find that
existing run and overwrite its cost_usd metric (MLflow returns the latest metric
value), so re-running this importer REFRESHES the figure instead of double
-counting. Safe to schedule (e.g. hourly).

Honest backfill limits
----------------------
* The figure is the key's true cumulative USD spend on OpenRouter. Because the
  BailysApp key is dedicated to the Qwen assistant, this is an accurate
  attribution of Qwen spend.
* OpenRouter's standard (non-provisioning) key endpoints expose cumulative cost
  but NOT a per-call history or cumulative token counts, so this run carries the
  real cost with tokens unknown (0). Per-call + per-token granularity going
  forward would require the iOS app to post each response's `usage` block to a
  local collector — that is the documented forward path; it is not retrofittable
  to calls already made from the phone.

Env / args:
  OPENROUTER_API_KEY  - overrides the key read from Secrets.swift
  --dry-run           - print what would be logged, write nothing
"""
import os, sys, json, time, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.expanduser("~/.openclaw"))
from mlflow_usage_logger import get_exp_id, _post, PRICING  # noqa: E402

SECRETS = os.path.expanduser("~/.openclaw/repos/bailysapp/BailysApp/Secrets.swift")
MODEL = "qwen/qwen3-vl-8b-instruct"
IMPORT_ID = "openrouter-qwen-cumulative"


def read_key():
    k = os.environ.get("OPENROUTER_API_KEY")
    if k:
        return k.strip()
    try:
        import re
        txt = open(SECRETS).read()
        m = re.search(r'openRouterKey\s*=\s*"(sk-or-[^"]+)"', txt)
        if m:
            return m.group(1)
    except Exception:
        pass
    return None


def openrouter_key_usage(key):
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/key",
        headers={"Authorization": "Bearer " + key},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        d = json.loads(r.read().decode("utf-8"))
    return d.get("data", {})


def find_existing_run(exp_id):
    try:
        res = _post("/api/2.0/mlflow/runs/search", {
            "experiment_ids": [exp_id],
            "filter": "tags.import_id = '%s'" % IMPORT_ID,
            "max_results": 1,
        })
        runs = res.get("runs", [])
        return runs[0]["info"]["run_id"] if runs else None
    except Exception:
        return None


def upsert(exp_id, cost_usd, dry_run=False):
    now = int(time.time() * 1000)
    if dry_run:
        print("[dry-run] would log %s cost_usd=$%.9f" % (MODEL, cost_usd))
        return None
    rid = find_existing_run(exp_id)
    if rid is None:
        tags = [
            {"key": "mlflow.runName", "value": MODEL},
            {"key": "model_alias", "value": MODEL},
            {"key": "provider_model", "value": MODEL},
            {"key": "provider", "value": "openrouter"},
            {"key": "source", "value": "openrouter-qwen-import"},
            {"key": "status", "value": "ok"},
            {"key": "import_id", "value": IMPORT_ID},
        ]
        run = _post("/api/2.0/mlflow/runs/create",
                    {"experiment_id": exp_id, "start_time": now, "tags": tags})
        rid = run["run"]["info"]["run_id"]
    metrics = [
        {"key": "cost_usd", "value": float(cost_usd), "timestamp": now, "step": 0},
        {"key": "total_tokens", "value": 0.0, "timestamp": now, "step": 0},
        {"key": "ok", "value": 1.0, "timestamp": now, "step": 0},
    ]
    _post("/api/2.0/mlflow/runs/log-batch", {"run_id": rid, "metrics": metrics})
    _post("/api/2.0/mlflow/runs/update",
          {"run_id": rid, "status": "FINISHED", "end_time": now})
    return rid


def main():
    dry = "--dry-run" in sys.argv
    key = read_key()
    if not key:
        print("ERROR: no OpenRouter key (set OPENROUTER_API_KEY or Secrets.swift)", file=sys.stderr)
        return 2
    data = openrouter_key_usage(key)
    usage = float(data.get("usage") or 0.0)
    print("OpenRouter key cumulative usage (Qwen/BailysApp): $%.9f" % usage)
    exp = get_exp_id()
    if not exp:
        print("ERROR: MLflow experiment unavailable", file=sys.stderr)
        return 3
    rid = upsert(exp, usage, dry_run=dry)
    print("MLflow run for %s: %s (cost_usd=$%.9f)" % (MODEL, rid, usage))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
