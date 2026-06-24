"""
Shared MLflow usage logger for fleet LLM calls that BYPASS the litellm proxy.

Why this exists
---------------
The AugiVector litellm proxy (:3000) logs one MLflow run per call to the local
tracking server (experiment "fleet-llm-calls") via mlflow_litellm_logger.py.
The Costs tab reads those runs through GET /mlflow/costs and groups them by the
`provider_model` tag. Two providers, however, do NOT flow through the proxy and
were therefore invisible to MLflow / the Costs tab:

  * GEMINI  - called directly against generativelanguage.googleapis.com by the
              visual Reviewer / QC agents (gemini-2.5-flash + fallbacks) and the
              design image-gen agents (gemini-3 image models).
  * QWEN    - BailysApp's personal-assistant agent (qwen/qwen3-vl-8b-instruct)
              called directly against OpenRouter from the iOS app.

This module emits MLflow runs in the EXACT same shape the litellm callback uses
(same tags + metrics), so Gemini and Qwen show up as first-class per-model rows
in the Costs tab and reconcile into the same MLflow total. Pure stdlib (urllib),
every path wrapped in try/except: metering must never break inference.

Pricing
-------
PRICING below is public list pricing verified 2026-06-24 (sources in README.md).
Costs are computed from real token counts returned by each provider; we never
invent token counts. `thoughtsTokenCount` (Gemini reasoning) is billed as output.
"""
import os, json, time, threading, urllib.request

MLFLOW_URL = os.environ.get("MLFLOW_URL", "http://127.0.0.1:5566").rstrip("/")
EXPERIMENT_NAME = os.environ.get("MLFLOW_FLEET_EXPERIMENT", "fleet-llm-calls")
_TIMEOUT = float(os.environ.get("MLFLOW_LOG_TIMEOUT", "3.0"))

# USD per single token. (list price / 1e6). Verified 2026-06-24 — see README.md.
PRICING = {
    # --- Gemini text / vision (generativelanguage API) ---
    "gemini-2.5-flash":              {"in": 0.30e-6, "out": 2.50e-6},
    "gemini-2.0-flash":              {"in": 0.10e-6, "out": 0.40e-6},   # deprecated (shut down 2026-06-01); kept as fallback alias
    "gemini-flash-latest":           {"in": 0.30e-6, "out": 2.50e-6},   # alias -> current flash (2.5-flash) pricing
    # --- Gemini image generation (design agents). Output = image tokens. ---
    "gemini-3-pro-image":            {"in": 2.00e-6, "out": 120.0e-6},  # ~1120 img-tok => ~$0.134 / 1-2K image
    "gemini-3-pro-image-preview":    {"in": 2.00e-6, "out": 120.0e-6},
    "gemini-3.1-flash-image-preview":{"in": 0.30e-6, "out": 60.0e-6},   # ~1120 img-tok => ~$0.067 / 1K image
    # --- Qwen via OpenRouter (BailysApp assistant) ---
    "qwen/qwen3-vl-8b-instruct":     {"in": 0.08e-6, "out": 0.50e-6},
    "qwen/qwen3-vl-32b-instruct":    {"in": 0.20e-6, "out": 0.80e-6},
}

_exp_id = None
_lock = threading.Lock()


def _post(path, payload, timeout=_TIMEOUT):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        MLFLOW_URL + path, data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def get_exp_id():
    global _exp_id
    if _exp_id:
        return _exp_id
    with _lock:
        if _exp_id:
            return _exp_id
        try:
            res = _post("/api/2.0/mlflow/experiments/search", {"max_results": 1000})
            for e in res.get("experiments", []):
                if e.get("name") == EXPERIMENT_NAME:
                    _exp_id = e["experiment_id"]
                    return _exp_id
        except Exception:
            pass
        try:
            res = _post("/api/2.0/mlflow/experiments/create", {"name": EXPERIMENT_NAME})
            _exp_id = res.get("experiment_id")
        except Exception:
            _exp_id = None
        return _exp_id


def cost_from_tokens(model, prompt_tokens, output_tokens):
    """Compute USD cost from real token counts using PRICING. Returns None if
    the model is unknown (caller should pass an explicit cost instead)."""
    p = PRICING.get(model)
    if not p:
        return None
    pt = float(prompt_tokens or 0)
    ot = float(output_tokens or 0)
    return pt * p["in"] + ot * p["out"]


def log_usage(provider_model, alias=None, provider="", source="direct",
              prompt_tokens=None, completion_tokens=None, total_tokens=None,
              cost_usd=None, latency_ms=None, status="ok", call_id="",
              extra_tags=None, start_time_ms=None, end_time_ms=None):
    """Create one MLflow run mirroring the litellm callback's schema.

    Tags:   mlflow.runName, model_alias, provider_model, provider, source,
            status, call_id (+ any extra_tags)
    Metrics: cost_usd, latency_ms, prompt_tokens, completion_tokens,
            total_tokens, ok
    Returns the run_id, or None on any failure (never raises)."""
    try:
        exp = get_exp_id()
        if not exp:
            return None
        alias = alias or provider_model
        now_ms = int(time.time() * 1000)
        st = int(start_time_ms) if start_time_ms else now_ms
        en = int(end_time_ms) if end_time_ms else now_ms
        if cost_usd is None:
            cost_usd = cost_from_tokens(provider_model, prompt_tokens, completion_tokens)

        tags = [
            {"key": "mlflow.runName", "value": str(alias)},
            {"key": "model_alias", "value": str(alias)},
            {"key": "provider_model", "value": str(provider_model)},
            {"key": "provider", "value": str(provider)},
            {"key": "source", "value": str(source)},
            {"key": "status", "value": str(status)},
            {"key": "call_id", "value": str(call_id or "")},
        ]
        for k, v in (extra_tags or {}).items():
            tags.append({"key": str(k), "value": str(v)})

        run = _post("/api/2.0/mlflow/runs/create",
                    {"experiment_id": exp, "start_time": st, "tags": tags})
        rid = run["run"]["info"]["run_id"]

        metrics = []
        def addm(k, v):
            if v is None:
                return
            try:
                metrics.append({"key": k, "value": float(v), "timestamp": en, "step": 0})
            except Exception:
                pass
        addm("cost_usd", cost_usd)
        addm("latency_ms", latency_ms)
        addm("prompt_tokens", prompt_tokens)
        addm("completion_tokens", completion_tokens)
        addm("total_tokens", total_tokens)
        addm("ok", 1.0 if status == "ok" else 0.0)

        params = [
            {"key": "model_alias", "value": str(alias)[:250]},
            {"key": "provider_model", "value": str(provider_model)[:250]},
            {"key": "provider", "value": str(provider)[:250]},
        ]
        _post("/api/2.0/mlflow/runs/log-batch",
              {"run_id": rid, "metrics": metrics, "params": params})
        _post("/api/2.0/mlflow/runs/update",
              {"run_id": rid,
               "status": "FINISHED" if status == "ok" else "FAILED",
               "end_time": en})
        return rid
    except Exception:
        return None


def log_usage_async(**kwargs):
    """Fire-and-forget: log in a daemon thread so it can never delay a call."""
    try:
        threading.Thread(target=lambda: log_usage(**kwargs), daemon=True).start()
    except Exception:
        pass
